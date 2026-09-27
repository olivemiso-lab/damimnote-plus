// ════════════════════════════════════════════════════
//  담임노트+ · 투게더 월중행사 변환 (DN.Together)
//  kordoc 파싱 결과 → 중간 표 형식 → 일정 레코드 후보 (명세 §6)
//  화면·저장과 무관한 순수 함수만 둔다
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Together = (function () {
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const HOLIDAY_WORDS = [
    '대체휴일', '대체공휴일', '임시공휴일', '공휴일', '신정', '설날', '설연휴', '삼일절', '3.1절', '어린이날',
    '부처님오신날', '석가탄신일', '현충일', '광복절', '개천절', '추석', '한글날', '성탄절', '크리스마스',
    '재량휴업', '개교기념일', '선거일',
  ];
  const TIME_PART = '(?:\\d{1,2}:\\d{2}|\\d{1,2}시(?:\\s*\\d{1,2}분|\\s*반)?)';
  const TIME_RE = new RegExp('^' + TIME_PART + '(?:\\s*~\\s*(?:' + TIME_PART + ')?)?$');
  const PERIOD_RE = /^[\d\/.\s일월~-]+$/;
  const PERIOD_ONLY_RE = /^(\d{1,2})~(\d{1,2})$|^(\d{1,2})\/(\d{1,2})~(\d{1,2})$|^(\d{1,2})\/(\d{1,2})~(\d{1,2})\/(\d{1,2})$/;
  const PLACE_RE = /(실|관|센터|공원|강당|운동장)$/;
  const SPECIAL_RE = /통합\s*\d|특수학급/;

  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function daysIn(y, m) { return new Date(y, m, 0).getDate(); }
  function nospace(s) { return String(s || '').replace(/\s+/g, ''); }

  // 같은 행사인지 비교할 때 쓰는 제목: 공백과 괄호 기호를 없앤다
  function normTitle(s) { return nospace(s).replace(/[()[\]{}]/g, ''); }

  // ── 1) kordoc 결과 → 중간 표 형식 ──
  // { title, yearLabel, rows: [{ day, weekday, events: [줄...], owners: [줄...], note }] }
  // events·owners는 줄 번호를 맞추기 위해 빈 줄도 그대로 둔다
  function cellText(c) { return c && c.text != null ? String(c.text) : ''; }

  function findColumns(row) {
    const cols = { day: -1, weekday: -1, events: -1, owners: -1, note: -1 };
    row.forEach(function (c, i) {
      const t = nospace(cellText(c));
      if (!t) return;
      if (cols.events < 0 && /행사/.test(t)) cols.events = i;
      else if (cols.owners < 0 && /담당/.test(t)) cols.owners = i;
      else if (cols.note < 0 && /비고/.test(t)) cols.note = i;
      else if (cols.weekday < 0 && /요일/.test(t)) cols.weekday = i;
      else if (cols.day < 0 && /^(날짜|일자|일|날)$/.test(t)) cols.day = i;
    });
    return cols;
  }

  function extractTable(blocks) {
    const texts = [];
    let found = null;
    (blocks || []).forEach(function (b) {
      if (b.type === 'table' && b.table && Array.isArray(b.table.cells)) {
        const cells = b.table.cells;
        if (!found) {
          for (let r = 0; r < Math.min(3, cells.length); r++) {
            const cols = findColumns(cells[r]);
            if (cols.events >= 0 && cols.owners >= 0) { found = { cells: cells, headerRow: r, cols: cols }; return; }
          }
        }
        cells.forEach(function (row) { row.forEach(function (c) { texts.push(cellText(c)); }); });
      } else if (b.text) {
        texts.push(String(b.text));
      }
    });
    if (!found) return { error: '월중행사 표(학교행사·담당자 열)를 찾지 못했어요.' };

    const cols = found.cols;
    // 날짜·요일 머리글이 비어 있으면(투게더 양식) 앞의 두 열로 본다
    if (cols.day < 0) cols.day = 0;
    if (cols.weekday < 0 && cols.day + 1 !== cols.events) cols.weekday = cols.day + 1;
    const lines = function (s) { return String(s || '').split('\n').map(function (x) { return x.trim(); }); };
    const rows = [];
    found.cells.slice(found.headerRow + 1).forEach(function (row) {
      const get = function (i) { return i >= 0 && row[i] ? cellText(row[i]).trim() : ''; };
      const day = get(cols.day);
      const ev = get(cols.events);
      if (!day && !ev) return;
      rows.push({
        day: /^\d{1,2}$/.test(day) ? parseInt(day, 10) : day,
        weekday: get(cols.weekday),
        events: ev ? lines(ev) : [],
        owners: get(cols.owners) ? lines(get(cols.owners)) : [],
        note: get(cols.note),
      });
    });
    const all = texts.join('\n');
    const titleM = all.match(/[^\n]*\d{1,2}\s*월[^\n]*(월중|행사|일정)[^\n]*/);
    const yearM = all.match(/\d{4}\s*학?년도/);
    return { title: titleM ? titleM[0].trim() : '', yearLabel: yearM ? yearM[0].replace(/\s+/g, '') : '', rows: rows };
  }

  // 제목·연도 표기에서 월과 학년도 찾기 (못 찾으면 null)
  function detectMonth(title) {
    const m = String(title || '').match(/(\d{1,2})\s*월/);
    const n = m ? parseInt(m[1], 10) : 0;
    return n >= 1 && n <= 12 ? n : null;
  }
  function detectSchoolYear(label) {
    const m = String(label || '').match(/(\d{4})/);
    return m ? parseInt(m[1], 10) : null;
  }

  // 학년도 + 월 → 달력 연도 (1~2월은 다음 해)
  function yearFor(schoolYear, month) { return month <= 2 ? schoolYear + 1 : schoolYear; }

  // ── 2) 한 줄 해석 ──
  // 기간 조각: "12~16", "10/19~23", "10/26~10/30", "27일~28일", "10.19~10.23", "10월 19일~23일"
  // 성공: { start: [m, d], end: [m, d] }, 기간처럼 보이지만 해석 실패: { error: true }, 기간 아님: null
  function parsePeriod(piece, month, schoolYear) {
    const raw = String(piece || '').trim();
    if (!/~/.test(raw) || !/\d/.test(raw) || !PERIOD_RE.test(raw)) return null;
    const s = raw.replace(/\s+/g, '').replace(/(\d+)월/g, '$1/').replace(/\./g, '/').replace(/일/g, '').replace(/-/g, '~');
    const m = s.match(PERIOD_ONLY_RE);
    if (!m) return { error: true };
    let start, end;
    if (m[1]) { start = [month, +m[1]]; end = [month, +m[2]]; }
    else if (m[3]) { start = [+m[3], +m[4]]; end = [+m[3], +m[5]]; }
    else { start = [+m[6], +m[7]]; end = [+m[8], +m[9]]; }
    const valid = function (md) {
      return md[0] >= 1 && md[0] <= 12 && md[1] >= 1 && md[1] <= daysIn(yearFor(schoolYear, md[0]), md[0]);
    };
    if (!valid(start) || !valid(end)) return { error: true };
    const sd = ymd(yearFor(schoolYear, start[0]), start[0], start[1]);
    const ed = ymd(yearFor(schoolYear, end[0]), end[0], end[1]);
    if (ed <= sd) return { error: true };
    return { start: sd, end: ed };
  }

  // "3, 4학년", "4,5,6학년", "1~6학년", "[4학년]" → [3, 4] 등
  function parseGrades(text) {
    const out = [];
    const re = /(^|[^\d])(\d(?:\s*[,~]\s*\d)*)\s*학년(?!도)/g;
    let m;
    while ((m = re.exec(String(text || '')))) {
      m[2].split(/\s*,\s*/).forEach(function (part) {
        const r = part.split(/\s*~\s*/).map(Number);
        const lo = r[0], hi = r.length > 1 ? r[1] : r[0];
        for (let g = lo; g <= hi; g++) if (g >= 1 && g <= 6 && out.indexOf(g) < 0) out.push(g);
      });
    }
    return out.sort();
  }

  function parseClasses(text) {
    const out = [];
    const re = /(^|[^\d])([1-6])-(\d{1,2})(?!\d)/g;
    let m;
    while ((m = re.exec(String(text || '')))) {
      const c = m[2] + '-' + parseInt(m[3], 10);
      if (out.indexOf(c) < 0) out.push(c);
    }
    return out;
  }

  // 괄호 안 조각 나누기: 쉼표·" / " 기준. 단 "1,2,3교시", "3, 4학년"처럼 숫자만 있는 조각은 뒤와 다시 붙인다
  function splitPieces(content) {
    const raw = String(content).split(/,|\s+\/\s+/).map(function (x) { return x.trim(); });
    const out = [];
    let carry = '';
    raw.forEach(function (p) {
      if (/^\d+$/.test(p)) { carry += p + ','; return; }
      out.push(carry + p);
      carry = '';
    });
    if (carry) out.push(carry.replace(/,$/, ''));
    return out.filter(function (p) { return p; });
  }

  function isTime(p) { return TIME_RE.test(p) || /^[\d,~\s]+교시$/.test(p); }
  function isPlace(p) { return PLACE_RE.test(p) && !/학년|교시|\d-\d/.test(p); }

  // 행사 한 줄 → 표시 제목·기간·시간·장소·머리표·학년·반
  function parseLine(raw, month, schoolYear) {
    const text = String(raw || '').trim();
    const res = { rawTitle: text, title: text, time: '', place: '', tags: [], grades: [], classes: [], period: null, periodError: false };
    const times = [];
    const places = [];
    // 괄호·대괄호 묶음을 하나씩 보면서 표시 제목을 다시 만든다
    const title = text.replace(/\(([^()]*)\)|\[([^[\]]*)\]/g, function (whole, paren, bracket) {
      const isBracket = paren === undefined;
      const pieces = splitPieces(isBracket ? bracket : paren);
      const hasDetail = pieces.some(function (p) { return isTime(p) || isPlace(p); });
      if (isBracket && !hasDetail) {
        // 머리표: [동료장학 공개수업], [3학년], [연수/희망자]
        const tag = bracket.trim();
        if (tag && res.tags.indexOf(tag) < 0) res.tags.push(tag);
        return whole;
      }
      const keep = [];
      pieces.forEach(function (p) {
        const period = parsePeriod(p, month, schoolYear);
        if (period && period.error) { res.periodError = true; keep.push(p); return; }
        if (period) { if (!res.period) res.period = period; return; }
        if (isTime(p)) times.push(p);
        else if (isPlace(p)) places.push(p);
        keep.push(p);
      });
      // 원칙: 기간 조각만 제목에서 빼고 나머지는 그대로 둔다
      if (keep.length === pieces.length) return whole;
      if (!keep.length) return '';
      return isBracket ? '[' + keep.join(', ') + ']' : '(' + keep.join(', ') + ')';
    });
    res.title = title.replace(/\s{2,}/g, ' ').replace(/\s+([)\]])/g, '$1').trim() || text;
    res.time = times.join(', ');
    res.place = places.join(', ');
    res.grades = parseGrades(text);
    res.classes = parseClasses(text);
    res.classes.forEach(function (c) {
      const g = parseInt(c, 10);
      if (res.grades.indexOf(g) < 0) res.grades.push(g);
    });
    res.grades.sort();
    // 1~6학년 모두 해당 = 전체 대상 → 빈 배열 (명세 §5: 빈 배열이면 전체 대상)
    if (res.grades.length === 6) res.grades = [];
    if (SPECIAL_RE.test(text) && res.tags.indexOf('특수학급') < 0) res.tags.push('특수학급');
    return res;
  }

  function isHolidayTitle(title) {
    const t = nospace(title);
    return HOLIDAY_WORDS.some(function (w) { return t.indexOf(w) >= 0; });
  }

  // 평일 기준 다음 날 (금 → 월)
  function nextWeekday(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  // ── 3) 중간 표 → 일정 레코드 후보 ──
  // opts: { month?, schoolYear?, teacherName, grade } — month/schoolYear를 주면 파일에서 찾은 값보다 우선
  // 결과: { month, schoolYear, importKey, needPick, events: [...] }  (events의 reviewReason은 저장하지 않는 보조 정보)
  function convert(tbl, opts) {
    opts = opts || {};
    const month = opts.month || detectMonth(tbl.title);
    const schoolYear = opts.schoolYear || detectSchoolYear(tbl.yearLabel);
    const needPick = !detectMonth(tbl.title) || !detectSchoolYear(tbl.yearLabel);
    if (!month || !schoolYear) return { month: month, schoolYear: schoolYear, needPick: true, events: [], importKey: '' };
    const year = yearFor(schoolYear, month);
    const importKey = year + '-' + pad(month);
    const teacher = nospace(opts.teacherName);
    const events = [];

    tbl.rows.forEach(function (row) {
      const evNonEmpty = row.events.filter(function (x) { return x; });
      if (!evNonEmpty.length) return; // 행사 칸이 빈 날(토·일 등)은 건너뛴다

      let date = '';
      let rowReason = '';
      if (typeof row.day !== 'number') {
        rowReason = '날짜 칸이 숫자가 아니에요';
      } else if (row.day < 1 || row.day > daysIn(year, month)) {
        rowReason = month + '월에 없는 날짜예요';
      } else {
        date = ymd(year, month, row.day);
        const wd = String(row.weekday || '').trim().charAt(0);
        if (wd && WEEKDAYS.indexOf(wd) >= 0 && WEEKDAYS[new Date(date + 'T00:00:00').getDay()] !== wd) {
          rowReason = '요일이 달력과 달라요 (연도·월 확인)';
        }
      }

      // 담당자 줄 짝짓기
      const ownersNonEmpty = row.owners.filter(function (x) { return x; });
      const dayOwnersEmpty = ownersNonEmpty.length === 0;
      let pairs; // [{ ev, owner }]
      let mismatch = false;
      if (row.events.length === row.owners.length) {
        pairs = row.events.map(function (ev, i) { return { ev: ev, owner: row.owners[i] }; })
          .filter(function (p) { return p.ev; });
      } else {
        const holidays = evNonEmpty.map(function (ev) { return dayOwnersEmpty && isHolidayTitle(ev); });
        const nonHolidayCount = holidays.filter(function (h) { return !h; }).length;
        if (ownersNonEmpty.length === evNonEmpty.length) {
          pairs = evNonEmpty.map(function (ev, i) { return { ev: ev, owner: ownersNonEmpty[i] }; });
        } else if (ownersNonEmpty.length === nonHolidayCount) {
          let k = 0;
          pairs = evNonEmpty.map(function (ev, i) { return { ev: ev, owner: holidays[i] ? '' : ownersNonEmpty[k++] }; });
        } else {
          mismatch = true;
          pairs = evNonEmpty.map(function (ev, i) { return { ev: ev, owner: ownersNonEmpty[i] || '' }; });
        }
      }

      pairs.forEach(function (p) {
        const line = parseLine(p.ev, month, schoolYear);
        const holiday = dayOwnersEmpty && isHolidayTitle(line.title);
        let reason = rowReason;
        if (!reason && mismatch && !holiday) reason = '행사 줄 수와 담당자 줄 수가 달라요';
        if (!reason && line.periodError) reason = '기간 표기를 해석하지 못했어요';
        const owner = String(p.owner || '').trim();
        events.push({
          date: line.period ? line.period.start : date,
          endDate: line.period ? line.period.end : '',
          title: line.title,
          rawTitle: line.rawTitle,
          owner: owner,
          isMine: !!teacher && nospace(owner).indexOf(teacher) >= 0,
          time: line.time,
          place: line.place,
          tags: line.tags,
          grades: line.grades,
          classes: line.classes,
          kind: holiday ? 'holiday' : 'event',
          done: false,
          source: 'together',
          importKey: importKey,
          seriesKey: '',
          note: row.note || '',
          attachmentIds: [],
          needsReview: !!reason,
          reviewReason: reason,
        });
      });
    });

    assignSeries(events, importKey);
    return { month: month, schoolYear: schoolYear, importKey: importKey, needPick: needPick, events: events };
  }

  // 같은 제목이 연속된 평일에 반복되면 같은 seriesKey (기간 일정·휴일 제외)
  function assignSeries(events, importKey) {
    const groups = {};
    events.forEach(function (e) {
      if (e.endDate || e.kind === 'holiday' || !e.date) return;
      const k = normTitle(e.title);
      (groups[k] = groups[k] || []).push(e);
    });
    Object.keys(groups).forEach(function (k) {
      const list = groups[k].sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      let run = [list[0]];
      const flush = function () {
        if (run.length >= 2) {
          const key = importKey + ':' + k + ':' + run[0].date;
          run.forEach(function (e) { e.seriesKey = key; });
        }
      };
      for (let i = 1; i < list.length; i++) {
        if (list[i].date === nextWeekday(run[run.length - 1].date)) run.push(list[i]);
        else if (list[i].date !== run[run.length - 1].date) { flush(); run = [list[i]]; }
      }
      flush();
    });
  }

  // 미리보기 상단 요약용 숫자
  function stats(events, grade) {
    const holidayDates = {};
    let related = 0, mine = 0, review = 0;
    events.forEach(function (e) {
      if (e.kind === 'holiday') holidayDates[e.date] = true;
      if (e.grades.indexOf(grade) >= 0) related++;
      if (e.isMine) mine++;
      if (e.needsReview) review++;
    });
    return {
      total: events.length,
      holidays: Object.keys(holidayDates).length,
      related: related, mine: mine, review: review,
      periods: events.filter(function (e) { return e.endDate; }).length,
    };
  }

  return {
    extractTable, convert, stats, parseLine, parsePeriod, parseGrades, parseClasses, splitPieces,
    detectMonth, detectSchoolYear, yearFor, normTitle, isHolidayTitle, nextWeekday,
  };
})();
