// ════════════════════════════════════════════════════
//  담임노트+ · 학교 일정 모듈 (DN.Schedule)
//  투게더 월중행사 가져오기 → 미리보기(수정) → 교사 확정 후 등록 (명세 §6)
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Schedule = (function () {
  const { esc, toast, confirmAsk } = DN.utils;
  const T = DN.Together;
  const COL = 'events';
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const KIND_T = { event: '행사', holiday: '휴일', deadline: '제출 마감' };
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  let rootEl = null;
  let preview = null;         // { fileName, tbl, conv, rows, myGradeOnly }

  function weekdayOf(date) { return WEEKDAYS[new Date(date + 'T00:00:00').getDay()]; }

  // ── kordoc(한글 파일 해석기) — 필요할 때만 불러온다 (약 650KB) ──
  let kordocPromise = null;
  function loadKordoc() {
    if (window.KordocBundle) return Promise.resolve(window.KordocBundle);
    if (kordocPromise) return kordocPromise;
    kordocPromise = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = 'js/vendor/kordoc.browser.js';
      s.onload = function () {
        if (window.KordocBundle) resolve(window.KordocBundle);
        else reject(new Error('한글 파일 해석기를 불러오지 못했어요.'));
      };
      s.onerror = function () { reject(new Error('한글 파일 해석기(js/vendor/kordoc.browser.js)를 찾을 수 없어요.')); };
      document.head.appendChild(s);
    });
    kordocPromise.catch(function () { kordocPromise = null; });
    return kordocPromise;
  }

  // .hwp(OLE, D0 CF 11 E0) / .hwpx(ZIP, PK) 를 파일 앞부분으로 구분
  function parseHangul(buf) {
    const b = new Uint8Array(buf.slice(0, 4));
    return loadKordoc().then(function (K) {
      if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return K.parseHwp(buf);
      if (b[0] === 0x50 && b[1] === 0x4B) return K.parseHwpx(buf);
      throw new Error('한글(.hwp, .hwpx) 파일이 아니에요.');
    }).then(function (r) {
      if (!r || !r.success) throw new Error('한글 파일을 읽지 못했어요. 한글에서 “다른 이름으로 저장 → .hwpx”로 저장해 다시 올려 보세요.');
      return r.blocks;
    });
  }

  // ── 가져오기 ──
  function importFile(file) {
    if (!/\.(hwp|hwpx)$/i.test(file.name)) { toast('한글 파일(.hwp, .hwpx)을 선택해 주세요.', 'error'); return; }
    if (file.size > MAX_FILE_BYTES) { toast('파일이 너무 커요(20MB 초과). 월중행사 파일이 맞는지 확인해 주세요.', 'error'); return; }
    toast('월중행사 파일을 읽는 중이에요…', 'info');
    file.arrayBuffer().then(parseHangul).then(function (blocks) {
      const tbl = T.extractTable(blocks);
      if (tbl.error) throw new Error(tbl.error + ' 이지에듀 투게더에서 내려받은 월중행사 파일인지 확인해 주세요.');
      startPreview(file.name, tbl, {});
    }).catch(function (e) {
      toast((e && e.message) || '파일을 읽지 못했어요.', 'error');
    });
  }

  function startPreview(fileName, tbl, pick) {
    const s = DN.Settings.get();
    const conv = T.convert(tbl, { month: pick.month, schoolYear: pick.schoolYear, teacherName: s.teacherName, grade: s.grade });
    preview = {
      fileName: fileName, tbl: tbl, conv: conv,
      rows: conv.events.map(function (e) { return Object.assign({}, e, { removed: false }); }),
      myGradeOnly: preview ? preview.myGradeOnly : false,
      showEnd: {},   // 종료일 칸을 펼친 행 (화면용)
    };
    render(rootEl);
  }

  // ── 재가져오기 계획 (명세 §6.8) ──
  // 같은 importKey의 투게더 일정만 교체. 날짜 + 정규화 제목이 같으면 기존 레코드(id)를 그대로 두고
  // done·attachmentIds·note를 이어받는다. 새 파일에 없는 기존 일정은 툼스톤(deleted) 처리.
  function planImport(existing, incoming) {
    const pool = {};
    existing.forEach(function (e) {
      const k = e.date + '|' + T.normTitle(e.title);
      (pool[k] = pool[k] || []).push(e);
    });
    const add = [];
    const update = [];
    let carried = 0;
    incoming.forEach(function (n) {
      const k = n.date + '|' + T.normTitle(n.title);
      const old = pool[k] && pool[k].shift();
      if (!old) { add.push(n); return; }
      carried++;
      update.push({ id: old.id, patch: Object.assign({}, n, {
        done: !!old.done,
        attachmentIds: old.attachmentIds || [],
        note: old.note || n.note || '',
        deleted: false,
      }) });
    });
    Object.keys(pool).forEach(function (k) {
      pool[k].forEach(function (old) { update.push({ id: old.id, patch: { deleted: true } }); });
    });
    return { add: add, update: update, carried: carried, removed: update.length - carried };
  }

  // 미리보기 행 → 저장할 레코드 (보조 필드 제거)
  function toRecord(r) {
    const rec = Object.assign({}, r);
    delete rec.removed;
    delete rec.reviewReason;
    return rec;
  }

  function validRows() {
    const errors = [];
    const rows = preview.rows.filter(function (r) { return !r.removed; });
    rows.forEach(function (r, i) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) errors.push('날짜 없음: ' + r.title);
      else if (r.endDate && r.endDate <= r.date) errors.push('종료일이 시작일보다 빨라요: ' + r.title);
      if (!String(r.title).trim()) errors.push((i + 1) + '번째 행의 행사 이름이 비어 있어요');
    });
    return { rows: rows, errors: errors };
  }

  function commit() {
    const v = validRows();
    if (v.errors.length) {
      toast('확인이 필요한 행이 ' + v.errors.length + '개 있어요 — ' + v.errors[0], 'error');
      return;
    }
    if (!v.rows.length) { toast('등록할 일정이 없어요.', 'info'); return; }
    const key = preview.conv.importKey;
    const month = preview.conv.month;
    const existing = DN.Store.query(COL, function (e) {
      return e.source === 'together' && e.importKey === key && !e.deleted;
    });
    if (existing.length && !confirmAsk(month + '월 투게더 일정을 새 파일로 교체할까요? 직접 입력한 일정과 첨부 파일은 유지됩니다.')) return;
    const plan = planImport(existing, v.rows.map(toRecord));
    const saved = DN.Store.batch(COL, { add: plan.add, update: plan.update });
    if (!saved) { toast('저장 공간이 부족해 등록하지 못했어요.', 'error'); return; }
    toast(month + '월 일정 ' + v.rows.length + '건을 등록했어요' +
      (existing.length ? ' (기존 ' + plan.carried + '건 완료·첨부·메모 이어받음)' : '') + '.', 'success');
    DN.ScheduleView.setMonth(key);
    preview = null;
    render(rootEl);
    if (DN.App) DN.App.refreshBanner();
  }

  // ── 미리보기 화면 ──
  function isMyGradeRow(r, grade) { return r.grades.length === 0 || r.grades.indexOf(grade) >= 0; }

  function summaryText() {
    const s = DN.Settings.get();
    const st = T.stats(preview.rows.filter(function (r) { return !r.removed; }), s.grade);
    return '행사 ' + st.total + '건 · 휴일 ' + st.holidays + '일 · 우리 학년(' + s.grade + '학년) 관련 ' + st.related +
      '건 · 내 담당 ' + (s.teacherName ? st.mine + '건' : '— (설정에 이름 없음)') + ' · 검토 필요 ' + st.review + '건';
  }

  function renderPreview(container) {
    const s = DN.Settings.get();
    const c = preview.conv;
    const monthOpts = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2].map(function (m) {
      return '<option value="' + m + '"' + (m === c.month ? ' selected' : '') + '>' + m + '월</option>';
    }).join('');
    container.innerHTML = '\
      <div class="page-head"><h1>📅 월중행사 미리보기</h1></div>\
      <div class="card">\
        <div class="pv-top">\
          <div class="pv-file">📄 ' + esc(preview.fileName) + '</div>\
          <label>학년도 <input type="number" id="pvYear" min="2000" max="2100" value="' + esc(c.schoolYear || s.schoolYear) + '"></label>\
          <label>월 <select id="pvMonth"><option value="">선택</option>' + monthOpts + '</select></label>\
        </div>' +
        (c.needPick ? '<p class="pv-warn">파일에서 학년도나 월을 찾지 못했어요. 위에서 직접 골라 주세요.</p>' : '') + '\
        <p class="pv-sum" id="pvSum"></p>\
        <div class="pv-bar">\
          <label class="pv-toggle"><input type="checkbox" id="pvMine"' + (preview.myGradeOnly ? ' checked' : '') + '> 우리 학년만 보기</label>\
          <span class="pv-legend"><span class="pv-dot review"></span>검토 필요 <span class="pv-dot holiday"></span>휴일</span>\
          <span class="pv-spacer"></span>\
          <button class="btn-cancel" id="pvCancel">취소</button>\
          <button class="btn-primary" id="pvCommit"' + (c.importKey ? '' : ' disabled') + '>모두 등록</button>\
        </div>\
        <p class="pv-help">모든 칸을 바로 고칠 수 있어요. 학년은 “3,4”처럼 쓰고, 비우면 전체 대상이에요. 원문은 행사 칸에 마우스를 올리면 보여요.</p>\
        <div class="pv-scroll"><table class="pv-table">\
          <thead><tr><th>날짜</th><th>행사</th><th>담당</th><th>시간</th><th>장소</th><th>학년</th><th>종류</th><th></th></tr></thead>\
          <tbody id="pvBody"></tbody>\
        </table></div>\
      </div>';

    renderRows();
    container.querySelector('#pvSum').textContent = summaryText();

    const rePick = function () {
      const y = parseInt(container.querySelector('#pvYear').value, 10);
      const m = parseInt(container.querySelector('#pvMonth').value, 10);
      if (!y || !m) return;
      startPreview(preview.fileName, preview.tbl, { schoolYear: y, month: m });
      toast('학년도·월을 바꿔 다시 변환했어요. 표에서 고친 내용은 처음 상태로 돌아갔어요.', 'info');
    };
    container.querySelector('#pvYear').addEventListener('change', rePick);
    container.querySelector('#pvMonth').addEventListener('change', rePick);
    container.querySelector('#pvMine').addEventListener('change', function (e) {
      preview.myGradeOnly = e.target.checked;
      renderRows();
    });
    container.querySelector('#pvCancel').addEventListener('click', function () {
      if (!confirmAsk('가져오기를 취소할까요? 미리보기에서 고친 내용은 저장되지 않아요.')) return;
      preview = null;
      render(container);
    });
    container.querySelector('#pvCommit').addEventListener('click', commit);

    const body = container.querySelector('#pvBody');
    body.addEventListener('input', onCellEdit);
    body.addEventListener('change', onCellEdit);
    body.addEventListener('click', function (e) {
      const add = e.target.closest('.pv-addend');
      if (add) {
        preview.showEnd[+add.dataset.i] = true;
        renderRows();
        const input = body.querySelector('input[data-f="endDate"][data-i="' + add.dataset.i + '"]');
        if (input) input.focus();
        return;
      }
      const btn = e.target.closest('.pv-del');
      if (!btn) return;
      const r = preview.rows[+btn.dataset.i];
      r.removed = !r.removed;
      renderRows();
      rootEl.querySelector('#pvSum').textContent = summaryText();
    });
  }

  function renderRows() {
    const grade = DN.Settings.get().grade;
    const body = rootEl.querySelector('#pvBody');
    body.innerHTML = preview.rows.map(function (r, i) {
      if (preview.myGradeOnly && !isMyGradeRow(r, grade)) return '';
      const cls = [r.removed ? 'removed' : '', r.needsReview ? 'review' : '', r.kind === 'holiday' ? 'holiday' : ''].join(' ');
      const inp = function (f, v, extra) {
        return '<input data-i="' + i + '" data-f="' + f + '" value="' + esc(v) + '"' + (extra || '') + (r.removed ? ' disabled' : '') + '>';
      };
      const kindOpts = Object.keys(KIND_T).map(function (k) {
        return '<option value="' + k + '"' + (r.kind === k ? ' selected' : '') + '>' + KIND_T[k] + '</option>';
      }).join('');
      return '<tr class="' + cls + '">' +
        '<td class="pv-date">' + inp('date', r.date, ' type="date"') +
          '<span class="pv-wd">' + (r.date ? esc(weekdayOf(r.date)) : '') + '</span>' +
          (r.endDate || preview.showEnd[i]
            ? '<div class="pv-end">~ ' + inp('endDate', r.endDate, ' type="date"') + '</div>'
            : (r.removed ? '' : '<button class="pv-addend" data-i="' + i + '">+ 기간</button>')) + '</td>' +
        '<td class="pv-title">' + inp('title', r.title, ' title="원문: ' + esc(r.rawTitle) + '"') +
          (r.tags.length ? '<div class="pv-tags">' + r.tags.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
          (r.needsReview && r.reviewReason ? '<div class="pv-reason">⚠ ' + esc(r.reviewReason) + '</div>' : '') + '</td>' +
        '<td>' + inp('owner', r.owner) + '</td>' +
        '<td>' + inp('time', r.time) + '</td>' +
        '<td>' + inp('place', r.place) + '</td>' +
        '<td class="pv-grade">' + inp('grades', r.grades.join(',')) + '</td>' +
        '<td><select data-i="' + i + '" data-f="kind"' + (r.removed ? ' disabled' : '') + '>' + kindOpts + '</select></td>' +
        '<td><button class="ic pv-del" data-i="' + i + '" title="' + (r.removed ? '되살리기' : '이 행 빼기') + '">' + (r.removed ? '↺' : '✕') + '</button></td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="8" class="empty">표시할 행이 없어요.</td></tr>';
  }

  function onCellEdit(e) {
    const el = e.target;
    const f = el.dataset && el.dataset.f;
    if (!f) return;
    const r = preview.rows[+el.dataset.i];
    const v = el.value;
    if (f === 'grades') {
      r.grades = v.split(/[,\s]+/).map(Number).filter(function (g, i, a) { return g >= 1 && g <= 6 && a.indexOf(g) === i; }).sort();
    } else if (f === 'owner') {
      r.owner = v;
      const name = DN.Settings.get().teacherName.replace(/\s+/g, '');
      r.isMine = !!name && v.replace(/\s+/g, '').indexOf(name) >= 0;
    } else {
      r[f] = v;
    }
    if (f === 'date') {
      const wd = el.parentNode.querySelector('.pv-wd');
      if (wd) wd.textContent = /^\d{4}-\d{2}-\d{2}$/.test(v) ? weekdayOf(v) : '';
    }
    rootEl.querySelector('#pvSum').textContent = summaryText();
  }

  function render(container) {
    rootEl = container;
    if (preview) renderPreview(container);
    else DN.ScheduleView.render(container);
  }

  return { render, importFile, planImport, startPreview, commit, parseHangul, loadKordoc };
})();
