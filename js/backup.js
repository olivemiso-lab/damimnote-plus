// ════════════════════════════════════════════════════
//  담임노트+ · 데이터 관리(백업/복원/내보내기) (DN.Backup)
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Backup = (function () {
  const { esc, toast, download, today, fmtDateTime } = DN.utils;
  let rootEl = null;

  function render(container) {
    rootEl = container;
    const meta = DN.Store.getObject('meta', {});
    const lastBackup = DN.Store.getObject('settings', {}).lastBackup;

    container.innerHTML = `
      <div class="page-head"><h1>💾 데이터 관리</h1></div>

      <div class="card">
        <h2>📦 전체 백업</h2>
        <p class="desc">모든 학생·기록 데이터를 하나의 JSON 파일로 저장합니다. USB에 담아 다른 컴퓨터로 옮길 수 있어요.</p>
        <p class="desc">마지막 백업: <b>${lastBackup ? fmtDateTime(lastBackup) : '없음'}</b></p>
        <button class="btn-primary" id="backupBtn">💾 백업 파일 내려받기 (.json)</button>
      </div>

      <div class="card">
        <h2>♻️ 백업 복원</h2>
        <p class="desc">백업해 둔 JSON 파일을 불러옵니다.</p>
        <div class="frow">
          <label class="radio"><input type="radio" name="impMode" value="replace" checked> 전체 교체 <small>(현재 데이터 삭제 후 불러오기)</small></label>
        </div>
        <div class="frow">
          <label class="radio"><input type="radio" name="impMode" value="merge"> 병합 <small>(기존 + 백업 합치기)</small></label>
        </div>
        <input type="file" id="restoreFile" accept=".json,application/json" style="margin-top:0.6rem">
      </div>

      <div class="card">
        <h2>📑 엑셀 내보내기</h2>
        <p class="desc">학생 명단을 엑셀(CSV)로 내보냅니다. 한글이 깨지지 않게 저장됩니다.</p>
        <button class="btn-secondary" id="csvBtn">📑 학생 명단 CSV 내려받기</button>
      </div>

      <div class="card danger-card">
        <h2>🗑️ 전체 초기화</h2>
        <p class="desc">모든 데이터를 삭제합니다. 되돌릴 수 없으니 먼저 백업하세요.</p>
        <button class="btn-danger" id="wipeBtn">전체 데이터 삭제</button>
      </div>`;

    container.querySelector('#backupBtn').addEventListener('click', doBackup);
    container.querySelector('#restoreFile').addEventListener('change', doRestore);
    container.querySelector('#csvBtn').addEventListener('click', doCsv);
    container.querySelector('#wipeBtn').addEventListener('click', doWipe);
  }

  // ── JSON 백업 ──
  function doBackup() {
    const data = DN.Store.exportAll();
    const json = JSON.stringify(data, null, 2);
    download(`담임노트백업_${today()}.json`, json, 'application/json');
    const settings = DN.Store.getObject('settings', {});
    settings.lastBackup = DN.utils.nowISO();
    DN.Store.setObject('settings', settings);
    toast('백업 파일을 내려받았습니다!', 'success');
    if (rootEl) render(rootEl);
  }

  // ── JSON 복원 ──
  function doRestore(e) {
    const file = e.target.files[0];
    if (!file) return;
    const mode = rootEl.querySelector('input[name="impMode"]:checked').value;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const stuCount = Array.isArray(data.students) ? data.students.length : 0;
        const msg = mode === 'replace'
          ? `현재 데이터를 모두 지우고 백업(학생 ${stuCount}명)으로 교체할까요?`
          : `현재 데이터에 백업(학생 ${stuCount}명)을 병합할까요?`;
        if (!DN.utils.confirmAsk(msg)) { e.target.value = ''; return; }
        DN.Store.importAll(data, mode);
        toast('복원이 완료되었습니다!', 'success');
        if (DN.App) DN.App.go('students');
      } catch (err) {
        toast('복원 실패: ' + err.message, 'error');
      }
      e.target.value = '';
    };
    reader.readAsText(file, 'utf-8');
  }

  // ── CSV 내보내기 ──
  function doCsv() {
    const students = DN.Store.getAll('students');
    if (!students.length) { toast('내보낼 학생이 없습니다.', 'error'); return; }
    students.sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999));
    const cols = DN.Students.csvColumns();
    const escCell = v => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.map(escCell).join(',')];
    students.forEach(s => lines.push(DN.Students.csvRow(s).map(escCell).join(',')));
    const BOM = '\uFEFF'; // 엑셀 한글 깨짐 방지 (이스케이프로 명시 — 보이지 않는 문자 리터럴은 편집기/인코딩에 따라 유실 위험)
    download(`학생명단_${today()}.csv`, BOM + lines.join('\r\n'), 'text/csv');
    toast('학생 명단 CSV를 내려받았습니다!', 'success');
  }

  // ── 전체 초기화 ──
  function doWipe() {
    if (!DN.utils.confirmAsk('정말 모든 데이터를 삭제할까요? 되돌릴 수 없습니다.')) return;
    if (!DN.utils.confirmAsk('한 번 더 확인합니다. 백업은 하셨나요? 삭제를 진행할까요?')) return;
    DN.Store.wipeAll();
    toast('모든 데이터가 삭제되었습니다.', 'info');
    if (DN.App) DN.App.go('dashboard');
  }

  return { render };
})();
