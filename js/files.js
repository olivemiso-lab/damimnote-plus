// ════════════════════════════════════════════════════
//  담임노트+ · 첨부 파일 저장소 (DN.Files) — IndexedDB
//  파일은 절대 localStorage에 넣지 않는다. 모든 API는 Promise를 돌려준다.
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Files = (function () {
  // 테스트 페이지는 files.js보다 먼저 window.DN_FILES_DB를 지정해 실제 데이터와 분리한다
  const DB_NAME = window.DN_FILES_DB || 'damimnote';
  const STORE = 'files';
  const WARN_BYTES = 20 * 1024 * 1024;
  // 새 탭에서 바로 볼 수 있는 형식. 그 밖의 형식(한글 등)은 내려받기
  const PREVIEW_TYPES = /^(image\/(png|jpeg|gif|webp|bmp)|application\/pdf)$/;

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('이 브라우저에서는 첨부 파일을 저장할 수 없어요.')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('첨부 파일 저장소를 열 수 없어요.')); };
      req.onblocked = function () { reject(new Error('다른 탭에서 담임노트+를 닫은 뒤 다시 시도해 주세요.')); };
    });
    // 실패하면 다음 호출 때 다시 열어 본다
    dbPromise.catch(function () { dbPromise = null; });
    return dbPromise;
  }

  // 트랜잭션 하나로 작업. fn(store)가 돌려준 요청의 결과로 resolve, 트랜잭션이 끝나야 완료
  function tx(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(STORE, mode);
        let result;
        let req;
        try {
          req = fn(t.objectStore(STORE));
        } catch (e) {
          // 요청을 만들다 실패하면(예: 저장할 수 없는 값) 이미 보낸 요청(clear 등)까지 모두 취소
          try { t.abort(); } catch (ignore) {}
          reject(e);
          return;
        }
        if (req) req.onsuccess = function () { result = req.result; };
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error || new Error('첨부 파일 저장 중 오류가 났어요.')); };
        t.onabort = function () { reject(t.error || new Error('첨부 파일 저장이 취소됐어요. 저장 공간을 확인해 주세요.')); };
      });
    });
  }

  // meta: { id?, name, type, createdAt? } — size는 blob에서 다시 잰다
  function toRecord(meta, blob) {
    return {
      id: meta.id || DN.utils.uid(),
      name: meta.name || '이름없는파일',
      type: meta.type || blob.type || '',
      size: blob.size || 0,
      blob: blob,
      createdAt: meta.createdAt || new Date().toISOString(),
    };
  }

  // File(또는 name이 있는 Blob)을 저장하고 id를 돌려준다
  function put(file) {
    const rec = toRecord({ name: file.name, type: file.type }, file);
    return tx('readwrite', function (s) { return s.put(rec); }).then(function () { return rec.id; });
  }

  function get(id) {
    return tx('readonly', function (s) { return s.get(id); }).then(function (r) { return r || null; });
  }

  function remove(id) {
    return tx('readwrite', function (s) { return s.delete(id); });
  }

  // 목록 (blob 제외 — 화면·요약용)
  function list() {
    return tx('readonly', function (s) { return s.getAll(); }).then(function (all) {
      return (all || []).map(function (r) {
        return { id: r.id, name: r.name, type: r.type, size: r.size, createdAt: r.createdAt };
      });
    });
  }

  function totalSize() {
    return list().then(function (all) {
      return all.reduce(function (n, r) { return n + (r.size || 0); }, 0);
    });
  }

  // 백업용: blob 포함 전체 레코드
  function exportAll() {
    return tx('readonly', function (s) { return s.getAll(); }).then(function (all) { return all || []; });
  }

  // 복원용: 전체 교체. 한 트랜잭션이라 중간에 실패하면 기존 파일이 그대로 남는다
  // records: [{ id, name, type, size, createdAt, blob }]
  function replaceAll(records) {
    return tx('readwrite', function (s) {
      s.clear();
      records.forEach(function (r) { s.put(toRecord(r, r.blob)); });
      return null;
    }).then(function () {
      return records.length;
    });
  }

  // 20MB 넘는 파일이면 교사에게 보여 줄 경고 문구, 아니면 ''
  function sizeWarning(file) {
    if (!file || file.size <= WARN_BYTES) return '';
    return '“' + file.name + '”은(는) ' + formatBytes(file.size) + '로 큰 파일이에요. 저장 공간을 많이 차지하고 백업 파일도 커집니다.';
  }

  function canPreview(type) { return PREVIEW_TYPES.test(type || ''); }

  // PDF·이미지는 새 탭에서 미리보기, 그 밖의 형식은 내려받기
  function open(id) {
    return get(id).then(function (r) {
      if (!r) throw new Error('파일을 찾을 수 없어요.');
      const url = URL.createObjectURL(r.blob);
      if (canPreview(r.type)) {
        window.open(url, '_blank');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = r.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      // 새 탭이 읽을 시간을 준 뒤 해제
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      return r;
    });
  }

  function formatBytes(n) {
    n = n || 0;
    if (n < 1024) return n + 'B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB';
    return (n / 1024 / 1024).toFixed(1) + 'MB';
  }

  return { put, get, remove, list, totalSize, exportAll, replaceAll, sizeWarning, canPreview, open, formatBytes, WARN_BYTES };
})();
