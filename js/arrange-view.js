// ════════════════════════════════════════════════════
//  담임노트+ · 자리·모둠 배치 화면 (DN.Groups)
//  모둠 좌석 교실: 모둠 편성이 곧 자리 배치
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

(function () {
  const { esc, toast, fmtDate, confirmAsk } = DN.utils;
  const states = {}; // kind별 {groups, swapTarget}

  function build(container, cfg) {
    const students = DN.Store.getAll('students');
    container.innerHTML = `
      <div class="page-head"><h1>${cfg.title}</h1><span class="count-chip">${students.length}명</span></div>

      ${students.length < 2 ? `
        <div class="card placeholder">
          <div class="ph-icon">${cfg.icon}</div>
          <h2>학생을 먼저 등록해주세요</h2>
          <p class="desc">${cfg.label}을(를) 하려면 학생이 2명 이상 필요합니다.</p>
          <button class="btn-secondary" id="goStu">학생 관리로 가기</button>
        </div>` : `
        <div class="card">
          <h2>⚙️ 배치 조건</h2>
          <div class="frow">
            ${cfg.perGroupOption ? `
              <label class="radio"><input type="radio" name="gmode" value="num" checked> 모둠 수 지정</label>
              <label class="radio"><input type="radio" name="gmode" value="per"> 모둠당 인원</label>` : ''}
          </div>
          <div class="frow">
            <label>${cfg.perGroupOption ? '모둠 수' : '모둠(분단) 수'}</label>
            <input type="number" id="numG" min="2" max="10" value="4" style="width:80px">
            ${cfg.perGroupOption ? '<label class="per-wrap" style="display:none">모둠당 <input type="number" id="perG" min="2" max="8" value="4" style="width:70px"> 명</label>' : ''}
            <span class="hint-inline" id="groupHint"></span>
          </div>
          <div class="cond-grid">
            ${cond('c_level', '📚 학습수준 균형', true)}
            ${cond('c_leader', '👑 리더 분산', true)}
            ${cond('c_risk', '⚠️ 갈등·산만 분산', true)}
            ${cond('c_gender', '🧑‍🤝‍🧑 남녀 균형', true)}
            ${cond('c_body', '👓 시력·키 고려', cfg.bodyDefault)}
            ${cond('c_hist', '🔄 이전 조합 회피', cfg.histDefault)}
          </div>
          <button class="btn-primary full" id="runBtn">🎲 자동 ${cfg.label}</button>
        </div>

        <div class="card">
          <details ${'' /* 기본 닫힘 */}>
            <summary>⚔️🤝 갈등 관계 · 필수 동행 설정</summary>
            <div id="relEditor" class="rel-editor"></div>
          </details>
        </div>

        <div id="arrResult"></div>

        <div class="card" id="histCard">
          <div class="card-head"><h2>📅 ${cfg.label} 이력</h2><button class="btn-danger-sm" id="clrHist">전체 삭제</button></div>
          <div id="histList"></div>
        </div>`}
    `;

    if (students.length < 2) {
      const b = container.querySelector('#goStu');
      if (b) b.addEventListener('click', () => DN.App.go('students'));
      return;
    }

    DN.Arranger.renderRelationEditor(container.querySelector('#relEditor'));
    renderHistory(container, cfg);
    updateHint(container, cfg);

    // 모둠당 인원 토글
    if (cfg.perGroupOption) {
      container.querySelectorAll('input[name=gmode]').forEach(r => r.addEventListener('change', () => {
        const per = container.querySelector('input[name=gmode][value=per]').checked;
        container.querySelector('.per-wrap').style.display = per ? 'inline' : 'none';
        container.querySelector('#numG').parentElement.querySelector('label').style.opacity = per ? 0.4 : 1;
        updateHint(container, cfg);
      }));
      container.querySelector('#perG').addEventListener('input', () => updateHint(container, cfg));
    }
    container.querySelector('#numG').addEventListener('input', () => updateHint(container, cfg));
    container.querySelector('#runBtn').addEventListener('click', () => run(container, cfg));
    container.querySelector('#clrHist').addEventListener('click', () => {
      if (!confirmAsk('이력을 모두 삭제할까요?')) return;
      DN.Store.saveAll(cfg.coll, []);
      renderHistory(container, cfg);
      toast('이력이 삭제되었습니다.', 'info');
    });

    // 결과 영역 클릭 위임(교환/이동 + 저장/인쇄/다시배치)
    const result = container.querySelector('#arrResult');
    result.addEventListener('click', e => {
      const act = e.target.closest('[data-action]');
      if (act) { handleAction(act.dataset.action, container, cfg); return; }
      const st = states[cfg.kind];
      if (!st) return;
      const r = DN.Arranger.handleClick(st, e.target);
      if (r.toast) toast(r.toast, 'success');
      if (r.render) updateResult(container, cfg);
    });

    // 이전 결과 복원
    if (states[cfg.kind]) updateResult(container, cfg);
  }

  function cond(id, label, checked) {
    return `<label class="check-label"><input type="checkbox" id="${id}"${checked ? ' checked' : ''}><span>${label}</span></label>`;
  }

  function calcGroups(container, cfg) {
    const count = DN.Store.count('students');
    if (cfg.perGroupOption && container.querySelector('input[name=gmode][value=per]').checked) {
      const per = parseInt(container.querySelector('#perG').value) || 4;
      return Math.max(2, Math.ceil(count / per));
    }
    return parseInt(container.querySelector('#numG').value) || 4;
  }
  function updateHint(container, cfg) {
    const count = DN.Store.count('students');
    const n = calcGroups(container, cfg);
    const base = Math.floor(count / n), rem = count % n;
    const txt = rem === 0 ? `${n}모둠 × ${base}명` : `${n}모둠 · ${base}~${base + 1}명씩`;
    container.querySelector('#groupHint').textContent = `→ ${txt}`;
  }

  function readOpts(container, cfg) {
    return {
      numGroups: calcGroups(container, cfg),
      level: container.querySelector('#c_level').checked,
      leader: container.querySelector('#c_leader').checked,
      risk: container.querySelector('#c_risk').checked,
      gender: container.querySelector('#c_gender').checked,
      body: container.querySelector('#c_body').checked,
      avoidHistory: container.querySelector('#c_hist').checked,
      historyColl: cfg.coll,
    };
  }

  function run(container, cfg) {
    const students = DN.Store.getAll('students');
    const opts = readOpts(container, cfg);
    if (opts.numGroups < 2 || opts.numGroups > students.length) {
      toast(`모둠 수는 2 ~ ${students.length} 사이여야 합니다.`, 'error'); return;
    }
    const result = DN.Arranger.arrange(students, opts);
    states[cfg.kind] = { groups: result.groups, swapTarget: null, meta: result, opts };
    updateResult(container, cfg);
    toast('배치가 완료되었습니다!', 'success');
  }

  function updateResult(container, cfg) {
    const st = states[cfg.kind];
    const result = container.querySelector('#arrResult');
    if (!st) { result.innerHTML = ''; return; }
    const board = DN.Arranger.renderBoard(st.groups, st.swapTarget, true);

    // 상태 배너(최초 배치 meta 기준 + 현재 재계산은 생략, 안내 위주)
    const m = st.meta || {};
    let banner = '';
    if (m.violationCount > 0) banner += `<div class="banner warn">⚠️ 갈등 관계 ${m.violationCount}쌍을 완전히 분리하지 못했습니다. 다시 배치를 눌러보세요.</div>`;
    if (m.friendViolationCount > 0) banner += `<div class="banner warn">⚠️ 필수 동행 ${m.friendViolationCount}쌍을 같은 모둠에 넣지 못했습니다.</div>`;
    if (m.imbalance > 1) banner += `<div class="banner info">ℹ️ 모둠 간 인원 차이가 ${m.imbalance}명입니다.</div>`;
    banner += `<div class="banner tip">✏️ 학생 클릭 → 다른 학생 클릭: 교환 / 모둠 이름 클릭: 이동</div>`;

    result.innerHTML = `
      <div class="card">
        ${banner}
        <div class="board-wrap">${board}</div>
        <div class="result-actions">
          <button class="btn-primary" data-action="reshuffle">🔄 다시 배치</button>
          <button class="btn-save" data-action="save">💾 저장</button>
          <button class="btn-secondary" data-action="print">🖨️ 인쇄</button>
        </div>
      </div>`;
  }

  function handleAction(action, container, cfg) {
    const st = states[cfg.kind];
    if (!st) return;
    if (action === 'reshuffle') { run(container, cfg); return; }
    if (action === 'print') {
      DN.Arranger.print(st.groups, cfg.label + '표');
      return;
    }
    if (action === 'save') {
      DN.Store.add(cfg.coll, {
        date: fmtDate(DN.utils.nowISO()),
        groups: DN.Arranger.serialize(st.groups),
        conditions: st.opts || {},
        kind: cfg.kind,
      });
      renderHistory(container, cfg);
      toast('현재 배치를 이력에 저장했습니다!', 'success');
    }
  }

  function renderHistory(container, cfg) {
    const list = DN.Store.getAll(cfg.coll).sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    const box = container.querySelector('#histList');
    const card = container.querySelector('#histCard');
    if (!list.length) { box.innerHTML = '<p class="empty">저장된 이력이 없습니다.</p>'; return; }
    box.innerHTML = list.map((e, i) => `
      <div class="hist-item">
        <div class="hist-meta">
          <span class="hist-no">${list.length - i}회차</span>
          <span class="hist-date">${esc(e.date || fmtDate(e.createdAt))}</span>
          <button class="ic" data-hprint="${e.id}" title="인쇄">🖨️</button>
          <button class="ic del" data-hdel="${e.id}" title="삭제">✕</button>
        </div>
        <div class="hist-groups">
          ${(e.groups || []).map(g => `<div class="hist-g"><b>${g.id}모둠</b> ${(g.names || []).map(esc).join(' · ')}</div>`).join('')}
        </div>
      </div>`).join('');

    box.querySelectorAll('[data-hdel]').forEach(b => b.addEventListener('click', () => {
      if (!confirmAsk('이 이력을 삭제할까요?')) return;
      DN.Store.remove(cfg.coll, b.dataset.hdel);
      renderHistory(container, cfg);
      toast('삭제되었습니다.', 'info');
    }));
    box.querySelectorAll('[data-hprint]').forEach(b => b.addEventListener('click', () => {
      const entry = DN.Store.get(cfg.coll, b.dataset.hprint);
      if (!entry) return;
      const groups = (entry.groups || []).map(g => ({
        id: g.id, color: g.color,
        members: (g.memberIds || []).map((id, idx) => {
          const s = DN.Store.get('students', id);
          return s || { id, name: (g.names || [])[idx] || '(삭제됨)', care: '' };
        }),
      }));
      DN.Arranger.print(groups, `${cfg.label}표 (${entry.date || ''})`);
    }));
  }

  // 진입점 — 모둠이 곧 자리(모둠 좌석 교실). 시력·키 고려 기본 ON
  DN.Groups = {
    render(c) {
      build(c, { kind: 'groups', coll: 'groups', title: '🪑 자리·모둠 배치', icon: '🪑',
        label: '모둠 배치', perGroupOption: true, bodyDefault: true, histDefault: true });
    }
  };
})();
