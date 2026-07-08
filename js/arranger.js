// ════════════════════════════════════════════════════
//  담임노트+ · 공용 배치 엔진 (DN.Arranger)
//  - 자리 배치 / 모둠 편성이 함께 사용하는 핵심 알고리즘
//  - 1단계 학생 DB(DN.Store)의 필드를 그대로 활용
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Arranger = (function () {
  const { esc } = DN.utils;

  const COLORS = [
    '#ef5350','#42a5f5','#66bb6a','#ffa726','#ab47bc',
    '#26c6da','#ec407a','#8d6e63','#ff7043','#26a69a'
  ];
  const LEVEL_T = { high: '상', mid: '중', low: '하', '': '' };
  const CARE_ICON = { front: '🔼', back: '🔽', aisle: '↔️' };
  const CARE_T = { front: '앞', back: '뒤', aisle: '통로' };

  // ── 학생 특성 접근자(새 DB 필드 ↔ 배치 의미) ──
  const isLeader   = s => s.leadership === 'high';
  const isEasy     = s => !!s.easygoing;
  const isDistract = s => !!s.distracted;
  const isSensitive= s => !!s.sensitive;
  const isLethargic= s => !!s.lethargic;
  const isDisrupt  = s => !!s.disruptive;
  const isRisk     = s => s.conflictRisk === 'high';
  const isFront    = s => s.care === 'front';
  const isBack     = s => s.care === 'back';
  const isAisle    = s => s.care === 'aisle';

  // ── 관계 데이터 ──
  function getRelations() {
    return DN.Store.getObject('relations', { conflicts: [], friends: [] });
  }
  function saveRelations(rel) { DN.Store.setObject('relations', rel); }
  const isConflict = (a, b, rel) => rel.conflicts.some(([x, y]) => (x===a&&y===b)||(x===b&&y===a));
  const isFriend   = (a, b, rel) => rel.friends.some(([x, y]) => (x===a&&y===b)||(x===b&&y===a));

  // ── 유틸 ──
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function interleave(...arrs) {
    const out = [], max = Math.max(0, ...arrs.map(a => a.length));
    for (let i = 0; i < max; i++) for (const a of arrs) if (i < a.length) out.push(a[i]);
    return out;
  }

  // ── 검증 ──
  function findViolations(groups, rel) {
    const v = [];
    for (const g of groups)
      for (let i = 0; i < g.members.length; i++)
        for (let j = i + 1; j < g.members.length; j++)
          if (isConflict(g.members[i].id, g.members[j].id, rel))
            v.push({ group: g, p2: g.members[j] });
    return v;
  }
  function findFriendViolations(groups, rel) {
    return rel.friends.filter(([a, b]) => {
      const gA = groups.find(g => g.members.some(m => m.id === a));
      const gB = groups.find(g => g.members.some(m => m.id === b));
      return gA && gB && gA.id !== gB.id;
    });
  }
  function imbalanceOf(groups) {
    const sizes = groups.map(g => g.members.length);
    return Math.max(...sizes) - Math.min(...sizes);
  }

  // ── 동행 연결 그룹(BFS) ──
  function friendGroups(list, rel) {
    const visited = new Set(), out = [];
    for (const s of list) {
      if (visited.has(s.id)) continue;
      const grp = [], q = [s.id];
      while (q.length) {
        const cur = q.shift();
        if (visited.has(cur)) continue;
        visited.add(cur);
        const st = list.find(x => x.id === cur);
        if (st) grp.push(st);
        for (const [a, b] of rel.friends) {
          if (a === cur && !visited.has(b)) q.push(b);
          if (b === cur && !visited.has(a)) q.push(a);
        }
      }
      if (grp.length) out.push(grp);
    }
    return out;
  }

  // ── 갈등 해결 ──
  function resolveConflicts(groups, rel) {
    for (let t = 0; t < 600; t++) {
      const vs = findViolations(groups, rel);
      if (!vs.length) return;
      const gA = vs[0].group, person = vs[0].p2;
      const buddyIds = rel.friends.filter(([a, b]) => a===person.id||b===person.id).map(([a,b]) => a===person.id?b:a);
      const buddies = gA.members.filter(m => buddyIds.includes(m.id));
      const move = [person, ...buddies];
      let moved = false;
      for (const gB of [...groups.filter(g => g !== gA)].sort((a, b) => a.members.length - b.members.length)) {
        const safe = !move.some(mv => gB.members.some(m => isConflict(m.id, mv.id, rel)));
        if (safe) {
          move.forEach(mv => { gA.members = gA.members.filter(m => m.id !== mv.id); gB.members.push(mv); });
          moved = true; break;
        }
        for (const cand of shuffle(gB.members)) {
          if (buddyIds.includes(cand.id)) continue;
          const aOth = gA.members.filter(m => !move.map(x => x.id).includes(m.id) && m.id !== cand.id);
          const bOth = gB.members.filter(m => m.id !== cand.id);
          if (!aOth.some(m => isConflict(m.id, cand.id, rel)) && !move.some(mv => bOth.some(m => isConflict(m.id, mv.id, rel)))) {
            move.forEach(mv => { gA.members = gA.members.filter(m => m.id !== mv.id); gB.members.push(mv); });
            gB.members = gB.members.filter(m => m.id !== cand.id);
            gA.members.push(cand);
            moved = true; break;
          }
        }
        if (moved) break;
      }
      if (!moved) {
        const g1 = groups[Math.floor(Math.random()*groups.length)];
        const g2 = groups[Math.floor(Math.random()*groups.length)];
        if (g1 !== g2 && g1.members.length && g2.members.length) {
          const i1 = Math.floor(Math.random()*g1.members.length);
          const i2 = Math.floor(Math.random()*g2.members.length);
          [g1.members[i1], g2.members[i2]] = [g2.members[i2], g1.members[i1]];
        }
      }
    }
  }

  // ── 인원 균형 ──
  function balance(groups, rel) {
    const blocked = id => rel.friends.some(([a, b]) => a === id || b === id);
    for (let t = 0; t < 400; t++) {
      const sorted = [...groups].sort((a, b) => b.members.length - a.members.length);
      const big = sorted[0], small = sorted[sorted.length - 1];
      if (big.members.length - small.members.length <= 1) break;
      const cand = shuffle(big.members).find(m => !blocked(m.id) && !small.members.some(sm => isConflict(m.id, sm.id, rel)));
      if (!cand) break;
      big.members = big.members.filter(m => m.id !== cand.id);
      small.members.push(cand);
    }
  }

  // ── 이력 페널티(이전 조합 회피) ──
  function historyPenalty(groups, coll) {
    const hist = DN.Store.getAll(coll).sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1)).slice(0, 10);
    let p = 0;
    hist.forEach((entry, idx) => {
      const w = Math.pow(0.6, idx);
      (entry.groups || []).forEach(pg => {
        const ids = pg.memberIds || [];
        for (let i = 0; i < ids.length; i++)
          for (let j = i + 1; j < ids.length; j++)
            if (groups.some(g => { const gi = g.members.map(m => m.id); return gi.includes(ids[i]) && gi.includes(ids[j]); }))
              p += w;
      });
    });
    return p;
  }

  // ── 1회 배치 ──
  function once(list, numGroups, rel, opt) {
    const placed = new Set();
    const groups = Array.from({ length: numGroups }, (_, i) => ({
      id: i + 1, color: COLORS[i % COLORS.length], members: []
    }));
    const half = Math.ceil(numGroups / 2);
    const frontG = groups.slice(0, half);
    const backG = groups.slice(numGroups - half);

    const placeIn = (s, pool) => { [...pool].sort((a,b)=>a.members.length-b.members.length)[0].members.push({...s}); placed.add(s.id); };
    const placeWith = (s, fn) => { [...groups].sort(fn)[0].members.push({...s}); placed.add(s.id); };
    const hetero = (pred, cnt) => shuffle(list.filter(s => pred(s) && !placed.has(s.id)))
      .forEach(s => placeWith(s, (a, b) => {
        const d = a.members.filter(cnt).length - b.members.filter(cnt).length;
        return d || a.members.length - b.members.length;
      }));

    // 1. 동행 그룹
    const used = new Set();
    friendGroups(list, rel).filter(g => g.length > 1).forEach(grp => {
      const un = grp.filter(s => !placed.has(s.id));
      if (!un.length) return;
      const target = [...groups].sort((a,b)=>a.members.length-b.members.length).find(g => !used.has(g.id)) || groups[0];
      used.add(target.id);
      un.forEach(s => { target.members.push({...s}); placed.add(s.id); });
    });
    // 2~3. 신체(앞/뒤)
    if (opt.body) {
      shuffle(list.filter(s => isFront(s) && !placed.has(s.id))).forEach(s => placeIn(s, frontG));
      shuffle(list.filter(s => isBack(s) && !placed.has(s.id))).forEach(s => placeIn(s, backG));
    }
    // 4. 리더 분산
    if (opt.leader) shuffle(list.filter(s => isLeader(s) && !placed.has(s.id))).forEach((s,i) => { groups[i%numGroups].members.push({...s}); placed.add(s.id); });
    // 5. 성격 원만 분산
    shuffle(list.filter(s => isEasy(s) && !placed.has(s.id))).forEach((s,i) => { groups[i%numGroups].members.push({...s}); placed.add(s.id); });
    // 6~7. 학습수준/발표력 이질
    if (opt.level) {
      hetero(s => s.level === 'high', m => m.level === 'high');
      hetero(s => s.level === 'low',  m => m.level === 'low');
      hetero(s => s.presentation === 'high', m => m.presentation === 'high');
    }
    // 8. 갈등위험/산만/민폐 분산
    if (opt.risk) {
      hetero(s => isDistract(s), m => isDistract(m));
      hetero(s => isDisrupt(s) || isRisk(s), m => isDisrupt(m) || isRisk(m));
    }
    // 9. 예민 — 산만·민폐 적은 모둠
    shuffle(list.filter(s => isSensitive(s) && !placed.has(s.id))).forEach(s => placeWith(s, (a, b) => {
      const aD = a.members.filter(m => isDistract(m)||isDisrupt(m)).length;
      const bD = b.members.filter(m => isDistract(m)||isDisrupt(m)).length;
      if (aD !== bD) return aD - bD;
      return a.members.length - b.members.length;
    }));
    // 10. 무기력 — 활기찬 모둠 우선
    shuffle(list.filter(s => isLethargic(s) && !placed.has(s.id))).forEach(s => placeWith(s, (a, b) => {
      const aA = a.members.filter(m => isLeader(m) || m.presentation === 'high').length;
      const bA = b.members.filter(m => isLeader(m) || m.presentation === 'high').length;
      if (aA !== bA) return bA - aA;
      return a.members.length - b.members.length;
    }));
    // 11. 나머지 — 성별 균형 + 인원
    const rest = list.filter(s => !placed.has(s.id));
    interleave(
      shuffle(rest.filter(s => s.gender === 'male')),
      shuffle(rest.filter(s => s.gender === 'female')),
      shuffle(rest.filter(s => s.gender === 'none')),
    ).forEach(s => placeWith(s, (a, b) => {
      if (opt.gender && s.gender !== 'none') {
        const d = a.members.filter(m => m.gender === s.gender).length - b.members.filter(m => m.gender === s.gender).length;
        if (d) return d;
      }
      return a.members.length - b.members.length;
    }));
    // 12~13. 갈등 해결 → 인원 균형
    resolveConflicts(groups, rel);
    balance(groups, rel);

    return {
      groups,
      violationCount: findViolations(groups, rel).length,
      friendViolationCount: findFriendViolations(groups, rel).length,
      imbalance: imbalanceOf(groups),
    };
  }

  // ── 최적 배치(여러 번 시도 후 최선 선택) ──
  function arrange(list, opt) {
    const rel = getRelations();
    const numGroups = opt.numGroups;
    const score = r => r.violationCount*100000 + r.friendViolationCount*10000 + r.imbalance*1000
      + (opt.avoidHistory && opt.historyColl ? historyPenalty(r.groups, opt.historyColl) : 0);
    let best = once(list, numGroups, rel, opt);
    let bestScore = score(best);
    for (let i = 1; i < 20; i++) {
      const cand = once(list, numGroups, rel, opt);
      const sc = score(cand);
      if (sc < bestScore) { best = cand; bestScore = sc; }
    }
    best.relations = rel;
    return best;
  }

  // ── 교실 배치도 렌더 ──
  function memberTag(m) {
    const t = [];
    if (m.gender === 'male') t.push('<span class="bd-g male"></span>');
    if (m.gender === 'female') t.push('<span class="bd-g female"></span>');
    return t.join('');
  }
  function renderBoard(groups, swapTarget, interactive) {
    const cols = groups.length <= 3 ? groups.length : Math.ceil(Math.sqrt(groups.length));
    const islands = groups.map(g => {
      const isDrop = interactive && swapTarget && swapTarget.gid !== g.id;
      const desks = g.members.map(m => {
        const sel = interactive && swapTarget && swapTarget.gid === g.id && swapTarget.mid === m.id;
        return `<div class="bd-desk${sel ? ' sel' : ''}${interactive ? ' clickable' : ''}" ${interactive ? `data-mid="${m.id}" data-gid="${g.id}"` : ''}>
          ${memberTag(m)}
          <span class="bd-name">${esc(m.name)}</span>
          ${m.care && CARE_ICON[m.care] ? `<span class="bd-care" title="${CARE_T[m.care]}자리">${CARE_ICON[m.care]}</span>` : ''}
        </div>`;
      }).join('');
      return `<div class="bd-island" style="border-top-color:${g.color}">
        <div class="bd-label${isDrop ? ' drop' : ''}" ${interactive ? `data-glabel="${g.id}"` : ''}>
          <span class="bd-dot" style="background:${g.color}"></span>
          <span>${g.id}모둠</span>
          <span class="bd-count">${g.members.length}명</span>
          ${isDrop ? '<span class="bd-move">← 이동</span>' : ''}
        </div>
        <div class="bd-desks">${desks}</div>
      </div>`;
    }).join('');
    return `<div class="blackboard">🟩 칠 판 (교실 앞)</div>
      <div class="bd-grid" style="grid-template-columns:repeat(${cols},1fr)">${islands}</div>`;
  }

  // ── 배치도 클릭 처리(교환 / 이동) ──
  function handleClick(state, target) {
    if (!target) return { render: false };
    const deskEl = target.closest('[data-mid]');
    const labelEl = target.closest('[data-glabel]');
    if (deskEl) return clickMember(state, parseInt(deskEl.dataset.gid), deskEl.dataset.mid);
    if (labelEl) return clickGroup(state, parseInt(labelEl.dataset.glabel));
    return { render: false };
  }
  function clickMember(state, gid, mid) {
    const groups = state.groups;
    if (!state.swapTarget) { state.swapTarget = { gid, mid }; return { render: true }; }
    const st = state.swapTarget;
    if (st.gid === gid && st.mid === mid) { state.swapTarget = null; return { render: true }; }
    if (st.gid === gid) return { render: false, toast: '같은 모둠 학생끼리는 교환할 수 없어요.' };
    const gA = groups.find(g => g.id === st.gid), gB = groups.find(g => g.id === gid);
    const iA = gA.members.findIndex(m => m.id === st.mid), iB = gB.members.findIndex(m => m.id === mid);
    const nA = gA.members[iA].name, nB = gB.members[iB].name;
    [gA.members[iA], gB.members[iB]] = [gB.members[iB], gA.members[iA]];
    state.swapTarget = null;
    return { render: true, toast: `${nA} ↔ ${nB} 교환 완료!` };
  }
  function clickGroup(state, gid) {
    if (!state.swapTarget) return { render: false };
    const st = state.swapTarget;
    if (st.gid === gid) { state.swapTarget = null; return { render: true }; }
    const gA = state.groups.find(g => g.id === st.gid), gB = state.groups.find(g => g.id === gid);
    const i = gA.members.findIndex(m => m.id === st.mid);
    const mem = gA.members[i];
    gA.members.splice(i, 1);
    gB.members.push(mem);
    state.swapTarget = null;
    return { render: true, toast: `${mem.name} → ${gid}모둠으로 이동!` };
  }

  // ── 관계(갈등/동행) 입력 UI ──
  function renderRelationEditor(container) {
    const rel = getRelations();
    const students = DN.Store.getAll('students');
    const opts = students.map(s => `<option value="${s.id}">${esc(s.number ? s.number + '. ' : '')}${esc(s.name)}</option>`).join('');
    const nameOf = id => { const s = students.find(x => x.id === id); return s ? s.name : '(삭제됨)'; };

    container.innerHTML = `
      <div class="rel-block">
        <h3>⚔️ 갈등 관계 <small>다른 모둠으로 분리</small></h3>
        <div class="rel-input">
          <select class="rc-a"><option value="">학생</option>${opts}</select>
          <span>↔</span>
          <select class="rc-b"><option value="">학생</option>${opts}</select>
          <button class="btn-ghost rc-add">추가</button>
        </div>
        <div class="rel-list">${rel.conflicts.length ? rel.conflicts.map(([a, b], i) =>
          `<div class="rel-tag conflict">⚔️ ${esc(nameOf(a))} ↔ ${esc(nameOf(b))}<button data-rc="${i}">✕</button></div>`).join('') : '<span class="rel-empty">없음</span>'}</div>
      </div>
      <div class="rel-block">
        <h3>🤝 필수 동행 <small>같은 모둠으로 배치</small></h3>
        <div class="rel-input">
          <select class="rf-a"><option value="">학생</option>${opts}</select>
          <span>+</span>
          <select class="rf-b"><option value="">학생</option>${opts}</select>
          <button class="btn-ghost rf-add">추가</button>
        </div>
        <div class="rel-list">${rel.friends.length ? rel.friends.map(([a, b], i) =>
          `<div class="rel-tag friend">🤝 ${esc(nameOf(a))} + ${esc(nameOf(b))}<button data-rf="${i}">✕</button></div>`).join('') : '<span class="rel-empty">없음</span>'}</div>
      </div>`;

    const addPair = (which) => {
      const r = getRelations();
      const a = container.querySelector(`.${which}-a`).value;
      const b = container.querySelector(`.${which}-b`).value;
      if (!a || !b) return DN.utils.toast('두 학생을 선택해주세요.', 'error');
      if (a === b) return DN.utils.toast('서로 다른 학생을 선택해주세요.', 'error');
      const here = which === 'rc' ? r.conflicts : r.friends;
      const other = which === 'rc' ? r.friends : r.conflicts;
      if (here.some(([x, y]) => (x===a&&y===b)||(x===b&&y===a))) return DN.utils.toast('이미 등록되어 있습니다.', 'error');
      if (other.some(([x, y]) => (x===a&&y===b)||(x===b&&y===a))) return DN.utils.toast('반대 관계로 이미 등록되어 있습니다.', 'error');
      here.push([a, b]);
      saveRelations(r);
      renderRelationEditor(container);
      DN.utils.toast('추가되었습니다.', 'success');
    };
    container.querySelector('.rc-add').addEventListener('click', () => addPair('rc'));
    container.querySelector('.rf-add').addEventListener('click', () => addPair('rf'));
    container.querySelectorAll('[data-rc]').forEach(btn => btn.addEventListener('click', () => {
      const r = getRelations(); r.conflicts.splice(+btn.dataset.rc, 1); saveRelations(r); renderRelationEditor(container);
    }));
    container.querySelectorAll('[data-rf]').forEach(btn => btn.addEventListener('click', () => {
      const r = getRelations(); r.friends.splice(+btn.dataset.rf, 1); saveRelations(r); renderRelationEditor(container);
    }));
  }

  // ── 이력 저장용 직렬화 ──
  function serialize(groups) {
    return groups.map(g => ({
      id: g.id, color: g.color,
      memberIds: g.members.map(m => m.id),
      names: g.members.map(m => m.name),
    }));
  }

  // ── 인쇄 ──
  function print(groups, title) {
    const settings = DN.Store.getObject('settings', {});
    const cls = [settings.grade && settings.grade + '학년', settings.classNo && settings.classNo + '반'].filter(Boolean).join(' ');
    const cols = groups.length <= 3 ? groups.length : Math.ceil(Math.sqrt(groups.length));
    const islands = groups.map(g => `
      <div class="pg" style="border-color:${esc(g.color)}">
        <div class="pt" style="background:${esc(g.color)}">${g.id}모둠 · ${g.members.length}명</div>
        <div class="pd">${g.members.map(m => `<div class="pdesk">${esc(m.name)}${m.care&&CARE_ICON[m.care]?`<span>${CARE_ICON[m.care]}</span>`:''}</div>`).join('')}</div>
      </div>`).join('');
    const win = window.open('', '_print', 'width=1000,height=750');
    win.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${esc(title)}</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Malgun Gothic',sans-serif;padding:1.5rem;color:#222}
        h1{text-align:center;font-size:1.3rem}
        .sub{text-align:center;color:#888;font-size:0.9rem;margin-bottom:1rem}
        .board{background:#2e5d3b;color:#fff;text-align:center;padding:0.6rem;border-radius:6px;margin-bottom:1.4rem;font-weight:bold;letter-spacing:0.1em}
        .grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:1rem}
        .pg{border:2.5px solid #ccc;border-radius:10px;overflow:hidden}
        .pt{color:#fff;font-weight:bold;padding:0.45rem;text-align:center}
        .pd{display:grid;grid-template-columns:1fr 1fr;gap:0.4rem;padding:0.6rem}
        .pdesk{border:1.5px solid #ddd;border-radius:6px;padding:0.5rem 0.3rem;text-align:center;font-weight:600;position:relative}
        .pdesk span{position:absolute;top:1px;right:3px;font-size:0.7rem}
        .foot{text-align:center;margin-top:1.4rem;color:#aaa;font-size:0.8rem}
        @media print{body{padding:0.5cm}}
      </style></head><body>
      <h1>${esc(title)}</h1>
      <div class="sub">${esc(cls)} ${settings.teacher ? '· ' + esc(settings.teacher) : ''}</div>
      <div class="board">🟩 칠 판 (교실 앞)</div>
      <div class="grid">${islands}</div>
      <div class="foot">담임노트+ · ${DN.utils.fmtDate(DN.utils.nowISO())}</div>
      <script>window.onload=()=>{window.print();window.close()}<\/script>
    </body></html>`);
    win.document.close();
  }

  return {
    arrange, renderBoard, handleClick, renderRelationEditor,
    serialize, print, getRelations, COLORS,
  };
})();
