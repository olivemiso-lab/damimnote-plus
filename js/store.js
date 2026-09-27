// ════════════════════════════════════════════════════
//  담임노트+ · 데이터 계층 (DN.Store) — localStorage
//  모든 데이터 접근은 이 계층만 사용할 것
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Store = (function () {
  // 테스트 페이지는 store.js보다 먼저 window.DN_STORE_PREFIX를 지정해 실제 데이터와 분리한다
  const PREFIX = window.DN_STORE_PREFIX || 'dn_';

  function read(col) {
    try {
      const raw = localStorage.getItem(PREFIX + col);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function write(col, arr) {
    try {
      localStorage.setItem(PREFIX + col, JSON.stringify(arr));
      return true;
    } catch (e) {
      if (DN.utils) DN.utils.toast('저장 공간이 부족합니다. 백업 후 오래된 데이터를 정리해주세요.', 'error');
      return false;
    }
  }

  function getAll(col) { return read(col); }

  function get(col, id) {
    return read(col).find(function (x) { return x.id === id; }) || null;
  }

  // id / createdAt / updatedAt 자동 부여 후 저장
  function add(col, obj) {
    const arr = read(col);
    const now = new Date().toISOString();
    const rec = Object.assign({}, obj, { id: DN.utils.uid(), createdAt: now, updatedAt: now });
    arr.push(rec);
    write(col, arr);
    return rec;
  }

  function update(col, id, patch) {
    const arr = read(col);
    const i = arr.findIndex(function (x) { return x.id === id; });
    if (i === -1) return null;
    arr[i] = Object.assign({}, arr[i], patch, { updatedAt: new Date().toISOString() });
    write(col, arr);
    return arr[i];
  }

  // 여러 건 추가·수정을 한 번에 저장 (중간에 실패해도 일부만 저장되지 않음)
  // ops: { add: [obj...], update: [{ id, patch }...] } → 저장 실패 시 null, 성공 시 추가된 레코드 배열
  function batch(col, ops) {
    const arr = read(col);
    const now = new Date().toISOString();
    (ops.update || []).forEach(function (u) {
      const i = arr.findIndex(function (x) { return x.id === u.id; });
      if (i >= 0) arr[i] = Object.assign({}, arr[i], u.patch, { updatedAt: now });
    });
    const added = (ops.add || []).map(function (obj) {
      return Object.assign({}, obj, { id: DN.utils.uid(), createdAt: now, updatedAt: now });
    });
    return write(col, arr.concat(added)) ? added : null;
  }

  function remove(col, id) {
    write(col, read(col).filter(function (x) { return x.id !== id; }));
  }

  function query(col, fn) { return read(col).filter(fn); }

  function count(col) { return read(col).length; }

  // 백업 복원용 — 컬렉션 전체 교체. 저장 실패(용량 부족) 시 false
  function replaceAll(col, arr) {
    return write(col, Array.isArray(arr) ? arr : []);
  }

  // 저장된 컬렉션 이름 목록 — 값이 배열인 키만 컬렉션으로 본다(백업 시각 같은 메타 값은 제외)
  function listCollections() {
    const names = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || key.indexOf(PREFIX) !== 0) continue;
        try {
          if (Array.isArray(JSON.parse(localStorage.getItem(key)))) names.push(key.slice(PREFIX.length));
        } catch (e) { /* JSON이 아닌 값은 컬렉션이 아님 */ }
      }
    } catch (e) {}
    return names.sort();
  }

  // 컬렉션이 아닌 단일 값(마지막 백업 시각 등). 키는 PREFIX + name 그대로 사용
  function getMeta(name) {
    try { return localStorage.getItem(PREFIX + name); } catch (e) { return null; }
  }
  function setMeta(name, value) {
    try { localStorage.setItem(PREFIX + name, String(value)); } catch (e) {}
  }

  // 이 앱이 localStorage에 쓰고 있는 용량(바이트, UTF-16 기준 근사치)
  function usageBytes() {
    let n = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.indexOf(PREFIX) === 0) n += (key.length + (localStorage.getItem(key) || '').length) * 2;
      }
    } catch (e) {}
    return n;
  }

  return { getAll, get, add, update, batch, remove, query, count, replaceAll, listCollections, getMeta, setMeta, usageBytes };
})();
