// ════════════════════════════════════════════════════
//  담임노트+ · 상담 기록 (DN.Counsel)
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Counsel = (function () {
  const { esc, toast, today, confirmAsk } = DN.utils;
  const TOPICS = [
    { v: 'peer', t: '교우관계' }, { v: 'study', t: '학습' }, { v: 'habit', t: '생활습관' },
    { v: 'emotion', t: '정서·심리' }, { v: 'career', t: '진로' }, { v: 'home', t: '가정' }, { v: 'etc', t: '기타' },
  ];

  let selectedId = null;
  let editingId = null;
  let rootEl = null;

  function render(container) {
    rootEl = container;
    const students = DN.Store.getAll('students')
      .sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999));

    if (!students.length) {
      container.innerHTML = `<div class="page-head"><h1>💬 상담 기록</h1></div>
        <div class="card placeholder"><div class="ph-icon">💬</div>
        <h2>학생을 먼저 등록해주세요</h2>
        <p class="desc">상담 기록을 남기려면 학생이 필요합니다.</p>
        <button class="btn-secondary" id="goStuBtn">학생 관리로 가기</button></div>`;
      const b = container.querySelector('#goStuBtn');
      if (b) b.addEventListener('click', () => DN.App.go('students'));
      return;
    }
    if (!selectedId || !students.some(s => s.id === selectedId)) selectedId = students[0].id;

    container.innerHTML = `
      <div class="page-head"><h1>💬 상담 기록</h1></div>
      <div class="card">
        <div class="frow"><label>학생 선택</label>
          <select id="couStu" class="stu-select">
            ${students.map(s => `<option value="${s.id}"${s.id === selectedId ? ' selected' : ''}>${esc(s.number ? s.number + '. ' : '')}${esc(s.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="couArea"></div>`;

    container.querySelector('#couStu').addEventListener('change', e => {
      selectedId = e.target.value; editingId = null; renderArea();
    });
    renderArea();
  }

  function renderArea() {
    const area = rootEl.querySelector('#couArea');
    const rec = editingId ? DN.Store.get('counselings', editingId) : null;
    const c = rec || {};

    area.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h2>${editingId ? '상담 기록 수정' : '새 상담 기록'}</h2>
          ${editingId ? '<span class="edit-badge">수정 중</span>' : ''}
        </div>
        <div class="frow">
          <label>날짜</label><input type="date" id="couDate" value="${esc(c.date || today())}" style="width:170px">
          <label>구분</label>
          <select id="couType" style="width:130px">
            <option value="student"${c.type === 'student' || !c.type ? ' selected' : ''}>학생 상담</option>
            <option value="parent"${c.type === 'parent' ? ' selected' : ''}>학부모 상담</option>
          </select>
        </div>
        <div class="frow">
          <label>상담 유형</label>
          <select id="couTopic" style="width:160px">
            ${TOPICS.map(t => `<option value="${t.v}"${c.topic === t.v ? ' selected' : ''}>${t.t}</option>`).join('')}
          </select>
        </div>
        <div class="frow col"><label>상담 내용</label>
          <textarea id="couContent" rows="4" placeholder="상담 내용을 기록하세요.">${esc(c.content || '')}</textarea></div>
        <div class="frow col"><label>후속 조치 <small class="muted">(선택)</small></label>
          <textarea id="couFollow" rows="2" placeholder="이후 지도 계획이나 약속">${esc(c.followup || '')}</textarea></div>
        <div class="frow col"><label>특이사항 <small class="muted">(선택)</small></label>
          <textarea id="couNote" rows="2" placeholder="기타 참고사항">${esc(c.note || '')}</textarea></div>

        <button class="btn-primary full" id="couSave">${editingId ? '✅ 수정 완료' : '💾 상담 기록 저장'}</button>
        ${editingId ? '<button class="btn-cancel full" id="couCancel">✕ 취소</button>' : ''}
      </div>

      <div class="card">
        <div class="card-head"><h2>🌱 성장 타임라인</h2><span class="count-chip">${timelineCount()}건</span></div>
        <div id="couTimeline"></div>
      </div>`;

    area.querySelector('#couSave').addEventListener('click', save);
    const cancel = area.querySelector('#couCancel');
    if (cancel) cancel.addEventListener('click', () => { editingId = null; renderArea(); });
    renderTimeline();
  }

  function save() {
    const data = {
      studentId: selectedId,
      date: rootEl.querySelector('#couDate').value || today(),
      type: rootEl.querySelector('#couType').value,
      topic: rootEl.querySelector('#couTopic').value,
      content: rootEl.querySelector('#couContent').value.trim(),
      followup: rootEl.querySelector('#couFollow').value.trim(),
      note: rootEl.querySelector('#couNote').value.trim(),
    };
    if (!data.content) { toast('상담 내용을 입력해주세요.', 'error'); return; }
    if (editingId) {
      DN.Store.update('counselings', editingId, data);
      toast('상담 기록을 수정했습니다!', 'success');
      editingId = null;
    } else {
      DN.Store.add('counselings', data);
      toast('상담 기록을 저장했습니다!', 'success');
    }
    renderArea();
  }

  function timelineCount() {
    return DN.Store.query('observations', o => o.studentId === selectedId).length
      + DN.Store.query('counselings', c => c.studentId === selectedId).length;
  }

  function renderTimeline() {
    DN.Timeline.render(rootEl.querySelector('#couTimeline'), selectedId, {
      editCou: id => { editingId = id; renderArea(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
      delCou: id => {
        if (!confirmAsk('이 상담 기록을 삭제할까요?')) return;
        DN.Store.remove('counselings', id);
        if (editingId === id) editingId = null;
        renderArea();
        toast('삭제되었습니다.', 'info');
      },
    });
  }

  return { render };
})();
