// ════════════════════════════════════════════════════
//  담임노트+ · 행동특성 및 종합의견 작성 (DN.Report)
//  - 관찰·상담·성장분석·교사메모를 종합해 초안 자동 생성
//  - 객관적·성장중심·긍정 표현 / 출력 길이: 짧게·보통·자세히
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Report = (function () {
  const { esc, toast, today, fmtDate, confirmAsk, copy } = DN.utils;
  const MODES = [{ v: 'short', t: '짧게' }, { v: 'normal', t: '보통' }, { v: 'detail', t: '자세히' }];
  const MODE_T = { short: '짧게', normal: '보통', detail: '자세히' };

  let selectedId = null;
  let mode = 'normal';
  let rootEl = null;

  function setStudent(id) { selectedId = id; }

  function render(container) {
    rootEl = container;
    const students = DN.Store.getAll('students')
      .sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999));
    if (!students.length) {
      container.innerHTML = `<div class="page-head"><h1>📋 행동특성 작성</h1></div>
        <div class="card placeholder"><div class="ph-icon">📋</div><h2>학생을 먼저 등록해주세요</h2>
        <button class="btn-secondary" id="goStuBtn">학생 관리로 가기</button></div>`;
      const b = container.querySelector('#goStuBtn');
      if (b) b.addEventListener('click', () => DN.App.go('students'));
      return;
    }
    if (!selectedId || !students.some(s => s.id === selectedId)) selectedId = students[0].id;

    container.innerHTML = `
      <div class="page-head"><h1>📋 행동특성 및 종합의견</h1></div>
      <div class="card">
        <div class="frow"><label>학생 선택</label>
          <select id="rpStu" class="stu-select">
            ${students.map(s => `<option value="${s.id}"${s.id === selectedId ? ' selected' : ''}>${esc(s.number ? s.number + '. ' : '')}${esc(s.name)}</option>`).join('')}
          </select>
          <button class="btn-secondary" id="rpExport">📑 전체 초안 엑셀(CSV)</button>
        </div>
        <p class="hint">💡 반 전체 학생의 <b>최근 저장 초안</b>을 한 파일로 내보냅니다. 초안이 없는 학생은 빈 칸으로 표시돼요.</p>
      </div>
      <div id="rpArea"></div>`;

    container.querySelector('#rpStu').addEventListener('change', e => { selectedId = e.target.value; renderArea(); });
    container.querySelector('#rpExport').addEventListener('click', exportAllCsv);
    renderArea();
  }

  function renderArea() {
    const area = rootEl.querySelector('#rpArea');
    const a = DN.Growth.analyze(selectedId);

    area.innerHTML = `
      <div class="card">
        <h2>초안 생성</h2>
        <div class="data-summary">
          📝 관찰 <b>${a.obsCount}</b>건 · 💬 상담 <b>${a.counCount}</b>건
          ${a.strengths.length ? ` · 💪 강점 ${a.strengths.map(i => esc(i.label)).join(', ')}` : ''}
        </div>
        <div class="frow" style="margin-top:0.7rem"><label>분량</label>
          <div class="seg" id="modeSeg">
            ${MODES.map(m => `<button type="button" class="seg-btn${mode === m.v ? ' on' : ''}" data-mode="${m.v}">${m.t}</button>`).join('')}
          </div>
        </div>
        <div class="frow col"><label>교사 메모 <small class="muted">(선택 — 초안에 덧붙여집니다)</small></label>
          <textarea id="rpMemo" rows="2" placeholder="추가로 담고 싶은 내용을 적으면 초안 뒤에 함께 들어갑니다."></textarea></div>
        <button class="btn-primary full" id="genBtn">✨ 행동특성 초안 생성</button>
      </div>

      <div class="card">
        <div class="card-head"><h2>✏️ 초안 (수정 가능)</h2><span class="char-count" id="charCount">0자</span></div>
        <textarea id="rpOut" rows="6" placeholder="위 [초안 생성] 버튼을 누르면 종합 의견 초안이 만들어집니다."></textarea>
        <div class="result-actions" style="margin-top:0.7rem">
          <button class="btn-save" id="rpSave">💾 저장</button>
          <button class="btn-secondary" id="rpCopy">📋 복사</button>
        </div>
        <div class="principle">
          ✅ <b>작성 원칙</b> — 객관적 · 교육적 · 성장 중심 · 긍정 표현 / 과장·낙인 표현은 배제합니다. 생성된 초안은 반드시 검토·수정 후 사용하세요.
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>📑 저장된 초안</h2></div>
        <div id="rpHist"></div>
      </div>`;

    // 모드 토글
    area.querySelectorAll('#modeSeg .seg-btn').forEach(b => b.addEventListener('click', () => {
      mode = b.dataset.mode;
      area.querySelectorAll('#modeSeg .seg-btn').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
    }));
    area.querySelector('#genBtn').addEventListener('click', generate);
    area.querySelector('#rpSave').addEventListener('click', saveDraft);
    area.querySelector('#rpCopy').addEventListener('click', () => {
      const t = area.querySelector('#rpOut').value.trim();
      if (!t) return toast('복사할 내용이 없습니다.', 'error');
      copy(t);
    });
    const out = area.querySelector('#rpOut');
    out.addEventListener('input', updateCount);
    renderHistory();
    updateCount();
  }

  function generate() {
    const a = DN.Growth.analyze(selectedId);
    const student = DN.Store.get('students', selectedId);
    let text = DN.NLG.behaviorReport(a, student, mode);
    const memo = rootEl.querySelector('#rpMemo').value.trim();
    if (memo) text = (text + ' ' + memo).trim();
    if (!text) {
      text = '';
      toast('관찰 기록을 입력하면 더 풍부한 초안이 생성됩니다.', 'info');
    } else {
      toast('초안을 생성했습니다!', 'success');
    }
    rootEl.querySelector('#rpOut').value = text;
    updateCount();
  }

  const NEIS_LIMIT = 500; // NEIS 행동특성 및 종합의견 글자수 기준

  function updateCount() {
    const t = rootEl.querySelector('#rpOut').value;
    const el = rootEl.querySelector('#charCount');
    el.textContent = `${t.length}자 / ${NEIS_LIMIT}자`;
    el.classList.toggle('over', t.length > NEIS_LIMIT);
  }

  function saveDraft() {
    const text = rootEl.querySelector('#rpOut').value.trim();
    if (!text) { toast('저장할 초안이 없습니다.', 'error'); return; }
    DN.Store.add('reports', { studentId: selectedId, date: today(), mode, text });
    renderHistory();
    toast('초안을 저장했습니다!', 'success');
  }

  function renderHistory() {
    const list = DN.Store.query('reports', r => r.studentId === selectedId)
      .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    const box = rootEl.querySelector('#rpHist');
    if (!list.length) { box.innerHTML = '<p class="empty">저장된 초안이 없습니다.</p>'; return; }
    box.innerHTML = list.map(r => `
      <div class="draft-item">
        <div class="draft-meta">
          <span class="hist-no">${MODE_T[r.mode] || ''}</span>
          <span class="hist-date">${esc(r.date || fmtDate(r.createdAt))}</span>
          <button class="ic" data-load="${r.id}" title="불러오기">↩️</button>
          <button class="ic" data-copy="${r.id}" title="복사">📋</button>
          <button class="ic del" data-del="${r.id}" title="삭제">✕</button>
        </div>
        <div class="draft-text">${esc(r.text)}</div>
      </div>`).join('');

    box.querySelectorAll('[data-load]').forEach(b => b.addEventListener('click', () => {
      const r = DN.Store.get('reports', b.dataset.load);
      if (r) { rootEl.querySelector('#rpOut').value = r.text; updateCount(); toast('초안을 불러왔습니다.', 'info'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    }));
    box.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
      const r = DN.Store.get('reports', b.dataset.copy);
      if (r) copy(r.text);
    }));
    box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      if (!confirmAsk('이 초안을 삭제할까요?')) return;
      DN.Store.remove('reports', b.dataset.del);
      renderHistory();
      toast('삭제되었습니다.', 'info');
    }));
  }

  // ── 전체 초안 엑셀(CSV) 내보내기 ──
  // 학생별 최근 저장 초안 1건씩. 초안이 없는 학생도 빈 행으로 포함해 누락을 확인할 수 있게 함.
  function exportAllCsv() {
    const students = DN.Store.getAll('students')
      .sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999));
    if (!students.length) { toast('학생이 없습니다.', 'error'); return; }
    const reports = DN.Store.getAll('reports');
    const rows = [['번호', '이름', '작성일', '분량', '글자수', '행동특성 및 종합의견']];
    let done = 0;
    students.forEach(s => {
      const latest = reports.filter(r => r.studentId === s.id)
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
      if (latest) done++;
      rows.push([
        s.number || '', s.name,
        latest ? (latest.date || fmtDate(latest.createdAt)) : '',
        latest ? (MODE_T[latest.mode] || '') : '',
        latest ? latest.text.length : '',
        latest ? latest.text : '',
      ]);
    });
    DN.utils.csvDownload(`행동특성_${today()}.csv`, rows);
    toast(`${done}/${students.length}명 초안을 내려받았습니다!${done < students.length ? ' (미작성 학생은 빈 칸)' : ''}`, 'success');
  }

  return { render, setStudent };
})();
