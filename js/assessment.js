// ════════════════════════════════════════════════════
//  담임노트+ · 수행평가 기록 (DN.Assessment)
//  - 평가(과제) 생성 → 학생별 성취수준/점수 입력 → 조회
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Assessment = (function () {
  const { esc, toast, today, fmtDate, confirmAsk } = DN.utils;
  const SUBJECTS = ['국어', '수학', '사회', '과학', '영어', '음악', '미술', '체육', '도덕', '실과', '창체'];
  const LEVELS = [
    { v: 'high', t: '매우 잘함' }, { v: 'mid', t: '잘함' },
    { v: 'low', t: '보통' }, { v: 'need', t: '노력 요함' },
  ];
  const LEVEL_T = { high: '매우 잘함', mid: '잘함', low: '보통', need: '노력 요함', '': '–' };

  let view = 'list';      // 'list' | 'edit' | 'review'
  let editId = null;
  let pendingDraft = null; // PDF 단일 초안
  let pendingList = null;  // PDF 다중 초안(전과목)
  let selectedIds = new Set(); // 목록 다중 선택
  let rootEl = null;

  function render(container) {
    rootEl = container;
    const students = DN.Store.getAll('students');
    if (!students.length) {
      container.innerHTML = `<div class="page-head"><h1>📊 수행평가</h1></div>
        <div class="card placeholder"><div class="ph-icon">📊</div><h2>학생을 먼저 등록해주세요</h2>
        <button class="btn-secondary" id="goStuBtn">학생 관리로 가기</button></div>`;
      container.querySelector('#goStuBtn').addEventListener('click', () => DN.App.go('students'));
      return;
    }
    if (view === 'edit') renderEdit();
    else if (view === 'review') renderReview();
    else renderList();
  }

  // ── 평가 목록 ──
  function renderList() {
    const list = DN.Store.getAll('assessments').sort((a, b) => (b.date || '') < (a.date || '') ? -1 : 1);
    const total = DN.Store.count('students');
    rootEl.innerHTML = `
      <div class="page-head"><h1>📊 수행평가</h1></div>
      <div class="card">
        <div class="result-actions">
          <button class="btn-primary" id="newBtn">+ 새 평가 만들기</button>
          <button class="btn-secondary" id="pdfBtn">📄 PDF 계획서 불러오기</button>
          <button class="btn-secondary" id="csvAllBtn">📑 결과 엑셀(CSV) 내려받기</button>
        </div>
        <input type="file" id="pdfFile" accept="application/pdf,.pdf" style="display:none">
        <p class="hint">💡 수행평가 계획서 PDF를 올리면 과목·평가명·방식을 자동으로 채워 평가창을 띄웁니다. <small class="muted">(표 양식이 다른 학교 계획서는 인식이 안 될 수 있어요 — 그땐 ‘새 평가 만들기’로 직접 입력)</small><br>💡 엑셀 내려받기는 학생×평가 종합표를 만듭니다. 아래에서 평가를 체크하면 <b>선택한 평가만</b> 내보내요.</p>
      </div>
      <div class="card">
        <div class="card-head"><h2>평가 목록</h2><span class="count-chip">${list.length}개</span>
          ${list.length ? '<label class="sel-all"><input type="checkbox" id="chkAll"> 전체 선택</label>' : ''}
          <button class="btn-danger-sm" id="delSel" style="display:none">🗑️ 선택 삭제 (<span id="selCnt">0</span>)</button>
        </div>
        ${list.length ? `<div class="assess-list">${list.map(a => {
          const done = a.results ? Object.values(a.results).filter(r => r && r.value).length : 0;
          return `<div class="assess-item">
            <input type="checkbox" class="as-chk" data-chk="${a.id}">
            <div class="ai-body" data-open="${a.id}">
              <div class="ai-title"><span class="ai-subj">${esc(a.subject || '')}</span> ${esc(a.title || '')}${a.period ? ` <span class="ai-period">${esc(a.period)}</span>` : ''}</div>
              <div class="ai-meta">${a.standard ? esc(a.standard) + ' · ' : ''}${a.method ? esc(a.method) + ' · ' : ''}${a.scaleType === 'score' ? '점수(' + esc(a.max) + '점)' : '성취수준'} · 입력 ${done}/${total}명</div>
            </div>
            <button class="ic edit" data-edit="${a.id}" title="수정">✏️</button>
            <button class="ic del" data-del="${a.id}" title="삭제">✕</button>
          </div>`;
        }).join('')}</div>` : '<p class="empty">아직 만든 평가가 없습니다. 새 평가를 만들어보세요.</p>'}
      </div>`;

    const openEdit = id => { editId = id; pendingDraft = null; view = 'edit'; renderEdit(); };
    rootEl.querySelector('#newBtn').addEventListener('click', () => { editId = null; pendingDraft = null; view = 'edit'; renderEdit(); });
    rootEl.querySelector('#csvAllBtn').addEventListener('click', exportMatrixCsv);
    rootEl.querySelector('#pdfBtn').addEventListener('click', () => rootEl.querySelector('#pdfFile').click());
    rootEl.querySelector('#pdfFile').addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) importFromPdf(f);
      e.target.value = '';
    });
    rootEl.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openEdit(b.dataset.open)));
    rootEl.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEdit(b.dataset.edit)));
    rootEl.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      const a = DN.Store.get('assessments', b.dataset.del);
      if (!confirmAsk(`'${a ? a.subject + ' ' + a.title : '이 평가'}'를 삭제할까요?`)) return;
      DN.Store.remove('assessments', b.dataset.del);
      renderList();
      toast('삭제되었습니다.', 'info');
    }));
    // 다중 선택
    const updateSel = () => {
      const n = selectedIds.size;
      const btn = rootEl.querySelector('#delSel');
      btn.style.display = n ? 'inline-block' : 'none';
      const c = rootEl.querySelector('#selCnt'); if (c) c.textContent = n;
      const all = rootEl.querySelector('#chkAll');
      if (all) { const boxes = rootEl.querySelectorAll('.as-chk'); all.checked = boxes.length > 0 && [...boxes].every(b => b.checked); }
    };
    rootEl.querySelectorAll('.as-chk').forEach(chk => chk.addEventListener('change', () => {
      if (chk.checked) selectedIds.add(chk.dataset.chk); else selectedIds.delete(chk.dataset.chk);
      updateSel();
    }));
    const chkAll = rootEl.querySelector('#chkAll');
    if (chkAll) chkAll.addEventListener('change', () => {
      rootEl.querySelectorAll('.as-chk').forEach(c => {
        c.checked = chkAll.checked;
        if (chkAll.checked) selectedIds.add(c.dataset.chk); else selectedIds.delete(c.dataset.chk);
      });
      updateSel();
    });
    rootEl.querySelector('#delSel').addEventListener('click', () => {
      if (!selectedIds.size) return;
      if (!confirmAsk(`선택한 ${selectedIds.size}개 평가를 삭제할까요?`)) return;
      selectedIds.forEach(id => DN.Store.remove('assessments', id));
      const n = selectedIds.size;
      renderList();
      toast(`${n}개 평가를 삭제했습니다.`, 'info');
    });
  }

  // ── 평가 작성/입력 ──
  function renderEdit() {
    const rec = editId ? DN.Store.get('assessments', editId) : null;
    const a = rec || pendingDraft || { subject: '국어', unit: '', title: '', date: today(), scaleType: 'level', max: 100, results: {} };
    const students = DN.Store.getAll('students')
      .sort((b, c) => (parseInt(b.number) || 999) - (parseInt(c.number) || 999));

    rootEl.innerHTML = `
      <div class="page-head"><h1>📊 ${editId ? '수행평가 입력' : a.rawText ? 'PDF에서 불러온 평가' : '새 수행평가'}</h1></div>
      ${a.rawText ? `<div class="card pdf-loaded">
        <div class="card-head"><h2>📄 PDF에서 불러왔어요</h2></div>
        <p class="desc">아래 항목이 자동으로 채워졌습니다. 확인·수정 후 저장하세요. 한 계획서에 여러 평가가 있으면 저장 후 [새 평가]로 이어서 입력하세요.</p>
        <details><summary>추출된 원문 보기</summary><textarea class="raw-text" rows="9" readonly>${esc(a.rawText)}</textarea></details>
      </div>` : ''}
      <div class="card">
        <div class="frow">
          <label>교과</label>
          <select id="asSubj">${SUBJECTS.map(s => `<option${a.subject === s ? ' selected' : ''}>${s}</option>`).join('')}</select>
          <label>평가시기</label><input type="text" id="asPeriod" value="${esc(a.period || '')}" placeholder="예) 5월" style="width:90px">
        </div>
        <div class="frow"><label>평가명</label><input type="text" id="asTitle" value="${esc(a.title || '')}" placeholder="평가명(단원)"></div>
        <div class="frow"><label>영역</label><input type="text" id="asArea" value="${esc(a.area || '')}" style="width:150px"><label>단원</label><input type="text" id="asUnit" value="${esc(a.unit || '')}"></div>
        <div class="frow col"><label>성취기준</label><textarea id="asStandard" rows="2" placeholder="[4국03-02] …">${esc(a.standard || '')}</textarea></div>
        <div class="frow col"><label>평가 요소</label><textarea id="asElement" rows="2">${esc(a.element || '')}</textarea></div>
        <div class="frow col"><label>수업·평가 연계의 주안점</label><textarea id="asFocus" rows="3">${esc(a.focus || '')}</textarea></div>
        <div class="frow">
          <label>날짜</label><input type="date" id="asDate" value="${esc(a.date || today())}" style="width:160px">
          <label>방식</label>
          <label class="radio"><input type="radio" name="asScale" value="level"${a.scaleType !== 'score' ? ' checked' : ''}> 성취수준</label>
          <label class="radio"><input type="radio" name="asScale" value="score"${a.scaleType === 'score' ? ' checked' : ''}> 점수</label>
          <span class="score-max" style="${a.scaleType === 'score' ? '' : 'display:none'}">만점 <input type="number" id="asMax" value="${esc(a.max || 100)}" min="1" style="width:70px"></span>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>🎯 성취수준 기준</h2></div>
        <div class="lv-edit">
          <div class="lv-edit-row"><span class="lv-tag high">매우 잘함</span><textarea id="asLvHigh" rows="2">${esc(a.levels ? a.levels.high || '' : '')}</textarea></div>
          <div class="lv-edit-row"><span class="lv-tag mid">잘함</span><textarea id="asLvMid" rows="2">${esc(a.levels ? a.levels.mid || '' : '')}</textarea></div>
          <div class="lv-edit-row"><span class="lv-tag low">보통</span><textarea id="asLvLow" rows="2">${esc(a.levels ? a.levels.low || '' : '')}</textarea></div>
          <div class="lv-edit-row"><span class="lv-tag need">노력 요함</span><textarea id="asLvNeed" rows="2">${esc(a.levels ? a.levels.need || '' : '')}</textarea></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>학생별 입력</h2><span class="count-chip">${students.length}명</span></div>
        <div class="assess-input" id="asRows"></div>
      </div>

      <div class="result-actions">
        <button class="btn-primary" id="asSave">💾 저장</button>
        <button class="btn-secondary" id="asCsv">📑 결과 엑셀(CSV)</button>
        ${editId ? '<button class="btn-danger" id="asDelete">🗑️ 이 평가 삭제</button>' : ''}
        <button class="btn-cancel" id="asBack">← 목록으로</button>
      </div>`;

    renderRows(a, students);

    rootEl.querySelectorAll('input[name="asScale"]').forEach(r => r.addEventListener('change', () => {
      const score = rootEl.querySelector('input[name="asScale"][value="score"]').checked;
      rootEl.querySelector('.score-max').style.display = score ? '' : 'none';
      const snapshot = collectResults();
      renderRows(Object.assign({}, a, { scaleType: score ? 'score' : 'level', results: snapshot }), students);
    }));
    rootEl.querySelector('#asSave').addEventListener('click', save);
    rootEl.querySelector('#asCsv').addEventListener('click', exportOneCsv);
    rootEl.querySelector('#asBack').addEventListener('click', () => { pendingDraft = null; view = 'list'; renderList(); });
    const delBtn = rootEl.querySelector('#asDelete');
    if (delBtn) delBtn.addEventListener('click', () => {
      if (!confirmAsk('이 평가를 삭제할까요? 입력한 학생 점수도 함께 사라집니다.')) return;
      DN.Store.remove('assessments', editId);
      editId = null; pendingDraft = null; view = 'list'; renderList();
      toast('삭제되었습니다.', 'info');
    });
  }

  // ── PDF 계획서 불러오기(칼럼 좌표 기반) ──
  async function importFromPdf(file) {
    if (!window.pdfjsLib) { toast('PDF 모듈을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.', 'error'); return; }
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/lib/pdf.worker.min.js';
    toast('PDF를 읽는 중입니다…', 'info');
    try {
      const { evals: cands, rawText } = await extractEvaluations(file);
      const hangul = (rawText.match(/[가-힣]/g) || []).length;
      if (!cands.length) {
        if (hangul < 10) {
          // 텍스트 자체가 안 뽑힘 — 스캔본이거나 특수 글꼴 PDF
          toast('이 PDF에서는 글자를 읽을 수 없어요. (스캔·이미지 PDF이거나 특수 글꼴) 직접 입력해주세요.', 'error');
          return;
        }
        // 글자는 읽혔지만 표 양식이 달라 인식 실패 → 원문을 보여주고 직접 입력하게
        pendingDraft = { subject: '국어', unit: '', title: '', date: today(), scaleType: 'level', max: 100, results: {}, rawText };
        editId = null; view = 'edit'; renderEdit();
        toast('표 양식을 인식하지 못했어요. 아래 [추출된 원문 보기]를 참고해 직접 입력해주세요.', 'info');
        return;
      }
      if (cands.length > 1) {
        pendingList = cands;
        editId = null; view = 'review'; renderReview();
        toast(`${cands.length}개의 평가를 찾았어요! 확인 후 저장하세요.`, 'success');
      } else {
        pendingDraft = Object.assign(cands[0], { date: today(), results: {}, rawText });
        editId = null; view = 'edit'; renderEdit();
        toast('계획서를 불러왔습니다! 내용을 확인해주세요.', 'success');
      }
    } catch (e) {
      console.error(e);
      toast('PDF 처리 중 오류가 발생했습니다.', 'error');
    }
  }

  const METHOD_RE = /\[(보고서법|보고서|논술형|서술형|실기|발표|프로젝트형?|토의·토론|구술·발표|구술|동료평가|자기평가·동료평가|협력적 문제해결력 평가)[^\]]*\]/g;
  const CODE2SUBJ = { 국: '국어', 수: '수학', 사: '사회', 도: '도덕', 과: '과학', 음: '음악', 미: '미술', 영: '영어', 체: '체육' };

  // 학생평가계획 표(폭 595pt)의 칼럼 경계
  function colOf(x) {
    if (x < 55) return 'subject'; if (x < 140) return 'standard'; if (x < 168) return 'area';
    if (x < 206) return 'unit'; if (x < 258) return 'element'; if (x < 350) return 'focus';
    if (x < 545) return 'level'; return 'period';
  }

  async function extractEvaluations(file) {
    const buf = await file.arrayBuffer();
    // cMapUrl: 한글(HWP)에서 내보낸 PDF는 한국어 글꼴 매핑(cMap)이 있어야 글자가 제대로 읽힘
    const pdf = await pdfjsLib.getDocument({
      data: buf,
      cMapUrl: 'js/lib/cmaps/',
      cMapPacked: true,
    }).promise;
    const all = [];
    const rawParts = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const items = (await page.getTextContent()).items
        .filter(it => it.str.trim())
        .map(it => ({ x: it.transform[4], y: it.transform[5], s: it.str.trim(), col: colOf(it.transform[4]) }));
      rawParts.push(items.map(it => it.s).join(' '));
      all.push(...parsePageEvals(items));
    }
    // 반복되는 반 중복 제거(과목 + 성취기준 코드)
    const seen = new Set(), out = [];
    for (const e of all) {
      if (!e.codeKey) { out.push(e); continue; }
      const key = e.subject + '|' + e.codeKey;
      if (seen.has(key)) continue;
      seen.add(key); out.push(e);
    }
    return { evals: out, rawText: rawParts.join('\n\n— 다음 페이지 —\n\n') };
  }

  // 한 페이지의 표를 칼럼+행으로 분해해 평가 추출
  function parsePageEvals(items) {
    // 반복 헤더/제목 행 제거
    const hY = items.filter(a => (a.s === '교과' && a.x < 55) || /학년|^\d+\s*반$|평가계획/.test(a.s)).map(a => Math.round(a.y));
    const its = items.filter(a => !hY.some(hy => Math.abs(a.y - hy) < 4));
    const isLabel = (a, t) => a.x >= 350 && a.x < 378 && a.s.replace(/\s/g, '').startsWith(t);
    const vg = its.filter(a => isLabel(a, '매우')).map(a => a.y).sort((p, q) => q - p);
    const nf = its.filter(a => isLabel(a, '노력')).map(a => a.y).sort((p, q) => q - p);
    const evals = [];
    for (let i = 0; i < vg.length; i++) {
      const top = i === 0 ? 1e9 : (nf[i - 1] + vg[i]) / 2;
      const bot = i === vg.length - 1 ? -1e9 : (nf[i] + vg[i + 1]) / 2;
      const row = its.filter(a => a.y > bot && a.y <= top);
      const get = col => row.filter(a => a.col === col).sort((p, q) => q.y - p.y || p.x - q.x).map(a => a.s).join(' ').replace(/\s+/g, ' ').trim();
      // 성취기준 + 코드(코드 내부 공백 정리) → 과목 판정
      let standard = get('standard').replace(/\[\s*4\s*([가-힣])\s*([가-힣]*)\s*(\d{2})\s*[-–]\s*(\d{2})\s*\]/g, '[4$1$2$3-$4]');
      const codes = standard.match(/\[4[가-힣]+\d{2}-\d{2}\]/g) || [];
      const codeKey = codes.join('');
      const subject = codes.length ? (CODE2SUBJ[codes[0][2]] || '') : '';
      // 단원(평가명)
      const unitRaw = get('unit');
      const um = unitRaw.match(/(\d+)\.\s*([가-힣].{0,22})/);
      let unit = um ? um[2].trim() : unitRaw.replace(/[▪·〈〉<>\[\]]/g, '').replace(/\s+/g, ' ').trim();
      if (!unit) { const mm = (unitRaw + ' ' + get('element')).match(/매체단원|그림책\s*만들기\s*\d?/); if (mm) unit = mm[0]; }
      unit = unit.replace(/^(성취기준|평가내용|평가요소|단원|영역)\s*/, '').replace(/\s*(성취기준|통합평가).*$/, '').trim();
      const area = get('area').replace(/[▪·]/g, '').replace(/\s+/g, ' ').trim();
      const element = get('element').replace(/▪/g, ' / ').replace(/[〈〉<>]/g, '').replace(/\s+/g, ' ').replace(/^\s*\/\s*/, '').trim();
      const focus = get('focus').replace(/▪/g, ' / ').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').replace(/^\s*\/\s*/, '').trim();
      const levels = splitLevels(row, vg[i], nf[i]);
      const methods = (row.map(a => a.s).join(' ').match(METHOD_RE) || []);
      const method = [...new Set(methods.map(m => m.replace(/[\[\]]/g, '').trim()))].join(', ');
      const period = ((get('period').match(/(\d{1,2})\s*월/) || [])[1] || '');
      const title = (unit || element.split('/')[0].slice(0, 20) || subject + ' 평가').replace(/[▪·]/g, '').trim();
      if (!subject) continue; // 성취기준 코드로 과목이 확인되지 않으면 제외(창체·노이즈 행)
      evals.push({
        subject, title, unit, area, standard: standard.trim(),
        element, focus, method, period: period ? period + '월' : '', levels,
        scaleType: 'level', max: 100, codeKey,
      });
    }
    return evals;
  }

  // 성취수준 본문(level 칼럼 x≥378)을 등급 라벨 Y로 4분할
  function splitLevels(row, vgY, nfY) {
    const r = { high: '', mid: '', low: '', need: '' };
    const body = row.filter(a => a.x >= 378 && a.x < 545);
    const join = arr => arr.sort((p, q) => q.y - p.y || p.x - q.x).map(a => a.s).join(' ').replace(/\s+/g, ' ').trim();
    const goodY = row.filter(a => a.x >= 358 && a.x < 376 && a.s.replace(/\s/g, '') === '잘함' && a.y < vgY - 2).map(a => a.y).sort((p, q) => q - p)[0];
    const okY = row.filter(a => a.x >= 350 && a.x < 378 && /^보통/.test(a.s.replace(/\s/g, ''))).map(a => a.y).sort((p, q) => q - p)[0];
    if (goodY == null) { r.high = join(body); return r; }
    r.high = join(body.filter(a => a.y > goodY));
    if (okY == null) { r.mid = join(body.filter(a => a.y <= goodY)); return r; }
    r.mid = join(body.filter(a => a.y <= goodY && a.y > okY));
    r.low = join(body.filter(a => a.y <= okY && a.y > nfY));
    r.need = join(body.filter(a => a.y <= nfY));
    return r;
  }

  // ── 다중 평가 검토/일괄 저장 화면 ──
  function renderReview() {
    const list = pendingList || [];
    list.forEach(c => { if (c.selected === undefined) c.selected = true; });
    rootEl.innerHTML = `
      <div class="page-head"><h1>📊 PDF 평가 일괄 등록</h1></div>
      <div class="card pdf-loaded">
        <div class="card-head"><h2>📄 ${list.length}개의 평가를 찾았어요</h2></div>
        <p class="desc">담임이 직접 평가하는 과목만 체크하세요. <b>전담 과목(음악·미술·체육 등)은 과목 이름을 눌러 한 번에 끌 수 있어요.</b></p>
        <div class="subj-toggle" id="subjToggle"></div>
        <div class="frow"><label>평가 날짜(공통)</label><input type="date" id="revDate" value="${today()}" style="width:160px"></div>
      </div>
      <div class="card"><div id="revRows"></div></div>
      <div class="result-actions">
        <button class="btn-primary" id="revSave">💾 선택한 평가 저장 (<span id="revCount">${list.length}</span>개)</button>
        <button class="btn-cancel" id="revBack">취소</button>
      </div>`;
    renderSubjChips();
    renderRevRows();
    rootEl.querySelector('#revSave').addEventListener('click', saveAll);
    rootEl.querySelector('#revBack').addEventListener('click', () => { pendingList = null; view = 'list'; renderList(); });
  }

  // 과목별 일괄 토글 칩
  function renderSubjChips() {
    const box = rootEl.querySelector('#subjToggle');
    const subs = [...new Set(pendingList.map(c => c.subject))];
    box.innerHTML = subs.map(s => {
      const items = pendingList.filter(c => c.subject === s);
      const on = items.filter(c => c.selected).length;
      const cls = on === 0 ? 'off' : on === items.length ? 'on' : 'partial';
      return `<button class="subj-chip ${cls}" data-subj="${esc(s)}">${esc(s)} <small>${on}/${items.length}</small></button>`;
    }).join('');
    box.querySelectorAll('[data-subj]').forEach(b => b.addEventListener('click', () => {
      syncRows();
      const s = b.dataset.subj;
      const items = pendingList.filter(c => c.subject === s);
      const allOn = items.every(c => c.selected);
      items.forEach(c => c.selected = !allOn);
      renderSubjChips(); renderRevRows(); updateRevCount();
    }));
  }

  function renderRevRows() {
    const box = rootEl.querySelector('#revRows');
    box.innerHTML = pendingList.map((c, i) => `
      <div class="rev-row${c.selected ? '' : ' off'}" data-i="${i}">
        <input type="checkbox" class="rev-chk" ${c.selected ? 'checked' : ''}>
        <select class="rev-subj">${SUBJECTS.map(s => `<option${c.subject === s ? ' selected' : ''}>${s}</option>`).join('')}</select>
        <input class="rev-title" value="${esc(c.title)}" placeholder="평가명">
        <span class="rev-period">${esc(c.period || '')}</span>
        <select class="rev-scale">
          <option value="level"${c.scaleType !== 'score' ? ' selected' : ''}>성취수준</option>
          <option value="score"${c.scaleType === 'score' ? ' selected' : ''}>점수</option>
        </select>
      </div>`).join('');
    box.querySelectorAll('.rev-chk').forEach(chk => chk.addEventListener('change', () => {
      const row = chk.closest('.rev-row');
      const i = +row.dataset.i;
      pendingList[i].selected = chk.checked;
      row.classList.toggle('off', !chk.checked);
      renderSubjChips(); updateRevCount();
    }));
  }

  function updateRevCount() {
    const n = pendingList.filter(c => c.selected).length;
    const el = rootEl.querySelector('#revCount');
    if (el) el.textContent = n;
  }

  // 화면 입력값을 pendingList에 반영(체크 상태는 유지)
  function syncRows() {
    rootEl.querySelectorAll('.rev-row').forEach(row => {
      const i = +row.dataset.i;
      if (!pendingList[i]) return;
      pendingList[i].subject = row.querySelector('.rev-subj').value;
      pendingList[i].title = row.querySelector('.rev-title').value.trim();
      pendingList[i].scaleType = row.querySelector('.rev-scale').value;
    });
  }

  function saveAll() {
    syncRows();
    const date = rootEl.querySelector('#revDate').value || today();
    const valid = pendingList.filter(c => c.selected && c.title);
    if (!valid.length) { toast('선택한 평가가 없습니다. 저장할 과목을 체크해주세요.', 'error'); return; }
    valid.forEach(c => DN.Store.add('assessments', {
      subject: c.subject, unit: c.unit || '', title: c.title, date,
      scaleType: c.scaleType, max: c.max || 100, results: {},
      standard: c.standard || '', area: c.area || '', element: c.element || '',
      focus: c.focus || '', method: c.method || '', period: c.period || '',
      levels: c.levels || { high: '', mid: '', low: '', need: '' },
    }));
    pendingList = null; view = 'list'; renderList();
    toast(`${valid.length}개 평가를 한 번에 저장했어요!`, 'success');
  }

  function renderRows(a, students) {
    const score = rootEl.querySelector('input[name="asScale"][value="score"]').checked;
    const box = rootEl.querySelector('#asRows');

    // 일괄 입력 바: 체크한 학생에게 등급/점수를 한 번에
    const bulkBar = `
      <div class="as-bulk">
        <label class="sel-all"><input type="checkbox" id="asPickAll"> 전체</label>
        <span class="as-bulk-t">체크한 학생 →</span>
        ${score
          ? `<input type="number" id="asBulkScore" min="0" placeholder="점수" style="width:74px">
             <button type="button" class="btn-ghost mini" id="asBulkApply">한 번에 입력</button>`
          : LEVELS.map(l => `<button type="button" class="btn-ghost mini as-bulk-lv lv-${l.v}" data-bv="${l.v}">${l.t}</button>`).join('')}
      </div>`;

    box.innerHTML = bulkBar + students.map(s => {
      const r = (a.results && a.results[s.id]) || {};
      const input = score
        ? `<input type="number" class="as-val" data-sid="${s.id}" value="${esc(r.value || '')}" min="0" placeholder="점수" style="width:80px">`
        : `<select class="as-val" data-sid="${s.id}"><option value="">–</option>${LEVELS.map(l => `<option value="${l.v}"${r.value === l.v ? ' selected' : ''}>${l.t}</option>`).join('')}</select>`;
      return `<div class="as-row">
        <input type="checkbox" class="as-pick" data-sid="${s.id}">
        <span class="as-no">${esc(s.number || '')}</span>
        <span class="as-name">${esc(s.name)}</span>
        ${input}
        <input type="text" class="as-memo" data-sid="${s.id}" value="${esc(r.memo || '')}" placeholder="메모(선택)">
      </div>`;
    }).join('');

    // 전체 선택
    box.querySelector('#asPickAll').addEventListener('change', e => {
      box.querySelectorAll('.as-pick').forEach(c => { c.checked = e.target.checked; });
    });
    const pickedIds = () => [...box.querySelectorAll('.as-pick:checked')].map(c => c.dataset.sid);
    const applyTo = (ids, value, label) => {
      ids.forEach(sid => {
        const el = box.querySelector(`.as-val[data-sid="${sid}"]`);
        if (el) el.value = value;
      });
      box.querySelectorAll('.as-pick').forEach(c => { c.checked = false; });
      const all = box.querySelector('#asPickAll');
      if (all) all.checked = false;
      toast(`${ids.length}명에게 '${label}' 입력 완료! (저장을 눌러야 확정돼요)`, 'success');
    };
    // 성취수준: 등급 버튼
    box.querySelectorAll('.as-bulk-lv').forEach(b => b.addEventListener('click', () => {
      const ids = pickedIds();
      if (!ids.length) { toast('먼저 학생을 체크해주세요.', 'error'); return; }
      applyTo(ids, b.dataset.bv, LEVEL_T[b.dataset.bv]);
    }));
    // 점수: 입력값 적용
    const bulkApply = box.querySelector('#asBulkApply');
    if (bulkApply) bulkApply.addEventListener('click', () => {
      const ids = pickedIds();
      if (!ids.length) { toast('먼저 학생을 체크해주세요.', 'error'); return; }
      const v = box.querySelector('#asBulkScore').value.trim();
      if (v === '') { toast('점수를 입력해주세요.', 'error'); return; }
      applyTo(ids, v, v + '점');
    });
  }

  function collectResults() {
    const results = {};
    rootEl.querySelectorAll('.as-val').forEach(el => {
      const sid = el.dataset.sid;
      const memo = rootEl.querySelector(`.as-memo[data-sid="${sid}"]`);
      const val = el.value;
      if (val || (memo && memo.value.trim())) results[sid] = { value: val, memo: memo ? memo.value.trim() : '' };
    });
    return results;
  }

  function save() {
    const base = editId ? (DN.Store.get('assessments', editId) || {}) : (pendingDraft || {});
    const q = s => rootEl.querySelector(s);
    const data = {
      subject: q('#asSubj').value,
      title: q('#asTitle').value.trim(),
      area: q('#asArea').value.trim(),
      unit: q('#asUnit').value.trim(),
      standard: q('#asStandard').value.trim(),
      element: q('#asElement').value.trim(),
      focus: q('#asFocus').value.trim(),
      period: q('#asPeriod').value.trim(),
      date: q('#asDate').value || today(),
      scaleType: q('input[name="asScale"][value="score"]').checked ? 'score' : 'level',
      max: parseInt(q('#asMax') ? q('#asMax').value : 100) || 100,
      method: base.method || '',
      levels: {
        high: q('#asLvHigh').value.trim(), mid: q('#asLvMid').value.trim(),
        low: q('#asLvLow').value.trim(), need: q('#asLvNeed').value.trim(),
      },
      results: collectResults(),
    };
    if (!data.title) { toast('평가명을 입력해주세요.', 'error'); return; }
    if (editId) { DN.Store.update('assessments', editId, data); toast('수정했습니다!', 'success'); }
    else { DN.Store.add('assessments', data); toast('저장했습니다!', 'success'); }
    pendingDraft = null; view = 'list'; renderList();
  }

  // ── 결과 엑셀(CSV) 내보내기 ──
  function sanitizeFile(s) { return String(s || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim(); }

  function sortedStudents() {
    return DN.Store.getAll('students')
      .sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999));
  }

  // 저장된 평가의 결과 셀 → 표시 값 (점수는 숫자 그대로, 성취수준은 라벨)
  function resultCell(a, sid) {
    const r = a.results && a.results[sid];
    if (!r || !r.value) return '';
    return a.scaleType === 'score' ? r.value : (LEVEL_T[r.value] || r.value);
  }

  // 목록 화면: 학생 × 평가 종합표. 체크된 평가가 있으면 그것만, 없으면 전체.
  // (메모는 종합표에 넣지 않음 — 점수 열이 숫자로 유지되어야 엑셀에서 평균 등 계산 가능.
  //  메모가 필요하면 평가를 열어 [결과 엑셀]로 상세 내보내기)
  function exportMatrixCsv() {
    const all = DN.Store.getAll('assessments');
    const list = (selectedIds.size ? all.filter(a => selectedIds.has(a.id)) : all)
      .sort((a, b) => (a.date || '').localeCompare(b.date || '')
        || (a.subject || '').localeCompare(b.subject || '', 'ko'));
    if (!list.length) { toast('내보낼 평가가 없습니다.', 'error'); return; }
    const students = sortedStudents();
    if (!students.length) { toast('학생이 없습니다.', 'error'); return; }
    const colName = a => `${a.subject || ''} ${a.title || ''}${a.period ? '(' + a.period + ')' : ''}`.trim()
      + (a.scaleType === 'score' ? ` [점수/${a.max || 100}]` : '');
    const rows = [['번호', '이름'].concat(list.map(colName))];
    students.forEach(s => rows.push([s.number || '', s.name].concat(list.map(a => resultCell(a, s.id)))));
    DN.utils.csvDownload(`수행평가결과_${selectedIds.size ? '선택' + list.length + '개' : '전체'}_${today()}.csv`, rows);
    toast(`평가 ${list.length}개 × 학생 ${students.length}명 결과를 내려받았습니다!`, 'success');
  }

  // 입력 화면: 이 평가의 상세 결과(메모 포함) — 화면의 현재 입력값 기준(저장과 별개)
  function exportOneCsv() {
    const q = s => rootEl.querySelector(s);
    const score = q('input[name="asScale"][value="score"]').checked;
    const subject = q('#asSubj').value;
    const title = q('#asTitle').value.trim();
    const max = parseInt(q('#asMax') ? q('#asMax').value : 100) || 100;
    const results = collectResults();
    const students = sortedStudents();
    const valCol = score ? `점수(만점 ${max})` : '성취수준';
    const rows = [
      ['평가', `${subject} ${title}`.trim(), '날짜', q('#asDate').value || today(), '방식', valCol],
      [],
      ['번호', '이름', valCol, '메모'],
    ];
    let done = 0;
    students.forEach(s => {
      const r = results[s.id] || {};
      const val = !r.value ? '' : score ? r.value : (LEVEL_T[r.value] || r.value);
      if (r.value) done++;
      rows.push([s.number || '', s.name, val, r.memo || '']);
    });
    DN.utils.csvDownload(`수행평가_${sanitizeFile(subject)}_${sanitizeFile(title) || '평가'}_${today()}.csv`, rows);
    toast(`${done}/${students.length}명 입력된 결과를 내려받았습니다. (저장과는 별개예요)`, 'success');
  }

  return { render };
})();
