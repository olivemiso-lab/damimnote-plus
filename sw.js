// ════════════════════════════════════════════════════
//  담임노트+ · 서비스 워커 — 앱 파일을 캐시해 오프라인에서도 열리게 한다
//  ⚠ 배포할 때마다 VERSION을 올릴 것. 그래야 교사 화면에 “새 버전이 있어요” 안내가 뜬다.
//  데이터(localStorage·IndexedDB)는 건드리지 않는다. 외부 요청 없음.
// ════════════════════════════════════════════════════
const VERSION = '2026-09-27-5';
const CACHE = 'damimnote-' + VERSION;

// 설치할 때 미리 받아 두는 앱 파일. 하나라도 없으면 설치가 실패하므로 파일을 추가·삭제하면 여기도 고칠 것
const APP_FILES = [
  './index.html',   // 폴더 주소('./')는 서버마다 달라 넣지 않는다 — 오프라인 페이지 요청은 index.html로 응답
  './manifest.json',
  './css/style.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './js/vendor/jszip.min.js',
  './js/utils.js',
  './js/store.js',
  './js/settings.js',
  './js/files.js',
  './js/events.js',
  './js/together.js',
  './js/schedule.js',
  './js/schedule-view.js',
  './js/weekly.js',
  './js/records.js',
  './js/picker.js',
  './js/observe.js',
  './js/attend.js',
  './js/students.js',
  './js/arranger.js',
  './js/seating.js',
  './js/backup.js',
  './js/sync.js',
  './js/mobile.js',
  './js/app.js',
];
// kordoc(한글 파일 해석기, 약 650KB)은 PC에서 월중행사를 가져올 때만 필요 → 처음 쓸 때 캐시

self.addEventListener('install', function (e) {
  // cache: 'reload' — 브라우저의 HTTP 캐시(GitHub Pages는 10분)를 건너뛰고 서버에서 새 파일을 받는다.
  // 이게 없으면 새 버전 설치 때 옛 파일이 저장되어, 새로고침해도 예전 화면이 남을 수 있다.
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(APP_FILES.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }));
});

// 새 버전은 교사가 [새로고침]을 누를 때 적용 (쓰던 화면이 갑자기 바뀌지 않게)
self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('damimnote-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// 같은 출처 GET만 처리: 캐시에 있으면 캐시, 없으면 받아서 캐시에 넣는다. 오프라인에서 페이지 요청은 index.html로
self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res.ok && res.type === 'basic') c.put(req, res.clone());
        return res;
      }).catch(function () {
        if (req.mode === 'navigate') return c.match('./index.html');
        throw new Error('offline');
      });
    });
  }));
});
