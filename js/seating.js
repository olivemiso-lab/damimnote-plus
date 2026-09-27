// ════════════════════════════════════════════════════
//  담임노트+ · 자리·모둠 배치 화면 (DN.Seating)
//  모둠 좌석 교실: 모둠 편성이 곧 자리 배치. 기존 담임노트+ v1.0.0 화면을 옮겨 온 것
//  조건 고르기 → 자동 배치 → (학생 눌러 바꾸기·옮기기) → 저장·인쇄, 저장한 배치는 “이전 조합 피하기”에 쓰인다
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Seating = (function () {
  const { esc, toast, confirmAsk, today } = DN.utils;
  const A = DN.Arranger;
  const R = DN.Records;
  const HIST = 'seatings';

  let rootEl = null;
  let current = null;   // { groups, swapTarget, meta, opts } — 다른 메뉴에 다녀와도 유지
  const form = { mode: 'num', numGroups: 6, perGroup: 4, level: true, leader: true, risk: true, gender: true, body: true, avoidHistory: true };

  // 배치할 학생: 1 ~ 학생 수(설정)까지 번호마다 한 명. 명단에 있으면 그 학생(학습수준·성별 등 반영),
  // 없으면 번호만 있는 학생으로. 번호 없이 명단에만 있는 학생은 뒤에 붙인다.
  function roster() {
    const all = DN.Store.getAll('students');
    const byNo = {};
    all.forEach(function (s) { const n = parseInt(s.number, 10); if (n && !byNo[n]) byNo[n] = s; });
    const list = R.studentNumbers().map(function (n) {
      return byNo[n] || { id: 'no:' + n, number: String(n), name: '', gender: 'none' };
    });
    all.forEach(function (s) { if (list.indexOf(s) < 0) list.push(s); });
    return list;
  }
  function students() { return roster(); }
  function history() {
    return DN.Store.getAll(HIST).slice().sort(function (a, b) { return (b.createdAt || '') > (a.createdAt || '') ? 1 : -1; });
  }
  function groupCount() {
    const n = students().length;
    return form.mode === 'per' ? Math.max(2, Math.ceil(n / (form.perGroup || 4))) : form.numGroups;
  }
  function hintText() {
    const n = students().length, g = groupCount();
    if (g < 2 || g > n) return '모둠 수는 2 ~ ' + n + ' 사이여야 해요';
    const base = Math.floor(n / g), rem = n % g;
    return '→ ' + (rem === 0 ? g + '모둠 × ' + base + '명' : g + '모둠 · ' + base + '~' + (base + 1) + '명씩');
  }
  function cond(key, label) {
    return '<label class="check-label"><input type="checkbox" data-opt="' + key + '"' + (form[key] ? ' checked' : '') + '><span>' + label + '</span></label>';
  }

  function render(container) {
    rootEl = container;
    const list = students();
    const named = DN.Store.getAll('students').length;
    container.innerHTML = '\
      <div class="page-head"><h1>🪑 자리·모둠 배치</h1><span class="count-chip">' + list.length + '명</span></div>\
      <div class="card seat-card">\
        <h2 class="side-title">⚙️ 배치 조건</h2>\
        <div class="seat-row">\
          <label class="quick-date">우리 반 학생 수 <input type="number" id="stCount" min="2" max="60" value="' + esc(DN.Settings.get().studentCount) + '" style="width:70px"> 명</label>\
          <span class="set-help" style="margin:0">' + (named
            ? '명단 ' + named + '명의 특성을 반영하고, 명단에 없는 번호는 번호로 배치해요.'
            : '명단을 입력하지 않아도 번호로 배치돼요. 👦 학생 관리에 이름·특성을 적으면 함께 반영해요.') + '</span>\
        </div>\
        <div class="seat-row">\
          <span class="seg" id="stMode"><button data-mode="num" aria-pressed="' + (form.mode === 'num') + '">모둠 수</button><button data-mode="per" aria-pressed="' + (form.mode === 'per') + '">모둠당 인원</button></span>' +
          (form.mode === 'num'
            ? '<label class="quick-date"><input type="number" id="stNum" min="2" max="10" value="' + form.numGroups + '" style="width:70px"> 모둠</label>'
            : '<label class="quick-date">모둠당 <input type="number" id="stPer" min="2" max="8" value="' + form.perGroup + '" style="width:70px"> 명</label>') + '\
          <span class="seat-hint" id="stHint">' + esc(hintText()) + '</span>\
        </div>\
        <div class="check-grid seat-conds">' +
          cond('level', '📚 학습수준 고르게') + cond('leader', '👑 리더 나누기') + cond('risk', '⚠️ 갈등·산만 나누기') +
          cond('gender', '🧑‍🤝‍🧑 남녀 고르게') + cond('body', '👓 시력·키(앞·뒤 자리) 고려') + cond('avoidHistory', '🔄 저장한 이전 조합 피하기') + '\
        </div>\
        <button class="btn-primary seat-run" id="stRun">🎲 자동 배치</button>\
      </div>\
      <div class="card seat-card"><details id="stRelBox"><summary class="seat-sum">⚔️🤝 갈등 관계 · 필수 동행 설정 <small>(' + relSummary() + ')</small></summary>\
        <div id="stRel" class="rel-editor"></div></details></div>\
      <div id="stResult"></div>\
      <div class="card seat-card"><div class="side-head"><h2 class="side-title">📅 저장한 배치</h2>' +
        (history().length ? '<button class="btn-cancel danger side-add" id="stClear">모두 지우기</button>' : '') + '</div><div id="stHist"></div></div>';

    A.renderRelationEditor(container.querySelector('#stRel'), list);
    renderResult();
    renderHistory();
    bind(container);
  }

  function relSummary() {
    const r = A.getRelations();
    return '갈등 ' + r.conflicts.length + '쌍 · 동행 ' + r.friends.length + '쌍';
  }

  function bind(c) {
    c.querySelector('#stCount').addEventListener('change', function (e) {
      const n = Math.min(60, Math.max(2, parseInt(e.target.value, 10) || 0));
      DN.Settings.save({ studentCount: n });
      current = null;   // 인원이 바뀌면 이전 배치 결과는 맞지 않으므로 지운다
      toast('학생 수를 ' + n + '명으로 저장했어요.', 'success');
      render(c);
    });
    c.querySelector('#stMode').addEventListener('click', function (e) {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      form.mode = b.dataset.mode;
      render(c);
    });
    const num = c.querySelector('#stNum'), per = c.querySelector('#stPer');
    const onNum = function () {
      if (num) form.numGroups = parseInt(num.value, 10) || 0;
      if (per) form.perGroup = parseInt(per.value, 10) || 0;
      c.querySelector('#stHint').textContent = hintText();
    };
    if (num) num.addEventListener('input', onNum);
    if (per) per.addEventListener('input', onNum);
    c.querySelectorAll('[data-opt]').forEach(function (cb) {
      cb.addEventListener('change', function () { form[cb.dataset.opt] = cb.checked; });
    });
    c.querySelector('#stRun').addEventListener('click', run);
    // 관계를 바꾸면 요약 숫자만 새로 고침
    c.querySelector('#stRel').addEventListener('click', function () {
      setTimeout(function () { const s = c.querySelector('.seat-sum small'); if (s) s.textContent = '(' + relSummary() + ')'; }, 0);
    });
    const clear = c.querySelector('#stClear');
    if (clear) clear.addEventListener('click', function () {
      if (!confirmAsk('저장한 배치를 모두 지울까요? “이전 조합 피하기”에 쓸 기록도 함께 사라져요.')) return;
      DN.Store.replaceAll(HIST, []);
      toast('저장한 배치를 모두 지웠어요.', 'success');
      render(c);
    });
  }

  function run() {
    const list = students();
    const g = groupCount();
    if (!(g >= 2 && g <= list.length)) { toast('모둠 수는 2 ~ ' + list.length + ' 사이여야 해요.', 'error'); return; }
    const opts = { numGroups: g, level: form.level, leader: form.leader, risk: form.risk, gender: form.gender, body: form.body, avoidHistory: form.avoidHistory };
    const result = A.arrange(list, opts, history());
    current = { groups: result.groups, swapTarget: null, meta: result, opts: opts };
    renderResult();
    toast('배치했어요! 학생을 눌러 바꿀 수 있어요.', 'success');
  }

  function renderResult() {
    const box = rootEl.querySelector('#stResult');
    if (!current) { box.innerHTML = ''; return; }
    const m = current.meta;
    let banner = '';
    if (m.violationCount > 0) banner += '<p class="pv-warn">⚠️ 갈등 관계 ' + m.violationCount + '쌍을 다 떼어 놓지 못했어요. [다시 배치]를 눌러 보세요.</p>';
    if (m.friendViolationCount > 0) banner += '<p class="pv-warn">⚠️ 필수 동행 ' + m.friendViolationCount + '쌍을 같은 모둠에 넣지 못했어요.</p>';
    if (m.imbalance > 1) banner += '<p class="pv-warn">모둠끼리 인원이 ' + m.imbalance + '명 차이 나요.</p>';
    box.innerHTML = '<div class="card seat-card">' + banner +
      '<p class="set-help seat-tip">✏️ 학생을 누르고 → 다른 모둠 학생을 누르면 서로 바꾸기 · 모둠 이름을 누르면 그 모둠으로 옮기기</p>' +
      '<div class="board-wrap">' + A.renderBoard(current.groups, current.swapTarget, true) + '</div>' +
      '<div class="pv-bar seat-actions"><span class="pv-spacer"></span>' +
      '<button class="btn-ghost" data-act="again">🔄 다시 배치</button>' +
      '<button class="btn-secondary" data-act="print">🖨️ 인쇄</button>' +
      '<button class="btn-primary" data-act="save">💾 이 배치 저장</button></div></div>';
    box.onclick = function (e) {
      const act = e.target.closest('[data-act]');
      if (act) { action(act.dataset.act); return; }
      const r = A.handleClick(current, e.target);
      if (r.toast) toast(r.toast, 'success');
      if (r.render) renderResult();
    };
  }

  function action(act) {
    if (act === 'again') { run(); return; }
    if (act === 'print') { A.print(current.groups, '자리·모둠 배치표'); return; }
    if (act === 'save') {
      DN.Store.add(HIST, { date: today(), groups: A.serialize(current.groups), conditions: current.opts });
      toast('이 배치를 저장했어요. 다음 배치 때 같은 조합을 피해요.', 'success');
      render(rootEl);
    }
  }

  function renderHistory() {
    const box = rootEl.querySelector('#stHist');
    const list = history();
    if (!list.length) { box.innerHTML = '<p class="side-empty">저장한 배치가 없어요. 배치 후 [이 배치 저장]을 누르면 여기에 쌓여요.</p>'; return; }
    box.innerHTML = list.map(function (e, i) {
      return '<div class="hist-item"><div class="hist-meta"><b>' + (list.length - i) + '회차</b><span class="set-help" style="margin:0">' + esc(e.date || '') + '</span>' +
        '<span class="pv-spacer"></span><button class="ic" data-hprint="' + esc(e.id) + '" aria-label="인쇄">🖨️</button>' +
        '<button class="ic del" data-hdel="' + esc(e.id) + '" aria-label="지우기">✕</button></div>' +
        '<div class="hist-groups">' + (e.groups || []).map(function (g) {
          const c = A.COLORS[(g.color || 0) % A.COLORS.length];
          return '<div class="hist-g"><span class="hist-gid" style="background:' + c[0] + ';color:' + c[2] + '">' + g.id + '모둠</span> ' + (g.names || []).map(esc).join(' · ') + '</div>';
        }).join('') + '</div></div>';
    }).join('');
    box.onclick = function (ev) {
      const del = ev.target.closest('[data-hdel]');
      if (del) {
        if (!confirmAsk('이 배치 기록을 지울까요?')) return;
        DN.Store.remove(HIST, del.dataset.hdel);
        render(rootEl);
        return;
      }
      const pr = ev.target.closest('[data-hprint]');
      if (pr) {
        const entry = DN.Store.get(HIST, pr.dataset.hprint);
        if (!entry) return;
        const all = students();
        const groups = (entry.groups || []).map(function (g) {
          return { id: g.id, color: g.color || 0, members: (g.memberIds || []).map(function (id, idx) {
            return all.find(function (s) { return s.id === id; }) || { id: id, name: (g.names || [])[idx] || '(지운 학생)' };
          }) };
        });
        A.print(groups, '자리·모둠 배치표 (' + (entry.date || '') + ')');
      }
    };
  }

  return { render, roster, HIST };
})();
