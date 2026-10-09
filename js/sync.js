// ════════════════════════════════════════════════════
//  담임노트+ · PC ↔ 핸드폰 파일 동기화 (DN.Sync) — 명세 §8
//  PC → 핸드폰: 설정(학년·반·학생 수·학년도) · 관찰 상황 버튼 · 일정(담당자·메모·첨부 제외)
//  핸드폰 → PC: 관찰 · 출결 · 일정 완료 체크
//  합치기: id 기준, updatedAt이 더 최근인 쪽을 남긴다(툼스톤 포함). 같은 파일을 두 번 합쳐도 결과가 같다.
//  백업 복원(전체 교체)과 다르다 — 합치기는 지금 기록을 지우지 않는다.
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Sync = (function () {
  const { esc, toast, today } = DN.utils;
  const R = DN.Records;
  const APP_ID = 'damimnote-plus';
  const KIND = 'dn-sync';
  const VERSION = 1;
  const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

  let rootEl = null;
  let pending = null;   // PC 화면: 합치기 전 확인 중인 파일 { name, obj, plan }

  // ── 기기 id (처음 한 번 만든다) ──
  function deviceId() {
    let id = DN.Store.getMeta('deviceId');
    if (!id) { id = 'dev-' + DN.utils.uid().slice(3); DN.Store.setMeta('deviceId', id); }
    return id;
  }
  function envelope(from, data) {
    return { app: APP_ID, kind: KIND, version: VERSION, from: from, deviceId: deviceId(), createdAt: new Date().toISOString(), data: data };
  }

  // ── 받은 파일 검사 (믿을 수 없는 데이터 — 아는 칸만, 형식이 맞는 것만 가져온다) ──
  const str = function (v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; };
  const isIso = function (v) { return typeof v === 'string' && ISO_RE.test(v); };
  function baseOk(r) {
    return r && typeof r === 'object' && ID_RE.test(r.id) && isIso(r.updatedAt) && isIso(r.createdAt || r.updatedAt);
  }
  function base(r) {
    const o = { id: r.id, createdAt: r.createdAt || r.updatedAt, updatedAt: r.updatedAt };
    if (r.deleted === true) o.deleted = true;
    return o;
  }
  function cleanObservation(r) {
    if (!baseOk(r) || !DN.Events.isDate(r.date) || !(r.studentNo >= 1 && r.studentNo <= 99 && r.studentNo % 1 === 0)) return null;
    const o = Object.assign(base(r), { date: r.date, studentNo: r.studentNo, presetId: str(r.presetId, 80), label: str(r.label, 60), memo: str(r.memo, 200), device: 'mobile' });
    const w = Array.isArray(r.with) ? r.with.filter(function (n) { return n >= 1 && n <= 99 && n % 1 === 0 && n !== r.studentNo; }).slice(0, 10) : [];
    if (w.length) o.with = w;
    return o;
  }
  function cleanAttendance(r) {
    if (!baseOk(r) || !DN.Events.isDate(r.date) || !(r.studentNo >= 1 && r.studentNo <= 99 && r.studentNo % 1 === 0)) return null;
    if (R.TYPES.indexOf(r.type) < 0 || R.REASONS.indexOf(r.reason) < 0) return null;
    const o = Object.assign(base(r), { date: r.date, studentNo: r.studentNo, type: r.type, reason: r.reason, memo: str(r.memo, 100), device: 'mobile' });
    const p = R.cleanPeriod(r.type, r.period);
    if (p) o.period = p;
    return o;
  }
  function cleanPreset(r) {
    if (!baseOk(r) || !str(r.label, 60)) return null;
    return Object.assign(base(r), { label: str(r.label, 60), group: str(r.group, 20) || '기타', order: typeof r.order === 'number' ? r.order : 0 });
  }
  const EVENT_KINDS = ['event', 'holiday', 'deadline'];
  function cleanEvent(r) {
    if (!baseOk(r) || !DN.Events.isDate(r.date)) return null;
    const arr = function (v, f) { return Array.isArray(v) ? v.filter(f).slice(0, 20) : []; };
    return Object.assign(base(r), {
      date: r.date, endDate: DN.Events.isDate(r.endDate) ? r.endDate : '',
      title: str(r.title, 200), rawTitle: str(r.rawTitle, 300), owner: '', isMine: r.isMine === true,
      time: str(r.time, 60), place: str(r.place, 60),
      tags: arr(r.tags, function (x) { return typeof x === 'string'; }).map(function (x) { return x.slice(0, 40); }),
      grades: arr(r.grades, function (g) { return g >= 1 && g <= 6 && g % 1 === 0; }),
      classes: arr(r.classes, function (x) { return typeof x === 'string' && /^\d-\d{1,2}$/.test(x); }),
      kind: EVENT_KINDS.indexOf(r.kind) >= 0 ? r.kind : 'event', done: r.done === true,
      source: r.source === 'manual' || r.source === 'mobile' ? r.source : 'together', importKey: str(r.importKey, 10), seriesKey: str(r.seriesKey, 200),
      note: '', attachmentIds: [], needsReview: r.needsReview === true,
    });
  }

  function cleanTimetable(r) {
    if (!baseOk(r) || !DN.Events.isDate(r.weekStart) || !Array.isArray(r.days)) return null;
    const days = r.days.slice(0, 7).filter(function (d) { return d && DN.Events.isDate(d.date); }).map(function (d) {
      return {
        date: d.date, weekday: str(d.weekday, 2), off: str(d.off, 40), event: str(d.event, 200), supplies: str(d.supplies, 200),
        periods: (Array.isArray(d.periods) ? d.periods : []).slice(0, 12).map(function (p, i) {
          return { no: p && p.no >= 1 && p.no <= 12 ? p.no : i + 1, subject: str(p && p.subject, 30), content: str(p && p.content, 300), pages: str(p && p.pages, 60), cont: !!(p && p.cont === true) };
        }),
      };
    });
    return Object.assign(base(r), { weekStart: r.weekStart, title: str(r.title, 60), weekLabel: str(r.weekLabel, 10), fileName: str(r.fileName, 120), days: days });
  }

  // 파일 글 → { obj } 또는 { error }. expectFrom: 이 기기가 받을 수 있는 파일의 보낸 쪽
  function parseFile(text, expectFrom) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { return { error: '파일을 읽을 수 없어요. 담임노트+에서 만든 파일인지 확인해 주세요.' }; }
    if (!obj || obj.app !== APP_ID) return { error: '담임노트+ 파일이 아니에요.' };
    if (obj.kind === 'dn-backup' || (obj.kind !== KIND && (obj.collections || obj.students))) {
      return { error: '백업 파일이에요. 합치기가 아니라 [백업] 메뉴의 복원으로 열어 주세요.' };
    }
    if (obj.kind !== KIND || !obj.data || typeof obj.data !== 'object') return { error: '핸드폰 연결 파일이 아니에요.' };
    if (Number(obj.version) > VERSION) return { error: '더 새 버전의 담임노트+에서 만든 파일이에요. 앱을 최신 버전으로 열어 주세요.' };
    if (obj.from !== expectFrom) {
      return { error: expectFrom === 'mobile'
        ? 'PC에서 만든 일정 파일이에요. 핸드폰의 [일정 받기]로 열어 주세요.'
        : '핸드폰에서 보낸 기록 파일이에요. PC의 [핸드폰 연결 → 핸드폰 기록 합치기]로 열어 주세요.' };
    }
    return { obj: obj };
  }

  // ── 합치기 핵심: id 기준, 더 최근 updatedAt을 남긴다 ──
  // 결과: { list, added, updated, removed, skipped }
  function mergeList(current, incoming) {
    const byId = {};
    current.forEach(function (r, i) { byId[r.id] = i; });
    const list = current.slice();
    const res = { added: 0, updated: 0, removed: 0, skipped: 0 };
    incoming.forEach(function (r) {
      const i = byId[r.id];
      if (i === undefined) {
        byId[r.id] = list.length;
        list.push(r);
        if (!r.deleted) res.added++; else res.skipped++;
        return;
      }
      const old = list[i];
      if (!(r.updatedAt > (old.updatedAt || ''))) { res.skipped++; return; }
      list[i] = Object.assign({}, r, old.sentAt ? { sentAt: old.sentAt } : {});
      if (r.deleted && !old.deleted) res.removed++; else res.updated++;
    });
    res.list = list;
    return res;
  }

  // 여러 컬렉션을 한 번에 쓰고, 하나라도 실패하면 모두 되돌린다
  function writeAll(map) {
    const before = {};
    Object.keys(map).forEach(function (c) { before[c] = DN.Store.getAll(c); });
    const ok = Object.keys(map).every(function (c) { return DN.Store.replaceAll(c, map[c]); });
    if (!ok) Object.keys(before).forEach(function (c) { DN.Store.replaceAll(c, before[c]); });
    return ok;
  }

  // ════════ 핸드폰 → PC ════════
  // 핸드폰: 정리하지 않은 관찰·출결 전부 + 일정 완료 체크. 파일을 잃어버려도 다음에 다시 보내면 되도록 매번 전부 담는다
  function buildPhoneFile() {
    const pick = function (col) {
      return DN.Store.getAll(col).map(function (r) {
        const o = Object.assign({}, r);
        delete o.sentAt;
        return o;
      });
    };
    const events = DN.Store.getAll('events');
    const obj = envelope('mobile', {
      observations: pick(R.OBS),
      attendance: pick(R.ATT),
      eventDone: events.filter(function (e) { return !e.deleted; }).map(function (e) { return { id: e.id, done: !!e.done, updatedAt: e.updatedAt }; }),
      // 핸드폰에서 새로 넣은 일정(지운 것 포함) — 회의처럼 갑자기 생긴 일정
      events: events.filter(function (e) { return e.source === 'mobile'; }),
    });
    return { obj: obj, filename: '담임노트_핸드폰기록_' + today() + '.json' };
  }

  // 보낸 기록에 sentAt 표시 (updatedAt은 그대로 → “보내지 않은 기록”에서 빠진다)
  function markSent(obj) {
    const sent = {};
    obj.data.observations.concat(obj.data.attendance).forEach(function (r) { sent[r.id] = r.updatedAt; });
    const map = {};
    [R.OBS, R.ATT].forEach(function (col) {
      map[col] = DN.Store.getAll(col).map(function (r) {
        return sent[r.id] && sent[r.id] === r.updatedAt ? Object.assign({}, r, { sentAt: r.updatedAt }) : r;
      });
    });
    return writeAll(map);
  }

  // PC: 핸드폰 파일을 합쳤을 때의 결과 계산 (저장하지 않음)
  function planPhoneMerge(obj) {
    const d = obj.data;
    const clean = function (arr, f) { return (Array.isArray(arr) ? arr : []).map(f).filter(Boolean); };
    // PC에 들어온 핸드폰 기록은 이미 “보낸” 것 — PC가 좁은 화면(핸드폰 화면)일 때 보내지 않은 기록으로 세지 않도록
    const sentMark = function (r) { return r && Object.assign(r, { sentAt: r.updatedAt }); };
    const obsIn = clean(d.observations, function (r) { return sentMark(cleanObservation(r)); });
    const attIn = clean(d.attendance, function (r) { return sentMark(cleanAttendance(r)); });
    const obs = mergeList(DN.Store.getAll(R.OBS), obsIn);
    const att = mergeList(DN.Store.getAll(R.ATT), attIn);
    // 완료 체크: 핸드폰에서 더 나중에 바꾼 것만, 값이 다를 때만
    const events = DN.Store.getAll('events').slice();
    let doneChanged = 0;
    (Array.isArray(d.eventDone) ? d.eventDone : []).forEach(function (x) {
      if (!x || !ID_RE.test(x.id) || !isIso(x.updatedAt)) return;
      const i = events.findIndex(function (e) { return e.id === x.id; });
      if (i < 0 || events[i].deleted || !(x.updatedAt > events[i].updatedAt) || !!events[i].done === (x.done === true)) return;
      events[i] = Object.assign({}, events[i], { done: x.done === true, updatedAt: x.updatedAt });
      doneChanged++;
    });
    // 핸드폰에서 넣은 일정: 핸드폰이 만든 것만 받는다 (PC 일정을 핸드폰이 바꾸지 못하게)
    const mobileEv = clean(d.events, cleanEvent).filter(function (e) {
      if (e.source !== 'mobile') return false;
      const cur = events.find(function (x) { return x.id === e.id; });
      return !cur || cur.source === 'mobile';
    });
    const ev = mergeList(events, mobileEv);
    const rawCount = (Array.isArray(d.observations) ? d.observations.length : 0) + (Array.isArray(d.attendance) ? d.attendance.length : 0);
    return {
      obs: obs, att: att, events: ev.list, evAdded: ev.added, evChanged: ev.updated + ev.removed, doneChanged: doneChanged,
      invalid: rawCount - obsIn.length - attIn.length,
    };
  }
  function planText(p) {
    const parts = [];
    if (p.obs.added) parts.push('관찰 ' + p.obs.added + '건 추가');
    if (p.att.added) parts.push('출결 ' + p.att.added + '건 추가');
    if (p.obs.updated + p.att.updated) parts.push('고친 기록 ' + (p.obs.updated + p.att.updated) + '건 갱신');
    if (p.obs.removed + p.att.removed) parts.push('지운 기록 ' + (p.obs.removed + p.att.removed) + '건 반영');
    if (p.evAdded) parts.push('핸드폰 일정 ' + p.evAdded + '건 추가');
    if (p.evChanged) parts.push('핸드폰 일정 ' + p.evChanged + '건 갱신');
    if (p.doneChanged) parts.push('완료 체크 ' + p.doneChanged + '건 갱신');
    parts.push('중복 ' + (p.obs.skipped + p.att.skipped) + '건 건너뜀');
    if (p.invalid) parts.push('형식이 맞지 않는 ' + p.invalid + '건 제외');
    return parts.join(' · ');
  }
  function applyPhoneMerge(obj) {
    const p = planPhoneMerge(obj);
    const map = {};
    map[R.OBS] = p.obs.list;
    map[R.ATT] = p.att.list;
    map.events = p.events;
    if (!writeAll(map)) return null;
    DN.Store.setMeta('lastMergeAt', new Date().toISOString());
    return p;
  }

  // ════════ PC → 핸드폰 ════════
  function buildPcFile() {
    const s = DN.Settings.get();
    R.presets(); // 기본 버튼이 아직 없으면 만든다
    const obj = envelope('pc', {
      settings: { grade: s.grade, classNo: s.classNo, studentCount: s.studentCount, schoolYear: s.schoolYear },
      presets: DN.Store.getAll(R.PRE),
      // 담당자 이름·메모·첨부는 보내지 않는다 (§8.1). 툼스톤도 보내 핸드폰에서 지워지게
      events: DN.Store.getAll('events').map(function (e) {
        return Object.assign({}, e, { owner: '', note: '', attachmentIds: [] });
      }),
      timetables: DN.Store.getAll(DN.Weekly.COL),
    });
    return { obj: obj, filename: '담임노트_일정보내기_' + today().slice(0, 7) + '.json' };
  }

  // 핸드폰: PC 일정 파일 받기. 상황 버튼은 PC가 기준이므로 통째로 바꾸고, 일정은 합친다
  function planPcReceive(obj) {
    const d = obj.data;
    const clean = function (arr, f) { return (Array.isArray(arr) ? arr : []).map(f).filter(Boolean); };
    const presets = clean(d.presets, cleanPreset);
    const events = mergeList(DN.Store.getAll('events'), clean(d.events, cleanEvent));
    const timetables = mergeList(DN.Store.getAll(DN.Weekly.COL), clean(d.timetables, cleanTimetable));
    const s = d.settings || {};
    const settings = {};
    if (s.grade >= 1 && s.grade <= 6) settings.grade = s.grade;
    if (s.classNo >= 1 && s.classNo <= 30) settings.classNo = s.classNo;
    if (s.studentCount >= 1 && s.studentCount <= 60) settings.studentCount = s.studentCount;
    if (s.schoolYear >= 2000 && s.schoolYear <= 2100) settings.schoolYear = s.schoolYear;
    return { presets: presets, events: events, timetables: timetables, settings: settings };
  }
  function applyPcReceive(obj) {
    const p = planPcReceive(obj);
    const map = { events: p.events.list };
    map[DN.Weekly.COL] = p.timetables.list;
    if (p.presets.length) map[R.PRE] = p.presets;
    if (!writeAll(map)) return null;
    if (Object.keys(p.settings).length) DN.Settings.save(p.settings);
    DN.Store.setMeta('lastReceiveAt', new Date().toISOString());
    return p;
  }

  // 핸드폰: PC로 보낸 뒤 바뀌지 않은 기록 지우기 (PC에 이미 있으므로). 결과: 지운 건수
  function cleanupSent() {
    let n = 0;
    const map = {};
    [R.OBS, R.ATT].forEach(function (col) {
      map[col] = DN.Store.getAll(col).filter(function (r) {
        const sent = r.sentAt && !(r.updatedAt > r.sentAt);
        if (sent) n++;
        return !sent;
      });
    });
    return writeAll(map) ? n : -1;
  }

  // ── 파일 내보내기: 핸드폰은 공유 시트(카카오톡 나에게 보내기 등), 안 되면 내려받기 ──
  function saveFile(filename, obj) {
    const text = JSON.stringify(obj);
    const file = new File([text], filename, { type: 'application/json' });
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: filename }).then(function () { return true; }, function (e) {
        return e && e.name === 'AbortError' ? false : download(file);
      });
    }
    return Promise.resolve(download(file));
  }
  function download(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return true;
  }
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = function () { reject(new Error('파일을 읽지 못했어요.')); };
      r.readAsText(file, 'utf-8');
    });
  }

  // ════════ 핸드폰 화면에서 부르는 동작 ════════
  function sendFromPhone() {
    const f = buildPhoneFile();
    const n = f.obj.data.observations.length + f.obj.data.attendance.length;
    return saveFile(f.filename, f.obj).then(function (done) {
      if (!done) { toast('보내기를 취소했어요.', 'info'); return false; }
      markSent(f.obj);
      toast('기록 ' + n + '건을 파일로 만들었어요. PC의 [🔄 핸드폰 연결 → 핸드폰 기록 합치기]에서 열어 주세요.', 'success');
      return true;
    });
  }
  function receiveOnPhone(file) {
    return readFile(file).then(function (text) {
      const r = parseFile(text, 'pc');
      if (r.error) { toast(r.error, 'error'); return null; }
      const p = planPcReceive(r.obj);
      const live = p.events.list.filter(function (e) { return !e.deleted; }).length;
      if (!DN.utils.confirmAsk('PC에서 보낸 일정을 받을까요?\n\n· 일정 ' + live + '건 (새로 ' + p.events.added + '건, 갱신 ' + p.events.updated + '건)\n· 관찰 상황 버튼 ' +
        p.presets.filter(function (x) { return !x.deleted; }).length + '개\n· 시간표 ' +
        p.timetables.list.filter(function (x) { return !x.deleted; }).length + '주\n· 학생 수 ' + (p.settings.studentCount || '-') + '명\n\n핸드폰에서 한 기록은 지워지지 않아요.')) return null;
      const res = applyPcReceive(r.obj);
      toast(res ? '일정을 받았어요.' : '저장 공간이 부족해 받지 못했어요.', res ? 'success' : 'error');
      return res;
    }, function (e) { toast(e.message, 'error'); return null; });
  }

  // ════════ PC 화면: 🔄 핸드폰 연결 ════════
  function fmt(iso) {
    if (!iso) return '아직 없음';
    const d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  let cloudHooked = false;
  function render(container) {
    rootEl = container;
    if (DN.Cloud && !cloudHooked) {
      cloudHooked = true;
      DN.Cloud.onChange(function () { if (rootEl && rootEl.querySelector('#syCloud')) renderCloud(); });
    }
    const events = DN.Events.live().length;
    container.innerHTML = '\
      <div class="page-head"><h1>🔄 핸드폰 연결</h1></div>\
      <div class="card cloud-card" id="syCloud"></div>\
      <h2 class="side-title sync-alt">구글 없이 파일로 옮기기</h2>\
      <p class="set-help sync-lead">카카오톡 “나와의 채팅”이나 메일로 파일을 보내 다른 기기에서 여세요.</p>\
      <div class="sync-grid">\
        <div class="card">\
          <h2 class="side-title">📤 PC → 핸드폰 : 일정 보내기</h2>\
          <ul class="sync-list">\
            <li>✅ 학교 일정 ' + events + '건 · 시간표 ' + DN.Weekly.all().length + '주 · 관찰 상황 버튼 · 학년·반·학생 수</li>\
            <li>🚫 학생 이름 · 담당 교직원 이름 · 일정 메모 · 첨부 파일은 <b>보내지 않아요</b></li>\
          </ul>\
          <button class="btn-primary" id="syPcFile">일정 보내기 파일 만들기</button>\
          <p class="set-help">핸드폰에서 ⚙️ → <b>[일정 받기]</b>로 이 파일을 여세요. 일정이 바뀔 때마다 다시 보내면 돼요.</p>\
        </div>\
        <div class="card">\
          <h2 class="side-title">📥 핸드폰 → PC : 핸드폰 기록 합치기</h2>\
          <ul class="sync-list">\
            <li>핸드폰에서 [PC로 보내기]로 만든 파일을 고르면, 합치기 전에 무엇이 들어오는지 먼저 보여 드려요.</li>\
            <li>합치기는 지금 기록을 <b>지우지 않아요</b>. 같은 파일을 두 번 합쳐도 괜찮아요. (전체를 바꾸는 <b>백업 복원</b>과 달라요)</li>\
          </ul>\
          <label class="btn-secondary bk-file">핸드폰 기록 파일 선택<input type="file" id="syPick" accept=".json,application/json" hidden></label>\
          <div id="syPlan"></div>\
          <p class="set-help">마지막으로 합친 때: ' + esc(fmt(DN.Store.getMeta('lastMergeAt'))) + '</p>\
        </div>\
      </div>';
    renderPlan();
    renderCloud();
    container.querySelector('#syPcFile').addEventListener('click', function () {
      const f = buildPcFile();
      saveFile(f.filename, f.obj).then(function (done) {
        if (done) toast('“' + f.filename + '” 파일을 만들었어요. 핸드폰으로 옮겨 [일정 받기]로 여세요.', 'success');
      });
    });
    container.querySelector('#syPick').addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      readFile(file).then(function (text) {
        const r = parseFile(text, 'mobile');
        if (r.error) { toast(r.error, 'error'); pending = null; renderPlan(); return; }
        pending = { name: file.name, obj: r.obj, plan: planPhoneMerge(r.obj) };
        renderPlan();
      }, function (err) { toast(err.message, 'error'); });
    });
  }
  // ── 구글 드라이브 자동 동기화 카드 ──
  function renderCloud() {
    const box = rootEl && rootEl.querySelector('#syCloud');
    if (!box || !DN.Cloud) return;
    const C = DN.Cloud;
    box.innerHTML = '<div class="side-head"><h2 class="side-title">☁️ 구글 드라이브 자동 동기화</h2>' +
      (C.linked() ? '<span class="cloud-on">연결됨</span>' : '') + '</div>' +
      (C.linked()
        ? '<p class="cloud-acct">' + esc(C.account() || '구글 계정') + '</p><p class="set-help" style="margin-top:0">' + esc(C.statusText()) + '</p>' +
          (C.otherPc() ? '<p class="notice small">💻 다른 PC가 주 PC예요. 이 PC는 핸드폰 기록을 받기만 하고, 핸드폰에는 일정을 보내지 않아요. ' +
            '<button class="btn-ghost" id="cloudTake">이 PC를 주 PC로</button></p>' : '') +
          '<div class="pv-bar"><button class="btn-primary" id="cloudSync"' + (C.isBusy() ? ' disabled' : '') + '>지금 동기화</button>' +
          '<span class="pv-spacer"></span><button class="btn-cancel" id="cloudOff">연결 끊기</button></div>'
        : '<ul class="sync-list">' +
            '<li>핸드폰과 PC를 <b>같은 구글 계정</b>으로 한 번씩 연결하면, 핸드폰 기록이 PC로 저절로 들어와요. 파일을 옮길 필요가 없어요.</li>' +
            '<li>기록은 선생님 드라이브의 <b>앱 전용 숨김 폴더</b>에만 저장돼요. 드라이브의 다른 파일은 보지 않아요.</li>' +
            '<li>학생 이름·담당 교직원 이름·메모·첨부는 <b>올라가지 않아요</b> (번호로만).</li>' +
          '</ul><button class="btn-primary" id="cloudOn">구글로 연결</button>');
    const on = box.querySelector('#cloudOn');
    if (on) on.addEventListener('click', function () { C.connect().then(renderCloud); });
    const s = box.querySelector('#cloudSync');
    if (s) s.addEventListener('click', function () { C.sync(true).then(function () { if (rootEl && rootEl.isConnected) renderCloud(); }); });
    const take = box.querySelector('#cloudTake');
    if (take) take.addEventListener('click', function () { C.askTakeover().then(function () { if (rootEl && rootEl.isConnected) renderCloud(); }); });
    const off = box.querySelector('#cloudOff');
    if (off) off.addEventListener('click', function () {
      if (!DN.utils.confirmAsk('구글 드라이브 연결을 끊을까요? 이 PC의 기록은 그대로 남아요.')) return;
      C.disconnect().then(function () { renderCloud(); toast('연결을 끊었어요.', 'info'); });
    });
  }

  function renderPlan() {
    const box = rootEl && rootEl.querySelector('#syPlan');
    if (!box) return;
    if (!pending) { box.innerHTML = ''; return; }
    const o = pending.obj;
    box.innerHTML = '<div class="sync-plan">' +
      '<div class="sync-file">📄 ' + esc(pending.name) + ' <small>(' + esc(fmt(o.createdAt)) + ' 핸드폰에서 만듦)</small></div>' +
      '<p class="pv-sum">' + esc(planText(pending.plan)) + '</p>' +
      '<div class="sync-actions"><button class="btn-cancel" id="syCancel">취소</button><button class="btn-primary" id="syMerge">합치기</button></div></div>';
    box.querySelector('#syCancel').addEventListener('click', function () { pending = null; renderPlan(); });
    box.querySelector('#syMerge').addEventListener('click', function () {
      const res = applyPhoneMerge(pending.obj);
      if (!res) { toast('저장 공간이 부족해 합치지 못했어요. 기존 기록은 그대로예요.', 'error'); return; }
      toast('합쳤어요: ' + planText(res), 'success');
      pending = null;
      render(rootEl);
    });
  }

  return {
    render, deviceId, parseFile, mergeList,
    buildPhoneFile, markSent, planPhoneMerge, applyPhoneMerge, planText,
    buildPcFile, planPcReceive, applyPcReceive, cleanupSent,
    sendFromPhone, receiveOnPhone,
  };
})();
