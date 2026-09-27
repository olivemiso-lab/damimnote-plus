// ════════════════════════════════════════════════════
//  담임노트+ · 일정 데이터 (DN.Events)
//  필터 · 달력 배치(기간·연속 반복 묶기) · 이번 주 할 일 · 메모 날짜 제안 · 추가/수정/삭제/첨부
//  화면 코드는 schedule-view.js — 여기는 DOM을 만지지 않는다
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Events = (function () {
  const COL = 'events';
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  function pad(n) { return String(n).padStart(2, '0'); }
  function toStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function toDate(s) { return new Date(s + 'T00:00:00'); }
  function addDays(s, n) { const d = toDate(s); d.setDate(d.getDate() + n); return toStr(d); }
  function isDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
    return toStr(toDate(s)) === s;
  }
  function weekdayOf(s) { return WEEKDAYS[toDate(s).getDay()]; }
  function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }

  function live() {
    return DN.Store.query(COL, function (e) { return !e.deleted && isDate(e.date); }).sort(byDate);
  }
  function get(id) {
    const e = DN.Store.get(COL, id);
    return e && !e.deleted ? e : null;
  }
  function endOf(e) { return e.endDate && e.endDate > e.date ? e.endDate : e.date; }

  // 할 일 대상: 내 담당이거나 제출 마감 (명세 §5 done 설명)
  function isTask(e) { return e.kind !== 'holiday' && (!!e.isMine || e.kind === 'deadline'); }

  // ── 필터 ──
  // myGrade: 우리 학년 행사 + 학년 표시 없는(전체 대상) 행사만. mineOnly: 할 일 대상만.
  // 휴일은 어느 필터에서도 보인다(달력의 빨간 날 유지).
  function matches(e, f, grade) {
    if (e.kind === 'holiday') return true;
    if (f.myGrade && (e.grades || []).length && (e.grades || []).indexOf(grade) < 0) return false;
    if (f.mineOnly && !isTask(e)) return false;
    return true;
  }
  function filtered(f, grade) {
    return live().filter(function (e) { return matches(e, f || {}, grade); });
  }

  // ── 달력 배치 ──
  // 연속 반복(seriesKey)은 하나로 묶고, 기간 일정과 함께 막대(bar)로 그린다
  // 결과: [{ key, kind: 'series'|'period'|'single', start, end, events: [...] }]
  function calendarItems(events) {
    const series = {};
    const items = [];
    events.forEach(function (e) {
      if (e.seriesKey) (series[e.seriesKey] = series[e.seriesKey] || []).push(e);
    });
    const done = {};
    events.forEach(function (e) {
      if (e.seriesKey && series[e.seriesKey].length > 1) {
        if (done[e.seriesKey]) return;
        done[e.seriesKey] = true;
        const list = series[e.seriesKey].slice().sort(byDate);
        items.push({ key: 's:' + e.seriesKey, kind: 'series', start: list[0].date, end: list[list.length - 1].date, events: list });
      } else if (endOf(e) > e.date) {
        items.push({ key: e.id, kind: 'period', start: e.date, end: endOf(e), events: [e] });
      } else {
        items.push({ key: e.id, kind: 'single', start: e.date, end: e.date, events: [e] });
      }
    });
    return items;
  }

  // 달력 한 주(일~토)에 들어갈 막대 조각과 줄(lane) 배치
  // 결과: { bars: [{ item, col, span, lane, contStart, contEnd }], lanes }
  function weekBars(items, weekStart) {
    const weekEnd = addDays(weekStart, 6);
    const segs = [];
    items.forEach(function (it) {
      if (it.kind === 'single' || it.start > weekEnd || it.end < weekStart) return;
      const seg = function (s, e) {
        const col = toDate(s).getDay();
        segs.push({ item: it, col: col, span: toDate(e).getDay() - col + 1, contStart: s > it.start, contEnd: e < it.end });
      };
      if (it.kind !== 'series') {
        seg(it.start < weekStart ? weekStart : it.start, it.end > weekEnd ? weekEnd : it.end);
        return;
      }
      // 연속 반복은 실제로 행사가 있는 날끼리만 막대로 잇는다 (금→월이면 주말은 비움)
      const days = it.events.map(function (x) { return x.date; })
        .filter(function (d, i, a) { return d >= weekStart && d <= weekEnd && a.indexOf(d) === i; }).sort();
      let runStart = null, prev = null;
      days.forEach(function (d) {
        if (prev && addDays(prev, 1) !== d) { seg(runStart, prev); runStart = null; }
        if (!runStart) runStart = d;
        prev = d;
      });
      if (runStart) seg(runStart, prev);
    });
    segs.sort(function (a, b) { return a.col - b.col || b.span - a.span; });
    const laneEnds = [];
    segs.forEach(function (sg) {
      let lane = 0;
      while (laneEnds[lane] !== undefined && laneEnds[lane] >= sg.col) lane++;
      laneEnds[lane] = sg.col + sg.span - 1;
      sg.lane = lane;
    });
    return { bars: segs, lanes: laneEnds.length };
  }

  // 달력 표시용: 월 전체를 덮는 주 시작일(일요일) 목록
  function monthWeeks(year, month) {
    const first = new Date(year, month - 1, 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const last = new Date(year, month, 0);
    const weeks = [];
    for (let d = new Date(start); d <= last; d.setDate(d.getDate() + 7)) weeks.push(toStr(d));
    return weeks;
  }

  // 특정 날짜에 걸친 일정 (기간 일정 포함)
  function onDate(events, date) {
    return events.filter(function (e) { return e.date <= date && endOf(e) >= date; });
  }

  // ── 이번 주 할 일 ──
  // 이번 주(일~토)에 마감·날짜가 있는 미완료 할 일 + 지난 주 이전에 밀린 미완료 할 일. 마감일 순.
  function weekRange(today) {
    const t = today || toStr(new Date());
    const start = addDays(t, -toDate(t).getDay());
    return { start: start, end: addDays(start, 6) };
  }
  function todos(today) {
    const w = weekRange(today);
    return live().filter(function (e) {
      return isTask(e) && !e.done && endOf(e) <= w.end && endOf(e) >= addDays(w.start, -30);
    }).map(function (e) {
      return { event: e, due: endOf(e), overdue: endOf(e) < (today || toStr(new Date())) };
    }).sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : 0; });
  }

  // ── 메모 속 날짜 표현 찾기 (정규식, AI 없음) — 날짜 칸에 “제안”만 한다 ──
  // 10월 15일 / 10/15 / 10.15 / 2026.10.15 / 15일(수) / 15일까지
  // 결과: [{ date, text, deadline }] (중복 제거, 최대 5개)
  function suggestDates(text, today) {
    const src = String(text || '');
    const base = toDate(today || toStr(new Date()));
    const out = [];
    const seen = {};
    const push = function (y, m, d, matchText, idx) {
      if (m < 1 || m > 12 || d < 1 || d > 31) return;
      if (!y) {
        // 연도가 없으면 올해로 보되, 두 달 넘게 지난 날이면 내년으로
        y = base.getFullYear();
        const cand = new Date(y, m - 1, d);
        if ((base - cand) / 86400000 > 60) y++;
      }
      const s = y + '-' + pad(m) + '-' + pad(d);
      if (!isDate(s) || seen[s]) return;
      seen[s] = true;
      const after = src.slice(idx + matchText.length, idx + matchText.length + 8);
      out.push({ date: s, text: matchText.trim(), deadline: /^\s*(\([^)]*\))?\s*(까지|마감)/.test(after) || /까지|마감/.test(matchText), at: idx });
    };
    let m;
    const full = /(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/g;
    while ((m = full.exec(src))) push(+m[1], +m[2], +m[3], m[0], m.index);
    const md = /(^|[^\d.\/-])(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
    while ((m = md.exec(src))) push(0, +m[2], +m[3], m[0].slice(m[1].length), m.index + m[1].length);
    const slash = /(^|[^\d.\/-])(\d{1,2})\s*[/.]\s*(\d{1,2})(?![\d.\/]|\s*회|\s*교시|\s*%)/g;
    while ((m = slash.exec(src))) push(0, +m[2], +m[3], m[0].slice(m[1].length), m.index + m[1].length);
    // 월 없이 "15일(수)" "15일까지": 오늘 이후 가장 가까운 그 날짜(요일이 있으면 요일도 맞는 달)
    const dayOnly = /(^|[^\d월\s])\s*(\d{1,2})\s*일\s*(\(([월화수목금토일])\))?\s*(까지)?/g;
    while ((m = dayOnly.exec(src))) {
      if (!m[4] && !m[5]) continue;
      const d = +m[2];
      for (let k = 0; k < 3; k++) {
        const cand = new Date(base.getFullYear(), base.getMonth() + k, d);
        if (cand.getDate() !== d || cand < base && k === 0 && (base - cand) / 86400000 > 3) continue;
        if (m[4] && WEEKDAYS[cand.getDay()] !== m[4]) continue;
        push(cand.getFullYear(), cand.getMonth() + 1, d, m[0].slice(m[1].length), m.index + m[1].length);
        break;
      }
    }
    return out.sort(function (a, b) { return a.at - b.at; }).slice(0, 5).map(function (s) {
      return { date: s.date, text: s.text, deadline: s.deadline };
    });
  }

  // ── 추가 · 수정 · 삭제 ──
  function blankManual() {
    return {
      date: '', endDate: '', title: '', rawTitle: '', owner: '', isMine: false, time: '', place: '',
      tags: [], grades: [], classes: [], kind: 'event', done: false, source: 'manual', importKey: '',
      seriesKey: '', note: '', attachmentIds: [], needsReview: false,
    };
  }

  function create(fields) {
    const rec = Object.assign(blankManual(), fields);
    rec.rawTitle = rec.rawTitle || rec.title;
    return DN.Store.add(COL, rec);
  }

  function update(id, patch) { return DN.Store.update(COL, id, patch); }

  // 삭제는 툼스톤(동기화용). 첨부 파일은 함께 지운다
  function remove(id) {
    const e = DN.Store.get(COL, id);
    if (!e) return Promise.resolve();
    DN.Store.update(COL, id, { deleted: true, attachmentIds: [] });
    return Promise.all((e.attachmentIds || []).map(function (fid) {
      return DN.Files.remove(fid).catch(function () {});
    }));
  }

  // 파일 여러 개를 저장하고 일정에 연결. 결과: { added: n, failed: n }
  function addAttachments(id, files) {
    const list = Array.prototype.slice.call(files || []);
    return Promise.all(list.map(function (f) {
      return DN.Files.put(f).then(function (fid) { return fid; }, function () { return null; });
    })).then(function (ids) {
      const ok = ids.filter(Boolean);
      const e = DN.Store.get(COL, id);
      if (e && ok.length) DN.Store.update(COL, id, { attachmentIds: (e.attachmentIds || []).concat(ok) });
      return { added: ok.length, failed: ids.length - ok.length };
    });
  }

  function removeAttachment(id, fileId) {
    const e = DN.Store.get(COL, id);
    if (e) DN.Store.update(COL, id, { attachmentIds: (e.attachmentIds || []).filter(function (x) { return x !== fileId; }) });
    return DN.Files.remove(fileId).catch(function () {});
  }

  return {
    live, get, endOf, isTask, matches, filtered, calendarItems, weekBars, monthWeeks, onDate,
    weekRange, todos, suggestDates, create, update, remove, addAttachments, removeAttachment,
    isDate, addDays, weekdayOf, toStr,
  };
})();
