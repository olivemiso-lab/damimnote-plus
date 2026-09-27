// ════════════════════════════════════════════════════
//  담임노트+ · 자리·모둠 배치 엔진 (DN.Arranger)
//  기존 담임노트+ v1.0.0의 배치 엔진을 옮겨 온 것 — 학생 관리의 항목(학습수준·리더십·갈등·성별·자리 배려 등)을 그대로 쓴다
//  갈등 관계는 다른 모둠으로, 필수 동행은 같은 모둠으로. 20번 시도해 가장 좋은 배치를 고른다.
//  학생 이름이 필요한 PC 전용 기능 — 핸드폰으로 보내지 않는다
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Arranger = (function () {
  const { esc } = DN.utils;
  const REL_COL = 'relations';   // 단일 레코드 { conflicts: [[idA, idB]], friends: [[idA, idB]] }

  // 모둠 색 (파스텔: 바탕 · 테두리 · 글자)
  const COLORS = [
    ['#ffe2d3', '#ffcdb5', '#a4441f'], ['#dff0fb', '#b9def5', '#1f5f8b'], ['#dcf3e6', '#b5e3c8', '#22704a'],
    ['#fff3c4', '#f5dc85', '#7a5a00'], ['#ebe5fb', '#d3c8f5', '#5b45a8'], ['#fde3ea', '#f6c3d1', '#a8385a'],
    ['#dff6f5', '#b3e6e3', '#1f6f6b'], ['#ffe9cc', '#f7cf97', '#8a4b00'], ['#eaf5d6', '#cfe6a8', '#4a6b12'],
    ['#e6ebf5', '#c7d1ea', '#3b4a7a'],
  ];
  const CARE_ICON = { front: '🔼', back: '🔽', aisle: '↔️' };
  const CARE_T = { front: '앞', back: '뒤', aisle: '통로' };

  // ── 학생 특성 ──
  const isLeader    = s => s.leadership === 'high';
  const isEasy      = s => !!s.easygoing;
  const isDistract  = s => !!s.distracted;
  const isSensitive = s => !!s.sensitive;
  const isLethargic = s => !!s.lethargic;
  const isDisrupt   = s => !!s.disruptive;
  const isRisk      = s => s.conflictRisk === 'high';
  const isFront     = s => s.care === 'front';
  const isBack      = s => s.care === 'back';
  function nameOf(s) { return s.name || (s.number ? s.number + '번' : '이름 없음'); }

  // ── 관계 데이터 ──
  function getRelations() {
    const r = DN.Store.getAll(REL_COL)[0];
    return { conflicts: (r && r.conflicts) || [], friends: (r && r.friends) || [] };
  }
  function saveRelations(rel) {
    const r = DN.Store.getAll(REL_COL)[0];
    if (r) DN.Store.update(REL_COL, r.id, { conflicts: rel.conflicts, friends: rel.friends });
    else DN.Store.add(REL_COL, { conflicts: rel.conflicts, friends: rel.friends });
  }
  const isConflict = (a, b, rel) => rel.conflicts.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

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
          if (isConflict(g.members[i].id, g.members[j].id, rel)) v.push({ group: g, p2: g.members[j] });
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

  // ── 동행으로 이어진 학생 묶음(BFS) ──
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

  // ── 갈등 풀기 ──
  function resolveConflicts(groups, rel) {
    for (let t = 0; t < 600; t++) {
      const vs = findViolations(groups, rel);
      if (!vs.length) return;
      const gA = vs[0].group, person = vs[0].p2;
      const buddyIds = rel.friends.filter(([a, b]) => a === person.id || b === person.id).map(([a, b]) => a === person.id ? b : a);
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
        const g1 = groups[Math.floor(Math.random() * groups.length)];
        const g2 = groups[Math.floor(Math.random() * groups.length)];
        if (g1 !== g2 && g1.members.length && g2.members.length) {
          const i1 = Math.floor(Math.random() * g1.members.length);
          const i2 = Math.floor(Math.random() * g2.members.length);
          [g1.members[i1], g2.members[i2]] = [g2.members[i2], g1.members[i1]];
        }
      }
    }
  }

  // ── 인원 맞추기 ──
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

  // ── 이전 조합 벌점 (최근 10회, 오래될수록 가볍게) ──
  function historyPenalty(groups, hist) {
    let p = 0;
    (hist || []).slice(0, 10).forEach((entry, idx) => {
      const w = Math.pow(0.6, idx);
      (entry.groups || []).forEach(pg => {
        const ids = pg.memberIds || [];
        for (let i = 0; i < ids.length; i++)
          for (let j = i + 1; j < ids.length; j++)
            if (groups.some(g => { const gi = g.members.map(m => m.id); return gi.includes(ids[i]) && gi.includes(ids[j]); })) p += w;
      });
    });
    return p;
  }

  // ── 한 번 배치 ──
  function once(list, numGroups, rel, opt) {
    const placed = new Set();
    const groups = Array.from({ length: numGroups }, (_, i) => ({ id: i + 1, color: i % COLORS.length, members: [] }));
    const half = Math.ceil(numGroups / 2);
    const frontG = groups.slice(0, half);
    const backG = groups.slice(numGroups - half);

    const placeIn = (s, pool) => { [...pool].sort((a, b) => a.members.length - b.members.length)[0].members.push({ ...s }); placed.add(s.id); };
    const placeWith = (s, fn) => { [...groups].sort(fn)[0].members.push({ ...s }); placed.add(s.id); };
    const hetero = (pred, cnt) => shuffle(list.filter(s => pred(s) && !placed.has(s.id)))
      .forEach(s => placeWith(s, (a, b) => {
        const d = a.members.filter(cnt).length - b.members.filter(cnt).length;
        return d || a.members.length - b.members.length;
      }));

    // 1. 필수 동행 묶음
    const used = new Set();
    friendGroups(list, rel).filter(g => g.length > 1).forEach(grp => {
      const un = grp.filter(s => !placed.has(s.id));
      if (!un.length) return;
      const target = [...groups].sort((a, b) => a.members.length - b.members.length).find(g => !used.has(g.id)) || groups[0];
      used.add(target.id);
      un.forEach(s => { target.members.push({ ...s }); placed.add(s.id); });
    });
    // 2. 시력·키 (앞 / 뒤 자리)
    if (opt.body) {
      shuffle(list.filter(s => isFront(s) && !placed.has(s.id))).forEach(s => placeIn(s, frontG));
      shuffle(list.filter(s => isBack(s) && !placed.has(s.id))).forEach(s => placeIn(s, backG));
    }
    // 3. 리더 나누기
    if (opt.leader) shuffle(list.filter(s => isLeader(s) && !placed.has(s.id))).forEach((s, i) => { groups[i % numGroups].members.push({ ...s }); placed.add(s.id); });
    // 4. 성격 원만한 학생 나누기
    shuffle(list.filter(s => isEasy(s) && !placed.has(s.id))).forEach((s, i) => { groups[i % numGroups].members.push({ ...s }); placed.add(s.id); });
    // 5. 학습수준·발표력 고르게
    if (opt.level) {
      hetero(s => s.level === 'high', m => m.level === 'high');
      hetero(s => s.level === 'low', m => m.level === 'low');
      hetero(s => s.presentation === 'high', m => m.presentation === 'high');
    }
    // 6. 갈등·산만·활동 방해 나누기
    if (opt.risk) {
      hetero(s => isDistract(s), m => isDistract(m));
      hetero(s => isDisrupt(s) || isRisk(s), m => isDisrupt(m) || isRisk(m));
    }
    // 7. 예민한 학생 — 산만·활동 방해가 적은 모둠으로
    shuffle(list.filter(s => isSensitive(s) && !placed.has(s.id))).forEach(s => placeWith(s, (a, b) => {
      const aD = a.members.filter(m => isDistract(m) || isDisrupt(m)).length;
      const bD = b.members.filter(m => isDistract(m) || isDisrupt(m)).length;
      return aD !== bD ? aD - bD : a.members.length - b.members.length;
    }));
    // 8. 무기력한 학생 — 활기찬 모둠으로
    shuffle(list.filter(s => isLethargic(s) && !placed.has(s.id))).forEach(s => placeWith(s, (a, b) => {
      const aA = a.members.filter(m => isLeader(m) || m.presentation === 'high').length;
      const bA = b.members.filter(m => isLeader(m) || m.presentation === 'high').length;
      return aA !== bA ? bA - aA : a.members.length - b.members.length;
    }));
    // 9. 나머지 — 남녀 균형 + 인원
    const rest = list.filter(s => !placed.has(s.id));
    interleave(
      shuffle(rest.filter(s => s.gender === 'male')),
      shuffle(rest.filter(s => s.gender === 'female')),
      shuffle(rest.filter(s => s.gender !== 'male' && s.gender !== 'female')),
    ).forEach(s => placeWith(s, (a, b) => {
      if (opt.gender && (s.gender === 'male' || s.gender === 'female')) {
        const d = a.members.filter(m => m.gender === s.gender).length - b.members.filter(m => m.gender === s.gender).length;
        if (d) return d;
      }
      return a.members.length - b.members.length;
    }));
    // 10. 갈등 풀기 → 인원 맞추기
    resolveConflicts(groups, rel);
    balance(groups, rel);

    return {
      groups,
      violationCount: findViolations(groups, rel).length,
      friendViolationCount: findFriendViolations(groups, rel).length,
      imbalance: imbalanceOf(groups),
    };
  }

  // ── 가장 좋은 배치 (20번 시도) ──
  // opt: { numGroups, level, leader, risk, gender, body, avoidHistory }, history: 저장된 이력(최근 순)
  function arrange(list, opt, history) {
    const rel = getRelations();
    const score = r => r.violationCount * 100000 + r.friendViolationCount * 10000 + r.imbalance * 1000 +
      (opt.avoidHistory ? historyPenalty(r.groups, history) : 0);
    let best = once(list, opt.numGroups, rel, opt);
    let bestScore = score(best);
    for (let i = 1; i < 20; i++) {
      const cand = once(list, opt.numGroups, rel, opt);
      const sc = score(cand);
      if (sc < bestScore) { best = cand; bestScore = sc; }
    }
    best.relations = rel;
    return best;
  }

  // ── 교실 배치도 ──
  function colorStyle(i) { const c = COLORS[i % COLORS.length]; return 'background:' + c[0] + ';border-color:' + c[1] + ';color:' + c[2]; }
  function renderBoard(groups, swapTarget, interactive) {
    const cols = groups.length <= 3 ? groups.length : Math.ceil(Math.sqrt(groups.length));
    const islands = groups.map(g => {
      const isDrop = interactive && swapTarget && swapTarget.gid !== g.id;
      const desks = g.members.map(m => {
        const sel = interactive && swapTarget && swapTarget.gid === g.id && swapTarget.mid === m.id;
        return '<div class="bd-desk' + (sel ? ' sel' : '') + (interactive ? ' clickable' : '') + '"' +
          (interactive ? ' data-mid="' + esc(m.id) + '" data-gid="' + g.id + '"' : '') + '>' +
          (m.gender === 'male' || m.gender === 'female' ? '<span class="bd-g ' + m.gender + '"></span>' : '') +
          '<span class="bd-name">' + esc(nameOf(m)) + '</span>' +
          (m.care && CARE_ICON[m.care] ? '<span class="bd-care" title="' + CARE_T[m.care] + '자리">' + CARE_ICON[m.care] + '</span>' : '') + '</div>';
      }).join('');
      return '<div class="bd-island" style="border-top-color:' + COLORS[g.color % COLORS.length][1] + '">' +
        '<div class="bd-label' + (isDrop ? ' drop' : '') + '"' + (interactive ? ' data-glabel="' + g.id + '"' : '') + ' style="' + colorStyle(g.color) + '">' +
        '<span>' + g.id + '모둠</span><span class="bd-count">' + g.members.length + '명</span>' +
        (isDrop ? '<span class="bd-move">← 여기로 옮기기</span>' : '') + '</div>' +
        '<div class="bd-desks">' + desks + '</div></div>';
    }).join('');
    return '<div class="blackboard">칠 판 (교실 앞)</div>' +
      '<div class="bd-grid" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr))">' + islands + '</div>';
  }

  // ── 배치도 클릭: 학생 → 다른 모둠 학생이면 교환, 모둠 이름이면 이동 ──
  function handleClick(state, target) {
    if (!target) return { render: false };
    const deskEl = target.closest('[data-mid]');
    const labelEl = target.closest('[data-glabel]');
    if (deskEl) return clickMember(state, parseInt(deskEl.dataset.gid, 10), deskEl.dataset.mid);
    if (labelEl) return clickGroup(state, parseInt(labelEl.dataset.glabel, 10));
    return { render: false };
  }
  function clickMember(state, gid, mid) {
    const groups = state.groups;
    if (!state.swapTarget) { state.swapTarget = { gid, mid }; return { render: true }; }
    const st = state.swapTarget;
    if (st.gid === gid && st.mid === mid) { state.swapTarget = null; return { render: true }; }
    if (st.gid === gid) return { render: false, toast: '같은 모둠 학생끼리는 바꿀 수 없어요.' };
    const gA = groups.find(g => g.id === st.gid), gB = groups.find(g => g.id === gid);
    const iA = gA.members.findIndex(m => m.id === st.mid), iB = gB.members.findIndex(m => m.id === mid);
    const nA = nameOf(gA.members[iA]), nB = nameOf(gB.members[iB]);
    [gA.members[iA], gB.members[iB]] = [gB.members[iB], gA.members[iA]];
    state.swapTarget = null;
    return { render: true, toast: nA + ' ↔ ' + nB + ' 바꿨어요.' };
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
    return { render: true, toast: nameOf(mem) + ' → ' + gid + '모둠으로 옮겼어요.' };
  }

  // ── 갈등 관계 · 필수 동행 입력 ──
  // list: 배치할 학생 목록(번호만 있는 학생 포함). 없으면 명단 전체
  function renderRelationEditor(container, list) {
    const rel = getRelations();
    const students = (list || DN.Store.getAll('students')).slice().sort((a, b) => (parseInt(a.number, 10) || 999) - (parseInt(b.number, 10) || 999));
    const opts = students.map(s => '<option value="' + esc(s.id) + '">' + esc((s.number && s.name ? s.number + '. ' : '') + nameOf(s)) + '</option>').join('');
    const label = id => { const s = students.find(x => x.id === id); return s ? nameOf(s) : '(지운 학생)'; };
    const block = (kind, title, sub, pairs, joiner) =>
      '<div class="rel-block"><h3>' + title + ' <small>' + sub + '</small></h3>' +
      '<div class="rel-input"><select class="' + kind + '-a"><option value="">학생</option>' + opts + '</select><span>' + joiner + '</span>' +
      '<select class="' + kind + '-b"><option value="">학생</option>' + opts + '</select><button class="btn-ghost ' + kind + '-add">추가</button></div>' +
      '<div class="rel-list">' + (pairs.length ? pairs.map(([a, b], i) =>
        '<span class="rel-tag ' + kind + '">' + esc(label(a)) + ' ' + joiner + ' ' + esc(label(b)) + '<button data-' + kind + '="' + i + '" aria-label="빼기">✕</button></span>').join('')
        : '<span class="rel-empty">없음</span>') + '</div></div>';
    container.innerHTML = block('rc', '⚔️ 갈등 관계', '다른 모둠으로 떼어 놓기', rel.conflicts, '↔') +
      block('rf', '🤝 필수 동행', '같은 모둠으로 함께 두기', rel.friends, '+');

    const addPair = which => {
      const r = getRelations();
      const a = container.querySelector('.' + which + '-a').value;
      const b = container.querySelector('.' + which + '-b').value;
      if (!a || !b) return DN.utils.toast('두 학생을 골라 주세요.', 'error');
      if (a === b) return DN.utils.toast('서로 다른 학생을 골라 주세요.', 'error');
      const here = which === 'rc' ? r.conflicts : r.friends;
      const other = which === 'rc' ? r.friends : r.conflicts;
      const same = ([x, y]) => (x === a && y === b) || (x === b && y === a);
      if (here.some(same)) return DN.utils.toast('이미 넣었어요.', 'error');
      if (other.some(same)) return DN.utils.toast('반대 관계로 이미 넣어 두었어요.', 'error');
      here.push([a, b]);
      saveRelations(r);
      renderRelationEditor(container, list);
    };
    container.querySelector('.rc-add').addEventListener('click', () => addPair('rc'));
    container.querySelector('.rf-add').addEventListener('click', () => addPair('rf'));
    container.querySelectorAll('[data-rc]').forEach(btn => btn.addEventListener('click', () => {
      const r = getRelations(); r.conflicts.splice(+btn.dataset.rc, 1); saveRelations(r); renderRelationEditor(container, list);
    }));
    container.querySelectorAll('[data-rf]').forEach(btn => btn.addEventListener('click', () => {
      const r = getRelations(); r.friends.splice(+btn.dataset.rf, 1); saveRelations(r); renderRelationEditor(container, list);
    }));
  }

  // ── 이력 저장용 ──
  function serialize(groups) {
    return groups.map(g => ({ id: g.id, color: g.color, memberIds: g.members.map(m => m.id), names: g.members.map(nameOf) }));
  }

  // ── 인쇄 (새 창) ──
  function print(groups, title) {
    const s = DN.Settings.get();
    const cols = groups.length <= 3 ? groups.length : Math.ceil(Math.sqrt(groups.length));
    const islands = groups.map(g => {
      const c = COLORS[g.color % COLORS.length];
      return '<div class="pg" style="border-color:' + c[1] + '"><div class="pt" style="background:' + c[0] + ';color:' + c[2] + '">' + g.id + '모둠 · ' + g.members.length + '명</div>' +
        '<div class="pd">' + g.members.map(m => '<div class="pdesk">' + esc(nameOf(m)) + (m.care && CARE_ICON[m.care] ? '<span>' + CARE_ICON[m.care] + '</span>' : '') + '</div>').join('') + '</div></div>';
    }).join('');
    const win = window.open('', '_blank', 'width=1000,height=750');
    if (!win) { DN.utils.toast('인쇄 창이 막혔어요. 브라우저의 팝업 허용을 확인해 주세요.', 'error'); return; }
    win.document.write('<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>' + esc(title) + '</title><style>' +
      '*{margin:0;padding:0;box-sizing:border-box}body{font-family:"Malgun Gothic",sans-serif;padding:1.5rem;color:#3b3531}' +
      'h1{text-align:center;font-size:1.3rem}.sub{text-align:center;color:#7d716a;font-size:.9rem;margin-bottom:1rem}' +
      '.board{background:#dcf3e6;color:#22704a;text-align:center;padding:.6rem;border-radius:10px;margin-bottom:1.4rem;font-weight:bold;letter-spacing:.2em}' +
      '.grid{display:grid;grid-template-columns:repeat(' + cols + ',1fr);gap:1rem}.pg{border:2.5px solid #ccc;border-radius:14px;overflow:hidden}' +
      '.pt{font-weight:bold;padding:.45rem;text-align:center}.pd{display:grid;grid-template-columns:1fr 1fr;gap:.4rem;padding:.6rem}' +
      '.pdesk{border:1.5px solid #e6d6c3;border-radius:8px;padding:.5rem .3rem;text-align:center;font-weight:600;position:relative}' +
      '.pdesk span{position:absolute;top:1px;right:3px;font-size:.7rem}.foot{text-align:center;margin-top:1.4rem;color:#aaa;font-size:.8rem}' +
      '@media print{body{padding:.5cm}}</style></head><body>' +
      '<h1>' + esc(title) + '</h1><div class="sub">' + esc(s.grade + '학년 ' + s.classNo + '반') + '</div>' +
      '<div class="board">칠 판 (교실 앞)</div><div class="grid">' + islands + '</div>' +
      '<div class="foot">담임노트+ · ' + esc(DN.utils.today()) + '</div>' +
      '<script>window.onload=function(){window.print()}<\/script></body></html>');
    win.document.close();
  }

  return {
    arrange, renderBoard, handleClick, renderRelationEditor, serialize, print,
    getRelations, saveRelations, nameOf, COLORS, REL_COL,
    _internal: { findViolations, findFriendViolations, imbalanceOf, historyPenalty },
  };
})();
