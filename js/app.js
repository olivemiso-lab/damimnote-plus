// ════════════════════════════════════════════════════
//  담임노트+ · 앱 셸 (DN.App) — 내비게이션/화면 전환 · 핸드폰 화면 전환 · 서비스 워커
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.App = (function () {
  const { esc } = DN.utils;
  const TABS = [
    { id: 'schedule', icon: '📅', label: '학교 일정', mod: function () { return DN.Schedule; } },
    { id: 'observe',  icon: '📝', label: '관찰 기록', mod: function () { return DN.Observe; } },
    { id: 'attend',   icon: '🗓️', label: '출결 메모', mod: function () { return DN.Attend; } },
    { id: 'seating',  icon: '🪑', label: '자리·모둠', mod: function () { return DN.Seating; } },
    { id: 'students', icon: '👦', label: '학생 관리', mod: function () { return DN.Students; } },
    { id: 'sync',     icon: '🔄', label: '핸드폰 연결', mod: function () { return DN.Sync; } },
    { id: 'backup',   icon: '💾', label: '백업',      mod: function () { return DN.Backup; } },
    { id: 'settings', icon: '⚙️', label: '설정',      mod: function () { return DN.Settings; } },
  ];
  let current = 'schedule';
  let mobileMode = false;

  function show(id) {
    if (mobileMode) { DN.Mobile.render(document.getElementById('view')); return; }
    const tab = TABS.find(function (t) { return t.id === id; }) || TABS[0];
    current = tab.id;
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === current);
    });
    tab.mod().render(document.getElementById('view'));
    refreshBanner();
  }

  // 핸드폰 화면 ↔ PC 화면 (기기 용도·화면 폭·“PC 화면으로 보기”에 따라)
  function relayout() {
    DN.utils.closeModal();
    mobileMode = DN.Mobile.active();
    document.body.classList.toggle('m-mode', mobileMode);
    if (mobileMode) {
      refreshBanner();
      DN.Mobile.render(document.getElementById('view'));
    } else {
      show(current);
    }
  }

  // ── 상단 백업 알림 배너 (PC 화면 공통) ──
  function refreshBanner() {
    const el = document.getElementById('banner');
    if (!el) return;
    if (mobileMode || !DN.Backup.isDue()) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = '<span>💾 ' + esc(DN.Backup.dueText()) + ' 백업 메뉴에서 기록 백업을 받아 두세요.</span>' +
      '<span class="banner-actions">' +
      (current === 'backup' ? '' : '<button class="btn-ghost" id="bannerGo">백업하러 가기</button>') +
      '<button class="hint-close" id="bannerSnooze" title="7일간 숨기기">✕</button></span>';
    const go = el.querySelector('#bannerGo');
    if (go) go.addEventListener('click', function () { show('backup'); });
    el.querySelector('#bannerSnooze').addEventListener('click', function () {
      DN.Backup.snoozeReminder();
      refreshBanner();
    });
  }

  // ── 서비스 워커 (PWA) ──
  // https(GitHub Pages)에서만 등록. file://에서는 서비스 워커 없이 모든 기능이 동작한다.
  // 개발 중 localhost는 캐시 때문에 헷갈리지 않도록 주소에 ?sw=1을 붙였을 때만 등록
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    if (location.protocol !== 'https:' && !(local && /[?&]sw=1/.test(location.search))) return;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      const offer = function (worker) {
        const el = document.getElementById('update');
        el.hidden = false;
        el.innerHTML = '<span>✨ 새 버전이 있어요.</span><button class="btn-primary" id="updateNow">새로고침</button>';
        el.querySelector('#updateNow').addEventListener('click', function () { worker.postMessage('skipWaiting'); });
      };
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', function () {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', function () {
          // 처음 설치가 아니라(이미 이 페이지를 관리하는 워커가 있을 때) 새 버전이 준비된 경우만 안내
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
    }).catch(function () { /* 서비스 워커가 없어도 앱은 그대로 동작 */ });
  }

  function init() {
    DN.Settings.ensure();
    const nav = document.getElementById('nav');
    nav.innerHTML = TABS.map(function (t) {
      return '<button class="nav-btn" data-tab="' + t.id + '">' +
        '<span class="nav-ic">' + t.icon + '</span><span>' + t.label + '</span></button>';
    }).join('') + '<button class="nav-btn to-mobile" id="toMobile"><span class="nav-ic">📱</span><span>핸드폰 화면</span></button>';
    nav.querySelectorAll('.nav-btn[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { show(b.dataset.tab); });
    });
    // 좁은 화면에서 “PC 화면으로 보기”를 고른 뒤 다시 핸드폰 화면으로
    nav.querySelector('#toMobile').addEventListener('click', function () {
      DN.Store.setMeta('forceDesktop', '0');
      relayout();
    });
    const mq = window.matchMedia(DN.Mobile.NARROW);
    const onChange = function () { if (DN.Mobile.active() !== mobileMode) relayout(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else mq.addListener(onChange);
    relayout();
    registerSW();
  }

  document.addEventListener('DOMContentLoaded', init);
  return { show, refreshBanner, relayout };
})();
