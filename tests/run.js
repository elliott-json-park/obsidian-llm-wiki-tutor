'use strict';
/*
 * 레슨 데이터 검사.   node tests/run.js
 * - 모든 글에 ko 가 있는지. en · zh 는 lessons/en.js · zh.js 가 한국어 원문을 열쇠로 채운다. 한국어를 고쳐 열쇠가 안 맞으면
 *   실패가 아니라 "번역 대기"로 센다 (그 줄의 번역을 새로 넣으면 0 으로 돌아온다)
 *   (있는 것은 자리표시 · '||' 수가 한국어와 같은지 본다)
 * - waitFor 의 조건이 checks.js 에 있는지, 단계 종류를 아는지, anchor 형식이 맞는지, 레슨 id 가 겹치지 않는지
 * - 글에 든 자리표시({root} 등)가 양쪽 언어에 같은지
 */
const path = require('path');
const { ALL, NOTES_MISSING } = require(path.join(__dirname, '..', 'src', 'core', 'lessons'));
const { CONDS, writtenLines } = require(path.join(__dirname, '..', 'src', 'core', 'checks'));
const I18N = require(path.join(__dirname, '..', 'src', 'kit', 'i18n'));

let fails = 0;
let pending = 0; // en · zh 번역 대기
const fail = (m) => {
  fails++;
  console.log('FAIL', m);
};

const LANGS = ['ko', 'en', 'zh'];
const STEP_KEYS = ['say', 'card', 'faq', 'do', 'write', 'writes', 'waitFor', 'quiz', 'if', 'showInFolder', 'open', 'replay', 'real', 'command', 'stop', 'done'];
const REPLAYS = ['raw', 'ingest', 'query', 'lint', 'schema'];
const REALS = ['askMode', 'folderGuide', 'ingest', 'promptCards'];
const clipboard = require(path.join(__dirname, '..', 'src', 'core', 'clipboard'));
const { SAMPLES } = require(path.join(__dirname, '..', 'src', 'core', 'samples'));
const DOS = ['goto', 'point', 'unpoint', 'carry', 'prop', 'act', 'fx', 'mood', 'wait'];
const OPS = ['folder', 'note', 'append', 'move'];
const ANCHOR_RE = /^(folder|file|ribbon|sel|x):.+|^(graph|editor|statusbar)$/;
const FIGURES = ['rooms', 'ingest', 'ops', 'markdown', 'links', 'loop', 'roles'];
// anchor · 경로는 문자열이거나 { ko, en } (두 언어 다 형식에 맞아야 한다)
const ANCHOR = { test: (a) => (typeof a === 'string' ? ANCHOR_RE.test(a) : !!a && LANGS.every((l) => ANCHOR_RE.test(a[l]))) };
const PRACTICE = { test: (p) => (typeof p === 'string' ? /^practice:/.test(p) : !!p && LANGS.every((l) => /^practice:/.test(p[l]))) };

function checkText(o, where) {
  if (o == null) return fail(`${where}: no text`);
  if (typeof o === 'string') return;
  if (typeof o.ko !== 'string' || !o.ko.trim()) return fail(`${where}: missing ko`);
  const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
  const parts = (s) => String(s).split('||').length;
  for (const l of LANGS.slice(1)) {
    if (typeof o[l] !== 'string' || !o[l].trim()) {
      pending++;
      continue;
    }
    if (ph(o.ko) !== ph(o[l])) fail(`${where}: placeholders differ ko=${ph(o.ko)} ${l}=${ph(o[l])}`);
    if (parts(o.ko) !== parts(o[l])) fail(`${where}: '||' count differs (${l})`);
  }
}

function checkFigure(f, where) {
  if (!f) return;
  if (!FIGURES.includes(f.kind)) fail(`${where}: unknown figure ${f.kind}`);
  if (!f.labels) return fail(`${where}: figure without labels`);
  if (!Array.isArray(f.labels.ko) || !f.labels.ko.length) return fail(`${where}: figure labels ko`);
  for (const l of LANGS.slice(1)) {
    if (!Array.isArray(f.labels[l])) pending++;
    else if (f.labels[l].length !== f.labels.ko.length) fail(`${where}: figure labels ${l}`);
  }
}

