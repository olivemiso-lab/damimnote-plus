// ════════════════════════════════════════════════════
//  담임노트+ · 출결 메모 화면 (DN.Attend) — 명세 §5 attendance, §7.4
//  나이스 입력 전 확인용 메모. 사유는 분류만 저장(병명 등 구체적 사유 저장 자제 안내)
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Attend = (function () {
  const { esc, toast, confirmAsk, openModal, closeModal, copyText, today } = DN.utils;
  const R = DN.Records;
  const REASON_CLS = { '질병': 'r-ill', '미인정': 'r-un', '출석인정': 'r-ok', '기타': 'r-etc' };
  const NOTICE = '나이스 입력 전 확인용 메모이며, 공식 출결은 나이스에 입력하세요.';
  const MEMO_HINT = '병명 등 구체적인 사유는 적지 마세요. 분류(질병·미인정 등)만으로 충분해요.';

  let rootEl = null;
  const state = { date: today(), selected: new Set(), type: '', reason: '', memo: '', month: today().slice(0, 7) };

  function md(d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8)); }
  function segHtml(id, list, cur) {
    return '<span class="seg" id="' + id + '">' + list.map(function (v) {
      return '<button type="button" data-v="' + esc(v) + '" aria-pressed="' + (cur === v) + '">' + esc(v) + '</button>';
    }).join('') + '</span>';
  }

  function render(container) {
    rootEl = container;
    const y = +state.month.slice(0, 4), m = +state.month.slice(5, 7);
    container.innerHTML = '\
      <div class="page-head"><h1>🗓️ 출결 메모</h1></div>\
      <p class="notice">📌 ' + NOTICE + '</p>\
      <div class="card quick">\
        <div class="quick-head">\
          <h2 class="side-title">출결 메모 입력</h2>\
          <label class="quick-date">날짜 <input type="date" id="atDate" value="' + esc(state.date) + '"></label>\
        </div>\
        <div id="atPicker"></div>\
        <div class="at-choose">\
          <div class="at-line"><span class="at-lbl">유형</span>' + segHtml('atType', R.TYPES, state.type) + '</div>\
          <div class="at-line"><span class="at-lbl">사유</span>' + segHtml('atReason', R.REASONS, state.reason) + '</div>\
          <div class="at-line"><span class="at-lbl">메모</span><input type="text" id="atMemo" maxlength="40" placeholder="예: 보호자 연락함, 서류 받음" value="' + esc(state.memo) + '">\
            <span class="memo-hint">⚠ ' + MEMO_HINT + '</span></div>\
        </div>\
        <div class="at-save"><button class="btn-primary" id="atSave">저장</button></div>\
      </div>\
      <div class="card">\
        <div class="sc-bar">\
          <button class="btn-ghost sc-nav" id="atPrev" aria-label="이전 달">◀</button>\
          <strong class="sc-month">' + y + '년 ' + m + '월</strong>\
          <button class="btn-ghost sc-nav" id="atNext" aria-label="다음 달">▶</button>\
          <span class="pv-spacer"></span>\
          <span class="at-legend">' + R.REASONS.map(function (r) { return '<span class="at-mark ' + REASON_CLS[r] + '">' + esc(r) + '</span>'; }).join('') +
          '<span class="at-legend-t">결=결석 · 지=지각 · 조=조퇴 · 과=결과</span></span>\
        </div>\
        <div class="pv-scroll" id="atTable"></div>\
        <p class="set-help">칸을 누르면 그 날·그 학생의 출결 메모를 고치거나 새로 넣을 수 있어요.</p>\
      </div>\
      <div class="card">\
        <div class="side-head"><h2 class="side-title">' + m + '월 요약 (나이스 마감 대조용)</h2>\
          <button class="btn-secondary side-add" id="atCopy">📋 요약 복사</button></div>\
        <div id="atSummary"></div>\
      </div>';

    const pick = container.querySelector('#atPicker');
    pick.innerHTML = DN.Picker.html(state.selected);
    DN.Picker.bind(pick, state.selected);
    bindSeg('#atType', 'type');
    bindSeg('#atReason', 'reason');
    renderTable();
    renderSummary();

    const q = function (s) { return container.querySelector(s); };
    q('#atDate').addEventListener('change', function (e) { state.date = e.target.value || today(); });
    q('#atMemo').addEventListener('input', function (e) { state.memo = e.target.value; });
    q('#atSave').addEventListener('click', save);
    const move = function (d) {
      const dt = new Date(y, m - 1 + d, 1);
      state.month = DN.Events.toStr(dt).slice(0, 7);
      render(container);
    };
    q('#atPrev').addEventListener('click', function () { move(-1); });
    q('#atNext').addEventListener('click', function () { move(1); });
    q('#atCopy').addEventListener('click', function () {
      copyText(R.summaryText(state.month, R.nameMap())).then(function (ok) {
        toast(ok ? '요약을 복사했어요.' : '복사하지 못했어요.', ok ? 'success' : 'error');
      });
    });
  }

  function bindSeg(sel, key) {
    const seg = rootEl.querySelector(sel);
    seg.addEventListener('click', function (e) {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      state[key] = state[key] === b.dataset.v ? '' : b.dataset.v;
      seg.querySelectorAll('[data-v]').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.v === state[key])); });
    });
  }

  function save() {
    if (!state.selected.size) { toast('학생 번호를 골라 주세요.', 'info'); return; }
    if (!state.type) { toast('유형(결석·지각·조퇴·결과)을 골라 주세요.', 'info'); return; }
    if (!state.reason) { toast('사유(질병·미인정·출석인정·기타)를 골라 주세요.', 'info'); return; }
    if (!DN.Events.isDate(state.date)) { toast('날짜를 확인해 주세요.', 'error'); return; }
    const nos = Array.from(state.selected).sort(function (a, b) { return a - b; });
    if (!R.saveAttendance(state.date, nos, state.type, state.reason, state.memo.trim())) {
      toast('저장하지 못했어요. 저장 공간을 확인해 주세요.', 'error');
      return;
    }
    toast(DN.Picker.listText(nos) + ' · ' + md(state.date) + ' ' + state.reason + ' ' + state.type + ' 저장됨', 'success');
    state.selected.clear();
    state.memo = '';
    state.month = state.date.slice(0, 7);
    render(rootEl);
  }

  // ── 월별 표: 학생(행) × 날짜(열) ──
  function renderTable() {
    const r = R.monthRange(state.month);
    const days = +r.to.slice(8);
    const recs = R.attendance(r.from, r.to);
    const cell = {};
    recs.forEach(function (a) { (cell[a.studentNo + '|' + a.date] = cell[a.studentNo + '|' + a.date] || []).push(a); });
    const holidays = {};
    DN.Events.live().forEach(function (e) {
      if (e.kind !== 'holiday') return;
      for (let d = e.date; d <= DN.Events.endOf(e); d = DN.Events.addDays(d, 1)) holidays[d] = true;
    });
    const names = R.nameMap();
    const dates = [];
    for (let i = 1; i <= days; i++) dates.push(state.month + '-' + String(i).padStart(2, '0'));
    const off = function (d) { const w = new Date(d + 'T00:00:00').getDay(); return w === 0 || w === 6 || holidays[d]; };
    const head = '<tr><th class="at-stu">학생</th>' + dates.map(function (d) {
      return '<th class="' + (off(d) ? 'off' : '') + (d === today() ? ' today' : '') + '">' + (+d.slice(8)) + '<small>' + DN.Events.weekdayOf(d) + '</small></th>';
    }).join('') + '</tr>';
    const body = R.studentNumbers().map(function (n) {
      return '<tr><th class="at-stu">' + n + ' <small>' + esc(names[n] || '') + '</small></th>' + dates.map(function (d) {
        const list = cell[n + '|' + d] || [];
        return '<td class="' + (off(d) ? 'off' : '') + '"><button class="at-cell" data-no="' + n + '" data-date="' + d + '" aria-label="' + esc(n + '번 ' + md(d)) + '">' +
          list.map(function (a) {
            return '<span class="at-mark ' + (REASON_CLS[a.reason] || 'r-etc') + '" title="' + esc(a.reason + ' ' + a.type + (a.memo ? ' — ' + a.memo : '')) + '">' + esc(R.TYPE_ABBR[a.type] || '?') + '</span>';
          }).join('') + '</button></td>';
      }).join('') + '</tr>';
    }).join('');
    const box = rootEl.querySelector('#atTable');
    box.innerHTML = '<table class="at-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
    box.addEventListener('click', function (e) {
      const b = e.target.closest('.at-cell');
      if (b) openCell(+b.dataset.no, b.dataset.date);
    });
  }

  // 표 칸 → 그 날·그 학생 출결 메모 편집 창
  function openCell(no, date) {
    const list = R.attendance(date, date).filter(function (a) { return a.studentNo === no; });
    const rows = list.map(function (a) {
      return '<div class="at-edit" data-id="' + esc(a.id) + '">' +
        '<select data-f="type">' + R.TYPES.map(function (t) { return '<option' + (t === a.type ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>' +
        '<select data-f="reason">' + R.REASONS.map(function (t) { return '<option' + (t === a.reason ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>' +
        '<input data-f="memo" maxlength="40" value="' + esc(a.memo || '') + '" placeholder="메모">' +
        '<button class="ic del" data-atdel="' + esc(a.id) + '" aria-label="삭제">✕</button></div>';
    }).join('');
    const body = '<p class="notice small">📌 ' + NOTICE + '</p>' +
      (rows || '<p class="side-empty">이 날 기록이 없어요.</p>') +
      '<div class="section-label">새로 넣기</div>' +
      '<div class="at-edit new"><select id="nType">' + R.TYPES.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select>' +
      '<select id="nReason">' + R.REASONS.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select>' +
      '<input id="nMemo" maxlength="40" placeholder="메모 (선택)"><button class="btn-primary" id="nAdd">넣기</button></div>' +
      '<p class="memo-hint">⚠ ' + MEMO_HINT + '</p>';
    const m = openModal(R.label(no) + ' · ' + md(date) + ' (' + DN.Events.weekdayOf(date) + ')', body,
      '<span class="pv-spacer"></span><button class="btn-primary" data-close>닫기</button>');
    m.addEventListener('change', function (e) {
      const f = e.target.dataset && e.target.dataset.f;
      const row = e.target.closest('.at-edit[data-id]');
      if (!f || !row) return;
      const patch = {};
      patch[f] = f === 'memo' ? e.target.value.trim() : e.target.value;
      R.updateAttendance(row.dataset.id, patch);
      toast('고쳤어요.', 'success');
    });
    m.addEventListener('click', function (e) {
      const del = e.target.closest('[data-atdel]');
      if (del && confirmAsk('이 출결 메모를 지울까요?')) {
        R.removeRecords(R.ATT, [del.dataset.atdel]);
        closeModal();
        render(rootEl);
        return;
      }
      if (e.target.closest('#nAdd')) {
        R.saveAttendance(date, [no], m.querySelector('#nType').value, m.querySelector('#nReason').value, m.querySelector('#nMemo').value.trim());
        closeModal();
        toast('저장했어요.', 'success');
        render(rootEl);
        return;
      }
      if (e.target.closest('[data-close]')) render(rootEl);
    });
  }

  // ── 월말 요약 ──
  function renderSummary() {
    const rows = R.monthSummary(state.month);
    const names = R.nameMap();
    const box = rootEl.querySelector('#atSummary');
    if (!rows.length) { box.innerHTML = '<p class="side-empty">이 달 출결 메모가 없어요.</p>'; return; }
    const cellText = function (c) {
      if (!c) return '<span class="zero">0</span>';
      return '<b>' + c.total + '</b><small>' + R.REASONS.filter(function (x) { return c[x]; }).map(function (x) { return x + ' ' + c[x]; }).join('·') + '</small>';
    };
    box.innerHTML = '<div class="pv-scroll"><table class="sum-table"><thead><tr><th>학생</th>' +
      R.TYPES.map(function (t) { return '<th>' + t + '</th>'; }).join('') + '<th>합계</th></tr></thead><tbody>' +
      rows.map(function (s) {
        return '<tr><th>' + esc(R.label(s.no, names)) + '</th>' + R.TYPES.map(function (t) { return '<td>' + cellText(s.counts[t]) + '</td>'; }).join('') +
          '<td><b>' + s.total + '</b></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  return { render };
})();
