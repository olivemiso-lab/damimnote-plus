// ════════════════════════════════════════════════════
//  담임노트+ · 공통 유틸 (DN.utils)
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.utils = (function () {
  // HTML 이스케이프 — innerHTML에 들어가는 모든 사용자 데이터에 필수
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 고유 ID
  function uid() {
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  // 토스트 알림 ('success' | 'error' | 'info')
  let toastTimer = null;
  function toast(msg, type) {
    let el = document.getElementById('dnToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dnToast';
      document.body.appendChild(el);
    }
    el.className = 'toast ' + (type || 'info');
    el.textContent = msg;
    // 강제 리플로우로 연속 호출 시에도 애니메이션 재생
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2800);
  }

  // 확인 창 (window.confirm 래퍼)
  function confirmAsk(msg) {
    return window.confirm(msg);
  }

  // 클립보드 복사 → Promise<boolean>. 클립보드 API가 막힌 환경(file:// 등)은 textarea 방식으로
  function copyText(text) {
    const fallback = function () {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      return ok;
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  }

  // 오늘 날짜 'YYYY-MM-DD' (기기 시간 기준)
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // 창(모달) — 한 번에 하나. [data-close]를 누르거나 Esc로 닫힌다. 만든 배경 요소를 돌려준다
  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() {
    const m = document.getElementById('dnModal');
    if (m) m.remove();
    document.removeEventListener('keydown', escClose);
  }
  function openModal(title, bodyHtml, footHtml) {
    closeModal();
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.id = 'dnModal';
    back.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<div class="modal-head"><h2>' + esc(title) + '</h2><button class="ic" data-close aria-label="닫기">✕</button></div>' +
      '<div class="modal-body">' + bodyHtml + '</div><div class="modal-foot">' + (footHtml || '') + '</div></div>';
    document.body.appendChild(back);
    back.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closeModal(); });
    document.addEventListener('keydown', escClose);
    const first = back.querySelector('input, textarea, select');
    if (first) first.focus();
    return back;
  }

  return { esc, toast, uid, confirmAsk, copyText, today, openModal, closeModal };
})();