function checkStep(s, where) {
  const kind = STEP_KEYS.find((k) => s[k] !== undefined);
  if (!kind) return fail(`${where}: unknown step ${JSON.stringify(s).slice(0, 60)}`);
  [].concat(s.note || []).forEach((n, i) => checkText(n, `${where}.note[${i}]`));
  if (kind === 'say') {
    checkText(s.say, where);
    if (s.title) checkText(s.title, where + '.title');
    checkFigure(s.figure, where);
    if (s.choices) {
      if (s.choices.length < 1 || s.choices.length > 2) fail(`${where}: choices must be 1~2`);
      s.choices.forEach((c, i) => checkText(c, `${where}.choices[${i}]`));
      if (!s.as) fail(`${where}: choices without 'as'`);
    }
  } else if (kind === 'card') {
    checkText(s.card.title, where + '.title');
    checkText(s.card.body, where + '.body');
    (s.card.buttons || []).forEach((b, i) => checkText(b, `${where}.buttons[${i}]`));
    checkFigure(s.card.figure, where);
  } else if (kind === 'faq') {
    checkText(s.faq.title, where + '.title');
    if (s.faq.intro) checkText(s.faq.intro, where + '.intro');
    if (!s.faq.items || s.faq.items.length < 1 || s.faq.items.length > 3) fail(`${where}: faq items must be 1~3`);
    (s.faq.items || []).forEach((it, i) => {
      checkText(it.q, `${where}.items[${i}].q`);
      checkText(it.a, `${where}.items[${i}].a`);
      checkFigure(it.figure, `${where}.items[${i}]`);
    });
  } else if (kind === 'do') {
    if (!DOS.includes(s.do)) fail(`${where}: unknown do ${s.do}`);
    for (const k of ['anchor', 'from', 'to']) if (s[k] && !ANCHOR.test(s[k])) fail(`${where}: bad anchor ${s[k]}`);
    if (s.label) checkText(s.label, where + '.label');
  } else if (kind === 'write' || kind === 'writes') {
    (s.writes || [s.write]).forEach((w, i) => {
      const at = kind === 'writes' ? `${where}.writes[${i}]` : where;
      if (!OPS.includes(w.op)) fail(`${at}: unknown op ${w.op}`);
      if (!PRACTICE.test(w.path)) fail(`${at}: write outside practice: ${JSON.stringify(w.path)}`);
      if (w.content) checkText(w.content, at + '.content');
    });
  } else if (kind === 'open') {
    if (!PRACTICE.test(s.open)) fail(`${where}: open outside practice`);
  } else if (kind === 'replay') {
    if (!REPLAYS.includes(s.replay)) fail(`${where}: unknown replay ${s.replay}`);
    if (s.replay === 'raw' && !(s.n >= 1 && s.n <= 3)) fail(`${where}: raw n`);
    if (s.replay === 'ingest' && !(s.stage >= 1 && s.stage <= 3)) fail(`${where}: ingest stage`);
  } else if (kind === 'real') {
    if (!REALS.includes(s.real)) fail(`${where}: unknown real ${s.real}`);
  } else if (kind === 'command') {
    if (typeof s.command !== 'string') fail(`${where}: command`);
    if (s.via && !ANCHOR.test(s.via)) fail(`${where}: bad via anchor`);
    if (s.viaLabel) checkText(s.viaLabel, where + '.viaLabel');
    if (s.viaSay) checkText(s.viaSay, where + '.viaSay');
  } else if (kind === 'waitFor') {
    if (!CONDS[s.waitFor]) fail(`${where}: unknown condition ${s.waitFor}`);
    for (const v of Object.values(s.args || {})) if (v && typeof v === 'object' && !PRACTICE.test(v)) fail(`${where}: bad arg ${JSON.stringify(v)}`);
    if (s.hint) {
      if (s.hint.say) checkText(s.hint.say, where + '.hint');
      if (s.hint.anchor && !ANCHOR.test(s.hint.anchor)) fail(`${where}: bad hint anchor`);
    }
    if (s.fallback) checkStep(s.fallback, where + '.fallback');
  } else if (kind === 'quiz') {
    const q = s.quiz;
    checkText(q.q, where + '.q');
    q.choices.forEach((c, i) => checkText(c, `${where}.choices[${i}]`));
    if (!(q.answer >= 0 && q.answer < q.choices.length)) fail(`${where}: bad answer`);
    checkText(q.fb, where + '.fb');
    if (q.wrong) checkText(q.wrong, where + '.wrong');
  } else if (kind === 'if') {
    if (typeof s.if !== 'string') fail(`${where}: if needs var name`);
    (s.then || []).forEach((x, i) => checkStep(x, `${where}.then[${i}]`));
    (s.else || []).forEach((x, i) => checkStep(x, `${where}.else[${i}]`));
  } else if (kind === 'showInFolder') {
    if (!PRACTICE.test(s.showInFolder)) fail(`${where}: showInFolder outside practice`);
  }
}

for (const [id, at] of NOTES_MISSING) fail(`notes: ${id} 에서 "${at}" 단계를 못 찾음`);
const ids = new Set();
for (const L of ALL) {
  if (ids.has(L.id)) fail(`duplicate lesson id ${L.id}`);
  ids.add(L.id);
  checkText(L.title, `${L.id}.title`);
  if (!L.intro) fail(`${L.id}: no intro`);
  else checkText(L.intro, `${L.id}.intro`);
  if (!(L.minutes > 0)) fail(`${L.id}: minutes`);
  if (!L.steps.some((s) => s.done)) fail(`${L.id}: no done step`);
  L.steps.forEach((s, i) => checkStep(s, `${L.id}[${i}]`));
}

