// 체험 모드. LLM 없이, 미리 만들어 둔 결과(core/samples)를 "AI가 지금 쓰는 중"처럼 한 쪽씩 보여 준다.
// 실전 모드와 같은 승인 모달을 먼저 띄우고, 고양이는 노트북 앞에서 타자를 치며 쪽이 생길 때마다 종이가 wiki 폴더로 날아간다.
//  replay: 'raw'    n      재료 n편을 raw/ 에 넣는다 (물고 가는 연출)
//  replay: 'ingest' stage  n편째까지의 결과를 쓴다
//  replay: 'query'         질문 3개 중 하나 → 출처 달린 답 → 저장
//  replay: 'lint'          점검 결과 → 고치기
//  replay: 'schema'        규칙 한 줄 덧붙이기 → 다시 요리 → 달라진 쪽
'use strict';
const { samples } = require('./samples');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = (p) => String(p).split('/').pop().replace(/\.md$/, '');

async function confirm(engine, items) {
  const text = (o) => engine.text(o);
  const fresh = items.filter((w) => w.op !== 'append');
  if (!fresh.length) return true;
  const ok = await engine.plugin.confirmWrites(fresh.map((w) => engine.practice.describe(w, text)));
  if (!ok) await engine.host.say(engine.T.t('engine.declined'), { ms: 4000 });
  return ok;
}

// 쪽을 하나씩 쓰면서 고양이가 타자를 치고 종이를 날린다
async function cook(engine, L, items, live) {
  const h = engine.host;
  const T = engine.T;
  const text = (o) => engine.text(o);
  const to = await h.locate(engine.anchor('folder:practice:wiki'));
  h.mood('busy');
  let n = 0;
  for (const w of items) {
    if (!live()) break;
    if (w.op === 'put') {
      h.clearBubbles();
      h.say(T.t('replay.writing', { name: base(w.path) }), { ms: 1400, kind: 'status' });
      await sleep(900);
      if (to) h.fx({ type: 'paper', to: { x: to.x, y: to.y }, ms: 800 });
      n++;
    }
    await engine.practice.apply(w, L.id, text);
    if (w.op === 'put') await sleep(500);
  }
  engine.checks.feed();
  h.mood('idle');
  h.clearBubbles();
  return n;
}

async function raw(engine, step, L, live) {
  const S = samples(engine.T.lang);
  const r = S.RAW[step.n - 1];
  const w = { op: 'put', path: 'practice:raw/' + r.name, content: r.content };
  if (!(await confirm(engine, [w]))) return 'stop';
  if (step.carry !== false) await engine.host.carry(engine.anchor(step.from || 'editor'), engine.anchor('folder:practice:raw'));
  if (!live()) return 'stop';
  await engine.practice.apply(w, L.id, (o) => engine.text(o));
  engine.checks.feed();
}

async function ingest(engine, step, L, live) {
  const S = samples(engine.T.lang);
  const items = S.STAGES[step.stage];
  if (!(await confirm(engine, items))) return 'stop';
  const n = await cook(engine, L, items, live);
  if (!live()) return 'stop';
  // 이 재료는 요리했다 (실전 모드가 다시 묶지 않게)
  const st = engine.plugin.state;
  st.ingested = [...new Set([...(st.ingested || []), 'raw/' + S.RAW[step.stage - 1].name])];
  await engine.host.say(engine.T.t('replay.ingestDone', { n }), { kind: 'cheer' });
}

