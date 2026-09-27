// ════════════════════════════════════════════════════
//  담임노트+ · 학교 일정 화면 (DN.ScheduleView) — 명세 §7.2
//  달력·목록 · 우리 학년/내 담당 필터 · 이번 주 할 일 · 날짜별 목록 · 상세(수정·완료·첨부·메모) · 직접 추가
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.ScheduleView = (function () {
  const { esc, toast, confirmAsk, openModal, closeModal } = DN.utils;
  const E = DN.Events;
  const WEEK_HEAD = ['일', '월', '화', '수', '목', '금', '토'];
  const KIND_T = { event: '행사', holiday: '휴일', deadline: '제출 마감' };
  const MAX_CHIPS = 3;

  let rootEl = null;
  let state = loadState();

  function today() { return E.toStr(new Date()); }
  function loadState() {
    let saved = {};
    try { saved = JSON.parse(DN.Store.getMeta('scheduleView') || '{}') || {}; } catch (e) {}
    return {
      mode: saved.mode === 'list' ? 'list' : 'calendar',
      myGrade: !!saved.myGrade,
      mineOnly: !!saved.mineOnly,
      month: today().slice(0, 7),
      selected: today(),
    };
  }
  function saveState() {
    DN.Store.setMeta('scheduleView', JSON.stringify({ mode: state.mode, myGrade: state.myGrade, mineOnly: state.mineOnly }));
  }
  function setMonth(ym) {
    state.month = ym;
    state.selected = ym === today().slice(0, 7) ? today() : ym + '-01';
  }
  function md(s) { return (+s.slice(5, 7)) + '/' + (+s.slice(8)); }
  function mdw(s) { return md(s) + ' (' + E.weekdayOf(s) + ')'; }
  function events() { return E.filtered(state, DN.Settings.get().grade); }

  // 일정 한 줄에 붙는 작은 표시들
  function badges(e) {
    return (e.kind === 'deadline' ? '<span class="ev-dl">마감</span>' : '') +
      ((e.attachmentIds || []).length ? '<span class="ev-clip" title="첨부 ' + e.attachmentIds.length + '개">📎</span>' : '');
  }
  function evClass(e) {
    return ['ev', e.kind === 'holiday' ? 'is-holiday' : '', e.kind === 'deadline' ? 'is-deadline' : '',
      e.isMine ? 'is-mine' : '', e.done ? 'is-done' : ''].join(' ');
  }

  // ════════ 화면 ════════
  function render(container) {
    rootEl = container;
    const y = +state.month.slice(0, 4), m = +state.month.slice(5, 7);
    container.innerHTML = '\
      <div class="page-head">\
        <h1>📅 학교 일정</h1>\
        <span class="pv-spacer"></span>\
        <label class="btn-secondary bk-file">월중행사 가져오기<input type="file" id="scImport" accept=".hwp,.hwpx" hidden></label>\
        <button class="btn-primary" id="scAdd">+ 일정 직접 추가</button>\
      </div>\
      <div class="sc-layout">\
        <div class="card sc-main">\
          <div class="sc-bar">\
            <button class="btn-ghost sc-nav" id="scPrev" aria-label="이전 달">◀</button>\
            <strong class="sc-month">' + y + '년 ' + m + '월</strong>\
            <button class="btn-ghost sc-nav" id="scNext" aria-label="다음 달">▶</button>\
            <button class="btn-ghost sc-today" id="scToday">오늘</button>\
            <span class="pv-spacer"></span>\
            <button class="toggle" id="fGrade" aria-pressed="' + state.myGrade + '">우리 학년만</button>\
            <button class="toggle" id="fMine" aria-pressed="' + state.mineOnly + '">내 담당만</button>\
            <span class="seg">\
              <button id="vCal" aria-pressed="' + (state.mode === 'calendar') + '">달력</button><button id="vList" aria-pressed="' + (state.mode === 'list') + '">목록</button>\
            </span>\
          </div>\
          <div id="scBody"></div>\
        </div>\
        <div class="sc-side">\
          <div class="card"><h2 class="side-title">✅ 이번 주 할 일</h2><div id="scTodo"></div></div>\
          <div class="card"><div id="scDay"></div></div>\
        </div>\
      </div>';

    container.querySelector('#scBody').innerHTML = state.mode === 'calendar' ? calendarHtml(y, m) : listHtml();
    renderTodo();
    renderDay();
    bind(container);
  }

  function bind(c) {
    c.querySelector('#scImport').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) DN.Schedule.importFile(e.target.files[0]);
      e.target.value = '';
    });
    c.querySelector('#scAdd').addEventListener('click', function () { openAdd(state.selected); });
    const move = function (delta) {
      const d = new Date(+state.month.slice(0, 4), +state.month.slice(5, 7) - 1 + delta, 1);
      setMonth(E.toStr(d).slice(0, 7));
      render(c);
    };
    c.querySelector('#scPrev').addEventListener('click', function () { move(-1); });
    c.querySelector('#scNext').addEventListener('click', function () { move(1); });
    c.querySelector('#scToday').addEventListener('click', function () { setMonth(today().slice(0, 7)); render(c); });
    c.querySelector('#fGrade').addEventListener('click', function () { state.myGrade = !state.myGrade; saveState(); render(c); });
    c.querySelector('#fMine').addEventListener('click', function () { state.mineOnly = !state.mineOnly; saveState(); render(c); });
    c.querySelector('#vCal').addEventListener('click', function () { state.mode = 'calendar'; saveState(); render(c); });
    c.querySelector('#vList').addEventListener('click', function () { state.mode = 'list'; saveState(); render(c); });

    // 달력·목록·패널 공통: data-id → 상세, data-date → 그 날 선택, data-done → 완료 토글
    // (#view는 다른 메뉴도 쓰므로, 렌더할 때마다 새로 만들어지는 .sc-layout에 붙인다)
    c.querySelector('.sc-layout').addEventListener('click', onClick);
  }

  function onClick(e) {
    const done = e.target.closest('[data-done]');
    if (done) {
      const ev = E.get(done.dataset.done);
      if (ev) {
        E.update(ev.id, { done: !ev.done });
        toast(ev.done ? '완료 표시를 풀었어요.' : '“' + ev.title + '” 완료!', 'success');
        render(rootEl);
      }
      return;
    }
    const idEl = e.target.closest('[data-id]');
    if (idEl) { openDetail(idEl.dataset.id); return; }
    const dateEl = e.target.closest('[data-date]');
    if (dateEl) {
      state.selected = dateEl.dataset.date;
      if (state.selected.slice(0, 7) !== state.month) state.month = state.selected.slice(0, 7);
      render(rootEl);
    }
  }

  // ── 달력 ──
  function calendarHtml(y, m) {
    const items = E.calendarItems(events());
    const tdy = today();
    const monthKey = state.month;
    let html = '<div class="cal"><div class="cal-head">' +
      WEEK_HEAD.map(function (w, i) { return '<div class="' + (i === 0 ? 'sun' : i === 6 ? 'sat' : '') + '">' + w + '</div>'; }).join('') + '</div>';
    E.monthWeeks(y, m).forEach(function (ws) {
      const wb = E.weekBars(items, ws);
      const singleRow = wb.lanes + 2;
      let cells = '', nums = '', singles = '';
      for (let i = 0; i < 7; i++) {
        const d = E.addDays(ws, i);
        const dayItems = items.filter(function (it) { return it.kind === 'single' && it.start === d; });
        const holidays = dayItems.filter(function (it) { return it.events[0].kind === 'holiday'; });
        // 칸이 좁으니 내 담당·마감(할 일)을 먼저, 완료한 것은 뒤로
        const rank = function (ev) { return E.isTask(ev) ? (ev.done ? 2 : 0) : 1; };
        const others = dayItems.filter(function (it) { return it.events[0].kind !== 'holiday'; })
          .sort(function (a, b) { return rank(a.events[0]) - rank(b.events[0]); });
        const isHoliday = holidays.length || items.some(function (it) {
          return it.kind === 'period' && it.events[0].kind === 'holiday' && it.start <= d && it.end >= d;
        });
        const cls = ['cal-cell', d.slice(0, 7) !== monthKey ? 'other' : '', d === tdy ? 'today' : '',
          d === state.selected ? 'selected' : '', i === 0 ? 'sun' : i === 6 ? 'sat' : '', isHoliday ? 'holiday' : ''].join(' ');
        cells += '<button class="' + cls + '" style="grid-column:' + (i + 1) + ';grid-row:1/-1" data-date="' + d + '" aria-label="' + esc(mdw(d)) + '"></button>';
        nums += '<div class="cal-num' + (isHoliday || i === 0 ? ' red' : i === 6 ? ' blue' : '') + (d.slice(0, 7) !== monthKey ? ' other' : '') +
          '" style="grid-column:' + (i + 1) + ';grid-row:1"><span class="n' + (d === tdy ? ' today' : '') + '">' + (+d.slice(8)) + '</span>' +
          holidays.map(function (h) { return '<span class="cal-hname">' + esc(h.events[0].title) + '</span>'; }).join('') + '</div>';
        if (others.length) {
          const shown = others.slice(0, MAX_CHIPS).map(function (it) {
            const ev = it.events[0];
            return '<button class="cal-chip ' + evClass(ev) + '" data-id="' + esc(ev.id) + '" title="' + esc(ev.title) + '">' +
              (ev.isMine ? '★ ' : '') + esc(ev.title) + badges(ev) + '</button>';
          }).join('');
          const more = others.length > MAX_CHIPS ? '<button class="cal-more" data-date="' + d + '">+' + (others.length - MAX_CHIPS) + '개</button>' : '';
          singles += '<div class="cal-singles" style="grid-column:' + (i + 1) + ';grid-row:' + singleRow + '">' + shown + more + '</div>';
        }
      }
      const bars = wb.bars.map(function (b) {
        const ev = b.item.events[0];
        const any = function (f) { return b.item.events.some(f); };
        const cls = ['cal-bar', 'bar-' + b.item.kind, ev.kind === 'holiday' ? 'is-holiday' : '', ev.kind === 'deadline' ? 'is-deadline' : '',
          any(function (x) { return x.isMine; }) ? 'is-mine' : '', b.item.events.every(function (x) { return x.done; }) && E.isTask(ev) ? 'is-done' : '',
          b.contStart ? 'cont-start' : '', b.contEnd ? 'cont-end' : ''].join(' ');
        // 연속 반복 막대는 이 주에서 처음 보이는 날의 일정을 연다
        const first = b.item.events.find(function (x) { return x.date >= E.addDays(ws, b.col); }) || ev;
        return '<button class="' + cls + '" style="grid-column:' + (b.col + 1) + '/span ' + b.span + ';grid-row:' + (b.lane + 2) + '" data-id="' + esc(first.id) +
          '" title="' + esc(ev.title + ' (' + md(b.item.start) + '~' + md(b.item.end) + ')') + '">' +
          (any(function (x) { return x.isMine; }) ? '★ ' : '') + esc(ev.title) + (b.item.kind === 'series' ? ' <span class="bar-n">' + b.item.events.length + '일</span>' : '') +
          badges(ev) + '</button>';
      }).join('');
      html += '<div class="cal-week" style="grid-template-rows:auto' + (wb.lanes ? ' repeat(' + wb.lanes + ', 22px)' : '') + ' 1fr">' +
        cells + nums + bars + singles + '</div>';
    });
    return html + '</div><p class="cal-legend"><span class="lg lg-mine"></span>내 담당 <span class="lg lg-dl"></span>제출 마감 <span class="lg lg-period"></span>기간·연속 행사 <span class="lg lg-hol"></span>휴일</p>';
  }

  // ── 목록 ──
  function listHtml() {
    const month = state.month;
    const list = events().filter(function (e) {
      return e.date.slice(0, 7) === month || (e.date.slice(0, 7) < month && E.endOf(e).slice(0, 7) >= month);
    });
    if (!list.length) return '<p class="empty">이 달에 보여 줄 일정이 없어요.</p>';
    const byDate = {};
    list.forEach(function (e) { (byDate[e.date] = byDate[e.date] || []).push(e); });
    return '<div class="sc-list">' + Object.keys(byDate).sort().map(function (d) {
      const hol = byDate[d].some(function (e) { return e.kind === 'holiday'; });
      return '<div class="sc-day"><button class="sc-date' + (hol ? ' holiday' : '') + '" data-date="' + d + '">' + esc(mdw(d)) + '</button><ul>' +
        byDate[d].map(function (e) { return '<li>' + rowHtml(e) + '</li>'; }).join('') + '</ul></div>';
    }).join('') + '</div>';
  }

  // 목록·패널 공통 한 줄: [완료 체크] 제목 + 부가 정보
  function rowHtml(e, opts) {
    opts = opts || {};
    const grades = e.grades || [];
    const meta = [E.endOf(e) > e.date ? '~' + md(E.endOf(e)) : '', e.time, e.place,
      grades.length ? grades.join('·') + '학년' : ''].filter(Boolean).join(' · ');
    const check = E.isTask(e)
      ? '<button class="chk' + (e.done ? ' on' : '') + '" data-done="' + esc(e.id) + '" aria-label="' + (e.done ? '완료 취소' : '완료') + '">' + (e.done ? '✓' : '') + '</button>'
      : '<span class="chk-sp"></span>';
    return '<div class="row ' + evClass(e) + '">' + check +
      '<button class="row-title" data-id="' + esc(e.id) + '">' + (e.isMine ? '★ ' : '') + esc(e.title) + badges(e) +
      (e.needsReview ? '<span class="sc-review">검토</span>' : '') + '</button>' +
      (opts.due ? '<span class="due' + (opts.overdue ? ' over' : '') + '">' + esc(opts.due) + '</span>' : '') +
      (meta ? '<div class="row-meta">' + esc(meta) + '</div>' : '') + '</div>';
  }

  // ── 이번 주 할 일 ──
  function renderTodo() {
    const list = E.todos(today());
    const el = rootEl.querySelector('#scTodo');
    if (!list.length) {
      el.innerHTML = '<p class="side-empty">이번 주 할 일이 없어요. 🎉<br><small>내 담당 행사와 제출 마감이 여기에 모여요.</small></p>';
      return;
    }
    el.innerHTML = list.map(function (t) {
      const label = t.overdue ? '지남 ' + md(t.due) : t.due === today() ? '오늘' : mdw(t.due);
      return rowHtml(t.event, { due: label, overdue: t.overdue });
    }).join('');
  }

  // ── 선택한 날 ──
  function renderDay() {
    const d = state.selected;
    const list = E.onDate(events(), d);
    rootEl.querySelector('#scDay').innerHTML =
      '<div class="side-head"><h2 class="side-title">🗓 ' + esc(mdw(d)) + '</h2>' +
      '<button class="btn-ghost side-add" id="scDayAdd">+ 이 날에 추가</button></div>' +
      (list.length ? list.map(function (e) { return rowHtml(e); }).join('') : '<p class="side-empty">일정이 없어요.</p>');
    rootEl.querySelector('#scDayAdd').addEventListener('click', function () { openAdd(d); });
  }

  // ════════ 창(모달) ════════
  function gradesText(g) { return (g || []).join(','); }
  function parseGradesInput(v) {
    return String(v || '').split(/[,\s]+/).map(Number)
      .filter(function (g, i, a) { return g >= 1 && g <= 6 && a.indexOf(g) === i; }).sort();
  }

  // 20MB 넘는 파일이 있으면 확인. 첨부할 파일 목록을 돌려준다(취소 시 빈 목록)
  function confirmBigFiles(files) {
    const big = files.filter(function (f) { return DN.Files.sizeWarning(f); });
    if (!big.length) return files;
    const ok = confirmAsk(big.map(DN.Files.sizeWarning).join('\n') + '\n\n그래도 첨부할까요?');
    return ok ? files : files.filter(function (f) { return big.indexOf(f) < 0; });
  }

  // 끌어다 놓기 + 눌러서 선택 (onFiles(File[]))
  function bindDrop(zone, onFiles) {
    const input = zone.querySelector('input[type=file]');
    input.addEventListener('change', function () {
      if (input.files && input.files.length) onFiles(Array.prototype.slice.call(input.files));
      input.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (t) {
      zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      zone.addEventListener(t, function () { zone.classList.remove('over'); });
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) onFiles(Array.prototype.slice.call(files));
    });
  }

  const DROP_HTML = '<label class="drop">📎 파일을 여기로 끌어다 놓거나 <u>눌러서 선택</u> (여러 개 가능)<input type="file" multiple hidden></label>';

  // ── 상세 (수정 · 완료 · 첨부 · 메모) ──
  function openDetail(id) {
    const e = E.get(id);
    if (!e) { toast('일정을 찾을 수 없어요.', 'error'); return; }
    const kindOpts = Object.keys(KIND_T).map(function (k) {
      return '<option value="' + k + '"' + (e.kind === k ? ' selected' : '') + '>' + KIND_T[k] + '</option>';
    }).join('');
    const src = e.source === 'together' ? '투게더 월중행사(' + esc(e.importKey) + ')에서 가져옴' : '직접 입력';
    const body = '\
      <p class="md-src">' + src + (e.seriesKey ? ' · 연속 행사' : '') + '</p>' +
      (e.needsReview ? '<p class="pv-warn">⚠ 가져올 때 확인이 필요하다고 표시된 일정이에요. 내용을 확인해 주세요.</p>' : '') + '\
      <div class="fgrid">\
        <label for="dTitle">제목</label><input type="text" id="dTitle" value="' + esc(e.title) + '">\
        <label for="dDate">날짜</label><div class="frow-in"><input type="date" id="dDate" value="' + esc(e.date) + '"> ~ <input type="date" id="dEnd" value="' + esc(e.endDate || '') + '"></div>\
        <label for="dKind">종류</label><select id="dKind">' + kindOpts + '</select>\
        <label for="dTime">시간</label><input type="text" id="dTime" value="' + esc(e.time || '') + '">\
        <label for="dPlace">장소</label><input type="text" id="dPlace" value="' + esc(e.place || '') + '">\
        <label for="dGrades">관련 학년</label><input type="text" id="dGrades" placeholder="예: 3,4 (비우면 전체)" value="' + esc(gradesText(e.grades)) + '">\
        <label for="dOwner">담당</label><input type="text" id="dOwner" value="' + esc(e.owner || '') + '">\
      </div>\
      <div class="md-checks">\
        <label class="check-label"><input type="checkbox" id="dMine"' + (e.isMine ? ' checked' : '') + '> ★ 내 담당(할 일)</label>\
        <label class="check-label"><input type="checkbox" id="dDone"' + (e.done ? ' checked' : '') + '> ✓ 완료</label>\
      </div>\
      <label class="md-label" for="dNote">메모</label>\
      <textarea id="dNote" rows="4" placeholder="메신저 내용, 준비물 등">' + esc(e.note || '') + '</textarea>' +
      (e.rawTitle && e.rawTitle !== e.title ? '<p class="md-raw">원문: ' + esc(e.rawTitle) + '</p>' : '') + '\
      <div class="md-label">첨부 파일</div>\
      <div id="dFiles"></div>' + DROP_HTML;
    const foot = '<button class="btn-cancel danger" id="dDel">삭제</button><span class="pv-spacer"></span>' +
      '<button class="btn-cancel" data-close>닫기</button><button class="btn-primary" id="dSave">저장</button>';
    const m = openModal('일정 상세', body, foot);

    const renderFiles = function () {
      const cur = E.get(id);
      const ids = (cur && cur.attachmentIds) || [];
      const box = m.querySelector('#dFiles');
      if (!ids.length) { box.innerHTML = '<p class="side-empty">첨부한 파일이 없어요.</p>'; return; }
      DN.Files.list().then(function (all) {
        const map = {};
        all.forEach(function (f) { map[f.id] = f; });
        box.innerHTML = ids.map(function (fid) {
          const f = map[fid];
          if (!f) return '<div class="file-row missing">사라진 파일 <button class="ic" data-rmfile="' + esc(fid) + '">✕</button></div>';
          return '<div class="file-row"><span class="file-name">' + (String(f.type).indexOf('image/') === 0 ? '🖼 ' : '📄 ') + esc(f.name) +
            ' <small>' + esc(DN.Files.formatBytes(f.size)) + '</small></span>' +
            '<button class="btn-ghost file-open" data-open="' + esc(fid) + '">' + (DN.Files.canPreview(f.type) ? '열기' : '내려받기') + '</button>' +
            '<button class="ic del" data-rmfile="' + esc(fid) + '" aria-label="첨부 삭제">✕</button></div>';
        }).join('');
      }, function (err) { box.innerHTML = '<p class="side-empty">' + esc(err.message) + '</p>'; });
    };
    renderFiles();

    m.querySelector('#dFiles').addEventListener('click', function (ev) {
      const open = ev.target.closest('[data-open]');
      if (open) { DN.Files.open(open.dataset.open).catch(function (err) { toast(err.message, 'error'); }); return; }
      const rm = ev.target.closest('[data-rmfile]');
      if (rm && confirmAsk('이 첨부 파일을 지울까요? 되돌릴 수 없어요.')) {
        E.removeAttachment(id, rm.dataset.rmfile).then(function () { renderFiles(); render(rootEl); });
      }
    });
    bindDrop(m.querySelector('.drop'), function (files) {
      files = confirmBigFiles(files);
      if (!files.length) return;
      E.addAttachments(id, files).then(function (r) {
        toast('파일 ' + r.added + '개를 첨부했어요' + (r.failed ? ' (' + r.failed + '개 실패 — 저장 공간을 확인해 주세요)' : '') + '.', r.failed ? 'error' : 'success');
        renderFiles();
        render(rootEl);
      });
    });

    m.querySelector('#dSave').addEventListener('click', function () {
      const q = function (s) { return m.querySelector(s); };
      const patch = {
        title: q('#dTitle').value.trim(),
        date: q('#dDate').value,
        endDate: q('#dEnd').value,
        kind: q('#dKind').value,
        time: q('#dTime').value.trim(),
        place: q('#dPlace').value.trim(),
        grades: parseGradesInput(q('#dGrades').value),
        owner: q('#dOwner').value.trim(),
        isMine: q('#dMine').checked,
        done: q('#dDone').checked,
        note: q('#dNote').value,
      };
      const err = validate(patch);
      if (err) { toast(err, 'error'); return; }
      if (patch.endDate === patch.date) patch.endDate = '';
      E.update(id, patch);
      closeModal();
      toast('일정을 저장했어요.', 'success');
      state.selected = patch.date;
      render(rootEl);
    });
    m.querySelector('#dDel').addEventListener('click', function () {
      const n = (E.get(id).attachmentIds || []).length;
      if (!confirmAsk('“' + e.title + '” 일정을 삭제할까요?' + (n ? '\n첨부 파일 ' + n + '개도 함께 지워져요.' : ''))) return;
      E.remove(id).then(function () {
        closeModal();
        toast('일정을 삭제했어요.', 'success');
        render(rootEl);
      });
    });
  }

  function validate(p) {
    if (!p.title) return '제목을 입력해 주세요.';
    if (!E.isDate(p.date)) return '날짜를 입력해 주세요.';
    if (p.endDate && !E.isDate(p.endDate)) return '종료일 형식이 올바르지 않아요.';
    if (p.endDate && p.endDate < p.date) return '종료일이 시작일보다 빨라요.';
    return '';
  }

  // ── 직접 추가 (메신저 내용용) ──
  function openAdd(date) {
    let pending = [];
    const body = '\
      <div class="fgrid">\
        <label for="aTitle">제목 *</label><input type="text" id="aTitle" placeholder="예: 학부모 상담 주간 계획서 제출">\
        <label for="aDate">날짜 *</label><div class="frow-in"><input type="date" id="aDate" value="' + esc(date || '') + '"> ~ <input type="date" id="aEnd" title="기간 일정일 때만"></div>\
        <label>종류</label><div class="seg" id="aKind"><button type="button" data-kind="event" aria-pressed="true">행사</button><button type="button" data-kind="deadline" aria-pressed="false">제출 마감</button></div>\
        <label for="aGrades">관련 학년</label><input type="text" id="aGrades" placeholder="예: 4 (비우면 전체)">\
      </div>\
      <div class="md-checks"><label class="check-label"><input type="checkbox" id="aMine"> ★ 내 담당(할 일)로 표시</label></div>\
      <label class="md-label" for="aNote">메모</label>\
      <textarea id="aNote" rows="5" placeholder="메신저 쪽지 내용을 붙여 넣으면 날짜 표현(10월 15일, 10/15, 15일(수)까지 등)을 찾아 날짜 칸에 제안해 드려요."></textarea>\
      <div id="aSuggest" class="suggest"></div>\
      <div class="md-label">첨부 파일</div>\
      <div id="aFiles"></div>' + DROP_HTML;
    const foot = '<span class="pv-spacer"></span><button class="btn-cancel" data-close>취소</button><button class="btn-primary" id="aSave">추가</button>';
    const m = openModal('일정 직접 추가', body, foot);
    const q = function (s) { return m.querySelector(s); };
    let kind = 'event';
    const setKind = function (k) {
      kind = k;
      m.querySelectorAll('#aKind button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.kind === k)); });
      if (k === 'deadline') q('#aMine').checked = true;
    };
    m.querySelector('#aKind').addEventListener('click', function (e) {
      const b = e.target.closest('[data-kind]');
      if (b) setKind(b.dataset.kind);
    });

    // 메모에서 날짜 제안 — 자동으로 채우지 않고 교사가 눌러야 반영
    const suggest = function () {
      const list = E.suggestDates(q('#aNote').value, today());
      q('#aSuggest').innerHTML = list.length
        ? '<span class="suggest-label">찾은 날짜:</span>' + list.map(function (s) {
          return '<button type="button" class="chip-btn' + (s.deadline ? ' dl' : '') + '" data-sdate="' + s.date + '" data-sdl="' + (s.deadline ? 1 : 0) + '">' +
            (s.deadline ? '⏰ ' : '📅 ') + esc(mdw(s.date)) + (s.deadline ? ' 마감으로' : ' 날짜로') + '</button>';
        }).join('')
        : '';
    };
    q('#aNote').addEventListener('input', suggest);
    q('#aSuggest').addEventListener('click', function (e) {
      const b = e.target.closest('[data-sdate]');
      if (!b) return;
      q('#aDate').value = b.dataset.sdate;
      if (b.dataset.sdl === '1') setKind('deadline');
      toast(mdw(b.dataset.sdate) + '을(를) 날짜 칸에 넣었어요.', 'info');
    });

    const renderPending = function () {
      q('#aFiles').innerHTML = pending.map(function (f, i) {
        return '<div class="file-row"><span class="file-name">📄 ' + esc(f.name) + ' <small>' + esc(DN.Files.formatBytes(f.size)) + '</small></span>' +
          '<button type="button" class="ic del" data-rmpending="' + i + '" aria-label="빼기">✕</button></div>';
      }).join('');
    };
    q('#aFiles').addEventListener('click', function (e) {
      const b = e.target.closest('[data-rmpending]');
      if (b) { pending.splice(+b.dataset.rmpending, 1); renderPending(); }
    });
    bindDrop(m.querySelector('.drop'), function (files) {
      pending = pending.concat(confirmBigFiles(files));
      renderPending();
    });

    q('#aSave').addEventListener('click', function () {
      const fields = {
        title: q('#aTitle').value.trim(),
        date: q('#aDate').value,
        endDate: q('#aEnd').value,
        kind: kind,
        grades: parseGradesInput(q('#aGrades').value),
        isMine: q('#aMine').checked,
        note: q('#aNote').value,
      };
      const err = validate(fields);
      if (err) { toast(err, 'error'); return; }
      if (fields.endDate === fields.date) fields.endDate = '';
      const rec = E.create(fields);
      const files = pending;
      closeModal();
      state.selected = rec.date;
      state.month = rec.date.slice(0, 7);
      const done = function (msg, type) { toast(msg, type); render(rootEl); };
      if (!files.length) { done('일정을 추가했어요.', 'success'); return; }
      E.addAttachments(rec.id, files).then(function (r) {
        done('일정을 추가했어요. (첨부 ' + r.added + '개' + (r.failed ? ', ' + r.failed + '개 실패' : '') + ')', r.failed ? 'error' : 'success');
      });
    });
  }

  return { render, setMonth, openDetail, openAdd, closeModal };
})();
