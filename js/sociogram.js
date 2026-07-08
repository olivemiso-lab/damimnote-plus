// ════════════════════════════════════════════════════
//  담임노트+ · 교우관계도 / 소시오그램 (DN.Sociogram)
//  - 학생별 선호·기피 친구 조사 → 관계도 시각화 + 분석
//  - 결과를 자리배치/모둠의 갈등·동행에 반영 가능(평화시민성)
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Sociogram = (function () {
  const { esc, toast, confirmAsk } = DN.utils;
  let selectedId = null;
  let showDislike = false;
  let rootEl = null;

  // sociometry: 학생당 1레코드 {studentId, likes:[], dislikes:[]}
  function getEntry(sid) {
    return DN.Store.query('sociometry', x => x.studentId === sid)[0] || null;
  }
  function saveEntry(sid, likes, dislikes) {
    const cur = getEntry(sid);
    if (cur) DN.Store.update('sociometry', cur.id, { likes, dislikes });
    else DN.Store.add('sociometry', { studentId: sid, likes, dislikes });
  }

  function render(container) {
    rootEl = container;
    const students = DN.Store.getAll('students')
      .sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999));
    if (students.length < 2) {
      container.innerHTML = `<div class="page-head"><h1>🕸️ 교우관계도</h1></div>
        <div class="card placeholder"><div class="ph-icon">🕸️</div><h2>학생을 먼저 등록해주세요</h2>
        <p class="desc">교우관계 조사를 하려면 학생이 2명 이상 필요합니다.</p>
        <button class="btn-secondary" id="goStuBtn">학생 관리로 가기</button></div>`;
      const b = container.querySelector('#goStuBtn');
      if (b) b.addEventListener('click', () => DN.App.go('students'));
      return;
    }
    if (!selectedId || !students.some(s => s.id === selectedId)) selectedId = students[0].id;

    container.innerHTML = `
      <div class="page-head"><h1>🕸️ 교우관계도</h1></div>
      <div class="card">
        <div class="card-head"><h2>📝 친구 관계 설문지</h2></div>
        <p class="desc">설문지를 인쇄해 나눠주고, 걷은 응답을 아래 <b>조사 입력</b>에 학생별로 넣으면 관계도가 완성됩니다.<br>인쇄 창에서 <b>‘PDF로 저장’</b>을 선택하면 파일로 내려받을 수 있어요.</p>
        <div class="frow">
          <label class="check-label"><input type="checkbox" id="svDislike" checked><span>😟 ‘함께하기 어려운 친구’ 문항 포함</span></label>
          <button class="btn-primary" id="svPrint" style="margin-left:auto">🖨️ 설문지 인쇄 / PDF 저장</button>
        </div>
      </div>
      <div class="card">
        <h2>친구 관계 조사 입력</h2>
        <p class="desc">학생을 선택하고, <b class="c-green">함께하고 싶은 친구</b>와 <b class="c-red">어려운 친구</b>를 표시하세요. (자동 저장 · 설문 문항 기준 최대 3명 권장)</p>
        <div class="frow"><label>학생</label>
          <select id="soStu" class="stu-select">
            ${students.map(s => `<option value="${s.id}"${s.id === selectedId ? ' selected' : ''}>${esc(s.number ? s.number + '. ' : '')}${esc(s.name)}</option>`).join('')}
          </select></div>
        <div id="soPick"></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>📍 관계도</h2>
          <label class="check-label" style="margin-left:auto"><input type="checkbox" id="soDislike"${showDislike ? ' checked' : ''}><span>기피 관계 표시</span></label>
        </div>
        <div id="soGraph" class="socio-graph"></div>
        <div class="socio-legend">
          <span><i class="lg-line like"></i> 선호</span>
          <span><i class="lg-line dislike"></i> 기피</span>
          <span><i class="lg-dot mutual"></i> 상호 선호</span>
          <span><i class="lg-dot iso"></i> 고립(선택 못 받음)</span>
        </div>
      </div>

      <div class="card"><div class="card-head"><h2>📊 관계 분석</h2></div><div id="soAnalysis"></div></div>`;

    container.querySelector('#soStu').addEventListener('change', e => { selectedId = e.target.value; renderPick(); });
    container.querySelector('#soDislike').addEventListener('change', e => { showDislike = e.target.checked; renderGraph(); });
    container.querySelector('#svPrint').addEventListener('click', () =>
      printSurvey(container.querySelector('#svDislike').checked));
    renderPick();
    renderGraph();
    renderAnalysis();
  }

  function renderPick() {
    const box = rootEl.querySelector('#soPick');
    const students = DN.Store.getAll('students').filter(s => s.id !== selectedId)
      .sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999));
    const entry = getEntry(selectedId) || { likes: [], dislikes: [] };

    box.innerHTML = `
      <div class="pick-grid">
        ${students.map(s => {
          const lk = entry.likes.includes(s.id), dk = entry.dislikes.includes(s.id);
          return `<div class="pick-row">
            <span class="pick-name">${esc(s.number ? s.number + '. ' : '')}${esc(s.name)}</span>
            <div class="pick-btns">
              <button class="pick-b like${lk ? ' on' : ''}" data-like="${s.id}">😊 선호</button>
              <button class="pick-b dislike${dk ? ' on' : ''}" data-dislike="${s.id}">😟 어려움</button>
            </div>
          </div>`;
        }).join('')}
      </div>`;

    box.querySelectorAll('[data-like]').forEach(b => b.addEventListener('click', () => toggle(b.dataset.like, 'like')));
    box.querySelectorAll('[data-dislike]').forEach(b => b.addEventListener('click', () => toggle(b.dataset.dislike, 'dislike')));
  }

  function toggle(targetId, kind) {
    const entry = getEntry(selectedId) || { likes: [], dislikes: [] };
    let likes = entry.likes.slice(), dislikes = entry.dislikes.slice();
    if (kind === 'like') {
      if (likes.includes(targetId)) likes = likes.filter(x => x !== targetId);
      else { likes.push(targetId); dislikes = dislikes.filter(x => x !== targetId); }
    } else {
      if (dislikes.includes(targetId)) dislikes = dislikes.filter(x => x !== targetId);
      else { dislikes.push(targetId); likes = likes.filter(x => x !== targetId); }
    }
    saveEntry(selectedId, likes, dislikes);
    renderPick(); renderGraph(); renderAnalysis();
  }

  // ── 설문지 인쇄 / PDF 저장 ──
  function printSurvey(includeDislike) {
    const settings = DN.Store.getObject('settings', {});
    const cls = [settings.schoolName, settings.grade && settings.grade + '학년', settings.classNo && settings.classNo + '반']
      .filter(Boolean).join(' ');

    const blanks = n => Array.from({ length: n }, (_, i) =>
      `<span class="blank"><i>${i + 1}</i></span>`).join('');

    const win = window.open('', '_survey', 'width=820,height=900');
    win.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>친구 관계 설문지</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Malgun Gothic',sans-serif;padding:2rem 2.2rem;color:#222;line-height:1.6}
        h1{text-align:center;font-size:1.35rem;margin-bottom:0.2rem}
        .cls{text-align:center;color:#777;font-size:0.9rem;margin-bottom:1.1rem}
        .me{display:flex;gap:2rem;justify-content:center;margin-bottom:1rem;font-size:1rem}
        .me b{border-bottom:1.6px solid #333;display:inline-block;min-width:110px;text-align:center;color:#fff}
        .intro{background:#f4f8f4;border:1.4px solid #cfe3cf;border-radius:10px;padding:0.7rem 1rem;font-size:0.88rem;margin-bottom:1.3rem}
        .q{margin-bottom:1.5rem}
        .q h2{font-size:1.02rem;margin-bottom:0.55rem}
        .q .sub{font-size:0.82rem;color:#888;margin-bottom:0.6rem}
        .blank{display:inline-block;width:150px;border-bottom:1.7px solid #555;margin:0 0.7rem 0.6rem 0;padding-left:2px;height:1.7rem}
        .blank i{font-style:normal;color:#aaa;font-size:0.78rem}
        .reason{border-bottom:1.7px solid #555;display:block;height:1.7rem;margin-top:0.4rem}
        .secret{margin-top:1.6rem;text-align:center;font-size:0.85rem;color:#4b6b4b;font-weight:bold}
        @media print{body{padding:1.2cm}}
      </style></head><body>
      <h1>😊 우리 반 친구 관계 설문</h1>
      <div class="cls">${esc(cls)}</div>
      <div class="me">이름: <b>.</b>  번호: <b>.</b></div>
      <div class="intro">이 설문은 우리 반 자리·모둠을 정할 때 참고하기 위한 것이에요.
        <b>선생님만 보는 비밀 설문</b>이니 솔직하게 적어 주세요. 정답은 없어요! 🌱</div>

      <div class="q">
        <h2>1. 함께 짝이 되거나 모둠 활동을 하고 싶은 친구는 누구인가요?</h2>
        <div class="sub">1명~3명까지 적을 수 있어요.</div>
        ${blanks(3)}
      </div>
      ${includeDislike ? `
      <div class="q">
        <h2>2. 함께 활동하기 조금 어렵거나 불편한 친구가 있나요?</h2>
        <div class="sub">없으면 비워 두세요. 이 답은 절대 친구들에게 알려지지 않아요.</div>
        ${blanks(2)}
        <div class="sub" style="margin-top:0.4rem">그렇게 느낀 이유가 있다면 적어 주세요. (선택)</div>
        <span class="reason"></span>
      </div>` : ''}
      <div class="q">
        <h2>${includeDislike ? '3' : '2'}. 요즘 고민이 있거나 선생님께 하고 싶은 말이 있나요? (선택)</h2>
        <span class="reason"></span>
        <span class="reason"></span>
      </div>

      <div class="secret">🔒 이 설문지는 선생님이 소중히 보관하고, 친구 선택 내용은 비밀로 지켜집니다.</div>
      <script>window.onload=()=>{window.print();window.close()}<\/script>
    </body></html>`);
    win.document.close();
  }

  // ── 관계도 SVG ──
  function renderGraph() {
    const box = rootEl.querySelector('#soGraph');
    const students = DN.Store.getAll('students')
      .sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999));
    const n = students.length;
    const all = DN.Store.getAll('sociometry');
    const likesOf = id => (all.find(x => x.studentId === id) || {}).likes || [];
    const dislikesOf = id => (all.find(x => x.studentId === id) || {}).dislikes || [];
    const incoming = {};
    students.forEach(s => incoming[s.id] = 0);
    students.forEach(s => likesOf(s.id).forEach(t => { if (incoming[t] != null) incoming[t]++; }));

    const W = 460, cx = W / 2, cy = W / 2, R = W / 2 - 55;
    const pos = {};
    students.forEach((s, i) => {
      const ang = -Math.PI / 2 + 2 * Math.PI * i / n;
      pos[s.id] = [cx + R * Math.cos(ang), cy + R * Math.sin(ang)];
    });
    const mutual = (a, b) => likesOf(a).includes(b) && likesOf(b).includes(a);

    let lines = '';
    students.forEach(s => {
      likesOf(s.id).forEach(t => {
        if (!pos[t]) return;
        const [x1, y1] = pos[s.id], [x2, y2] = pos[t];
        const mu = mutual(s.id, t);
        lines += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${mu ? '#2e7d32' : '#81c784'}" stroke-width="${mu ? 2.6 : 1.4}" marker-end="url(#arrL)"/>`;
      });
      if (showDislike) dislikesOf(s.id).forEach(t => {
        if (!pos[t]) return;
        const [x1, y1] = pos[s.id], [x2, y2] = pos[t];
        lines += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#ef9a9a" stroke-width="1.3" stroke-dasharray="4 3" marker-end="url(#arrD)"/>`;
      });
    });

    let nodes = '';
    students.forEach(s => {
      const [x, y] = pos[s.id];
      const inc = incoming[s.id];
      const iso = inc === 0;
      const rad = 13 + Math.min(inc, 6) * 2.5;
      const fill = iso ? '#ffcdd2' : inc >= 3 ? '#66bb6a' : '#a5d6a7';
      const sel = s.id === selectedId;
      nodes += `<g>
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad}" fill="${fill}" stroke="${sel ? '#1976d2' : '#fff'}" stroke-width="${sel ? 3 : 2}"/>
        <text x="${x.toFixed(1)}" y="${(y + rad + 12).toFixed(1)}" text-anchor="middle" font-size="11" fill="#444">${esc(s.name)}</text>
        ${inc > 0 ? `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="bold" fill="#fff">${inc}</text>` : ''}
      </g>`;
    });

    box.innerHTML = `<svg viewBox="0 0 ${W} ${W}" class="socio-svg">
      <defs>
        <marker id="arrL" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#81c784"/></marker>
        <marker id="arrD" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#ef9a9a"/></marker>
      </defs>
      ${lines}${nodes}
    </svg>`;
  }

  // ── 분석 ──
  function renderAnalysis() {
    const box = rootEl.querySelector('#soAnalysis');
    const students = DN.Store.getAll('students');
    const all = DN.Store.getAll('sociometry');
    if (!all.length) { box.innerHTML = '<p class="empty">친구 관계를 입력하면 분석이 표시됩니다.</p>'; return; }
    const name = id => { const s = students.find(x => x.id === id); return s ? s.name : '(삭제)'; };
    const likesOf = id => (all.find(x => x.studentId === id) || {}).likes || [];

    const incoming = {};
    students.forEach(s => incoming[s.id] = 0);
    students.forEach(s => likesOf(s.id).forEach(t => { if (incoming[t] != null) incoming[t]++; }));
    const ranked = students.slice().sort((a, b) => incoming[b.id] - incoming[a.id]);
    const popular = ranked.filter(s => incoming[s.id] > 0).slice(0, 3);
    const isolated = students.filter(s => incoming[s.id] === 0);
    const mutuals = [];
    students.forEach((a, i) => students.slice(i + 1).forEach(b => {
      if (likesOf(a.id).includes(b.id) && likesOf(b.id).includes(a.id)) mutuals.push([a.name, b.name]);
    }));

    box.innerHTML = `
      <div class="ana-grid">
        <div class="ana-box"><h3>⭐ 인기 (많이 선택받음)</h3>${popular.length ? popular.map(s => `<div class="ana-line">${esc(s.name)} <b>${incoming[s.id]}표</b></div>`).join('') : '<span class="empty">없음</span>'}</div>
        <div class="ana-box"><h3>🤝 상호 선호</h3>${mutuals.length ? mutuals.map(m => `<div class="ana-line">${esc(m[0])} ↔ ${esc(m[1])}</div>`).join('') : '<span class="empty">없음</span>'}</div>
        <div class="ana-box ${isolated.length ? 'warn' : ''}"><h3>🌱 관심 필요 (고립)</h3>${isolated.length ? isolated.map(s => `<div class="ana-line">${esc(s.name)}</div>`).join('') : '<span class="empty">없음 — 모두 선택받았어요!</span>'}</div>
      </div>
      <button class="btn-primary" id="applyRel" style="margin-top:0.9rem">🔗 이 관계를 자리배치·모둠에 반영</button>
      <p class="hint">상호 선호는 ‘필수 동행’ 후보로, 상호 기피는 ‘갈등 관계’ 후보로 추가합니다.</p>`;

    box.querySelector('#applyRel').addEventListener('click', applyToRelations);
  }

  function applyToRelations() {
    const students = DN.Store.getAll('students');
    const all = DN.Store.getAll('sociometry');
    const likesOf = id => (all.find(x => x.studentId === id) || {}).likes || [];
    const dislikesOf = id => (all.find(x => x.studentId === id) || {}).dislikes || [];
    const rel = DN.Arranger.getRelations();
    const has = (arr, a, b) => arr.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    let addF = 0, addC = 0;
    students.forEach((a, i) => students.slice(i + 1).forEach(b => {
      const mutualLike = likesOf(a.id).includes(b.id) && likesOf(b.id).includes(a.id);
      const mutualDislike = dislikesOf(a.id).includes(b.id) || dislikesOf(b.id).includes(a.id);
      if (mutualLike && !has(rel.friends, a.id, b.id) && !has(rel.conflicts, a.id, b.id)) { rel.friends.push([a.id, b.id]); addF++; }
      if (mutualDislike && !has(rel.conflicts, a.id, b.id) && !has(rel.friends, a.id, b.id)) { rel.conflicts.push([a.id, b.id]); addC++; }
    }));
    DN.Store.setObject('relations', rel);
    toast(`동행 ${addF}쌍, 갈등 ${addC}쌍을 반영했습니다.`, 'success');
  }

  return { render };
})();