// 질문 셋 중 하나 → 출처 달린 답 → 저장. 보고 나면 다시 목록으로 (다른 것도 물어볼 수 있게). "넘어가기"로 끝
async function query(engine, step, L, live) {
  const S = samples(engine.T.lang);
  const h = engine.host;
  const T = engine.T;
  const seen = new Set();
  for (;;) {
    h.clearBubbles();
    const i = await h.card(T.t('replay.queryTitle'), T.t('replay.queryIntro'), [...S.QUERY.map((q, k) => (seen.has(k) ? '✓ ' : '') + q.q), T.t('engine.skip')]);
    if (!live()) return 'stop';
    if (i < 0 || i >= S.QUERY.length) return;
    seen.add(i);
    const q = S.QUERY[i];
    h.mood('busy');
    await sleep(1200);
    h.mood('idle');
    const body = `${q.a}\n\n${T.t('replay.sources')}: ${q.sources.map((p) => `[[${base(p)}]]`).join(' · ')}`;
    const r = await h.card(q.q, body, [T.t('replay.save'), T.t('engine.back')]);
    if (!live()) return 'stop';
    if (r === 0) {
      const content = `# ${q.q}\n\n${q.a}\n\n${T.t('replay.sources')}:\n${q.sources.map((p) => `- [[${base(p)}]]`).join('\n')}\n`;
      await engine.practice.apply({ op: 'put', path: 'practice:' + q.save, content }, L.id, (o) => engine.text(o));
      await engine.practice.apply({ op: 'append', path: 'practice:' + S.PATHS.LOG, content: `- query · ${q.q} → ${base(q.save)}\n` }, L.id, (o) => engine.text(o));
      engine.checks.feed();
      h.act('tbagin');
      await sleep(2300);
      await h.say(T.t('replay.saved'), { ms: 4000 });
    }
  }
}

async function lint(engine, step, L, live) {
  const S = samples(engine.T.lang);
  const h = engine.host;
  const T = engine.T;
  // 돋보기로 바닥을 훑다가 종이 두 장을 비교하고 "!"
  h.prop('magnify', true);
  await sleep(3300);
  h.prop('magnify', false);
  h.act('tcompare');
  await sleep(2500);
  const body = S.LINT.findings.map((f, i) => `${i + 1}. ${f.text}`).join('\n\n');
  const r = await h.card(T.t('replay.lintTitle'), body, [T.t('replay.fix'), T.t('replay.lintLater')]);
  if (!live()) return 'stop';
  if (r !== 0) return;
  if (!(await confirm(engine, S.LINT.fix))) return 'stop';
  await cook(engine, L, S.LINT.fix, live);
  if (!live()) return 'stop';
  await h.say(T.t('replay.fixed'), { kind: 'cheer' });
}

async function schema(engine, step, L, live) {
  const S = samples(engine.T.lang);
  const h = engine.host;
  const T = engine.T;
  const rule = { op: 'append', path: 'practice:AGENTS.md', content: S.SCHEMA.rule };
  const ok = await engine.plugin.confirmWrites([{ ...engine.practice.describe(rule, (o) => engine.text(o)), op: 'append' }]);
  if (!ok) {
    await h.say(T.t('engine.declined'), { ms: 4000 });
    return 'stop';
  }
  await engine.practice.apply(rule, L.id, (o) => engine.text(o));
  engine.checks.feed();
  h.act('tsticknote');
  await sleep(2400);
  await h.say(T.t('replay.ruleAdded'), { ms: 3500 });
  if (!live()) return 'stop';
  if (!(await confirm(engine, S.SCHEMA.after))) return 'stop';
  await cook(engine, L, S.SCHEMA.after, live);
  if (!live()) return 'stop';
  const changed = S.SCHEMA.after.filter((w) => w.op === 'put').map((w) => `- [[${base(w.path)}]]`).join('\n');
  await h.card(T.t('replay.schemaTitle'), `${T.t('replay.schemaBody')}\n\n${changed}`, [T.t('replay.ok')]);
}

const KINDS = { raw, ingest, query, lint, schema };

function run(engine, step, L, live) {
  const f = KINDS[step.replay];
  if (!f) throw new Error('unknown replay ' + step.replay);
  return f(engine, step, L, live);
}

module.exports = { run, KINDS: Object.keys(KINDS) };
