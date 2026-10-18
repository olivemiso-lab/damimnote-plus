// ════════════════════════════════════════════════════
//  담임노트+ · 표 파일 읽기 (DN.Sheet) — 나이스에서 내려받은 학생 명단 등
//  .xlsx(엑셀) · .xls(옛 엑셀, 또는 표 모양 웹 문서) · .csv 의 첫 번째 시트를 [[칸, …], …] 글자 표로 돌려준다
//  외부로 보내는 것 없음. 파일은 이 브라우저 안에서만 읽는다
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Sheet = (function () {
  // file(Blob/File) → Promise<string[][]>
  function read(file) {
    return file.arrayBuffer().then(function (buf) {
      const u8 = new Uint8Array(buf);
      if (u8[0] === 0x50 && u8[1] === 0x4B) return readXlsx(buf);                                  // PK… zip
      if (u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0) return readXls(u8);  // 옛 엑셀
      const text = decodeText(u8);
      if (/<table[\s>]/i.test(text)) return readHtml(text);                                       // 엑셀 이름의 웹 문서
      return readCsv(text);
    });
  }

  // 글자 파일: UTF-8이 아니면 한국어 윈도우 인코딩(EUC-KR)으로
  function decodeText(u8) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, ''); }
    catch (e) { try { return new TextDecoder('euc-kr').decode(u8); } catch (e2) { return new TextDecoder().decode(u8); } }
  }

  function cellText(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
    return String(v).replace(/\s+/g, ' ').trim();
  }
  function setCell(rows, r, c, v) {
    while (rows.length <= r) rows.push([]);
    const row = rows[r];
    while (row.length < c) row.push('');
    row[c] = cellText(v);
  }
  function tidy(rows) {
    return rows.map(function (r) { return (r || []).map(function (c) { return c === undefined ? '' : c; }); });
  }

  // ── CSV ──
  function readCsv(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    const sep = (text.split(/\r?\n/)[0] || '').indexOf('\t') >= 0 ? '\t' : ',';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cellText(cell)); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cellText(cell)); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cellText(cell)); rows.push(row); }
    return rows;
  }

  // ── HTML 표 ──
  function readHtml(text) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const table = doc.querySelector('table');
    if (!table) return [];
    return Array.prototype.map.call(table.querySelectorAll('tr'), function (tr) {
      return Array.prototype.map.call(tr.querySelectorAll('td,th'), function (td) { return cellText(td.textContent); });
    });
  }

  // ── XLSX (zip 안의 XML) ──
  function readXlsx(buf) {
    if (!window.JSZip) return Promise.reject(new Error('엑셀 파일을 읽는 도구를 불러오지 못했어요.'));
    return JSZip.loadAsync(buf).then(function (zip) {
      const get = function (p) { const f = zip.file(p); return f ? f.async('string') : Promise.resolve(''); };
      return Promise.all([get('xl/workbook.xml'), get('xl/_rels/workbook.xml.rels'), get('xl/sharedStrings.xml')]).then(function (a) {
        const xml = function (s) { return new DOMParser().parseFromString(s || '<x/>', 'application/xml'); };
        const wb = xml(a[0]), rels = xml(a[1]), ss = xml(a[2]);
        // 첫 번째 시트 파일 찾기
        let path = 'xl/worksheets/sheet1.xml';
        const sheet = wb.getElementsByTagName('sheet')[0];
        if (sheet) {
          const rid = sheet.getAttribute('r:id') || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
          Array.prototype.forEach.call(rels.getElementsByTagName('Relationship'), function (r) {
            if (r.getAttribute('Id') === rid) {
              const t = r.getAttribute('Target') || '';
              path = t.charAt(0) === '/' ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
            }
          });
        }
        const strings = Array.prototype.map.call(ss.getElementsByTagName('si'), function (si) {
          return Array.prototype.map.call(si.getElementsByTagName('t'), function (t) { return t.textContent; }).join('');
        });
        return get(path).then(function (s) {
          const doc = xml(s), rows = [];
          Array.prototype.forEach.call(doc.getElementsByTagName('c'), function (c) {
            const ref = c.getAttribute('r') || '';
            const m = ref.match(/^([A-Z]+)(\d+)$/);
            if (!m) return;
            let col = 0;
            for (let i = 0; i < m[1].length; i++) col = col * 26 + (m[1].charCodeAt(i) - 64);
            const t = c.getAttribute('t');
            const v = c.getElementsByTagName('v')[0];
            let val = '';
            if (t === 's') val = strings[+(v ? v.textContent : -1)] || '';
            else if (t === 'inlineStr') val = Array.prototype.map.call(c.getElementsByTagName('t'), function (x) { return x.textContent; }).join('');
            else if (v) val = t === 'str' || t === 'b' ? v.textContent : (isNaN(+v.textContent) ? v.textContent : +v.textContent);
            setCell(rows, +m[2] - 1, col - 1, val);
          });
          return tidy(rows);
        });
      });
    });
  }

  // ── XLS (옛 엑셀: 복합 문서 안의 BIFF8 Workbook) ──
  function readXls(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const u16 = function (o) { return dv.getUint16(o, true); };
    const u32 = function (o) { return dv.getUint32(o, true); };
    const secSize = 1 << u16(0x1E), miniSize = 1 << u16(0x20);
    const cutoff = u32(0x38);
    const secOff = function (id) { return (id + 1) * secSize; };
    // FAT 섹터 목록 (머리의 109개 + DIFAT 사슬)
    const fatSecs = [];
    for (let i = 0; i < 109; i++) { const s = u32(0x4C + i * 4); if (s < 0xFFFFFFFA) fatSecs.push(s); }
    let dif = u32(0x44), guard = 0;
    while (dif < 0xFFFFFFFA && guard++ < 10000) {
      const per = secSize / 4 - 1;
      for (let i = 0; i < per; i++) { const s = u32(secOff(dif) + i * 4); if (s < 0xFFFFFFFA) fatSecs.push(s); }
      dif = u32(secOff(dif) + per * 4);
    }
    const fat = [];
    fatSecs.forEach(function (s) { for (let i = 0; i < secSize / 4; i++) fat.push(u32(secOff(s) + i * 4)); });
    const chain = function (start, table) {
      const out = [];
      let s = start, n = 0;
      while (s < 0xFFFFFFFA && n++ < 1e6) { out.push(s); s = table[s]; }
      return out;
    };
    const readChain = function (start, size) {
      const secs = chain(start, fat), out = new Uint8Array(secs.length * secSize);
      secs.forEach(function (s, i) { out.set(u8.subarray(secOff(s), secOff(s) + secSize), i * secSize); });
      return size === undefined ? out : out.subarray(0, size);
    };
    // 디렉터리에서 Workbook 찾기
    const dir = readChain(u32(0x30));
    const ddv = new DataView(dir.buffer);
    let root = null, book = null;
    for (let o = 0; o + 128 <= dir.length; o += 128) {
      const nlen = ddv.getUint16(o + 0x40, true);
      let name = '';
      for (let i = 0; i + 2 < nlen; i += 2) name += String.fromCharCode(ddv.getUint16(o + i, true));
      const ent = { type: dir[o + 0x42], start: ddv.getUint32(o + 0x74, true), size: ddv.getUint32(o + 0x78, true) };
      if (ent.type === 5) root = ent;
      if (ent.type === 2 && (name === 'Workbook' || name === 'Book')) book = ent;
    }
    if (!book) throw new Error('엑셀 파일 안에서 표를 찾지 못했어요.');
    let data;
    if (book.size >= cutoff) data = readChain(book.start, book.size);
    else {
      const mini = readChain(root.start);
      const mfat = [];
      chain(u32(0x3C), fat).forEach(function (s) { for (let i = 0; i < secSize / 4; i++) mfat.push(u32(secOff(s) + i * 4)); });
      const secs = chain(book.start, mfat);
      data = new Uint8Array(secs.length * miniSize);
      secs.forEach(function (s, i) { data.set(mini.subarray(s * miniSize, (s + 1) * miniSize), i * miniSize); });
      data = data.subarray(0, book.size);
    }
    return parseBiff(data);
  }

  function parseBiff(d) {
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const rows = [];
    let sst = [], sheetNo = 0, inSheet = false, done = false;
    let pos = 0;
    const rk = function (v) {
      let n;
      if (v & 2) n = v >> 2;
      else { const b = new DataView(new ArrayBuffer(8)); b.setUint32(4, v & 0xFFFFFFFC, true); n = b.getFloat64(0, true); }
      return v & 1 ? n / 100 : n;
    };
    while (pos + 4 <= d.length && !done) {
      const type = dv.getUint16(pos, true), len = dv.getUint16(pos + 2, true);
      const o = pos + 4;
      if (type === 0x00FC) {
        // SST + 이어지는 CONTINUE 조각
        const segs = [d.subarray(o, o + len)];
        let p2 = o + len;
        while (p2 + 4 <= d.length && dv.getUint16(p2, true) === 0x003C) {
          const l2 = dv.getUint16(p2 + 2, true);
          segs.push(d.subarray(p2 + 4, p2 + 4 + l2));
          p2 += 4 + l2;
        }
        sst = readSst(segs);
        pos = p2;
        continue;
      }
      if (type === 0x0809) { // BOF
        const kind = dv.getUint16(o + 2, true);
        if (kind === 0x0010) { sheetNo++; inSheet = sheetNo === 1; }
      } else if (type === 0x000A) { // EOF
        if (inSheet) done = true;
      } else if (inSheet) {
        if (type === 0x00FD) setCell(rows, dv.getUint16(o, true), dv.getUint16(o + 2, true), sst[dv.getUint32(o + 6, true)] || '');
        else if (type === 0x0203) setCell(rows, dv.getUint16(o, true), dv.getUint16(o + 2, true), dv.getFloat64(o + 6, true));
        else if (type === 0x027E) setCell(rows, dv.getUint16(o, true), dv.getUint16(o + 2, true), rk(dv.getUint32(o + 6, true)));
        else if (type === 0x00BD) { // MULRK
          const r = dv.getUint16(o, true), c0 = dv.getUint16(o + 2, true), n = (len - 6) / 6;
          for (let i = 0; i < n; i++) setCell(rows, r, c0 + i, rk(dv.getUint32(o + 4 + i * 6 + 2, true)));
        } else if (type === 0x0204) { // LABEL
          const cch = dv.getUint16(o + 6, true), hi = d[o + 8] & 1;
          let s = '';
          for (let i = 0; i < cch; i++) s += String.fromCharCode(hi ? dv.getUint16(o + 9 + i * 2, true) : d[o + 9 + i]);
          setCell(rows, dv.getUint16(o, true), dv.getUint16(o + 2, true), s);
        }
      }
      pos = o + len;
    }
    return tidy(rows);
  }

  // SST 문자열 목록 (조각 경계에서 글자는 새 플래그 바이트로 이어진다)
  function readSst(segs) {
    let si = 0, p = 0;
    const byte = function () {
      if (p >= segs[si].length) { si++; p = 0; }
      return segs[si][p++];
    };
    const u16 = function () { const a = byte(); return a | (byte() << 8); };
    const u32 = function () { const a = u16(); return (a | (u16() << 16)) >>> 0; };
    const skip = function (n) { for (let i = 0; i < n; i++) byte(); };
    u32(); const unique = u32();
    const out = [];
    for (let k = 0; k < unique && si < segs.length; k++) {
      const cch = u16(), flags = byte();
      let hi = flags & 1;
      const runs = flags & 8 ? u16() : 0;
      const ext = flags & 4 ? u32() : 0;
      let s = '';
      for (let i = 0; i < cch; i++) {
        if (p >= segs[si].length) { si++; p = 0; hi = segs[si][p++] & 1; }
        s += String.fromCharCode(hi ? u16() : byte());
      }
      skip(runs * 4 + ext);
      out.push(s);
    }
    return out;
  }

  return { read, readCsv, readHtml };
})();
