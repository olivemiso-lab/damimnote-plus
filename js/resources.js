// ════════════════════════════════════════════════════
//  담임노트+ · 자료실 / 유용한 링크 모음 (DN.Resources)
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Resources = (function () {
  const { esc, toast, confirmAsk } = DN.utils;
  const CATS = [
    { v: 'class', t: '📚 수업자료' }, { v: 'assess', t: '📝 평가' },
    { v: 'life', t: '🌱 생활지도' }, { v: 'admin', t: '🗂️ 행정업무' },
    { v: 'train', t: '🎓 연수' }, { v: 'etc', t: '🔗 기타' },
  ];
  const CAT_T = Object.fromEntries(CATS.map(c => [c.v, c.t]));
  // 분류별 색(파비콘 대체 타일용)
  const CAT_C = {
    class: '#667eea', assess: '#66bb6a', life: '#ffa726',
    admin: '#ab47bc', train: '#26c6da', etc: '#8d6e63',
  };

  // 추천 링크(원클릭 추가용)
  const SEED = [
    { title: '인디스쿨', url: 'https://indischool.com', category: 'class', memo: '초등 교사 수업자료 공유' },
    { title: '에듀넷·티클리어', url: 'https://www.edunet.net', category: 'class', memo: '교육자료·콘텐츠' },
    { title: 'e학습터', url: 'https://cls.edunet.net', category: 'class', memo: '온라인 학습' },
    { title: '학교알리미', url: 'https://www.schoolinfo.go.kr', category: 'admin', memo: '학교 정보공시' },
    { title: '에듀파인/나이스', url: 'https://www.neis.go.kr', category: 'admin', memo: '교육행정정보시스템' },
  ];

  let filter = 'all';
  let editId = null;
  let rootEl = null;

  function render(container) {
    rootEl = container;
    redraw();
  }

  function redraw() {
    const all = DN.Store.getAll('resources');
    const list = filter === 'all' ? all : all.filter(r => r.category === filter);
    const rec = editId ? DN.Store.get('resources', editId) : null;
    const f = rec || { title: '', url: '', category: 'class', memo: '' };

    rootEl.innerHTML = `
      <div class="page-head"><h1>🔗 자료실</h1></div>
      <div class="card qr-maker">
        <div class="card-head"><h2>📱 QR 코드 만들기</h2></div>
        <p class="desc">주소나 텍스트를 넣으면 바로 QR 코드가 만들어져요. 학급 안내·설문 링크·Padlet·Canva 공유에 활용하세요.</p>
        <div class="frow">
          <input type="text" id="qrFreeText" placeholder="https://... 또는 안내 문구" style="flex:1">
          <button class="btn-primary" id="qrMakeBtn">QR 생성</button>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2 id="resFormTitle">${editId ? '링크 수정' : '링크 추가'}</h2>${editId ? '<span class="edit-badge">수정 중</span>' : ''}</div>
        <div class="frow"><label>제목</label><input type="text" id="resTitle" value="${esc(f.title)}" placeholder="자료/사이트 이름"></div>
        <div class="frow"><label>주소</label><input type="text" id="resUrl" value="${esc(f.url)}" placeholder="https://..."></div>
        <div class="frow"><label>분류</label>
          <select id="resCat">${CATS.map(c => `<option value="${c.v}"${f.category === c.v ? ' selected' : ''}>${c.t}</option>`).join('')}</select>
        </div>
        <div class="frow col"><label>메모 <small class="muted">(선택)</small></label><textarea id="resMemo" rows="2" placeholder="간단한 설명">${esc(f.memo || '')}</textarea></div>
        <button class="btn-primary full" id="resSave">${editId ? '✅ 수정 완료' : '+ 추가'}</button>
        ${editId ? '<button class="btn-cancel full" id="resCancel">✕ 취소</button>' : ''}
      </div>

      <div class="card">
        <div class="filter-row">
          <button class="chip-f${filter === 'all' ? ' on' : ''}" data-f="all">전체</button>
          ${CATS.map(c => `<button class="chip-f${filter === c.v ? ' on' : ''}" data-f="${c.v}">${c.t}</button>`).join('')}
        </div>
        ${!all.length ? `<div class="seed-box"><p class="desc">자주 쓰는 사이트를 추가해보세요. 아래 추천 링크를 한 번에 넣을 수도 있어요.</p><button class="btn-secondary" id="seedBtn">📌 추천 링크 추가</button></div>` : ''}
        <div class="res-grid">
          ${list.length ? list.map(r => {
            const host = hostOf(r.url);
            return `
            <div class="res-card">
              <a class="res-main" href="${esc(r.url)}" target="_blank" rel="noopener" title="${esc(r.url)}">
                <div class="res-fav" style="--fc:${CAT_C[r.category] || '#667eea'}">
                  ${host ? `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&amp;sz=64" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''}
                  <span class="res-fav-fb"${host ? '' : ' style="display:flex"'}>${esc((r.title || '?').charAt(0))}</span>
                </div>
                <div class="res-info">
                  <div class="res-title">${esc(r.title)}</div>
                  ${r.memo ? `<div class="res-memo">${esc(r.memo)}</div>` : ''}
                  <div class="res-meta">
                    ${host ? `<span class="res-host">${esc(host)}</span>` : ''}
                    <span class="res-chip">${CAT_T[r.category] || ''}</span>
                  </div>
                </div>
              </a>
              <div class="res-foot">
                <button class="ic" data-qr="${r.id}" title="QR 코드 만들기">📱</button>
                <button class="ic" data-copy="${r.id}" title="주소 복사">📋</button>
                <button class="ic edit" data-edit="${r.id}" title="수정">✏️</button>
                <button class="ic del" data-del="${r.id}" title="삭제">✕</button>
              </div>
            </div>`;
          }).join('') : (all.length ? '<p class="empty">이 분류에 링크가 없습니다.</p>' : '')}
        </div>
      </div>`;

    rootEl.querySelector('#resSave').addEventListener('click', save);
    const cancel = rootEl.querySelector('#resCancel');
    if (cancel) cancel.addEventListener('click', () => { editId = null; redraw(); });
    const seed = rootEl.querySelector('#seedBtn');
    if (seed) seed.addEventListener('click', addSeed);
    rootEl.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => { filter = b.dataset.f; redraw(); }));
    rootEl.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => { editId = b.dataset.edit; redraw(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
    rootEl.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      if (!confirmAsk('이 링크를 삭제할까요?')) return;
      DN.Store.remove('resources', b.dataset.del);
      if (editId === b.dataset.del) editId = null;
      redraw();
      toast('삭제되었습니다.', 'info');
    }));
    rootEl.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
      const r = DN.Store.get('resources', b.dataset.copy);
      if (r) DN.utils.copy(r.url);
    }));
    rootEl.querySelectorAll('[data-qr]').forEach(b => b.addEventListener('click', () => {
      const r = DN.Store.get('resources', b.dataset.qr);
      if (r) showQr(r);
    }));
    // 자유 입력 QR 생성기
    const makeFree = () => {
      const raw = rootEl.querySelector('#qrFreeText').value.trim();
      if (!raw) { toast('주소나 텍스트를 입력해주세요.', 'error'); return; }
      const isUrl = /^(https?:\/\/|www\.)/i.test(raw) || /^[\w-]+(\.[\w-]+)+([\/?#]|$)/.test(raw);
      const text = isUrl ? normalizeUrl(raw) : raw;
      showQr({ title: isUrl ? '링크 QR' : '텍스트 QR', url: text, memo: '' });
    };
    rootEl.querySelector('#qrMakeBtn').addEventListener('click', makeFree);
    rootEl.querySelector('#qrFreeText').addEventListener('keydown', e => { if (e.key === 'Enter') makeFree(); });
  }

  // URL → 호스트명 (표시용, www. 제거)
  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  // ── QR 코드 모달 ──
  // canvas로 그려 PNG DataURL 생성 (여백 4모듈 = 표준 quiet zone 포함)
  function makeQrDataUrl(text, cellPx) {
    if (typeof qrcode !== 'function') return null;
    if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
      qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8']; // 한글 대비
    }
    const qr = qrcode(0, 'M'); // 버전 자동, 오류정정 M
    qr.addData(text, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const c = cellPx || 8, margin = c * 4, size = n * c + margin * 2;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++)
      for (let col = 0; col < n; col++)
        if (qr.isDark(r, col)) ctx.fillRect(margin + col * c, margin + r * c, c, c);
    return cv.toDataURL('image/png');
  }

  function showQr(r) {
    let dataUrl = null;
    try { dataUrl = makeQrDataUrl(r.url, 8); } catch (e) { console.error(e); }
    if (!dataUrl) { toast('QR 코드를 만들지 못했습니다. (주소가 너무 길 수 있어요)', 'error'); return; }

    const old = document.getElementById('qrModal');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.id = 'qrModal';
    wrap.className = 'qr-overlay';
    wrap.innerHTML = `
      <div class="qr-box">
        <div class="qr-title">${esc(r.title)}</div>
        <img class="qr-img" src="${dataUrl}" alt="QR: ${esc(r.title)}">
        <div class="qr-url">${esc(r.url)}</div>
        <p class="qr-hint">휴대폰 카메라로 찍으면 바로 열려요. TV에 띄우거나 인쇄해서 나눠주세요.</p>
        <div class="result-actions">
          <button class="btn-secondary" id="qrPrint">🖨️ 인쇄</button>
          <button class="btn-secondary" id="qrSave">💾 이미지 저장</button>
          <button class="btn-cancel" id="qrClose">닫기</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const close = () => wrap.remove();
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    wrap.querySelector('#qrClose').addEventListener('click', close);
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
    });
    wrap.querySelector('#qrSave').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `QR_${r.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'link'}.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      toast('QR 이미지를 저장했습니다!', 'success');
    });
    wrap.querySelector('#qrPrint').addEventListener('click', () => printQr(r, dataUrl));
  }

  // 큰 QR 1장 인쇄(교실 게시용)
  function printQr(r, dataUrl) {
    const win = window.open('', '_qrprint', 'width=800,height=900');
    win.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>QR - ${esc(r.title)}</title>
      <style>
        body{font-family:'Malgun Gothic',sans-serif;text-align:center;padding:2.5rem;color:#222}
        h1{font-size:1.6rem;margin-bottom:0.4rem}
        .memo{color:#666;margin-bottom:1.6rem}
        img{width:340px;height:340px;image-rendering:pixelated;border:1px solid #eee;padding:16px;border-radius:12px}
        .url{margin-top:1.2rem;color:#888;font-size:0.95rem;word-break:break-all}
        .foot{margin-top:2rem;color:#bbb;font-size:0.8rem}
      </style></head><body>
      <h1>${esc(r.title)}</h1>
      ${r.memo ? `<div class="memo">${esc(r.memo)}</div>` : ''}
      <img src="${dataUrl}" alt="QR">
      <div class="url">${esc(r.url)}</div>
      <div class="foot">담임노트+ · ${DN.utils.fmtDate(DN.utils.nowISO())}</div>
      <script>window.onload=()=>{window.print();window.close()}<\/script>
    </body></html>`);
    win.document.close();
  }

  function normalizeUrl(u) {
    u = u.trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u;
  }

  function save() {
    const title = rootEl.querySelector('#resTitle').value.trim();
    const url = normalizeUrl(rootEl.querySelector('#resUrl').value);
    if (!title) { toast('제목을 입력해주세요.', 'error'); return; }
    if (!url) { toast('주소(URL)를 입력해주세요.', 'error'); return; }
    const data = { title, url, category: rootEl.querySelector('#resCat').value, memo: rootEl.querySelector('#resMemo').value.trim() };
    if (editId) { DN.Store.update('resources', editId, data); editId = null; toast('수정했습니다!', 'success'); }
    else { DN.Store.add('resources', data); toast('링크를 추가했습니다!', 'success'); }
    redraw();
  }

  function addSeed() {
    SEED.forEach(s => DN.Store.add('resources', s));
    redraw();
    toast(`추천 링크 ${SEED.length}개를 추가했습니다.`, 'success');
  }

  return { render };
})();
