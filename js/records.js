// ════════════════════════════════════════════════════
//  담임노트+ · 학생 기록 데이터 (DN.Records) — 관찰 · 출결 · 관찰 상황 버튼
//  기록에는 학생 이름을 저장하지 않는다(번호만). 이름은 PC의 students와 번호로 연결.
//  삭제는 툼스톤(deleted: true) — 핸드폰과 합치기(작업 7)를 위해
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Records = (function () {
  const OBS = 'observations';
  const ATT = 'attendance';
  const PRE = 'presets';
  const TYPES = ['결석', '지각', '조퇴', '결과'];
  const TYPE_ABBR = { '결석': '결', '지각': '지', '조퇴': '조', '결과': '과' };
  const CLS = 'classes';       // 교과 수업 반 { name: '2-1', subject, count, order } — 동기화됨
  const CLS_NAMES = 'classNames'; // 수업 반 명단 { clsId, names: { 번호: 이름 } } — 이 기기에만(드라이브에 안 올림)
  const REASONS = ['질병', '미인정', '출석인정', '기타'];
  // 지각·조퇴·결과는 몇 교시인지 함께 적는다 (고르지 않아도 저장은 됨)
  const PERIOD_TYPES = ['지각', '조퇴', '결과'];
  const PERIODS = [1, 2, 3, 4, 5, 6];
  function cleanPeriod(type, p) {
    p = +p;
    return PERIOD_TYPES.indexOf(type) >= 0 && p >= 1 && p <= 9 && p % 1 === 0 ? p : null;
  }
  // "3교시 조퇴" / "결석"
  function typeText(a) { return (a.period ? a.period + '교시 ' : '') + a.type; }
  // 기본 관찰 상황 (명세 §5 — 관찰된 행동 중심 문구)
  const DEFAULT_PRESETS = [
    // 핸드폰에서 한눈에 보이도록 무리마다 잘한 행동·걱정되는 행동을 몇 개씩만. 나머지는 메모나 교사가 추가
    ['참여', '발표·질문'], ['참여', '새로운 생각 제시'], ['참여', '끝까지 해결 시도'], ['참여', '모둠 토의 이끎'],
    ['관계', '친구 도움'], ['관계', '친구 배려·양보'],
    ['관계', '친구와 다툼'], ['관계', '거친 말 사용'], ['관계', '친구 놀림'], ['관계', '혼자 있는 시간 많음'],
    ['태도', '과제 성실'], ['태도', '맡은 일 책임감'],
    ['태도', '과제 미제출'], ['태도', '준비물 미준비'], ['태도', '수업 집중 어려움'], ['태도', '친구 활동 방해'],
  ];
  // 교과전담용 기본 버튼 — 수업 장면 중심 (교과 평가·통지표 참고)
  const SUBJECT_PRESETS = [
    ['참여', '발표·질문'], ['참여', '새로운 생각 제시'], ['참여', '끝까지 해결 시도'], ['참여', '집중해서 참여'],
    ['탐구·표현', '실험·실습 성실'], ['탐구·표현', '창의적인 표현'], ['탐구·표현', '개념 이해 뛰어남'], ['탐구·표현', '질문으로 탐구 확장'],
    ['협력', '모둠 활동 이끎'], ['협력', '친구 도움'], ['협력', '맡은 역할 성실'],
    ['태도', '준비물 미준비'], ['태도', '과제 미제출'], ['태도', '수업 집중 어려움'], ['태도', '친구 활동 방해'], ['태도', '활동 후 정리 잘함'],
  ];
  // 교사가 만든 버튼도 이 낱말이 들어가면 갈등 상황으로 본다
  const CONFLICT_RE = /다툼|다퉜|싸움|싸웠|싸운|갈등|놀림|놀렸|놀리|거친 말|욕설|욕을|욕함|때림|때렸|때리|밀침|밀쳤|괴롭/;
  // 직접 쓴 글에서 “7번”처럼 적힌 학생 번호
  function mentionedNos(text) {
    const out = [];
    String(text || '').replace(/(\d{1,2})\s*번/g, function (m, n) { n = +n; if (n >= 1 && n <= 99 && out.indexOf(n) < 0) out.push(n); return m; });
    return out;
  }
  function isConflictLabel(label) { return CONFLICT_RE.test(String(label || '')); }
  // 기본 버튼 판 번호 — 기본 버튼을 늘리면 올린다. 이미 쓰던 사람에게는 없는 문구만 무리 끝에 덧붙인다
  const PRESET_SET = 3;

  function alive(r) { return !r.deleted; }
  function byDateNo(a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.studentNo - b.studentNo) || (a.createdAt < b.createdAt ? -1 : 1);
  }
  function device() { return DN.Settings.get().deviceRole === 'mobile' ? 'mobile' : 'pc'; }

  // ── 교과 수업 반 ──
  function classes() {
    return DN.Store.getAll(CLS).filter(alive).sort(function (a, b) { return (a.order || 0) - (b.order || 0) || (a.name < b.name ? -1 : 1); });
  }
  function getClass(id) { return id ? classes().find(function (c) { return c.id === id; }) || null : null; }
  const clampCount = function (n) { n = parseInt(n, 10); return n >= 1 && n <= 60 ? n : 28; };
  function addClass(name, count, subject) {
    const nm = String(name || '').trim().slice(0, 20);
    if (!nm) return null;
    const max = classes().reduce(function (m, c) { return Math.max(m, c.order || 0); }, 0);
    return DN.Store.add(CLS, { name: nm, subject: String(subject || '').trim().slice(0, 20), count: clampCount(count), order: max + 1 });
  }
  function updateClass(id, patch) {
    const p = Object.assign({}, patch);
    if ('name' in p) p.name = String(p.name).trim().slice(0, 20);
    if ('subject' in p) p.subject = String(p.subject).trim().slice(0, 20);
    if ('count' in p) p.count = clampCount(p.count);
    return DN.Store.update(CLS, id, p);
  }
  function removeClass(id) { return DN.Store.update(CLS, id, { deleted: true }); }
  function className(id) { const c = getClass(id); return c ? c.name + (c.subject ? ' ' + c.subject : '') : ''; }
  function classNameMap(id) {
    const r = DN.Store.getAll(CLS_NAMES).find(function (x) { return x.clsId === id; });
    return (r && r.names) || {};
  }
  // 명단 붙여넣기: 한 줄에 “번호 이름” (탭·쉼표·공백 구분). 결과: 넣은 사람 수
  function setClassNames(id, text) {
    const names = {};
    String(text || '').split(/\r?\n/).forEach(function (line) {
      const m = line.trim().match(/^(\d{1,2})\s*[\t,. ]\s*(.+)$/);
      if (m) names[+m[1]] = m[2].trim().slice(0, 20);
    });
    const r = DN.Store.getAll(CLS_NAMES).find(function (x) { return x.clsId === id; });
    if (r) DN.Store.update(CLS_NAMES, r.id, { names: names }); else DN.Store.add(CLS_NAMES, { clsId: id, names: names });
    return Object.keys(names).length;
  }

  // ── 학생 번호 · 이름 ──
  // 번호 버튼 개수: 설정의 학생 수와 명단의 가장 큰 번호 중 큰 쪽. cls(수업 반 id)를 주면 그 반의 학생 수
  function studentNumbers(cls) {
    if (cls) {
      const c = getClass(cls), names = classNameMap(cls);
      const n = Math.max(c ? c.count : 0, Object.keys(names).reduce(function (m, k) { return Math.max(m, +k); }, 0));
      const out = [];
      for (let i = 1; i <= n; i++) out.push(i);
      return out;
    }
    const maxRoster = DN.Store.getAll('students').reduce(function (m, s) { return Math.max(m, parseInt(s.number, 10) || 0); }, 0);
    const n = Math.max(DN.Settings.get().studentCount || 0, maxRoster);
    const out = [];
    for (let i = 1; i <= n; i++) out.push(i);
    return out;
  }
  // { 번호: 이름 } — 명단이 없으면 빈 객체. cls를 주면 그 수업 반 명단
  function nameMap(cls) {
    if (cls) return classNameMap(cls);
    const map = {};
    DN.Store.getAll('students').forEach(function (s) {
      const no = parseInt(s.number, 10);
      if (no && s.name && !map[no]) map[no] = s.name;
    });
    return map;
  }
  function label(no, names) {
    const n = (names || nameMap())[no];
    return no + '번' + (n ? ' ' + n : '');
  }

  // ── 관찰 상황 버튼 ──
  // 레코드가 하나도 없을 때만 기본값을 넣는다. 교사가 버튼을 다 지워도 툼스톤이 남으므로 되살아나지 않는다
  function presets() {
    let all = DN.Store.getAll(PRE);
    if (!all.length) {
      DN.Store.batch(PRE, { add: DEFAULT_PRESETS.map(function (p, i) { return { group: p[0], label: p[1], order: i + 1 }; }) });
      DN.Store.setMeta('presetSet', String(PRESET_SET));
      all = DN.Store.getAll(PRE);
    } else if ((+DN.Store.getMeta('presetSet') || 1) < PRESET_SET) {
      addNewDefaults(all);
      all = DN.Store.getAll(PRE);
    }
    return all.filter(alive).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }
  // 새 기본 문구를 같은 무리 끝에 넣고 순서를 1부터 다시 매긴다. 교사가 지운 문구(툼스톤)는 되살리지 않는다
  function addNewDefaults(all) {
    const known = {};
    all.forEach(function (p) { known[p.label] = true; });
    const list = all.filter(alive).sort(function (a, b) { return (a.order || 0) - (b.order || 0); })
      .map(function (p) { return { id: p.id, group: p.group }; });
    DEFAULT_PRESETS.forEach(function (d) {
      if (known[d[1]]) return;
      let at = -1;
      list.forEach(function (p, i) { if (p.group === d[0]) at = i; });
      const item = { group: d[0], label: d[1] };
      if (at < 0) list.push(item); else list.splice(at + 1, 0, item);
    });
    const add = [], update = [];
    list.forEach(function (p, i) {
      if (p.id) update.push({ id: p.id, patch: { order: i + 1 } });
      else add.push({ group: p.group, label: p.label, order: i + 1 });
    });
    if (add.length) DN.Store.batch(PRE, { add: add, update: update });
    DN.Store.setMeta('presetSet', String(PRESET_SET));
  }
  // 상황 버튼을 담임용/교과용 기본 세트로 바꾼다. 지금 버튼은 지움 표시(핸드폰에서도 지워지게)
  function usePresetSet(kind) {
    const set = kind === 'subject' ? SUBJECT_PRESETS : DEFAULT_PRESETS;
    const old = DN.Store.getAll(PRE).filter(alive).map(function (p) { return { id: p.id, patch: { deleted: true } }; });
    const ok = DN.Store.batch(PRE, { update: old, add: set.map(function (p, i) { return { group: p[0], label: p[1], order: i + 1 }; }) });
    DN.Store.setMeta('presetSet', String(PRESET_SET));
    return ok;
  }
  function presetGroups() {
    const groups = [];
    presets().forEach(function (p) {
      let g = groups.find(function (x) { return x.name === p.group; });
      if (!g) { g = { name: p.group || '기타', items: [] }; groups.push(g); }
      g.items.push(p);
    });
    return groups;
  }
  function addPreset(group, text) {
    const max = presets().reduce(function (m, p) { return Math.max(m, p.order || 0); }, 0);
    return DN.Store.add(PRE, { group: String(group || '기타').trim() || '기타', label: String(text).trim(), order: max + 1 });
  }
  function updatePreset(id, patch) { return DN.Store.update(PRE, id, patch); }
  function removePreset(id) { return DN.Store.update(PRE, id, { deleted: true }); }
  // 같은 무리 안에서 한 칸 위/아래로
  function movePreset(id, dir) {
    const list = presets();
    const i = list.findIndex(function (p) { return p.id === id; });
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length || list[j].group !== list[i].group) return false;
    const a = list[i], b = list[j];
    DN.Store.batch(PRE, { update: [{ id: a.id, patch: { order: b.order } }, { id: b.id, patch: { order: a.order } }] });
    return true;
  }

  // ── 관찰 기록 ──
  // 여러 학생에게 같은 상황을 한 번에 기록. label은 저장 시점의 버튼 문구를 그대로 복사
  // 다툼·놀림 같은 갈등 상황을 여러 명 함께 고르면 서로 “함께(with)”로 묶어 둔다 → 자리·모둠에서 떼어 놓기 추천
  // cls: 수업 반 id (없으면 우리 반)
  function addObservations(date, nos, preset, memo, cls) {
    const dev = device();
    // 함께 고른 학생 + 직접 쓴 글의 “7번” (갈등 상황일 때만)
    const others = isConflictLabel(preset.label) ? nos.concat(mentionedNos(preset.label)) : [];
    return DN.Store.batch(OBS, { add: nos.map(function (no) {
      const r = { date: date, studentNo: no, presetId: preset.id, label: preset.label, memo: memo || '', device: dev };
      if (cls) r.cls = cls;
      const w = others.filter(function (x, i) { return x !== no && others.indexOf(x) === i; });
      if (w.length) r.with = w;
      return r;
    }) }) || [];
  }
  function updateObservation(id, patch) { return DN.Store.update(OBS, id, patch); }
  function removeRecords(col, ids) {
    return DN.Store.batch(col, { update: ids.map(function (id) { return { id: id, patch: { deleted: true } }; }) });
  }
  // cls: 생략·''이면 우리 반 기록만, 수업 반 id면 그 반만, '*'이면 전부
  function observations(from, to, cls) {
    const c = cls || '';
    return DN.Store.query(OBS, function (r) {
      return alive(r) && (!from || r.date >= from) && (!to || r.date <= to) && (c === '*' || (r.cls || '') === c);
    }).sort(byDateNo);
  }
  // { 번호: 건수 }
  function countByStudent(list) {
    const out = {};
    list.forEach(function (r) { out[r.studentNo] = (out[r.studentNo] || 0) + 1; });
    return out;
  }
  // 상황별 개수 [{ label, group, count }] — 무리는 현재 버튼 기준(버튼이 없어졌으면 '기타')
  // 버튼에 없는 내용을 직접 써서 기록 (예: 5번 → “7번 학생을 때림”). 글이 곧 상황 문구가 된다
  function addFreeObservations(date, nos, text, cls) {
    const t = String(text || '').trim().slice(0, 60);
    if (!t) return [];
    return addObservations(date, nos, { id: '', label: t }, '', cls);
  }

  // 관찰 기록에서 함께 다툰 두 학생 쌍: [{ a, b, count, last, labels }] (a < b, 많이·최근 순)
  function conflictPairs() {
    const map = {}, seen = {};
    observations().forEach(function (r) {
      if (!Array.isArray(r.with) || !isConflictLabel(r.label)) return;
      r.with.forEach(function (o) {
        const a = Math.min(r.studentNo, o), b = Math.max(r.studentNo, o);
        if (a === b) return;
        const k = a + '-' + b;
        // 함께 골라 저장한 한 번의 기록은 두 학생 모두에게 남으므로 한 번만 센다
        const once = k + '|' + r.date + '|' + r.label + '|' + r.createdAt;
        if (seen[once]) return;
        seen[once] = true;
        const e = map[k] || (map[k] = { a: a, b: b, count: 0, last: '', labels: [] });
        e.count++;
        if (r.date > e.last) e.last = r.date;
        if (e.labels.indexOf(r.label) < 0) e.labels.push(r.label);
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (x, y) { return (y.count - x.count) || (y.last > x.last ? 1 : y.last < x.last ? -1 : 0); });
  }

  function countByLabel(list) {
    const groupOf = {};
    DN.Store.getAll(PRE).forEach(function (p) { groupOf[p.id] = p.group; });
    const map = {};
    list.forEach(function (r) {
      const k = r.label;
      if (!map[k]) map[k] = { label: k, group: groupOf[r.presetId] || (r.presetId ? '기타' : '직접'), count: 0 };
      map[k].count++;
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.count - a.count || (a.label < b.label ? -1 : 1); });
  }

  // 통지표 작성 참고용 복사 글 (한글에 붙여 넣기 좋은 줄글 형식)
  // cls를 주면 그 수업 반 기록으로 (교과 평가 참고용)
  function copyText(no, from, to, names, cls) {
    const list = observations(from, to, cls).filter(function (r) { return r.studentNo === no; });
    const md = function (d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8)); };
    const head = cls ? className(cls) + ' ' + label(no, names || nameMap(cls)) + ' 수업 관찰 (교과 평가 참고)' : label(no, names) + ' 관찰 기록';
    const lines = [head + ' (' + (from ? md(from) : '처음') + ' ~ ' + (to ? md(to) : '지금') + ', ' + list.length + '건)'];
    const groups = {};
    countByLabel(list).forEach(function (c) { (groups[c.group] = groups[c.group] || []).push(c.label + ' ' + c.count + '회'); });
    Object.keys(groups).forEach(function (g) { lines.push('[' + g + '] ' + groups[g].join(', ')); });
    if (list.length) lines.push('');
    list.forEach(function (r) { lines.push('- ' + md(r.date) + ' ' + r.label + (r.memo ? ' — ' + r.memo : '')); });
    return lines.join('\r\n');
  }

  // 엑셀로 받기용 표 (번호 → 날짜 순). 첫 줄은 제목 줄
  function observationRows(from, to, names, cls) {
    const groupOf = {};
    DN.Store.getAll(PRE).forEach(function (p) { groupOf[p.id] = p.group; });
    const map = names || nameMap(cls);
    const list = observations(from, to, cls).slice().sort(function (a, b) {
      return (a.studentNo - b.studentNo) || (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt < b.createdAt ? -1 : 1));
    });
    return [['번호', '이름', '날짜', '요일', '무리', '상황', '메모', '함께 (번호)', '기록한 곳']].concat(list.map(function (r) {
      return [r.studentNo, map[r.studentNo] || '', r.date, DN.Events.weekdayOf(r.date),
        groupOf[r.presetId] || (r.presetId ? '기타' : '직접'), r.label, r.memo || '',
        Array.isArray(r.with) ? r.with.map(function (n) { return n + '번'; }).join(', ') : '',
        r.device === 'mobile' ? '핸드폰' : 'PC'];
    }));
  }

  function attendanceRows(from, to, names) {
    const map = names || nameMap();
    const list = attendance(from, to).slice().sort(function (a, b) {
      return (a.studentNo - b.studentNo) || (a.date < b.date ? -1 : a.date > b.date ? 1 : TYPES.indexOf(a.type) - TYPES.indexOf(b.type));
    });
    return [['번호', '이름', '날짜', '요일', '유형', '교시', '사유', '메모', '기록한 곳']].concat(list.map(function (r) {
      return [r.studentNo, map[r.studentNo] || '', r.date, DN.Events.weekdayOf(r.date), r.type, r.period ? r.period + '교시' : '', r.reason, r.memo || '',
        r.device === 'mobile' ? '핸드폰' : 'PC'];
    }));
  }
  // 표(첫 줄 제목) → 엑셀에서 한글이 깨지지 않는 CSV (BOM)
  function toCsv(rows) {
    return String.fromCharCode(0xFEFF) + rows.map(function (row) { return row.map(DN.Backup.csvCell).join(','); }).join(String.fromCharCode(13, 10));
  }

  // ── 출결 메모 ──
  // 같은 날·같은 학생·같은 유형이면 덮어쓰고, 없으면 새로 만든다. 결과: 저장된 건수
  function saveAttendance(date, nos, type, reason, memo, period) {
    const dev = device();
    const existing = DN.Store.query(ATT, function (r) { return alive(r) && r.date === date && r.type === type; });
    const add = [], update = [];
    nos.forEach(function (no) {
      const old = existing.find(function (r) { return r.studentNo === no; });
      const fields = { reason: reason, memo: memo || '', period: cleanPeriod(type, period), device: dev };
      if (old) update.push({ id: old.id, patch: fields });
      else add.push(Object.assign({ date: date, studentNo: no, type: type }, fields));
    });
    return DN.Store.batch(ATT, { add: add, update: update }) ? nos.length : 0;
  }
  function updateAttendance(id, patch) { return DN.Store.update(ATT, id, patch); }
  function attendance(from, to) {
    return DN.Store.query(ATT, function (r) {
      return alive(r) && (!from || r.date >= from) && (!to || r.date <= to);
    }).sort(byDateNo);
  }
  function monthRange(ym) {
    const y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    return { from: ym + '-01', to: ym + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0') };
  }
  // 월말 요약: [{ no, counts: { 결석: { total, 질병, 미인정, ... }, ... }, total }]
  function monthSummary(ym) {
    const r = monthRange(ym);
    const by = {};
    attendance(r.from, r.to).forEach(function (a) {
      const s = by[a.studentNo] = by[a.studentNo] || { no: a.studentNo, counts: {}, total: 0 };
      const c = s.counts[a.type] = s.counts[a.type] || { total: 0 };
      c.total++;
      c[a.reason || '기타'] = (c[a.reason || '기타'] || 0) + 1;
      s.total++;
    });
    return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a.no - b.no; });
  }
  // 나이스 대조용 복사 글: "5번 홍길동: 결석 2(질병 1·미인정 1), 지각 1(미인정 1)"
  function summaryText(ym, names) {
    const rows = monthSummary(ym);
    const lines = [(+ym.slice(5, 7)) + '월 출결 메모 요약 (나이스 입력 전 확인용)'];
    if (!rows.length) lines.push('기록 없음');
    rows.forEach(function (s) {
      lines.push(label(s.no, names) + ': ' + TYPES.filter(function (t) { return s.counts[t]; }).map(function (t) {
        const c = s.counts[t];
        return t + ' ' + c.total + '(' + REASONS.filter(function (x) { return c[x]; }).map(function (x) { return x + ' ' + c[x]; }).join('·') + ')';
      }).join(', '));
    });
    return lines.join('\r\n');
  }

  // 핸드폰에서 만든 기록 중 PC로 아직 보내지 않은 것 (sentAt 없음, 또는 보낸 뒤 고치거나 지움). 툼스톤도 보내야 하므로 포함
  function unsentRecords() {
    return [OBS, ATT, 'points', 'homework'].reduce(function (all, col) {
      return all.concat(DN.Store.query(col, function (r) {
        return r.device === 'mobile' && (!r.sentAt || r.updatedAt > r.sentAt);
      }));
    }, []);
  }
  function unsentCount() {
    return unsentRecords().filter(function (r) { return !r.deleted || r.sentAt; }).length;
  }

  // 학기 범위: 1학기 3/1~8/31, 2학기 9/1~다음 해 2월 말 (학년도 기준)
  function termRange(today, which) {
    const t = today || DN.Events.toStr(new Date());
    const y = +t.slice(0, 4), m = +t.slice(5, 7);
    const sy = m <= 2 ? y - 1 : y;
    const febEnd = function (yy) { return yy + '-02-' + String(new Date(yy, 2, 0).getDate()).padStart(2, '0'); };
    if (which === 'year') return { from: sy + '-03-01', to: febEnd(sy + 1) };
    if (m >= 3 && m <= 8) return { from: sy + '-03-01', to: sy + '-08-31' };
    return { from: sy + '-09-01', to: febEnd(sy + 1) };
  }

  return {
    classes, getClass, addClass, updateClass, removeClass, className, classNameMap, setClassNames,
    SUBJECT_PRESETS, usePresetSet, CLS, CLS_NAMES,
    TYPES, PERIOD_TYPES, PERIODS, cleanPeriod, typeText, TYPE_ABBR, REASONS, DEFAULT_PRESETS,
    studentNumbers, nameMap, label,
    presets, presetGroups, addPreset, updatePreset, removePreset, movePreset,
    addObservations, addFreeObservations, updateObservation, removeRecords, observations, countByStudent, countByLabel, copyText,
    isConflictLabel, conflictPairs, observationRows, attendanceRows, toCsv,
    saveAttendance, updateAttendance, attendance, monthRange, monthSummary, summaryText, termRange,
    unsentRecords, unsentCount,
    OBS, ATT, PRE,
  };
})();
