// ════════════════════════════════════════════════════
//  담임노트+ · 성장 분석 (DN.Growth)
//  - 누적 관찰 데이터를 점수화/시각화
//  - analyze()는 행동특성 작성(DN.Report)에서도 재사용
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Growth = (function () {
  const { esc } = DN.utils;
  const ITEMS = DN.NLG.OBS_ITEMS;
  const LV = { good: 3, mid: 2, low: 1 };

  let selectedId = null;
  let rootEl = null;

  // ── 분석(점수/추세/강점 분류) ──
  function analyze(studentId) {
    const obs = DN.Store.query('observations', o => o.studentId === studentId)
      // 같은 날짜 기록은 입력 시각(createdAt)으로 2차 정렬 — 순서가 불안정하면 추세 계산이 흔들림
      .sort((a, b) => {
        const d = (a.date || '').localeCompare(b.date || '');
        return d !== 0 ? d : (a.createdAt || '').localeCompare(b.createdAt || '');
      });
    const counCount = DN.Store.query('counselings', c => c.studentId === studentId).length;

    const items = ITEMS.map(it => {
      const seq = obs.map(o => LV[o[it.key]]).filter(Boolean);
      if (!seq.length) return { key: it.key, label: it.label, seq: [], count: 0, avg: 0, goodRatio: 0, trend: null, level: null };
      const avg = seq.reduce((a, b) => a + b, 0) / seq.length;
      const goodRatio = seq.filter(s => s === 3).length / seq.length;
      let trend = null;
      if (seq.length >= 2) {
        const half = Math.floor(seq.length / 2) || 1;
        const early = seq.slice(0, half);
        const late = seq.slice(-half);
        const ea = early.reduce((a, b) => a + b, 0) / early.length;
        const la = late.reduce((a, b) => a + b, 0) / late.length;
        trend = la - ea > 0.3 ? 'up' : la - ea < -0.3 ? 'down' : 'flat';
      }
      const level = avg >= 2.5 ? 'good' : avg >= 1.7 ? 'mid' : 'low';
      return { key: it.key, label: it.label, seq, count: seq.length, avg, goodRatio, trend, level };
    });

    const withData = items.filter(i => i.count > 0);
    return {
      obsCount: obs.length,
      counCount,
      items,
      withData,
      strengths: withData.filter(i => i.level === 'good'),
      supports: withData.filter(i => i.level === 'low'),
      improving: withData.filter(i => i.trend === 'up'),
    };
  }

  // ── 스파크라인(SVG) ──
  function sparkline(seq) {
    if (seq.length < 2) return '<span class="spark-none">기록 부족</span>';
    const w = 88, h = 26, pad = 3;
    const pts = seq.map((s, i) => {
      const x = pad + (i / (seq.length - 1)) * (w - pad * 2);
      const y = h - pad - ((s - 1) / 2) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const dots = seq.map((s, i) => {
      const [x, y] = pts[i].split(',');
      return `<circle cx="${x}" cy="${y}" r="2.2" fill="#667eea"/>`;
    }).join('');
    return `<svg width="${w}" height="${h}" class="spark"><polyline points="${pts.join(' ')}" fill="none" stroke="#667eea" stroke-width="2"/>${dots}</svg>`;
  }

  const LEVEL_BADGE = {
    good: '<span class="lv-badge good">강점</span>',
    mid:  '<span class="lv-badge mid">양호</span>',
    low:  '<span class="lv-badge low">성장 중</span>',
  };
  const TREND = {
    up:   '<span class="trend up">▲ 상승</span>',
    down: '<span class="trend down">▼ 하락</span>',
    flat: '<span class="trend flat">➖ 유지</span>',
  };

  // ── 화면 ──
  function render(container) {
    rootEl = container;
    const students = DN.Store.getAll('students')
      .sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999));
    if (!students.length) {
      container.innerHTML = `<div class="page-head"><h1>📈 성장 분석</h1></div>
        <div class="card placeholder"><div class="ph-icon">📈</div><h2>학생을 먼저 등록해주세요</h2>
        <button class="btn-secondary" id="goStuBtn">학생 관리로 가기</button></div>`;
      const b = container.querySelector('#goStuBtn');
      if (b) b.addEventListener('click', () => DN.App.go('students'));
      return;
    }
    if (!selectedId || !students.some(s => s.id === selectedId)) selectedId = students[0].id;

    container.innerHTML = `
      <div class="page-head"><h1>📈 성장 분석</h1></div>
      <div class="card"><div class="frow"><label>학생 선택</label>
        <select id="grStu" class="stu-select">
          ${students.map(s => `<option value="${s.id}"${s.id === selectedId ? ' selected' : ''}>${esc(s.number ? s.number + '. ' : '')}${esc(s.name)}</option>`).join('')}
        </select></div></div>
      <div id="grArea"></div>`;

    container.querySelector('#grStu').addEventListener('change', e => { selectedId = e.target.value; renderArea(); });
    renderArea();
  }

  function renderArea() {
    const area = rootEl.querySelector('#grArea');
    const a = analyze(selectedId);
    const student = DN.Store.get('students', selectedId);

    if (a.obsCount === 0) {
      area.innerHTML = `<div class="card placeholder"><div class="ph-icon">🌱</div>
        <h2>아직 분석할 관찰 기록이 없어요</h2>
        <p class="desc">관찰 기록이 쌓이면 ${esc(student.name)} 학생의 성장 변화를 그래프로 보여드립니다.</p>
        <button class="btn-secondary" id="goObs">관찰 기록 남기러 가기</button></div>`;
      area.querySelector('#goObs').addEventListener('click', () => DN.App.go('observe'));
      return;
    }

    area.innerHTML = `
      <div class="stat-grid">
        ${stat('📝', '관찰 기록', a.obsCount + '건', '#667eea')}
        ${stat('💬', '상담 기록', a.counCount + '건', '#ffa726')}
        ${stat('💪', '강점 영역', a.strengths.length + '개', '#43a047')}
        ${stat('🌱', '지원 필요', a.supports.length + '개', '#ef5350')}
      </div>

      <div class="card">
        <h2>영역별 성장 추이</h2>
        <div class="growth-list">
          ${a.withData.map(i => `
            <div class="growth-row">
              <div class="gr-label">${esc(i.label)} ${LEVEL_BADGE[i.level]}</div>
              <div class="gr-spark">${sparkline(i.seq)}</div>
              <div class="gr-bar"><div class="gr-bar-fill" style="width:${Math.round((i.avg/3)*100)}%"></div></div>
              <div class="gr-trend">${i.trend ? TREND[i.trend] : ''}</div>
            </div>`).join('')}
        </div>
        ${a.items.filter(i => i.count === 0).length ? `<p class="hint">기록이 없는 영역: ${a.items.filter(i => i.count === 0).map(i => esc(i.label)).join(', ')}</p>` : ''}
      </div>

      <div class="card summary-card">
        <h2>📋 종합 요약</h2>
        ${a.strengths.length ? `<p class="sum-line"><b class="c-green">💪 강점</b> ${a.strengths.map(i => esc(i.label)).join(', ')} — 꾸준히 우수한 모습을 보입니다.</p>` : ''}
        ${a.improving.length ? `<p class="sum-line"><b class="c-blue">📈 성장 중</b> ${a.improving.map(i => esc(i.label)).join(', ')} — 점점 향상되고 있어요.</p>` : ''}
        ${a.supports.length ? `<p class="sum-line"><b class="c-red">🌱 지원 필요</b> ${a.supports.map(i => esc(i.label)).join(', ')} — 따뜻한 격려가 필요합니다.</p>` : ''}
        ${!a.strengths.length && !a.improving.length && !a.supports.length ? '<p class="desc">데이터가 더 쌓이면 더 정확한 분석을 제공합니다.</p>' : ''}
        <button class="btn-primary" id="toReport" style="margin-top:0.6rem">📋 이 분석으로 행동특성 작성하기 →</button>
      </div>`;

    area.querySelector('#toReport').addEventListener('click', () => {
      DN.Report.setStudent(selectedId);
      DN.App.go('report');
    });
  }

  function stat(icon, label, value, color) {
    return `<div class="stat-card" style="--c:${color}"><div class="sc-icon">${icon}</div>
      <div class="sc-body"><div class="sc-value">${esc(value)}</div><div class="sc-label">${esc(label)}</div></div></div>`;
  }

  function setStudent(id) { selectedId = id; }

  return { render, analyze, setStudent };
})();
