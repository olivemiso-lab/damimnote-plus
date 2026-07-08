// ════════════════════════════════════════════════════
//  담임노트+ · 앱 라우터 & 공통 화면 (DN.App)
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.App = (function () {
  const { esc } = DN.utils;

  // 메뉴 정의 — ready:false 는 다음 단계 예정
  const MENU = [
    { id: 'dashboard', icon: '🌈', label: '행복한 우리 반', ready: true },
    { id: 'students',  icon: '👦', label: '학생 관리', ready: true },
    { id: 'attend',    icon: '📅', label: '출석부', ready: true },
    { id: 'groups',    icon: '🪑', label: '자리·모둠 배치', ready: true },
    { id: 'sociogram', icon: '🕸️', label: '교우관계도', ready: true },
    { id: 'observe',   icon: '📝', label: '관찰 기록', ready: true },
    { id: 'counsel',   icon: '💬', label: '상담 기록', ready: true },
    { id: 'assess',    icon: '📊', label: '수행평가', ready: true },
    { id: 'growth',    icon: '📈', label: '성장 분석', ready: true },
    { id: 'report',    icon: '📋', label: '행동특성 작성', ready: true },
    { id: 'resources', icon: '🔗', label: '자료실', ready: true },
    { id: 'data',      icon: '💾', label: '데이터 관리', ready: true },
    { id: 'settings',  icon: '⚙️', label: '설정', ready: true },
  ];

  let current = 'dashboard';

  const APP_VERSION = '1.0.0'; // 배포용 버전 — 업데이트 배포 시 올릴 것

  // ── 학급 화면(메인)용 상수 ──
  const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
  // 오늘의 안전 한 줄 — 날짜에 따라 자동 순환 (초등 눈높이)
  const SAFETY_TIPS = [
    '🚸 횡단보도는 우측에서, 손을 들고 좌우를 살핀 뒤 건너요.',
    '🚌 버스에서 내린 뒤에는 버스 앞뒤로 길을 건너지 않아요.',
    '🧯 불이 나면 "불이야!"를 외치고, 몸을 낮춰 젖은 수건으로 코와 입을 막고 대피해요.',
    '🎢 계단에서는 뛰지 않고 오른쪽으로 한 칸씩 걸어요.',
    '✂️ 가위나 연필 같은 뾰족한 물건은 친구에게 던지거나 휘두르지 않아요.',
    '🤝 친구와 부딪혔을 때는 먼저 "괜찮아?"라고 물어봐요.',
    '💻 인터넷에서 이름·학교·전화번호 같은 개인정보를 알려주지 않아요.',
    '📱 모르는 사람이 보낸 링크는 절대 누르지 않아요.',
    '🍽️ 밥 먹기 전, 화장실 다녀온 뒤에는 30초 이상 손을 씻어요.',
    '⚽ 운동하기 전에는 준비운동으로 몸을 풀어요.',
    '🚪 문을 닫을 때는 뒤에 친구가 있는지 확인해요.',
    '🌡️ 몸이 아프면 참지 말고 바로 선생님께 말해요.',
    '🧪 과학실에서는 선생님 안내 없이 실험 도구를 만지지 않아요.',
    '🚲 자전거를 탈 때는 꼭 헬멧을 써요.',
    '🏊 물놀이는 어른과 함께, 준비운동 후에 해요.',
    '⚡ 젖은 손으로 전기 콘센트나 스위치를 만지지 않아요.',
    '🐕 모르는 동물에게 함부로 손을 내밀지 않아요.',
    '🗣️ 낯선 사람이 따라오라고 하면 "싫어요!"라고 크게 외치고 어른에게 알려요.',
    '🧊 겨울철 얼음 위에는 절대 올라가지 않아요.',
    '🎆 여름철 창문 밖으로 몸을 내밀지 않아요.',
    '🚦 신호등이 깜빡일 때는 다음 신호를 기다려요.',
    '👟 실내에서는 뛰지 않고 사뿐사뿐 걸어요.',
  ];

  function start() {
    DN.Store.init();
    renderShell();
    go('dashboard');
  }

  // ── 전체 골격(사이드바 + 콘텐츠) ──
  function renderShell() {
    const settings = DN.Store.getObject('settings', {});
    const classLabel = [settings.grade && settings.grade + '학년', settings.classNo && settings.classNo + '반']
      .filter(Boolean).join(' ') || '학급 미설정';

    document.getElementById('app').innerHTML = `
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <div class="brand-title">담임노트<span>+</span></div>
          <div class="brand-sub">담임의 기록이 학생의 성장으로</div>
        </div>
        <nav class="menu">
          ${MENU.map(m => `
            <button class="menu-item${m.id === current ? ' active' : ''}" data-go="${m.id}">
              <span class="mi-icon">${m.icon}</span>
              <span class="mi-label">${m.label}</span>
              ${m.ready ? '' : '<span class="mi-soon">예정</span>'}
            </button>`).join('')}
        </nav>
        <div class="side-foot">${esc(classLabel)}</div>
      </aside>

      <div class="content-wrap">
        <header class="topbar">
          <button class="hamburger" id="hamburger">☰</button>
          <div class="top-class">${esc(classLabel)}</div>
          <button class="btn-ghost top-move" id="moveBtn" title="백업 파일로 다른 컴퓨터와 데이터 옮기기">🔄 집↔학교</button>
        </header>
        <main class="content" id="content"></main>
      </div>
      <div class="overlay" id="overlay"></div>`;

    document.querySelectorAll('[data-go]').forEach(b =>
      b.addEventListener('click', () => { go(b.dataset.go); closeSidebar(); }));
    document.getElementById('hamburger').addEventListener('click', toggleSidebar);
    document.getElementById('overlay').addEventListener('click', closeSidebar);
    document.getElementById('moveBtn').addEventListener('click', showMoveModal);
  }

  // ── 집↔학교 데이터 옮기기 모달 ──
  // 데이터는 컴퓨터·브라우저별로 따로 저장되므로 백업 파일로 옮긴다
  function showMoveModal() {
    const old = document.getElementById('moveModal');
    if (old) old.remove();
    const settings = DN.Store.getObject('settings', {});
    const last = settings.lastBackup ? DN.utils.fmtDateTime(settings.lastBackup) : '없음';

    const wrap = document.createElement('div');
    wrap.id = 'moveModal';
    wrap.className = 'qr-overlay';
    wrap.innerHTML = `
      <div class="qr-box move-box">
        <div class="qr-title">🔄 집↔학교 데이터 옮기기</div>
        <p class="move-desc">데이터는 <b>이 컴퓨터의 브라우저 안에만</b> 저장돼요.<br>
          다른 컴퓨터에서 이어서 하려면 백업 파일로 옮겨주세요.</p>
        <button class="btn-primary full" id="mvSave">💾 ① 여기서 작업 끝! — 백업 내려받기</button>
        <p class="move-hint">내려받은 파일을 USB나 개인 드라이브에 두세요. · 마지막 백업: ${esc(last)}</p>
        <button class="btn-secondary full" id="mvLoad">📂 ② 다른 곳에서 작업해 옴 — 백업 불러오기</button>
        <input type="file" id="mvFile" accept=".json,application/json" style="display:none">
        <p class="move-hint">불러오면 이 컴퓨터의 현재 데이터가 백업 내용으로 <b>교체</b>됩니다.</p>
        <button class="btn-cancel full" id="mvClose">닫기</button>
      </div>`;
    document.body.appendChild(wrap);

    const close = () => wrap.remove();
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    wrap.querySelector('#mvClose').addEventListener('click', close);

    wrap.querySelector('#mvSave').addEventListener('click', () => {
      const data = DN.Store.exportAll();
      DN.utils.download(`담임노트백업_${DN.utils.today()}.json`, JSON.stringify(data, null, 2));
      const s = DN.Store.getObject('settings', {});
      s.lastBackup = DN.utils.nowISO();
      DN.Store.setObject('settings', s);
      DN.utils.toast('백업 파일을 내려받았어요! USB·드라이브에 보관하세요.', 'success');
      close();
    });

    wrap.querySelector('#mvLoad').addEventListener('click', () => wrap.querySelector('#mvFile').click());
    wrap.querySelector('#mvFile').addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          const n = Array.isArray(data.students) ? data.students.length : 0;
          if (!DN.utils.confirmAsk(`백업(학생 ${n}명)으로 이 컴퓨터의 데이터를 교체할까요?\n지금 이 컴퓨터에 있던 데이터는 사라집니다.`)) {
            e.target.value = ''; return;
          }
          DN.Store.importAll(data, 'replace');
          DN.utils.toast('복원 완료! 이어서 작업하세요. 😊', 'success');
          close();
          renderShell();
          go(current);
        } catch (err) {
          DN.utils.toast('복원 실패: ' + err.message, 'error');
        }
        e.target.value = '';
      };
      reader.readAsText(f, 'utf-8');
    });
  }

  function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('overlay').classList.toggle('show'); }
  function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('overlay').classList.remove('show'); }

  // ── 라우팅 ──
  function go(id) {
    const menu = MENU.find(m => m.id === id);
    if (!menu) return;
    current = id;
    document.querySelectorAll('.menu-item').forEach(b =>
      b.classList.toggle('active', b.dataset.go === id));
    const content = document.getElementById('content');
    content.scrollTop = 0;

    if (!menu.ready) { renderPlaceholder(content, menu); return; }
    switch (id) {
      case 'dashboard': renderDashboard(content); break;
      case 'students':  DN.Students.render(content); break;
      case 'attend':    DN.Attendance.render(content); break;
      case 'groups':    DN.Groups.render(content); break;
      case 'sociogram': DN.Sociogram.render(content); break;
      case 'observe':   DN.Observe.render(content); break;
      case 'counsel':   DN.Counsel.render(content); break;
      case 'assess':    DN.Assessment.render(content); break;
      case 'growth':    DN.Growth.render(content); break;
      case 'report':    DN.Report.render(content); break;
      case 'resources': DN.Resources.render(content); break;
      case 'data':      DN.Backup.render(content); break;
      case 'settings':  renderSettings(content); break;
      default: renderPlaceholder(content, menu);
    }
  }

  // ── 대시보드 ──
  function renderDashboard(c) {
    const students = DN.Store.getAll('students').sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999));
    const obs = DN.Store.getAll('observations');
    const cou = DN.Store.getAll('counselings');
    const settings = DN.Store.getObject('settings', {});

    if (!students.length) {
      c.innerHTML = `
        <div class="page-head"><h1>🌈 행복한 우리 반</h1></div>
        <div class="welcome">안녕하세요, 선생님! 담임노트+에 오신 것을 환영합니다. 🌱</div>
        <div class="card guide-card">
          <h2>🚀 시작하기</h2>
          <p class="desc">먼저 우리 반 학생을 등록해보세요. 한 번 입력하면 자리배치·모둠·관찰·행동특성 작성에 모두 자동으로 활용됩니다.</p>
          <button class="btn-primary" data-jump="students">학생 추가하러 가기 →</button>
        </div>`;
      c.querySelector('[data-jump]').addEventListener('click', () => go('students'));
      return;
    }

    const noRecord = students.filter(s => !obs.some(o => o.studentId === s.id));
    const analyzed = students.map(s => ({ s, a: DN.Growth.analyze(s.id) }));
    const strong = analyzed.filter(x => x.a.strengths.length)
      .sort((a, b) => b.a.strengths.length - a.a.strengths.length).slice(0, 4);
    const support = analyzed.filter(x => x.a.supports.length || x.s.conflictRisk === 'high' || x.s.lethargic)
      .sort((a, b) => b.a.supports.length - a.a.supports.length).slice(0, 4);
    const recent = obs.map(o => ({ type: 'obs', r: o })).concat(cou.map(x => ({ type: 'cou', r: x })))
      .sort((a, b) => (b.r.createdAt > a.r.createdAt ? 1 : -1)).slice(0, 6);

    const lb = settings.lastBackup;
    const days = lb ? (Date.now() - new Date(lb).getTime()) / 86400000 : 999;
    const backupBanner = (days > 7)
      ? `<div class="dash-banner"><span>💾 ${lb ? '마지막 백업이 ' + Math.floor(days) + '일 전입니다.' : '아직 백업한 적이 없습니다.'} 소중한 기록을 안전하게 지켜주세요.</span><button class="btn-secondary mini" data-jump="data">백업하기</button></div>`
      : '';
    const attBanner = (DN.Attendance && !DN.Attendance.isTodayDone())
      ? `<div class="dash-banner att"><span>📅 오늘 출석을 아직 입력하지 않았어요.</span><button class="btn-secondary mini" data-jump="attend">출석부 열기</button></div>`
      : '';

    // ── 학급 화면 정보 (아이들 앞에 띄워도 되는 것만) ──
    const now = new Date();
    const dateStr = `${now.getMonth() + 1}월 ${now.getDate()}일 ${DAY_NAMES[now.getDay()]}요일`;
    const motto = (settings.motto || '').trim();
    // 오늘의 시간표 (settings.timetable = [월..금][1~6교시])
    const dow = now.getDay();
    const isWeekday = dow >= 1 && dow <= 5;
    const ttToday = isWeekday ? ((settings.timetable || [])[dow - 1] || []) : [];
    const ttFilled = ttToday.some(x => x && String(x).trim());
    const ttHtml = !isWeekday
      ? '<p class="empty">오늘은 주말이에요! 🎉</p>'
      : ttFilled
        ? `<div class="tt-list">${ttToday.map((sub, i) => sub && String(sub).trim()
            ? `<div class="tt-row"><span class="tt-p">${i + 1}교시</span><span class="tt-s">${esc(sub)}</span></div>` : '').join('')}</div>`
        : '<p class="empty">⚙️ 설정에서 시간표를 입력하면 여기에 나와요.</p>';
    // 오늘의 알림장
    const notices = DN.Store.getObject('notices', {});
    const todayKey = DN.utils.today();
    const noticeText = notices[todayKey] || '';
    // 오늘의 안전 한 줄 (연중 날짜로 순환)
    const doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    const safety = SAFETY_TIPS[doy % SAFETY_TIPS.length];

    c.innerHTML = `
      <div class="page-head"><h1>🌈 행복한 우리 반</h1></div>

      <div class="main-hero">
        <div class="hero-date">🗓️ ${dateStr}</div>
        <div class="hero-motto">${motto ? esc(motto) : '<span class="motto-empty">⚙️ 설정에서 우리 반 급훈을 입력해보세요</span>'}</div>
      </div>

      ${attBanner}
      ${backupBanner}

      <div class="dash-cols">
        <div class="card">
          <div class="card-head"><h2>📚 오늘의 시간표</h2></div>
          ${ttHtml}
        </div>
        <div class="card">
          <div class="card-head"><h2>📢 오늘의 알림</h2>
            <button class="btn-ghost mini" id="noticeEdit" title="알림 쓰기" style="margin-left:auto">✏️</button>
          </div>
          <div id="noticeView" class="notice-view">${noticeText ? esc(noticeText).replace(/\n/g, '<br>') : '<span class="empty">준비물·일정 등 오늘의 알림을 적어보세요.</span>'}</div>
          <div id="noticeBox" style="display:none">
            <textarea id="noticeInput" rows="4" placeholder="예) 내일 미술 준비물: 색종이, 풀&#10;3교시 운동장 체육">${esc(noticeText)}</textarea>
            <button class="btn-primary full" id="noticeSave">💾 알림 저장</button>
          </div>
        </div>
      </div>

      <div class="card safety-card">
        <span class="safety-ico">🦺</span>
        <div class="safety-body"><b>오늘의 안전 한 줄</b><p>${safety}</p></div>
      </div>

      <details class="teacher-zone">
        <summary>🔒 선생님만 보기 — 우리 반 현황 (아이들 앞에서는 닫아두세요)</summary>
        <div class="tz-body">
          <div class="stat-grid">
            ${statCard('👦', '학생 수', students.length + '명', '#667eea')}
            ${statCard('📝', '관찰 기록', obs.length + '건', '#66bb6a')}
            ${statCard('💬', '상담 기록', cou.length + '건', '#ffa726')}
            ${statCard('📌', '미기록 학생', noRecord.length + '명', '#ef5350')}
          </div>
          <div class="dash-cols">
            <div class="card">
              <div class="card-head"><h2>💪 성장 우수</h2></div>
              ${strong.length ? `<div class="widget-list">${strong.map(x => widgetRow(x.s, x.a.strengths.map(i => i.label).slice(0, 3).join(', '), 'good')).join('')}</div>` : '<p class="empty">관찰 기록이 쌓이면 표시됩니다.</p>'}
            </div>
            <div class="card">
              <div class="card-head"><h2>🌱 지원 필요</h2></div>
              ${support.length ? `<div class="widget-list">${support.map(x => widgetRow(x.s, supportReason(x), 'low')).join('')}</div>` : '<p class="empty">특별히 지원이 필요한 학생이 없습니다.</p>'}
            </div>
          </div>
          ${noRecord.length ? `<div class="card">
            <div class="card-head"><h2>📌 관찰 기록이 없는 학생</h2><span class="count-chip">${noRecord.length}명</span></div>
            <div class="mini-roster">${noRecord.map(s => `<span class="roster-chip click" data-obs="${s.id}">${esc(s.number || '')} ${esc(s.name)}</span>`).join('')}</div>
            <p class="hint">학생 이름을 누르면 바로 관찰 기록을 남길 수 있어요.</p></div>` : ''}
          <div class="card">
            <div class="card-head"><h2>🕒 최근 기록</h2></div>
            ${recent.length ? `<div class="recent-list">${recent.map(recentRow).join('')}</div>` : '<p class="empty">아직 기록이 없습니다.</p>'}
          </div>
        </div>
      </details>`;

    c.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => go(b.dataset.jump)));
    c.querySelectorAll('[data-stu]').forEach(b => b.addEventListener('click', () => { DN.Growth.setStudent(b.dataset.stu); go('growth'); }));
    c.querySelectorAll('[data-obs]').forEach(b => b.addEventListener('click', () => { DN.Observe.setStudent(b.dataset.obs); go('observe'); }));

    // 오늘의 알림 쓰기/저장
    const noticeBox = c.querySelector('#noticeBox');
    const noticeView = c.querySelector('#noticeView');
    c.querySelector('#noticeEdit').addEventListener('click', () => {
      const open = noticeBox.style.display !== 'none';
      noticeBox.style.display = open ? 'none' : 'block';
      noticeView.style.display = open ? 'block' : 'none';
      if (!open) c.querySelector('#noticeInput').focus();
    });
    c.querySelector('#noticeSave').addEventListener('click', () => {
      const map = DN.Store.getObject('notices', {});
      const text = c.querySelector('#noticeInput').value.trim();
      if (text) map[todayKey] = text; else delete map[todayKey];
      // 30일 지난 알림은 정리
      const limit = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      Object.keys(map).forEach(k => { if (k < limit) delete map[k]; });
      DN.Store.setObject('notices', map);
      DN.utils.toast('오늘의 알림을 저장했습니다!', 'success');
      renderDashboard(c);
    });
  }

  function statCard(icon, label, value, color) {
    return `<div class="stat-card" style="--c:${color}">
      <div class="sc-icon">${icon}</div>
      <div class="sc-body"><div class="sc-value">${esc(value)}</div><div class="sc-label">${esc(label)}</div></div>
    </div>`;
  }
  function widgetRow(s, sub, kind) {
    return `<div class="widget-row" data-stu="${s.id}">
      <span class="wr-no">${esc(s.number || '–')}</span>
      <span class="wr-name">${esc(s.name)}</span>
      <span class="wr-sub ${kind}">${esc(sub || '')}</span></div>`;
  }
  function supportReason(x) {
    const r = [];
    if (x.a.supports.length) r.push(x.a.supports.map(i => i.label).slice(0, 2).join(', '));
    if (x.s.conflictRisk === 'high') r.push('갈등 주의');
    if (x.s.lethargic) r.push('무기력');
    return r.join(' · ') || '관찰 필요';
  }
  function recentRow(it) {
    const s = DN.Store.get('students', it.r.studentId);
    const name = s ? s.name : '(삭제된 학생)';
    const date = DN.utils.fmtDate(it.r.date);
    if (it.type === 'obs') {
      const txt = it.r.generatedText || DN.NLG.summary(it.r) || '관찰 기록';
      return `<div class="recent-row"><span class="rr-ico obs">📝</span><div class="rr-body">
        <div class="rr-top"><b>${esc(name)}</b><span class="rr-date">${esc(date)}</span></div>
        <div class="rr-text">${esc(txt)}</div></div></div>`;
    }
    const who = it.r.type === 'parent' ? '학부모 상담' : '학생 상담';
    return `<div class="recent-row"><span class="rr-ico cou">💬</span><div class="rr-body">
      <div class="rr-top"><b>${esc(name)}</b><span class="rr-date">${esc(date)}</span></div>
      <div class="rr-text">${esc(who)}: ${esc(it.r.content || '')}</div></div></div>`;
  }

  // ── 설정 ──
  function renderSettings(c) {
    const s = DN.Store.getObject('settings', {});
    c.innerHTML = `
      <div class="page-head"><h1>⚙️ 설정</h1></div>
      <div class="card">
        <h2>학급 정보</h2>
        <p class="desc">입력한 학급 정보는 화면 상단과 인쇄물에 표시됩니다.</p>
        <div class="frow"><label>학교명</label><input type="text" id="set_school" value="${esc(s.schoolName||'')}" placeholder="○○초등학교"></div>
        <div class="frow">
          <label>학년</label><input type="number" id="set_grade" min="1" max="6" value="${esc(s.grade||'')}" style="width:80px">
          <label>반</label><input type="number" id="set_class" min="1" max="20" value="${esc(s.classNo||'')}" style="width:80px">
        </div>
        <div class="frow"><label>담임명</label><input type="text" id="set_teacher" value="${esc(s.teacher||'')}" placeholder="선생님 성함"></div>
        <div class="frow"><label>급훈</label><input type="text" id="set_motto" maxlength="40" value="${esc(s.motto||'')}" placeholder="예) 서로 돕고 함께 자라는 우리" style="flex:1"></div>
      </div>

      <div class="card">
        <h2>📚 주간 시간표</h2>
        <p class="desc">입력하면 메인 화면에 <b>오늘의 시간표</b>가 자동으로 표시됩니다. 없는 교시는 비워두세요.</p>
        <div class="tt-edit">
          <div class="tt-edit-head"><span></span>${['월','화','수','목','금'].map(d => `<span>${d}</span>`).join('')}</div>
          ${[0,1,2,3,4,5].map(p => `
            <div class="tt-edit-row"><span class="tt-edit-p">${p + 1}교시</span>
              ${[0,1,2,3,4].map(d => `<input type="text" class="tt-cell" data-d="${d}" data-p="${p}" maxlength="6" value="${esc(((s.timetable || [])[d] || [])[p] || '')}">`).join('')}
            </div>`).join('')}
        </div>
        <button class="btn-primary" id="saveSet" style="margin-top:0.8rem">💾 설정 저장</button>
      </div>
      <div class="card info-card">
        <h2>ℹ️ 담임노트+ 정보 <small class="muted">v${APP_VERSION}</small></h2>
        <p class="desc">학생 관리 · 출석부 · 자리·모둠 배치 · 교우관계 · 관찰/상담 기록 · 수행평가 · 성장 분석 · 행동특성 작성 · 자료실(QR)까지 하나로 연결된 담임 업무 도구입니다.</p>
        <p class="desc"><b>🔒 개인정보 안내</b> — 모든 데이터는 <b>이 컴퓨터의 브라우저 안에만</b> 저장되며, 인터넷으로 전송되지 않습니다(100% 오프라인 동작).</p>
        <p class="desc"><b>⚠️ 꼭 기억하세요</b> — 브라우저의 <b>‘인터넷 사용 기록 삭제’</b>를 하면 데이터가 지워질 수 있어요. <b>데이터 관리</b>에서 주기적으로 백업(JSON)해 두세요. 컴퓨터·브라우저를 바꿀 때도 백업 → 복원으로 옮깁니다.</p>
        <p class="desc"><small class="muted">오픈소스: pdf.js (Mozilla, Apache-2.0) · qrcode-generator (Kazuhiko Arase, MIT)</small></p>
        <p class="desc">담임의 기록이 학생의 성장으로 이어집니다. · Silver쌤 &amp; 루미 🌱</p>
      </div>`;
    c.querySelector('#saveSet').addEventListener('click', () => {
      const timetable = [[], [], [], [], []];
      c.querySelectorAll('.tt-cell').forEach(inp => {
        timetable[+inp.dataset.d][+inp.dataset.p] = inp.value.trim();
      });
      const next = Object.assign({}, s, {
        schoolName: c.querySelector('#set_school').value.trim(),
        grade: c.querySelector('#set_grade').value.trim(),
        classNo: c.querySelector('#set_class').value.trim(),
        teacher: c.querySelector('#set_teacher').value.trim(),
        motto: c.querySelector('#set_motto').value.trim(),
        timetable,
      });
      DN.Store.setObject('settings', next);
      DN.utils.toast('설정이 저장되었습니다!', 'success');
      renderShell(); go('settings');
    });
  }

  // ── 준비 중 화면 ──
  function renderPlaceholder(c, menu) {
    c.innerHTML = `
      <div class="page-head"><h1>${menu.icon} ${esc(menu.label)}</h1></div>
      <div class="card placeholder">
        <div class="ph-icon">${menu.icon}</div>
        <h2>다음 단계에서 만나요!</h2>
        <p class="desc"><b>${esc(menu.label)}</b> 기능은 곧 추가될 예정입니다.<br>지금은 학생 관리부터 시작해 데이터를 차곡차곡 쌓아주세요.</p>
        <button class="btn-secondary" id="phBack">학생 관리로 가기</button>
      </div>`;
    c.querySelector('#phBack').addEventListener('click', () => go('students'));
  }

  return { start, go };
})();

document.addEventListener('DOMContentLoaded', DN.App.start);
