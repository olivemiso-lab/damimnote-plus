// ════════════════════════════════════════════════════
//  담임노트+ · 핸드폰 화면 (DN.Mobile) — 명세 §7.5
//  첫 화면: 오늘 / 이번 주 우리 학년 일정 + [관찰 기록] [출결]
//  기록 흐름: 번호(여러 명) → 상황 또는 유형·사유 → 저장 + [되돌리기]
//  핸드폰(deviceRole: mobile)에서는 학생 이름을 보여 주지 않는다 (번호만)
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Mobile = (function () {
  const { esc, toast, today, openModal, closeModal } = DN.utils;
  const R = DN.Records;
  const E = DN.Events;
  const NARROW = '(max-width: 640px)';

  let rootEl = null;
  let installPrompt = null;   // 안드로이드 크롬의 설치 이벤트
  const st = {
    view: 'home',             // home | obs | att | ev
    date: today(),
    selected: new Set(),
    memo: '', memoOpen: false,
    free: '',                 // 직접 쓰기 글
    type: '', reason: '',
    undo: null,               // { col, ids, text }
  };
  let undoTimer = null;

  // 설치 창을 띄울 수 있게 되면(크롬이 알려 줌) 화면의 [앱 설치하기] 버튼을 보여 준다
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installPrompt = e;
    document.querySelectorAll('.m-install-btn').forEach(function (b) { b.hidden = false; });
    document.querySelectorAll('.m-install-menu').forEach(function (b) { b.hidden = true; });
  });
  window.addEventListener('appinstalled', function () {
    installPrompt = null;
    toast('설치했어요! 바탕화면의 📒 담임노트+ 아이콘으로 열어 주세요.', 'success');
    if (rootEl && active()) render(rootEl);
  });

  // ── 언제 핸드폰 화면을 쓰나 ──
  // 기기 용도가 핸드폰이면 항상, 아니면 화면이 좁을 때(교사가 “PC 화면으로 보기”를 고르지 않았다면)
  function isPhone() { return DN.Settings.get().deviceRole === 'mobile'; }
  function active() {
    if (isPhone()) return true;
    return window.matchMedia(NARROW).matches && DN.Store.getMeta('forceDesktop') !== '1';
  }
  function standalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
  function isAndroid() { return /android/i.test(navigator.userAgent); }

  // ── 앱 안 브라우저(카톡·스레드 등)에서 열었을 때 ──
  // 그 안에서는 앱 설치도 구글 연결도 안 되므로 크롬(아이폰은 사파리)으로 넘긴다
  function inAppName() {
    const ua = navigator.userAgent;
    if (/KAKAOTALK/i.test(ua)) return '카카오톡';
    if (/Barcelona/i.test(ua)) return '스레드';
    if (/Instagram/i.test(ua)) return '인스타그램';
    if (/FBAN|FBAV|FB_IAB/i.test(ua)) return '페이스북';
    if (/NAVER\(inapp/i.test(ua)) return '네이버 앱';
    if (/DaumApps/i.test(ua)) return '다음 앱';
    if (/\bLine\//i.test(ua)) return '라인';
    if (isAndroid() && /; wv\)/.test(ua)) return '다른 앱';
    return '';
  }
  function appUrl() { return location.origin + location.pathname; }
  function kakaoUrl() { return 'kakaotalk://web/openExternal?url=' + encodeURIComponent(appUrl()); }
  // 안드로이드는 크롬으로 바로, 아이폰 카톡은 카톡의 “바깥 브라우저로 열기”(사파리)
  function externalUrl(name) {
    if (!isAndroid() && name === '카카오톡') return kakaoUrl();
    if (isAndroid()) {
      return 'intent://' + location.host + location.pathname + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' +
        encodeURIComponent(appUrl()) + ';end';
    }
    return '';
  }
  function stayInApp() { try { return sessionStorage.getItem('dn_stayInApp') === '1'; } catch (e) { return false; } }
  function renderEscape(name) {
    const url = externalUrl(name);
    const br = isIOS() ? '사파리' : '크롬';
    rootEl.innerHTML = '<div class="m-wrap m-setup">' +
      '<div class="m-brand big">📒 담임노트<span class="plus">+</span></div>' +
      '<div class="m-escape"><b>📲 ' + br + '에서 열어 주세요</b>' +
      '<p>지금은 <b>' + esc(name) + '</b> 안에서 열려 있어요. 여기서는 앱 설치와 구글 연결이 되지 않아요.</p>' +
      (url ? '<a class="btn-primary m-big" href="' + esc(url) + '">' + (isIOS() ? '사파리로' : '크롬으로') + ' 열기</a>'
        : '<ol class="m-steps"><li>화면 위나 아래의 <b>⋯</b> 또는 <b>공유 버튼</b>을 누르세요.</li>' +
          '<li><b>“Safari로 열기”</b> 또는 <b>“외부 브라우저로 열기”</b>를 고르세요.</li></ol>') +
      '<button class="btn-secondary" id="mEscCopy">주소 복사하기</button>' +
      '<p class="m-addr">' + esc(appUrl()) + '</p></div>' +
      '<button class="m-link" id="mEscStay">그냥 여기서 볼게요</button></div>';
    rootEl.querySelector('#mEscCopy').addEventListener('click', function () {
      const fail = function () { toast('위 주소를 길게 눌러 복사해 주세요.', 'info'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(appUrl()).then(function () { toast('주소를 복사했어요. ' + br + '에 붙여 넣어 주세요.', 'success'); }, fail);
      } else fail();
    });
    rootEl.querySelector('#mEscStay').addEventListener('click', function () {
      try { sessionStorage.setItem('dn_stayInApp', '1'); } catch (e) {}
      render(rootEl);
    });
    // 카톡은 처음 한 번 자동으로 바깥 브라우저를 연다
    try {
      if (name === '카카오톡' && sessionStorage.getItem('dn_escTried') !== '1') {
        sessionStorage.setItem('dn_escTried', '1');
        location.href = kakaoUrl();
      }
    } catch (e) {}
  }
  function md(d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8)); }
  function mdw(d) { return md(d) + '(' + E.weekdayOf(d) + ')'; }

  // ════════ 화면 ════════
  function render(root) {
    rootEl = root;
    const inApp = inAppName();
    if (inApp && !stayInApp()) { renderEscape(inApp); return; }
    if (DN.Store.getMeta('mobileReady') !== '1') { renderSetup(); return; }
    const head = '<div class="m-head">' +
      (st.view === 'home'
        ? '<div class="m-brand">📒 담임노트<span class="plus">+</span></div>'
        : '<button class="m-back" id="mBack">← 처음으로</button>') +
      '<input type="date" id="mDate" class="m-date" value="' + esc(st.date) + '" aria-label="기록 날짜">' +
      '<button class="m-menu" id="mMenu" aria-label="설정">⚙️</button></div>';
    root.innerHTML = '<div class="m-wrap">' + head + '<div id="mBody"></div>' + sendBar() + '</div><div id="mUndo" class="m-undo" hidden></div>';
    const body = root.querySelector('#mBody');
    if (st.view === 'obs') renderObs(body);
    else if (st.view === 'att') renderAtt(body);
    else if (st.view === 'ev') renderEv(body);
    else renderHome(body);

    root.querySelector('#mDate').addEventListener('change', function (e) {
      st.date = e.target.value || today();
      if (st.view === 'home' || st.view === 'ev') render(root);
    });
    root.querySelector('#mMenu').addEventListener('click', openMenu);
    bindSendBar(root);
    const back = root.querySelector('#mBack');
    if (back) back.addEventListener('click', function () { go('home'); });
    showUndo();
  }

  function go(view) {
    st.view = view;
    st.selected.clear();
    st.memo = ''; st.memoOpen = false;
    st.type = ''; st.reason = '';
    render(rootEl);
    window.scrollTo(0, 0);
  }

  function sendBar() {
    return '<div class="m-send" id="mSendBar">' + sendBarInner() + '</div>';
  }
  function sendBarInner() {
    const n = R.unsentCount();
    if (DN.Cloud && DN.Cloud.linked()) {
      return '<span class="m-cloud">☁️ ' + esc(DN.Cloud.statusText()) + (n ? ' · 안 보낸 기록 <b>' + n + '</b>건' : '') + '</span>' +
        '<button class="btn-primary" id="mCloud"' + (DN.Cloud.isBusy() ? ' disabled' : '') + '>동기화</button>';
    }
    return '<span>PC로 보내지 않은 기록 <b>' + n + '</b>건</span><button class="btn-primary" id="mSend">PC로 보내기</button>';
  }
  function bindSendBar(root) {
    const send = root.querySelector('#mSend');
    if (send) send.addEventListener('click', function () {
      send.disabled = true;
      DN.Sync.sendFromPhone().then(function () { render(root); });
    });
    const cloud = root.querySelector('#mCloud');
    if (cloud) cloud.addEventListener('click', function () {
      DN.Cloud.sync(true).then(function () { refreshSendBar(); });
    });
  }
  // 동기화 상태가 바뀌면 아래 줄만 새로 그린다(기록 중인 화면은 그대로)
  function refreshSendBar() {
    const bar = rootEl && rootEl.querySelector('#mSendBar');
    if (!bar) return;
    bar.innerHTML = sendBarInner();
    bindSendBar(rootEl);
  }
  if (DN.Cloud) DN.Cloud.onChange(refreshSendBar);

  // ── 첫 실행: 학생 수만 묻고 바로 시작 ──
  function renderSetup() {
    const s = DN.Settings.get();
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    rootEl.innerHTML = '<div class="m-wrap m-setup">' +
      '<div class="m-brand big">📒 담임노트<span class="plus">+</span></div>' +
      '<p class="m-lead">우리 반 학생 수만 알려 주시면 바로 기록을 시작할 수 있어요.</p>' +
      '<label class="m-field">학생 수 <input type="number" id="suCount" min="1" max="60" inputmode="numeric" value="' + esc(s.studentCount) + '"></label>' +
      '<label class="m-field">학년 <select id="suGrade">' + [1, 2, 3, 4, 5, 6].map(function (g) {
        return '<option value="' + g + '"' + (g === s.grade ? ' selected' : '') + '>' + g + '학년</option>';
      }).join('') + '</select></label>' +
      '<label class="check-label m-check"><input type="checkbox" id="suPhone"' + (coarse || isPhone() ? ' checked' : '') + '> 이 기기는 핸드폰이에요 (학생 이름 없이 번호로만 기록)</label>' +
      '<button class="btn-primary m-big" id="suStart">시작하기</button>' +
      installGuide() +
      '</div>';
    bindInstall(rootEl);
    rootEl.querySelector('#suStart').addEventListener('click', function () {
      const n = parseInt(rootEl.querySelector('#suCount').value, 10);
      if (!(n >= 1 && n <= 60)) { toast('학생 수를 1~60 사이로 입력해 주세요.', 'error'); return; }
      const patch = { studentCount: n, grade: +rootEl.querySelector('#suGrade').value };
      if (rootEl.querySelector('#suPhone').checked) patch.deviceRole = 'mobile';
      DN.Settings.save(patch);
      DN.Store.setMeta('mobileReady', '1');
      render(rootEl);
    });
  }

  // 앱 설치 안내 (설치돼 있거나 앱 안 브라우저면 표시 안 함)
  // 안드로이드 크롬: [앱 설치하기] 한 번으로 설치 창. 버튼이 아직 준비 안 됐으면 메뉴 안내
  function installGuide(closable) {
    if (standalone() || inAppName()) return '';
    const head = '<div class="m-install-h"><b>📲 앱으로 설치하면 더 편해요</b>' +
      (closable ? '<button class="hint-close" id="mInstallLater" aria-label="나중에" title="일주일 동안 숨기기">✕</button>' : '') + '</div>';
    if (isIOS()) {
      return '<div class="m-guide m-install">' + head +
        '<p>사파리 아래쪽 <b>공유 버튼(□↑)</b> → <b>홈 화면에 추가</b>를 누르세요.</p>' +
        '<p class="warn">⚠ 아이폰은 홈 화면에 추가하지 않고 쓰면, 한동안 열지 않았을 때 기록이 지워질 수 있어요.</p></div>';
    }
    return '<div class="m-guide m-install">' + head +
      '<p>바탕화면에 아이콘이 생기고, 앱처럼 전체 화면으로 열려요.</p>' +
      '<button class="btn-primary m-big m-install-btn"' + (installPrompt ? '' : ' hidden') + '>앱 설치하기</button>' +
      '<p class="m-install-menu"' + (installPrompt ? ' hidden' : '') + '>크롬 오른쪽 위 <b>⋮</b> → <b>설치 및 바로가기 만들기</b>(또는 홈 화면에 추가) → <b>설치</b></p></div>';
  }
  function bindInstall(root) {
    root.querySelectorAll('.m-install-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!installPrompt) return;
        const ev = installPrompt;
        installPrompt = null;
        ev.prompt();
        b.hidden = true;
        const menu = b.parentNode.querySelector('.m-install-menu');
        if (ev.userChoice) ev.userChoice.then(function (c) { if (c && c.outcome !== 'accepted' && menu) menu.hidden = false; });
      });
    });
    const later = root.querySelector('#mInstallLater');
    if (later) later.addEventListener('click', function () {
      DN.Store.setMeta('installLater', E.addDays(today(), 7));
      render(rootEl);
    });
  }
  function homeInstallCard() {
    const until = DN.Store.getMeta('installLater');
    return until && until > today() ? '' : installGuide(true);
  }

  // ── 첫 화면 ──
  function myGradeEvents() {
    return E.filtered({ myGrade: true }, DN.Settings.get().grade);
  }
  function evLine(e) {
    const task = E.isTask(e);
    const meta = [E.endOf(e) > e.date ? '~' + md(E.endOf(e)) : '', e.time, e.place].filter(Boolean).join(' · ');
    return '<li class="m-ev' + (e.kind === 'holiday' ? ' hol' : '') + (e.isMine ? ' mine' : '') + (e.done ? ' done' : '') + '">' +
      (task ? '<button class="chk' + (e.done ? ' on' : '') + '" data-done="' + esc(e.id) + '" aria-label="' + (e.done ? '완료 취소' : '완료') + '">' + (e.done ? '✓' : '') + '</button>' : '<span class="chk-sp"></span>') +
      '<span class="m-ev-t">' + (e.isMine ? '★ ' : '') + (e.kind === 'deadline' ? '[마감] ' : '') + esc(e.title) +
      (meta ? '<small>' + esc(meta) + '</small>' : '') + '</span>' +
      (e.source === 'mobile' ? '<button class="m-ev-del" data-evdel="' + esc(e.id) + '" aria-label="일정 지우기">✕</button>' : '') + '</li>';
  }
  // 첫 화면 아래 그림: 학교와 나무, 해·구름 (색은 화면 스타일 변수를 따라감) + 날마다 바뀌는 한마디
  const CHEERS = [
    '오늘도 아이들과 좋은 하루 보내세요 🌷', '작은 기록이 큰 성장을 만들어요 🌱', '선생님, 물 한 잔 마시고 가요 💧',
    '오늘 칭찬할 아이를 찾아볼까요? ⭐', '천천히, 차근차근 🐢', '웃는 얼굴이 제일 좋은 수업이에요 😊', '수고 많으셨어요, 선생님 🍀',
    '선생님의 한마디가 아이의 하루를 바꿔요 ✨', '완벽하지 않아도 괜찮아요 🤍', '오늘 가장 많이 웃은 아이는 누구였나요? 😄',
    '어제보다 한 뼘 자란 아이들 🌻', '쉬는 시간엔 선생님도 쉬어요 ☕', '기다려 주는 것도 가르침이에요 🕰️',
    '아이들은 선생님을 보고 배워요 🌈', '오늘 하루도 충분히 잘하고 있어요 👍', '조용한 아이에게도 눈길 한 번 🌙',
    '깊게 숨 한 번 쉬고 시작해요 🍃', '실수해도 다시 하면 돼요, 아이도 선생님도 🙂', '선생님 덕분에 교실이 따뜻해요 🔥',
    '작은 변화를 알아보는 눈, 그게 관찰이에요 🔍', '오늘 수업 중 가장 반짝인 순간은? 💎', '퇴근 후엔 나를 위한 시간 🛋️',
    '아이 한 명 한 명이 다 다른 꽃이에요 🌼', '천천히 자라는 나무가 뿌리가 깊어요 🌳', '좋은 질문 하나가 좋은 수업을 만들어요 ❓',
    '선생님 목소리도 소중해요, 목 관리 챙기기 🍯', '오늘의 기록이 내일의 이해가 돼요 📒',
    '칭찬은 구체적으로, 꾸중은 짧게 👏', '하루 한 번, 나에게도 칭찬 한마디 💛',
  ];
  // 요일에 맞는 한마디(월·수·금·주말)를 섞어서, 나머지 날은 목록에서 날마다 하나씩
  const DAY_CHEERS = { 1: '새로운 한 주, 가볍게 시작해요 🚀', 3: '한 주의 반을 왔어요, 잘하고 있어요 🙌', 5: '한 주 동안 정말 수고 많으셨어요 🎉', 6: '주말엔 푹 쉬어요, 선생님 🛌', 0: '내일을 위해 충전하는 하루 🔋' };
  function homeIllust() {
    const t = new Date(today() + 'T00:00:00');
    const n = Math.floor(t.getTime() / 86400000);
    const msg = (n % 2 === 0 && DAY_CHEERS[t.getDay()]) || CHEERS[n % CHEERS.length];
    return '<div class="m-illust"><p class="m-cheer">' + esc(msg) + '</p>' +
      '<svg viewBox="0 0 360 170" role="img" aria-label="선생님 책상 그림">' +
      // 바닥 그림자와 뒤의 옅은 동그라미
      '<ellipse cx="180" cy="150" rx="150" ry="10" style="fill:var(--line)"/>' +
      '<circle cx="92" cy="92" r="46" style="fill:var(--peach-bg)" opacity=".7"/>' +
      '<circle cx="268" cy="80" r="34" style="fill:var(--sky-bg)" opacity=".8"/>' +
      // 선으로 그린 화분 · 펼친 책 · 연필 · 머그컵
      '<g fill="none" style="stroke:var(--ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      '<line x1="40" y1="146" x2="320" y2="146"/>' +
      '<path d="M110 146 L110 118 Q140 110 170 120 L170 146"/><path d="M230 146 L230 118 Q200 110 170 120"/>' +
      '<path d="M118 128 Q140 122 160 128 M118 136 Q140 130 160 136 M180 128 Q200 122 222 128"/>' +
      '<path d="M252 146 V116 H284 V146 Z"/><path d="M284 124 Q298 124 298 132 Q298 140 284 140"/>' +
      '<path class="il-steam" d="M262 104 Q266 98 262 92 M272 104 Q276 98 272 92"/>' +
      '<path d="M62 146 L66 124 H90 L94 146 Z"/><path d="M78 124 V104"/>' +
      '<path d="M78 110 Q66 100 64 90 Q76 94 78 106"/><path d="M78 108 Q88 96 94 94 Q92 106 78 112"/>' +
      '<path d="M186 141 L236 129"/></g>' +
      '<path d="M252 132 H284" style="stroke:var(--peach-mid)" stroke-width="6"/>' +
      '<path d="M68 132 H92" style="stroke:var(--mint-ink)" stroke-width="3" opacity=".35"/>' +
      '</svg></div>';
  }

  // 첫 화면: 큰 버튼 세 개(관찰 기록·출결·일정)만
  function renderHome(body) {
    const d = st.date;
    const n = E.onDate(myGradeEvents(), d).filter(function (e) { return !(e.done && E.isTask(e)); }).length;
    body.innerHTML = homeInstallCard() +
      '<div class="m-actions home">' +
        '<button class="m-action obs" id="mGoObs"><span>📝</span>관찰 기록</button>' +
        '<button class="m-action att" id="mGoAtt"><span>🗓️</span>출결</button>' +
        '<button class="m-action ev" id="mGoEv"><span>📌</span><b>일정' + (n ? '<i class="m-badge">' + n + '</i>' : '') + '</b></button></div>' +
      homeIllust();
    bindInstall(body);
    body.querySelector('#mGoObs').addEventListener('click', function () { go('obs'); });
    body.querySelector('#mGoAtt').addEventListener('click', function () { go('att'); });
    body.querySelector('#mGoEv').addEventListener('click', function () { go('ev'); });
  }

  // 일정 화면: [＋ 일정 넣기] + 그날 일정 + 이번 주 우리 학년 일정
  // 완료 체크한 일정은 숨긴다. 아래 [완료한 일정 n개 보기]로 다시 볼 수 있다
  function renderEv(body) {
    const d = st.date;
    const all = myGradeEvents();
    const doneCount = all.filter(function (e) { return e.done && E.isTask(e); }).length;
    const list = st.showDone ? all : all.filter(function (e) { return !(e.done && E.isTask(e)); });
    const todays = E.onDate(list, d);
    const w = E.weekRange(d);
    const days = [];
    for (let x = w.start; x <= w.end; x = E.addDays(x, 1)) {
      const on = E.onDate(list, x).filter(function (e) { return e.date === x || x === w.start; });
      if (on.length) days.push({ d: x, list: on });
    }
    const grade = DN.Settings.get().grade;
    // 그날 시간표는 일정 화면 안에서 접었다 편다 (첫 화면은 버튼만)
    const tt = DN.Weekly.forDate(d);
    const ttOpen = DN.Store.getMeta('mTtOpen') === '1';
    body.innerHTML = '<button class="btn-primary m-big m-ev-bigadd" id="mEvAdd">＋ 일정 넣기</button>' +
      '<section class="m-card"><h2>' + (d === today() ? '오늘' : mdw(d)) + ' <small>' + (d === today() ? mdw(d) : '') + '</small></h2>' +
        (todays.length ? '<ul class="m-list">' + todays.map(evLine).join('') + '</ul>' : '<p class="m-empty">일정이 없어요.</p>') + '</section>' +
      (tt ? '<details class="m-card m-tt" id="mTt"' + (ttOpen ? ' open' : '') + '><summary>🕘 ' + (d === today() ? '오늘' : mdw(d)) + ' 시간표</summary>' +
        DN.Weekly.dayListHtml(tt) + '</details>' : '') +
      '<section class="m-card"><h2>이번 주 ' + grade + '학년 일정 <small>' + md(w.start) + '~' + md(w.end) + '</small></h2>' +
        (days.length ? days.map(function (x) {
          const hol = x.list.some(function (e) { return e.kind === 'holiday'; });
          return '<div class="m-day"><div class="m-day-d' + (hol ? ' hol' : '') + (x.d === today() ? ' today' : '') + '">' + esc(mdw(x.d)) + '</div>' +
            '<ul class="m-list">' + x.list.map(evLine).join('') + '</ul></div>';
        }).join('') : '<p class="m-empty">이번 주 일정이 없어요.</p>') + '</section>' +
      (doneCount ? '<button class="m-link" id="mShowDone">' + (st.showDone ? '완료한 일정 숨기기' : '완료한 일정 ' + doneCount + '개 보기') + '</button>' : '');
    body.querySelector('#mEvAdd').addEventListener('click', openEventAdd);
    const ttBox = body.querySelector('#mTt');
    if (ttBox) ttBox.addEventListener('toggle', function () { DN.Store.setMeta('mTtOpen', ttBox.open ? '1' : '0'); });
    const sd = body.querySelector('#mShowDone');
    if (sd) sd.addEventListener('click', function () { st.showDone = !st.showDone; render(rootEl); });
    body.addEventListener('click', function (e) {
      const del = e.target.closest('[data-evdel]');
      if (del) {
        const ev0 = E.get(del.dataset.evdel);
        if (!ev0 || !DN.utils.confirmAsk('“' + ev0.title + '” 일정을 지울까요?')) return;
        E.remove(ev0.id);
        toast('일정을 지웠어요.', 'info');
        render(rootEl);
        if (DN.Cloud) DN.Cloud.soon();
        return;
      }
      const b = e.target.closest('[data-done]');
      if (!b) return;
      const ev = E.get(b.dataset.done);
      if (!ev) return;
      E.update(ev.id, { done: !ev.done });
      toast(ev.done ? '완료 표시를 풀었어요.' : '완료! 목록에서 숨겼어요.', 'success');
      render(rootEl);
      if (DN.Cloud) DN.Cloud.soon();
    });
  }

  // ── 핸드폰에서 일정 넣기 (갑자기 잡힌 회의 등) → 동기화로 PC에도 ──
  // 날짜·시간은 자주 쓰는 것을 눌러서 고르고, 그 밖은 달력·시계로
  const EV_TIMES = [['', '시간 없음'], ['08:30', '아침 8:30'], ['12:40', '점심 12:40'], ['15:00', '3시'], ['16:00', '4시']];
  function openEventAdd() {
    const day0 = today();
    const days = [[day0, '오늘'], [E.addDays(day0, 1), '내일'], [E.addDays(day0, 2), '모레']];
    const chips = function (name, list, cur) {
      return '<div class="me-chips" data-chips="' + name + '">' + list.map(function (x) {
        return '<button type="button" class="me-chip" data-v="' + esc(x[0]) + '" aria-pressed="' + (x[0] === cur) + '">' + esc(x[1]) + '</button>';
      }).join('') + '</div>';
    };
    const body = '<div class="me-form">' +
      '<input type="text" id="meTitle" class="me-title" maxlength="60" placeholder="무슨 일정이에요? (예: 학년 협의회)">' +
      '<div class="me-label">📅 날짜</div>' + chips('date', days, st.date) +
      '<input type="date" id="meDate" class="me-pick" value="' + esc(st.date) + '">' +
      '<div class="me-label">🕘 시간</div>' + chips('time', EV_TIMES, '') +
      '<input type="time" id="meTime" class="me-pick">' +
      '<div class="me-label">📍 장소 <small>(선택)</small></div>' +
      '<input type="text" id="mePlace" maxlength="30" placeholder="예: 4학년 연구실">' +
      '<p class="me-help">☁️ 구글로 연결돼 있으면 PC 학교 일정에도 들어가요.</p></div>';
    const m = openModal('일정 넣기', body, '<button class="btn-primary m-big" id="meSave">저장</button>');
    m.querySelector('.modal').classList.add('me-sheet');
    const title = m.querySelector('#meTitle'), dateIn = m.querySelector('#meDate'), timeIn = m.querySelector('#meTime');
    title.focus();
    // 칩을 누르면 아래 달력·시계 값도 같이 바뀌고, 달력·시계를 바꾸면 맞는 칩이 켜진다
    const sync = function (name, v) {
      m.querySelectorAll('[data-chips="' + name + '"] .me-chip').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === v)); });
    };
    m.querySelectorAll('[data-chips]').forEach(function (box) {
      box.addEventListener('click', function (e) {
        const b = e.target.closest('.me-chip');
        if (!b) return;
        (box.dataset.chips === 'date' ? dateIn : timeIn).value = b.dataset.v;
        sync(box.dataset.chips, b.dataset.v);
      });
    });
    dateIn.addEventListener('change', function () { sync('date', dateIn.value); });
    timeIn.addEventListener('change', function () { sync('time', timeIn.value); });
    m.querySelector('#meSave').addEventListener('click', function () {
      const date = dateIn.value;
      const t = title.value.trim();
      if (!E.isDate(date)) { toast('날짜를 골라 주세요.', 'info'); return; }
      if (!t) { toast('무슨 일정인지 써 주세요.', 'info'); title.focus(); return; }
      const saved = E.create({ date: date, title: t, time: timeIn.value, place: m.querySelector('#mePlace').value.trim(), isMine: true, source: 'mobile' });
      if (!saved) { toast('저장하지 못했어요.', 'error'); return; }
      closeModal();
      toast((+date.slice(5, 7)) + '/' + (+date.slice(8)) + ' ' + t + ' 일정을 넣었어요.', 'success');
      render(rootEl);
      if (DN.Cloud) DN.Cloud.soon();
    });
  }

  // ── 기록 공통: 번호 격자 · 메모 ──
  function pickerSection() {
    return '<section class="m-card"><h2>① 번호 고르기</h2><div id="mPicker"></div></section>';
  }
  function memoHtml(hint) {
    return st.memoOpen
      ? '<textarea id="mMemo" rows="2" maxlength="60" placeholder="메모 (선택)">' + esc(st.memo) + '</textarea>' + (hint ? '<p class="memo-hint">⚠ ' + hint + '</p>' : '')
      : '<button type="button" class="pv-addend" id="mMemoOpen">+ 메모 덧붙이기</button>';
  }
  function bindCommon(body) {
    const pick = body.querySelector('#mPicker');
    pick.innerHTML = DN.Picker.html(st.selected, { showNames: !isPhone() });
    DN.Picker.bind(pick, st.selected);
    const open = body.querySelector('#mMemoOpen');
    if (open) open.addEventListener('click', function () {
      st.memoOpen = true;
      open.outerHTML = memoHtml(st.view === 'att' ? '병명 등 구체적인 사유는 적지 마세요.' : '');
      bindMemo(body);
      body.querySelector('#mMemo').focus();
    });
    bindMemo(body);
  }
  function bindMemo(body) {
    const m = body.querySelector('#mMemo');
    if (m) m.addEventListener('input', function () { st.memo = m.value; });
  }
  function afterSave(col, saved, text) {
    st.selected.clear();
    st.memo = ''; st.memoOpen = false;
    st.undo = { col: col, ids: saved.map(function (r) { return r.id; }), text: text };
    render(rootEl);
    if (DN.Cloud) DN.Cloud.soon();
  }

  // ── 관찰 기록 ──
  function renderObs(body) {
    const groups = R.presetGroups();
    body.innerHTML = pickerSection() +
      '<section class="m-card" id="mPresetCard"><h2>② 상황 누르기 <small>누르면 바로 저장돼요</small></h2>' +
      (groups.length ? groups.map(function (g) {
        return '<div class="m-preset-g"><div class="m-gname">' + esc(g.name) + '</div><div class="m-presets">' +
          g.items.map(function (p) { return '<button class="preset-btn" data-preset="' + esc(p.id) + '">' + esc(p.label) + '</button>'; }).join('') + '</div>' +
          (g.items.some(function (p) { return R.isConflictLabel(p.label); }) ? '<p class="preset-tip">💡 다툰 친구들을 함께 고르고 누르면 자리·모둠에서 떼어 놓도록 추천해요</p>' : '') + '</div>';
      }).join('') : '<p class="m-empty">상황 버튼이 없어요. PC에서 [일정 보내기]를 받으면 PC의 버튼이 들어와요.</p>') +
      '<div class="m-memo">' + memoHtml('') + '</div></section>' +
      '<section class="m-card m-free"><h2>✏️ 직접 쓰기 <small>버튼에 없는 내용</small></h2>' +
      '<textarea id="mFree" rows="2" maxlength="60" placeholder="예: 7번 학생을 때림 / 활동 후 뒷정리를 잘함">' + esc(st.free) + '</textarea>' +
      '<button class="btn-primary m-big" id="mFreeSave">저장</button></section>';
    bindCommon(body);
    const free = body.querySelector('#mFree');
    free.addEventListener('input', function () { st.free = free.value; });
    body.querySelector('#mFreeSave').addEventListener('click', function () {
      if (!st.selected.size) { toast('먼저 번호를 골라 주세요.', 'info'); return; }
      const text = free.value.trim();
      if (!text) { toast('내용을 써 주세요.', 'info'); free.focus(); return; }
      const nos = Array.from(st.selected).sort(function (a, b2) { return a - b2; });
      const saved = R.addFreeObservations(st.date, nos, text);
      if (!saved.length) { toast('저장하지 못했어요.', 'error'); return; }
      st.free = '';
      afterSave(R.OBS, saved, DN.Picker.listText(nos) + ' · ' + text + ' 저장됨');
    });
    body.querySelector('#mPresetCard').addEventListener('click', function (e) {
      const b = e.target.closest('[data-preset]');
      if (!b) return;
      const p = R.presets().find(function (x) { return x.id === b.dataset.preset; });
      if (!p) return;
      if (!st.selected.size) { toast('먼저 번호를 골라 주세요.', 'info'); return; }
      const nos = Array.from(st.selected).sort(function (a, b2) { return a - b2; });
      const saved = R.addObservations(st.date, nos, p, st.memoOpen ? st.memo.trim() : '');
      if (!saved.length) { toast('저장하지 못했어요.', 'error'); return; }
      afterSave(R.OBS, saved, DN.Picker.listText(nos) + ' · ' + p.label + ' 저장됨');
    });
  }

  // ── 출결 ──
  function segHtml(key, list) {
    return '<div class="m-seg" data-key="' + key + '">' + list.map(function (v) {
      return '<button type="button" data-v="' + esc(v) + '" aria-pressed="' + (st[key] === v) + '">' + esc(v) + '</button>';
    }).join('') + '</div>';
  }
  function renderAtt(body) {
    body.innerHTML = '<p class="notice small">📌 나이스 입력 전 확인용 메모이며, 공식 출결은 나이스에 입력하세요.</p>' + pickerSection() +
      '<section class="m-card"><h2>② 유형</h2>' + segHtml('type', R.TYPES) + '</section>' +
      '<section class="m-card"><h2>③ 사유</h2>' + segHtml('reason', R.REASONS) +
      '<div class="m-memo">' + memoHtml('병명 등 구체적인 사유는 적지 마세요.') + '</div>' +
      '<button class="btn-primary m-big" id="mAttSave">저장</button></section>';
    bindCommon(body);
    body.querySelectorAll('.m-seg').forEach(function (seg) {
      seg.addEventListener('click', function (e) {
        const b = e.target.closest('[data-v]');
        if (!b) return;
        const key = seg.dataset.key;
        st[key] = st[key] === b.dataset.v ? '' : b.dataset.v;
        seg.querySelectorAll('[data-v]').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.v === st[key])); });
      });
    });
    body.querySelector('#mAttSave').addEventListener('click', function () {
      if (!st.selected.size) { toast('먼저 번호를 골라 주세요.', 'info'); return; }
      if (!st.type || !st.reason) { toast('유형과 사유를 골라 주세요.', 'info'); return; }
      const nos = Array.from(st.selected).sort(function (a, b) { return a - b; });
      const before = R.attendance(st.date, st.date).map(function (a) { return a.id; });
      if (!R.saveAttendance(st.date, nos, st.type, st.reason, st.memoOpen ? st.memo.trim() : '')) { toast('저장하지 못했어요.', 'error'); return; }
      // 되돌리기는 새로 생긴 기록만 지운다(같은 유형을 덮어쓴 경우는 되돌리지 않음)
      const added = R.attendance(st.date, st.date).filter(function (a) { return before.indexOf(a.id) < 0; });
      const text = DN.Picker.listText(nos) + ' · ' + st.reason + ' ' + st.type + ' 저장됨';
      st.type = ''; st.reason = '';
      afterSave(R.ATT, added, text);
    });
  }

  // ── 되돌리기 알림 (6초) ──
  function showUndo() {
    const box = rootEl.querySelector('#mUndo');
    if (!box || !st.undo) return;
    box.hidden = false;
    box.innerHTML = '<span>' + esc(st.undo.text) + '</span>' + (st.undo.ids.length ? '<button id="mUndoBtn">되돌리기</button>' : '');
    const btn = box.querySelector('#mUndoBtn');
    if (btn) btn.addEventListener('click', function () {
      if (!st.undo) return;
      R.removeRecords(st.undo.col, st.undo.ids);
      st.undo = null;
      toast('방금 기록을 되돌렸어요.', 'info');
      render(rootEl);
      if (DN.Cloud) DN.Cloud.soon();
    });
    clearTimeout(undoTimer);
    undoTimer = setTimeout(function () { st.undo = null; box.hidden = true; }, 6000);
  }

  // ── 설정 메뉴 ──
  function openMenu() {
    const s = DN.Settings.get();
    const body = '<div class="fgrid">' +
      '<label for="mnCount">학생 수</label><input type="number" id="mnCount" min="1" max="60" inputmode="numeric" value="' + esc(s.studentCount) + '">' +
      '<label for="mnGrade">학년</label><select id="mnGrade">' + [1, 2, 3, 4, 5, 6].map(function (g) {
        return '<option value="' + g + '"' + (g === s.grade ? ' selected' : '') + '>' + g + '학년</option>'; }).join('') + '</select>' +
      '</div>' +
      '<label class="check-label m-check"><input type="checkbox" id="mnPhone"' + (isPhone() ? ' checked' : '') + '> 이 기기는 핸드폰이에요</label>' +
      '<div class="md-label">화면 스타일</div>' + DN.Settings.lookPickerHtml() +
      '<div class="md-label">☁️ 구글 드라이브 자동 동기화</div>' +
      (DN.Cloud.linked()
        ? '<p class="set-help" style="margin-top:0">연결됨: ' + esc(DN.Cloud.account() || '구글 계정') + '<br>PC에서도 같은 계정으로 연결하면 기록이 저절로 오가요.</p>' +
          '<div class="m-menu-btns"><button class="btn-ghost" id="mnCloudOff">연결 끊기</button></div>'
        : '<p class="set-help" style="margin-top:0">PC와 같은 구글 계정으로 연결하면 파일을 옮기지 않아도 기록이 저절로 오가요. 기록은 선생님 드라이브의 숨김 폴더에만 저장되고, 학생 이름은 올라가지 않아요.</p>' +
          '<div class="m-menu-btns"><button class="btn-primary" id="mnCloudOn">구글로 연결</button></div>') +
      '<div class="md-label">파일로 PC와 주고받기</div>' +
      '<div class="m-menu-btns">' +
        '<label class="btn-secondary bk-file">일정 받기<input type="file" id="mnReceive" accept=".json,application/json" hidden></label>' +
        '<button class="btn-ghost" id="mnCleanup">PC로 보낸 기록 정리</button>' +
      '</div>' +
      '<p class="set-help">핸드폰 기록을 먼저 [PC로 보내기] 한 뒤 일정을 받으면 완료 체크가 섞이지 않아요.</p>' +
      '<div class="m-menu-btns">' +
        '<button class="btn-ghost" id="mnBackup">기록 백업 파일 받기</button>' +
        (isPhone() ? '' : '<button class="btn-ghost" id="mnDesktop">PC 화면으로 보기</button>') +
      '</div>' + installGuide();
    const m = openModal('설정', body, '<span class="pv-spacer"></span><button class="btn-cancel" data-close>닫기</button><button class="btn-primary" id="mnSave">저장</button>');
    rootEl = rootEl || document.getElementById('view');
    bindInstall(m);
    DN.Settings.bindLookPicker(m);
    m.querySelector('#mnBackup').addEventListener('click', function () { DN.Backup.exportJson(); });
    const cloudOn = m.querySelector('#mnCloudOn');
    if (cloudOn) cloudOn.addEventListener('click', function () {
      DN.Cloud.connect().then(function () { if (DN.Cloud.linked()) { closeModal(); render(rootEl); } });
    });
    const cloudOff = m.querySelector('#mnCloudOff');
    if (cloudOff) cloudOff.addEventListener('click', function () {
      if (!DN.utils.confirmAsk('구글 드라이브 연결을 끊을까요? 이 기기의 기록은 그대로 남아요.')) return;
      DN.Cloud.disconnect().then(function () { closeModal(); render(rootEl); toast('연결을 끊었어요.', 'info'); });
    });
    m.querySelector('#mnReceive').addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      DN.Sync.receiveOnPhone(file).then(function (res) { if (res) { closeModal(); DN.App.relayout(); } });
    });
    m.querySelector('#mnCleanup').addEventListener('click', function () {
      const unsent = R.unsentCount();
      if (!DN.utils.confirmAsk(['PC로 이미 보낸 관찰·출결 기록을 이 핸드폰에서 지울까요?',
        '(PC에는 그대로 남아요. 보내지 않은 기록 ' + unsent + '건은 지우지 않아요.)'].join(String.fromCharCode(10)))) return;
      const n = DN.Sync.cleanupSent();
      toast(n >= 0 ? '보낸 기록 ' + n + '건을 정리했어요.' : '정리하지 못했어요.', n >= 0 ? 'success' : 'error');
    });
    const desk = m.querySelector('#mnDesktop');
    if (desk) desk.addEventListener('click', function () {
      DN.Store.setMeta('forceDesktop', '1');
      closeModal();
      DN.App.relayout();
    });
    m.querySelector('#mnSave').addEventListener('click', function () {
      const n = parseInt(m.querySelector('#mnCount').value, 10);
      if (!(n >= 1 && n <= 60)) { toast('학생 수를 1~60 사이로 입력해 주세요.', 'error'); return; }
      DN.Settings.save({ studentCount: n, grade: +m.querySelector('#mnGrade').value, deviceRole: m.querySelector('#mnPhone').checked ? 'mobile' : 'pc' });
      closeModal();
      toast('저장했어요.', 'success');
      DN.App.relayout();
    });
  }

  return { active, render, NARROW, isPhone };
})();
