// 실전 모드 (B8). 사용자가 이미 쓰는 AI 로 진짜 ingest 를 한 번 한다. 플러그인은 LLM 을 부르지 않는다.
//  real: 'askMode'      평소 쓰는 AI 를 묻는다 → vars.mode = 'folder'(클로드 데스크톱 앱, 폴더 연결) | 'paste'(그 밖, 복붙)
//  real: 'folderGuide'  클로드 앱에 볼트 폴더를 연결하는 법 카드 + 확인 프롬프트 복사
//  real: 'ingest'       folder: ingest 프롬프트 복사 카드 / paste: 프롬프트 묶어 복사 → 답 붙여넣기 → 쪽으로 쪼개 승인 → 적용
//  real: 'promptCards'  졸업 선물: 매일 쓸 프롬프트 3장 복사 버튼
'use strict';
const clipboard = require('./clipboard');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function copy(engine, text) {
  try {
    await navigator.clipboard.writeText(text);
    engine.plugin.notice(engine.T.t('real.copied'));
    return true;
  } catch (e) {
    console.error('[LLM Wiki Tutor] clipboard', e);
    engine.plugin.notice(engine.T.t('real.copyFailed'));
    return false;
  }
}

async function readPractice(engine, rel) {
  const f = engine.app.vault.getAbstractFileByPath(engine.path('practice:' + rel));
  if (!f || Array.isArray(f.children)) return '';
  return engine.app.vault.cachedRead(f);
}

// 아직 요리 안 한 재료 (raw/ 안의 .md 중 ingested 목록에 없는 것, 안내문 제외)
async function freshRaws(engine) {
  const root = engine.path('practice:raw');
  const folder = engine.app.vault.getAbstractFileByPath(root);
  if (!folder || !Array.isArray(folder.children)) return [];
  const done = new Set(engine.plugin.state.ingested || []);
  const out = [];
  for (const f of folder.children) {
    if (Array.isArray(f.children) || f.extension !== 'md') continue;
    const rel = 'raw/' + f.name;
    if (done.has(rel) || /읽어 주세요|README/i.test(f.name)) continue;
    out.push({ name: f.name, rel, content: await engine.app.vault.cachedRead(f) });
  }
  return out;
}

function markIngested(engine, rels) {
  const st = engine.plugin.state;
  st.ingested = [...new Set([...(st.ingested || []), ...rels])];
  engine.plugin.saveSoon();
}

async function askMode(engine) {
  const T = engine.T;
  const i = await engine.host.ask(T.t('real.askMode'), [T.t('real.modeClaude'), T.t('real.modeOther')]);
  engine.progress.vars.mode = i === 0 ? 'folder' : 'paste';
  engine.progress.vars.modeIdx = i;
  await engine.plugin.save();
}

async function folderGuide(engine, step, L, live) {
  const T = engine.T;
  const h = engine.host;
  const vaultName = engine.app.vault.getName();
  const r = await h.card(T.t('real.folderTitle'), T.t('real.folderBody', { vault: vaultName }), [T.t('real.copyCheck'), T.t('real.ok')]);
  if (!live()) return 'stop';
  if (r === 0) {
    await copy(engine, T.t('real.checkPrompt'));
    await h.say(T.t('real.checkSay'), { ms: 6000 });
  }
}

async function ingestFolder(engine, L, live) {
  const T = engine.T;
  const h = engine.host;
  const root = engine.practice.root();
  const prompt = T.t('real.ingestPrompt', { root });
  const r = await h.card(T.t('real.ingestFolderTitle'), T.t('real.ingestFolderBody', { root }), [T.t('real.copyPrompt'), T.t('real.ok')]);
  if (!live()) return 'stop';
  if (r === 0) await copy(engine, prompt);
  await h.say(T.t('real.waitFolder'), { ms: 6000 });
}

