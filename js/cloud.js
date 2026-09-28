// ════════════════════════════════════════════════════
//  담임노트+ · 구글 드라이브 동기화 (DN.Cloud)
//  선생님 본인 구글 드라이브의 “앱 전용 숨김 폴더”(appDataFolder)로 PC ↔ 핸드폰 기록을 주고받는다.
//  - 권한은 drive.appdata 하나: 이 앱이 만든 숨김 파일만 읽고 쓸 수 있고, 드라이브의 다른 파일은 볼 수 없다
//  - 기기마다 파일 하나: 핸드폰 dn-mobile-<기기id>.json, PC dn-pc.json (동시에 덮어쓰는 충돌 없음)
//  - 내용은 파일로 옮기기(DN.Sync)와 같은 형식 — 학생 이름은 들어가지 않는다(번호만)
//  - 합치기는 DN.Sync의 규칙 그대로(updatedAt이 최근인 쪽, 두 번 합쳐도 같은 결과)
//  - 로그인 토큰은 이 탭에만(sessionStorage) 약 1시간 보관. 앱을 새로 열면 [동기화]를 한 번 눌러 이어 준다
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Cloud = (function () {
  const { toast } = DN.utils;
  const CLIENT_ID = '705997826638-0mkkd4f9f3k8dkdao1vk0q2vj0vsjv3k.apps.googleusercontent.com';
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const PC_FILE = 'dn-pc.json';
  const MOBILE_PREFIX = 'dn-mobile-';
  const TOKEN_KEY = 'dn_cloud_token';
  const PC_INTERVAL = 5 * 60 * 1000;

  let token = null;          // { access_token, expires_at }
  let tokenClient = null;
  let busy = false;
  let soonTimer = null;
  let listeners = [];

  // ── 상태 ──
  function linked() { return DN.Store.getMeta('cloudLinked') === '1'; }
  function account() { return DN.Store.getMeta('cloudEmail') || ''; }
  function lastSync() { return DN.Store.getMeta('cloudLastSync') || ''; }
  function tokenValid() { return !!(token && token.expires_at > Date.now() + 60000); }
  // 터치 기기에서 핸드폰 화면을 쓰고 있으면 핸드폰으로 동기화한다 (용도 체크를 안 했어도 PC 파일을 덮어쓰지 않도록)
  // PC 창을 좁혀서 핸드폰 화면이 된 경우(마우스)는 PC 그대로
  function isPhone() {
    if (DN.Settings.get().deviceRole === 'mobile') return true;
    return !!(DN.Mobile && DN.Mobile.active() && window.matchMedia('(pointer: coarse)').matches);
  }
  function onChange(fn) { listeners.push(fn); }
  function notify() {
    renderBar();
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }
  // PC 상단 한 줄: 연결돼 있는데 로그인이 끊겨 자동으로 못 받을 때만 보인다
  function renderBar() {
    const el = document.getElementById('cloudBar');
    if (!el) return;
    const show = linked() && !tokenValid() && !busy && !document.body.classList.contains('m-mode');
    el.hidden = !show;
    if (!show) { el.innerHTML = ''; return; }
    el.innerHTML = '<span>☁️ 핸드폰 기록을 자동으로 받으려면 구글 연결을 이어 주세요.</span><button class="btn-primary" id="cloudBarBtn">동기화</button>';
    el.querySelector('#cloudBarBtn').addEventListener('click', function () { sync(true); });
  }

  function loadToken() {
    try {
      const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
      if (t && t.expires_at > Date.now()) token = t;
    } catch (e) {}
  }
  function saveToken(t) {
    token = t;
    try { if (t) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t)); else sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  // ── 구글 로그인 (Google Identity Services) — 필요할 때만 불러온다 ──
  let gisPromise = null;
  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (gisPromise) return gisPromise;
    gisPromise = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('구글 로그인 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.')); };
      document.head.appendChild(s);
    });
    gisPromise.catch(function () { gisPromise = null; });
    return gisPromise;
  }
  // 버튼을 누른 순간에 불러야 한다(브라우저가 팝업을 막지 않도록)
  function requestToken(interactive) {
    return loadGis().then(function () {
      return new Promise(function (resolve, reject) {
        if (!tokenClient) {
          tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPE, callback: function () {} });
        }
        tokenClient.callback = function (resp) {
          if (resp && resp.access_token) {
            saveToken({ access_token: resp.access_token, expires_at: Date.now() + (Number(resp.expires_in) || 3600) * 1000 });
            resolve(token);
          } else {
            reject(new Error(resp && resp.error === 'access_denied' ? '구글 연결을 취소했어요.' : '구글 로그인에 실패했어요.'));
          }
        };
        tokenClient.error_callback = function (err) {
          reject(new Error(err && err.type === 'popup_closed' ? '로그인 창을 닫았어요.' : '구글 로그인 창을 열지 못했어요. 팝업 차단을 확인해 주세요.'));
        };
        tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '', login_hint: account() || undefined });
      });
    });
  }

  // ── 드라이브 전송 (테스트에서는 가짜로 바꿔 끼운다) ──
  function authFetch(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers, { Authorization: 'Bearer ' + token.access_token });
    return fetch(url, opts).then(function (res) {
      if (res.status === 401) { saveToken(null); throw Object.assign(new Error('구글 연결이 끊겼어요. [동기화]를 눌러 다시 이어 주세요.'), { needLogin: true }); }
      if (!res.ok) throw new Error('구글 드라이브 응답 오류 (' + res.status + ')');
      return res;
    });
  }
  const driveTransport = {
    list: function () {
      return authFetch(API + '/files?spaces=appDataFolder&pageSize=100&fields=files(id,name,modifiedTime)')
        .then(function (r) { return r.json(); }).then(function (j) { return j.files || []; });
    },
    download: function (id) {
      return authFetch(API + '/files/' + encodeURIComponent(id) + '?alt=media').then(function (r) { return r.text(); });
    },
    upload: function (name, text, existingId) {
      if (existingId) {
        return authFetch(UPLOAD + '/files/' + encodeURIComponent(existingId) + '?uploadType=media&fields=id,name,modifiedTime', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text,
        }).then(function (r) { return r.json(); });
      }
      const boundary = 'dn' + Date.now();
      const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify({ name: name, parents: ['appDataFolder'] }) + '\r\n--' + boundary +
        '\r\nContent-Type: application/json\r\n\r\n' + text + '\r\n--' + boundary + '--';
      return authFetch(UPLOAD + '/files?uploadType=multipart&fields=id,name,modifiedTime', {
        method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: body,
      }).then(function (r) { return r.json(); });
    },
    about: function () {
      return authFetch(API + '/about?fields=user(emailAddress)').then(function (r) { return r.json(); })
        .then(function (j) { return (j.user && j.user.emailAddress) || ''; });
    },
    revoke: function () {
      if (token && window.google && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(token.access_token, function () {});
      return Promise.resolve();
    },
  };
  let transport = driveTransport;

  // ── 동기화 한 번 ──
  // 결과: { received: 합친 요약 또는 null, sent: 보낸 기록 수 }
  function seenMap() { try { return JSON.parse(DN.Store.getMeta('cloudSeen') || '{}') || {}; } catch (e) { return {}; } }
  function saveSeen(m) { DN.Store.setMeta('cloudSeen', JSON.stringify(m)); }

  // PC 파일(dn-pc.json)을 마지막에 쓴 기기 id. 내가 쓴 뒤 바뀌지 않았으면 나, 아니면 파일을 열어 확인
  // 핸드폰은 PC 파일 하나만 받으므로, 다른 PC가 모르고 덮어쓰지 않도록 “주 PC”만 올린다
  function pcOwner(pcFile, seen) {
    if (!pcFile) return Promise.resolve('');
    if (seen[pcFile.id] === pcFile.modifiedTime) return Promise.resolve(DN.Sync.deviceId());
    return transport.download(pcFile.id).then(function (text) {
      const parsed = DN.Sync.parseFile(text, 'pc');
      return parsed.error ? '' : String(parsed.obj.deviceId || '');
    });
  }

  // opts.takeover: 다른 PC가 주 PC여도 이 PC로 바꾼다(선생님이 확인했을 때만)
  function syncOnce(opts) {
    opts = opts || {};
    const phone = isPhone();
    const myName = phone ? MOBILE_PREFIX + DN.Sync.deviceId() + '.json' : PC_FILE;
    const seen = seenMap();
    const result = { received: null, sent: 0, mergedFiles: 0, otherPc: false };
    return transport.list().then(function (files) {
      // 1) 받기: 핸드폰은 PC 파일, PC는 모든 핸드폰 파일 (바뀐 파일만)
      const incoming = files.filter(function (f) {
        return phone ? f.name === PC_FILE : f.name.indexOf(MOBILE_PREFIX) === 0;
      }).filter(function (f) { return seen[f.id] !== f.modifiedTime; });
      let chain = Promise.resolve();
      incoming.forEach(function (f) {
        chain = chain.then(function () { return transport.download(f.id); }).then(function (text) {
          const parsed = DN.Sync.parseFile(text, phone ? 'pc' : 'mobile');
          if (parsed.error) return;   // 형식이 다른 파일은 건너뛴다
          const res = phone ? DN.Sync.applyPcReceive(parsed.obj) : DN.Sync.applyPhoneMerge(parsed.obj);
          if (!res) throw new Error('저장 공간이 부족해 받은 기록을 합치지 못했어요.');
          result.mergedFiles++;
          if (!phone) {
            const prev = result.received;
            result.received = prev ? {
              obs: prev.obs + res.obs.added, att: prev.att + res.att.added, done: prev.done + res.doneChanged,
            } : { obs: res.obs.added, att: res.att.added, done: res.doneChanged };
          } else {
            result.received = { events: res.events.added + res.events.updated };
          }
          seen[f.id] = f.modifiedTime;
        });
      });
      return chain.then(function () {
        saveSeen(seen);
        const mine = files.find(function (f) { return f.name === myName; });
        return (phone ? Promise.resolve('') : pcOwner(mine, seen)).then(function (owner) {
          // 다른 PC가 주 PC면 받기만 하고 올리지 않는다
          if (!phone && owner && owner !== DN.Sync.deviceId() && !opts.takeover) {
            result.otherPc = true;
            DN.Store.setMeta('cloudOtherPc', '1');
            DN.Store.setMeta('cloudLastSync', new Date().toISOString());
            return result;
          }
          DN.Store.setMeta('cloudOtherPc', '');
          return upload(mine);
        });
      });
    });
    // 2) 보내기: 내 파일을 새로 쓴다
    function upload(mine) {
      const built = phone ? DN.Sync.buildPhoneFile() : DN.Sync.buildPcFile();
      return transport.upload(myName, JSON.stringify(built.obj), mine && mine.id).then(function (up) {
        if (phone) {
          DN.Sync.markSent(built.obj);
          result.sent = built.obj.data.observations.length + built.obj.data.attendance.length;
        }
        // 내가 방금 쓴 파일은 다음에 다시 받지 않도록
        if (up && up.id && up.modifiedTime) { seen[up.id] = up.modifiedTime; saveSeen(seen); }
        DN.Store.setMeta('cloudLastSync', new Date().toISOString());
        return result;
      });
    }
  }
  function otherPc() { return DN.Store.getMeta('cloudOtherPc') === '1'; }

  // ── 바깥에서 쓰는 동작 ──
  // 연결: 구글 로그인 → 계정 확인 → 첫 동기화
  function connect() {
    return requestToken(true).then(function () {
      return transport.about();
    }).then(function (email) {
      DN.Store.setMeta('cloudLinked', '1');
      DN.Store.setMeta('cloudEmail', email || '');
      return sync(true);
    }).then(function (r) {
      if (r && r.otherPc) return askTakeover();
      return r;
    }).catch(function (e) {
      toast(e.message || '구글 연결에 실패했어요.', 'error');
      notify();
    });
  }

  // 동기화: 토큰이 없으면(버튼을 누른 경우에만) 로그인을 이어 준다
  function sync(fromButton, opts) {
    if (!linked()) return Promise.resolve(null);
    if (busy) return Promise.resolve(null);
    const ready = tokenValid() ? Promise.resolve() : (fromButton ? requestToken(false) : Promise.reject(Object.assign(new Error(''), { needLogin: true })));
    busy = true;
    notify();
    return ready.then(function () { return syncOnce(opts); }).then(function (r) {
      busy = false;
      notify();
      const changed = !!(r && r.received && (isPhone() ? r.received.events : (r.received.obs || r.received.att || r.received.done)));
      if (fromButton || changed) toast(resultText(r), 'success');
      // 새 기록이 들어왔을 때만 화면을 새로 그린다. 입력 중이면 글자가 날아가지 않게 다음 이동 때 반영
      const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (changed && !typing && !document.getElementById('dnModal') && DN.App) DN.App.relayout();
      return r;
    }).catch(function (e) {
      busy = false;
      notify();
      if (fromButton && e && e.message) toast(e.message, 'error');
      return null;
    });
  }

  function resultText(r) {
    if (!r) return '';
    if (!isPhone() && r.otherPc && !(r.received && (r.received.obs || r.received.att || r.received.done))) return '☁️ 핸드폰 기록을 확인했어요 · 새 기록 없음 (다른 PC가 주 PC예요)';
    if (isPhone()) return '☁️ 동기화했어요' + (r.sent ? ' · 기록 ' + r.sent + '건 보냄' : '') + (r.received ? ' · PC 일정 받음' : '');
    const x = r.received;
    if (!x || !(x.obs || x.att || x.done)) return '☁️ 동기화했어요 · 새 핸드폰 기록 없음';
    return '☁️ 핸드폰 기록을 받았어요 · ' + [x.obs ? '관찰 ' + x.obs + '건' : '', x.att ? '출결 ' + x.att + '건' : '', x.done ? '완료 체크 ' + x.done + '건' : '']
      .filter(Boolean).join(' · ');
  }

  // 핸드폰: 기록을 저장한 뒤 몇 초 기다렸다가 자동으로 올린다(연결돼 있고 로그인이 살아 있을 때)
  function soon() {
    if (!linked() || !tokenValid()) { notify(); return; }
    clearTimeout(soonTimer);
    soonTimer = setTimeout(function () { sync(false); }, 3000);
  }

  // 이미 다른 PC가 주 PC일 때: 이 PC로 바꿀지 묻는다
  function askTakeover() {
    const ok = DN.utils.confirmAsk(['이미 다른 PC가 구글 드라이브에 연결돼 있어요.',
      '이 PC를 주 PC로 바꿀까요?', '',
      '· 바꾸면: 핸드폰은 이 PC의 학교 일정·시간표·상황 버튼을 받아요.',
      '· 취소하면: 이 PC는 핸드폰 기록을 받기만 하고, 핸드폰에는 아무것도 보내지 않아요.'].join(String.fromCharCode(10)));
    if (!ok) { notify(); return Promise.resolve(null); }
    return sync(true, { takeover: true });
  }

  function disconnect() {
    return transport.revoke().then(function () {
      saveToken(null);
      ['cloudLinked', 'cloudEmail', 'cloudLastSync', 'cloudSeen', 'cloudOtherPc'].forEach(function (k) { DN.Store.setMeta(k, ''); });
      notify();
    });
  }

  // 상태 한 줄 (화면용)
  function statusText() {
    if (!linked()) return '연결 안 됨';
    const t = lastSync();
    const when = t ? new Date(t) : null;
    const whenText = when ? (when.getMonth() + 1) + '/' + when.getDate() + ' ' + String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0') : '아직 없음';
    return (busy ? '동기화 중… · ' : '') + '마지막 동기화 ' + whenText + (tokenValid() ? '' : ' · [동기화]를 눌러 이어 주세요');
  }

  // 시작: 이 탭에 살아 있는 로그인이 있으면 바로 동기화, PC는 5분마다
  function start() {
    loadToken();
    renderBar();
    if (!linked()) return;
    loadGis().catch(function () {});   // [동기화]를 누르자마자 로그인 창이 뜨도록 미리 불러 둔다
    if (tokenValid()) setTimeout(function () { sync(false); }, 1500);
    if (!isPhone()) {
      setInterval(function () {
        if (document.visibilityState === 'visible' && tokenValid()) sync(false);
      }, PC_INTERVAL);
    }
  }

  return {
    CLIENT_ID, linked, account, lastSync, tokenValid, statusText, onChange,
    connect, sync, soon, disconnect, start, syncOnce, resultText, otherPc, askTakeover,
    // 테스트용
    _setTransport: function (t) { transport = t || driveTransport; },
    _setToken: function (t) { saveToken(t); },
    isBusy: function () { return busy; },
    renderBar: renderBar,
  };
})();
