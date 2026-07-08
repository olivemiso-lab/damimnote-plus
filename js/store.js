// ════════════════════════════════════════════════════
//  담임노트+ · 데이터 저장 계층 (DN.Store)
//  - 모든 모듈은 LocalStorage에 직접 접근하지 않고 이 계층만 사용
//  - 변경 즉시 자동 저장, 공통 필드(id/createdAt/updatedAt) 자동 관리
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Store = (function () {
  const PREFIX = 'damimnote:';
  const SCHEMA_VERSION = 1;

  // 컬렉션(배열) 키 목록 — 백업/복원 대상
  const COLLECTIONS = [
    'students', 'seatings', 'groups',
    'observations', 'counselings', 'reports',
    'sociometry', 'assessments', 'resources', 'attendance'
  ];
  // 단일 객체 키 (notices: 날짜별 오늘의 알림장)
  const OBJECTS = ['settings', 'meta', 'relations', 'notices'];

  // ── 저수준 read/write ──
  function read(key, def) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw == null ? def : JSON.parse(raw);
    } catch (e) {
      console.error('read 실패', key, e);
      return def;
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('write 실패', key, e);
      DN.utils.toast('⚠️ 저장 공간이 부족합니다. 데이터 관리에서 백업 후 정리해주세요.', 'error');
      return false;
    }
  }

  // ── 초기화 (meta/settings 보장) ──
  function init() {
    let meta = read('meta', null);
    if (!meta) {
      write('meta', { schemaVersion: SCHEMA_VERSION, createdAt: DN.utils.nowISO() });
    }
    if (!read('settings', null)) {
      write('settings', { schoolName: '', grade: '', classNo: '', teacher: '' });
    }
    if (!read('relations', null)) {
      write('relations', { conflicts: [], friends: [] });
    }
  }

  // ── 컬렉션 CRUD ──
  function getAll(coll) { return read(coll, []); }
  function saveAll(coll, arr) { return write(coll, arr); }

  function get(coll, id) {
    return getAll(coll).find(x => x.id === id) || null;
  }

  function add(coll, obj) {
    const arr = getAll(coll);
    const now = DN.utils.nowISO();
    const record = Object.assign({}, obj, {
      id: obj.id || DN.utils.uid(),
      createdAt: obj.createdAt || now,
      updatedAt: now,
    });
    arr.push(record);
    saveAll(coll, arr);
    return record;
  }

  function update(coll, id, patch) {
    const arr = getAll(coll);
    const idx = arr.findIndex(x => x.id === id);
    if (idx === -1) return null;
    arr[idx] = Object.assign({}, arr[idx], patch, {
      id,
      createdAt: arr[idx].createdAt,
      updatedAt: DN.utils.nowISO(),
    });
    saveAll(coll, arr);
    return arr[idx];
  }

  function remove(coll, id) {
    const arr = getAll(coll);
    const next = arr.filter(x => x.id !== id);
    saveAll(coll, next);
    return arr.length !== next.length;
  }

  function query(coll, fn) { return getAll(coll).filter(fn); }
  function count(coll) { return getAll(coll).length; }

  // ── 단일 객체(설정 등) ──
  function getObject(key, def) { return read(key, def); }
  function setObject(key, obj) { return write(key, obj); }

  // ── 전체 내보내기/가져오기(백업) ──
  function exportAll() {
    const data = { _app: 'damimnote-plus', _exportedAt: DN.utils.nowISO() };
    COLLECTIONS.forEach(c => { data[c] = getAll(c); });
    OBJECTS.forEach(o => { data[o] = read(o, null); });
    return data;
  }
  function importAll(data, mode) {
    // mode: 'replace' (전체 교체) | 'merge' (id 기준 병합)
    if (!data || data._app !== 'damimnote-plus') {
      throw new Error('담임노트+ 백업 파일이 아닙니다.');
    }
    COLLECTIONS.forEach(c => {
      const incoming = Array.isArray(data[c]) ? data[c] : [];
      if (mode === 'merge') {
        const cur = getAll(c);
        const map = new Map(cur.map(x => [x.id, x]));
        incoming.forEach(x => map.set(x.id, x));
        saveAll(c, Array.from(map.values()));
      } else {
        saveAll(c, incoming);
      }
    });
    OBJECTS.forEach(o => { if (data[o]) write(o, data[o]); });
    return true;
  }

  function wipeAll() {
    COLLECTIONS.concat(OBJECTS).forEach(k => localStorage.removeItem(PREFIX + k));
    init();
  }

  return {
    SCHEMA_VERSION, COLLECTIONS, OBJECTS,
    init, getAll, saveAll, get, add, update, remove, query, count,
    getObject, setObject, exportAll, importAll, wipeAll,
  };
})();