async function ingestPaste(engine, L, live) {
  const T = engine.T;
  const h = engine.host;
  const raws = await freshRaws(engine);
  if (!raws.length) {
    await h.say(T.t('real.noFresh'), { ms: 5000 });
    return;
  }
  const prompt = clipboard.build('ingest', { lang: T.lang, agents: await readPractice(engine, 'AGENTS.md'), index: await readPractice(engine, 'wiki/index.md'), raws });
  const r = await h.card(T.t('real.pasteTitle'), T.t('real.pasteBody', { n: raws.length }), [T.t('real.copyPrompt'), T.t('engine.later')]);
  if (!live()) return 'stop';
  if (r !== 0) return 'stop';
  await copy(engine, prompt);
  await h.say(T.t('real.pasteSay'), { ms: 7000 });
  // 답 붙여넣기
  for (;;) {
    const text = await engine.plugin.askPaste();
    if (!live()) return 'stop';
    if (text == null) {
      await h.say(T.t('engine.laterOk'), { ms: 4000 });
      return 'stop';
    }
    const parsed = clipboard.parse(text, engine.practice.root());
    let writes;
    if (!parsed || !parsed.files.length) {
      // 경계 표시가 없으면 통째로 한 쪽에 — 사용자가 나중에 나눈다
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '');
      writes = [{ op: 'put', path: `practice:wiki/${T.t('real.rawAnswerName', { stamp })}.md`, content: String(text).trim() + '\n' }];
      await h.say(T.t('real.noBlocks'), { ms: 6000 });
    } else {
      writes = parsed.files.map((f) => ({ op: 'put', path: 'practice:' + f.path, content: f.content }));
      if (parsed.skipped.length) engine.plugin.notice(T.t('real.skipped', { n: parsed.skipped.length }));
    }
    const text2 = (o) => engine.text(o);
    const ok = await engine.plugin.confirmWrites(writes.map((w) => engine.practice.describe(w, text2)));
    if (!live()) return 'stop';
    if (!ok) continue; // 다시 붙여넣을 기회
    for (const w of writes) await engine.practice.apply(w, L.id, text2);
    // index · log 가 답에 없었으면 플러그인이 한 줄씩 채운다
    const paths = new Set(writes.map((w) => w.path));
    if (!paths.has('practice:wiki/index.md')) {
      const lines = writes.filter((w) => !/wiki\/(index|log)\.md$/.test(w.path)).map((w) => `- [[${w.path.split('/').pop().replace(/\.md$/, '')}]]`);
      if (lines.length) await engine.practice.apply({ op: 'append', path: 'practice:wiki/index.md', content: `\n${lines.join('\n')}\n` }, L.id, text2);
    }
    if (!paths.has('practice:wiki/log.md')) await engine.practice.apply({ op: 'append', path: 'practice:wiki/log.md', content: `- ingest · ${raws.map((r) => r.name).join(', ')} → ${writes.length} ${T.t('real.pages')}\n` }, L.id, text2);
    markIngested(engine, raws.map((r) => r.rel));
    engine.checks.feed();
    h.fx({ type: 'confetti' });
    await h.say(T.t('real.applied', { n: writes.length }), { kind: 'cheer' });
    return;
  }
}

async function ingest(engine, step, L, live) {
  // 이 시각 뒤에 wiki/ 에 생긴 파일을 "진짜 요리 결과"로 센다 (레슨의 waitFor newFileUnder since: '$ingestAt')
  engine.progress.vars.ingestAt = Date.now();
  engine.plugin.saveSoon();
  return engine.progress.vars.mode === 'folder' ? ingestFolder(engine, L, live) : ingestPaste(engine, L, live);
}

async function promptCards(engine, step, L, live) {
  const T = engine.T;
  const h = engine.host;
  const root = engine.practice.root();
  const cards = [1, 2, 3].map((n) => ({ label: T.t(`real.card${n}`), text: T.t(`real.card${n}Text`, { root }) }));
  for (;;) {
    const r = await h.card(T.t('real.cardsTitle'), T.t('real.cardsBody'), [...cards.map((c) => c.label), T.t('replay.close')]);
    if (!live()) return 'stop';
    if (r < 0 || r >= cards.length) return;
    await copy(engine, cards[r].text);
    await sleep(600);
  }
}

const KINDS = { askMode, folderGuide, ingest, promptCards };

function run(engine, step, L, live) {
  const f = KINDS[step.real];
  if (!f) throw new Error('unknown real step ' + step.real);
  return f(engine, step, L, live);
}

module.exports = { run, KINDS: Object.keys(KINDS), freshRaws, markIngested };
