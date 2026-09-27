// ════════════════════════════════════════════════════
//  담임노트+ · 번호 고르기 격자 (DN.Picker) — 관찰·출결 공통
//  번호 버튼(1 ~ 학생 수)을 눌러 여러 명 선택. 명단이 있으면 번호 아래 이름을 작게 보여 준다(PC)
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.Picker = (function () {
  const { esc } = DN.utils;

  // selected: Set<number>
  function html(selected, opts) {
    opts = opts || {};
    const names = opts.showNames === false ? {} : DN.Records.nameMap();
    const nos = DN.Records.studentNumbers();
    if (!nos.length) return '<p class="side-empty">설정에서 학생 수를 먼저 정해 주세요.</p>';
    return '<div class="picker-tools"><span class="picker-count">' + selected.size + '명 선택</span>' +
      '<button type="button" class="btn-ghost picker-all" data-pick="all">모두</button>' +
      '<button type="button" class="btn-ghost picker-all" data-pick="none">해제</button></div>' +
      '<div class="picker">' + nos.map(function (n) {
        return '<button type="button" class="no-btn" data-no="' + n + '" aria-pressed="' + selected.has(n) + '">' +
          '<b>' + n + '</b>' + (names[n] ? '<small>' + esc(names[n]) + '</small>' : '') + '</button>';
      }).join('') + '</div>';
  }

  // box 안의 격자에 클릭 연결. 선택이 바뀔 때마다 onChange()
  function bind(box, selected, onChange) {
    box.addEventListener('click', function (e) {
      const b = e.target.closest('.no-btn, [data-pick]');
      if (!b || !box.contains(b)) return;
      if (b.dataset.pick === 'all') DN.Records.studentNumbers().forEach(function (n) { selected.add(n); });
      else if (b.dataset.pick === 'none') selected.clear();
      else {
        const n = +b.dataset.no;
        if (selected.has(n)) selected.delete(n); else selected.add(n);
      }
      box.querySelectorAll('.no-btn').forEach(function (x) { x.setAttribute('aria-pressed', String(selected.has(+x.dataset.no))); });
      const cnt = box.querySelector('.picker-count');
      if (cnt) cnt.textContent = selected.size + '명 선택';
      if (onChange) onChange();
    });
  }

  function listText(nos) {
    return nos.slice().sort(function (a, b) { return a - b; }).map(function (n) { return n + '번'; }).join('·');
  }

  return { html, bind, listText };
})();
