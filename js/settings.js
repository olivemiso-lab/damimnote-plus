// ════════════════════════════════════════════════════
//  담임노트+ · 설정 모듈 (DN.Settings)
//  settings 컬렉션(단일 레코드) · 스키마 버전 관리 · ⚙️ 설정 화면
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Settings = (function () {
  const { esc, toast } = DN.utils;
  const COL = 'settings';
  const SCHEMA_VERSION = 2;
  let rootEl = null;

  // 1~2월은 앞 해 학년도 (2027년 1월 → 2026학년도)
  function defaultSchoolYear(now) {
    const d = now || new Date();
    return d.getMonth() < 2 ? d.getFullYear() - 1 : d.getFullYear();
  }

  function defaults() {
    return {
      schemaVersion: SCHEMA_VERSION,
      grade: 4,
      classNo: 1,
      teacherName: '',
      studentCount: 24,
      schoolYear: defaultSchoolYear(),
      deviceRole: 'pc',
    };
  }

  function record() {
    return DN.Store.getAll(COL)[0] || null;
  }

  // 항상 모든 항목이 채워진 설정 객체를 돌려준다
  function get() {
    return Object.assign(defaults(), record() || {});
  }

  function save(patch) {
    const rec = record();
    if (!rec) return DN.Store.add(COL, Object.assign(defaults(), patch));
    return DN.Store.update(COL, rec.id, patch);
  }

  // ── 스키마 점검 (앱 시작 시 1회) ──
  // v1: students만 있고 settings 레코드가 없음 → v2: settings 레코드 생성. 기존 데이터는 건드리지 않는다.
  // 이후 버전을 올릴 때는 MIGRATIONS에 { to, run } 단계를 추가한다. 단계는 데이터를 지우지 않아야 한다.
  const MIGRATIONS = [];

  function ensure() {
    let rec = record();
    if (!rec) {
      DN.Store.add(COL, defaults());
      return { from: 1, to: SCHEMA_VERSION };
    }
    const from = Number(rec.schemaVersion) || 1;
    if (from > SCHEMA_VERSION) {
      // 더 새 버전 앱에서 만든 데이터 — 아무것도 바꾸지 않는다
      toast('이 데이터는 더 새 버전의 담임노트+에서 만들어졌어요. 앱을 최신 버전으로 열어 주세요.', 'error');
      return { from, to: from, newer: true };
    }
    if (from < SCHEMA_VERSION) {
      MIGRATIONS.filter(function (m) { return m.to > from && m.to <= SCHEMA_VERSION; })
        .sort(function (a, b) { return a.to - b.to; })
        .forEach(function (m) { m.run(); });
      DN.Store.update(COL, rec.id, { schemaVersion: SCHEMA_VERSION });
    }
    return { from, to: SCHEMA_VERSION };
  }

  // ── 화면 스타일 (기기마다 따로, 저장 공간 메타 look) ──
  const LOOKS = [
    { id: 'cute', name: '귀여운', desc: '파스텔 알림장', sw: ['#fdfaf5', '#ffe2d3', '#dff0fb', '#dcf3e6'] },
    { id: 'sky', name: '맑은 하늘', desc: '흰 바탕에 밝은 파랑', sw: ['#ffffff', '#e8f1ff', '#2f80ed', '#1d2433'] },
    { id: 'mint', name: '민트', desc: '흰 바탕에 청록', sw: ['#ffffff', '#dff7ef', '#0fa37f', '#1c2a27'] },
    { id: 'black', name: '블랙&오렌지', desc: '검정 글씨에 주황 포인트', sw: ['#ffffff', '#f5f5f5', '#111111', '#ff6b2c'] },
    { id: 'navy', name: '네이비', desc: '남색 메뉴에 노랑 포인트', sw: ['#1e3a6e', '#f7f9fc', '#ffffff', '#ffc933'] },
  ];
  const THEME_COLOR = { cute: '#fff5eb', sky: '#f4f8ff', mint: '#f2fbf8', black: '#ffffff', navy: '#1e3a6e' };
  // 예전 이름(심플·시크)을 고른 기기는 가까운 새 스타일로
  const OLD = { simple: 'sky', chic: 'black' };
  function look() { const l = OLD[DN.Store.getMeta('look')] || DN.Store.getMeta('look'); return LOOKS.some(function (x) { return x.id === l; }) ? l : 'cute'; }
  function applyLook(l) {
    if (l === 'cute') document.documentElement.removeAttribute('data-look');
    else document.documentElement.setAttribute('data-look', l);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOR[l] || THEME_COLOR.cute);
  }
  function setLook(l) {
    DN.Store.setMeta('look', l);
    applyLook(l);
  }
  function lookPickerHtml() {
    const cur = look();
    return '<div class="look-pick">' + LOOKS.map(function (x) {
      return '<button type="button" class="look-opt" data-look="' + x.id + '" aria-pressed="' + (x.id === cur) + '">' +
        '<div class="look-sw">' + x.sw.map(function (c) { return '<span style="background:' + c + '"></span>'; }).join('') + '</div>' +
        esc(x.name) + '<small>' + esc(x.desc) + '</small></button>';
    }).join('') + '</div>';
  }
  function bindLookPicker(root) {
    root.querySelectorAll('.look-opt').forEach(function (b) {
      b.addEventListener('click', function () {
        setLook(b.dataset.look);
        root.querySelectorAll('.look-opt').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      });
    });
  }

  // ── 입력값 정리 ──
  function clampInt(v, min, max, fallback) {
    const n = parseInt(v, 10);
    if (isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function readForm() {
    const cur = get();
    const q = function (sel) { return rootEl.querySelector(sel).value; };
    return {
      grade: clampInt(q('#setGrade'), 1, 6, cur.grade),
      classNo: clampInt(q('#setClass'), 1, 30, cur.classNo),
      teacherName: q('#setTeacher').trim(),
      studentCount: clampInt(q('#setCount'), 1, 60, cur.studentCount),
      schoolYear: clampInt(q('#setYear'), 2000, 2100, cur.schoolYear),
      deviceRole: q('#setRole') === 'mobile' ? 'mobile' : 'pc',
    };
  }

  // ── 화면 ──
  function render(container) {
    rootEl = container;
    const s = get();
    const gradeOpts = [1, 2, 3, 4, 5, 6].map(function (g) {
      return '<option value="' + g + '"' + (g === s.grade ? ' selected' : '') + '>' + g + '학년</option>';
    }).join('');
    container.innerHTML = '\
      <div class="page-head"><h1>⚙️ 설정</h1></div>\
      <div class="card set-card">\
        <div class="section-label">화면 스타일</div>' + lookPickerHtml() + '\
        <p class="set-help">이 기기에만 적용돼요. 핸드폰은 핸드폰 ⚙️ 설정에서 따로 고를 수 있어요.</p>\
        <div class="section-label">우리 반</div>\
        <div class="set-grid">\
          <label for="setYear">학년도</label>\
          <input type="number" id="setYear" min="2000" max="2100" value="' + esc(s.schoolYear) + '">\
          <label for="setGrade">학년</label>\
          <select id="setGrade">' + gradeOpts + '</select>\
          <label for="setClass">반</label>\
          <input type="number" id="setClass" min="1" max="30" value="' + esc(s.classNo) + '">\
          <label for="setCount">학생 수</label>\
          <input type="number" id="setCount" min="1" max="60" value="' + esc(s.studentCount) + '">\
        </div>\
        <p class="set-help">학년은 학교 일정의 “우리 학년” 기본값, 학생 수는 핸드폰 번호 버튼 개수로 쓰여요. 1~2월은 앞 해 학년도입니다.</p>\
        <div class="section-label">담당자 이름</div>\
        <div class="set-grid">\
          <label for="setTeacher">이름</label>\
          <input type="text" id="setTeacher" maxlength="20" placeholder="예: 홍길동" value="' + esc(s.teacherName) + '">\
        </div>\
        <p class="set-help">월중행사의 담당자 칸에 이 이름이 있으면 “내 담당”으로 표시해요. 이 PC에만 저장되고 핸드폰으로 보내지 않습니다.</p>\
        <div class="section-label">이 기기</div>\
        <div class="set-grid">\
          <label for="setRole">용도</label>\
          <select id="setRole">\
            <option value="pc"' + (s.deviceRole === 'pc' ? ' selected' : '') + '>PC (전체 기능)</option>\
            <option value="mobile"' + (s.deviceRole === 'mobile' ? ' selected' : '') + '>핸드폰 (일정 보기·빠른 기록)</option>\
          </select>\
        </div>\
        <div class="set-actions"><button class="btn-primary" id="setSave">저장</button></div>\
        <div class="section-label">첨부 파일 저장 공간</div>\
        <p class="set-help" id="setFiles">계산 중…</p>\
        <p class="set-meta">데이터 형식 버전 ' + esc(s.schemaVersion) + ' · <a href="guide.html" target="_blank" rel="noopener">📖 사용 설명서</a> · <a href="privacy.html" target="_blank" rel="noopener">개인정보처리방침</a></p>\
      </div>';

    bindLookPicker(container);
    container.querySelector('#setSave').addEventListener('click', function () {
      save(readForm());
      toast('설정을 저장했어요.', 'success');
      render(container);
    });
    renderFileUsage();
  }

  function renderFileUsage() {
    const el = rootEl.querySelector('#setFiles');
    if (!DN.Files) { el.textContent = ''; return; }
    DN.Files.list().then(function (list) {
      const total = list.reduce(function (n, f) { return n + (f.size || 0); }, 0);
      el.textContent = '첨부 파일 ' + list.length + '개 · 모두 ' + DN.Files.formatBytes(total) +
        ' (파일 하나가 ' + DN.Files.formatBytes(DN.Files.WARN_BYTES) + '를 넘으면 첨부할 때 알려 드려요)';
    }, function (e) {
      el.textContent = (e && e.message) || '첨부 파일 저장소를 쓸 수 없어요.';
    });
  }

  return { SCHEMA_VERSION, get, save, ensure, defaultSchoolYear, render, look, setLook, applyLook, lookPickerHtml, bindLookPicker };
})();
