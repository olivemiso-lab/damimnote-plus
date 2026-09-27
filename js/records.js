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
  const REASONS = ['질병', '미인정', '출석인정', '기타'];
  // 기본 관찰 상황 (명세 §5 — 관찰된 행동 중심 문구)
  const DEFAULT_PRESETS = [
    ['참여', '발표·질문'], ['참여', '새로운 생각 제시'], ['참여', '끝까지 해결 시도'],
    ['관계', '친구 도움'], ['관계', '모둠 활동 조율'], ['관계', '갈등 조정 필요'],
    ['태도', '과제 성실'], ['태도', '과제 미제출'], ['태도', '수업 집중 어려움'], ['태도', '규칙 지키기'],
  ];

  function alive(r) { return !r.deleted; }
  function byDateNo(a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.studentNo - b.studentNo) || (a.createdAt < b.createdAt ? -1 : 1);
  }
  function device() { return DN.Settings.get().deviceRole === 'mobile' ? 'mobile' : 'pc'; }

  // ── 학생 번호 · 이름 ──
  // 번호 버튼 개수: 설정의 학생 수와 명단의 가장 큰 번호 중 큰 쪽
  function studentNumbers() {
    const maxRoster = DN.Store.getAll('students').reduce(function (m, s) { return Math.max(m, parseInt(s.number, 10) || 0); }, 0);
    const n = Math.max(DN.Settings.get().studentCount || 0, maxRoster);
    const out = [];
    for (let i = 1; i <= n; i++) out.push(i);
    return out;
  }
  // { 번호: 이름 } — 명단이 없으면 빈 객체
  function nameMap() {
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
      all = DN.Store.getAll(PRE);
    }
    return all.filter(alive).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
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
  function addObservations(date, nos, preset, memo) {
    const dev = device();
    return DN.Store.batch(OBS, { add: nos.map(function (no) {
      return { date: date, studentNo: no, presetId: preset.id, label: preset.label, memo: memo || '', device: dev };
    }) }) || [];
  }
  function updateObservation(id, patch) { return DN.Store.update(OBS, id, patch); }
  function removeRecords(col, ids) {
    return DN.Store.batch(col, { update: ids.map(function (id) { return { id: id, patch: { deleted: true } }; }) });
  }
  function observations(from, to) {
    return DN.Store.query(OBS, function (r) {
      return alive(r) && (!from || r.date >= from) && (!to || r.date <= to);
    }).sort(byDateNo);
  }
  // { 번호: 건수 }
  function countByStudent(list) {
    const out = {};
    list.forEach(function (r) { out[r.studentNo] = (out[r.studentNo] || 0) + 1; });
    return out;
  }
  // 상황별 개수 [{ label, group, count }] — 무리는 현재 버튼 기준(버튼이 없어졌으면 '기타')
  function countByLabel(list) {
    const groupOf = {};
    DN.Store.getAll(PRE).forEach(function (p) { groupOf[p.id] = p.group; });
    const map = {};
    list.forEach(function (r) {
      const k = r.label;
      if (!map[k]) map[k] = { label: k, group: groupOf[r.presetId] || '기타', count: 0 };
      map[k].count++;
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.count - a.count || (a.label < b.label ? -1 : 1); });
  }

  // 통지표 작성 참고용 복사 글 (한글에 붙여 넣기 좋은 줄글 형식)
  function copyText(no, from, to, names) {
    const list = observations(from, to).filter(function (r) { return r.studentNo === no; });
    const md = function (d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8)); };
    const lines = [label(no, names) + ' 관찰 기록 (' + (from ? md(from) : '처음') + ' ~ ' + (to ? md(to) : '지금') + ', ' + list.length + '건)'];
    const groups = {};
    countByLabel(list).forEach(function (c) { (groups[c.group] = groups[c.group] || []).push(c.label + ' ' + c.count + '회'); });
    Object.keys(groups).forEach(function (g) { lines.push('[' + g + '] ' + groups[g].join(', ')); });
    if (list.length) lines.push('');
    list.forEach(function (r) { lines.push('- ' + md(r.date) + ' ' + r.label + (r.memo ? ' — ' + r.memo : '')); });
    return lines.join('\r\n');
  }

  // ── 출결 메모 ──
  // 같은 날·같은 학생·같은 유형이면 덮어쓰고, 없으면 새로 만든다. 결과: 저장된 건수
  function saveAttendance(date, nos, type, reason, memo) {
    const dev = device();
    const existing = DN.Store.query(ATT, function (r) { return alive(r) && r.date === date && r.type === type; });
    const add = [], update = [];
    nos.forEach(function (no) {
      const old = existing.find(function (r) { return r.studentNo === no; });
      const fields = { reason: reason, memo: memo || '', device: dev };
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
    return [OBS, ATT].reduce(function (all, col) {
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
    TYPES, TYPE_ABBR, REASONS, DEFAULT_PRESETS,
    studentNumbers, nameMap, label,
    presets, presetGroups, addPreset, updatePreset, removePreset, movePreset,
    addObservations, updateObservation, removeRecords, observations, countByStudent, countByLabel, copyText,
    saveAttendance, updateAttendance, attendance, monthRange, monthSummary, summaryText, termRange,
    unsentRecords, unsentCount,
    OBS, ATT, PRE,
  };
})();
