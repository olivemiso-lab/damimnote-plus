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
    view: 'home',             // home | obs | att
    date: today(),
    selected: new Set(),
    memo: '', memoOpen: false,
    type: '', reason: '',
    undo: null,               // { col, ids, text }
  };
  let undoTimer = null;

  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installPrompt = e; });

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
  function md(d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8)); }
  function mdw(d) { return md(d) + '(' + E.weekdayOf(d) + ')'; }

  // ════════ 화면 ════════
  function render(root) {
    rootEl = root;
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
    else renderHome(body);

    root.querySelector('#mDate').addEventListener('change', function (e) {
      st.date = e.target.value || today();
      if (st.view === 'home') render(root);
    });
    root.querySelector('#mMenu').addEventListener('click', openMenu);
    const send = root.querySelector('#mSend');
    if (send) send.addEventListener('click', function () {
      send.disabled = true;
      DN.Sync.sendFromPhone().then(function () { render(root); });
    });
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
    const n = R.unsentCount();
    return '<div class="m-send"><span>PC로 보내지 않은 기록 <b>' + n + '</b>건</span>' +
      '<button class="btn-primary" id="mSend">PC로 보내기</button></div>';
  }

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
    bindInstall();
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

  // 홈 화면 추가 안내 (설치돼 있으면 표시 안 함)
  function installGuide() {
    if (standalone()) return '';
    if (isIOS()) {
      return '<div class="m-guide"><b>📲 홈 화면에 추가해 주세요</b>' +
        '<p>사파리 아래쪽 <b>공유 버튼(□↑)</b> → <b>홈 화면에 추가</b>를 누르세요.</p>' +
        '<p class="warn">⚠ 아이폰은 홈 화면에 추가하지 않고 쓰면, 한동안 열지 않았을 때 기록이 지워질 수 있어요.</p></div>';
    }
    return '<div class="m-guide"><b>📲 홈 화면에 추가하면 앱처럼 쓸 수 있어요</b>' +
      '<p>크롬 오른쪽 위 <b>⋮ 메뉴</b> → <b>홈 화면에 추가</b>(또는 앱 설치)를 누르세요.</p>' +
      '<button class="btn-secondary" id="mInstall"' + (installPrompt ? '' : ' hidden') + '>지금 설치하기</button></div>';
  }
  function bindInstall() {
    const b = rootEl.querySelector('#mInstall');
    if (!b) return;
    b.addEventListener('click', function () {
      if (!installPrompt) return;
      installPrompt.prompt();
      installPrompt = null;
      b.hidden = true;
    });
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
      (meta ? '<small>' + esc(meta) + '</small>' : '') + '</span></li>';
  }
  function renderHome(body) {
    const d = st.date;
    const list = myGradeEvents();
    const todays = E.onDate(list, d);
    const w = E.weekRange(d);
    const days = [];
    for (let x = w.start; x <= w.end; x = E.addDays(x, 1)) {
      const on = E.onDate(list, x).filter(function (e) { return e.date === x || x === w.start; });
      if (on.length) days.push({ d: x, list: on });
    }
    const grade = DN.Settings.get().grade;
    body.innerHTML =
      '<section class="m-card"><h2>' + (d === today() ? '오늘' : mdw(d)) + ' <small>' + (d === today() ? mdw(d) : '') + '</small></h2>' +
        (todays.length ? '<ul class="m-list">' + todays.map(evLine).join('') + '</ul>' : '<p class="m-empty">일정이 없어요.</p>') + '</section>' +
      '<div class="m-actions">' +
        '<button class="m-action obs" id="mGoObs"><span>📝</span>관찰 기록</button>' +
        '<button class="m-action att" id="mGoAtt"><span>🗓️</span>출결</button></div>' +
      '<section class="m-card"><h2>이번 주 ' + grade + '학년 일정 <small>' + md(w.start) + '~' + md(w.end) + '</small></h2>' +
        (days.length ? days.map(function (x) {
          const hol = x.list.some(function (e) { return e.kind === 'holiday'; });
          return '<div class="m-day"><div class="m-day-d' + (hol ? ' hol' : '') + (x.d === today() ? ' today' : '') + '">' + esc(mdw(x.d)) + '</div>' +
            '<ul class="m-list">' + x.list.map(evLine).join('') + '</ul></div>';
        }).join('') : '<p class="m-empty">이번 주 일정이 없어요. PC에서 [일정 보내기]로 받을 수 있어요.</p>') + '</section>';
    body.querySelector('#mGoObs').addEventListener('click', function () { go('obs'); });
    body.querySelector('#mGoAtt').addEventListener('click', function () { go('att'); });
    body.addEventListener('click', function (e) {
      const b = e.target.closest('[data-done]');
      if (!b) return;
      const ev = E.get(b.dataset.done);
      if (!ev) return;
      E.update(ev.id, { done: !ev.done });
      toast(ev.done ? '완료 표시를 풀었어요.' : '완료!', 'success');
      render(rootEl);
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
  }

  // ── 관찰 기록 ──
  function renderObs(body) {
    const groups = R.presetGroups();
    body.innerHTML = pickerSection() +
      '<section class="m-card"><h2>② 상황 누르기 <small>누르면 바로 저장돼요</small></h2>' +
      (groups.length ? groups.map(function (g) {
        return '<div class="m-preset-g"><div class="m-gname">' + esc(g.name) + '</div><div class="m-presets">' +
          g.items.map(function (p) { return '<button class="preset-btn" data-preset="' + esc(p.id) + '">' + esc(p.label) + '</button>'; }).join('') + '</div></div>';
      }).join('') : '<p class="m-empty">상황 버튼이 없어요. PC에서 [일정 보내기]를 받으면 PC의 버튼이 들어와요.</p>') +
      '<div class="m-memo">' + memoHtml('') + '</div></section>';
    bindCommon(body);
    body.querySelector('.m-card:last-child').addEventListener('click', function (e) {
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
      '<section class="m-card"><h2>② 유형 · 사유</h2>' + segHtml('type', R.TYPES) + segHtml('reason', R.REASONS) +
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
      '<div class="md-label">PC와 주고받기</div>' +
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
    const inst = m.querySelector('#mInstall');
    if (inst) inst.addEventListener('click', function () { if (installPrompt) { installPrompt.prompt(); installPrompt = null; inst.hidden = true; } });
    m.querySelector('#mnBackup').addEventListener('click', function () { DN.Backup.exportJson(); });
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
