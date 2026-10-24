// ════════════════════════════════════════════════════
//  담임노트+ · 상세 기록 (DN.Logs) — 생활지도·다툼·욕설·쪽지·정리정돈 등을 사진·음성·동영상·문서와 함께 남긴다
//  logs { happenedAt('YYYY-MM-DDTHH:MM' 일어난 때), nos[번호], cat, text, attachments[], history[], archived, device }
//   · createdAt(처음 저장한 시각)은 바뀌지 않는다. 고치면 이전 내용을 history에 쌓는다
//   · 첨부마다 SHA-256 지문을 남겨, 나중에 파일이 처음과 같은지 확인할 수 있다
//   · 첨부가 있는 기록은 지우지 않고 보관만 한다
//   · 민감한 내용이라 구글 드라이브 동기화에는 넣지 않는다 (이 기기 + 백업 파일에만)
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Logs = (function () {
  const { esc, toast, confirmAsk, openModal, closeModal, copyText, today } = DN.utils;
  const COL = 'logs';
  const CATS = ['심각한 생활지도', '다툼·폭력', '욕설·언어', '쪽지·낙서', '정리정돈', '수업 태도', '안전사고', '상담·보호자 연락', '기타'];
  const KIND = { photo: '📷 사진', audio: '🎙️ 음성', video: '🎬 동영상', file: '📄 파일' };
  const BIG = 50 * 1024 * 1024, MAX = 1024 * 1024 * 1024;

  function alive(r) { return !r.deleted; }
  function device() { return DN.Settings.get().deviceRole === 'mobile' ? 'mobile' : 'pc'; }
  function nowLocal() {
    const d = new Date();
    return DN.Events.toStr(d) + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function kindOf(type) {
    const t = String(type || '');
    return /^image\//.test(t) ? 'photo' : /^audio\//.test(t) ? 'audio' : /^video\//.test(t) ? 'video' : 'file';
  }
  // 파일 지문 (SHA-256, 16진수). 브라우저가 지원하지 않으면 ''
  function sha256(blob) {
    if (!(window.crypto && crypto.subtle && blob && blob.arrayBuffer)) return Promise.resolve('');
    return blob.arrayBuffer().then(function (buf) { return crypto.subtle.digest('SHA-256', buf); }).then(function (h) {
      return Array.prototype.map.call(new Uint8Array(h), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }, function () { return ''; });
  }
  // 파일들 → 첨부 정보 (지문 계산 후 첨부 저장소에 넣는다)
  function storeFiles(files) {
    return files.reduce(function (p, f) {
      return p.then(function (out) {
        return sha256(f).then(function (hash) {
          return DN.Files.put(f).then(function (id) {
            out.push({ id: id, name: f.name || '파일', type: f.type || '', kind: kindOf(f.type), size: f.size || 0, sha256: hash, addedAt: new Date().toISOString() });
            return out;
          });
        });
      });
    }, Promise.resolve([]));
  }

  // ── 기록 ──
  function logs(filter) {
    const f = filter || {};
    return DN.Store.query(COL, function (r) {
      return alive(r) && (f.archived === undefined || !!r.archived === f.archived) &&
        (!f.no || (r.nos || []).indexOf(+f.no) >= 0) && (!f.cat || r.cat === f.cat) &&
        (!f.q || (r.text || '').indexOf(f.q) >= 0);
    }).sort(function (a, b) { return a.happenedAt < b.happenedAt ? 1 : a.happenedAt > b.happenedAt ? -1 : (a.createdAt < b.createdAt ? 1 : -1); });
  }
  function getLog(id) { return DN.Store.getAll(COL).find(function (r) { return r.id === id && alive(r); }) || null; }
  function cleanNos(nos) {
    return (nos || []).map(Number).filter(function (n, i, a) { return n >= 1 && n <= 99 && n % 1 === 0 && a.indexOf(n) === i; }).sort(function (a, b) { return a - b; });
  }
  // input: { happenedAt, nos, cat, text }, files: File[] → Promise<log>
  function addLog(input, files) {
    const text = String(input.text || '').trim().slice(0, 4000);
    if (!text && !(files && files.length)) return Promise.reject(new Error('내용을 쓰거나 파일을 붙여 주세요.'));
    return storeFiles(files || []).then(function (atts) {
      return DN.Store.add(COL, {
        happenedAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.happenedAt || '') ? input.happenedAt : nowLocal(),
        nos: cleanNos(input.nos), cat: CATS.indexOf(input.cat) >= 0 ? input.cat : '기타',
        text: text, attachments: atts, history: [], archived: false, device: device(),
      });
    });
  }
  // 고치기: 바뀐 것이 있으면 이전 내용을 history에 남긴다
  function editLog(id, patch) {
    const r = getLog(id);
    if (!r) return null;
    const next = {
      happenedAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(patch.happenedAt || '') ? patch.happenedAt : r.happenedAt,
      nos: patch.nos ? cleanNos(patch.nos) : r.nos,
      cat: CATS.indexOf(patch.cat) >= 0 ? patch.cat : r.cat,
      text: patch.text !== undefined ? String(patch.text).trim().slice(0, 4000) : r.text,
    };
    const same = next.happenedAt === r.happenedAt && next.cat === r.cat && next.text === r.text && next.nos.join() === (r.nos || []).join();
    if (same) return r;
    const prev = { editedAt: new Date().toISOString(), happenedAt: r.happenedAt, nos: r.nos, cat: r.cat, text: r.text };
    return DN.Store.update(COL, id, Object.assign(next, { history: (r.history || []).concat([prev]) }));
  }
  function note(r, text) { return (r.history || []).concat([{ editedAt: new Date().toISOString(), note: text }]); }
  function addFiles(id, files) {
    const r = getLog(id);
    if (!r) return Promise.reject(new Error('기록을 찾을 수 없어요.'));
    return storeFiles(files).then(function (atts) {
      const cur = getLog(id);
      return DN.Store.update(COL, id, {
        attachments: (cur.attachments || []).concat(atts),
        history: note(cur, '파일 더함: ' + atts.map(function (a) { return a.name; }).join(', ')),
      });
    });
  }
  // 잘못 붙인 파일 빼기 — 뺀 사실과 지문은 기록에 남는다
  function removeFile(id, fileId) {
    const r = getLog(id);
    const a = r && (r.attachments || []).find(function (x) { return x.id === fileId; });
    if (!a) return Promise.resolve(null);
    DN.Store.update(COL, id, {
      attachments: r.attachments.filter(function (x) { return x.id !== fileId; }),
      history: note(r, '파일 뺌: ' + a.name + (a.sha256 ? ' (지문 ' + a.sha256.slice(0, 12) + '…)' : '')),
    });
    return DN.Files.remove(fileId).catch(function () {});
  }
  function setArchived(id, on) {
    const r = getLog(id);
    if (!r || !!r.archived === !!on) return r;
    return DN.Store.update(COL, id, { archived: !!on, history: note(r, on ? '보관함' : '보관 풀기') });
  }
  // 첨부가 있으면 지우지 못한다 (보관만)
  function removeLog(id) {
    const r = getLog(id);
    if (!r) return false;
    if ((r.attachments || []).length) return false;
    return !!DN.Store.update(COL, id, { deleted: true });
  }
  // 새 학년: 지우지 않고 모두 보관
  function archiveAll() {
    const ids = logs({ archived: false }).map(function (r) { return r.id; });
    ids.forEach(function (id) { setArchived(id, true); });
    return ids.length;
  }
  // 지문 다시 계산해 처음과 같은지
  function verify(att) {
    return DN.Files.get(att.id).then(function (f) {
      if (!f) return { ok: false, why: '파일이 없어요' };
      return sha256(f.blob).then(function (h) {
        if (!h || !att.sha256) return { ok: false, why: '이 브라우저에서는 지문을 계산할 수 없어요' };
        return { ok: h === att.sha256, why: h === att.sha256 ? '처음 붙였을 때와 같아요' : '처음 붙였을 때와 달라요' };
      });
    });
  }
  function whenText(s) {
    return s ? (+s.slice(5, 7)) + '/' + (+s.slice(8, 10)) + '(' + DN.Events.weekdayOf(s.slice(0, 10)) + ') ' + s.slice(11, 16) : '';
  }
  function stamp(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : DN.Events.toStr(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function whoText(nos, names) {
    if (!nos || !nos.length) return '반 전체·학생 미지정';
    return nos.map(function (n) { return n + '번' + (names && names[n] ? ' ' + names[n] : ''); }).join(', ');
  }
  // 한글 문서에 붙여 넣을 글
  function asText(r, names) {
    const lines = ['[' + r.happenedAt.replace('T', ' ') + '] ' + r.cat + ' — ' + whoText(r.nos, names), r.text || '(내용 없음)'];
    (r.attachments || []).forEach(function (a) {
      lines.push('첨부: ' + a.name + ' (' + DN.Files.formatBytes(a.size) + (a.sha256 ? ', SHA-256 ' + a.sha256 : '') + ')');
    });
    lines.push('처음 기록한 시각: ' + stamp(r.createdAt) + ((r.history || []).length ? ' · 고친 기록 ' + r.history.length + '건' : ''));
    return lines.join('\r\n');
  }

  // ════════ 화면 ════════
  let rootEl = null;
  const state = { at: '', selected: new Set(), cat: '', text: '', files: [], busy: false, fNo: '', fCat: '', q: '' };

  function render(container) {
    rootEl = container;
    if (!state.at) state.at = nowLocal();
    const names = DN.Records.nameMap();
    container.innerHTML = '<div class="page-head"><h1>📎 상세 기록</h1></div>' +
      '<p class="notice">📌 다툼·욕설·쪽지·정리정돈처럼 나중에 확인이 필요한 일을 사진·음성·동영상과 함께 남겨요. 처음 기록한 시각과 파일 지문이 남고, 고치면 고친 이력이 쌓여요. <b>이 기록은 이 PC에만 있고 구글 드라이브로 보내지 않아요.</b> 사진·동영상까지 남기려면 [💾 백업]에서 <b>파일 포함 백업(ZIP)</b>을 받아 두세요.</p>' +
      '<div class="card quick"><div class="quick-head"><h2 class="side-title">새 기록</h2>' +
        '<label class="quick-date">일어난 때 <input type="datetime-local" id="lgAt" value="' + esc(state.at) + '"></label></div>' +
        '<div class="section-label">관련 학생 <small>(없으면 반 전체)</small></div><div id="lgPicker"></div>' +
        '<div class="section-label">분류</div><div class="rw-reasons" id="lgCats">' + CATS.map(function (c) {
          return '<button class="rw-reason" data-c="' + esc(c) + '" aria-pressed="' + (state.cat === c) + '">' + esc(c) + '</button>';
        }).join('') + '</div>' +
        '<textarea id="lgText" rows="5" maxlength="4000" placeholder="있었던 일을 본 그대로 적어 주세요. (언제·어디서·누가·무엇을, 학생이 한 말은 따옴표로)">' + esc(state.text) + '</textarea>' +
        '<div class="lg-files"><label class="btn-secondary bk-file">📎 사진·음성·동영상·파일 붙이기<input type="file" id="lgFile" multiple accept="image/*,audio/*,video/*,.pdf,.hwp,.hwpx,.doc,.docx,.txt" hidden></label>' +
          '<span id="lgFileList" class="set-help">' + fileListText() + '</span></div>' +
        '<div class="at-save"><button class="btn-primary" id="lgSave"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? '저장하는 중…' : '저장') + '</button></div></div>' +
      '<div class="card"><div class="side-head"><h2 class="side-title">기록 모아 보기</h2></div>' +
        '<div class="lg-filter"><select id="lgFNo"><option value="">모든 학생</option>' + DN.Records.studentNumbers().map(function (n) {
          return '<option value="' + n + '"' + (String(n) === state.fNo ? ' selected' : '') + '>' + esc(DN.Records.label(n, names)) + '</option>';
        }).join('') + '</select><select id="lgFCat"><option value="">모든 분류</option>' + CATS.map(function (c) {
          return '<option' + (c === state.fCat ? ' selected' : '') + '>' + esc(c) + '</option>';
        }).join('') + '</select><input type="search" id="lgQ" placeholder="🔍 내용 찾기" value="' + esc(state.q) + '">' +
        (state.fNo ? '<button class="btn-ghost" id="lgCopyAll">📋 이 학생 기록 모두 복사</button>' : '') + '</div>' +
        '<div id="lgList"></div></div>';

    const pick = container.querySelector('#lgPicker');
    pick.innerHTML = DN.Picker.html(state.selected);
    DN.Picker.bind(pick, state.selected);
    const q = function (s) { return container.querySelector(s); };
    q('#lgAt').addEventListener('change', function (e) { state.at = e.target.value; });
    q('#lgText').addEventListener('input', function (e) { state.text = e.target.value; });
    q('#lgCats').addEventListener('click', function (e) {
      const b = e.target.closest('[data-c]');
      if (!b) return;
      state.cat = state.cat === b.dataset.c ? '' : b.dataset.c;
      q('#lgCats').querySelectorAll('[data-c]').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.c === state.cat)); });
    });
    q('#lgFile').addEventListener('change', function (e) {
      const picked = Array.prototype.slice.call(e.target.files || []);
      e.target.value = '';
      picked.forEach(function (f) {
        if (f.size > MAX) { toast('“' + f.name + '”은(는) 1GB가 넘어 붙일 수 없어요.', 'error'); return; }
        if (f.size > BIG && !confirmAsk('“' + f.name + '”은(는) ' + DN.Files.formatBytes(f.size) + '로 커요. 이 PC의 저장 공간을 많이 쓰고 백업 파일도 커져요. 붙일까요?')) return;
        state.files.push(f);
      });
      q('#lgFileList').innerHTML = fileListText();
    });
    q('#lgFileList').addEventListener('click', function (e) {
      const b = e.target.closest('[data-rmf]');
      if (!b) return;
      state.files.splice(+b.dataset.rmf, 1);
      q('#lgFileList').innerHTML = fileListText();
    });
    q('#lgSave').addEventListener('click', save);
    q('#lgFNo').addEventListener('change', function (e) { state.fNo = e.target.value; render(container); });
    q('#lgFCat').addEventListener('change', function (e) { state.fCat = e.target.value; renderList(); });
    q('#lgQ').addEventListener('input', function (e) { state.q = e.target.value.trim(); renderList(); });
    const all = q('#lgCopyAll');
    if (all) all.addEventListener('click', function () {
      const list = logs({ no: state.fNo }).sort(function (a, b) { return a.happenedAt < b.happenedAt ? -1 : 1; });
      copyText([DN.Records.label(+state.fNo, names) + ' 상세 기록 (' + list.length + '건, 오래된 순)', ''].concat(list.map(function (r) { return asText(r, names) + '\r\n'; })).join('\r\n'))
        .then(function (ok) { toast(ok ? '복사했어요. 한글 문서에 붙여 넣으세요.' : '복사하지 못했어요.', ok ? 'success' : 'error'); });
    });
    renderList();
  }
  function fileListText() {
    if (!state.files.length) return '파일은 없어도 돼요. 쪽지·낙서·정리 안 된 자리는 사진으로, 말다툼은 녹음으로 남길 수 있어요.';
    return state.files.map(function (f, i) {
      return '<span class="lg-chip">' + KIND[kindOf(f.type)].split(' ')[0] + ' ' + esc(f.name) + ' <small>' + DN.Files.formatBytes(f.size) + '</small> <button class="ic" data-rmf="' + i + '" aria-label="빼기">✕</button></span>';
    }).join(' ');
  }
  function save() {
    if (state.busy) return;
    if (!DN.Events.isDate((state.at || '').slice(0, 10))) { toast('일어난 때를 확인해 주세요.', 'error'); return; }
    if (!state.cat) { toast('분류를 골라 주세요.', 'info'); return; }
    state.busy = true;
    rootEl.querySelector('#lgSave').disabled = true;
    rootEl.querySelector('#lgSave').textContent = state.files.length ? '파일 지문 계산하고 저장하는 중…' : '저장하는 중…';
    addLog({ happenedAt: state.at, nos: Array.from(state.selected), cat: state.cat, text: state.text }, state.files).then(function () {
      toast('상세 기록을 저장했어요.', 'success');
      state.selected.clear(); state.text = ''; state.files = []; state.cat = ''; state.at = nowLocal();
    }, function (e) {
      toast((e && e.message) || '저장하지 못했어요. 저장 공간을 확인해 주세요.', 'error');
    }).then(function () { state.busy = false; render(rootEl); });
  }

  function itemHtml(r, names) {
    const kinds = {};
    (r.attachments || []).forEach(function (a) { kinds[a.kind] = (kinds[a.kind] || 0) + 1; });
    return '<button class="lg-item" data-id="' + esc(r.id) + '"><span class="lg-when">' + esc(whenText(r.happenedAt)) + '</span>' +
      '<span class="lg-cat">' + esc(r.cat) + '</span><span class="lg-who">' + esc(whoText(r.nos, names)) + '</span>' +
      '<span class="lg-text">' + esc((r.text || '').slice(0, 80)) + ((r.text || '').length > 80 ? '…' : '') + '</span>' +
      '<span class="lg-meta">' + Object.keys(kinds).map(function (k) { return KIND[k].split(' ')[0] + (kinds[k] > 1 ? kinds[k] : ''); }).join(' ') +
      ((r.history || []).some(function (h) { return !h.note; }) ? ' <i>고침</i>' : '') + '</span></button>';
  }
  function renderList() {
    const names = DN.Records.nameMap();
    const f = { no: state.fNo, cat: state.fCat, q: state.q };
    const open = logs(Object.assign({ archived: false }, f)), arch = logs(Object.assign({ archived: true }, f));
    const box = rootEl.querySelector('#lgList');
    box.innerHTML = (open.length ? '<div class="lg-list">' + open.map(function (r) { return itemHtml(r, names); }).join('') + '</div>'
      : '<p class="side-empty">' + (state.fNo || state.fCat || state.q ? '맞는 기록이 없어요.' : '아직 상세 기록이 없어요.') + '</p>') +
      (arch.length ? '<details class="hw-done"><summary>🗄️ 보관한 기록 ' + arch.length + '건</summary><div class="lg-list">' + arch.map(function (r) { return itemHtml(r, names); }).join('') + '</div></details>' : '');
    box.querySelectorAll('[data-id]').forEach(function (b) { b.addEventListener('click', function () { openLog(b.dataset.id); }); });
  }

  // ── 기록 한 건 ──
  let urls = [];
  function openLog(id) {
    urls.forEach(function (u) { URL.revokeObjectURL(u); }); urls = [];
    const r = getLog(id);
    if (!r) return;
    const names = DN.Records.nameMap();
    const atts = r.attachments || [];
    const body = '<div class="lg-head"><span class="lg-cat">' + esc(r.cat) + '</span> <b>' + esc(whoText(r.nos, names)) + '</b>' + (r.archived ? ' <span class="lg-arch">보관됨</span>' : '') + '</div>' +
      '<p class="lg-full">' + esc(r.text || '(내용 없음)').replace(/\n/g, '<br>') + '</p>' +
      '<div class="lg-stamp">일어난 때 ' + esc(r.happenedAt.replace('T', ' ')) + ' · 처음 기록한 시각 <b>' + esc(stamp(r.createdAt)) + '</b> (바뀌지 않아요)</div>' +
      (atts.length ? '<div class="section-label">첨부 ' + atts.length + '개</div><div class="lg-atts">' + atts.map(function (a) {
        return '<div class="lg-att" data-fid="' + esc(a.id) + '"><div class="lg-prev" id="pv_' + esc(a.id) + '">' + KIND[a.kind] + '</div>' +
          '<div class="lg-att-info"><b>' + esc(a.name) + '</b> <small>' + DN.Files.formatBytes(a.size) + '</small><br>' +
          '<small class="lg-sha" title="' + esc(a.sha256 || '') + '">지문 ' + (a.sha256 ? esc(a.sha256.slice(0, 16)) + '…' : '없음') + '</small>' +
          '<div class="lg-att-btns"><button class="btn-ghost" data-open="' + esc(a.id) + '">열기·내려받기</button><button class="btn-ghost" data-verify="' + esc(a.id) + '">지문 확인</button>' +
          '<button class="btn-ghost" data-rmfile="' + esc(a.id) + '">빼기</button></div></div></div>';
      }).join('') + '</div>' : '') +
      ((r.history || []).length ? '<details class="hw-done"><summary>🕘 고친 이력 ' + r.history.length + '건</summary><div class="lg-hist">' + r.history.slice().reverse().map(function (h) {
        return '<div class="lg-h"><b>' + esc(stamp(h.editedAt)) + '</b> ' + (h.note ? esc(h.note) :
          '고치기 전: [' + esc((h.happenedAt || '').replace('T', ' ')) + '] ' + esc(h.cat || '') + ' — ' + esc(whoText(h.nos, names)) + '<br>' + esc(h.text || '').replace(/\n/g, '<br>')) + '</div>';
      }).join('') + '</div></details>' : '');
    const foot = '<button class="btn-ghost" id="lgCopy">📋 글로 복사</button>' +
      '<label class="btn-ghost bk-file">📎 파일 더하기<input type="file" id="lgMore" multiple accept="image/*,audio/*,video/*,.pdf,.hwp,.hwpx,.doc,.docx,.txt" hidden></label>' +
      '<button class="btn-ghost" id="lgEdit">✏️ 고치기</button>' +
      '<button class="btn-ghost" id="lgArch">' + (r.archived ? '보관 풀기' : '🗄️ 보관') + '</button>' +
      (atts.length ? '' : '<button class="btn-ghost danger" id="lgDel">지우기</button>') +
      '<span class="pv-spacer"></span><button class="btn-primary" data-close>닫기</button>';
    const m = openModal(whenText(r.happenedAt) + ' 상세 기록', body, foot);
    // 사진·음성·동영상은 창 안에서 바로 보기
    atts.forEach(function (a) {
      if (a.kind === 'file') return;
      DN.Files.get(a.id).then(function (f) {
        const el = m.querySelector('#pv_' + CSS.escape(a.id));
        if (!f || !el) return;
        const u = URL.createObjectURL(f.blob); urls.push(u);
        el.innerHTML = a.kind === 'photo' ? '<img src="' + u + '" alt="">' : a.kind === 'audio' ? '<audio controls src="' + u + '"></audio>' : '<video controls src="' + u + '"></video>';
      });
    });
    m.addEventListener('click', function (e) {
      const t = e.target;
      const op = t.closest('[data-open]'), vf = t.closest('[data-verify]'), rf = t.closest('[data-rmfile]');
      if (op) DN.Files.open(op.dataset.open).catch(function (er) { toast(er.message, 'error'); });
      if (vf) {
        const a = atts.find(function (x) { return x.id === vf.dataset.verify; });
        vf.disabled = true; vf.textContent = '확인 중…';
        verify(a).then(function (res) { vf.textContent = (res.ok ? '✅ ' : '⚠️ ') + res.why; });
      }
      if (rf) {
        const a = atts.find(function (x) { return x.id === rf.dataset.rmfile; });
        if (!confirmAsk('“' + a.name + '” 파일을 이 기록에서 뺄까요? 파일은 지워지고, 뺐다는 사실과 지문은 고친 이력에 남아요.')) return;
        removeFile(id, a.id).then(function () { openLog(id); renderList(); });
      }
      if (t.closest('#lgCopy')) copyText(asText(getLog(id), names)).then(function (ok) { toast(ok ? '복사했어요.' : '복사하지 못했어요.', ok ? 'success' : 'error'); });
      if (t.closest('#lgEdit')) openEdit(id);
      if (t.closest('#lgArch')) {
        const on = !getLog(id).archived;
        if (on && !confirmAsk('이 기록을 보관할까요? 지워지지 않고 목록 아래 “보관한 기록”으로 옮겨져요.')) return;
        setArchived(id, on); closeModal(); renderList();
      }
      if (t.closest('#lgDel')) {
        if (!confirmAsk('이 기록을 지울까요? 백업 파일에 없는 기록은 되살릴 수 없어요.')) return;
        removeLog(id); closeModal(); renderList();
      }
      if (t.closest('[data-close]')) renderList();
    });
    const more = m.querySelector('#lgMore');
    more.addEventListener('change', function () {
      const files = Array.prototype.slice.call(more.files || []).filter(function (f) {
        if (f.size > MAX) { toast('“' + f.name + '”은(는) 1GB가 넘어 붙일 수 없어요.', 'error'); return false; }
        return f.size <= BIG || confirmAsk('“' + f.name + '”은(는) ' + DN.Files.formatBytes(f.size) + '로 커요. 붙일까요?');
      });
      more.value = '';
      if (!files.length) return;
      toast('파일 지문을 계산하고 저장하는 중이에요…', 'info');
      addFiles(id, files).then(function () { toast('파일을 더했어요.', 'success'); openLog(id); renderList(); },
        function (er) { toast((er && er.message) || '파일을 저장하지 못했어요.', 'error'); });
    });
  }
  function openEdit(id) {
    const r = getLog(id);
    const sel = new Set(r.nos || []);
    let cat = r.cat;
    const m = openModal('상세 기록 고치기',
      '<p class="set-help" style="margin-top:0">고치면 고치기 전 내용이 “고친 이력”에 남아요. 처음 기록한 시각은 바뀌지 않아요.</p>' +
      '<label class="quick-date">일어난 때 <input type="datetime-local" id="leAt" value="' + esc(r.happenedAt) + '"></label>' +
      '<div class="section-label">관련 학생</div><div id="lePicker"></div>' +
      '<div class="section-label">분류</div><div class="rw-reasons" id="leCats">' + CATS.map(function (c) {
        return '<button class="rw-reason" data-c="' + esc(c) + '" aria-pressed="' + (c === cat) + '">' + esc(c) + '</button>';
      }).join('') + '</div><textarea id="leText" rows="6" maxlength="4000">' + esc(r.text || '') + '</textarea>',
      '<span class="pv-spacer"></span><button class="btn-cancel" data-close>취소</button><button class="btn-primary" id="leSave">고친 내용 저장</button>');
    const pick = m.querySelector('#lePicker');
    pick.innerHTML = DN.Picker.html(sel);
    DN.Picker.bind(pick, sel);
    m.querySelector('#leCats').addEventListener('click', function (e) {
      const b = e.target.closest('[data-c]');
      if (!b) return;
      cat = b.dataset.c;
      m.querySelectorAll('#leCats [data-c]').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.c === cat)); });
    });
    m.querySelector('#leSave').addEventListener('click', function () {
      editLog(id, { happenedAt: m.querySelector('#leAt').value, nos: Array.from(sel), cat: cat, text: m.querySelector('#leText').value });
      toast('고쳤어요. 고치기 전 내용은 이력에 남았어요.', 'success');
      openLog(id); renderList();
    });
  }

  return { COL, CATS, sha256, kindOf, logs, getLog, addLog, editLog, addFiles, removeFile, setArchived, removeLog, archiveAll, verify, asText, render };
})();
