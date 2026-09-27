// ════════════════════════════════════════════════════
//  담임노트+ · 주간학습안내 → 시간표 (DN.Weekly)
//  한글 주간학습안내 표(요일 × 교시)를 읽어 한 주 시간표로 저장한다.
//  미리보기에서 교사가 확인·수정한 뒤 등록(명세 §2-4 원칙). 같은 주를 다시 올리면 교체.
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Weekly = (function () {
  const { esc, toast, confirmAsk } = DN.utils;
  const COL = 'timetables';
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  // 과목별 파스텔 색 (css의 .subj-*). 목록에 없는 과목은 이름으로 골고루 나눈다
  const SUBJECT_COLORS = {
    '국어': 'peach', '수학': 'sky', '사회': 'lemon', '과학': 'mint', '영어': 'lilac', '체육': 'pink',
    '음악': 'lilac', '미술': 'pink', '도덕': 'mint', '실과': 'lemon', '통합': 'peach', '바른생활': 'mint',
    '슬기로운생활': 'sky', '즐거운생활': 'pink', '안전한생활': 'lemon',
  };
  const PALETTE = ['peach', 'sky', 'mint', 'lemon', 'lilac', 'pink'];

  let preview = null;   // { fileName, week }

  function nospace(s) { return String(s || '').replace(/\s+/g, ''); }
  function oneLine(s) { return String(s || '').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim(); }
  function pad(n) { return String(n).padStart(2, '0'); }
  // 표의 자리 채움 표시(***, -, ㆍ 등)는 빈칸으로
  function clean(s) { const t = oneLine(s); return /^[-*·ㆍ_~\s]*$/.test(t) ? '' : t; }

  function subjectColor(subject) {
    const s = nospace(subject);
    if (!s) return '';
    for (const k in SUBJECT_COLORS) if (s.indexOf(k) === 0) return SUBJECT_COLORS[k];
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  // ── 1) 합친 칸 풀기: 모든 칸에 “어느 칸에 덮였는지(origin)”를 붙인다 ──
  function buildGrid(cells) {
    const rows = cells.length;
    const cols = cells.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    const grid = [];
    for (let r = 0; r < rows; r++) {
      grid.push([]);
      for (let c = 0; c < cols; c++) grid[r].push({ r: r, c: c, text: '', rs: 1, cs: 1, origin: null });
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = cells[r][c];
        if (!cell || grid[r][c].origin) continue;
        const g = grid[r][c];
        g.text = String(cell.text || '');
        g.rs = Math.max(1, cell.rowSpan || 1);
        g.cs = Math.max(1, cell.colSpan || 1);
        g.origin = g;
        for (let dr = 0; dr < g.rs; dr++) {
          for (let dc = 0; dc < g.cs; dc++) {
            if ((dr || dc) && grid[r + dr] && grid[r + dr][c + dc]) grid[r + dr][c + dc].origin = g;
          }
        }
      }
    }
    return grid;
  }

  // ── 2) kordoc 결과 → 한 주 시간표 ──
  // 결과: { title, weekLabel, weekStart, days: [{ date, weekday, off, event, supplies, periods: [{ no, subject, content, pages, cont }] }], notice }
  function parse(blocks, opts) {
    opts = opts || {};
    const texts = [];
    let found = null;
    (blocks || []).forEach(function (b) {
      if (b.type === 'table' && b.table && Array.isArray(b.table.cells)) {
        b.table.cells.forEach(function (row) { row.forEach(function (c) { texts.push(String(c && c.text || '')); }); });
        if (found) return;
        const grid = buildGrid(b.table.cells);
        for (let r = 0; r < Math.min(6, grid.length); r++) {
          const days = [];
          grid[r].forEach(function (g) {
            if (g.origin !== g) return;
            const m = oneLine(g.text).match(/^([월화수목금토])(?:요일)?\s*(?:\(\s*(\d{1,2})\s*일?\s*\))?$/);
            if (m) days.push({ weekday: m[1], day: m[2] ? +m[2] : null, c0: g.c, c1: g.c + g.cs - 1 });
          });
          if (days.length >= 3) { found = { grid: grid, headerRow: r, days: days }; break; }
        }
      } else if (b.text) {
        texts.push(String(b.text));
      }
    });
    if (!found) return { error: '요일(월~금) 머리글이 있는 주간학습안내 표를 찾지 못했어요.' };

    const grid = found.grid;
    const label = function (r) { const o = grid[r][0].origin; return o ? nospace(o.text) : ''; };
    // 교시 묶음: 첫 열이 “N교시”인 칸의 세로 범위
    const periods = [];
    const specials = {};
    for (let r = found.headerRow + 1; r < grid.length; r++) {
      const o = grid[r][0].origin;
      if (!o || o.r !== r) continue;
      const t = nospace(o.text);
      const pm = t.match(/^(\d{1,2})교시/);
      if (pm) periods.push({ no: +pm[1], r0: r, r1: r + o.rs - 1 });
      else if (/^행사/.test(t)) specials.event = r;
      else if (/^준비물/.test(t)) specials.supplies = r;
      else if (/^가정통신|^알림|^안내/.test(t)) specials.notice = r;
    }
    if (!periods.length) return { error: '교시(1교시, 2교시 …) 줄을 찾지 못했어요.' };

    // 한 요일 범위 안의 서로 다른 칸 글자를 모은다
    const dayText = function (r, d) {
      const seen = [];
      for (let c = d.c0; c <= d.c1; c++) {
        const o = grid[r][c].origin;
        if (o && seen.indexOf(o) < 0) seen.push(o);
      }
      return seen;
    };
    const periodOfRow = function (r) {
      return periods.find(function (p) { return r >= p.r0 && r <= p.r1; }) || null;
    };

    // 연도·월: 제목 “6월 1일 - 6월 5일(14주)”, 없으면 설정의 학년도
    const all = texts.join('\n');
    const rm = all.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*[-~]\s*(?:(\d{1,2})\s*월\s*)?(\d{1,2})\s*일/);
    const wk = all.match(/\(?\s*(\d{1,2})\s*주\s*\)?/);
    const schoolYear = opts.schoolYear || DN.Settings.get().schoolYear;
    const startMonth = rm ? +rm[1] : null;
    const yearOf = function (m) { return m <= 2 ? schoolYear + 1 : schoolYear; };

    let prevDate = null;
    const days = found.days.map(function (d, i) {
      let date = '';
      if (startMonth && d.day) {
        let m = startMonth;
        if (prevDate && d.day < +prevDate.slice(8)) m = +prevDate.slice(5, 7) % 12 + 1;   // 달이 바뀜
        else if (prevDate) m = +prevDate.slice(5, 7);
        date = yearOf(m) + '-' + pad(m) + '-' + pad(d.day);
      } else if (prevDate) {
        date = DN.Events.addDays(prevDate, 1);
      } else if (rm) {
        date = yearOf(startMonth) + '-' + pad(startMonth) + '-' + pad(+rm[2]);
      }
      if (date) prevDate = date;

      // 하루 전체를 덮는 칸(예: 지방선거일) → 쉬는 날
      let off = '';
      const firstRow = specials.event !== undefined ? specials.event : periods[0].r0;
      const top = grid[firstRow][d.c0].origin;
      if (top && top.r + top.rs - 1 >= periods[periods.length - 1].r0 && top.c === d.c0) off = nospace(top.text);

      const ps = periods.map(function (p) {
        if (off) return { no: p.no, subject: '', content: '', pages: '', cont: false };
        const subjCells = dayText(p.r0, d);
        const s0 = subjCells[0];
        // 과목 칸이 위 교시에서 이어진 칸에 덮여 있으면 → 연속 수업
        if (s0 && s0.r < p.r0) {
          const from = periodOfRow(s0.r);
          return { no: p.no, subject: '', content: clean(s0.text), pages: '', cont: true, from: from ? from.no : null };
        }
        const subject = subjCells.map(function (o) { return nospace(clean(o.text)); }).filter(Boolean).join('/');
        const rest = [];
        for (let r = p.r0 + 1; r <= p.r1; r++) {
          dayText(r, d).forEach(function (o) {
            if (o.r >= p.r0 && o.r <= p.r1 && rest.indexOf(o) < 0) rest.push(o);
          });
        }
        const lines = rest.map(function (o) { return clean(o.text); }).filter(Boolean);
        const pages = lines.filter(function (l) { return /쪽|^p\.?\s*\d|^\d+\s*-\s*\d+$/i.test(l); });
        const content = lines.filter(function (l) { return pages.indexOf(l) < 0; });
        return { no: p.no, subject: subject, content: content.join(' / '), pages: pages.join(', '), cont: false };
      });
      // 연속 수업은 앞 교시 과목을 이어받는다
      ps.forEach(function (p) {
        if (!p.cont) return;
        const prev = ps.find(function (x) { return x.no === p.from; });
        if (prev) { p.subject = prev.subject; if (!p.content) p.content = prev.content; }
        delete p.from;
      });
      const pick = function (r) { return r === undefined ? '' : dayText(r, d).map(function (o) { return clean(o.text); }).filter(Boolean).join(' / '); };
      return {
        date: date, weekday: d.weekday, off: off,
        event: off ? '' : pick(specials.event),
        supplies: off ? '' : pick(specials.supplies),
        periods: ps,
      };
    });

    let notice = '';
    if (specials.notice !== undefined) {
      const seen = [];
      grid[specials.notice].forEach(function (g) { if (g.origin && g.origin.c > 0 && seen.indexOf(g.origin) < 0) seen.push(g.origin); });
      notice = seen.map(function (o) { return String(o.text).trim(); }).join('\n');
    }
    const monday = days[0] && days[0].date ? DN.Events.addDays(days[0].date, 1 - (new Date(days[0].date + 'T00:00:00').getDay() || 7)) : '';
    return {
      title: rm ? oneLine(rm[0]) : '', weekLabel: wk ? wk[1] + '주' : '',
      weekStart: monday, days: days, notice: notice,
    };
  }

  // ── 3) 저장 · 조회 ──
  function all() { return DN.Store.query(COL, function (t) { return !t.deleted; }); }
  function forWeek(date) {
    if (!DN.Events.isDate(date)) return null;
    const mon = DN.Events.addDays(date, 1 - (new Date(date + 'T00:00:00').getDay() || 7));
    return all().find(function (t) { return t.weekStart === mon; }) || null;
  }
  function forDate(date) {
    const t = forWeek(date);
    if (!t) return null;
    return t.days.find(function (d) { return d.date === date; }) || null;
  }
  // 같은 주가 있으면 같은 id로 교체(동기화 id 유지)
  function save(week, fileName) {
    const rec = { weekStart: week.weekStart, title: week.title, weekLabel: week.weekLabel, days: week.days, notice: week.notice, fileName: fileName || '' };
    const old = DN.Store.query(COL, function (t) { return t.weekStart === week.weekStart; })[0];
    if (old) return DN.Store.update(COL, old.id, Object.assign(rec, { deleted: false }));
    return DN.Store.add(COL, rec);
  }
  function remove(id) { return DN.Store.update(COL, id, { deleted: true }); }

  // ── 4) 가져오기 → 미리보기 → 등록 ──
  function importFile(file) {
    if (!/\.(hwp|hwpx)$/i.test(file.name)) { toast('한글 파일(.hwp, .hwpx)을 선택해 주세요. PDF는 읽을 수 없어요.', 'error'); return; }
    toast('주간학습안내를 읽는 중이에요…', 'info');
    file.arrayBuffer().then(DN.Schedule.parseHangul).then(function (blocks) {
      const week = parse(blocks);
      if (week.error) throw new Error(week.error);
      preview = { fileName: file.name, week: week };
      DN.App.show('schedule');
    }).catch(function (e) { toast((e && e.message) || '파일을 읽지 못했어요.', 'error'); });
  }
  function previewing() { return !!preview; }

  function renderPreview(container) {
    const w = preview.week;
    const maxP = w.days.reduce(function (m, d) { return Math.max(m, d.periods.length); }, 0);
    const head = '<tr><th></th>' + w.days.map(function (d, i) {
      return '<th><input type="date" data-day="' + i + '" data-f="date" value="' + esc(d.date) + '"><div class="wk-wd">' + esc(d.weekday) + '</div></th>';
    }).join('') + '</tr>';
    const row = function (label, f) {
      return '<tr><th>' + label + '</th>' + w.days.map(function (d, i) {
        return '<td>' + (d.off ? '' : '<input data-day="' + i + '" data-f="' + f + '" value="' + esc(d[f]) + '">') + '</td>';
      }).join('') + '</tr>';
    };
    let body = '<tr><th>쉬는 날</th>' + w.days.map(function (d, i) {
      return '<td><input data-day="' + i + '" data-f="off" placeholder="수업하는 날" value="' + esc(d.off) + '"></td>';
    }).join('') + '</tr>' + row('행사', 'event');
    for (let p = 0; p < maxP; p++) {
      body += '<tr><th>' + (p + 1) + '교시</th>' + w.days.map(function (d, i) {
        if (d.off) return p === 0 ? '<td class="wk-off" rowspan="' + maxP + '">' + esc(d.off) + '</td>' : '';
        const x = d.periods[p] || { subject: '', content: '', pages: '' };
        return '<td class="' + (x.cont ? 'wk-cont' : '') + '"><input class="wk-subj subj-' + subjectColor(x.subject) + '" data-day="' + i + '" data-p="' + p + '" data-f="subject" value="' + esc(x.subject) + '" placeholder="과목">' +
          '<textarea data-day="' + i + '" data-p="' + p + '" data-f="content" rows="2" placeholder="학습 내용">' + esc(x.content) + '</textarea>' +
          '<input class="wk-pages" data-day="' + i + '" data-p="' + p + '" data-f="pages" value="' + esc(x.pages) + '" placeholder="쪽"></td>';
      }).join('') + '</tr>';
    }
    body += row('준비물', 'supplies');
    const exists = forWeek(w.weekStart);
    container.innerHTML = '\
      <div class="page-head"><h1>🗓️ 주간학습안내 미리보기</h1></div>\
      <div class="card">\
        <div class="pv-top"><div class="pv-file">📄 ' + esc(preview.fileName) + '</div>\
          <span class="pv-sum wk-sum">' + esc([w.title, w.weekLabel].filter(Boolean).join(' · ') || '주 정보 없음') + '</span></div>' +
        (exists ? '<p class="pv-warn">이 주(' + esc(w.weekStart) + ' 주)의 시간표가 이미 있어요. 등록하면 새 파일 내용으로 바뀌어요.</p>' : '') +
        (w.days.some(function (d) { return !d.date; }) ? '<p class="pv-warn">날짜를 찾지 못한 요일이 있어요. 맨 위 날짜 칸을 채워 주세요.</p>' : '') + '\
        <p class="pv-help">모든 칸을 고칠 수 있어요. 이어지는 수업(예: 1~2교시 체육)은 연한 색으로 보여요. 쉬는 날 칸에 이름을 적으면 그날은 수업 없음으로 처리돼요.</p>\
        <div class="pv-scroll"><table class="wk-table wk-edit"><thead>' + head + '</thead><tbody id="wkBody">' + body + '</tbody></table></div>' +
        (w.notice ? '<div class="md-label">가정통신</div><textarea id="wkNotice" rows="4">' + esc(w.notice) + '</textarea>' : '') + '\
        <div class="pv-bar" style="margin-top:12px"><span class="pv-spacer"></span>\
          <button class="btn-cancel" id="wkCancel">취소</button><button class="btn-primary" id="wkSave">시간표 등록</button></div>\
      </div>';
    const tbody = container.querySelector('#wkBody');
    const onEdit = function (e) {
      const el = e.target, f = el.dataset && el.dataset.f;
      if (!f) return;
      const d = w.days[+el.dataset.day];
      if (el.dataset.p !== undefined) {
        const p = d.periods[+el.dataset.p] || (d.periods[+el.dataset.p] = { no: +el.dataset.p + 1, subject: '', content: '', pages: '', cont: false });
        p[f] = el.value.trim();
        if (f === 'subject') el.className = 'wk-subj subj-' + subjectColor(el.value);
      } else {
        d[f] = el.value.trim();
        if (f === 'off' && e.type === 'change') renderPreview(container);
      }
    };
    container.querySelector('thead').addEventListener('change', onEdit);
    tbody.addEventListener('input', onEdit);
    tbody.addEventListener('change', onEdit);
    const notice = container.querySelector('#wkNotice');
    if (notice) notice.addEventListener('input', function () { w.notice = notice.value; });
    container.querySelector('#wkCancel').addEventListener('click', function () {
      if (!confirmAsk('주간학습안내 가져오기를 취소할까요?')) return;
      preview = null;
      DN.App.show('schedule');
    });
    container.querySelector('#wkSave').addEventListener('click', function () {
      if (w.days.some(function (d) { return !DN.Events.isDate(d.date); })) { toast('날짜를 모두 채워 주세요.', 'error'); return; }
      const mon = DN.Events.addDays(w.days[0].date, 1 - (new Date(w.days[0].date + 'T00:00:00').getDay() || 7));
      w.weekStart = mon;
      if (forWeek(mon) && !confirmAsk('이미 있는 ' + mon + ' 주 시간표를 새 내용으로 바꿀까요?')) return;
      if (!save(w, preview.fileName)) { toast('저장 공간이 부족해 등록하지 못했어요.', 'error'); return; }
      toast((w.weekLabel ? w.weekLabel + ' ' : '') + '시간표를 등록했어요.', 'success');
      preview = null;
      DN.ScheduleView.showTimetable(w.days[0].date);
      DN.App.show('schedule');
    });
  }

  // ── 5) 보기: PC 한 주 표 · 핸드폰 오늘 목록 ──
  function weekTableHtml(t, todayStr) {
    const maxP = t.days.reduce(function (m, d) { return Math.max(m, d.periods.length); }, 0);
    let html = '<div class="pv-scroll"><table class="wk-table"><thead><tr><th></th>' + t.days.map(function (d) {
      return '<th class="' + (d.date === todayStr ? 'today' : '') + '">' + esc(d.weekday) + ' <small>' + (d.date ? (+d.date.slice(5, 7)) + '/' + (+d.date.slice(8)) : '') + '</small></th>';
    }).join('') + '</tr></thead><tbody>';
    if (t.days.some(function (d) { return d.event; })) {
      html += '<tr class="wk-evrow"><th>행사</th>' + t.days.map(function (d) { return '<td>' + (d.off ? '' : esc(d.event)) + '</td>'; }).join('') + '</tr>';
    }
    for (let p = 0; p < maxP; p++) {
      html += '<tr><th>' + (p + 1) + '교시</th>' + t.days.map(function (d) {
        if (d.off) return p === 0 ? '<td class="wk-off" rowspan="' + maxP + '">' + esc(d.off) + '</td>' : '';
        const x = d.periods[p];
        if (!x || (!x.subject && !x.content)) return '<td></td>';
        return '<td class="' + (x.cont ? 'wk-cont' : '') + '"><span class="wk-chip subj-' + subjectColor(x.subject) + '">' + esc(x.subject || '—') + '</span>' +
          (x.content && !x.cont ? '<div class="wk-content">' + esc(x.content) + '</div>' : '') +
          (x.pages && !x.cont ? '<div class="wk-pages-t">' + esc(x.pages) + '</div>' : '') + '</td>';
      }).join('') + '</tr>';
    }
    if (t.days.some(function (d) { return d.supplies; })) {
      html += '<tr class="wk-evrow"><th>준비물</th>' + t.days.map(function (d) { return '<td>' + (d.off ? '' : esc(d.supplies)) + '</td>'; }).join('') + '</tr>';
    }
    html += '</tbody></table></div>';
    if (t.notice) html += '<details class="wk-notice"><summary>가정통신</summary><p>' + esc(t.notice).replace(/\n/g, '<br>') + '</p></details>';
    return html;
  }

  // 핸드폰 “오늘 시간표”
  function dayListHtml(d) {
    if (!d) return '';
    if (d.off) return '<p class="m-empty">🏖 ' + esc(d.off) + ' — 수업 없음</p>';
    const rows = d.periods.filter(function (p) { return p.subject || p.content; }).map(function (p) {
      return '<li class="wk-m"><span class="wk-no">' + p.no + '</span><span class="wk-chip subj-' + subjectColor(p.subject) + '">' + esc(p.subject || '—') + '</span>' +
        '<span class="wk-m-t">' + (p.cont ? '<small>(이어서)</small>' : esc(p.content)) + '</span></li>';
    }).join('');
    return (rows ? '<ul class="wk-mlist">' + rows + '</ul>' : '<p class="m-empty">시간표가 비어 있어요.</p>') +
      (d.event ? '<p class="wk-m-extra">🎈 ' + esc(d.event) + '</p>' : '') +
      (d.supplies ? '<p class="wk-m-extra">🎒 준비물: ' + esc(d.supplies) + '</p>' : '');
  }

  return {
    COL, buildGrid, parse, subjectColor, all, forWeek, forDate, save, remove,
    importFile, previewing, renderPreview, weekTableHtml, dayListHtml,
  };
})();
