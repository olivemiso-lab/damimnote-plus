// ════════════════════════════════════════════════════
//  담임노트+ · 학생 관리 모듈 (DN.Students)
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Students = (function () {
  const { esc, toast, uid } = DN.utils;

  // ── 항목 정의 (한 곳에서 관리 → 폼/표/CSV 자동 생성) ──
  const LEVELS = [
    { v: '', t: '미설정' },
    { v: 'high', t: '상' },
    { v: 'mid', t: '중' },
    { v: 'low', t: '하' },
  ];
  // 학업·태도 (상/중/하 척도)
  const ACADEMIC = [
    { key: 'level',          label: '학습수준' },
    { key: 'presentation',   label: '발표력' },
    { key: 'cooperation',    label: '협력성' },
    { key: 'responsibility', label: '책임감' },
    { key: 'focus',          label: '집중도' },
    { key: 'leadership',     label: '리더십' },
    { key: 'conflictRisk',   label: '갈등위험도' },
  ];
  // 성격·특성 (체크)
  const TRAITS = [
    { key: 'easygoing',  label: '😊 성격 원만' },
    { key: 'distracted', label: '⚡ 산만함' },
    { key: 'sensitive',  label: '😰 예민함' },
    { key: 'lethargic',  label: '😴 무기력' },
    { key: 'disruptive', label: '😤 민폐' },
  ];
  // 신체배려
  const CARE = [
    { v: '',      t: '배려 없음' },
    { v: 'front', t: '앞쪽 배치 필요' },
    { v: 'back',  t: '뒤쪽 배치 권장' },
    { v: 'aisle', t: '통로 자리 필요' },
  ];
  const LEVEL_T = { high: '상', mid: '중', low: '하', '': '' };
  const CARE_T  = { front: '앞', back: '뒤', aisle: '통로', '': '' };

  // ── 모듈 상태 ──
  let editingId = null;
  let searchTerm = '';
  let rootEl = null;

  // ── 빈 학생 객체 ──
  function blankStudent() {
    const s = { number: '', name: '', gender: 'none', vision: '', height: '', care: '', note: '' };
    ACADEMIC.forEach(a => s[a.key] = '');
    TRAITS.forEach(t => s[t.key] = false);
    return s;
  }

  // ════════════════════════════════════════════════
  //  명단 붙여넣기 파서 (parseBulk)
  //  엑셀/한글 표 복사 → 탭 구분 텍스트를 열 인식하여
  //  [{number, name, gender}, ...] 로 변환
  // ════════════════════════════════════════════════
  const GENDER_MAP = {
    '남': 'male', '남자': 'male', 'm': 'male', 'male': 'male',
    '여': 'female', '여자': 'female', 'f': 'female', 'female': 'female',
  };
  // 주의: 숫자 1/2는 성별로 해석하지 않음(번호 열과 충돌 방지)
  const HEADER_DEFS = [
    { re: /^(번호|번|no\.?)$/i, field: 'number' },
    { re: /^(이름|성명)$/,      field: 'name' },
    { re: /^(성별|성)$/,        field: 'gender' },
  ];

  const isNumCell    = v => /^\d{1,2}$/.test(v);
  const isGenderCell = v => Object.prototype.hasOwnProperty.call(GENDER_MAP, String(v).toLowerCase());
  const headerField  = v => {
    const h = HEADER_DEFS.find(h => h.re.test(v));
    return h ? h.field : null;
  };
  const hangulCount = v => (String(v).match(/[가-힣]/g) || []).length;

  // "1." "2)" 같은 번호매기기 기호는 순수 숫자 셀로 정규화 (버그 수정:
  // 정규화 없이는 "1. 김민준" 형태의 줄에서 "1."이 숫자 셀로 인식되지 않아
  // 이름만 모드로 빠지고 "1."이 학생 이름으로 잘못 등록되었음)
  const numListRe = /^(\d{1,2})[.)]$/;
  function normCell(c) {
    const m = numListRe.exec(c);
    return m ? m[1] : c;
  }

  // 한 줄 → 셀 배열 (탭 우선 → 쉼표 → 공백)
  // 탭/쉼표 구분 시 빈 셀도 유지해서 열 위치가 밀리지 않게 함
  function splitCells(line) {
    let cells;
    if (line.includes('\t'))      cells = line.split('\t');
    else if (line.includes(',')) cells = line.split(',');
    else                          cells = line.split(/\s+/);
    return cells.map(c => normCell(c.trim()));
  }

  function parseBulk(text) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return [];
    const rows = lines.map(splitCells).filter(r => r.some(c => c !== ''));
    if (!rows.length) return [];

    // ① "이름만" 모드 (하위호환):
    //    번호/성별/머리글로 보이는 셀이 하나도 없으면 모든 셀을 이름으로 취급.
    //    "김민준, 이서연, 박도윤" 처럼 한 줄 쉼표 나열도 그대로 동작.
    const looksTabular = rows.some(r => r.some(c => isNumCell(c) || isGenderCell(c) || headerField(c)));
    if (!looksTabular) {
      const out = [];
      rows.forEach(r => r.forEach(c => { if (c) out.push({ number: '', name: c, gender: 'none' }); }));
      return out;
    }

    // ② 머리글 행 자동 인식 → 열 매핑
    const colMap = {}; // field → column index
    let start = 0;
    const headerHits = rows[0].map(headerField);
    if (headerHits.some(Boolean)) {
      headerHits.forEach((f, i) => { if (f && colMap[f] === undefined) colMap[f] = i; });
      start = 1;
      // 머리글에 '이름'이 없으면 매핑 안 된 열 중 한글이 가장 많은 열을 이름으로 추론
      if (colMap.name === undefined) {
        const used = Object.values(colMap);
        let best = -1;
        const width = Math.max(...rows.map(r => r.length));
        for (let i = 0; i < width; i++) {
          if (used.includes(i)) continue;
          const han = rows.slice(1).reduce((s, r) => s + hangulCount(r[i] || ''), 0);
          if (han > best) { best = han; colMap.name = i; }
        }
      }
    } else {
      // ③ 머리글이 없으면 열 자동 추론 (다수결)
      const width = Math.max(...rows.map(r => r.length));
      const stats = [];
      for (let i = 0; i < width; i++) {
        let num = 0, gen = 0, han = 0, n = 0;
        rows.forEach(r => {
          const c = r[i];
          if (c === undefined || c === '') return;
          n++;
          if (isNumCell(c)) num++;
          if (isGenderCell(c)) gen++;
          han += hangulCount(c);
        });
        stats.push({ num, gen, han, n });
      }
      // 값이 대부분(과반) 1~2자리 숫자인 열 → 번호
      let numCol = -1, best = 0;
      stats.forEach((s, i) => { if (s.n && s.num / s.n > 0.5 && s.num > best) { best = s.num; numCol = i; } });
      // 값이 대부분(과반) 남/여/M/F인 열 → 성별
      let genCol = -1; best = 0;
      stats.forEach((s, i) => { if (i !== numCol && s.n && s.gen / s.n > 0.5 && s.gen > best) { best = s.gen; genCol = i; } });
      // 남은 열 중 한글이 가장 많은 열 → 이름 (열이 1개면 그 열이 이름)
      let nameCol = -1; best = -1;
      stats.forEach((s, i) => { if (i !== numCol && i !== genCol && s.han > best) { best = s.han; nameCol = i; } });
      if (numCol >= 0) colMap.number = numCol;
      if (genCol >= 0) colMap.gender = genCol;
      if (nameCol >= 0) colMap.name = nameCol;
    }

    // ④ 데이터 행 → 학생 객체
    const out = [];
    for (let i = start; i < rows.length; i++) {
      const r = rows[i];
      const pick = f => (colMap[f] !== undefined ? (r[colMap[f]] || '') : '');
      const name = pick('name');
      if (!name || headerField(name)) continue; // 이름이 비면 건너뜀
      const numRaw = pick('number');
      const genKey = String(pick('gender')).toLowerCase();
      out.push({
        number: /^\d+$/.test(numRaw) ? String(parseInt(numRaw, 10)) : '',
        name,
        gender: GENDER_MAP[genKey] || 'none',
      });
    }
    return out;
  }

  // ── 진입점: 화면 렌더 ──
  function render(container) {
    rootEl = container;
    container.innerHTML = `
      <div class="page-head">
        <h1>👦 학생 관리</h1>
        <span class="count-chip" id="stuCount"></span>
      </div>
      <div class="two-col">
        <div class="col-left">
          <div class="card">
            <div class="card-head">
              <h2 id="formTitle">학생 추가</h2>
              <span id="editBadge" class="edit-badge" style="display:none;">수정 중</span>
            </div>
            <div id="studentForm"></div>
          </div>
        </div>
        <div class="col-right">
          <div class="card">
            <div id="backupHint" class="backup-hint" style="display:none;"></div>
            <div class="search-row">
              <input type="text" id="stuSearch" placeholder="🔍 이름·번호 검색" value="${esc(searchTerm)}">
              <button class="btn-ghost" id="bulkBtn">⚡ 일괄</button>
            </div>
            <div id="bulkBox" class="bulk-box" style="display:none;">
              <p class="bulk-help">엑셀·한글 표에서 <b>번호·이름·성별</b> 칸을 드래그해 복사한 뒤 붙여넣으세요. 이름만 입력해도 됩니다.</p>
              <textarea id="bulkInput" rows="5" placeholder="번호&#9;이름&#9;성별&#10;1&#9;김민준&#9;남&#10;2&#9;이서연&#9;여&#10;&#10;— 또는 이름만 —  김민준, 이서연, 박도윤"></textarea>
              <div id="bulkPreview" class="bulk-preview" style="display:none;"></div>
              <label class="bulk-reset">
                <input type="checkbox" id="bulkReset">
                <span>🧹 기존 학생을 모두 지우고 새 명단으로 등록 (새 학기)</span>
              </label>
              <button class="btn-secondary full" id="bulkAddBtn">명단 한 번에 추가</button>
            </div>
            <div id="studentList" class="student-list"></div>
          </div>
        </div>
      </div>`;

    renderForm();
    renderList();

    container.querySelector('#stuSearch').addEventListener('input', e => {
      searchTerm = e.target.value.trim();
      renderList();
    });
    container.querySelector('#bulkBtn').addEventListener('click', () => {
      const box = container.querySelector('#bulkBox');
      box.style.display = box.style.display === 'none' ? 'block' : 'none';
    });
    container.querySelector('#bulkInput').addEventListener('input', updateBulkPreview);
    container.querySelector('#bulkReset').addEventListener('change', updateBulkPreview);
    container.querySelector('#bulkAddBtn').addEventListener('click', addBulk);
    renderBackupHint();
  }

  // ── 입력 폼 ──
  function renderForm() {
    const form = rootEl.querySelector('#studentForm');
    const s = editingId ? (DN.Store.get('students', editingId) || blankStudent()) : blankStudent();

    const levelOpts = key => LEVELS.map(o =>
      `<option value="${o.v}"${s[key] === o.v ? ' selected' : ''}>${o.t}</option>`).join('');

    form.innerHTML = `
      <div class="frow">
        <label>번호</label>
        <input type="number" id="f_number" min="1" max="99" value="${esc(s.number)}" style="width:80px">
        <label>이름</label>
        <input type="text" id="f_name" maxlength="10" value="${esc(s.name)}" placeholder="학생 이름">
      </div>
      <div class="frow">
        <label>성별</label>
        <select id="f_gender">
          <option value="none"${s.gender === 'none' ? ' selected' : ''}>미설정</option>
          <option value="male"${s.gender === 'male' ? ' selected' : ''}>남자</option>
          <option value="female"${s.gender === 'female' ? ' selected' : ''}>여자</option>
        </select>
      </div>

      <div class="section-label">학업 · 태도</div>
      <div class="grade-grid">
        ${ACADEMIC.map(a => `
          <div class="grade-item">
            <label>${a.label}</label>
            <select id="f_${a.key}">${levelOpts(a.key)}</select>
          </div>`).join('')}
      </div>

      <div class="section-label">성격 · 특성</div>
      <div class="check-grid">
        ${TRAITS.map(t => `
          <label class="check-label">
            <input type="checkbox" id="f_${t.key}"${s[t.key] ? ' checked' : ''}>
            <span>${t.label}</span>
          </label>`).join('')}
      </div>

      <div class="section-label">신체 · 생활</div>
      <div class="frow">
        <label>시력</label>
        <input type="text" id="f_vision" maxlength="10" value="${esc(s.vision)}" placeholder="예) 0.8 / 안경" style="width:130px">
        <label>키(cm)</label>
        <input type="number" id="f_height" min="80" max="200" value="${esc(s.height)}" style="width:90px">
      </div>
      <div class="frow">
        <label>신체배려</label>
        <select id="f_care">${CARE.map(o => `<option value="${o.v}"${s.care === o.v ? ' selected' : ''}>${o.t}</option>`).join('')}</select>
      </div>
      <div class="frow col">
        <label>특이사항</label>
        <textarea id="f_note" rows="2" placeholder="알레르기, 건강, 가정환경 등 메모">${esc(s.note)}</textarea>
      </div>

      <button class="btn-primary full" id="saveBtn">${editingId ? '✅ 수정 완료' : '+ 학생 추가'}</button>
      ${editingId ? '<button class="btn-cancel full" id="cancelBtn">✕ 수정 취소</button>' : ''}
    `;

    form.querySelector('#saveBtn').addEventListener('click', save);
    const cancel = form.querySelector('#cancelBtn');
    if (cancel) cancel.addEventListener('click', cancelEdit);
    form.querySelector('#f_name').addEventListener('keydown', e => {
      if (e.key === 'Enter') save();
    });
  }

  // ── 폼 읽기 ──
  function readForm() {
    const g = id => rootEl.querySelector('#f_' + id);
    const obj = {
      number: g('number').value.trim(),
      name: g('name').value.trim(),
      gender: g('gender').value,
      vision: g('vision').value.trim(),
      height: g('height').value.trim(),
      care: g('care').value,
      note: g('note').value.trim(),
    };
    ACADEMIC.forEach(a => obj[a.key] = g(a.key).value);
    TRAITS.forEach(t => obj[t.key] = g(t.key).checked);
    return obj;
  }

  // ── 저장(추가/수정) ──
  function save() {
    const data = readForm();
    if (!data.name) { rootEl.querySelector('#f_name').focus(); toast('이름을 입력해주세요.', 'error'); return; }
    const dup = DN.Store.query('students', s => s.name === data.name && s.id !== editingId);
    if (dup.length) {
      const ok = DN.utils.confirmAsk(`'${data.name}'은(는) 이미 있는 학생입니다.\n동명이인으로 ${editingId ? '저장' : '추가'}할까요?`);
      if (!ok) return;
    }

    if (editingId) {
      DN.Store.update('students', editingId, data);
      toast(`${data.name} 정보 수정 완료!`, 'success');
      editingId = null;
    } else {
      DN.Store.add('students', data);
      toast(`${data.name} 추가 완료!`, 'success');
    }
    refreshTitle();
    renderForm();
    renderList();
  }

  // ── 일괄 추가: 실시간 미리보기 ──
  function updateBulkPreview() {
    const ta = rootEl.querySelector('#bulkInput');
    const pv = rootEl.querySelector('#bulkPreview');
    if (!ta || !pv) return;
    if (!ta.value.trim()) { pv.style.display = 'none'; pv.textContent = ''; return; }
    const list = parseBulk(ta.value);
    pv.style.display = 'block';
    if (!list.length) {
      pv.textContent = '⚠️ 인식된 학생이 없습니다. 붙여넣은 형식을 확인해주세요.';
      return;
    }
    const gT = { male: '남', female: '여', none: '' };
    const sample = list.slice(0, 3).map(p =>
      `${p.number ? p.number + ' ' : ''}${p.name}${gT[p.gender] ? '(' + gT[p.gender] + ')' : ''}`
    ).join(', ');
    const msgs = [`${list.length}명 인식됨 · 예) ${sample}${list.length > 3 ? ' …' : ''}`];

    // 새 학기 초기화 체크 시에는 기존 명단과의 충돌 경고가 무의미하므로 생략
    const resetEl = rootEl.querySelector('#bulkReset');
    const resetChecked = !!(resetEl && resetEl.checked);
    if (!resetChecked) {
      const existing = DN.Store.getAll('students');
      const existNums = new Set(existing.map(s => String(parseInt(s.number) || '')).filter(Boolean));
      const clash = [...new Set(list.map(p => p.number).filter(n => n && existNums.has(n)))];
      if (clash.length) {
        msgs.push(`⚠️ 번호 ${clash.slice(0, 5).join(', ')}${clash.length > 5 ? ' 외' : ''}번이 기존 학생과 겹칩니다.`);
      }
      const existNames = new Set(existing.map(s => s.name));
      const sameName = [...new Set(list.map(p => p.name).filter(n => existNames.has(n)))];
      if (sameName.length) {
        msgs.push(`ℹ️ 같은 이름 ${sameName.length}명(${sameName.slice(0, 3).join(', ')}${sameName.length > 3 ? ' 외' : ''}) — 등록 시 동명이인 여부를 확인합니다.`);
      }
    }
    pv.textContent = msgs.join('\n');
  }

  // ── 일괄 추가 (parseBulk 기반) ──
  function addBulk() {
    const ta = rootEl.querySelector('#bulkInput');
    const parsed = parseBulk(ta.value);
    if (!parsed.length) { toast('명단을 입력해주세요.', 'error'); return; }

    // 새 학기: 기존 학생 전체 삭제 후 등록
    const resetBox = rootEl.querySelector('#bulkReset');
    if (resetBox && resetBox.checked) {
      const n = DN.Store.count('students');
      if (n) {
        const ok = DN.utils.confirmAsk(
          `기존 학생 ${n}명을 모두 삭제하고 새 명단 ${parsed.length}명을 등록할까요?\n` +
          `삭제된 학생 명단은 되돌릴 수 없습니다. (백업을 먼저 권장해요)`
        );
        if (!ok) return;
        DN.Store.getAll('students').forEach(s => DN.Store.remove('students', s.id));
        if (editingId) { editingId = null; refreshTitle(); renderForm(); }
      }
    }

    const existing = DN.Store.getAll('students');
    const existNames = new Set(existing.map(s => s.name));
    // 이름+번호가 완전히 같으면 확실한 중복으로 자동 제외
    const seenExact = new Set(existing.map(s => `${s.name}#${String(parseInt(s.number) || '')}`));
    const addedNames = new Set();

    let dup = 0, skipped = 0;
    const okList = [], askList = [];
    parsed.forEach(p => {
      if (p.name.length > 10) { skipped++; return; } // 이름 10자 초과는 건너뜀(기존 규칙)
      const exact = `${p.name}#${p.number || ''}`;
      if (seenExact.has(exact)) { dup++; return; }
      seenExact.add(exact);
      // 이름만 같으면 동명이인 후보 → 한 번에 모아 확인
      if (existNames.has(p.name) || addedNames.has(p.name)) askList.push(p);
      else { okList.push(p); addedNames.add(p.name); }
    });

    let accepted = new Set(okList);
    if (askList.length) {
      const names = [...new Set(askList.map(p => p.name))];
      const ok = DN.utils.confirmAsk(
        `같은 이름의 학생이 ${askList.length}명 있습니다.\n` +
        `(${names.slice(0, 5).join(', ')}${names.length > 5 ? ' 외' : ''})\n` +
        `동명이인으로 함께 추가할까요?\n(취소하면 이 학생들만 제외하고 등록합니다)`
      );
      if (ok) askList.forEach(p => accepted.add(p));
      else dup += askList.length;
    }

    // 버그 수정: 명단에 포함된 명시적 번호를 먼저 모두 반영해 maxNo를 계산한 뒤
    // 번호가 없는 학생에게 자동 번호를 매긴다. 기존에는 자동 배정과 명시적 번호가
    // 뒤섞여 순서에 따라 같은 번호가 중복 배정될 수 있었다.
    let maxNo = DN.Store.getAll('students').reduce((m, s) => Math.max(m, parseInt(s.number) || 0), 0);
    parsed.forEach(p => {
      if (accepted.has(p) && p.number) maxNo = Math.max(maxNo, parseInt(p.number, 10) || 0);
    });

    let added = 0;
    parsed.forEach(p => { // 붙여넣은 순서 유지
      if (!accepted.has(p)) return;
      const b = blankStudent();
      b.name = p.name;
      b.gender = p.gender;
      if (p.number) {
        b.number = p.number;
      } else {
        maxNo += 1; // 자동 부여 시 카운터 증가
        b.number = String(maxNo);
      }
      DN.Store.add('students', b);
      added++;
    });

    ta.value = '';
    if (resetBox) resetBox.checked = false;
    updateBulkPreview();
    rootEl.querySelector('#bulkBox').style.display = 'none';
    renderList();
    renderBackupHint();

    let msg = `${added}명 추가 완료!`;
    if (dup) msg += ` (중복 ${dup}명 제외)`;
    if (skipped) msg += ` (형식 오류 ${skipped}명 제외)`;
    toast(msg, added ? 'success' : 'info');
  }

  // ── 백업 알림 배너 ──
  // 마지막 백업 시각은 데이터 관리(DN.Backup)가 기록하는 settings.lastBackup을 그대로 사용
  // (대시보드 배너와 동일 출처 — 별도 키를 쓰면 백업을 해도 이 배너가 남는 버그가 있었음)
  const DAY_MS = 24 * 60 * 60 * 1000;
  const BACKUP_DUE_DAYS = 14;

  function markBackup() { // 백업 성공 시 외부에서 호출 가능(출처 통일용)
    const s = DN.Store.getObject('settings', {});
    s.lastBackup = DN.utils.nowISO();
    DN.Store.setObject('settings', s);
    renderBackupHint();
  }

  function renderBackupHint() {
    const el = rootEl && rootEl.querySelector('#backupHint');
    if (!el) return;
    const settings = DN.Store.getObject('settings', {});
    const last = settings.lastBackup ? (new Date(settings.lastBackup).getTime() || 0) : 0;
    const snooze = parseInt(settings.backupSnoozeUntil) || 0;
    const now = Date.now();
    const due = DN.Store.count('students') > 0 && now > snooze && (now - last) > BACKUP_DUE_DAYS * DAY_MS;
    if (!due) { el.style.display = 'none'; el.innerHTML = ''; return; }
    const days = last ? Math.floor((now - last) / DAY_MS) : null;
    el.style.display = 'flex';
    el.innerHTML = `
      <span>💾 ${days === null ? '아직 백업 기록이 없어요.' : `마지막 백업 후 ${days}일이 지났어요.`} [데이터 관리]에서 백업해 두세요.</span>
      <button class="hint-close" id="backupSnooze" title="7일간 숨기기">✕</button>`;
    el.querySelector('#backupSnooze').addEventListener('click', () => {
      const s = DN.Store.getObject('settings', {});
      s.backupSnoozeUntil = Date.now() + 7 * DAY_MS;
      DN.Store.setObject('settings', s);
      el.style.display = 'none';
    });
  }

  // ── 수정 시작 ──
  function edit(id) {
    editingId = id;
    refreshTitle();
    renderForm();
    renderList();
    rootEl.querySelector('#f_name').focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function cancelEdit() {
    editingId = null;
    refreshTitle();
    renderForm();
    renderList();
  }
  function refreshTitle() {
    rootEl.querySelector('#formTitle').textContent = editingId ? '학생 정보 수정' : '학생 추가';
    rootEl.querySelector('#editBadge').style.display = editingId ? 'inline-block' : 'none';
  }

  // ── 삭제 ──
  function del(id) {
    const s = DN.Store.get('students', id);
    if (!s) return;
    if (!DN.utils.confirmAsk(`'${s.name}' 학생을 삭제할까요?\n관련 기록은 남지만 학생 목록에서 제거됩니다.`)) return;
    DN.Store.remove('students', id);
    if (editingId === id) cancelEdit();
    renderList();
    toast(`${s.name} 삭제됨`, 'info');
  }

  // ── 목록 ──
  function renderList() {
    let list = DN.Store.getAll('students');
    // 번호순 정렬(번호 없으면 이름순)
    list.sort((a, b) => {
      const na = parseInt(a.number) || 999, nb = parseInt(b.number) || 999;
      return na !== nb ? na - nb : a.name.localeCompare(b.name, 'ko');
    });
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q) || String(s.number).includes(q));
    }

    const countEl = rootEl.querySelector('#stuCount');
    if (countEl) countEl.textContent = `${DN.Store.count('students')}명`;

    const box = rootEl.querySelector('#studentList');
    if (!list.length) {
      box.innerHTML = `<p class="empty">${searchTerm ? '검색 결과가 없습니다.' : '👈 왼쪽에서 학생을 추가해보세요.'}</p>`;
      return;
    }

    box.innerHTML = list.map(s => {
      const tags = [];
      if (s.gender === 'male') tags.push('<span class="tag t-m">남</span>');
      if (s.gender === 'female') tags.push('<span class="tag t-f">여</span>');
      if (s.level) tags.push(`<span class="tag t-lv">학습 ${LEVEL_T[s.level]}</span>`);
      if (s.leadership === 'high') tags.push('<span class="tag t-ld">👑리더</span>');
      if (s.conflictRisk === 'high') tags.push('<span class="tag t-cf">⚠️갈등주의</span>');
      TRAITS.forEach(t => { if (s[t.key]) tags.push(`<span class="tag t-tr">${t.label.split(' ')[0]}</span>`); });
      if (s.care) tags.push(`<span class="tag t-care">${CARE_T[s.care]}자리</span>`);

      return `
      <div class="stu-item${editingId === s.id ? ' editing' : ''}">
        <div class="stu-no">${esc(s.number || '–')}</div>
        <div class="stu-body">
          <div class="stu-name">${esc(s.name)}</div>
          <div class="stu-tags">${tags.join('')}</div>
          ${s.note ? `<div class="stu-note">📌 ${esc(s.note)}</div>` : ''}
        </div>
        <div class="stu-actions">
          <button class="ic edit" title="수정" data-edit="${s.id}">✏️</button>
          <button class="ic del" title="삭제" data-del="${s.id}">✕</button>
        </div>
      </div>`;
    }).join('');

    box.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => edit(b.dataset.edit)));
    box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => del(b.dataset.del)));
  }

  // ── CSV 내보내기용 헤더/행 (backup 모듈에서 사용) ──
  function csvColumns() {
    return ['번호', '이름', '성별']
      .concat(ACADEMIC.map(a => a.label))
      .concat(TRAITS.map(t => t.label.replace(/^[^ ]+ /, '')))
      .concat(['시력', '키', '신체배려', '특이사항']);
  }
  function csvRow(s) {
    const gT = { male: '남', female: '여', none: '' };
    return [s.number || '', s.name, gT[s.gender] || '']
      .concat(ACADEMIC.map(a => LEVEL_T[s[a.key]] || ''))
      .concat(TRAITS.map(t => s[t.key] ? 'O' : ''))
      .concat([s.vision || '', s.height || '', CARE_T[s.care] || '', s.note || '']);
  }

  return { render, csvColumns, csvRow, ACADEMIC, TRAITS, LEVEL_T, markBackup };
})();
