// ════════════════════════════════════════════════════
//  담임노트+ · 공통 유틸 (DN.utils)
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.utils = (function () {

  // 고유 ID 생성
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // 현재 시각 ISO 문자열
  function nowISO() { return new Date().toISOString(); }

  // YYYY-MM-DD
  function today() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // ISO/날짜 → 보기 좋은 한국어 날짜
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  }
  function fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const p = n => String(n).padStart(2, '0');
    return `${fmtDate(iso)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // HTML 이스케이프
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 토스트 알림
  function toast(msg, type = 'info') {
    let t = document.getElementById('dn-toast');
    if (!t) { t = document.createElement('div'); t.id = 'dn-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = `dn-toast ${type}`;
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // 확인 대화상자(간단 래퍼 — 추후 커스텀 모달로 교체 가능)
  function confirmAsk(msg) { return window.confirm(msg); }

  // 파일 다운로드
  function download(filename, content, mime = 'application/json') {
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // CSV 다운로드 — rows: 배열의 배열. BOM을 붙여 엑셀에서 한글이 깨지지 않게 함
  function csvDownload(filename, rows) {
    const cell = v => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const body = rows.map(r => r.map(cell).join(',')).join('\r\n');
    const BOM = String.fromCharCode(0xFEFF);
    download(filename, BOM + body, 'text/csv');
  }

  // 클립보드 복사 (file:// 에서도 동작하도록 execCommand 사용)
  function copy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast('클립보드에 복사되었습니다!', 'success');
    } catch (e) {
      toast('복사에 실패했습니다.', 'error');
    }
  }

  return { uid, nowISO, today, fmtDate, fmtDateTime, esc, toast, confirmAsk, download, csvDownload, copy };
})();
