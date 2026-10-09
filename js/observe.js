// ════════════════════════════════════════════════════
//  담임노트+ · 관찰 기록 화면 (DN.Observe) — 명세 §7.3
//  빠른 기록(번호 → 상황 클릭) · 학생별 보기(기간·상황별 개수·메모) · 복사 · 상황 버튼 편집
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Observe = (function () {
  const { esc, toast, confirmAsk, openModal, closeModal, copyText, today } = DN.utils;
  const R = DN.Records;
  const PERIODS = [
    { id: 'month', t: '이번 달' }, { id: 'term', t: '이번 학기' }, { id: 'year', t: '올해 학년도' },
    { id: 'all', t: '전체' }, { id: 'custom', t: '직접 선택' },
  ];

  let rootEl = null;
  const state = {
    date: today(),
    selected: new Set(),
    memo: '',
    memoOpen: false,
    period: 'term',
    from: '', to: '',
    student: null,
    last: null,          // 방금 저장한 묶음 { ids, text } — 되돌리기용
    cls: '',             // '' = 우리 반(담임), 그 밖은 수업 반 id
  };

  function md(d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8)); }
  function range() {
    const t = today();
    if (state.period === 'month') return { from: t.slice(0, 7) + '-01', to: R.monthRange(t.slice(0, 7)).to };
    if (state.period === 'term') return R.termRange(t);
    if (state.period === 'year') return R.termRange(t, 'year');
    if (state.period === 'custom') return { from: state.from, to: state.to };
    return { from: '', to: '' };
  }

  function render(container) {
    rootEl = container;
    const subject = DN.Settings.isSubject();
    // 교과전담: 고른 반이 없으면 첫 반으로. 담임: 언제나 우리 반
    if (!subject) state.cls = '';
    else if (!R.getClass(state.cls)) state.cls = (R.classes()[0] || {}).id || '';
    if (subject && !state.cls) {
      container.innerHTML = '<div class="page-head"><h1>📝 관찰 기록</h1></div>' +
        '<div class="card cls-empty"><div class="cls-empty-ic">📚</div><h2>맡은 반을 먼저 등록해 주세요</h2>' +
        '<p class="set-help">예: 3-1 과학 24명, 3-2 과학 25명… 반을 등록하면 반마다 번호를 눌러 수업 관찰을 남길 수 있어요.</p>' +
        '<button class="btn-primary" id="obClsFirst">＋ 반 등록하기</button></div>';
      container.querySelector('#obClsFirst').addEventListener('click', openClassEditor);
      return;
    }
    container.innerHTML = '\
      <div class="page-head"><h1>📝 관찰 기록</h1><span class="pv-spacer"></span>\
        <button class="btn-ghost" id="obPresets">상황 버튼 편집</button></div>\
      ' + (subject ? '<div class="cls-bar" id="obCls">' + clsBarHtml() + '</div>' : '') + '\
      <div class="card quick">\
        <div class="quick-head">\
          <h2 class="side-title">빠른 기록' + (state.cls ? ' <span class="cls-tag">' + esc(R.className(state.cls)) + '</span>' : '') + '</h2>\
          <label class="quick-date">날짜 <input type="date" id="obDate" value="' + esc(state.date) + '"></label>\
          <span class="quick-help">① 번호를 고르고 ② 상황을 누르면 바로 저장돼요.</span>\
        </div>\
        <div id="obPicker"></div>\
        <div class="quick-memo">' +
          (state.memoOpen
            ? '<textarea id="obMemo" rows="2" placeholder="이번에 저장할 기록에 함께 남길 메모 (선택)">' + esc(state.memo) + '</textarea>'
            : '<button type="button" class="pv-addend" id="obMemoOpen">+ 메모 덧붙이기</button>') + '\
        </div>\
        <div id="obPresetBtns" class="preset-groups"></div>\
        <div class="free-row"><span class="preset-gname">직접</span>\
          <input type="text" id="obFree" maxlength="60" placeholder="버튼에 없는 내용 직접 쓰기 (예: 7번 학생을 때림 / 활동 후 뒷정리를 잘함)">\
          <button class="btn-secondary" id="obFreeSave">저장</button></div>\
        <div id="obLast" class="last-save"></div>\
      </div>\
      <div class="ob-grid">\
        <div class="card"><div class="side-head"><h2 class="side-title">' + (state.cls ? esc(R.className(state.cls)) + ' 학생별' : '학생별 기록') + '</h2><button class="btn-secondary side-add" id="obCsv" title="고른 기간의 모든 학생 관찰 기록을 엑셀 파일로 받아요">📥 엑셀로 받기</button></div>\
          <div class="period-bar" id="obPeriod"></div><div id="obStudents"></div></div>\
        <div class="card" id="obDetail"></div>\
      </div>';

    const pick = container.querySelector('#obPicker');
    pick.innerHTML = DN.Picker.html(state.selected, { cls: state.cls });
    DN.Picker.bind(pick, state.selected);
    renderPresetButtons();
    renderLast();
    renderPeriod();
    renderStudents();
    renderDetail();

    container.querySelector('#obDate').addEventListener('change', function (e) { state.date = e.target.value || today(); });
    const memoOpen = container.querySelector('#obMemoOpen');
    if (memoOpen) memoOpen.addEventListener('click', function () { state.memoOpen = true; render(container); container.querySelector('#obMemo').focus(); });
    const memo = container.querySelector('#obMemo');
    if (memo) memo.addEventListener('input', function () { state.memo = memo.value; });
    container.querySelector('#obPresets').addEventListener('click', openPresetEditor);
    container.querySelector('#obCsv').addEventListener('click', exportCsv);
    const free = container.querySelector('#obFree');
    free.value = state.free || '';
    free.addEventListener('input', function () { state.free = free.value; });
    free.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) recordFree(); });
    container.querySelector('#obFreeSave').addEventListener('click', recordFree);
    const clsBar = container.querySelector('#obCls');
    if (clsBar) clsBar.addEventListener('click', function (e) {
      if (e.target.closest('#obClsEdit')) { openClassEditor(); return; }
      const b = e.target.closest('[data-cls]');
      if (!b || b.dataset.cls === state.cls) return;
      state.cls = b.dataset.cls;
      state.selected.clear(); state.student = null; state.last = null;
      render(container);
    });
  }

  // ── 우리 반 / 수업 반 고르기 ──
  function clsBarHtml() {
    return R.classes().map(function (c) {
        return '<button class="cls-chip" data-cls="' + esc(c.id) + '" aria-pressed="' + (state.cls === c.id) + '">📚 ' + esc(c.name) +
          (c.subject ? ' <small>' + esc(c.subject) + '</small>' : '') + '</button>';
      }).join('') +
      '<button class="btn-ghost cls-edit" id="obClsEdit">＋ 반 관리</button>';
  }

  // 수업 반 등록·고치기 (이름·과목·학생 수, 명단 붙여넣기)
  function openClassEditor() {
    const draw = function () {
      const list = R.classes();
      return '<p class="set-help" style="margin-top:0">수업에 들어가는 반을 등록하면, 관찰 기록에서 반을 골라 수업 관찰을 남길 수 있어요. 핸드폰에도 똑같이 들어가요.</p>' +
        (list.length ? list.map(function (c) {
          const n = Object.keys(R.classNameMap(c.id)).length;
          return '<div class="ce-row" data-id="' + esc(c.id) + '">' +
            '<input class="ce-name" maxlength="20" value="' + esc(c.name) + '" aria-label="반 이름">' +
            '<input class="ce-subj" maxlength="20" value="' + esc(c.subject || '') + '" placeholder="과목" aria-label="과목">' +
            '<input class="ce-count" type="number" min="1" max="60" value="' + esc(c.count) + '" aria-label="학생 수"><span class="ce-unit">명</span>' +
            '<button class="btn-ghost ce-names" data-names="' + esc(c.id) + '">명단' + (n ? ' ' + n + '명' : '') + '</button>' +
            '<button class="ic del" data-rm="' + esc(c.id) + '" aria-label="반 지우기">✕</button></div>';
        }).join('') : '<p class="side-empty">아직 등록한 수업 반이 없어요.</p>') +
        '<div class="ce-add"><input id="ceName" maxlength="20" placeholder="반 (예: 3-1)"><input id="ceSubj" maxlength="20" placeholder="과목 (예: 과학)">' +
        '<input id="ceCount" type="number" min="1" max="60" value="25"><span class="ce-unit">명</span><button class="btn-secondary" id="ceAdd">추가</button></div>' +
        '<p class="set-help">명단(이름)은 이 PC에만 저장되고 구글 드라이브에는 올라가지 않아요. 번호만으로도 쓸 수 있어요.</p>';
    };
    const m = openModal('맡은 반 관리', '<div id="ceBox">' + draw() + '</div>', '<span class="pv-spacer"></span><button class="btn-primary" data-close>완료</button>');
    const box = m.querySelector('#ceBox');
    const redraw = function () { box.innerHTML = draw(); };
    box.addEventListener('change', function (e) {
      const row = e.target.closest('.ce-row');
      if (!row) return;
      if (e.target.classList.contains('ce-name')) { if (e.target.value.trim()) R.updateClass(row.dataset.id, { name: e.target.value }); else redraw(); }
      if (e.target.classList.contains('ce-subj')) R.updateClass(row.dataset.id, { subject: e.target.value });
      if (e.target.classList.contains('ce-count')) R.updateClass(row.dataset.id, { count: e.target.value });
    });
    box.addEventListener('click', function (e) {
      const rm = e.target.closest('[data-rm]'), nm = e.target.closest('[data-names]');
      if (rm) {
        if (!confirmAsk('이 반을 목록에서 지울까요? 이미 남긴 관찰 기록은 백업 파일에 그대로 남아요.')) return;
        R.removeClass(rm.dataset.rm); redraw(); return;
      }
      if (nm) { openNames(nm.dataset.names, redraw); return; }
      if (e.target.id === 'ceAdd') {
        const name = box.querySelector('#ceName').value.trim();
        if (!name) { toast('반 이름을 써 주세요 (예: 3-1).', 'info'); return; }
        R.addClass(name, box.querySelector('#ceCount').value, box.querySelector('#ceSubj').value);
        redraw();
        box.querySelector('#ceName').focus();
      }
    });
    m.addEventListener('click', function (e) { if (e.target.closest('[data-close]') && rootEl && rootEl.isConnected) render(rootEl); });
  }
  function openNames(id, after) {
    const cur = R.classNameMap(id);
    const text = Object.keys(cur).sort(function (a, b) { return a - b; }).map(function (k) { return k + '\t' + cur[k]; }).join('\n');
    const back = document.getElementById('dnModal');
    const box = document.createElement('div');
    box.className = 'ce-names-box';
    box.innerHTML = '<div class="section-label">' + esc(R.className(id)) + ' 명단</div>' +
      '<p class="set-help" style="margin-top:0">엑셀에서 <b>번호·이름</b> 두 칸을 복사해 붙여 넣으세요. 한 줄에 한 명 (예: 5 홍길동).</p>' +
      '<textarea rows="8" class="ce-ta">' + esc(text) + '</textarea>' +
      '<div class="set-actions"><button class="btn-cancel" data-nc>취소</button><button class="btn-primary" data-ns>명단 저장</button></div>';
    const body = back.querySelector('.modal-body');
    body.appendChild(box);
    box.querySelector('textarea').focus();
    box.addEventListener('click', function (e) {
      if (e.target.closest('[data-nc]')) { box.remove(); return; }
      if (e.target.closest('[data-ns]')) {
        const n = R.setClassNames(id, box.querySelector('textarea').value);
        toast(n + '명 명단을 저장했어요.', 'success');
        box.remove();
        after();
      }
    });
  }

  // ── 빠른 기록 ──
  function renderPresetButtons() {
    const box = rootEl.querySelector('#obPresetBtns');
    const groups = R.presetGroups();
    box.innerHTML = groups.length ? groups.map(function (g) {
      return '<div class="preset-group"><span class="preset-gname">' + esc(g.name) + '</span>' +
        g.items.map(function (p) { return '<button class="preset-btn" data-preset="' + esc(p.id) + '">' + esc(p.label) + '</button>'; }).join('') +
        (!state.cls && g.items.some(function (p) { return R.isConflictLabel(p.label); }) ? '<p class="preset-tip">💡 다툰 친구들을 함께 고르고 누르면 자리·모둠에서 떼어 놓도록 추천해요</p>' : '') + '</div>';
    }).join('') : '<p class="side-empty">상황 버튼이 없어요. [상황 버튼 편집]에서 추가해 주세요.</p>';
    box.addEventListener('click', function (e) {
      const b = e.target.closest('[data-preset]');
      if (b) record(b.dataset.preset);
    });
  }

  function record(presetId) {
    const p = R.presets().find(function (x) { return x.id === presetId; });
    if (p) save(p.label, function (nos) { return R.addObservations(state.date, nos, p, state.memoOpen ? state.memo.trim() : '', state.cls); });
  }
  function recordFree() {
    const t = (state.free || '').trim();
    if (!t) { toast('내용을 써 주세요.', 'info'); rootEl.querySelector('#obFree').focus(); return; }
    save(t, function (nos) { return R.addFreeObservations(state.date, nos, t, state.cls); }, true);
  }
  function save(label, add, isFree) {
    if (!state.selected.size) { toast('먼저 학생 번호를 골라 주세요.', 'info'); return; }
    if (!DN.Events.isDate(state.date)) { toast('날짜를 확인해 주세요.', 'error'); return; }
    const nos = Array.from(state.selected).sort(function (a, b) { return a - b; });
    const saved = add(nos);
    if (!saved.length) { toast('저장하지 못했어요. 저장 공간을 확인해 주세요.', 'error'); return; }
    if (isFree) state.free = '';
    const text = (state.cls ? R.className(state.cls) + ' ' : '') + DN.Picker.listText(nos) + ' · ' + label;
    state.last = { ids: saved.map(function (r) { return r.id; }), text: text + (state.date !== today() ? ' (' + md(state.date) + ')' : '') };
    toast(text + ' 저장됨', 'success');
    state.selected.clear();
    state.memo = '';
    state.memoOpen = false;
    if (nos.length === 1) state.student = nos[0];
    render(rootEl);
  }

  function renderLast() {
    const box = rootEl.querySelector('#obLast');
    if (!state.last) { box.innerHTML = ''; return; }
    box.innerHTML = '<span>방금 저장: ' + esc(state.last.text) + '</span><button class="btn-ghost" id="obUndo">되돌리기</button>';
    box.querySelector('#obUndo').addEventListener('click', function () {
      R.removeRecords(R.OBS, state.last.ids);
      toast('방금 기록을 되돌렸어요.', 'info');
      state.last = null;
      render(rootEl);
    });
  }

  // ── 학생별 보기 ──
  function renderPeriod() {
    const box = rootEl.querySelector('#obPeriod');
    box.innerHTML = '<span class="seg">' + PERIODS.map(function (p) {
      return '<button data-period="' + p.id + '" aria-pressed="' + (state.period === p.id) + '">' + p.t + '</button>';
    }).join('') + '</span>' +
      (state.period === 'custom'
        ? '<span class="frow-in"><input type="date" id="obFrom" value="' + esc(state.from) + '"> ~ <input type="date" id="obTo" value="' + esc(state.to) + '"></span>'
        : '<span class="period-text">' + esc(periodText()) + '</span>');
    box.addEventListener('click', function (e) {
      const b = e.target.closest('[data-period]');
      if (!b) return;
      state.period = b.dataset.period;
      if (state.period === 'custom' && !state.from) { const r = R.termRange(today()); state.from = r.from; state.to = today(); }
      render(rootEl);
    });
    ['#obFrom', '#obTo'].forEach(function (sel) {
      const el = box.querySelector(sel);
      if (el) el.addEventListener('change', function () {
        state[sel === '#obFrom' ? 'from' : 'to'] = el.value;
        renderStudents();
        renderDetail();
      });
    });
  }
  // 고른 기간의 관찰 기록 전체 → CSV (엑셀에서 한글이 깨지지 않도록 BOM)
  function exportCsv() {
    const r = range();
    const rows = R.observationRows(r.from, r.to, null, state.cls);
    if (rows.length < 2) { toast('이 기간에 관찰 기록이 없어요.', 'info'); return; }
    const name = (state.cls ? R.className(state.cls).replace(/\s+/g, '_') + '_수업관찰_' : '관찰기록_') + (r.from ? r.from + '~' + r.to : '전체') + '.csv';
    DN.Backup.download(name, R.toCsv(rows), 'text/csv;charset=utf-8');
    toast('관찰 기록 ' + (rows.length - 1) + '건을 엑셀 파일로 받았어요.', 'success');
  }

  function periodText() {
    const r = range();
    return r.from ? md(r.from) + ' ~ ' + md(r.to) : '처음부터 지금까지';
  }

  function renderStudents() {
    const r = range();
    const list = R.observations(r.from, r.to, state.cls);
    const counts = R.countByStudent(list);
    const names = R.nameMap(state.cls);
    const nos = R.studentNumbers(state.cls);
    const box = rootEl.querySelector('#obStudents');
    box.innerHTML = '<div class="stu-counts">' + nos.map(function (n) {
      const c = counts[n] || 0;
      return '<button class="stu-count' + (state.student === n ? ' on' : '') + (c ? '' : ' zero') + '" data-stu="' + n + '">' +
        '<span class="sc-no">' + n + '</span><span class="sc-name">' + esc(names[n] || n + '번') + '</span><span class="sc-c">' + c + '건</span></button>';
    }).join('') + '</div>' +
      '<p class="set-help">기간 안 기록 ' + list.length + '건 · 기록이 적은 학생은 흐리게 보여요. 누르면 오른쪽에 자세히 보여요.</p>';
    box.addEventListener('click', function (e) {
      const b = e.target.closest('[data-stu]');
      if (!b) return;
      state.student = +b.dataset.stu;
      box.querySelectorAll('.stu-count').forEach(function (x) { x.classList.toggle('on', +x.dataset.stu === state.student); });
      renderDetail();
    });
  }

  function renderDetail() {
    const box = rootEl.querySelector('#obDetail');
    if (!state.student) {
      box.innerHTML = '<p class="side-empty">왼쪽에서 학생을 고르면 관찰 기록이 보여요.</p>';
      return;
    }
    const no = state.student;
    const r = range();
    const names = R.nameMap(state.cls);
    const list = R.observations(r.from, r.to, state.cls).filter(function (x) { return x.studentNo === no; });
    const byLabel = R.countByLabel(list);
    box.innerHTML = '<div class="side-head"><h2 class="side-title">' + (state.cls ? esc(R.className(state.cls)) + ' ' : '') + esc(R.label(no, names)) + '</h2>' +
      '<button class="btn-secondary side-add" id="obCopy"' + (list.length ? '' : ' disabled') + '>📋 복사</button></div>' +
      '<p class="set-help">' + esc(periodText()) + ' · ' + list.length + '건</p>' +
      (byLabel.length ? '<div class="label-counts">' + byLabel.map(function (c) {
        return '<span class="lc">' + esc(c.label) + ' <b>' + c.count + '</b></span>';
      }).join('') + '</div>' : '') +
      (list.length ? '<div class="ob-list">' + list.slice().reverse().map(function (x) {
        return '<div class="ob-row"><span class="ob-date">' + esc(md(x.date)) + '</span>' +
          '<span class="ob-label">' + esc(x.label) +
            (x.with && x.with.length ? ' <small>· 함께 ' + esc(x.with.map(function (n) { return n + '번'; }).join(', ')) + '</small>' : '') + (x.device === 'mobile' ? ' <small title="핸드폰에서 기록">📱</small>' : '') + '</span>' +
          '<input class="ob-memo" data-memo="' + esc(x.id) + '" value="' + esc(x.memo || '') + '" placeholder="메모">' +
          '<button class="ic del" data-del="' + esc(x.id) + '" aria-label="기록 삭제">✕</button></div>';
      }).join('') + '</div>' : '<p class="side-empty">이 기간에 기록이 없어요.</p>');

    const copy = box.querySelector('#obCopy');
    copy.addEventListener('click', function () {
      copyText(R.copyText(no, r.from, r.to, names, state.cls)).then(function (ok) {
        toast(ok ? '복사했어요. 한글에 붙여 넣어 ' + (state.cls ? '교과 평가' : '통지표') + ' 작성에 참고하세요.' : '복사하지 못했어요.', ok ? 'success' : 'error');
      });
    });
    box.querySelectorAll('[data-memo]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        R.updateObservation(inp.dataset.memo, { memo: inp.value.trim() });
        toast('메모를 저장했어요.', 'success');
      });
    });
    box.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirmAsk('이 관찰 기록을 지울까요?')) return;
        R.removeRecords(R.OBS, [b.dataset.del]);
        renderStudents();
        renderDetail();
      });
    });
  }

  // ── 상황 버튼 편집 ──
  function openPresetEditor() {
    const draw = function (m) {
      const groups = R.presetGroups();
      m.querySelector('#peList').innerHTML = groups.map(function (g) {
        return '<div class="pe-group"><div class="pe-gname">' + esc(g.name) + '</div>' + g.items.map(function (p, i) {
          return '<div class="pe-row">' +
            '<input value="' + esc(p.label) + '" data-plabel="' + esc(p.id) + '" aria-label="버튼 문구">' +
            '<button class="ic" data-up="' + esc(p.id) + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="위로">▲</button>' +
            '<button class="ic" data-down="' + esc(p.id) + '"' + (i === g.items.length - 1 ? ' disabled' : '') + ' aria-label="아래로">▼</button>' +
            '<button class="ic del" data-pdel="' + esc(p.id) + '" aria-label="삭제">✕</button></div>';
        }).join('') + '</div>';
      }).join('') || '<p class="side-empty">버튼이 없어요.</p>';
      m.querySelector('#peGroupList').innerHTML = groups.map(function (g) { return '<option value="' + esc(g.name) + '">'; }).join('');
    };
    const body = '<p class="set-help" style="margin-top:0">문구는 <b>관찰된 행동</b>으로 적어 주세요(예: “발표·질문”, “친구 도움”). 문구를 바꿔도 이미 저장한 기록의 문구는 그대로예요.</p>' +
      '<div id="peList"></div>' +
      '<div class="section-label">새 버튼</div>' +
      '<div class="pe-new"><input id="peGroup" list="peGroupList" placeholder="무리 (예: 참여)"><datalist id="peGroupList"></datalist>' +
      '<input id="peLabel" placeholder="문구 (예: 질문에 끝까지 답함)"><button class="btn-primary" id="peAdd">추가</button></div>';
    const m = openModal('관찰 상황 버튼 편집', body, '<span class="pv-spacer"></span><button class="btn-primary" data-close>완료</button>');
    draw(m);
    m.querySelector('#peList').addEventListener('change', function (e) {
      const inp = e.target.closest('[data-plabel]');
      if (!inp) return;
      const v = inp.value.trim();
      if (!v) { toast('문구를 비울 수 없어요.', 'error'); draw(m); return; }
      R.updatePreset(inp.dataset.plabel, { label: v });
    });
    m.querySelector('#peList').addEventListener('click', function (e) {
      const up = e.target.closest('[data-up]'), down = e.target.closest('[data-down]'), del = e.target.closest('[data-pdel]');
      if (up) { R.movePreset(up.dataset.up, -1); draw(m); }
      if (down) { R.movePreset(down.dataset.down, 1); draw(m); }
      if (del && confirmAsk('이 버튼을 지울까요? 이미 저장한 기록은 그대로 남아요.')) { R.removePreset(del.dataset.pdel); draw(m); }
    });
    m.querySelector('#peAdd').addEventListener('click', function () {
      const label = m.querySelector('#peLabel').value.trim();
      if (!label) { toast('문구를 입력해 주세요.', 'error'); return; }
      R.addPreset(m.querySelector('#peGroup').value, label);
      m.querySelector('#peLabel').value = '';
      draw(m);
    });
    // 창을 닫으면 빠른 기록 버튼에 반영
    m.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) render(rootEl); });
  }

  return { render, closeModal };
})();
