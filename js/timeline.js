// ════════════════════════════════════════════════════
//  담임노트+ · 학생 성장 타임라인 (DN.Timeline)
//  - 한 학생의 관찰·상담 기록을 시간순으로 통합 표시
//  - handlers로 수정/삭제 콜백 주입(없으면 버튼 숨김)
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Timeline = (function () {
  const { esc, fmtDate } = DN.utils;

  const TOPIC_T = {
    peer: '교우관계', study: '학습', habit: '생활습관',
    emotion: '정서·심리', career: '진로', home: '가정', etc: '기타',
  };

  function render(container, studentId, handlers) {
    handlers = handlers || {};
    const obs = DN.Store.query('observations', o => o.studentId === studentId)
      .map(o => ({ t: 'obs', date: o.date, rec: o }));
    const cou = DN.Store.query('counselings', c => c.studentId === studentId)
      .map(c => ({ t: 'cou', date: c.date, rec: c }));
    // 날짜 내림차순, 같은 날짜는 입력 시각(createdAt) 내림차순으로 안정 정렬
    const items = obs.concat(cou).sort((a, b) => {
      const d = (b.date || '').localeCompare(a.date || '');
      return d !== 0 ? d : ((b.rec.createdAt || '').localeCompare(a.rec.createdAt || ''));
    });

    if (!items.length) {
      container.innerHTML = '<p class="empty">아직 기록이 없습니다. 위에서 첫 기록을 남겨보세요. 🌱</p>';
      return;
    }

    container.innerHTML = `<div class="timeline">${items.map(it =>
      it.t === 'obs' ? obsNode(it.rec, handlers) : couNode(it.rec, handlers)
    ).join('')}</div>`;

    container.querySelectorAll('[data-eobs]').forEach(b => b.addEventListener('click', () => handlers.editObs && handlers.editObs(b.dataset.eobs)));
    container.querySelectorAll('[data-dobs]').forEach(b => b.addEventListener('click', () => handlers.delObs && handlers.delObs(b.dataset.dobs)));
    container.querySelectorAll('[data-ecou]').forEach(b => b.addEventListener('click', () => handlers.editCou && handlers.editCou(b.dataset.ecou)));
    container.querySelectorAll('[data-dcou]').forEach(b => b.addEventListener('click', () => handlers.delCou && handlers.delCou(b.dataset.dcou)));
  }

  function obsNode(o, h) {
    const text = o.generatedText || DN.NLG.generate(o) || DN.NLG.summary(o) || '관찰 기록';
    const tools = [];
    if (h.editObs) tools.push(`<button class="ic edit" data-eobs="${o.id}" title="수정">✏️</button>`);
    if (h.delObs) tools.push(`<button class="ic del" data-dobs="${o.id}" title="삭제">✕</button>`);
    return `
      <div class="tl-item obs">
        <div class="tl-dot">📝</div>
        <div class="tl-body">
          <div class="tl-head"><span class="tl-date">${esc(fmtDate(o.date))}</span><span class="tl-type obs">관찰</span><span class="tl-tools">${tools.join('')}</span></div>
          <div class="tl-text">${esc(text)}</div>
          ${o.memo ? `<div class="tl-memo">📌 ${esc(o.memo)}</div>` : ''}
        </div>
      </div>`;
  }

  function couNode(c, h) {
    const who = c.type === 'parent' ? '학부모 상담' : '학생 상담';
    const topic = TOPIC_T[c.topic] || '';
    const tools = [];
    if (h.editCou) tools.push(`<button class="ic edit" data-ecou="${c.id}" title="수정">✏️</button>`);
    if (h.delCou) tools.push(`<button class="ic del" data-dcou="${c.id}" title="삭제">✕</button>`);
    return `
      <div class="tl-item cou">
        <div class="tl-dot">💬</div>
        <div class="tl-body">
          <div class="tl-head"><span class="tl-date">${esc(fmtDate(c.date))}</span><span class="tl-type cou">${who}${topic ? ' · ' + topic : ''}</span><span class="tl-tools">${tools.join('')}</span></div>
          <div class="tl-text">${esc(c.content || '')}</div>
          ${c.followup ? `<div class="tl-memo">➡️ 후속: ${esc(c.followup)}</div>` : ''}
          ${c.note ? `<div class="tl-memo">📌 ${esc(c.note)}</div>` : ''}
        </div>
      </div>`;
  }

  return { render, TOPIC_T };
})();
