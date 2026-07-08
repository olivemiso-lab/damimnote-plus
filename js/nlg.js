// ════════════════════════════════════════════════════
//  담임노트+ · 규칙 기반 문장 생성 엔진 (DN.NLG)
//  - 관찰 항목 선택 → 자연스러운 생활기록부형 문장 조합
//  - 서버/AI 없이 동작. 4단계 행동특성 작성에서도 재사용
// ════════════════════════════════════════════════════
window.DN = window.DN || {};

DN.NLG = (function () {

  // 관찰 항목 정의 (화면·문장 공용)
  const OBS_ITEMS = [
    { key: 'participation', label: '수업 참여',   opts: [{ v: 'good', t: '적극적' }, { v: 'mid', t: '보통' }, { v: 'low', t: '소극적' }] },
    { key: 'presentation',  label: '발표',        opts: [{ v: 'good', t: '적극적' }, { v: 'mid', t: '보통' }, { v: 'low', t: '소극적' }] },
    { key: 'cooperation',   label: '협력',        opts: [{ v: 'good', t: '우수' }, { v: 'mid', t: '보통' }, { v: 'low', t: '노력 필요' }] },
    { key: 'care',          label: '배려',        opts: [{ v: 'good', t: '우수' }, { v: 'mid', t: '보통' }, { v: 'low', t: '노력 필요' }] },
    { key: 'responsibility', label: '책임감',     opts: [{ v: 'good', t: '우수' }, { v: 'mid', t: '보통' }, { v: 'low', t: '노력 필요' }] },
    { key: 'habit',         label: '생활 습관',   opts: [{ v: 'good', t: '우수' }, { v: 'mid', t: '보통' }, { v: 'low', t: '노력 필요' }] },
    { key: 'project',       label: '프로젝트 참여', opts: [{ v: 'good', t: '적극적' }, { v: 'mid', t: '보통' }, { v: 'low', t: '소극적' }] },
  ];

  // 문장 사전 — { mid: 연결형, end: 종결형 }  (긍정·성장 중심 표현)
  const P = {
    participation: {
      good: { mid: '수업 활동에 적극적으로 참여하고', end: '수업 활동에 적극적으로 참여함' },
      mid:  { mid: '수업 활동에 꾸준히 참여하고', end: '수업 활동에 꾸준히 참여함' },
      low:  { mid: '수업에 차분히 참여하며 점차 자신감을 키워가고', end: '수업에 차분히 참여하며 점차 자신감을 키워가는 모습을 보임' },
    },
    presentation: {
      good: { mid: '자신의 생각을 자신 있게 발표하며', end: '자신의 생각을 자신 있게 발표함' },
      mid:  { mid: '발표 활동에 참여하며', end: '발표 활동에 참여함' },
      low:  { mid: '발표할 때 신중한 태도를 보이며 표현력을 길러가고', end: '발표할 때 신중한 태도를 보이며 표현력을 길러감' },
    },
    cooperation: {
      good: { mid: '친구들과 협력하여 과제를 해결하고', end: '친구들과 협력하여 과제를 해결함' },
      mid:  { mid: '친구들과 어울려 활동에 참여하고', end: '친구들과 어울려 활동에 참여함' },
      low:  { mid: '친구들과 협력하는 방법을 배워가며', end: '친구들과 협력하는 방법을 배워감' },
    },
    care: {
      good: { mid: '친구를 배려하는 마음이 돋보이며', end: '친구를 배려하는 마음이 돋보임' },
      mid:  { mid: '친구들과 원만하게 지내며', end: '친구들과 원만하게 지냄' },
      low:  { mid: '친구의 마음을 헤아리는 태도를 길러가고', end: '친구의 마음을 헤아리는 태도를 길러감' },
    },
    responsibility: {
      good: { mid: '자신의 역할을 책임감 있게 수행하고', end: '자신의 역할을 책임감 있게 수행함' },
      mid:  { mid: '맡은 일을 성실히 해내며', end: '맡은 일을 성실히 해냄' },
      low:  { mid: '맡은 일을 끝까지 해내려는 책임감을 키워가고', end: '맡은 일을 끝까지 해내려는 책임감을 키워감' },
    },
    habit: {
      good: { mid: '기본 생활 습관이 바르게 형성되어 있으며', end: '기본 생활 습관이 바르게 형성되어 있음' },
      mid:  { mid: '규칙적인 생활 습관을 지키며', end: '규칙적인 생활 습관을 지킴' },
      low:  { mid: '바른 생활 습관을 형성해가고', end: '바른 생활 습관을 형성해감' },
    },
    project: {
      good: { mid: '프로젝트 활동에 주도적으로 참여하고', end: '프로젝트 활동에 주도적으로 참여함' },
      mid:  { mid: '프로젝트 활동에 관심을 가지고 참여하며', end: '프로젝트 활동에 관심을 가지고 참여함' },
      low:  { mid: '프로젝트 활동에 참여하며 흥미를 키워가고', end: '프로젝트 활동에 참여하며 흥미를 키워감' },
    },
  };

  // 선택된 항목들 → 문장 생성 (3개씩 한 문장으로 묶음)
  function generate(rec) {
    const frags = [];
    OBS_ITEMS.forEach(it => {
      const v = rec[it.key];
      if (v && P[it.key] && P[it.key][v]) frags.push(P[it.key][v]);
    });
    if (!frags.length) return '';
    const sentences = [];
    for (let i = 0; i < frags.length; i += 3) {
      const chunk = frags.slice(i, i + 3);
      const parts = chunk.map((f, idx) => idx === chunk.length - 1 ? f.end : f.mid);
      sentences.push(parts.join(' ') + '.');
    }
    return sentences.join(' ');
  }

  // 한 줄 요약(타임라인용) — 선택 항목 라벨
  function summary(rec) {
    const picks = [];
    OBS_ITEMS.forEach(it => {
      if (rec[it.key]) {
        const o = it.opts.find(o => o.v === rec[it.key]);
        if (o) picks.push(`${it.label} ${o.t}`);
      }
    });
    return picks.join(' · ');
  }

  // ── 행동특성 및 종합의견 초안 ──
  // analysis: DN.Growth.analyze() 결과 / student: 학생 레코드 / mode: 'short'|'normal'|'detail'
  // 원칙: 강점 우선 · 성장 중심 · 긍정 표현 · 낙인/과장 배제
  function behaviorReport(analysis, student, mode) {
    const ORDER = { good: 0, mid: 1, low: 2 };
    let items = (analysis && analysis.withData ? analysis.withData.slice() : [])
      .sort((a, b) => (ORDER[a.level] - ORDER[b.level]) || (b.avg - a.avg));
    const limit = mode === 'short' ? 2 : mode === 'normal' ? 4 : items.length;
    const picked = items.slice(0, limit);

    const rec = {};
    picked.forEach(i => { rec[i.key] = i.level; });
    let text = generate(rec); // 항목 기반 핵심 문장

    const extra = [];
    if (mode !== 'short') {
      // 긍정 특성만 반영(부정 특성은 낙인 방지를 위해 서술하지 않음)
      if (student.leadership === 'high') extra.push('학급에서 모범을 보이며 친구들을 이끄는 리더십이 돋보임.');
      if (student.easygoing) extra.push('성격이 원만하여 여러 친구들과 두루 잘 어울림.');
    }
    if (mode === 'detail' && analysis) {
      if (analysis.improving.length)
        extra.push(`특히 ${analysis.improving.map(i => i.label).join(', ')} 면에서 꾸준한 성장을 보임.`);
      if (analysis.supports.length)
        extra.push(`${analysis.supports.map(i => i.label).join(', ')} 영역은 앞으로 더욱 성장할 수 있도록 따뜻한 격려가 필요함.`);
    } else if (mode === 'normal' && analysis && analysis.supports.length) {
      extra.push(`${analysis.supports[0].label} 영역에서 한 걸음씩 성장할 수 있도록 지속적으로 격려함.`);
    }

    const out = (text + ' ' + extra.join(' ')).trim();
    return out;
  }

  return { OBS_ITEMS, generate, summary, behaviorReport };
})();
