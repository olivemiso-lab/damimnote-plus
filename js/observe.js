// ════════════════════════════════════════════════════
//  담임노트+ · 관찰 기록 (DN.Observe)
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Observe = (function () {
  const { esc, toast, today, confirmAsk } = DN.utils;
  const ITEMS = DN.NLG.OBS_ITEMS;

  let selectedId = null;  // 선택된 학생
  let editingId = null;   // 수정 중 관찰기록 id
  let rootEl = null;

  function render(container) {
    rootEl = container;
    const students = DN.Store.getAll('students')
      .sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999));

    if (!students.length) {
      container.innerHTML = placeholderNoStudent('📝', '관찰 기록');
      bindNoStudent();
      return;
    }
    if (!selectedId || !students.some(s => s.id === selectedId)) selectedId = students[0].id;

    container.innerHTML = `
      <div class="page-head"><h1>📝 관찰 기록</h1></div>
      <div class="card">
        <div class="frow">
          <label>학생 선택</label>
          <select id="obsStu" class="stu-select">
            ${students.map(s => `<option value="${s.id}"${s.id === selectedId ? ' selected' : ''}>${esc(s.number ? s.number + '. ' : '')}${esc(s.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="obsArea"></div>`;

    container.querySelector('#obsStu').addEventListener('change', e => {
      selectedId = e.target.value; editingId = null; renderArea();
    });
    renderArea();
  }

  function renderArea() {
    const area = rootEl.querySelector('#obsArea');
    const rec = editingId ? DN.Store.get('observations', editingId) : null;
    const cur = rec || {};

    area.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h2>${editingId ? '관찰 기록 수정' : '오늘의 관찰'}</h2>
          ${editingId ? '<span class="edit-badge">수정 중</span>' : ''}
        </div>
        <div class="frow"><label>날짜</label><input type="date" id="obsDate" value="${esc(cur.date || today())}" style="width:170px"></div>

        <div class="seg-list">
          ${ITEMS.map(it => `
            <div class="seg-group">
              <span class="seg-label">${it.label}</span>
              <div class="seg" data-segkey="${it.key}">
                ${it.opts.map(o => `<button type="button" class="seg-btn${cur[it.key] === o.v ? ' on' : ''}" data-key="${it.key}" data-val="${o.v}">${o.t}</button>`).join('')}
              </div>
            </div>`).join('')}
        </div>

        <div class="frow col"><label>생활지도 / 특기사항 <small class="muted">(선택)</small></label>
          <textarea id="obsGuide" rows="2" placeholder="생활 지도 내용이나 특별히 관찰한 점">${esc(cur.guidance || '')}</textarea></div>
        <div class="frow col"><label>자유 메모 <small class="muted">(선택)</small></label>
          <textarea id="obsMemo" rows="2" placeholder="자유롭게 메모">${esc(cur.memo || '')}</textarea></div>

        <div class="preview-wrap">
          <div class="preview-head">✨ 자동 생성 문장 <button class="btn-ghost mini" id="regenBtn">🔄 다시 생성</button></div>
          <textarea id="obsPreview" rows="3" placeholder="위 항목을 선택하면 문장이 자동으로 만들어집니다.">${esc(cur.generatedText || '')}</textarea>
          <p class="hint">💡 자동 생성된 문장은 자유롭게 고쳐서 저장할 수 있어요.</p>
        </div>

        <button class="btn-primary full" id="obsSave">${editingId ? '✅ 수정 완료' : '💾 관찰 기록 저장'}</button>
        ${editingId ? '<button class="btn-cancel full" id="obsCancel">✕ 취소</button>' : ''}
      </div>

      <div class="card">
        <div class="card-head"><h2>🌱 성장 타임라인</h2><span class="count-chip">${timelineCount()}건</span></div>
        <div id="obsTimeline"></div>
      </div>`;

    // 세그먼트 선택
    area.querySelectorAll('.seg-btn').forEach(btn => btn.addEventListener('click', () => {
      const on = btn.classList.contains('on');
      area.querySelectorAll(`.seg-btn[data-key="${btn.dataset.key}"]`).forEach(b => b.classList.remove('on'));
      if (!on) btn.classList.add('on');
      refreshPreview();
    }));
    area.querySelector('#regenBtn').addEventListener('click', () => refreshPreview(true));
    area.querySelector('#obsSave').addEventListener('click', save);
    const cancel = area.querySelector('#obsCancel');
    if (cancel) cancel.addEventListener('click', () => { editingId = null; renderArea(); });

    if (!editingId) refreshPreview(true);
    renderTimeline();
  }

  function readForm() {
    const obj = {
      studentId: selectedId,
      date: rootEl.querySelector('#obsDate').value || today(),
      guidance: rootEl.querySelector('#obsGuide').value.trim(),
      memo: rootEl.querySelector('#obsMemo').value.trim(),
    };
    ITEMS.forEach(it => {
      const on = rootEl.querySelector(`.seg-btn[data-key="${it.key}"].on`);
      obj[it.key] = on ? on.dataset.val : '';
    });
    return obj;
  }

  // 미리보기 갱신. force=true면 무조건 재생성(편집 내용 덮어씀)
  function refreshPreview(force) {
    const ta = rootEl.querySelector('#obsPreview');
    const gen = DN.NLG.generate(readForm());
    if (force || !ta.value.trim()) ta.value = gen;
  }

  function save() {
    const data = readForm();
    const hasItem = ITEMS.some(it => data[it.key]);
    const text = rootEl.querySelector('#obsPreview').value.trim();
    if (!hasItem && !data.guidance && !data.memo && !text) {
      toast('관찰 항목을 하나 이상 선택하거나 메모를 입력해주세요.', 'error'); return;
    }
    data.generatedText = text;
    if (editingId) {
      DN.Store.update('observations', editingId, data);
      toast('관찰 기록을 수정했습니다!', 'success');
      editingId = null;
    } else {
      DN.Store.add('observations', data);
      toast('관찰 기록을 저장했습니다!', 'success');
    }
    renderArea();
  }

  function timelineCount() {
    return DN.Store.query('observations', o => o.studentId === selectedId).length
      + DN.Store.query('counselings', c => c.studentId === selectedId).length;
  }

  function renderTimeline() {
    DN.Timeline.render(rootEl.querySelector('#obsTimeline'), selectedId, {
      editObs: id => { editingId = id; renderArea(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
      delObs: id => {
        if (!confirmAsk('이 관찰 기록을 삭제할까요?')) return;
        DN.Store.remove('observations', id);
        if (editingId === id) editingId = null;
        renderArea();
        toast('삭제되었습니다.', 'info');
      },
    });
  }

  function placeholderNoStudent(icon, label) {
    return `<div class="page-head"><h1>${icon} ${label}</h1></div>
      <div class="card placeholder"><div class="ph-icon">${icon}</div>
      <h2>학생을 먼저 등록해주세요</h2>
      <p class="desc">${label}을(를) 남기려면 학생이 필요합니다.</p>
      <button class="btn-secondary" id="goStuBtn">학생 관리로 가기</button></div>`;
  }
  function bindNoStudent() {
    const b = rootEl.querySelector('#goStuBtn');
    if (b) b.addEventListener('click', () => DN.App.go('students'));
  }

  function setStudent(id) { selectedId = id; editingId = null; }

  return { render, setStudent };
})();
