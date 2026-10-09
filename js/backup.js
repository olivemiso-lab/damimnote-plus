// ════════════════════════════════════════════════════
//  담임노트+ · 백업 모듈 (DN.Backup)
//  CSV 명단 내보내기 · 기록 백업(JSON) · 파일 포함 백업(ZIP) · 복원(전체 교체)
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Backup = (function () {
  const { esc, toast, confirmAsk } = DN.utils;
  const APP_ID = 'damimnote-plus';
  const BACKUP_VERSION = 2;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const BACKUP_DUE_DAYS = 30;
  // 화면에 보여 줄 컬렉션 이름. 목록에 없는 컬렉션도 백업·복원 대상에는 모두 포함된다
  const LABELS = {
    settings: '설정', students: '학생', events: '일정', observations: '관찰 기록',
    attendance: '출결 메모', presets: '관찰 상황 버튼', timetables: '시간표', seatings: '자리·모둠 배치', relations: '갈등·동행 관계',
    classes: '맡은 반(교과전담)', classNames: '맡은 반 명단',
  };
  let rootEl = null;

  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  // ── 마지막 백업 시각 · 백업 알림 ──
  function lastBackupAt() { return parseInt(DN.Store.getMeta('lastBackupAt')) || 0; }

  function markBackup() {
    DN.Store.setMeta('lastBackupAt', Date.now());
    if (DN.App) DN.App.refreshBanner();
  }

  function snoozeReminder() {
    DN.Store.setMeta('backupSnoozeUntil', Date.now() + 7 * DAY_MS);
  }

  // 지워지지 않은 기록 수 (툼스톤 제외)
  function liveCount(arr) {
    return arr.filter(function (r) { return !(r && r.deleted); }).length;
  }

  function hasRecords() {
    return DN.Store.listCollections().some(function (c) {
      return c !== 'settings' && liveCount(DN.Store.getAll(c)) > 0;
    });
  }

  // 기록이 있는데 30일 넘게(또는 한 번도) 백업하지 않았고, 7일 숨기기 중이 아니면 true
  function isDue() {
    const now = Date.now();
    const snooze = parseInt(DN.Store.getMeta('backupSnoozeUntil')) || 0;
    return now > snooze && now - lastBackupAt() > BACKUP_DUE_DAYS * DAY_MS && hasRecords();
  }

  function dueText() {
    const last = lastBackupAt();
    return last ? '마지막 백업 후 ' + Math.floor((Date.now() - last) / DAY_MS) + '일이 지났어요.' : '아직 백업한 적이 없어요.';
  }

  function lastBackupText() {
    const t = lastBackupAt();
    if (!t) return '아직 백업 기록이 없어요';
    const days = Math.floor((Date.now() - t) / DAY_MS);
    return '마지막 백업: ' + ymd(new Date(t)) + ' (' + (days === 0 ? '오늘' : days + '일 전') + ')';
  }

  function formatBytes(n) {
    if (n < 1024) return n + 'B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB';
    return (n / 1024 / 1024).toFixed(1) + 'MB';
  }

  // CSV 셀 이스케이프
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // content: 문자열 또는 Blob
  function download(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ── 학생 명단 CSV 내보내기 (엑셀 한글 깨짐 방지 BOM 포함) ──
  // 명단만 담기므로 백업 시각으로 치지 않는다
  function exportCsv() {
    const students = DN.Store.getAll('students').filter(function (s) { return !s.deleted; });
    if (!students.length) { toast('내보낼 학생이 없습니다.', 'info'); return; }
    const rows = [DN.Students.csvColumns()].concat(students.map(DN.Students.csvRow));
    const csv = String.fromCharCode(0xFEFF) + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    download('학생명단_' + ymd(new Date()) + '.csv', csv, 'text/csv;charset=utf-8');
    toast(students.length + '명 명단을 CSV로 내보냈어요!', 'success');
  }

  // ── 기록 백업(JSON): localStorage의 모든 컬렉션 ──
  function buildBackup() {
    const collections = {};
    DN.Store.listCollections().forEach(function (c) { collections[c] = DN.Store.getAll(c); });
    return {
      app: APP_ID, kind: 'dn-backup', version: BACKUP_VERSION,
      schemaVersion: DN.Settings.SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      collections: collections,
    };
  }

  function exportJson() {
    download('담임노트_기록백업_' + ymd(new Date()) + '.json', JSON.stringify(buildBackup(), null, 2), 'application/json');
    markBackup();
    toast('기록 백업 파일을 내려받았어요!', 'success');
    refreshInfo();
  }

  // ── 백업 파일 해석 ──
  // 성공: { collections, fromVersion } / 실패: { error: '교사에게 보여 줄 문구' }
  // v1(2026-07 버전): { app, version: 1, students: [...] } → { students } 로 변환
  function parseBackup(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: '담임노트+ 백업 파일이 아닙니다.' };
    if (data.kind === 'dn-sync') {
      return { error: '핸드폰 연결 파일이에요. 백업 복원이 아니라 “핸드폰 연결” 메뉴의 합치기로 가져와 주세요.' };
    }
    if (data.app !== APP_ID) return { error: '담임노트+ 백업 파일이 아닙니다.' };
    if (Number(data.schemaVersion) > DN.Settings.SCHEMA_VERSION) {
      return { error: '더 새 버전의 담임노트+에서 만든 백업이에요. 앱을 최신 버전으로 열어 복원해 주세요.' };
    }
    let src;
    let fromVersion;
    if (data.collections && typeof data.collections === 'object' && !Array.isArray(data.collections)) {
      src = data.collections;
      fromVersion = Number(data.version) || BACKUP_VERSION;
    } else if (Array.isArray(data.students)) {
      src = { students: data.students };
      fromVersion = 1;
    } else {
      return { error: '백업 파일에 기록이 들어 있지 않습니다.' };
    }
    const collections = {};
    Object.keys(src).forEach(function (name) {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || !Array.isArray(src[name])) return;
      collections[name] = src[name].filter(function (r) { return r && typeof r === 'object' && !Array.isArray(r); });
    });
    return { collections: collections, fromVersion: fromVersion };
  }

  function summarize(collections) {
    const names = Object.keys(collections).filter(function (c) { return c !== 'settings'; });
    const parts = names.sort().map(function (c) {
      return (LABELS[c] || c) + ' ' + liveCount(collections[c]) + '건';
    }).filter(function (t) { return !/ 0건$/.test(t); });
    return parts.length ? parts.join(' · ') : '기록 없음';
  }

  function currentCollections() {
    const out = {};
    DN.Store.listCollections().forEach(function (c) { out[c] = DN.Store.getAll(c); });
    return out;
  }

  // ── 파일 포함 백업(ZIP): 기록 JSON + files/ 폴더 ──
  // ZIP 안의 파일 이름은 원래 이름이 아니라 id를 쓴다(이름 충돌·특수문자 방지). 원래 이름은 JSON의 files 목록에 있다
  const ZIP_JSON = 'damimnote-backup.json';
  const FILE_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

  function buildZip() {
    return DN.Files.exportAll().then(function (records) {
      const zip = new JSZip();
      const data = buildBackup();
      data.files = records.map(function (r) {
        return { id: r.id, name: r.name, type: r.type, size: r.size, createdAt: r.createdAt };
      });
      zip.file(ZIP_JSON, JSON.stringify(data, null, 2));
      const folder = zip.folder('files');
      records.forEach(function (r) { folder.file(r.id, r.blob); });
      // 사진·PDF는 이미 압축돼 있어 다시 압축해도 거의 줄지 않음 → 저장만(STORE) 해서 빠르게
      return zip.generateAsync({ type: 'blob', compression: 'STORE' }).then(function (blob) {
        return { blob: blob, fileCount: records.length };
      });
    });
  }

  function exportZip() {
    const btn = rootEl && rootEl.querySelector('#bkZip');
    if (btn) btn.disabled = true;
    buildZip().then(function (r) {
      download('담임노트_파일포함백업_' + ymd(new Date()) + '.zip', r.blob);
      markBackup();
      toast('파일 포함 백업을 내려받았어요! (첨부 ' + r.fileCount + '개)', 'success');
    }).catch(function (e) {
      toast('파일 포함 백업을 만들지 못했어요. ' + (e && e.message || ''), 'error');
    }).then(function () {
      if (btn) btn.disabled = false;
      refreshInfo();
    });
  }

  // ZIP 해석 → { parsed, files: [{ id, name, type, createdAt, blob }], missing } / 실패: { error }
  function parseZip(file) {
    return JSZip.loadAsync(file).then(function (zip) {
      const entry = zip.file(ZIP_JSON);
      if (!entry) return { error: '담임노트+ 파일 포함 백업(ZIP)이 아닙니다.' };
      return entry.async('string').then(function (text) {
        let data;
        try { data = JSON.parse(text); } catch (e) { return { error: '백업 ZIP 안의 기록 파일이 손상됐어요.' }; }
        const parsed = parseBackup(data);
        if (parsed.error) return parsed;
        const metas = (Array.isArray(data.files) ? data.files : []).filter(function (m) {
          return m && typeof m === 'object' && FILE_ID_RE.test(String(m.id));
        });
        let missing = 0;
        return Promise.all(metas.map(function (m) {
          const f = zip.file('files/' + m.id);
          if (!f) { missing++; return null; }
          return f.async('blob').then(function (blob) {
            return {
              id: String(m.id), name: String(m.name || '이름없는파일'), type: String(m.type || ''),
              createdAt: m.createdAt, blob: new Blob([blob], { type: String(m.type || '') }),
            };
          });
        })).then(function (files) {
          return { parsed: parsed, files: files.filter(Boolean), missing: missing };
        });
      });
    }).catch(function () {
      return { error: 'ZIP 파일을 열 수 없어요.' };
    });
  }

  // ── 복원: 전체 교체 ──
  // 백업에 없는 컬렉션은 비운다. 단, 설정이 없는 백업(v1)이면 이 기기의 설정은 유지한다.
  // 저장 도중 실패하면(용량 부족) 복원 전 상태로 되돌린다.
  function restoreRecords(parsed) {
    const before = currentCollections();
    const names = Object.keys(before).concat(Object.keys(parsed.collections)).filter(function (c, i, a) {
      return a.indexOf(c) === i;
    });
    const targets = names.filter(function (c) { return c !== 'settings' || parsed.collections.settings; });
    const ok = targets.every(function (c) { return DN.Store.replaceAll(c, parsed.collections[c] || []); });
    if (!ok) {
      rollbackRecords(before);
      return null;
    }
    DN.Settings.ensure();
    return before;
  }

  function rollbackRecords(before) {
    DN.Store.listCollections().forEach(function (c) { DN.Store.replaceAll(c, before[c] || []); });
  }

  // 기록만 복원 (JSON 백업). 첨부 파일은 건드리지 않는다
  function restore(parsed) {
    return !!restoreRecords(parsed);
  }

  // 기록 + 첨부 파일 전체 복원 (ZIP 백업). 첨부 저장에 실패하면 기록도 되돌린다
  function restoreWithFiles(parsed, files) {
    const before = restoreRecords(parsed);
    if (!before) return Promise.resolve(false);
    return DN.Files.replaceAll(files).then(function () { return true; }, function () {
      rollbackRecords(before);
      DN.Settings.ensure();
      return false;
    });
  }

  function filesText(list) {
    const size = list.reduce(function (n, f) { return n + (f.size != null ? f.size : f.blob ? f.blob.size : 0); }, 0);
    return '첨부 파일 ' + list.length + '개' + (list.length ? ' (' + formatBytes(size) + ')' : '');
  }

  function confirmRestore(parsed, lines) {
    const keepSettings = !parsed.collections.settings;
    return confirmAsk(
      '백업 파일로 전체 복원할까요?\n\n' +
      '· 지금 데이터: ' + lines.current + '\n' +
      '· 백업 파일: ' + lines.backup +
      (parsed.fromVersion < BACKUP_VERSION ? ' (이전 형식 백업)' : '') + '\n\n' +
      '지금 데이터는 모두 백업 파일 내용으로 바뀌며 되돌릴 수 없습니다.' +
      (keepSettings ? '\n설정(학년·반·학생 수 등)은 지금 값을 유지합니다.' : '') +
      (lines.note ? '\n' + lines.note : '') +
      '\n복원 전에 지금 데이터를 먼저 백업해 두는 것을 권장해요.'
    );
  }

  function afterRestore(ok, doneText) {
    if (ok) toast('복원 완료! ' + doneText, 'success');
    else toast('저장 공간이 부족해 복원하지 못했어요. 기존 데이터는 그대로입니다.', 'error');
    refreshInfo();
    if (DN.App) DN.App.refreshBanner();
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = function () {
      let data;
      try { data = JSON.parse(reader.result); }
      catch (e) { toast('JSON 파일을 읽을 수 없습니다.', 'error'); return; }
      const parsed = parseBackup(data);
      if (parsed.error) { toast(parsed.error, 'error'); return; }
      const ok = confirmRestore(parsed, {
        current: summarize(currentCollections()),
        backup: summarize(parsed.collections),
        note: '기록 백업(JSON)에는 첨부 파일이 없어서, 지금 첨부 파일은 그대로 둡니다.',
      });
      if (!ok) return;
      afterRestore(restore(parsed), summarize(parsed.collections));
    };
    reader.readAsText(file, 'utf-8');
  }

  function importZip(file) {
    Promise.all([parseZip(file), DN.Files.list().catch(function () { return []; })]).then(function (res) {
      const z = res[0];
      if (z.error) { toast(z.error, 'error'); return; }
      const ok = confirmRestore(z.parsed, {
        current: summarize(currentCollections()) + ' · ' + filesText(res[1]),
        backup: summarize(z.parsed.collections) + ' · ' + filesText(z.files),
        note: z.missing ? '⚠️ 백업 ZIP에서 첨부 파일 ' + z.missing + '개를 찾지 못했어요. 나머지만 복원됩니다.' : '',
      });
      if (!ok) return;
      restoreWithFiles(z.parsed, z.files).then(function (done) {
        afterRestore(done, summarize(z.parsed.collections) + ' · ' + filesText(z.files));
      });
    });
  }

  function importFile(file) {
    if (/\.zip$/i.test(file.name || '')) importZip(file);
    else importJson(file);
  }

  function refreshInfo() {
    const info = rootEl && rootEl.querySelector('#bkInfo');
    if (!info) return;
    info.textContent = '지금 데이터: ' + summarize(currentCollections()) + ' · ' + lastBackupText();
    const usage = rootEl.querySelector('#bkUsage');
    const recText = '저장 공간 사용량 — 기록(localStorage) ' + formatBytes(DN.Store.usageBytes());
    usage.textContent = recText;
    DN.Files.list().then(function (list) {
      usage.textContent = recText + ' · 첨부 파일(IndexedDB) ' + filesText(list).replace('첨부 파일 ', '');
    }, function () {
      usage.textContent = recText + ' · 첨부 파일 저장소를 쓸 수 없는 브라우저예요';
    });
  }

  // ── 화면 ──
  function render(container) {
    rootEl = container;
    container.innerHTML = '\
      <div class="page-head">\
        <h1>💾 백업</h1>\
      </div>\
      <div class="card" style="max-width:640px;">\
        <p class="bk-info" id="bkInfo"></p>\
        <div class="bk-row">\
          <div class="bk-text">\
            <h3>🗂 기록 백업 (JSON)</h3>\
            <p>학생·설정·일정·관찰·출결 등 모든 기록을 파일 하나로 저장해요. 첨부 파일은 들어가지 않아요. 자주 받아 두기 좋아요.</p>\
          </div>\
          <button class="btn-primary" id="bkJson">기록 백업</button>\
        </div>\
        <div class="bk-row">\
          <div class="bk-text">\
            <h3>📦 파일 포함 백업 (ZIP)</h3>\
            <p>기록과 일정에 첨부한 파일까지 모두 담아요. PC 교체·브라우저 정리 전에 꼭 받아 두세요.</p>\
          </div>\
          <button class="btn-secondary" id="bkZip">파일 포함 백업</button>\
        </div>\
        <div class="bk-row">\
          <div class="bk-text">\
            <h3>♻️ 백업에서 복원 (전체 교체)</h3>\
            <p>기록 백업(JSON) 또는 파일 포함 백업(ZIP)으로 지금 데이터를 <b>모두 바꿉니다</b>. 핸드폰 기록을 더하는 것은 복원이 아니라 “핸드폰 연결” 메뉴의 합치기예요.</p>\
          </div>\
          <label class="btn-ghost bk-file">백업 파일 선택<input type="file" id="bkImport" accept=".json,.zip,application/json,application/zip" hidden></label>\
        </div>\
        <div class="bk-row">\
          <div class="bk-text">\
            <h3>📄 학생 명단 CSV</h3>\
            <p>엑셀에서 바로 열리는 명단 파일. 학기말 자료 정리, 인수인계에 좋아요. (백업은 아니에요)</p>\
          </div>\
          <button class="btn-ghost" id="bkCsv">CSV 내보내기</button>\
        </div>\
        <p class="bk-guard" id="bkGuard"></p>\
        <details class="bk-newyear" id="bkNewYear"><summary>🌱 새 학년 시작하기 <small>3월에 새 반을 맡을 때</small></summary><div id="bkNyBody"></div></details>\
        <p class="bk-note">⚠️ 학생 이름이 들어간 전체 기록은 <b>이 PC의 브라우저에만</b> 있어요. 브라우저 기록·사이트 데이터 삭제, PC 교체 때 사라지니 한 달에 한 번은 기록 백업을 받아 두세요.<br><span id="bkUsage"></span></p>\
      </div>';

    container.querySelector('#bkCsv').addEventListener('click', exportCsv);
    container.querySelector('#bkJson').addEventListener('click', exportJson);
    container.querySelector('#bkZip').addEventListener('click', exportZip);
    container.querySelector('#bkImport').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) importFile(e.target.files[0]);
      e.target.value = '';
    });
    refreshInfo();
    renderGuard();
    renderNewYear();
  }

  // ── 새 학년 시작하기 ──
  // 고른 것만 비운다. 핸드폰과 오가는 기록(관찰·출결·일정·시간표)은 “지움 표시”로 남겨 핸드폰이 옛 기록을 다시 보내도 되살아나지 않게 한다
  const NY_PARTS = [
    { id: 'students', label: '학생 명단·맡은 반', cols: ['students', 'classes', 'classNames'], tomb: false },
    { id: 'records', label: '관찰·출결 기록', cols: ['observations', 'attendance'], tomb: true },
    { id: 'seating', label: '자리·모둠 배치와 관계', cols: ['seatings', 'relations'], tomb: false },
    { id: 'schedule', label: '학교 일정·시간표', cols: ['events', 'timetables'], tomb: true },
  ];
  function startNewYear(parts, settings) {
    const counts = {};
    NY_PARTS.forEach(function (p) {
      if (parts.indexOf(p.id) < 0) return;
      p.cols.forEach(function (col) {
        const live = DN.Store.getAll(col).filter(function (r) { return !r.deleted; });
        counts[col] = live.length;
        if (!live.length) return;
        if (p.tomb || col === 'classes') DN.Store.batch(col, { update: live.map(function (r) { return { id: r.id, patch: { deleted: true } }; }) });
        else DN.Store.replaceAll(col, []);
      });
    });
    if (settings) DN.Settings.save(settings);
    DN.Store.setMeta('newYearAt', new Date().toISOString());
    return counts;
  }
  function renderNewYear() {
    const body = rootEl && rootEl.querySelector('#bkNyBody');
    if (!body) return;
    const s = DN.Settings.get();
    const next = Math.max(s.schoolYear + 1, DN.Settings.defaultSchoolYear());
    body.innerHTML =
      '<p class="set-help">올해 기록을 <b>백업 파일로 먼저 받은 뒤</b>, 고른 것만 비우고 새 반 정보로 시작해요. 상황 버튼·화면 스타일·구글 연결은 그대로예요.</p>' +
      '<div class="ny-parts">' + NY_PARTS.map(function (p) {
        return '<label class="check-label"><input type="checkbox" data-part="' + p.id + '" checked> ' + p.label + ' 비우기</label>';
      }).join('') + '</div>' +
      '<div class="set-grid ny-grid">' +
        '<label for="nyYear">새 학년도</label><input type="number" id="nyYear" min="2000" max="2100" value="' + next + '">' +
        '<label for="nyGrade">학년</label><select id="nyGrade">' + [1, 2, 3, 4, 5, 6].map(function (g) { return '<option value="' + g + '"' + (g === s.grade ? ' selected' : '') + '>' + g + '학년</option>'; }).join('') + '</select>' +
        '<label for="nyClass">반</label><input type="number" id="nyClass" min="1" max="30" value="' + s.classNo + '">' +
        '<label for="nyCount">학생 수</label><input type="number" id="nyCount" min="1" max="60" value="' + s.studentCount + '">' +
      '</div>' +
      '<button class="btn-primary" id="nyGo">백업 받고 새 학년 시작</button>' +
      '<p class="set-help">핸드폰은 구글로 연결돼 있으면 다음 동기화 때 일정·시간표가 함께 정리돼요. 핸드폰에 남은 옛 관찰·출결은 ⚙️ → [PC로 보낸 기록 정리]로 지우면 돼요.</p>';
    body.querySelector('#nyGo').addEventListener('click', function () {
      const parts = Array.prototype.map.call(body.querySelectorAll('[data-part]:checked'), function (x) { return x.dataset.part; });
      const year = parseInt(body.querySelector('#nyYear').value, 10);
      const settings = {
        schoolYear: year >= 2000 && year <= 2100 ? year : next,
        grade: +body.querySelector('#nyGrade').value,
        classNo: Math.min(30, Math.max(1, parseInt(body.querySelector('#nyClass').value, 10) || 1)),
        studentCount: Math.min(60, Math.max(1, parseInt(body.querySelector('#nyCount').value, 10) || s.studentCount)),
      };
      const names = NY_PARTS.filter(function (p) { return parts.indexOf(p.id) >= 0; }).map(function (p) { return p.label; });
      if (!DN.utils.confirmAsk(['새 학년(' + settings.schoolYear + '학년도 ' + settings.grade + '학년 ' + settings.classNo + '반)을 시작할까요?', '',
        '먼저 지금 기록 전체를 백업 파일로 받아요.', names.length ? '그다음 비울 것: ' + names.join(', ') : '비울 것은 없고, 학년·반 정보만 바꿔요.'].join(String.fromCharCode(10)))) return;
      exportJson();   // 지우기 전에 반드시 백업 파일부터
      const counts = startNewYear(parts, settings);
      const n = Object.keys(counts).reduce(function (a, k) { return a + counts[k]; }, 0);
      toast('새 학년을 시작했어요! 백업 파일을 받았고, ' + n + '건을 정리했어요.', 'success');
      if (DN.Cloud && DN.Cloud.linked()) DN.Cloud.sync(false);
      DN.App.relayout();
    });
  }

  // 브라우저에 “이 사이트 기록은 함부로 지우지 말아 달라”고 요청한 결과
  function renderGuard() {
    const el = rootEl && rootEl.querySelector('#bkGuard');
    if (!el) return;
    if (!(navigator.storage && navigator.storage.persisted)) { el.hidden = true; return; }
    navigator.storage.persisted().then(function (ok) {
      el.className = 'bk-guard ' + (ok ? 'on' : 'off');
      el.innerHTML = ok
        ? '🛡️ <b>기록 보호 켜짐</b> — 저장 공간이 부족해도 브라우저가 이 앱의 기록을 저절로 지우지 않아요. (직접 삭제하면 지워지니 백업은 계속 받아 두세요)'
        : '🛡️ <b>기록 보호 꺼짐</b> — 저장 공간이 부족하면 브라우저가 기록을 지울 수 있어요. <button class="btn-ghost" id="bkPersist">보호 켜기</button>' +
          '<br><small>안 켜지면 크롬 주소창 오른쪽의 설치 버튼으로 앱을 설치하거나, 즐겨찾기에 추가해 보세요.</small>';
      const b = el.querySelector('#bkPersist');
      if (b) b.addEventListener('click', function () {
        navigator.storage.persist().then(function (granted) {
          toast(granted ? '기록 보호를 켰어요.' : '브라우저가 아직 허락하지 않았어요. 앱을 설치하면 켜질 수 있어요.', granted ? 'success' : 'info');
          renderGuard();
        });
      });
    }, function () { el.hidden = true; });
  }

  return {
    render, buildBackup, parseBackup, restore, summarize, markBackup, isDue, dueText, snoozeReminder, exportJson, csvCell, download, startNewYear,
    buildZip, parseZip, restoreWithFiles, importFile,
  };
})();
