// ════════════════════════════════════════════════════
//  담임노트+ · 앱 셸 (DN.App) — 내비게이션/화면 전환 · 핸드폰 화면 전환 · 서비스 워커
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.App = (function () {
  const { esc } = DN.utils;
  // 교사가 실제로 쓰는 흐름 순서: 명단 → 매일 출결 → 관찰 → 자리·모둠 → 학교 일정
  const TABS = [
    { id: 'students', icon: '👦', label: '학생 관리', mod: function () { return DN.Students; } },
    { id: 'attend',   icon: '🗓️', label: '출결 메모', mod: function () { return DN.Attend; } },
    { id: 'observe',  icon: '📝', label: '관찰 기록', mod: function () { return DN.Observe; } },
    { id: 'seating',  icon: '🪑', label: '자리·모둠', mod: function () { return DN.Seating; } },
    { id: 'schedule', icon: '📅', label: '학교 일정', mod: function () { return DN.Schedule; } },
    { id: 'sync',     icon: '🔄', label: '핸드폰 연결', mod: function () { return DN.Sync; } },
    { id: 'backup',   icon: '💾', label: '백업',      mod: function () { return DN.Backup; } },
    { id: 'settings', icon: '⚙️', label: '설정',      mod: function () { return DN.Settings; } },
  ];
  // 앱을 열면 마지막으로 보던 메뉴에서 다시 시작 (처음이면 첫 메뉴)
  let current = DN.Store.getMeta('lastTab') || TABS[0].id;
  let mobileMode = false;

  function show(id) {
    if (mobileMode) { DN.Mobile.render(document.getElementById('view')); return; }
    const tab = TABS.find(function (t) { return t.id === id; }) || TABS[0];
    current = tab.id;
    DN.Store.setMeta('lastTab', current);
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
    if (DN.Cloud) DN.Cloud.renderBar();
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
    // 자동 업데이트: 새 버전이 적용되면 화면을 새로 고친다. 글을 쓰는 중이거나 창이 열려 있으면 끝날 때까지 기다린다
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    const busy = function () {
      const a = document.activeElement;
      return !!document.getElementById('dnModal') || !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
    };
    const reloadWhenIdle = function () {
      if (reloading) return;
      if (busy() && document.visibilityState === 'visible') { setTimeout(reloadWhenIdle, 2000); return; }
      reloading = true;
      try { sessionStorage.setItem('dn_updated', '1'); } catch (e) {}
      location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController) reloadWhenIdle();   // 처음 설치 때는 새로 고칠 필요 없음
    });
    try {
      if (sessionStorage.getItem('dn_updated') === '1') {
        sessionStorage.removeItem('dn_updated');
        setTimeout(function () { DN.utils.toast('✨ 새 버전으로 바뀌었어요.', 'success'); }, 600);
      }
    } catch (e) {}
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      // 예전 방식 워커가 새 버전을 받아 두고 기다리는 중이면 바로 적용
      if (reg.waiting) reg.waiting.postMessage('skipWaiting');
      // 핸드폰은 앱을 닫지 않고 다시 여는 일이 많으므로, 화면으로 돌아올 때마다 새 버전을 확인 (1분에 한 번까지)
      let last = Date.now();
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible' || Date.now() - last < 60000) return;
        last = Date.now();
        reg.update().catch(function () {});
      });
      setInterval(function () { if (document.visibilityState === 'visible') reg.update().catch(function () {}); }, 30 * 60 * 1000);
    }).catch(function () { /* 서비스 워커가 없어도 앱은 그대로 동작 */ });
  }

  function init() {
    DN.Settings.ensure();
    DN.Settings.applyLook(DN.Settings.look());
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
    if (DN.Cloud) DN.Cloud.start();
    registerSW();
  }

  document.addEventListener('DOMContentLoaded', init);
  return { show, refreshBanner, relayout };
})();
