// ════════════════════════════════════════════════════
//  담임노트+ · 출석 관리 (DN.Attendance)
//  - 날짜별 출석 입력(기본값: 출석) / 월별 현황표 / 학생별 조회
//  - 저장 구조: attendance 컬렉션에 날짜당 레코드 1건
//    { date:'YYYY-MM-DD', marks:{ [studentId]: status } }
//    marks에는 '출석이 아닌 학생'만 저장 → 없는 학생은 출석으로 간주
//    (명단에 늦게 추가된 학생도 자동으로 출석 처리되는 구조)
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Attendance = (function () {
  const { esc, toast, today, fmtDate } = DN.utils;

  // t: 버튼용 짧은 이름 / full: 정식 명칭(범례·툴팁·조회용) / s: 월별 표 기호
  const STATUSES = [
    { v: 'present', t: '출석',   full: '출석',                    s: '',   cls: 'p' },
    { v: 'late',    t: '지각',   full: '지각',                    s: '지', cls: 'late' },
    { v: 'early',   t: '조퇴',   full: '조퇴',                    s: '조', cls: 'early' },
    { v: 'sick',    t: '병결',   full: '병결',                    s: '병', cls: 'sick' },
    { v: 'trip',    t: '체험',   full: '학교장허가 교외체험학습',  s: '체', cls: 'trip' },
    { v: 'excused', t: '인정',   full: '인정결석',                s: '인', cls: 'exc' },
    { v: 'absent',  t: '미인정', full: '미인정결석',              s: '미', cls: 'abs' },
  ];
  const ST_MAP = Object.fromEntries(STATUSES.map(s => [s.v, s]));
  const NON_PRESENT = STATUSES.filter(s => s.v !== 'present');
  const LEGACY = { skip: 'absent' }; // 옛 '결과' 상태는 미인정결석으로 해석

  let tab = 'day';               // 'day' | 'month'
  let curDate = null;            // 일별 입력 날짜
  let curMonth = null;           // 'YYYY-MM'
  let detailId = '';             // 학생별 조회 대상
  let rootEl = null;

  // ── 데이터 접근 ──
  function recordOf(date) {
    return DN.Store.query('attendance', a => a.date === date)[0] || null;
  }
  function statusOf(rec, sid) {
    const raw = (rec && rec.marks && rec.marks[sid]) || 'present';
    return LEGACY[raw] || raw;
  }
  function memoOf(rec, sid) {
    return (rec && rec.memos && rec.memos[sid]) || '';
  }
  // 오늘 출석 입력 여부 (대시보드 알림용)
  function isTodayDone() {
    return !!recordOf(today());
  }

  function sortedStudents() {
    return DN.Store.getAll('students')
      .sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999));
  }

  // ── 진입점 ──
  function render(container) {
    rootEl = container;
    if (!curDate) curDate = today();
    if (!curMonth) curMonth = today().slice(0, 7);

    const students = sortedStudents();
    if (!students.length) {
      container.innerHTML = `<div class="page-head"><h1>📅 출석부</h1></div>
        <div class="card placeholder"><div class="ph-icon">📅</div><h2>학생을 먼저 등록해주세요</h2>
        <p class="desc">학생 명단이 있어야 출석을 기록할 수 있어요.</p>
        <button class="btn-secondary" id="goStuBtn">학생 관리로 가기</button></div>`;
      container.querySelector('#goStuBtn').addEventListener('click', () => DN.App.go('students'));
      return;
    }

    container.innerHTML = `
      <div class="page-head"><h1>📅 출석부</h1></div>
      <div class="card">
        <div class="seg" id="attTab">
          <button type="button" class="seg-btn${tab === 'day' ? ' on' : ''}" data-tab="day">✏️ 일별 입력</button>
          <button type="button" class="seg-btn${tab === 'month' ? ' on' : ''}" data-tab="month">📊 월별 현황</button>
        </div>
      </div>
      <div id="attArea"></div>`;

    container.querySelectorAll('#attTab .seg-btn').forEach(b => b.addEventListener('click', () => {
      tab = b.dataset.tab;
      container.querySelectorAll('#attTab .seg-btn').forEach(x => x.classList.toggle('on', x === b));
      renderArea();
    }));
    renderArea();
  }

  function renderArea() {
    if (tab === 'month') renderMonth();
    else renderDay();
  }

  // ── 일별 입력 ──
  function renderDay() {
    const area = rootEl.querySelector('#attArea');
    const students = sortedStudents();
    const rec = recordOf(curDate);
    const saved = !!rec;

    area.innerHTML = `
      <div class="card">
        <div class="frow">
          <label>날짜</label>
          <input type="date" id="attDate" value="${esc(curDate)}" style="width:170px">
          ${saved ? '<span class="att-saved">✅ 저장됨</span>' : '<span class="att-unsaved">아직 저장 안 됨</span>'}
          <button class="btn-ghost" id="attAllP" style="margin-left:auto">😊 모두 출석으로</button>
        </div>
        <p class="hint">💡 기본값은 <b>출석</b>이에요. 출석이 아닌 학생만 눌러서 바꾸면 사유 칸이 나타나요. (체험 = 학교장허가 교외체험학습)</p>
        <div class="att-rows" id="attRows">
          ${students.map(s => {
            const cur = statusOf(rec, s.id);
            const memo = memoOf(rec, s.id);
            return `<div class="att-row">
              <span class="as-no">${esc(s.number || '')}</span>
              <span class="as-name">${esc(s.name)}</span>
              <div class="seg att-seg">
                ${STATUSES.map(st => `<button type="button" class="seg-btn att-${st.cls}${cur === st.v ? ' on' : ''}" data-sid="${s.id}" data-v="${st.v}" title="${st.full}">${st.t}</button>`).join('')}
              </div>
              <input type="text" class="att-memo" data-sid="${s.id}" value="${esc(memo)}" placeholder="사유" style="${cur === 'present' ? 'display:none' : ''}">
            </div>`;
          }).join('')}
        </div>
        <button class="btn-primary full" id="attSave">💾 ${esc(fmtDate(curDate))} 출석 저장</button>
      </div>`;

    area.querySelector('#attDate').addEventListener('change', e => {
      curDate = e.target.value || today();
      renderDay();
    });
    area.querySelectorAll('.att-seg .seg-btn').forEach(btn => btn.addEventListener('click', () => {
      const seg = btn.closest('.att-seg');
      seg.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      // 출석이 아니면 사유 칸 표시(+포커스), 출석이면 숨기고 비움
      const memo = seg.parentElement.querySelector('.att-memo');
      if (btn.dataset.v === 'present') { memo.style.display = 'none'; memo.value = ''; }
      else { memo.style.display = ''; memo.focus(); }
    }));
    area.querySelector('#attAllP').addEventListener('click', () => {
      area.querySelectorAll('.att-seg').forEach(seg => {
        seg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('on', b.dataset.v === 'present'));
      });
      area.querySelectorAll('.att-memo').forEach(m => { m.style.display = 'none'; m.value = ''; });
    });
    area.querySelector('#attSave').addEventListener('click', saveDay);
  }

  function saveDay() {
    const marks = {}, memos = {};
    rootEl.querySelectorAll('.att-seg .seg-btn.on').forEach(b => {
      if (b.dataset.v !== 'present') marks[b.dataset.sid] = b.dataset.v; // 출석은 저장 안 함(기본값)
    });
    rootEl.querySelectorAll('.att-memo').forEach(m => {
      const v = m.value.trim();
      if (v && marks[m.dataset.sid]) memos[m.dataset.sid] = v; // 사유는 출석 외 상태에만
    });
    const rec = recordOf(curDate);
    if (rec) DN.Store.update('attendance', rec.id, { marks, memos });
    else DN.Store.add('attendance', { date: curDate, marks, memos });
    const n = Object.keys(marks).length;
    toast(`${fmtDate(curDate)} 출석 저장 완료!${n ? ` (출석 외 ${n}명)` : ' (전원 출석)'}`, 'success');
    renderDay();
  }

  // ── 월별 현황 ──
  function daysInMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }

  function renderMonth() {
    const area = rootEl.querySelector('#attArea');
    const students = sortedStudents();
    const nDays = daysInMonth(curMonth);
    const [y, m] = curMonth.split('-').map(Number);

    // 이 달의 기록을 날짜 → 레코드 맵으로
    const recs = {};
    DN.Store.query('attendance', a => (a.date || '').startsWith(curMonth + '-'))
      .forEach(a => { recs[a.date] = a; });

    const dayMeta = [];
    for (let d = 1; d <= nDays; d++) {
      const date = `${curMonth}-${String(d).padStart(2, '0')}`;
      const dow = new Date(y, m - 1, d).getDay();
      dayMeta.push({ d, date, we: dow === 0 || dow === 6 });
    }

    const rows = students.map(s => {
      const counts = {};
      NON_PRESENT.forEach(st => counts[st.v] = 0);
      const cells = dayMeta.map(dm => {
        const rec = recs[dm.date];
        if (!rec) return `<td class="${dm.we ? 'we' : ''}"></td>`;
        const st = statusOf(rec, s.id);
        if (st === 'present') return `<td class="${dm.we ? 'we' : ''} ok">·</td>`;
        counts[st]++;
        const info = ST_MAP[st];
        const memo = memoOf(rec, s.id);
        return `<td class="${dm.we ? 'we' : ''} m-${info.cls}" title="${dm.d}일 ${info.full}${memo ? ' — ' + esc(memo) : ''}">${info.s}</td>`;
      }).join('');
      const total = NON_PRESENT.map(st => counts[st.v] ? `<span class="att-cnt m-${st.cls}">${st.s}${counts[st.v]}</span>` : '').join('');
      return `<tr>
        <td class="att-name-col"><b>${esc(s.number || '')}</b> ${esc(s.name)}</td>
        ${cells}
        <td class="att-total">${total || '<span class="ok-all">개근</span>'}</td>
      </tr>`;
    }).join('');

    const recorded = Object.keys(recs).length;

    area.innerHTML = `
      <div class="card">
        <div class="frow">
          <label>월 선택</label>
          <input type="month" id="attMonth" value="${esc(curMonth)}" style="width:160px">
          <span class="count-chip">기록 ${recorded}일</span>
        </div>
        <div class="att-legend">
          ${NON_PRESENT.map(st => `<span class="att-cnt m-${st.cls}">${st.s} ${st.full}</span>`).join('')}
          <span class="att-cnt ok">· 출석</span>
        </div>
        ${recorded ? `
        <div class="att-scroll">
          <table class="att-table">
            <thead><tr>
              <th class="att-name-col">학생</th>
              ${dayMeta.map(dm => `<th class="${dm.we ? 'we' : ''}">${dm.d}</th>`).join('')}
              <th class="att-total">합계</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>` : '<p class="empty">이 달에는 아직 출석 기록이 없습니다. [일별 입력]에서 출석을 저장해보세요.</p>'}
      </div>

      <div class="card">
        <div class="card-head"><h2>👦 학생별 출석 기록</h2></div>
        <div class="frow"><label>학생</label>
          <select id="attStu" class="stu-select">
            <option value="">선택하세요</option>
            ${students.map(s => `<option value="${s.id}"${detailId === s.id ? ' selected' : ''}>${esc(s.number ? s.number + '. ' : '')}${esc(s.name)}</option>`).join('')}
          </select>
        </div>
        <div id="attDetail"></div>
      </div>`;

    area.querySelector('#attMonth').addEventListener('change', e => {
      curMonth = e.target.value || today().slice(0, 7);
      renderMonth();
    });
    area.querySelector('#attStu').addEventListener('change', e => {
      detailId = e.target.value;
      renderDetail();
    });
    renderDetail();
  }

  // 학생별 조회: 출석이 아니었던 날 전체(전 기간) 목록
  function renderDetail() {
    const box = rootEl.querySelector('#attDetail');
    if (!box) return;
    if (!detailId) { box.innerHTML = ''; return; }
    const items = DN.Store.query('attendance', a => a.marks && a.marks[detailId] && a.marks[detailId] !== 'present')
      .map(a => ({ date: a.date, st: ST_MAP[statusOf(a, detailId)] || null, memo: memoOf(a, detailId) }))
      .filter(x => x.st)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const totalDays = DN.Store.count('attendance');
    if (!items.length) {
      box.innerHTML = `<p class="desc">🎉 기록된 ${totalDays}일 동안 모두 출석했어요!</p>`;
      return;
    }
    const counts = {};
    items.forEach(x => { counts[x.st.v] = (counts[x.st.v] || 0) + 1; });
    box.innerHTML = `
      <div class="att-legend">
        ${NON_PRESENT.filter(st => counts[st.v]).map(st => `<span class="att-cnt m-${st.cls}">${st.full} ${counts[st.v]}회</span>`).join('')}
        <span class="att-cnt ok">기록 ${totalDays}일 중</span>
      </div>
      <div class="att-detail-list">
        ${items.map(x => `<div class="att-detail-row"><span class="att-dd">${esc(fmtDate(x.date))}</span><span class="att-cnt m-${x.st.cls}">${x.st.full}</span>${x.memo ? `<span class="att-memo-view">${esc(x.memo)}</span>` : ''}</div>`).join('')}
      </div>`;
  }

  return { render, isTodayDone };
})();