// 체험 모드 샘플: 세 언어가 같은 꼴인지, 쓰기가 전부 연습 폴더의 raw/·wiki/·AGENTS.md 안인지
for (const lang of LANGS) {
  const S = SAMPLES[lang];
  if (!S) {
    fail(`samples.${lang}: missing`);
    continue;
  }
  if (S.RAW.length !== 3) fail(`samples.${lang}: RAW must be 3`);
  const writes = [...S.STAGES[1], ...S.STAGES[2], ...S.STAGES[3], ...S.LINT.fix, ...S.SCHEMA.after];
  for (const w of writes) {
    if (!/^practice:(wiki\/|raw\/|AGENTS\.md$)/.test(w.path)) fail(`samples.${lang}: write outside wiki/raw: ${w.path}`);
    if (!['put', 'append'].includes(w.op)) fail(`samples.${lang}: op ${w.op}`);
    if (typeof w.content !== 'string' || !w.content.trim()) fail(`samples.${lang}: empty content ${w.path}`);
  }
  if (S.QUERY.length !== 3) fail(`samples.${lang}: QUERY must be 3`);
  for (const q of S.QUERY) if (!/^wiki\/answers\//.test(q.save)) fail(`samples.${lang}: answer save path ${q.save}`);
  if (S.LINT.findings.length !== 3) fail(`samples.${lang}: LINT findings must be 3`);
}
for (const l of LANGS.slice(1)) {
  if (!SAMPLES[l]) continue;
  for (const k of [1, 2, 3]) if (SAMPLES.ko.STAGES[k].length !== SAMPLES[l].STAGES[k].length) fail(`samples: stage ${k} length differs ko/${l}`);
  if (SAMPLES.ko.LINT.fix.length !== SAMPLES[l].LINT.fix.length) fail(`samples: lint fix length differs (${l})`);
  // B7 예시 규칙(11차)은 아직 한국어판만 있다. en · zh 를 다시 옮길 때까지 번역 대기로 센다
  if (SAMPLES.ko.SCHEMA.after.length !== SAMPLES[l].SCHEMA.after.length) pending++;
}

// 복붙 길 파서
{
  const ans = `안녕! 요리했어.\n=== FILE: wiki/sources/오늘.md ===\n# 오늘 (요약)\n\n한 줄: 테스트\n=== END ===\n\n=== FILE: 세컨드 브레인 연습/wiki/concepts/습관.md ===\n# 습관\n=== END ===\n=== FILE: ../etc/passwd ===\nx\n=== END ===\n=== FILE: raw/01.md ===\ny\n=== END ===\n끝.`;
  const r = clipboard.parse(ans, '세컨드 브레인 연습');
  if (!r || r.files.length !== 2) fail('clipboard.parse: expected 2 files, got ' + (r && r.files.length));
  else {
    if (r.files[0].path !== 'wiki/sources/오늘.md' || !r.files[0].content.startsWith('# 오늘')) fail('clipboard.parse: file 0 ' + JSON.stringify(r.files[0]));
    if (r.files[1].path !== 'wiki/concepts/습관.md') fail('clipboard.parse: root prefix not stripped');
    if (r.skipped.length !== 2) fail('clipboard.parse: expected 2 skipped, got ' + r.skipped.length);
  }
  if (clipboard.parse('그냥 말만 있음', 'x') !== null) fail('clipboard.parse: plain text should be null');
  const b = clipboard.build('ingest', { lang: 'ko', agents: '# 규칙', index: '# 차림표', raws: [{ name: 'a.md', content: 'A' }] });
  if (!/=== RAW: raw\/a\.md ===/.test(b) || !/=== FILE: wiki\//.test(b)) fail('clipboard.build: missing sections');
  const q = clipboard.build('query', { lang: 'en', agents: 'r', index: 'i', question: 'why?' });
  if (!/why\?/.test(q) || !/wiki\/answers\//.test(q)) fail('clipboard.build: query');
}

// UI 글: 세 언어 키가 같은지
{
  const ko = Object.keys(I18N.UI.ko).sort();
  for (const l of LANGS.slice(1)) {
    const o = Object.keys(I18N.UI[l] || {}).sort();
    if (ko.join() !== o.join()) fail(`i18n keys differ (${l}): ` + ko.filter((k) => !o.includes(k)).concat(o.filter((k) => !ko.includes(k))).join(','));
  }
}

// 줄 세기
const n = writtenLines('# 오늘 알게 된 것\n\n- \n- 첫째\n- [ ] 둘째\n셋째\n').length;
if (n !== 3) fail('writtenLines expected 3, got ' + n);

const steps = ALL.reduce((a, L) => a + L.steps.length, 0);
console.log(`${ALL.length} lessons, ${steps} steps, ${fails} failures, en·zh 번역 대기 ${pending}`);
process.exit(fails ? 1 : 0);
