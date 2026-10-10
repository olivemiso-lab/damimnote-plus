// ════════════════════════════════════════════════════
//  담임노트+ · 보상 (DN.Rewards) — 개인 칭찬 점수 · 모둠 점수 · 학급 온도계 · 숙제 검사
//  초등이라 벌점 없이 칭찬만 쌓는다. 보상을 쓰면 그만큼 점수가 줄어든다(잔액 = 모든 기록의 합)
//  points   { date, level: student|group|class, target(번호·모둠 번호·0), delta, label, spend?, hw?, device }
//  rewards  { level, label, cost, order }   — 보상 목록 (PC가 기준, 핸드폰으로 보냄)
//  homework { date, title, done: [번호], reward(낸 학생 +1), device }
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Rewards = (function () {
  const { esc, toast, confirmAsk, openModal, closeModal, copyText, today } = DN.utils;
  const PTS = 'points', RWD = 'rewards', HW = 'homework';
  const LEVELS = ['student', 'group', 'class'];
  const LEVEL_NAME = { student: '개인', group: '모둠', class: '학급' };
  // 빠른 칭찬 이유 (누르면 바로 +1)
  const REASONS = {
    student: ['숙제 완료', '발표', '친구 도움', '바른 자세', '정리 정돈', '1인 1역'],
    group: ['협동', '정리 정돈', '조용히 이동', '발표'],
    class: ['조용히 이동', '급식 깨끗이', '모두 숙제 제출', '칭찬 받음'],
  };
  const DEFAULT_REWARDS = [
    ['student', '급식 먼저 먹기', 10], ['student', '짝 바꾸기 1회', 15], ['student', '선생님 자리 앉아 보기', 15], ['student', '숙제 1번 면제', 20],
    ['group', '급식 우선권 (1주)', 20], ['group', '모둠 자유 자리', 30],
    ['class', '영화 보는 날', 100],
  ];

  function alive(r) { return !r.deleted; }
  function device() { return DN.Settings.get().deviceRole === 'mobile' ? 'mobile' : 'pc'; }
  function md(d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8)); }

  // ── 보상 목록 ──
  function rewards(level) {
    let all = DN.Store.getAll(RWD);
    if (!all.length && !DN.Store.getMeta('rewardsMade')) {
      DN.Store.batch(RWD, { add: DEFAULT_REWARDS.map(function (r, i) { return { level: r[0], label: r[1], cost: r[2], order: i + 1 }; }) });
      DN.Store.setMeta('rewardsMade', '1');
      all = DN.Store.getAll(RWD);
    }
    return all.filter(function (r) { return alive(r) && (!level || r.level === level); })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }
  const clampCost = function (n) { n = parseInt(n, 10); return n >= 1 && n <= 999 ? n : 10; };
  function addReward(level, label, cost) {
    const t = String(label || '').trim().slice(0, 30);
    if (!t || LEVELS.indexOf(level) < 0) return null;
    const max = rewards().reduce(function (m, r) { return Math.max(m, r.order || 0); }, 0);
    return DN.Store.add(RWD, { level: level, label: t, cost: clampCost(cost), order: max + 1 });
  }
  function updateReward(id, patch) {
    const p = Object.assign({}, patch);
    if ('label' in p) p.label = String(p.label).trim().slice(0, 30);
    if ('cost' in p) p.cost = clampCost(p.cost);
    return DN.Store.update(RWD, id, p);
  }
  function removeReward(id) { return DN.Store.update(RWD, id, { deleted: true }); }
  // 학급 온도계 목표: 학급 보상 중 첫 번째 (없으면 100도)
  function classGoal() {
    const r = rewards('class')[0];
    return r ? { label: r.label, cost: r.cost } : { label: '학급 보상', cost: 100 };
  }

  // ── 점수 ──
  function points(level, from, to) {
    return DN.Store.query(PTS, function (r) {
      return alive(r) && (!level || r.level === level) && (!from || r.date >= from) && (!to || r.date <= to);
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt < b.createdAt ? -1 : 1); });
  }
  // 칭찬 주기: targets 여럿에게 같은 점수. 결과: 저장된 기록 배열
  function give(level, date, targets, delta, label, extra) {
    const d = parseInt(delta, 10);
    if (LEVELS.indexOf(level) < 0 || !d || !targets.length) return [];
    const dev = device();
    return DN.Store.batch(PTS, { add: targets.map(function (t) {
      return Object.assign({ date: date, level: level, target: +t || 0, delta: d, label: String(label || '').trim().slice(0, 40), device: dev }, extra || {});
    }) }) || [];
  }
  // 보상 쓰기: 점수에서 비용만큼 뺀다
  function spend(level, target, reward, date) {
    return give(level, date || today(), [target], -reward.cost, '🎁 ' + reward.label, { spend: true });
  }
  // { 대상: 잔액 }
  function balances(level, from, to) {
    const out = {};
    points(level, from, to).forEach(function (r) { out[r.target] = (out[r.target] || 0) + r.delta; });
    return out;
  }
  // 받은 점수만 (보상에 쓴 것 빼지 않음)
  function earned(level, from, to) {
    const out = {};
    points(level, from, to).forEach(function (r) { if (!r.spend && r.delta > 0) out[r.target] = (out[r.target] || 0) + r.delta; });
    return out;
  }
  function classTemp() { return balances('class')[0] || 0; }
  function removePoints(ids) {
    return DN.Store.batch(PTS, { update: ids.map(function (id) { return { id: id, patch: { deleted: true } }; }) });
  }
  // 모둠 점수를 모두 0으로 (기록은 남기고 맞춤 기록을 더함)
  function resetGroups() {
    const b = balances('group');
    const nos = Object.keys(b).filter(function (k) { return b[k]; });
    nos.forEach(function (k) { give('group', today(), [+k], -b[k], '↺ 새로 시작', { spend: true }); });
    return nos.length;
  }

  // ── 모둠 ──
  function groupCount() {
    const n = parseInt(DN.Store.getMeta('groupCount'), 10);
    if (n >= 2 && n <= 12) return n;
    const s = latestSeating();
    return s && s.length >= 2 ? Math.min(12, s.length) : 6;
  }
  function setGroupCount(n) { n = parseInt(n, 10); if (n >= 2 && n <= 12) DN.Store.setMeta('groupCount', String(n)); }
  // 마지막으로 저장한 자리·모둠 배치의 모둠별 이름 (PC에만 있음)
  function latestSeating() {
    const list = DN.Store.getAll('seatings').filter(alive).sort(function (a, b) { return (b.createdAt || '') > (a.createdAt || '') ? 1 : -1; });
    return list.length ? (list[0].groups || []) : null;
  }
  function groupNames(no) {
    const s = latestSeating();
    const g = s && s.find(function (x) { return +x.id === no; });
    return g ? (g.names || []) : [];
  }
  // 이번 주(월~일)
  function weekRange(d) {
    const day = new Date((d || today()) + 'T00:00:00');
    const back = (day.getDay() + 6) % 7;
    const from = DN.Events.toStr(new Date(day.getFullYear(), day.getMonth(), day.getDate() - back));
    return { from: from, to: DN.Events.addDays(from, 6) };
  }

  // ── 숙제 검사 ──
  function homeworks() {
    return DN.Store.getAll(HW).filter(alive).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt < b.createdAt ? 1 : -1); });
  }
  function getHomework(id) { return homeworks().find(function (h) { return h.id === id; }) || null; }
  function startHomework(date, title, reward) {
    const t = String(title || '').trim().slice(0, 40);
    if (!t) return null;
    return DN.Store.add(HW, { date: date, title: t, done: [], reward: !!reward, device: device() });
  }
  // 낸 학생 표시/해제. reward면 개인 점수 +1을 같이 주고(해제하면 그 점수도 지움)
  function toggleHomework(id, no) {
    const h = getHomework(id);
    if (!h) return null;
    const done = (h.done || []).slice();
    const i = done.indexOf(no);
    if (i >= 0) done.splice(i, 1); else done.push(no);
    done.sort(function (a, b) { return a - b; });
    DN.Store.update(HW, id, { done: done });
    if (h.reward) {
      if (i >= 0) {
        const ids = points('student').filter(function (p) { return p.hw === id && p.target === no; }).map(function (p) { return p.id; });
        if (ids.length) removePoints(ids);
      } else give('student', h.date, [no], 1, '숙제 완료 · ' + h.title, { hw: id });
    }
    return i < 0;
  }
  function missing(h, nos) {
    const done = h.done || [];
    return (nos || DN.Records.studentNumbers()).filter(function (n) { return done.indexOf(n) < 0; });
  }
  function removeHomework(id) {
    const ids = points('student').filter(function (p) { return p.hw === id; }).map(function (p) { return p.id; });
    if (ids.length) removePoints(ids);
    return DN.Store.update(HW, id, { deleted: true });
  }
  // 기간 안에서 숙제를 안 낸 횟수 { 번호: 횟수 }
  function missingCounts(from, to) {
    const out = {};
    const nos = DN.Records.studentNumbers();
    homeworks().filter(function (h) { return (!from || h.date >= from) && (!to || h.date <= to); }).forEach(function (h) {
      missing(h, nos).forEach(function (n) { out[n] = (out[n] || 0) + 1; });
    });
    return out;
  }

  // ════════ 그림 ════════
  // 학급 온도계 (SVG). big이면 칠판용 큰 그림
  function thermoSvg(temp, goal, big) {
    const pct = Math.max(0, Math.min(1, goal ? temp / goal : 0));
    const h = big ? 360 : 220, w = big ? 120 : 80, tubeW = big ? 36 : 24, bulb = big ? 40 : 27;
    const top = 14, bottom = h - bulb * 2 - 6, x = (w - tubeW) / 2;
    const fillTop = bottom - (bottom - top) * pct;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(function (t) {
      const y = bottom - (bottom - top) * t;
      return '<line x1="' + (x + tubeW + 4) + '" x2="' + (x + tubeW + 12) + '" y1="' + y + '" y2="' + y + '" class="th-tick"/>';
    }).join('');
    return '<svg class="thermo' + (big ? ' big' : '') + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="학급 온도 ' + temp + '도, 목표 ' + goal + '도">' +
      '<rect x="' + x + '" y="' + (top - 6) + '" width="' + tubeW + '" height="' + (bottom - top + 20) + '" rx="' + tubeW / 2 + '" class="th-glass"/>' +
      '<circle cx="' + w / 2 + '" cy="' + (h - bulb - 4) + '" r="' + bulb + '" class="th-glass"/>' +
      '<rect x="' + (x + 5) + '" y="' + fillTop + '" width="' + (tubeW - 10) + '" height="' + (bottom - fillTop + 16) + '" rx="' + (tubeW - 10) / 2 + '" class="th-fill"/>' +
      '<circle cx="' + w / 2 + '" cy="' + (h - bulb - 4) + '" r="' + (bulb - 6) + '" class="th-fill"/>' + ticks + '</svg>';
  }

  // ════════ PC 화면 ════════
  let rootEl = null;
  const state = { view: 'student', date: today(), selected: new Set(), reason: '', amount: 1, free: '', last: null, hw: null, hwTitle: '' };
  const VIEWS = [['student', '⭐ 개인'], ['group', '👥 모둠'], ['class', '🌡️ 학급 온도계'], ['hw', '📚 숙제 검사']];

  function render(container) {
    rootEl = container;
    container.innerHTML = '<div class="page-head"><h1>🏆 보상</h1><span class="pv-spacer"></span>' +
      '<button class="btn-ghost" id="rwBig">📺 칠판에 크게 보기</button><button class="btn-ghost" id="rwEdit">🎁 보상 목록 편집</button></div>' +
      '<div class="rw-tabs" id="rwTabs">' + VIEWS.map(function (v) {
        return '<button class="rw-tab" data-v="' + v[0] + '" aria-pressed="' + (state.view === v[0]) + '">' + v[1] + '</button>';
      }).join('') + '</div><div id="rwBody"></div>';
    container.querySelector('#rwTabs').addEventListener('click', function (e) {
      const b = e.target.closest('[data-v]');
      if (!b || b.dataset.v === state.view) return;
      state.view = b.dataset.v; state.selected.clear(); state.reason = ''; state.last = null;
      render(container);
    });
    container.querySelector('#rwBig').addEventListener('click', openBig);
    container.querySelector('#rwEdit').addEventListener('click', openRewardEditor);
    const body = container.querySelector('#rwBody');
    if (state.view === 'student') renderStudent(body);
    else if (state.view === 'group') renderGroup(body);
    else if (state.view === 'class') renderClass(body);
    else renderHw(body);
  }

  function reasonChips(level) {
    return '<div class="rw-reasons">' + REASONS[level].map(function (r) {
      return '<button class="rw-reason" data-r="' + esc(r) + '" aria-pressed="' + (state.reason === r) + '">' + esc(r) + '</button>';
    }).join('') + '</div>';
  }
  function lastHtml() {
    return state.last ? '<div class="last-save"><span>방금: ' + esc(state.last.text) + '</span><button class="btn-ghost" id="rwUndo">되돌리기</button></div>' : '';
  }
  function bindLast(body) {
    const u = body.querySelector('#rwUndo');
    if (u) u.addEventListener('click', function () {
      removePoints(state.last.ids);
      state.last = null;
      toast('방금 점수를 되돌렸어요.', 'info');
      render(rootEl);
    });
  }
  function saved(list, text) {
    if (!list.length) { toast('저장하지 못했어요.', 'error'); return; }
    state.last = { ids: list.map(function (r) { return r.id; }), text: text };
    toast(text, 'success');
    render(rootEl);
  }
  const signed = function (n) { return (n > 0 ? '+' : '') + n; };

  // ── 개인 ──
  function renderStudent(body) {
    const bal = balances('student');
    const names = DN.Records.nameMap();
    const list = rewards('student');
    body.innerHTML = '<div class="card quick"><div class="quick-head"><h2 class="side-title">칭찬 점수 주기</h2>' +
      '<label class="quick-date">날짜 <input type="date" id="rwDate" value="' + esc(state.date) + '"></label>' +
      '<span class="quick-help">① 번호를 고르고 ② 이유를 누르면 +1점이 바로 쌓여요.</span></div>' +
      '<div id="rwPicker"></div>' + reasonChips('student') +
      '<div class="free-row"><span class="preset-gname">직접</span><input type="text" id="rwFree" maxlength="40" placeholder="이유 (예: 줄넘기 대회 응원)" value="' + esc(state.free) + '">' +
      '<input type="number" id="rwAmt" min="1" max="20" value="' + state.amount + '" aria-label="점수"><span class="ce-unit">점</span><button class="btn-secondary" id="rwFreeSave">주기</button></div>' +
      lastHtml() + '</div>' +
      '<div class="rw-grid2"><div class="card"><div class="side-head"><h2 class="side-title">⭐ 점수판</h2><button class="btn-ghost side-add" id="rwCsv">📥 엑셀</button></div>' +
      '<p class="set-help">학생을 누르면 기록을 보고 보상을 쓸 수 있어요. 숫자는 지금 남은 점수예요.</p><div class="rw-board">' +
      DN.Records.studentNumbers().map(function (n) {
        const b = bal[n] || 0;
        const can = list.some(function (r) { return b >= r.cost; });
        return '<button class="rw-stu' + (can ? ' can' : '') + '" data-no="' + n + '"><b>' + n + '</b>' + (names[n] ? '<small>' + esc(names[n]) + '</small>' : '') +
          '<span class="rw-score">⭐ ' + b + '</span></button>';
      }).join('') + '</div></div>' +
      '<div class="card"><h2 class="side-title">🎁 개인 보상</h2>' + rewardList(list) +
      '<p class="set-help">초록 테두리 학생은 받을 수 있는 보상이 있어요.</p></div></div>';
    const pick = body.querySelector('#rwPicker');
    pick.innerHTML = DN.Picker.html(state.selected);
    DN.Picker.bind(pick, state.selected);
    body.querySelector('#rwDate').addEventListener('change', function (e) { state.date = e.target.value || today(); });
    body.querySelector('#rwFree').addEventListener('input', function (e) { state.free = e.target.value; });
    body.querySelector('#rwAmt').addEventListener('change', function (e) { state.amount = Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1)); });
    const giveSel = function (label, amt) {
      if (!state.selected.size) { toast('먼저 학생 번호를 골라 주세요.', 'info'); return; }
      const nos = Array.from(state.selected).sort(function (a, b) { return a - b; });
      const list2 = give('student', state.date, nos, amt, label);
      state.selected.clear();
      saved(list2, DN.Picker.listText(nos) + ' · ' + (label || '칭찬') + ' ' + signed(amt) + '점');
    };
    body.querySelector('.rw-reasons').addEventListener('click', function (e) {
      const b = e.target.closest('[data-r]');
      if (b) giveSel(b.dataset.r, 1);
    });
    body.querySelector('#rwFreeSave').addEventListener('click', function () {
      if (!state.selected.size) { toast('먼저 학생 번호를 골라 주세요.', 'info'); return; }
      const label = state.free.trim();
      state.free = '';
      giveSel(label, state.amount);
    });
    body.querySelector('.rw-board').addEventListener('click', function (e) {
      const b = e.target.closest('[data-no]');
      if (b) openStudent(+b.dataset.no);
    });
    body.querySelector('#rwCsv').addEventListener('click', exportCsv);
    bindLast(body);
  }
  function rewardList(list) {
    return list.length ? '<ul class="rw-list">' + list.map(function (r) {
      return '<li><span>' + esc(r.label) + '</span><b>' + r.cost + '점</b></li>';
    }).join('') + '</ul>' : '<p class="side-empty">보상이 없어요. [🎁 보상 목록 편집]에서 넣어 주세요.</p>';
  }
  // 학생 한 명: 기록 · 보상 쓰기
  function openStudent(no) {
    const draw = function () {
      const b = balances('student')[no] || 0;
      const hist = points('student').filter(function (p) { return p.target === no; }).reverse();
      return '<div class="rw-me"><span class="rw-big-score">⭐ ' + b + '점</span><span class="set-help">받은 점수 모두 ' + (earned('student')[no] || 0) + '점</span></div>' +
        '<div class="section-label">보상 쓰기</div><div class="rw-spend">' + rewards('student').map(function (r) {
          return '<button class="btn-secondary" data-spend="' + esc(r.id) + '"' + (b >= r.cost ? '' : ' disabled') + '>🎁 ' + esc(r.label) + ' <b>' + r.cost + '</b></button>';
        }).join('') + '</div>' +
        '<div class="section-label">기록 (' + hist.length + '건)</div><div class="rw-hist">' + (hist.length ? hist.slice(0, 60).map(function (p) {
          return '<div class="rw-h"><span>' + md(p.date) + '</span><span class="' + (p.delta < 0 ? 'neg' : 'pos') + '">' + signed(p.delta) + '</span><span>' + esc(p.label || '칭찬') + '</span>' +
            '<button class="ic del" data-del="' + esc(p.id) + '" aria-label="지우기">✕</button></div>';
        }).join('') : '<p class="side-empty">아직 기록이 없어요.</p>') + '</div>';
    };
    const m = openModal(DN.Records.label(no), '<div id="rwStu">' + draw() + '</div>', '<span class="pv-spacer"></span><button class="btn-primary" data-close>닫기</button>');
    const box = m.querySelector('#rwStu');
    box.addEventListener('click', function (e) {
      const sp = e.target.closest('[data-spend]'), del = e.target.closest('[data-del]');
      if (sp) {
        const r = rewards('student').find(function (x) { return x.id === sp.dataset.spend; });
        if (r && confirmAsk(DN.Records.label(no) + ' — “' + r.label + '” 보상에 ' + r.cost + '점을 쓸까요?')) {
          spend('student', no, r);
          toast('🎁 ' + r.label + ' 보상을 줬어요!', 'success');
          box.innerHTML = draw();
        }
      }
      if (del && confirmAsk('이 기록을 지울까요?')) { removePoints([del.dataset.del]); box.innerHTML = draw(); }
    });
    m.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) render(rootEl); });
  }
  function exportCsv() {
    const names = DN.Records.nameMap();
    const rows = [['번호', '이름', '날짜', '요일', '점수', '이유', '기록한 곳']].concat(points('student').map(function (p) {
      return [p.target, names[p.target] || '', p.date, DN.Events.weekdayOf(p.date), p.delta, p.label || '', p.device === 'mobile' ? '핸드폰' : 'PC'];
    }));
    if (rows.length < 2) { toast('아직 점수 기록이 없어요.', 'info'); return; }
    DN.Backup.download('칭찬점수_' + today() + '.csv', DN.Records.toCsv(rows), 'text/csv;charset=utf-8');
    toast('점수 기록 ' + (rows.length - 1) + '건을 엑셀 파일로 받았어요.', 'success');
  }

  // ── 모둠 ──
  function renderGroup(body) {
    const n = groupCount(), bal = balances('group'), wk = weekRange();
    const week = earned('group', wk.from, wk.to);
    const best = Math.max.apply(null, [0].concat(Object.keys(week).map(function (k) { return week[k]; })));
    body.innerHTML = '<div class="card"><div class="quick-head"><h2 class="side-title">모둠 점수</h2>' +
      '<label class="quick-date">모둠 수 <input type="number" id="rwGn" min="2" max="12" value="' + n + '" style="width:64px"></label>' +
      '<span class="quick-help">이유를 고르고(선택) 모둠의 +1·+2·+3을 누르세요. 👑은 이번 주에 가장 많이 받은 모둠이에요.</span></div>' +
      reasonChips('group') +
      '<div class="rw-groups">' + range(n).map(function (g) {
        const names = groupNames(g);
        return '<div class="rw-group' + (best && week[g] === best ? ' best' : '') + '"><div class="rw-gh"><b>' + (best && week[g] === best ? '👑 ' : '') + g + '모둠</b><span class="rw-week">이번 주 +' + (week[g] || 0) + '</span></div>' +
          '<div class="rw-gscore">' + (bal[g] || 0) + '<small>점</small></div>' +
          (names.length ? '<div class="rw-gnames">' + names.map(esc).join(' · ') + '</div>' : '') +
          '<div class="rw-gbtns">' + [1, 2, 3].map(function (a) { return '<button class="btn-secondary" data-g="' + g + '" data-a="' + a + '">+' + a + '</button>'; }).join('') +
          '<button class="btn-ghost" data-gspend="' + g + '">🎁</button></div></div>';
      }).join('') + '</div>' + lastHtml() +
      '<div class="rw-foot"><button class="btn-ghost" id="rwReset">↺ 모둠 점수 모두 0으로</button>' +
      (latestSeating() ? '<span class="set-help">모둠 이름은 마지막으로 저장한 자리·모둠 배치에서 가져왔어요.</span>' : '<span class="set-help">자리·모둠에서 배치를 저장하면 모둠원 이름이 함께 보여요.</span>') + '</div></div>' +
      '<div class="card"><h2 class="side-title">🎁 모둠 보상</h2>' + rewardList(rewards('group')) + '</div>';
    body.querySelector('#rwGn').addEventListener('change', function (e) { setGroupCount(e.target.value); render(rootEl); });
    body.querySelector('.rw-reasons').addEventListener('click', function (e) {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      state.reason = state.reason === b.dataset.r ? '' : b.dataset.r;
      body.querySelectorAll('.rw-reason').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.r === state.reason)); });
    });
    body.querySelector('.rw-groups').addEventListener('click', function (e) {
      const b = e.target.closest('[data-g]'), sp = e.target.closest('[data-gspend]');
      if (b) {
        const g = +b.dataset.g, a = +b.dataset.a;
        saved(give('group', today(), [g], a, state.reason), g + '모둠 ' + (state.reason ? state.reason + ' ' : '') + '+' + a + '점');
      }
      if (sp) chooseReward('group', +sp.dataset.gspend, sp.dataset.gspend + '모둠');
    });
    body.querySelector('#rwReset').addEventListener('click', function () {
      if (!confirmAsk('모든 모둠 점수를 0점으로 새로 시작할까요? (지금까지 기록은 남아요)')) return;
      resetGroups();
      toast('모둠 점수를 새로 시작했어요.', 'success');
      render(rootEl);
    });
    bindLast(body);
  }
  function range(n) { const a = []; for (let i = 1; i <= n; i++) a.push(i); return a; }
  function chooseReward(level, target, who) {
    const b = balances(level)[target] || 0;
    const list = rewards(level);
    const m = openModal(who + ' 보상 주기', '<p class="set-help" style="margin-top:0">지금 ' + b + '점이 있어요.</p><div class="rw-spend">' +
      (list.length ? list.map(function (r) {
        return '<button class="btn-secondary" data-spend="' + esc(r.id) + '"' + (b >= r.cost ? '' : ' disabled') + '>🎁 ' + esc(r.label) + ' <b>' + r.cost + '</b></button>';
      }).join('') : '<p class="side-empty">보상이 없어요.</p>') + '</div>', '<span class="pv-spacer"></span><button class="btn-cancel" data-close>닫기</button>');
    m.addEventListener('click', function (e) {
      const sp = e.target.closest('[data-spend]');
      if (!sp) return;
      const r = list.find(function (x) { return x.id === sp.dataset.spend; });
      spend(level, target, r);
      closeModal();
      toast('🎁 ' + who + ' — ' + r.label + '!', 'success');
      render(rootEl);
    });
  }

  // ── 학급 온도계 ──
  function renderClass(body) {
    const t = classTemp(), goal = classGoal();
    const done = t >= goal.cost;
    const hist = points('class').reverse().slice(0, 12);
    body.innerHTML = '<div class="card rw-class"><div class="rw-thermo">' + thermoSvg(t, goal.cost) +
      '<div class="rw-temp"><b>' + t + '°</b><span>/ ' + goal.cost + '°</span><p>' + (done ? '🎉 목표 달성!' : '🎯 ' + esc(goal.label) + '까지 ' + (goal.cost - t) + '도') + '</p>' +
      (done ? '<button class="btn-primary" id="rwGoal">🎁 “' + esc(goal.label) + '” 하고 다시 시작</button>' : '') + '</div></div>' +
      '<div class="rw-cgive"><h2 class="side-title">반 전체 칭찬</h2>' + reasonChips('class') +
      '<div class="rw-gbtns">' + [1, 3, 5].map(function (a) { return '<button class="btn-secondary big" data-a="' + a + '">+' + a + '°</button>'; }).join('') + '</div>' +
      '<p class="set-help">이유를 고르고(선택) +1°·+3°·+5°를 누르세요. 목표 온도와 학급 보상은 [🎁 보상 목록 편집]의 “학급” 첫 줄이에요.</p>' + lastHtml() +
      '<div class="section-label">최근 기록</div><div class="rw-hist">' + (hist.length ? hist.map(function (p) {
        return '<div class="rw-h"><span>' + md(p.date) + '</span><span class="' + (p.delta < 0 ? 'neg' : 'pos') + '">' + signed(p.delta) + '°</span><span>' + esc(p.label || '칭찬') + '</span></div>';
      }).join('') : '<p class="side-empty">아직 기록이 없어요.</p>') + '</div></div></div>';
    body.querySelector('.rw-reasons').addEventListener('click', function (e) {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      state.reason = state.reason === b.dataset.r ? '' : b.dataset.r;
      body.querySelectorAll('.rw-reason').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.r === state.reason)); });
    });
    body.querySelector('.rw-cgive .rw-gbtns').addEventListener('click', function (e) {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = +b.dataset.a;
      const before = classTemp();
      const list = give('class', today(), [0], a, state.reason);
      if (before < goal.cost && before + a >= goal.cost) setTimeout(function () { toast('🎉 학급 온도 ' + goal.cost + '도 달성! ' + goal.label + '!', 'success'); }, 400);
      saved(list, '학급 ' + (state.reason ? state.reason + ' ' : '') + '+' + a + '°');
    });
    const g = body.querySelector('#rwGoal');
    if (g) g.addEventListener('click', function () {
      if (!confirmAsk('“' + goal.label + '” 보상을 하고 온도계를 0도부터 다시 시작할까요?')) return;
      give('class', today(), [0], -t, '🎉 ' + goal.label, { spend: true });
      toast('🎉 ' + goal.label + '! 온도계를 새로 시작했어요.', 'success');
      render(rootEl);
    });
    bindLast(body);
  }

  // ── 숙제 검사 ──
  function renderHw(body) {
    const list = homeworks();
    if (state.hw && !getHomework(state.hw)) state.hw = null;
    const cur = state.hw ? getHomework(state.hw) : null;
    const names = DN.Records.nameMap();
    const nos = DN.Records.studentNumbers();
    const reward = DN.Store.getMeta('hwReward') !== '0';
    const titles = list.map(function (h) { return h.title; }).filter(function (t, i, a) { return a.indexOf(t) === i; }).slice(0, 6);
    let html = '<div class="card quick"><div class="quick-head"><h2 class="side-title">새 숙제 검사</h2>' +
      '<label class="quick-date">날짜 <input type="date" id="hwDate" value="' + esc(state.date) + '"></label></div>' +
      '<div class="free-row"><span class="preset-gname">숙제</span><input type="text" id="hwTitle" maxlength="40" placeholder="예: 수학 익힘 32쪽, 일기, 받아쓰기 연습" value="' + esc(state.hwTitle) + '">' +
      '<button class="btn-primary" id="hwStart">검사 시작</button></div>' +
      (titles.length ? '<div class="rw-reasons">' + titles.map(function (t) { return '<button class="rw-reason" data-t="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div>' : '') +
      '<label class="check-label"><input type="checkbox" id="hwReward"' + (reward ? ' checked' : '') + '> 낸 학생에게 개인 칭찬 점수 +1</label></div>';
    if (cur) {
      const miss = missing(cur, nos);
      html += '<div class="card"><div class="side-head"><h2 class="side-title">📚 ' + esc(md(cur.date) + ' ' + cur.title) + '</h2>' +
        '<span class="rw-count">낸 학생 ' + (cur.done || []).length + ' / ' + nos.length + '</span></div>' +
        '<p class="set-help">숙제를 낸 학생 번호를 누르세요. 다시 누르면 취소돼요.' + (cur.reward ? ' 누를 때마다 칭찬 점수 +1이 함께 쌓여요.' : '') + '</p>' +
        '<div class="picker hw-picker">' + nos.map(function (n) {
          const d = (cur.done || []).indexOf(n) >= 0;
          return '<button class="no-btn hw-no" data-no="' + n + '" aria-pressed="' + d + '"><b>' + n + '</b>' + (names[n] ? '<small>' + esc(names[n]) + '</small>' : '') + '</button>';
        }).join('') + '</div>' +
        '<div class="hw-miss"><b>안 낸 학생 ' + miss.length + '명</b> ' + (miss.length ? esc(miss.map(function (n) { return n + '번' + (names[n] ? ' ' + names[n] : ''); }).join(', ')) : '— 모두 냈어요! 🎉') +
        (miss.length ? ' <button class="btn-ghost" id="hwCopy">📋 복사</button>' : '') + '</div>' +
        '<div class="rw-foot"><button class="btn-ghost" id="hwClose">검사 닫기</button><button class="btn-ghost" id="hwDel">이 검사 지우기</button></div></div>';
    }
    const mc = missingCounts(R_month().from, R_month().to);
    const often = Object.keys(mc).map(Number).filter(function (n) { return mc[n] >= 2; }).sort(function (a, b) { return mc[b] - mc[a] || a - b; });
    html += '<div class="card"><h2 class="side-title">지난 검사</h2>' + (list.length ? '<div class="hw-list">' + list.slice(0, 20).map(function (h) {
      const miss = missing(h, nos);
      return '<button class="hw-item" data-hw="' + esc(h.id) + '" aria-pressed="' + (h.id === state.hw) + '"><span>' + md(h.date) + '</span><b>' + esc(h.title) + '</b>' +
        '<span class="' + (miss.length ? 'neg' : 'pos') + '">' + (miss.length ? '안 냄 ' + miss.length : '모두 냄') + '</span></button>';
    }).join('') + '</div>' : '<p class="side-empty">아직 숙제 검사 기록이 없어요.</p>') +
      (often.length ? '<p class="hw-often">이번 달 2번 넘게 안 낸 학생: ' + esc(often.map(function (n) { return n + '번(' + mc[n] + ')'; }).join(', ')) + '</p>' : '') + '</div>';
    body.innerHTML = html;
    body.querySelector('#hwDate').addEventListener('change', function (e) { state.date = e.target.value || today(); });
    const title = body.querySelector('#hwTitle');
    title.addEventListener('input', function () { state.hwTitle = title.value; });
    const start = function () {
      const h = startHomework(state.date, title.value, body.querySelector('#hwReward').checked);
      if (!h) { toast('숙제 이름을 써 주세요.', 'info'); title.focus(); return; }
      state.hw = h.id; state.hwTitle = '';
      render(rootEl);
    };
    body.querySelector('#hwStart').addEventListener('click', start);
    title.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) start(); });
    body.querySelector('#hwReward').addEventListener('change', function (e) { DN.Store.setMeta('hwReward', e.target.checked ? '1' : '0'); });
    body.querySelectorAll('[data-t]').forEach(function (b) { b.addEventListener('click', function () { title.value = state.hwTitle = b.dataset.t; title.focus(); }); });
    const pick = body.querySelector('.hw-picker');
    if (pick) pick.addEventListener('click', function (e) {
      const b = e.target.closest('[data-no]');
      if (!b) return;
      toggleHomework(cur.id, +b.dataset.no);
      render(rootEl);
    });
    const cp = body.querySelector('#hwCopy');
    if (cp) cp.addEventListener('click', function () {
      const miss = missing(cur, nos);
      copyText(md(cur.date) + ' ' + cur.title + ' 안 낸 학생: ' + miss.map(function (n) { return n + '번' + (names[n] ? ' ' + names[n] : ''); }).join(', ')).then(function (ok) {
        toast(ok ? '복사했어요.' : '복사하지 못했어요.', ok ? 'success' : 'error');
      });
    });
    const cl = body.querySelector('#hwClose');
    if (cl) cl.addEventListener('click', function () { state.hw = null; render(rootEl); });
    const dl = body.querySelector('#hwDel');
    if (dl) dl.addEventListener('click', function () {
      if (!confirmAsk('이 숙제 검사를 지울까요? 함께 준 칭찬 점수도 지워져요.')) return;
      removeHomework(cur.id); state.hw = null; render(rootEl);
    });
    body.querySelectorAll('[data-hw]').forEach(function (b) { b.addEventListener('click', function () { state.hw = b.dataset.hw; render(rootEl); }); });
  }
  function R_month() { const t = today(); return DN.Records.monthRange(t.slice(0, 7)); }

  // ── 칠판에 크게 보기: 학급 온도계 + 모둠 점수 ──
  function openBig() {
    const t = classTemp(), goal = classGoal(), n = groupCount(), bal = balances('group');
    const max = Math.max.apply(null, [1].concat(range(n).map(function (g) { return bal[g] || 0; })));
    const m = openModal('우리 반 보상판', '<div class="rw-bigboard"><div class="rw-bigthermo">' + thermoSvg(t, goal.cost, true) +
      '<div class="rw-bigtemp"><b>' + t + '°</b><span>' + (t >= goal.cost ? '🎉 ' + esc(goal.label) + '!' : '🎯 ' + esc(goal.label) + '까지 ' + (goal.cost - t) + '도') + '</span></div></div>' +
      '<div class="rw-bigbars">' + range(n).map(function (g) {
        const v = bal[g] || 0;
        return '<div class="rw-bar"><span>' + (v === max && v > 0 ? '👑 ' : '') + g + '모둠</span><div class="rw-bar-t"><i style="width:' + Math.round(100 * Math.max(0, v) / max) + '%"></i></div><b>' + v + '</b></div>';
      }).join('') + '</div></div>', '<span class="pv-spacer"></span><button class="btn-primary" data-close>닫기</button>');
    m.classList.add('rw-full');
  }

  // ── 보상 목록 편집 ──
  function openRewardEditor() {
    const draw = function () {
      return '<p class="set-help" style="margin-top:0">점수를 모으면 받을 수 있는 보상이에요. “학급” 첫 줄의 점수가 온도계 목표 온도가 돼요.</p>' +
        LEVELS.map(function (lv) {
          return '<div class="section-label">' + LEVEL_NAME[lv] + '</div>' + rewards(lv).map(function (r) {
            return '<div class="ce-row" data-id="' + esc(r.id) + '"><input class="rw-lbl ce-subj" maxlength="30" value="' + esc(r.label) + '" aria-label="보상 이름">' +
              '<input class="rw-cost ce-count" type="number" min="1" max="999" value="' + r.cost + '" aria-label="점수"><span class="ce-unit">' + (lv === 'class' ? '도' : '점') + '</span>' +
              '<button class="ic del" data-rm="' + esc(r.id) + '" aria-label="지우기">✕</button></div>';
          }).join('') + '<div class="ce-row"><input class="ce-subj" data-new="' + lv + '" maxlength="30" placeholder="새 ' + LEVEL_NAME[lv] + ' 보상">' +
            '<input class="ce-count" data-newc="' + lv + '" type="number" min="1" max="999" value="' + (lv === 'class' ? 100 : 10) + '"><span class="ce-unit">' + (lv === 'class' ? '도' : '점') + '</span>' +
            '<button class="btn-secondary" data-add="' + lv + '">추가</button></div>';
        }).join('');
    };
    const m = openModal('🎁 보상 목록', '<div id="rwEd">' + draw() + '</div>', '<span class="pv-spacer"></span><button class="btn-primary" data-close>완료</button>');
    const box = m.querySelector('#rwEd');
    box.addEventListener('change', function (e) {
      const row = e.target.closest('.ce-row[data-id]');
      if (!row) return;
      if (e.target.classList.contains('rw-lbl') && e.target.value.trim()) updateReward(row.dataset.id, { label: e.target.value });
      if (e.target.classList.contains('rw-cost')) updateReward(row.dataset.id, { cost: e.target.value });
    });
    box.addEventListener('click', function (e) {
      const rm = e.target.closest('[data-rm]'), add = e.target.closest('[data-add]');
      if (rm && confirmAsk('이 보상을 지울까요?')) { removeReward(rm.dataset.rm); box.innerHTML = draw(); }
      if (add) {
        const lv = add.dataset.add;
        const r = addReward(lv, box.querySelector('[data-new="' + lv + '"]').value, box.querySelector('[data-newc="' + lv + '"]').value);
        if (!r) { toast('보상 이름을 써 주세요.', 'info'); return; }
        box.innerHTML = draw();
      }
    });
    m.addEventListener('click', function (e) { if (e.target.closest('[data-close]') && rootEl && rootEl.isConnected) render(rootEl); });
  }

  return {
    PTS, RWD, HW, LEVELS, REASONS, DEFAULT_REWARDS,
    rewards, addReward, updateReward, removeReward, classGoal,
    points, give, spend, balances, earned, classTemp, removePoints, resetGroups,
    groupCount, setGroupCount, groupNames, weekRange,
    homeworks, getHomework, startHomework, toggleHomework, missing, removeHomework, missingCounts,
    thermoSvg, render,
  };
})();
