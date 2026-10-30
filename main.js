/*
 * LLM Wiki Tutor 1.0.2 — Obsidian plugin (built 2026-10-30)
 * 소스: src/ (node scripts/build.js 로 이 파일을 만든다)
 * 고양이 렌더러는 Vault Pet (MIT) 에서 가져왔다.
 */
const __ext = require;
const __defs = {};
const __cache = {};
function __resolve(from, req) {
  if (!req.startsWith('.')) return null;
  const parts = from.split('/').slice(0, -1);
  for (const p of req.replace(/\.js$/, '').split('/')) {
    if (p === '.') continue;
    if (p === '..') parts.pop();
    else parts.push(p);
  }
  return parts.join('/');
}
function __require(from) {
  return (req) => {
    let id = __resolve(from, req);
    if (id === null) return __ext(req);
    if (!__defs[id] && __defs[id + '/index']) id += '/index';
    if (!__defs[id]) throw new Error('LLM Wiki Tutor: module not found ' + req + ' from ' + from);
    if (__cache[id]) return __cache[id].exports;
    const m = { exports: {} };
    __cache[id] = m;
    __defs[id].call(m.exports, m, m.exports, __require(id));
    return m.exports;
  };
}

__defs["core/checks"] = function (module, exports, require) {
// 볼트 조건 판정. 레슨의 waitFor 가 기다리는 "사용자가 실제로 했나"를 여기서 본다.
// 플러그인이 볼트·작업 영역 이벤트를 feed() 로 넣어 주면, 기다리는 조건을 다시 본다 (250ms 묶음).
// 조건 함수는 (app, args) → boolean | Promise<boolean>. 경로는 엔진이 practice: 를 풀어서 넘긴다.
'use strict';

const isFolder = (f) => !!f && Array.isArray(f.children);
const fileAt = (app, path) => {
  const f = app.vault.getAbstractFileByPath(path);
  return f && !isFolder(f) ? f : null;
};
const folderAt = (app, path) => {
  const f = app.vault.getAbstractFileByPath(path);
  return isFolder(f) ? f : null;
};

// 사람이 쓴 줄만 센다: 제목(#) 줄과 글머리표만 있는 빈 줄은 뺀다
function writtenLines(text) {
  return String(text || '')
    .split('\n')
    .filter((s) => !/^\s*#/.test(s))
    .map((s) => s.replace(/^[\s\-*>]+(\[[ xX]\])?\s*/, '').trim())
    .filter((s) => s.length >= 2);
}

const CONDS = {
  always: () => true,
  fileExists: (app, { path }) => !!fileAt(app, path),
  folderExists: (app, { path }) => !!folderAt(app, path),
  // 그 파일이 지금 보고 있는 노트다
  fileOpened: (app, { path }) => {
    const f = app.workspace.getActiveFile();
    return !!f && f.path === path;
  },
  // 파일 안에 pattern(정규식, 여러 줄) 이 min 번 이상
  async fileHasText(app, { path, pattern, min = 1 }) {
    const f = fileAt(app, path);
    if (!f) return false;
    const t = await app.vault.cachedRead(f);
    const re = new RegExp(pattern, 'gm');
    return (t.match(re) || []).length >= min;
  },
  // 비어 있지 않은 줄이 min 개 이상 (A1 60초 도전)
  async linesWritten(app, { path, min = 3 }) {
    const f = fileAt(app, path);
    if (!f) return false;
    return writtenLines(await app.vault.cachedRead(f)).length >= min;
  },
  // from 노트가 to 노트로 [[링크]] 한다
  linkBetween: (app, { from, to }) => {
    const r = app.metadataCache.resolvedLinks[from];
    return !!(r && r[to]);
  },
  graphOpened: (app) => app.workspace.getLeavesOfType('graph').length > 0,
  // 파일 탐색기에서 그 폴더가 펼쳐져 있다
  explorerRevealed: (app, { path }) => {
    const leaf = app.workspace.getLeavesOfType('file-explorer')[0];
    const it = leaf && leaf.view && leaf.view.fileItems && leaf.view.fileItems[path];
    return !!it && !it.collapsed;
  },
  // since(ms) 뒤에 그 폴더 아래(하위 폴더 포함)에 새 파일이 생겼다 (실전 모드: AI 가 wiki/ 에 썼나)
  newFileUnder: (app, { path, since = 0 }) => app.vault.getFiles().some((f) => f.path.startsWith(path + '/') && f.stat && f.stat.ctime >= since - 2000),
  // 폴더 안 파일 수
  fileCountIn: (app, { path, min = 1 }) => {
    const f = folderAt(app, path);
    return !!f && f.children.filter((c) => !isFolder(c)).length >= min;
  },
};

class Checks {
  constructor(app) {
    this.app = app;
    this.waiters = new Set();
    this.timer = null;
  }

  // 볼트·작업 영역에서 무슨 일이 생겼다. 기다리는 조건을 곧 다시 본다
  feed() {
    if (!this.waiters.size) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.recheck(), 250);
  }

  async recheck() {
    for (const w of [...this.waiters]) {
      try {
        if (await this.test(w.cond, w.args)) w.resolve(true);
      } catch (e) {
        console.error('[LLM Wiki Tutor] check', w.cond, e);
      }
    }
  }

  async test(cond, args) {
    const f = CONDS[cond];
    if (!f) throw new Error('unknown condition ' + cond);
    return !!(await f(this.app, args || {}));
  }

  // 조건이 참이 될 때까지 기다리는 표. { promise, done, cancel }
  wait(cond, args) {
    const w = { cond, args, done: false };
    w.promise = new Promise((res) => {
      w.resolve = (v) => {
        if (w.done) return;
        w.done = true;
        this.waiters.delete(w);
        res(v);
      };
    });
    w.cancel = () => {
      w.done = true;
      this.waiters.delete(w);
    };
    this.waiters.add(w);
    // 지금 이미 참이면 바로
    this.test(cond, args).then((ok) => ok && w.resolve(true)).catch(() => {});
    return w;
  }

  cancelAll() {
    for (const w of [...this.waiters]) w.cancel();
  }
}

module.exports = { Checks, CONDS, writtenLines };

};

__defs["core/clipboard"] = function (module, exports, require) {
// 복붙 길. 플러그인은 LLM 을 부르지 않는다. 대신
//  build()  : 규칙 파일 + 목차 + 아직 요리(ingest) 안 한 재료를 프롬프트 한 덩어리로 묶는다 (사용자가 복사해서 자기 AI 에 붙여넣는다)
//  parse()  : AI 의 답에서 `=== FILE: wiki/… ===` ~ `=== END ===` 블록을 꺼내 쓰기 목록으로 만든다
// 경로는 wiki/ 아래만 받는다. 하나도 못 찾으면 null — 부르는 쪽이 통째로 한 쪽에 저장한다.
'use strict';

const FILE_RE = /===\s*FILE:\s*(.+?)\s*===\r?\n([\s\S]*?)\r?\n?===\s*END\s*===/g;

const SPEC = {
  ko: `출력 규격 — 만들거나 고칠 노트마다 아래 형식으로만 쓰고, 형식 밖의 말은 쓰지 마.
=== FILE: wiki/<폴더>/<노트 이름>.md ===
(노트 내용 전체)
=== END ===
- 요약은 wiki/sources/, 개념은 wiki/concepts/ 아래.
- wiki/index.md 는 통째로 다시 써서 같은 형식으로 포함해.
- wiki/log.md 는 기존 내용 뒤에 "- ingest · <재료 이름> → <무엇을 썼는지>" 한 줄을 덧붙인 전체를 포함해.`,
  en: `Output format — for every page you create or update, write only in this form and nothing outside it.
=== FILE: wiki/<folder>/<page name>.md ===
(full page content)
=== END ===
- Summaries go under wiki/sources/, concepts under wiki/concepts/.
- Rewrite wiki/index.md in full and include it in the same form.
- Include wiki/log.md in full with one new line appended: "- ingest · <ingredient> → <what you wrote>".`,
  zh: `输出格式 — 每篇要新建或修改的笔记，只按下面的格式写，格式之外什么都不要写。
=== FILE: wiki/<文件夹>/<笔记名>.md ===
（笔记全文）
=== END ===
- 摘要放在 wiki/sources/ 下，概念放在 wiki/concepts/ 下。
- wiki/index.md 整篇重写，用同样的格式一起给出。
- wiki/log.md 在原有内容后面加一行 "- ingest · <食材名> → <写了什么>"，给出加完后的全文。`,
};

const QUERY_SPEC = {
  ko: `답은 평소 말로 쓰되, 어느 노트를 보고 답했는지 [[노트 이름]]으로 출처를 달아. 위키에 없는 내용이면 "위키에 없다"고 말해.
답을 위키에 저장할 수 있게 마지막에 아래 형식으로 한 번 더 써 줘.
=== FILE: wiki/answers/<질문을 짧게>.md ===
(답 + 출처)
=== END ===`,
  en: `Answer in plain words and cite the pages you used as [[page name]]. If the wiki has nothing, say so.
So the answer can be saved, repeat it once at the end in this form:
=== FILE: wiki/answers/<short question>.md ===
(answer + sources)
=== END ===`,
  zh: `用平常的话回答，并用 [[笔记名]] 注明你参考了哪些笔记。维基里没有的内容，就说"维基里没有"。
为了能把回答存进维基，最后再按下面的格式写一遍：
=== FILE: wiki/answers/<简短的问题>.md ===
（回答 + 出处）
=== END ===`,
};

// 프롬프트 머리 · 칸 이름
const WORDS = {
  ko: {
    head: '너는 아래 규칙 파일(AGENTS.md)대로 일하는 위키 관리자야. 규칙을 먼저 읽고 그대로 따라.',
    raws: '[새 재료 — raw/ 에 들어온 것. 읽기만 하고 고치지 마]',
    task: '할 일: 위 재료를 ingest 해.',
    question: '질문',
  },
  en: {
    head: 'You are the wiki keeper who works by the rules file (AGENTS.md) below. Read the rules first and follow them exactly.',
    raws: '[New ingredients in raw/ — read only, never edit]',
    task: 'Task: ingest the ingredients above.',
    question: 'Question',
  },
  zh: {
    head: '你是按下面的规则文件（AGENTS.md）工作的维基管理员。先读规则，再严格照做。',
    raws: '[新食材 — 放进 raw/ 的文件。只读，不要修改]',
    task: '任务：ingest 上面的食材。',
    question: '问题',
  },
};

function section(title, body) {
  return `[${title}]\n${String(body || '').trim()}\n`;
}

// kind: 'ingest' | 'query'. ctx = { lang, agents, index, raws: [{ name, content }], question }
function build(kind, ctx) {
  const lang = WORDS[ctx.lang] ? ctx.lang : 'ko';
  const W = WORDS[lang];
  const parts = [W.head, '', section('AGENTS.md', ctx.agents), section('wiki/index.md', ctx.index)];
  if (kind === 'ingest') {
    parts.push(W.raws);
    for (const r of ctx.raws) parts.push(`=== RAW: raw/${r.name} ===\n${String(r.content).trim()}\n=== END ===`);
    parts.push('', W.task, SPEC[lang]);
  } else {
    parts.push(section(W.question, ctx.question), QUERY_SPEC[lang]);
  }
  return parts.join('\n');
}

// 경로를 wiki/… 로 정리한다. 못 쓰는 경로면 null
function cleanPath(p, root) {
  let s = String(p).trim().replace(/\\/g, '/').replace(/^["'`]|["'`]$/g, '');
  if (root && s.startsWith(root + '/')) s = s.slice(root.length + 1);
  s = s.replace(/^\.?\//, '');
  if (!s.startsWith('wiki/')) return null;
  if (s.includes('..') || s.includes(':') || !s.endsWith('.md')) return null;
  return s;
}

// AI 답 → { files: [{ path, content }], skipped: [원래 경로] } 또는 null (블록이 하나도 없음)
function parse(text, root) {
  const files = [];
  const skipped = [];
  let m;
  FILE_RE.lastIndex = 0;
  while ((m = FILE_RE.exec(String(text || '')))) {
    const path = cleanPath(m[1], root);
    if (!path) {
      skipped.push(m[1].trim());
      continue;
    }
    files.push({ path, content: m[2].replace(/\s+$/, '') + '\n' });
  }
  if (!files.length && !skipped.length) return null;
  return { files, skipped };
}

module.exports = { build, parse, cleanPath, SPEC, QUERY_SPEC };

};

__defs["core/engine"] = function (module, exports, require) {
// 레슨 진행기. 레슨 데이터(core/lessons)의 단계를 한 번에 하나씩 돌린다.
// 진행(어느 레슨 몇 번째 단계, 고른 답)은 플러그인 state.progress 에 저장되어 옵시디언을 닫았다 열어도 이어진다.
'use strict';
const { ALL } = require('./lessons');
const replay = require('./replay');
const realmode = require('./realmode');
const { samples } = require('./samples');

const HINT_MS = 30_000; // 이만큼 막히면 힌트
const ASK_MS = 30_000; // 힌트 뒤 이만큼 더 막히면 "대신 해 줄까?"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Engine {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.token = 0;
    this.running = false;
  }

  get host() {
    return this.plugin.host;
  }
  get T() {
    return this.plugin.T;
  }
  get checks() {
    return this.plugin.checks;
  }
  get practice() {
    return this.plugin.practice;
  }

  get progress() {
    const st = this.plugin.state;
    if (!st.progress) st.progress = { lessonId: null, stepIndex: 0, vars: {}, finished: [] };
    return st.progress;
  }

  lessons() {
    return ALL;
  }
  lesson(id) {
    return ALL.find((l) => l.id === id) || null;
  }
  nextLesson(id) {
    const i = ALL.findIndex((l) => l.id === id);
    return i >= 0 ? ALL[i + 1] || null : null;
  }

  // { ko, en } 글을 지금 언어로. {root} 같은 자리표시도 채운다
  text(o) {
    return this.T.pick(o, { root: this.practice.root(), ...this.progress.vars });
  }

  // 경로. { ko, en } 꼴이면 지금 언어 것을 고른 뒤 practice: 를 푼다
  path(p) {
    if (p && typeof p === 'object') p = this.text(p);
    return this.practice.resolve(p);
  }

  // 인포그래픽: { kind, labels: { ko: [...], en: [...] } } → { kind, labels: [...] }
  figure(f) {
    if (!f) return undefined;
    if (typeof f === 'string') return { kind: f, labels: [] };
    const labels = f.labels ? (Array.isArray(f.labels) ? f.labels : f.labels[this.T.lang] || f.labels.ko || []) : [];
    return { kind: f.kind, labels };
  }

  // 'folder:practice:raw' → 'folder:<루트>/raw'. { ko, en } 꼴도 받는다
  anchor(a) {
    if (a && typeof a === 'object') a = this.text(a);
    if (typeof a !== 'string') return a;
    const m = a.match(/^(folder|file):(practice:.*)$/);
    return m ? `${m[1]}:${this.path(m[2])}` : a;
  }

  /* ── 시작 · 이어 하기 · 멈춤 ── */

  async start(lessonId) {
    const why = this.lockedText(lessonId);
    if (why) return this.plugin.notice(why);
    this.stop();
    const p = this.progress;
    p.lessonId = lessonId;
    p.stepIndex = 0;
    p.vars = {};
    await this.plugin.save();
    return this.run();
  }

  async resume() {
    if (this.running) return;
    const p = this.progress;
    if (!p.lessonId) return this.start(ALL[0].id);
    if (!this.lesson(p.lessonId)) return this.start(ALL[0].id);
    return this.run();
  }

  async restart() {
    this.stop();
    const p = this.progress;
    p.finished = [];
    this.plugin.state.snapshots = {};
    return this.start(ALL[0].id);
  }

  /* ── 순서 잠금 · 건너뛰기 ── */

  // 앞 레슨을 다 마쳐야(또는 건너뛰어야) 열린다. 뒤 레슨이 앞 레슨에서 만든 파일을 쓰기 때문. 막고 있는 첫 레슨
  blocker(id) {
    const i = ALL.findIndex((l) => l.id === id);
    const done = this.progress.finished || [];
    return i > 0 ? ALL.slice(0, i).find((l) => !done.includes(l.id)) || null : null;
  }
  lockedText(id) {
    const b = this.blocker(id);
    const L = this.lesson(id);
    if (!b || !L) return '';
    if (L.course !== b.course) return this.T.t('map.lockedCourse');
    return this.T.t('map.locked', { id: b.id, title: this.text(b.title) });
  }

  // 레슨을 건너뛸 때 그 레슨이 만들었어야 할 쓰기 (연출 · 기다리기 · 질문 없이)
  // fallback 은 사용자가 직접 쓰는 부분을 대신 채우는 쓰기라, 이번에 새로 만드는 노트에만 붙인다
  skipWrites(L) {
    const S = samples(this.T.lang);
    const out = [];
    const add = (list, fallback) => {
      for (const w of [].concat(list)) out.push({ w, fallback, lid: L.id });
    };
    for (const s of L.steps) {
      if (s.write || s.writes) add(s.writes || s.write, false);
      else if (s.waitFor && s.fallback && (s.fallback.write || s.fallback.writes)) add(s.fallback.writes || s.fallback.write, true);
      else if (s.replay === 'raw') add({ op: 'put', path: 'practice:raw/' + S.RAW[s.n - 1].name, content: S.RAW[s.n - 1].content }, false);
      else if (s.replay === 'ingest') add(S.STAGES[s.stage], false);
      else if (s.replay === 'lint') add(S.LINT.fix, false);
      else if (s.replay === 'schema') add([{ op: 'append', path: 'practice:AGENTS.md', content: S.SCHEMA.rule }, ...S.SCHEMA.after], false);
    }
    return out;
  }

  // 레슨들을 들은 걸로 친다: 만들었어야 할 파일을 한 번에 보여 주고(승인) 만든 뒤 마친 레슨에 넣는다. 거절하면 false
  async skipLessons(list) {
    const { vault } = this.app;
    const ops = [];
    const made = new Map(); // 이번에 만들거나 새로 쓰는 노트 (경로 → 쓰기). 뒤따르는 덧붙이기는 그 내용에 합친다
    for (const { w, fallback, lid } of list.flatMap((L) => this.skipWrites(L))) {
      const path = this.path(w.path);
      const content = w.content ? this.text(w.content) : '';
      if (w.op === 'append') {
        const host = made.get(path);
        // 빈 목록 한 줄('- ')만 있는 노트는 덧붙일 글로 바꾼다
        if (host) host.content = /^\s*-?\s*$/.test(host.content) ? content : host.content + content;
        else if (!fallback) ops.push({ op: 'append', path, content, lid });
        continue;
      }
      if ((w.op === 'folder' || w.op === 'note') && (vault.getAbstractFileByPath(path) || made.has(path))) continue;
      const o = { op: w.op, path, content, lid };
      ops.push(o);
      if (w.op !== 'folder') made.set(path, o);
    }
    const same = (x) => x;
    const shown = ops.filter((o) => o.op !== 'append').map((o) => this.practice.describe(o, same));
    if (shown.length && !(await this.plugin.confirmWrites(shown))) return false;
    for (const o of ops) {
      if (o.op === 'append') {
        // 이미 들어 있는 글은 다시 붙이지 않는다 (레슨을 반쯤 하다가 건너뛴 경우)
        const f = vault.getAbstractFileByPath(o.path);
        if (!f || Array.isArray(f.children) || (await vault.read(f)).includes(o.content)) continue;
      }
      await this.practice.apply(o, o.lid, same);
    }
    // 체험 모드로 요리한 재료는 실전 모드가 다시 묶지 않게
    const S = samples(this.T.lang);
    const cooked = list.flatMap((L) => L.steps.filter((s) => s.replay === 'ingest').map((s) => 'raw/' + S.RAW[s.stage - 1].name));
    const st = this.plugin.state;
    if (cooked.length) st.ingested = [...new Set([...(st.ingested || []), ...cooked])];
    const p = this.progress;
    for (const L of list) if (!p.finished.includes(L.id)) p.finished.push(L.id);
    this.checks.feed();
    await this.plugin.save();
    return true;
  }

  // 지금 레슨을 들은 걸로 치고(만들었어야 할 파일은 만들어 두고) 다음 레슨 첫 단계부터
  async skip() {
    this.stop();
    const p = this.progress;
    const L = this.lesson(p.lessonId);
    if (!L || !(await this.skipLessons([L]))) return;
    const next = this.nextLesson(L.id);
    if (!next) return this.plugin.progressChanged();
    p.lessonId = next.id;
    p.stepIndex = 0;
    p.vars = {};
    await this.plugin.save();
    return this.run();
  }

  // 코스 하나를 통째로 들은 걸로 친다 (진행 지도의 "건너뛰기"). 다음 코스 첫 레슨에서 멈춘다
  async skipCourse(course) {
    this.stop();
    const p = this.progress;
    const list = ALL.filter((l) => l.course === course && !p.finished.includes(l.id));
    if (!(await this.skipLessons(list))) return false;
    const next = ALL.find((l) => !p.finished.includes(l.id));
    if (next) p.lessonId = next.id;
    p.stepIndex = 0;
    p.vars = {};
    await this.plugin.save();
    this.plugin.progressChanged();
    return true;
  }

  stop() {
    this.token++;
    this.running = false;
    this.checks.cancelAll();
    this.host.clearBubbles();
    this.host.unpoint();
    // 기다리는 중에 멈추면(건너뛰기 · 다른 레슨 열기) 모래시계 같은 자세가 남지 않게
    this.host.clearProps();
    this.host.mood('idle');
    this.plugin.yieldVaultPet(false);
    this.plugin.progressChanged();
  }

  async run() {
    if (this.running) return;
    const tok = ++this.token;
    this.running = true;
    const live = () => tok === this.token;
    this.plugin.yieldVaultPet(true);
    this.plugin.progressChanged();
    try {
      while (live()) {
        const p = this.progress;
        const L = this.lesson(p.lessonId);
        if (!L) break;
        if (p.stepIndex >= L.steps.length) {
          const r = await this.finish(L);
          if (!live() || r === 'stop') break;
          continue;
        }
        // 레슨 머리말: 이번 레슨에서 뭘 배우는지 (한 번만)
        if (p.stepIndex === 0 && L.intro && !p.vars.introShown) {
          p.vars.introShown = true;
          // 레슨을 처음부터 열면 필기 노트도 빈 장부터
          if (this.plugin.notes) this.plugin.notes.open(L.id);
          this.host.clearProps();
          this.host.clearBubbles();
          await this.host.say(this.text(L.intro), { title: `${L.id} · ${this.text(L.title)}` });
          if (!live()) break;
        }
        const step = L.steps[p.stepIndex];
        const r = await this.runStep(step, L, live);
        if (!live()) break;
        if (r === 'stop') break;
        if (r === 'done') {
          p.stepIndex = L.steps.length;
        } else p.stepIndex++;
        this.plugin.saveSoon();
        this.plugin.progressChanged();
      }
    } catch (e) {
      console.error('[LLM Wiki Tutor] lesson', e);
    } finally {
      if (live()) {
        this.running = false;
        this.plugin.yieldVaultPet(false);
        this.plugin.progressChanged();
      }
    }
  }

  // 레슨이 끝났다. 다음 레슨으로 갈지 묻는다
  async finish(L) {
    const p = this.progress;
    if (!p.finished.includes(L.id)) p.finished.push(L.id);
    const next = this.nextLesson(L.id);
    await this.plugin.save();
    if (!next) {
      await this.host.say(this.T.t('engine.allDone'), { kind: 'cheer' });
      return 'stop';
    }
    const i = await this.host.ask(this.T.t('engine.next', { title: this.text(next.title), min: next.minutes }), [this.T.t('engine.goOn'), this.T.t('engine.later')]);
    p.lessonId = next.id;
    p.stepIndex = 0;
    p.vars = {};
    await this.plugin.save();
    if (i !== 0) {
      await this.host.say(this.T.t('engine.laterOk'), { ms: 4000 });
      return 'stop';
    }
    return 'go';
  }

  /* ── 단계 하나 ── */

  async runStep(step, L, live) {
    const h = this.host;
    // 필기 노트: 이 단계를 설명하기 시작할 때 핵심 한 줄을 적는다 (말풍선과 같은 속도로 써진다)
    if (step.note && this.plugin.notes) for (const n of [].concat(step.note)) this.plugin.notes.write(L.id, this.text(n));
    if (step.say !== undefined) {
      const choices = step.choices ? step.choices.map((c) => this.text(c)) : undefined;
      const r = await h.say(this.text(step.say), { choices, ms: step.ms, kind: step.kind, title: step.title ? this.text(step.title) : undefined, figure: this.figure(step.figure) });
      if (step.as) this.progress.vars[step.as] = r;
      return;
    }
    if (step.card) {
      const c = step.card;
      h.clearBubbles(); // 카드 위에 직전 말풍선이 남지 않게
      const r = await h.card(this.text(c.title), this.text(c.body), (c.buttons || []).map((b) => this.text(b)), this.figure(c.figure));
      if (step.as) this.progress.vars[step.as] = r;
      return;
    }
    // 궁금한 점 코너: 질문 버튼 n개 + 넘어가기. 하나 보고 나면 다시 목록으로
    if (step.faq) {
      const f = step.faq;
      const seen = new Set();
      for (;;) {
        const labels = f.items.map((it, i) => (seen.has(i) ? '✓ ' : '') + this.text(it.q));
        h.clearBubbles();
        const i = await h.card(this.text(f.title), f.intro ? this.text(f.intro) : '', [...labels, this.T.t('engine.skip')]);
        if (!live()) return 'stop';
        if (i < 0 || i >= f.items.length) return;
        seen.add(i);
        const it = f.items[i];
        await h.card(this.text(it.q), this.text(it.a), [this.T.t('engine.back')], this.figure(it.figure));
        if (!live()) return 'stop';
      }
    }
    if (step.if !== undefined) {
      const branch = this.progress.vars[step.if] === step.eq ? step.then : step.else;
      for (const s of branch || []) {
        const r = await this.runStep(s, L, live);
        if (!live()) return 'stop';
        if (r === 'stop' || r === 'done') return r;
      }
      return;
    }
    if (step.do) return this.runDo(step);
    if (step.write || step.writes) {
      const ok = await this.runWrite(step, L);
      return ok ? undefined : 'stop';
    }
    if (step.open) {
      const f = this.app.vault.getAbstractFileByPath(this.path(step.open));
      if (f && !Array.isArray(f.children)) await this.app.workspace.getLeaf(false).openFile(f, { active: true });
      this.checks.feed();
      return;
    }
    if (step.waitFor) return this.runWait(step, L, live);
    if (step.replay) return replay.run(this, step, L, live);
    if (step.real) return realmode.run(this, step, L, live);
    if (step.command) {
      // 어디를 눌러서 가는지 먼저 보여 준다 (혼자 쓸 때 알 수 있게): via 자리를 가리키고 한마디 한 뒤 실행
      if (step.via) {
        const ok = await h.point(this.anchor(step.via), step.viaLabel ? this.text(step.viaLabel) : '');
        if (step.viaSay) await h.say(this.text(step.viaSay), { ms: step.viaMs || 5000 });
        else if (ok) await sleep(2500);
        h.unpoint();
        if (!live()) return 'stop';
      }
      this.app.commands.executeCommandById(step.command);
      await sleep(step.ms || 600);
      this.checks.feed();
      return;
    }
    if (step.quiz) return this.runQuiz(step.quiz);
    if (step.showInFolder) {
      const f = this.app.vault.getAbstractFileByPath(this.path(step.showInFolder));
      if (f) {
        try {
          this.app.showInFolder(f.path);
        } catch (e) {
          console.error('[LLM Wiki Tutor] showInFolder', e);
        }
      }
      return;
    }
    if (step.stop) return 'stop';
    if (step.done) {
      h.fx({ type: 'confetti' });
      await sleep(900);
      return 'done';
    }
    console.warn('[LLM Wiki Tutor] unknown step', step);
  }

  async runDo(step) {
    const h = this.host;
    switch (step.do) {
      case 'goto':
        await h.goto(this.anchor(step.anchor), { run: !!step.run });
        break;
      case 'point': {
        const ok = await h.point(this.anchor(step.anchor), step.label ? this.text(step.label) : '');
        if (!ok && step.miss) await h.say(this.text(step.miss));
        break;
      }
      case 'unpoint':
        h.unpoint();
        break;
      case 'carry':
        await h.carry(this.anchor(step.from), this.anchor(step.to));
        break;
      case 'prop':
        h.prop(step.key, step.on !== false);
        break;
      case 'act':
        h.act(step.motion);
        if (step.ms) await sleep(step.ms);
        break;
      case 'fx':
        h.fx(step.fx);
        break;
      case 'mood':
        h.mood(step.mood);
        break;
      case 'wait':
        await sleep(step.ms || 1000);
        break;
      default:
        console.warn('[LLM Wiki Tutor] unknown do', step.do);
    }
  }

  // 쓰기 (하나 또는 여럿). preview 가 false 가 아니면 승인 모달을 먼저 띄운다. 거절하면 false
  async runWrite(step, L) {
    const list = step.writes || [step.write];
    const text = (o) => this.text(o);
    if (step.preview !== false) {
      // 이미 있는 것은 미리보기에서 뺀다 (다시 돌릴 때 같은 걸 또 묻지 않게)
      const fresh = list.filter((w) => !this.app.vault.getAbstractFileByPath(this.path(w.path)));
      if (fresh.length) {
        const ok = await this.plugin.confirmWrites(fresh.map((w) => this.practice.describe(w, text)));
        if (!ok) {
          await this.host.say(this.T.t('engine.declined'), { ms: 4000 });
          return false;
        }
      }
    }
    for (const w of list) await this.practice.apply(w, L.id, text);
    this.checks.feed();
    return true;
  }

  // 사용자가 할 때까지 기다린다. 30초 막히면 힌트(가리키기 + 말), 다시 30초면 "대신 해 줄까?"
  async runWait(step, L, live) {
    const args = {};
    // '$now' 는 기다리기 시작한 시각, '$이름' 은 vars[이름] (예: '$ingestAt' = 실전 ingest 를 시작한 시각)
    const special = (v) => (v === '$now' ? Date.now() : v.startsWith('$') ? this.progress.vars[v.slice(1)] ?? Date.now() : null);
    for (const [k, v] of Object.entries(step.args || {})) {
      const s = typeof v === 'string' && v.startsWith('$') ? special(v) : null;
      args[k] = s != null ? s : typeof v === 'string' || (v && typeof v === 'object') ? this.path(v) : v;
    }
    const w = this.checks.wait(step.waitFor, args);
    const h = this.host;
    const T = this.T;
    let result = null;
    const nag = async () => {
      let hinted = false;
      for (;;) {
        await sleep(hinted ? ASK_MS : HINT_MS);
        if (w.done || !live()) return null;
        if (!hinted) {
          hinted = true;
          if (step.hint) {
            if (step.hint.anchor) await h.point(this.anchor(step.hint.anchor), step.hint.label ? this.text(step.hint.label) : '');
            if (w.done || !live()) return null;
            if (step.hint.say) await h.say(this.text(step.hint.say));
            h.unpoint();
          }
          continue;
        }
        if (!step.fallback) continue;
        const i = await h.ask(T.t('engine.hintDoIt'), [T.t('engine.yesDoIt'), T.t('engine.illDoIt')]);
        if (w.done || !live()) return null;
        if (i === 0) return 'fallback';
      }
    };
    result = await Promise.race([w.promise.then(() => 'ok'), nag()]);
    w.cancel();
    h.unpoint();
    if (!live()) return 'stop';
    if (result === 'fallback') {
      const r = await this.runStep(step.fallback, L, live);
      if (r === 'stop') return 'stop';
    } else h.clearBubbles();
  }

  // 1문항 퀴즈. 질문 앞에 "Q." 를 붙인다. 틀리면 wrong 을 말하고 한 번 더 (두 번 틀리면 답을 알려 주고 넘어간다)
  async runQuiz(q) {
    const h = this.host;
    const choices = q.choices.map((c) => this.text(c));
    for (let tries = 0; tries < 2; tries++) {
      const i = await h.ask(`Q. ${this.text(q.q)}`, choices);
      if (i === q.answer) {
        h.act('happy');
        await h.say(this.text(q.fb), { kind: 'cheer' });
        return;
      }
      h.act('ttilt');
      if (tries === 0 && q.wrong) await h.say(this.text(q.wrong));
    }
    await h.say(this.T.t('engine.answerWas', { a: choices[q.answer] }) + ' ' + this.text(q.fb));
  }
}

module.exports = { Engine, HINT_MS, ASK_MS };

};

__defs["core/habit"] = function (module, exports, require) {
// 졸업 후 습관 코치. B8 을 마친 뒤에만 일한다.
//  - ingest 요일에 옵시디언을 열면 하루 한 번: "오늘 ingest 날이야. raw 에 새 재료 n개." → 프롬프트 복사 / 다음에
//  - raw/ 아래에 오늘 뭔가 생기거나 바뀌면 '세 줄 적음'으로 친다. 저녁(20시 뒤)까지 없으면 하루 한 번: "세 줄만 적을래?" → 적을게 / 다음에
//  - 하루에 말 거는 횟수는 2회까지. 설정에서 끌 수 있다
'use strict';
const clipboard = require('./clipboard');

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const today = () => new Date().toISOString().slice(0, 10);
const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

class Habit {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  get state() {
    const st = this.plugin.state;
    if (!st.habit) st.habit = { lastThreeLines: null, lastIngest: null, nags: {}, ingestDay: 'fri' };
    st.habit.nags = st.habit.nags || {};
    return st.habit;
  }

  graduated() {
    const p = this.plugin.state.progress;
    return !!(p && p.finished && p.finished.includes('B8'));
  }

  enabled() {
    return this.plugin.settings.habitCoach !== false && this.graduated();
  }

  // 오늘 몇 번 말 걸었나
  nagsToday() {
    const n = this.state.nags;
    const d = localDay();
    for (const k of Object.keys(n)) if (!k.startsWith(d)) delete n[k];
    return Object.keys(n).length;
  }

  mark(kind) {
    this.state.nags[`${localDay()}:${kind}`] = true;
    this.plugin.saveSoon();
  }

  // raw/ 에 오늘 손댄 게 있나
  onVaultChange(file) {
    if (!file || !file.path) return;
    const raw = this.plugin.practice.resolve('practice:raw');
    if (!file.path.startsWith(raw + '/')) return;
    this.state.lastThreeLines = localDay();
    this.plugin.saveSoon();
  }

  // 1분마다 (plugin 의 interval)
  async tick(force) {
    if (!force && !this.enabled()) return;
    if (this.plugin.engine.running) return;
    const T = this.plugin.T;
    const h = this.plugin.host;
    const d = localDay();
    const n = this.state.nags;
    const day = DAYS[new Date().getDay()];
    const ingestDay = this.plugin.settings.ingestDay || this.state.ingestDay || 'fri';
    // ingest 날
    if ((force === 'ingest' || day === ingestDay) && !n[`${d}:ingest`] && this.state.lastIngest !== d && this.nagsToday() < 2) {
      this.mark('ingest');
      const fresh = await this.freshCount();
      const i = await h.ask(T.t('habit.ingestDay', { n: fresh }), [T.t('real.copyPrompt'), T.t('engine.later')]);
      if (i === 0) {
        await this.copyIngestPrompt();
        this.state.lastIngest = d;
        this.plugin.saveSoon();
      }
      return;
    }
    // 저녁까지 세 줄이 없다
    const hour = new Date().getHours();
    if ((force === 'lines' || hour >= 20) && this.state.lastThreeLines !== d && !n[`${d}:lines`] && this.nagsToday() < 2) {
      this.mark('lines');
      const i = await h.ask(T.t('habit.threeLines'), [T.t('habit.write'), T.t('engine.later')]);
      if (i === 0) await this.openToday();
    }
  }

  async freshCount() {
    const { freshRaws } = require('./realmode');
    try {
      return (await freshRaws(this.plugin.engine)).length;
    } catch {
      return 0;
    }
  }

  async copyIngestPrompt() {
    const T = this.plugin.T;
    const E = this.plugin.engine;
    const mode = (E.progress.vars && E.progress.vars.mode) || 'paste';
    let text;
    if (mode === 'folder') text = T.t('real.ingestPrompt', { root: this.plugin.practice.root() });
    else {
      const { freshRaws } = require('./realmode');
      const read = async (rel) => {
        const f = this.app.vault.getAbstractFileByPath(E.path('practice:' + rel));
        return f && !Array.isArray(f.children) ? this.app.vault.cachedRead(f) : '';
      };
      text = clipboard.build('ingest', { lang: T.lang, agents: await read('AGENTS.md'), index: await read('wiki/index.md'), raws: await freshRaws(E) });
    }
    try {
      await navigator.clipboard.writeText(text);
      this.plugin.notice(T.t('real.copied'));
    } catch {
      this.plugin.notice(T.t('real.copyFailed'));
    }
  }

  // raw/오늘날짜.md 를 만들어 연다
  async openToday() {
    const E = this.plugin.engine;
    const path = `practice:raw/${localDay()}.md`;
    await this.plugin.practice.apply({ op: 'note', path, content: { ko: '- \n', en: '- \n' }, open: true }, 'habit', (o) => E.text(o));
    this.plugin.host.mood('wait');
    setTimeout(() => this.plugin.host.mood('idle'), 60_000);
  }
}

module.exports = { Habit, DAYS, today };

};

__defs["core/lessons/courseA"] = function (module, exports, require) {
// 코스 A — 옵시디언 사용법 기초. 레슨은 단계(step) 배열이고 글은 { ko, en, zh } 이다.
// 10차에서 한국어판을 새로 썼다. en · zh 는 이 한국어판을 기준으로 나중에 한꺼번에 다시 옮긴다 (그 전까지는 한국어로 나온다).
// 옛 en · zh 글은 ../백업_10차전/ 에 있다.
//
// 레슨: { id, course, minutes, title, intro, steps }  intro 는 레슨을 시작할 때 "이번 시간엔 뭘 배우나" (엔진이 제목과 함께 말한다)
// 단계 종류 (core/engine.js 가 돈다):
//  { say, choices?, as?, title?, figure? }   고양이 말. 사용자가 넘길 때까지 그대로 있다. choices 가 있으면 고른 번호를 vars[as] 에. '앞말||뒷말' 은 말풍선 둘로
//  { card: { title, body, buttons, figure }, as? } 긴 설명 카드
//  { faq: { title, intro?, items: [{ q, a, figure? }] } }  궁금한 점 코너: 질문 버튼들 + 넘어가기. 하나 보면 다시 목록으로
//  { do: 'goto'|'point'|'unpoint'|'carry'|'prop'|'act'|'fx'|'mood'|'wait', ... }  연출. anchor 는 'folder:practice:raw' 처럼 practice: 를 쓸 수 있다
//  { write / writes, preview? }  볼트 쓰기 (core/practice.js). preview 는 기본 true
//  { waitFor, args, hint: { anchor?, say }, fallback? }  사용자가 할 때까지 기다린다. 30초 막히면 hint, 또 30초면 "대신 해 줄까?" → fallback
//  { quiz: { q, choices, answer, fb, wrong } }  1문항. 엔진이 질문 앞에 "Q." 를 붙인다
//  { if: 'var', eq, then: [steps], else: [steps] }
//  { command, via?, viaLabel?, viaSay?, ms? }  옵시디언 명령 실행. via 가 있으면 그 자리를 먼저 가리키고(혼자 쓸 때 알 수 있게) 실행
//  { showInFolder: path } · { open: path } · { stop: true } · { done: true }
// figure: { kind: 'rooms'|'ingest'|'ops'|'markdown'|'links'|'loop'|'roles', labels: { ko: [...], en: [...], zh: [...] } }  — kit/pet.js 의 figureHtml
//
// 말투: 고양이가 처음 옵시디언을 켠 친구에게 옆에서 알려 주는 반말. 비유는 개념을 먼저 제 이름으로 설명한 뒤
// "앞으로 ~라고 부를게" 하고 정해 둔 것만 쓴다 (재료 · 요리 · 위키 청소 · 연결고리).
// 11차 표기 규칙:
//  - 사용자를 가리킬 땐 1인칭(나 · 내가)을 쓰지 않고 "사용자"라고 쓴다 (고양이의 "나"와 헷갈리지 않게). 사용자에게 직접 말할 땐 "너 · 네".
//  - 재료는 "재료(raw 폴더 속 파일)", 요리는 "요리(ingest)"로, 말풍선마다 처음 나올 때 괄호를 붙인다.
//  - wiki 안 폴더는 "개념 폴더(concepts)"처럼 실제 폴더 이름을 괄호로 같이 쓴다.
//  - 차례로 나오는 개념은 1. 2. 3. 으로 번호를 붙인다. "적어 두다"는 "기록해 두다"로.
'use strict';

const NOTE_TODAY = { ko: 'practice:오늘 알게 된 것.md', en: 'practice:What I learned today.md', zh: 'practice:今天学到的.md' };
const NOTE_TODAY_ROW = { ko: 'file:practice:오늘 알게 된 것.md', en: 'file:practice:What I learned today.md', zh: 'file:practice:今天学到的.md' };
const NOTE_PAD = { ko: 'practice:연습장.md', en: 'practice:Scratchpad.md', zh: 'practice:练习本.md' };
const NOTE_A = { ko: 'practice:고양이.md', en: 'practice:Cat.md', zh: 'practice:猫.md' };
const NOTE_B = { ko: 'practice:츄르.md', en: 'practice:Churu.md', zh: 'practice:猫条.md' };
const GRAPH_RIBBON = { ko: 'ribbon:그래프 뷰 열기', en: 'ribbon:Open graph view', zh: 'ribbon:查看关系图谱' };
// 옵시디언 화면 둘러보기에서 가리키는 자리
// 넓은 칸은 host.markerFor 가 깜빡이는 테두리 상자로 감싼다
const EXPLORER = 'sel:.workspace-leaf-content[data-type="file-explorer"]';
// 맨 왼쪽 아이콘 줄: 1.14 는 mod-primary, 그 전엔 mod-left
const ICON_STRIP = 'sel:.workspace-ribbon.side-dock-ribbon.mod-primary, .workspace-ribbon.side-dock-ribbon.mod-left';
const MAIN_AREA = 'sel:.workspace-split.mod-root';

const A0 = {
  id: 'A0',
  course: 'A',
  minutes: 5,
  title: { ko: '만남, 그리고 화면 둘러보기' },
  intro: {
    ko: '첫 시간이야. 인사하고, 옵시디언 화면이 어떻게 생겼는지 같이 둘러본 다음 연습용 폴더를 하나 만들 거야.',
  },
  steps: [
    { do: 'mood', mood: 'idle' },
    { say: { ko: '안녕! 나는 이 수업을 맡은 고양이야.||이름은 아직 없어. 같이 하다가 좋은 이름이 떠오르면 지어 줘.' } },
    {
      say: { ko: '"AI 가 알아서 정리해 주는 위키" 얘기 듣고 왔지?' },
      choices: [{ ko: '응, SNS 에서 봤어' }, { ko: '그냥 궁금해서' }],
      as: 'sawSB',
    },
    {
      if: 'sawSB',
      eq: 0,
      then: [{ say: { ko: '나도 그거 보고 해 보고 싶었는데, 막상 어디서부터 해야 할지 모르겠더라.||그래서 처음부터 하나씩 같이 해 보려고.' } }],
      else: [{ say: { ko: '궁금해서 왔으면 충분해.||처음부터 하나씩 같이 해 보자.' } }],
    },
    { say: { ko: '수업은 두 부분이야.||앞부분(A)은 옵시디언 기본 사용법이고, 뒷부분(B)은 AI 가 정리해 주는 위키를 실제로 만들어 보는 거야. 레슨 하나는 5분 안팎이야.' } },
    {
      say: {
        ko: '말풍선 보는 법부터 알려 줄게.||내 말은 네가 넘기기 전까지 그대로 있어. 다 읽었으면 말풍선을 한 번 누르면 다음 말로 넘어가.||지나간 말을 다시 보고 싶으면 왼쪽 아래 "← 이전"을 누르면 돼. 지금 한번 눌러 봐도 좋아.',
      },
    },
    { say: { ko: '이제 옵시디언 화면을 같이 둘러보자. 처음엔 세 군데만 알면 돼. 하나씩 깜빡이는 테두리로 짚어 줄게.' } },
    { command: 'file-explorer:open', ms: 600 },
    { do: 'point', anchor: EXPLORER, label: { ko: '파일 탐색기' } },
    {
      say: {
        ko: '1. 왼쪽 칸은 **파일 탐색기**야.||지금 옵시디언이 열고 있는 폴더 안의 폴더와 노트가 여기 목록으로 다 나와. 노트를 열 때도 여기서 이름을 클릭하면 돼.',
      },
    },
    { do: 'unpoint' },
    { do: 'point', anchor: ICON_STRIP, label: { ko: '아이콘 줄' } },
    {
      say: {
        ko: '2. 화면 맨 왼쪽 끝에 작은 아이콘이 세로로 늘어서 있지? 테두리로 감싼 곳이야.||자주 쓰는 기능을 바로 여는 버튼들이야. 아이콘에 마우스를 올리면 이름이 떠. 나중에 여기서 "그래프 뷰"라는 화면을 열 거야.',
      },
    },
    { do: 'unpoint' },
    { do: 'point', anchor: MAIN_AREA },
    {
      say: {
        ko: '3. 가운데 넓은 곳은 노트를 열어서 읽고 쓰는 화면이야.||노트를 여러 개 열면 위쪽에 탭으로 쌓여. 웹 브라우저 탭이랑 똑같아.',
      },
    },
    { do: 'unpoint' },
    {
      say: {
        ko: '하나만 더. 옵시디언이 열고 있는 이 폴더 전체를 **볼트(vault)**라고 불러. 한국어 화면에선 "보관함"이라고 나와.||볼트가 정확히 뭔지는 A2 에서 직접 확인해 볼 거야.',
      },
    },
    { say: { ko: '이제 연습할 폴더를 만들자.||볼트 안에 폴더를 하나 새로 만들고, 수업에서 하는 건 전부 그 안에서만 해. 네가 원래 갖고 있던 노트는 건드리지 않아.' } },
    {
      say: { ko: '"{root}" 라는 폴더를 만들어도 될까?' },
      choices: [{ ko: '응, 만들어' }, { ko: '잠깐만' }],
      as: 'okFolder',
    },
    {
      if: 'okFolder',
      eq: 1,
      then: [{ say: { ko: '알았어. 준비되면 맨 왼쪽 아이콘 줄에서 고양이 아이콘을 눌러 줘. 거기서부터 이어서 할게.' } }, { stop: true }],
      else: [],
    },
    { write: { op: 'folder', path: 'practice:' }, preview: false },
    {
      waitFor: 'folderExists',
      args: { path: 'practice:' },
      hint: { say: { ko: '파일 탐색기에 폴더가 안 보이면 목록을 위아래로 스크롤해 봐. 폴더는 이름 순서대로 놓여 있어.' } },
    },
    { do: 'point', anchor: 'folder:practice:', label: { ko: '연습 폴더' } },
    { say: { ko: '파일 탐색기에 "{root}" 폴더가 생겼지?||앞으로 수업에서 만드는 노트는 전부 이 폴더 안에 들어가.' } },
    { say: { ko: '폴더 이름 왼쪽의 작은 화살표를 클릭하면 폴더가 펼쳐지고, 한 번 더 클릭하면 접혀.||지금은 비어 있어서 펼쳐도 아무것도 없을 거야.' } },
    { do: 'unpoint' },
    { done: true },
  ],
};

const A1 = {
  id: 'A1',
  course: 'A',
  minutes: 7,
  title: { ko: '왜 기록해 둬야 할까' },
  intro: {
    ko: '이번 시간엔 기록해 두지 않으면 어떤 일이 생기는지 내 얘기 다섯 개로 보고, 1분 동안 세 줄을 직접 기록해 볼 거야. 궁금한 건 중간에 물어봐도 돼.',
  },
  steps: [
    { say: { ko: '본격적으로 하기 전에 내 얘기 좀 들어 줘. 짧은 거 다섯 개야. 1번부터 차례로 할게.' } },
    { do: 'act', motion: 'tbookmarkdig' },
    { say: { ko: '1. 분명히 저장해 둔 글이 있었는데 못 찾겠어.||북마크, 스크린샷, 나한테 보낸 메시지까지 다 뒤졌는데 없더라.' } },
    {
      card: {
        title: { ko: '1. 저장했는데 못 찾는다' },
        body: {
          ko: '지식관리 앱 사용자를 조사한 연구를 보면, 사람들은 저장하는 데는 시간을 꽤 쓰는데 나중에 **다시 찾아보는 일**은 잘 안 된다고 답했어.\n\n저장만 하고 다시 보지 않은 건 결국 잊혀.',
        },
        buttons: [{ ko: '다음' }],
      },
    },
    { do: 'act', motion: 'tbookpile' },
    { say: { ko: '2. 읽을 책을 잔뜩 사 놓고 뿌듯했어.||근데 사실 한 권도 안 읽었어.' } },
    {
      card: {
        title: { ko: '2. 모은다고 아는 건 아니다' },
        body: {
          ko: '"이런 게 있다는 걸 안다"와 "내용을 안다"는 달라.\n\n저장 버튼 누르기가 너무 쉬워서, 저장만 해도 뭔가 한 기분이 들어. 이걸 **수집가의 오류**라고 해.',
        },
        buttons: [{ ko: '다음' }],
      },
    },
    { do: 'act', motion: 'tfadethought' },
    { say: { ko: '3. 어제 들은 얘기가 오늘 벌써 가물가물해.' } },
    {
      card: {
        title: { ko: '3. 금방 잊힌다' },
        body: {
          ko: '사람은 새로 들은 걸 처음 몇 시간 사이에 가장 많이 잊어버려. 이걸 **망각 곡선**이라고 해.\n\n그래서 그날 기록해 두지 않으면 남는 게 거의 없어.',
        },
        buttons: [{ ko: '다음' }],
      },
    },
    { do: 'act', motion: 'tfoldering' },
    { say: { ko: '4. 그래서 정리를 잘해 보려고 폴더랑 태그를 잔뜩 만들었어.||일주일 만에 지쳐서 그만뒀어.' } },
    {
      card: {
        title: { ko: '4. 정리하다 지친다' },
        body: {
          ko: '메모 정리가 오래 못 가는 건 대부분 **관리하는 일** 때문이야.\n\n새 글이 들어올 때마다 어디에 넣을지 고르고, 관련 있는 글끼리 이어 주고, 오래된 내용을 고치는 일. 이걸 사람이 다 하려고 하면 금방 지쳐.',
        },
        buttons: [{ ko: '다음' }],
      },
    },
    { do: 'act', motion: 'tsparkle' },
    { say: { ko: '5. 그 관리를 AI 한테 맡기면 된다는 걸 알았어.||사용자는 글을 넣고 읽기만 하고, 분류하고 잇고 요약하는 건 AI 가 하는 거야.' } },
    {
      card: {
        title: { ko: '5. LLM Wiki 가 뭐냐면' },
        body: {
          ko: 'AI 가 관리해 주는 개인 위키를 **LLM Wiki** 라고 해. LLM 은 ChatGPT 나 클로드 같은 AI 를 가리키는 말이야. 2026년 4월에 AI 연구자 **안드레 카파시(Andrej Karpathy)**가 이 방법을 글로 소개하면서 널리 알려졌어.\n\n여기서 중요한 건 AI 가 얼마나 똑똑하냐가 아니라 **AI 가 읽을 거리가 있느냐**야. 사용자가 평소에 어떤 식으로 일하는지, 어떤 일을 왜 그렇게 정했는지, 지금 어떤 상황인지. 이런 **사용자의 일과 맥락에 대한 기록**이 있어야 AI 가 사용자에게 맞는 답을 줄 수 있어.\n\n똑같은 질문에도 AI 답이 뻔하게 느껴질 때가 있지? 대개 AI 가 사용자에 대해 읽을 기록이 없어서 그래.',
        },
        figure: { kind: 'roles', labels: { ko: ['사용자', '글을 넣고, 읽는다', 'AI', '분류 · 연결 · 요약'] } },
        buttons: [{ ko: '알았어' }],
      },
    },
    {
      say: {
        ko: '여기서 말 하나를 정해 두자. AI 가 읽고 정리할 원래 글, 그러니까 사용자의 일과 맥락을 기록해 둔 글을 앞으로 **재료**라고 부를게.||재료는 B 코스에서 만들 **raw 폴더**에 모아 둘 거야. 그래서 앞으로 "재료"라고 하면 **raw 폴더 속 파일**을 말하는 거야.||직접 쓴 메모든 회의 기록이든 저장해 둔 기사든, AI 한테 넘겨줄 글이면 다 재료(raw 폴더 속 파일)가 될 수 있어.',
      },
    },
    {
      faq: {
        title: { ko: '궁금한 거 있어?' },
        intro: { ko: '궁금한 걸 누르면 답해 줄게. 다 봤으면 "넘어가기".' },
        items: [
          {
            q: { ko: '그냥 메모 앱이랑 뭐가 달라?' },
            a: {
              ko: '메모 앱은 기록하는 것도 사용자가, 정리하는 것도 사용자가 해. 그래서 쌓일수록 찾기가 어려워져.\n\nLLM Wiki 에선 사용자는 재료(raw 폴더 속 파일)만 넣고, 요약하고 서로 잇고 목차를 고치는 건 AI 가 해. 그래서 쌓일수록 오히려 찾기 쉬워져.',
            },
          },
          {
            q: { ko: 'AI 가 글을 읽어도 안전해?' },
            a: {
              ko: '네가 고른 AI 에게, 네가 고른 폴더만 보여 주는 거야. 이 플러그인은 네 글을 어디로도 보내지 않아.\n\n그래도 고객 개인정보, 비밀번호, 민감한 금액 같은 건 처음부터 재료(raw 폴더 속 파일)로 넣지 마. 꼭 필요하면 "A사 담당자"처럼 바꿔서 적으면 돼.',
            },
          },
          {
            q: { ko: '매일 세 줄이면 정말 돼?' },
            a: {
              ko: '응. 오늘 한 일, 알게 된 것, 그 밖의 메모. 형식도 맞춤법도 신경 안 써도 돼.\n\n며칠 빼먹어도 괜찮아. 출석 체크가 아니라 나중에 꺼내 쓸 재료(raw 폴더 속 파일)를 모으는 거니까. 제일 쓸모 있는 건 "이건 다음에 조심해야겠다" 같은 한 줄이야.',
            },
          },
        ],
      },
    },
    { say: { ko: '그럼 지금 재료가 될 글을 하나 만들어 보자. 1분이면 돼.' } },
    { write: { op: 'note', path: NOTE_TODAY, content: { ko: '- \n' }, open: true }, preview: false },
    {
      say: {
        ko: '방금 연습 폴더 안에 "오늘 알게 된 것"이라는 노트를 만들어서 가운데 화면에 열어 뒀어.||왼쪽 파일 탐색기에서 연습 폴더를 펼쳐 보면 이 노트가 있을 거야.',
      },
    },
    { do: 'mood', mood: 'wait' },
    { do: 'prop', key: 'hourglass', on: true },
    {
      say: {
        ko: '여기에 오늘 알게 된 거나 느낀 걸 세 줄만 기록해 봐. 아무거나 괜찮아.||가운데 노트를 한 번 클릭하면 글자를 쓸 수 있어. 첫 줄 앞의 점(•)은 목록 표시야. 한 줄 쓰고 Enter 를 누르면 다음 줄에도 점이 생겨.||맞춤법이나 문장은 신경 쓰지 마. 단어만 적어도 돼.',
      },
    },
    {
      waitFor: 'linesWritten',
      args: { path: NOTE_TODAY, min: 3 },
      hint: { anchor: 'editor', say: { ko: '가운데 노트를 클릭하고 한 줄에 하나씩 적으면 돼. 세 줄이 되면 내가 알아챌게.' } },
      fallback: {
        write: {
          op: 'append',
          path: NOTE_TODAY,
          content: { ko: '- 위키 정리는 AI 한테 맡기면 된다\n- 저장만 하면 잊는다\n- 매일 세 줄이면 된다\n' },
        },
        preview: false,
      },
    },
    { do: 'prop', key: 'hourglass', on: false },
    { do: 'mood', mood: 'idle' },
    { do: 'fx', fx: { type: 'confetti' } },
    {
      say: {
        ko: '됐다! 하루에 할 일은 이게 다야.||참, 저장 버튼은 따로 없어. 옵시디언은 쓰는 대로 바로 저장돼.||방금 쓴 세 줄을 나중에 raw 폴더에 넣으면, 그게 AI 가 읽을 재료(raw 폴더 속 파일)야.',
      },
      kind: 'cheer',
    },
    {
      quiz: {
        q: { ko: '사용자가 매일 할 일은?' },
        choices: [{ ko: '편하게 세 줄 기록하기' }, { ko: '폴더와 태그 정리하기' }],
        answer: 0,
        fb: { ko: '맞아. 정리는 AI 가 할 일이야.' },
        wrong: { ko: '그건 4번 얘기에서 일주일 만에 지친 방법이야. 다시 골라 봐.' },
      },
    },
    { done: true },
  ],
};

const A2 = {
  id: 'A2',
  course: 'A',
  minutes: 5,
  title: { ko: '옵시디언 노트는 그냥 파일이다' },
  intro: {
    ko: '이번 시간엔 옵시디언이 어떤 앱인지 알아보고, 아까 쓴 노트가 네 컴퓨터에 진짜 파일로 저장돼 있는지 윈도우 폴더 창에서 직접 확인해 볼 거야.',
  },
  steps: [
    { say: { ko: '옵시디언이 어떤 앱인지부터 말해 줄게.||옵시디언은 컴퓨터에 있는 폴더 하나를 열어서, 그 안의 글 파일을 보기 좋게 보여 주고 고칠 수 있게 해 주는 앱이야.' } },
    {
      card: {
        title: { ko: '볼트와 노트' },
        body: {
          ko: '**볼트(vault)**: 옵시디언이 여는 폴더 하나. 한국어 화면에선 "보관함"이라고 나와. 왼쪽 파일 탐색기에 보이는 건 전부 이 볼트 안에 있는 거야.\n\n**노트**: 볼트 안의 글 파일 하나. 파일 이름 끝에 `.md` 가 붙어. md 는 마크다운이라는 글 형식인데, 다음 레슨에서 배울 거야.\n\n회원가입이나 서버가 필요 없어. 파일이 사용자 컴퓨터에 있으니까 옵시디언을 지워도 노트는 그대로 남아.',
        },
        buttons: [{ ko: '정말?' }],
      },
    },
    { say: { ko: '직접 확인해 보자. 아까 쓴 "오늘 알게 된 것" 노트를 윈도우 폴더 창에서 열어 볼게.' } },
    { do: 'point', anchor: NOTE_TODAY_ROW, label: { ko: '오늘 알게 된 것' } },
    {
      say: {
        ko: '혼자 할 땐 이렇게 해. 파일 탐색기에서 노트 이름 위에 마우스를 두고 **오른쪽 버튼**을 누르면 메뉴가 떠.||거기서 **"폴더에서 보기"**를 고르면 돼. 맥에선 "Finder에서 보기"라고 나와.||이번엔 내가 대신 열어 줄게.',
      },
    },
    { do: 'unpoint' },
    { showInFolder: NOTE_TODAY },
    { do: 'mood', mood: 'wait' },
    {
      say: {
        ko: '윈도우 폴더 창이 하나 떴지? 그 안에 "오늘 알게 된 것.md" 파일이 있을 거야.||그 파일이 방금 네가 옵시디언에서 쓴 노트야. 확인했으면 옵시디언으로 돌아와서 눌러 줘.',
      },
      choices: [{ ko: '봤어' }, { ko: '창이 안 떴어' }],
      as: 'sawFile',
    },
    {
      if: 'sawFile',
      eq: 1,
      then: [{ say: { ko: '폴더 창이 옵시디언 뒤에 가려져 있을 수도 있어. 화면 아래 작업 표시줄을 한번 봐 줘.||그래도 없으면 나중에 노트 이름을 오른쪽 클릭해서 "폴더에서 보기"로 직접 열어 봐.' } }],
      else: [{ say: { ko: '맞아. 옵시디언은 이 파일을 열어서 보여 주고 있었던 거야.||폴더 창은 이제 닫아도 돼.' } }],
    },
    { do: 'mood', mood: 'idle' },
    { say: { ko: '이게 왜 중요하냐면,||노트가 평범한 파일이니까 **AI 도 이 파일을 직접 읽고 쓸 수 있어.** AI 가 관리하는 위키를 옵시디언에 만드는 이유가 이거야.' } },
    {
      quiz: {
        q: { ko: '옵시디언 노트 하나는 실제로 뭐야?' },
        choices: [{ ko: '컴퓨터 폴더 안의 파일 하나' }, { ko: '옵시디언 서버에 올라간 글' }],
        answer: 0,
        fb: { ko: '맞아. 그래서 사용자 것이고, AI 도 읽을 수 있어.' },
        wrong: { ko: '옵시디언엔 서버가 없어. 방금 윈도우 폴더 창에서 파일을 봤잖아. 다시 골라 봐.' },
      },
    },
    { done: true },
  ],
};

const A3 = {
  id: 'A3',
  course: 'A',
  minutes: 5,
  title: { ko: '마크다운 기호 세 개' },
  intro: {
    ko: '이번 시간엔 노트에 쓰는 마크다운 기호 세 개를 직접 쳐 보고, AI 가 왜 이 형식을 잘 읽는지 알아볼 거야.',
  },
  steps: [
    {
      say: {
        ko: '옵시디언 노트는 **마크다운**이라는 방식으로 써.||글 앞뒤에 기호 몇 개를 붙여서 "여긴 제목", "여긴 목록" 하고 표시하는 방식이야. 아까 본 `.md` 가 마크다운 파일이라는 뜻이야.',
      },
    },
    {
      say: { ko: '처음엔 기호 세 개만 알면 돼. 이렇게 생겼어.' },
      figure: { kind: 'markdown', labels: { ko: ['안녕', '할 일', '안녕', '다른 노트'] } },
    },
    { write: { op: 'note', path: NOTE_PAD, open: true }, preview: false },
    { say: { ko: '연습하라고 "연습장"이라는 노트를 만들어서 가운데에 열어 뒀어. 여기에 쳐 보자.' } },
    { do: 'mood', mood: 'wait' },
    {
      say: {
        ko: '1. 첫 번째는 **제목**이야.||줄 맨 앞에 `#` 을 치고 한 칸 띄운 다음 글을 쓰면 제목이 돼. `#` 은 Shift 를 누른 채 숫자 3 을 누르면 나와.||예를 들면 `# 오늘`. 치고 나면 글자가 크게 바뀌는 게 보일 거야. 아무 제목이나 하나 써 봐.',
      },
    },
    {
      waitFor: 'fileHasText',
      args: { path: NOTE_PAD, pattern: '^#+ \\S' },
      hint: { anchor: 'editor', say: { ko: '연습장 노트를 클릭하고 맨 앞에 `# 오늘` 처럼 쳐 봐. # 다음에 한 칸 띄우는 걸 잊지 마.' } },
      fallback: { write: { op: 'append', path: NOTE_PAD, content: { ko: '# 오늘\n' } }, preview: false },
    },
    { say: { ko: '잘했어. 커서를 그 줄에 두면 `#` 이 보이고, 다른 줄로 옮기면 숨어.||기호는 그대로 있고, 옵시디언이 보기 좋게 감춰 줄 뿐이야.' } },
    {
      say: {
        ko: '2. 두 번째는 **목록**이야.||Enter 로 새 줄을 만들고, 맨 앞에 `-` (빼기 기호)를 친 다음 한 칸 띄우고 글을 써. 예: `- 할 일`.||A1 에서 본 그 점(•)이 바로 이거야. 한 줄 써 봐.',
      },
    },
    {
      waitFor: 'fileHasText',
      args: { path: NOTE_PAD, pattern: '^- \\S' },
      hint: { anchor: 'editor', say: { ko: '새 줄 맨 앞에 `- 할 일` 처럼 쳐 봐. 빼기 기호 다음에 한 칸.' } },
      fallback: { write: { op: 'append', path: NOTE_PAD, content: { ko: '- 세 줄 적기\n' } }, preview: false },
    },
    {
      say: {
        ko: '3. 세 번째는 **굵게**야.||강조하고 싶은 단어 앞뒤를 별표 두 개로 감싸면 돼. 별표(*)는 Shift 를 누른 채 숫자 8. 예: `**중요**`.||아무 단어나 감싸 봐.',
      },
    },
    {
      waitFor: 'fileHasText',
      args: { path: NOTE_PAD, pattern: '\\*\\*[^*\\n]+\\*\\*' },
      hint: { anchor: 'editor', say: { ko: '`**중요**` 처럼 단어 앞뒤에 별표를 두 개씩 붙이면 돼.' } },
      fallback: { write: { op: 'append', path: NOTE_PAD, content: { ko: '**중요**\n' } }, preview: false },
    },
    { do: 'mood', mood: 'idle' },
    { do: 'fx', fx: { type: 'confetti' } },
    {
      card: {
        title: { ko: '왜 마크다운일까' },
        body: {
          ko: '워드나 한글 같은 프로그램은 "여긴 제목"이라는 걸 글자 크기나 색으로 표시해. 그런 꾸밈은 파일 안에 복잡한 형태로 저장돼서 AI 가 읽기 어려워.\n\n마크다운은 `#`, `-`, `**` 같은 기호가 **글자 그대로** 파일에 들어 있어. 그래서 AI 가 어디가 제목이고 어디가 목록인지 바로 알아.\n\n기호를 몰라도 괜찮아. 그냥 줄글로 적어도 AI 가 알아서 형식을 맞춰 줘.',
        },
        figure: { kind: 'markdown', labels: { ko: ['제목', '목록', '굵게', '링크'] } },
        buttons: [{ ko: '알았어' }],
      },
    },
    {
      quiz: {
        q: { ko: '제목을 만들려면?' },
        choices: [{ ko: '줄 맨 앞에 # 을 치고 한 칸 띄운다' }, { ko: '글자 크기를 키운다' }],
        answer: 0,
        fb: { ko: '맞아. 기호를 글자로 적는 거야.' },
        wrong: { ko: '글자 크기는 파일에 글자로 남지 않아서 AI 가 못 읽어. 다시 골라 봐.' },
      },
    },
    { done: true },
  ],
};

const A4 = {
  id: 'A4',
  course: 'A',
  minutes: 6,
  title: { ko: '노트를 링크로 잇기' },
  intro: {
    ko: '이번 시간엔 노트 두 개를 링크로 이어 보고, 노트들이 어떻게 이어져 있는지 한눈에 보여 주는 그래프 뷰를 열어 볼 거야.',
  },
  steps: [
    {
      say: {
        ko: '노트는 하나하나 따로 있는 파일이지만, 서로 이어 줄 수 있어.||노트 안에 다른 노트 이름을 대괄호 두 겹으로 감싸서 `[[노트 이름]]` 이라고 쓰면, 그 노트로 가는 **링크**가 생겨.||노트와 노트를 잇는 고리라서, 앞으로 링크를 **연결고리**라고도 부를게.',
      },
      figure: { kind: 'links', labels: { ko: ['고양이', '츄르', '[[츄르]] 라고 쓰면 연결고리가 생긴다'] } },
    },
    {
      writes: [
        { op: 'note', path: NOTE_A, content: { ko: '고양이는 츄르를 좋아한다.\n' } },
        { op: 'note', path: NOTE_B, content: { ko: '고양이가 좋아하는 간식.\n' } },
      ],
      preview: false,
    },
    { open: NOTE_A },
    { say: { ko: '연습 폴더에 "고양이" 노트와 "츄르" 노트를 만들고, "고양이" 노트를 열어 뒀어.||고양이 노트에 츄르 얘기가 나오지? 그러니까 두 노트를 이어 보자.' } },
    { do: 'mood', mood: 'wait' },
    {
      say: {
        ko: '고양이 노트 아래에 새 줄을 만들고 `[[츄르]]` 라고 써 봐.||대괄호 `[` 는 키보드에서 P 오른쪽에 있어. 두 번 누르면 노트 목록이 뜨는데, 거기서 "츄르"를 클릭해도 되고 이름을 끝까지 쳐도 돼.',
      },
    },
    {
      waitFor: 'linkBetween',
      args: { from: NOTE_A, to: NOTE_B },
      hint: { anchor: 'editor', say: { ko: '고양이 노트 아래쪽에 `[[츄르]]`. 이름을 대괄호 두 개로 감싸면 돼.' } },
      fallback: { write: { op: 'append', path: NOTE_A, content: { ko: '관련: [[츄르]]\n' } }, preview: false },
    },
    { do: 'mood', mood: 'idle' },
    { say: { ko: '연결됐다! `[[츄르]]` 가 색이 다른 글자로 바뀌었지?||그 글자를 클릭하면 츄르 노트가 열려. 지금은 안 눌러도 돼.' } },
    { say: { ko: '이렇게 이어진 노트들을 그림 한 장으로 보여 주는 화면이 있어. **그래프 뷰**야.||노트 하나가 점 하나, 링크 하나가 선 하나로 그려져.' } },
    { say: { ko: '그래프 뷰는 맨 왼쪽 세로 아이콘 줄에서 열어. 어떤 아이콘인지 가리켜 줄게.' } },
    {
      command: 'graph:open',
      ms: 1200,
      via: GRAPH_RIBBON,
      viaLabel: { ko: '그래프 뷰' },
      viaSay: { ko: '이 아이콘이야. 동그라미 몇 개가 선으로 이어진 모양이지? 마우스를 올리면 "그래프 뷰 열기"라고 떠.||이번엔 내가 눌러 줄게.' },
    },
    {
      waitFor: 'graphOpened',
      args: {},
      hint: { anchor: GRAPH_RIBBON, say: { ko: '맨 왼쪽 아이콘 줄에서 동그라미들이 선으로 이어진 아이콘을 눌러 봐.' } },
      fallback: { command: 'graph:open' },
    },
    { do: 'point', anchor: 'graph' },
    {
      say: {
        ko: '가운데에 그래프 뷰가 새 탭으로 열렸어.||"고양이"랑 "츄르" 점 사이에 선이 보이지? 방금 만든 링크야. 점이 작아서 이름이 안 보이면 마우스 휠을 굴려서 확대해 봐.||다른 점들은 볼트에 있는 다른 노트들이야. 어디에도 이어지지 않은 노트는 점만 혼자 떠 있어.',
      },
    },
    { say: { ko: '지금은 네가 직접 이었지만, 위키를 만들면 이 링크를 AI 가 대신 걸어 줘.||노트가 쌓일수록 이 그림에 선이 점점 많아질 거야.||그래프 뷰는 다 봤으면 위쪽 탭의 X 를 눌러 닫으면 돼.' } },
    { do: 'unpoint' },
    {
      quiz: {
        q: { ko: '노트 두 개를 이으려면?' },
        choices: [{ ko: '[[이을 노트 이름]] 을 쓴다' }, { ko: '두 노트를 같은 폴더에 넣는다' }],
        answer: 0,
        fb: { ko: '맞아. 링크로 잇는 거야.' },
        wrong: { ko: '같은 폴더에 있어도 서로 이어지진 않아. 그래프 뷰에 선이 생기는 건 [[ ]] 링크뿐이야. 다시 골라 봐.' },
      },
    },
    { done: true },
  ],
};

const A5 = {
  id: 'A5',
  course: 'A',
  minutes: 4,
  title: { ko: '왜 옵시디언에 만들까' },
  intro: {
    ko: '기초 코스 마지막 시간이야. AI 위키를 왜 하필 옵시디언에 만드는지 정리하고, 다음 코스에서 만들 폴더 구조를 미리 볼 거야.',
  },
  steps: [
    { say: { ko: '기초는 여기까지야. 지금까지 배운 걸로, AI 위키를 왜 옵시디언에 만드는지 정리해 보자.' } },
    {
      card: {
        title: { ko: '이유 세 가지' },
        body: {
          ko: '1. **노트가 전부 평범한 파일**이라 AI 가 직접 읽고 쓸 수 있어. (A2)\n2. **링크와 그래프 뷰**가 있어서 AI 가 이어 준 연결을 눈으로 확인할 수 있어. (A4)\n3. **파일이 사용자 컴퓨터에 있어서** 어떤 폴더를 AI 에게 보여 줄지 사용자가 정해. 옵시디언이 AI 에 접속하는 게 아니라, 사용자가 허락한 폴더를 **AI 가 읽으러 오는 거야.**',
        },
        buttons: [{ ko: '알았어' }],
      },
    },
    { say: { ko: '다음 코스(B)에선 연습 폴더 안에 위키 구조를 만들어. 어떻게 생겼는지 먼저 보여 줄게.' } },
    { do: 'goto', anchor: 'folder:practice:' },
    { do: 'act', motion: 'tchalk', ms: 3200 },
    {
      say: {
        ko: '연습 폴더 안에 이렇게 세 가지를 만들 거야.||1. raw 폴더: 사용자가 AI 에게 줄 글을 넣는 곳. A1 에서 정한 재료(raw 폴더 속 파일)가 여기 들어가.||2. wiki 폴더: AI 가 재료(raw 폴더 속 파일)를 정리한 노트가 쌓이는 곳.||3. AGENTS.md: AI 에게 어떻게 정리하라고 알려 주는 규칙 파일.||자세한 건 다음 시간에 하나씩 만들면서 볼게.',
      },
      figure: { kind: 'rooms', labels: { ko: ['사용자가 재료를 넣는 곳', 'AI 가 정리한 노트', 'AI 에게 주는 규칙', '다음 코스에서 만든다'] } },
    },
    {
      quiz: {
        q: { ko: '옵시디언과 AI 는 어떻게 연결될까?' },
        choices: [{ ko: '사용자가 허락한 폴더를 AI 가 읽으러 온다' }, { ko: '옵시디언이 AI 에 접속한다' }],
        answer: 0,
        fb: { ko: '맞아. 어느 폴더를 보여 줄지는 사용자가 정해.' },
        wrong: { ko: '옵시디언은 폴더를 열어 보여 주는 앱일 뿐이고, AI 와 따로 연결돼 있지 않아. 다시 골라 봐.' },
      },
    },
    { done: true },
  ],
};

module.exports = { A0, A1, A2, A3, A4, A5, COURSE_A: [A0, A1, A2, A3, A4, A5], GRAPH_RIBBON };

};

__defs["core/lessons/courseB"] = function (module, exports, require) {
// 코스 B — LLM Wiki 만들기. 단계 형식과 말투 · 표기 규칙은 courseA.js 머리말 참고.
// 10차에서 한국어판을 새로 썼고 11차에서 다듬었다. en · zh 는 이 한국어판을 기준으로 나중에 한꺼번에 다시 옮긴다.
//
// 말 정하기 (레슨에서 처음 나올 때 "앞으로 ~라고 부를게" 하고 정해 둔다):
//  재료 = raw 폴더 속 파일 (A1) · 연결고리 = 링크 (A4) · 요리 = ingest (B2) · 위키 청소 = lint (B6)
//  그 밖에는 제 이름을 쓴다: raw 폴더 · wiki 폴더 · AGENTS.md(규칙 파일) · README.md(raw 폴더 안내) · index.md(목차) · log.md(작업 기록) · 노트
//  wiki 안 폴더: 요약 폴더(sources) · 개념 폴더(concepts) · 답변 폴더(answers)
// 누가 무엇을 고치나: raw 폴더는 사용자 것 (AI 는 읽기만 하고 절대 고치지 않는다). wiki 폴더는 AI 만 고친다.
// B 코스는 A 코스를 다 듣거나 건너뛰어야 열린다 (건너뛰어도 A 에서 만들 노트는 만들어 둔다 — core/engine.js skipCourse).
// A 에서 만든 것(고양이 · 츄르 노트, "오늘 알게 된 것")을 말할 때는 "옵시디언 사용법 기초 과정에서 만든" 노트라고 밝힌다.
'use strict';
const T = require('../templates');
const { GRAPH_RIBBON } = require('./courseA');

const C_SB = { ko: 'practice:wiki/concepts/개인 위키.md', en: 'practice:wiki/concepts/Personal wiki.md', zh: 'practice:wiki/concepts/个人维基.md' };
const RAW_README = { ko: 'practice:raw/README.md', en: 'practice:raw/README.md', zh: 'practice:raw/README.md' };
const FIRST_RAW = { ko: 'practice:raw/내 첫 재료.md', en: 'practice:raw/My first ingredient.md', zh: 'practice:raw/我的第一份食材.md' };
const GRAPH_HINT = { ko: '맨 왼쪽 아이콘 줄에서 동그라미들이 선으로 이어진 아이콘을 눌러 봐.' };

const ROOMS = {
  kind: 'rooms',
  labels: { ko: ['사용자가 재료를 넣는 곳', 'AI 만 고치는 노트', 'AI 에게 주는 규칙', '이 세 가지가 LLM Wiki 의 전부'] },
};

const B0 = {
  id: 'B0',
  course: 'B',
  minutes: 7,
  title: { ko: '위키를 이루는 세 가지' },
  intro: {
    ko: 'LLM Wiki 코스 첫 시간이야. 위키를 이루는 세 가지(raw 폴더 · wiki 폴더 · AGENTS.md)가 각각 뭘 하는지 알아보고, 연습 폴더 안에 직접 만들어 볼 거야.',
  },
  steps: [
    { do: 'mood', mood: 'idle' },
    { say: { ko: '이제 진짜 위키를 만들어 보자.||생각보다 간단해. 폴더 두 개랑 파일 하나면 돼.' } },
    {
      card: {
        title: { ko: 'raw · wiki · AGENTS.md' },
        body: {
          ko: '1. **raw 폴더**: 사용자가 재료(raw 폴더 속 파일)를 넣는 곳. 메모, 저장한 기사, 회의 기록 같은 걸 여기 넣어. raw 는 "가공하기 전"이라는 뜻이야. 그러니까 **AI 는 raw 폴더 속 파일은 절대 건드리지 않아.** 읽기만 해.\n\n2. **wiki 폴더**: wiki 폴더는 **AI 만 수정할 수 있어.** raw 폴더에 사용자가 넣어 둔 재료(raw 폴더 속 파일)에서 여러 인사이트를 뽑아 AI 가 wiki 폴더에 정리하는 거야. 요약, 개념 정리, 목차가 여기 생겨.\n\n3. **AGENTS.md**: AI 에게 주는 규칙 파일. "재료(raw 폴더 속 파일)를 이렇게 정리해 줘"라는 설명서야. AI 는 일을 시작하기 전에 이 파일부터 읽어.\n\nLLM Wiki 는 이 세 가지가 전부야.',
        },
        figure: ROOMS,
        buttons: [{ ko: '만들어 보자' }],
      },
    },
    {
      faq: {
        title: { ko: '만들기 전에 궁금한 거 있어?' },
        items: [
          {
            q: { ko: 'AI 는 왜 raw 폴더를 안 고쳐?' },
            a: {
              ko: 'AI 가 재료(raw 폴더 속 파일)를 고치면, 나중에 wiki 노트의 내용이 원래 어디서 왔는지 확인할 수 없게 돼.\n\nraw 폴더 속 파일은 원본 기록이야. 재료에 틀린 내용이 있어도 AI 는 그대로 두고, "이 글은 틀렸다"는 판단은 wiki 노트 쪽에 기록해.\n\n재료(raw 폴더 속 파일)는 사용자 것이니까, 사용자가 직접 고치거나 지우는 건 괜찮아. 고치지 않는 건 AI 의 규칙이야.',
            },
          },
          {
            q: { ko: 'AGENTS.md 는 꼭 이 이름이어야 해?' },
            a: {
              ko: '꼭 그렇진 않아. 요즘 AI 도구들이 폴더에서 이 이름의 파일을 먼저 찾아 읽는 경우가 많아서 이 이름을 쓰는 거야. 클로드 코드는 CLAUDE.md 라는 이름을 찾기도 해.\n\n이름보다 중요한 건 AI 에게 일을 시킬 때 "이 파일부터 읽어"라고 말해 주는 거야. 수업 끝나고 혼자 할 때도 매번 그렇게 하게 될 거야.',
            },
          },
          {
            q: { ko: '원래 있던 노트는 괜찮아?' },
            a: {
              ko: '응, 안 건드려. 이번에 만드는 건 전부 연습 폴더 안에 생겨.\n\n나중에 실제로 쓸 땐 이 연습 폴더를 그대로 키워도 되고, 다른 폴더에 같은 구조를 새로 만들어도 돼.',
            },
          },
        ],
      },
    },
    {
      say: {
        ko: '이제 만들게. 세 가지에 더해서 몇 개를 같이 만들 거야.||raw 폴더 안엔 **README.md**, wiki 폴더 안엔 **index.md** 와 **log.md** 를 넣을 거야.||**README.md** 는 "이 폴더가 뭐 하는 곳인지" 알려 주는 안내 파일이야. raw 폴더를 열면 AI 가 가장 처음 읽게 되는 파일이라서, 관례대로 README(읽어 주세요)라는 이름을 붙여.||index.md 와 log.md 는 조금 뒤에 설명할게.',
      },
    },
    {
      say: {
        ko: '만들기 전에 뭘 만들지 보여 주는 창이 뜰 거야.||"raw > README.md" 는 raw 폴더 안에 README.md 파일이 생긴다는 뜻이야. 목록을 확인하고 괜찮으면 "만들기" 버튼을 눌러 줘.',
      },
    },
    {
      writes: [
        { op: 'folder', path: 'practice:raw' },
        { op: 'note', path: RAW_README, content: T.RAW_README },
        { op: 'folder', path: 'practice:wiki' },
        { op: 'note', path: 'practice:AGENTS.md', content: T.AGENTS },
        { op: 'note', path: 'practice:wiki/index.md', content: T.INDEX },
        { op: 'note', path: 'practice:wiki/log.md', content: T.LOG },
      ],
    },
    { waitFor: 'folderExists', args: { path: 'practice:wiki' }, hint: { say: { ko: '창에서 "만들기"를 눌러야 폴더가 생겨.' } } },
    { do: 'point', anchor: 'folder:practice:raw', label: { ko: 'raw 폴더' } },
    { say: { ko: '여기가 **raw 폴더**야. 사용자가 AI 에게 줄 글은 전부 여기에 넣어. 이 파일들이 재료(raw 폴더 속 파일)야.||지금은 안내 파일 README.md 하나만 들어 있어.' } },
    { do: 'point', anchor: 'folder:practice:wiki', label: { ko: 'wiki 폴더' } },
    { say: { ko: '여기가 **wiki 폴더**. AI 가 정리한 노트가 여기 쌓이고, AI 만 고쳐.||폴더 이름 왼쪽 화살표를 눌러 펼쳐 보면 지금은 index.md 랑 log.md 두 개만 있을 거야.' } },
    {
      say: {
        ko: '**index.md** 는 wiki 에 어떤 노트가 있는지 한 줄씩 기록해 둔 **목차**야.||**log.md** 는 AI 가 언제 무슨 작업을 했는지 한 줄씩 남기는 **작업 기록**이야. 둘 다 AI 가 알아서 고쳐.',
      },
    },
    { do: 'point', anchor: 'file:practice:AGENTS.md', label: { ko: 'AGENTS.md' } },
    { say: { ko: '그리고 이게 **AGENTS.md**, 규칙 파일이야.||파일 탐색기에서 AGENTS.md 를 클릭해서 열어 봐. AI 가 할 일이 다 기록돼 있어.' } },
    { do: 'unpoint' },
    { do: 'mood', mood: 'wait' },
    {
      waitFor: 'fileOpened',
      args: { path: 'practice:AGENTS.md' },
      hint: { anchor: 'file:practice:AGENTS.md', say: { ko: '왼쪽 파일 탐색기의 연습 폴더 안에서 AGENTS.md 를 클릭해 봐.' } },
      fallback: { open: 'practice:AGENTS.md' },
    },
    { do: 'mood', mood: 'idle' },
    {
      say: {
        ko: '천천히 읽어 봐. 어려운 말은 없을 거야.||ingest, query, lint 같은 영어 단어가 나오는데, 다음 레슨부터 하나씩 직접 해 볼 거라 지금은 몰라도 돼.||나중에 AI 가 일하는 방식을 바꾸고 싶으면 이 파일만 고치면 돼. 그것도 뒤에서 해 볼 거야.',
      },
    },
    {
      quiz: {
        q: { ko: 'wiki 폴더의 노트는 누가 쓸까?' },
        choices: [{ ko: 'AI 가 쓰고 사용자는 읽는다' }, { ko: '사용자가 직접 쓴다' }],
        answer: 0,
        fb: { ko: '맞아. 사용자는 재료(raw 폴더 속 파일)를 넣고, 정리는 AI 가 해.' },
        wrong: { ko: 'wiki 폴더는 AI 만 고치는 곳이야. 사람이 정리까지 하면 금방 지쳐. 다시 골라 봐.' },
      },
    },
    { done: true },
  ],
};

const B1 = {
  id: 'B1',
  course: 'B',
  minutes: 4,
  title: { ko: '첫 재료 넣기' },
  intro: {
    ko: '이번 시간엔 raw 폴더에 첫 재료(raw 폴더 속 파일)를 넣어 볼 거야. AI 가 raw 폴더를 어떻게 다루는지도 알아볼게.',
  },
  steps: [
    { say: { ko: 'raw 폴더엔 아직 안내 파일 README.md 뿐이니까 재료(raw 폴더 속 파일)부터 넣자.||연습용으로 내가 글 하나를 준비해 왔어. "개인 위키가 뭔가"에 대한 짧은 글이야.' } },
    {
      say: {
        ko: 'AI 가 raw 폴더를 다루는 규칙이 하나 있어. **AI 는 raw 폴더 속 파일을 읽기만 하고 절대 고치지 않아.**||그래서 파일 이름이 중요해. AI 가 이름을 바꿔 주지 않으니까, 처음 넣을 때 "문서1" 같은 이름 말고 내용을 알 수 있는 이름으로 넣어 줘.',
      },
    },
    { say: { ko: '이번에도 넣기 전에 확인 창이 뜰 거야. "만들기"를 눌러 줘.' } },
    { replay: 'raw', n: 1 },
    { waitFor: 'fileCountIn', args: { path: 'practice:raw', min: 2 }, hint: { say: { ko: '확인 창에서 "만들기"를 누르면 재료(raw 폴더 속 파일)가 들어가.' } } },
    { do: 'point', anchor: 'folder:practice:raw', label: { ko: '재료 1' } },
    {
      say: {
        ko: '들어갔다. raw 폴더를 펼쳐 보면 "01-개인 위키가 뭔가"가 있을 거야. 클릭해서 읽어 봐도 돼.||혼자 할 땐 메모 파일을 파일 탐색기에서 raw 폴더 위로 끌어다 놓거나, raw 폴더를 오른쪽 클릭해서 새 노트를 만들어 쓰면 돼.||웹에서 본 기사는 **Web Clipper** 라는 옵시디언 공식 브라우저 확장 프로그램으로 바로 저장할 수도 있어. 그건 필요할 때 찾아봐.',
      },
    },
    { do: 'unpoint' },
    {
      quiz: {
        q: { ko: 'AI 는 raw 폴더 속 파일을 어떻게 다룰까?' },
        choices: [{ ko: '읽기만 하고 절대 고치지 않는다' }, { ko: '읽고 나서 알아서 고쳐 둔다' }],
        answer: 0,
        fb: { ko: '맞아. 재료(raw 폴더 속 파일)는 원본 그대로 두고, 정리한 내용은 wiki 폴더에 기록해.' },
        wrong: { ko: 'AI 가 재료(raw 폴더 속 파일)를 고치면 나중에 wiki 내용이 어디서 왔는지 확인할 수 없어. 다시 골라 봐.' },
      },
    },
    { done: true },
  ],
};

const INGEST_FIG = {
  kind: 'ingest',
  labels: { ko: ['재료 1편', '요약 1', '개념 3', '목차', '작업 기록', '재료 하나로 노트 여러 개가 바뀐다'] },
};

const B2 = {
  id: 'B2',
  course: 'B',
  minutes: 6,
  title: { ko: '첫 요리 — ingest' },
  intro: {
    ko: '이번 시간엔 AI 가 재료(raw 폴더 속 파일)를 읽고 wiki 에 노트를 쓰는 작업, ingest 를 처음으로 볼 거야. 재료 한 편에서 노트가 몇 개 생기는지 직접 확인해 봐.',
  },
  steps: [
    {
      say: {
        ko: 'AI 가 raw 폴더 속 파일, 곧 재료를 읽고 wiki 폴더에 노트를 쓰는 작업을 **ingest** 라고 해. 원래 "받아들여서 소화한다"는 뜻이야.||재료(raw 폴더 속 파일)를 받아서 먹기 좋게 만드는 일이니까, 앞으로 이 작업을 **요리(ingest)**라고도 부를게. "요리한다"고 하면 ingest 한다는 뜻이야.',
      },
    },
    {
      say: {
        ko: '재료(raw 폴더 속 파일) 한 편을 요리(ingest)하면 wiki 에 이런 게 생기거나 바뀌어.||1. 그 글을 요약한 노트 1개. wiki 안 **요약 폴더(sources)**에 들어가.||2. 글에 나온 중요한 개념마다 노트 1개씩. wiki 안 **개념 폴더(concepts)**에 들어가.||3. 목차(index.md)에 새 노트 이름이 추가되고, 작업 기록(log.md)에 한 줄이 붙어.',
      },
      figure: INGEST_FIG,
    },
    { say: { ko: '이번엔 실제 AI 대신 내가 AI 가 ingest 명령어를 수행하는 과정을 재현해 볼게. 실제 AI 로 하는 건 마지막 레슨(B8)에서 해.||확인 창이 뜨면 "만들기"를 눌러 줘.' } },
    { replay: 'ingest', stage: 1 },
    { waitFor: 'fileCountIn', args: { path: 'practice:wiki/concepts', min: 3 }, hint: { say: { ko: '확인 창에서 "만들기"를 눌러야 요리(ingest)가 시작돼.' } } },
    { do: 'point', anchor: 'folder:practice:wiki/sources', label: { ko: '요약 폴더(sources)' } },
    { say: { ko: 'wiki 폴더 안에 요약 폴더(sources)가 생겼지? 여기엔 재료(raw 폴더 속 파일)를 요약한 노트가 들어 있어. 재료 하나에 요약 하나야.' } },
    { do: 'point', anchor: 'folder:practice:wiki/concepts', label: { ko: '개념 폴더(concepts)' } },
    { say: { ko: '그 아래 개념 폴더(concepts)엔 개념 노트가 3개 생겼어. "개인 위키", "꺼내 쓰기", "매일 기록".||raw 폴더에 있는 글 재료들에서 중요한 개념들을 유목화해 정리해 둔 거야.' } },
    { do: 'unpoint' },
    {
      say: {
        ko: '목차(index.md)랑 작업 기록(log.md)도 바뀌었어. 궁금하면 열어 봐.||이렇게 재료(raw 폴더 속 파일) 하나를 요리(ingest)하면 wiki 노트 여러 개가 한꺼번에 바뀌어. 사람이 하면 귀찮아서 안 하게 되는 일(기록 유목화, 태그 붙이기, 인사이트 추출 등)을 AI 가 훨씬 정교하게 대신 하는 거야.',
      },
    },
    {
      faq: {
        title: { ko: '요리(ingest) 보고 궁금한 거 있어?' },
        items: [
          {
            q: { ko: '방금 건 진짜 AI 가 한 거야?' },
            a: {
              ko: '아니. AI 가 하는 과정을 내가 재현해서 보여 준 거야. 그래서 빠르고 돈도 안 들어.\n\n마지막 레슨(B8)에선 네가 쓰는 실제 AI 로 네 재료(raw 폴더 속 파일)를 요리(ingest)해 볼 거야. 그 전까지는 결과가 어떻게 생기는지 익히는 거야.',
            },
          },
          {
            q: { ko: '요약 폴더(sources)랑 개념 폴더(concepts)는 뭐가 달라?' },
            a: {
              ko: '**요약 폴더(sources)** 엔 재료(raw 폴더 속 파일) 하나를 요약한 노트가 들어가. 재료 하나에 요약 하나.\n\n**개념 폴더(concepts)** 엔 개념 하나를 정리한 노트가 들어가. 여러 재료(raw 폴더 속 파일)에서 같은 개념이 나오면 같은 개념 노트에 내용이 계속 더해져. 그래서 재료가 쌓일수록 개념 노트가 점점 풍부해져.',
            },
          },
          {
            q: { ko: '직접 쓴 메모도 재료(raw 폴더 속 파일)가 돼?' },
            a: {
              ko: '그럼. 오히려 제일 좋은 재료(raw 폴더 속 파일)야. 남이 쓴 글보다 "그때 무슨 생각을 했지"가 나중에 훨씬 쓸모 있어.\n\n옵시디언 사용법 기초 과정(A1)에서 만든 "오늘 알게 된 것" 노트도 raw 폴더에 넣으면 재료(raw 폴더 속 파일)가 돼. 마지막 레슨에서 그걸 요리(ingest)할 수도 있어.',
            },
          },
        ],
      },
    },
    { done: true },
  ],
};

const B3 = {
  id: 'B3',
  course: 'B',
  minutes: 4,
  title: { ko: 'AI 가 쓴 노트 읽기' },
  intro: {
    ko: '이번 시간엔 AI 가 쓴 노트를 하나 열어서 어떻게 생겼는지 보고, wiki 노트는 왜 사용자가 직접 고치지 않는지 알아볼 거야.',
  },
  steps: [
    { say: { ko: 'AI 가 쓴 노트를 하나 열어 보자.||wiki 폴더 안 개념 폴더(concepts)에서 "개인 위키" 노트를 클릭해 봐.' } },
    { do: 'point', anchor: 'folder:practice:wiki/concepts', label: { ko: '개념 폴더(concepts) 안에' } },
    { do: 'mood', mood: 'wait' },
    {
      waitFor: 'fileOpened',
      args: { path: C_SB },
      hint: { anchor: 'folder:practice:wiki/concepts', say: { ko: 'wiki 폴더와 그 안의 개념 폴더(concepts)를 펼치고 "개인 위키"를 클릭해 봐.' } },
      fallback: { open: C_SB },
    },
    { do: 'unpoint' },
    { do: 'mood', mood: 'idle' },
    { do: 'act', motion: 'ttilt' },
    {
      say: {
        ko: '네가 쓴 노트는 아니지만, 네 raw 폴더의 재료로 AI 가 만든 노트야. 위에서부터 같이 보자.||**한 줄** 칸엔 이 개념을 한 문장으로 요약해 뒀어.||**재료** 칸엔 이 내용이 raw 폴더의 어느 파일에서 왔는지 기록돼 있어. 원본을 확인하고 싶을 때 보면 돼.||**내용** 칸 중간에 색이 다른 글자들은 다른 wiki 노트로 가는 링크(연결고리)야. 노트끼리 잇는 연결고리를 AI 가 걸어 둔 거야.',
      },
    },
    {
      card: {
        title: { ko: 'wiki 는 읽고, raw 에 쓴다' },
        body: {
          ko: 'wiki 노트를 사용자가 직접 고치면, 다음에 AI 가 요리(ingest)할 때 같은 노트를 다시 쓰면서 사용자가 고친 부분이 사라질 수 있어. 그래서 wiki 폴더는 AI 만 고쳐.\n\n고칠 게 보이면 파일을 직접 고치지 말고 **AI 에게 말해.** 예를 들어 "개인 위키 노트에서 ○○ 부분 고쳐 줘" 하고.\n\n사용자의 생각을 덧붙이고 싶으면 raw 폴더에 새 재료(raw 폴더 속 파일)로 기록해 넣으면 돼. 그러면 다음에 요리(ingest)할 때 AI 가 반영해.',
        },
        buttons: [{ ko: '알았어' }],
      },
    },
    {
      quiz: {
        q: { ko: 'wiki 노트에서 틀린 내용을 발견하면?' },
        choices: [{ ko: 'AI 에게 고쳐 달라고 한다' }, { ko: '사용자가 바로 고친다' }],
        answer: 0,
        fb: { ko: '맞아. 그래야 다음에 요리(ingest)할 때도 고친 내용이 남아.' },
        wrong: { ko: '직접 고치면 다음 요리(ingest) 때 AI 가 덮어쓸 수 있어. 다시 골라 봐.' },
      },
    },
    { done: true },
  ],
};

const B4 = {
  id: 'B4',
  course: 'B',
  minutes: 7,
  title: { ko: '재료가 늘면 연결고리도 는다' },
  intro: {
    ko: '이번 시간엔 그래프 뷰로 지금 위키를 보고, 재료(raw 폴더 속 파일)를 하나 더 요리(ingest)한 다음 연결고리가 어떻게 늘어나는지 비교해 볼 거야. 목차(index.md)가 왜 중요한지도 알아볼게.',
  },
  steps: [
    {
      say: {
        ko: '먼저 지금 위키가 어떻게 이어져 있는지 그래프 뷰로 보자.||그래프 뷰에선 점 하나가 노트 하나, 선 하나가 링크(연결고리) 하나야.||그래프 뷰는 맨 왼쪽 아이콘 줄에 있는 이 아이콘으로 열어.',
      },
    },
    {
      command: 'graph:open',
      ms: 1200,
      via: GRAPH_RIBBON,
      viaLabel: { ko: '그래프 뷰' },
      viaSay: { ko: '여기. 동그라미 몇 개가 선으로 이어진 아이콘이야. 이번엔 내가 눌러 줄게.' },
    },
    {
      waitFor: 'graphOpened',
      args: {},
      hint: { anchor: GRAPH_RIBBON, say: GRAPH_HINT },
      fallback: { command: 'graph:open' },
    },
    { do: 'point', anchor: 'graph' },
    {
      say: {
        ko: '점이 몇 개 있고 선도 몇 개 있지? 아직은 단출해.||그래프 뷰는 볼트 전체를 보여 줘서, raw · wiki 말고 다른 노트도 같이 보여. 옵시디언 사용법 기초 과정(A4)에서 만든 고양이, 츄르 노트가 선으로 이어져 있는 것도 보일 거야.||이제 재료(raw 폴더 속 파일)를 하나 더 넣고 요리(ingest)한 다음, 어떻게 바뀌는지 보자.',
      },
    },
    { do: 'unpoint' },
    { say: { ko: '이번 재료(raw 폴더 속 파일)는 "왜 다들 실패하나"라는 글이야.||확인 창이 두 번 뜰 거야. 한 번은 재료(raw 폴더 속 파일) 넣기, 한 번은 요리(ingest). 둘 다 "만들기"를 눌러 줘.' } },
    { replay: 'raw', n: 2, carry: false },
    { replay: 'ingest', stage: 2 },
    { waitFor: 'fileCountIn', args: { path: 'practice:wiki/concepts', min: 5 }, hint: { say: { ko: '확인 창에서 "만들기"를 눌러 줘.' } } },
    { command: 'graph:open', ms: 1200 },
    { do: 'point', anchor: 'graph' },
    {
      say: {
        ko: '점도 선도 늘었지?||새 재료(raw 폴더 속 파일)에서 개념 노트가 2개 더 생겼고, 원래 있던 "개인 위키" 노트에도 새 내용과 링크가 더해졌어. 새 재료가 옛 노트까지 고쳐 준 거야.||재료(raw 폴더 속 파일)가 쌓일수록 노트끼리 더 촘촘하게 이어지고, 그래서 나중에 물어봤을 때 답도 좋아져.',
      },
      figure: { kind: 'loop', labels: { ko: ['재료 넣기', '요리(ingest)', '연결고리가 늘어남', '다음 답이 좋아짐'] } },
    },
    { do: 'unpoint' },
    {
      card: {
        title: { ko: '채팅에 파일 올리기와 뭐가 달라?' },
        body: {
          ko: 'AI 채팅에 파일을 올려서 물어보면, AI 는 질문할 때마다 원래 글을 처음부터 다시 읽고 답을 만들어. 대화가 끝나면 AI 가 정리한 건 아무 데도 남지 않아.\n\nLLM Wiki 에선 AI 가 정리한 결과를 wiki 폴더에 노트로 남겨 둬. 새 재료(raw 폴더 속 파일)가 들어오면 그 노트에 더하고 고쳐. 방금 본 것처럼 재료가 쌓일수록 위키가 점점 좋아지는 거야.\n\n카파시가 이 방법을 제안한 핵심 이유가 이거야. **정리한 결과가 쌓인다.**',
        },
        buttons: [{ ko: '알았어' }],
      },
    },
    {
      card: {
        title: { ko: '목차 (index.md)' },
        body: {
          ko: 'wiki 에 어떤 노트가 있는지 한 줄씩 기록해 둔 목록이야. AI 가 요리(ingest)할 때마다 새 노트를 여기에 추가해.\n\n나중에 AI 에게 뭘 물어보면, AI 는 **이 목차부터 읽고** 관련 있는 노트만 골라서 열어 봐. 그래서 노트가 수백 개가 돼도 전부 읽지 않고 답을 찾을 수 있어.\n\nwiki 폴더의 index.md 를 열어 보면 지금까지 생긴 노트가 정리돼 있을 거야.',
        },
        buttons: [{ ko: '알았어' }],
      },
    },
    { done: true },
  ],
};

const B5 = {
  id: 'B5',
  course: 'B',
  minutes: 5,
  title: { ko: '물어보기 — query' },
  intro: {
    ko: '이번 시간엔 위키에 쌓인 내용을 꺼내 쓰는 법을 배워. 질문을 골라서 출처가 달린 답을 받아 보고, 좋은 답은 위키에 저장해 볼 거야.',
  },
  steps: [
    { say: { ko: '위키에서 뭔가를 꺼내 쓰는 걸 **query** 라고 해. 우리말로는 그냥 **물어보기**야.||특별한 명령어는 없어. AI 채팅창에 평소처럼 말로 물어보면 돼.' } },
    {
      say: {
        ko: '물어보면 AI 는 이 순서로 답해.||1. 먼저 목차(index.md)를 보고,||2. 질문과 관련된 노트를 열어 읽은 다음,||3. 답 끝에 **어느 노트를 보고 답했는지(출처)**를 달아.||출처가 있으니까, 답이 맞는지 원래 노트를 열어서 확인할 수 있어.',
      },
    },
    { say: { ko: '지금은 연습이라 질문 세 개에 대한 답을 raw 폴더의 재료를 바탕으로 미리 기록해 뒀어. 하나씩 눌러 보고, 다 봤으면 "넘어가기" 버튼을 눌러 줘.||마음에 드는 답이 있으면 "위키에 저장"도 눌러 봐.' } },
    { replay: 'query' },
    {
      say: {
        ko: '저장한 답은 wiki 폴더 안 답변 폴더(answers)에 들어가.||좋은 답을 이렇게 위키에 다시 넣어 두면, 다음에 물어볼 때 AI 가 그 답까지 같이 읽어. 쓸수록 위키가 좋아지는 이유야.||실제로 할 땐 AI 한테 "이 답 위키에 저장해 줘"라고 말하면 돼.',
      },
    },
    {
      card: {
        title: { ko: '잘 물어보는 요령' },
        body: {
          ko: '1. **어디를 보라고 말해 줘.** 예: "raw 폴더에 있는 지난주 기록을 읽고"\n2. **답의 모양을 정해 줘.** 예: "표로 정리해 줘", "체크리스트로 만들어 줘"\n3. **"기록에 없으면 없다고 말해 줘"를 붙여.** 이 한 줄이 있으면 AI 가 없는 내용을 지어내는 걸 막을 수 있어.',
        },
        buttons: [{ ko: '알았어' }],
      },
    },
    { done: true },
  ],
};

const OPS_FIG = {
  kind: 'ops',
  labels: { ko: ['ingest · 요리', 'query · 물어보기', 'lint · 위키 청소'] },
};

const B6 = {
  id: 'B6',
  course: 'B',
  minutes: 6,
  title: { ko: '위키 청소 — lint' },
  intro: {
    ko: '이번 시간엔 재료(raw 폴더 속 파일)를 하나 더 요리(ingest)한 다음, 노트가 쌓이면 생기는 문제를 AI 가 찾아서 고치는 작업(lint)을 볼 거야.',
  },
  steps: [
    { say: { ko: '재료(raw 폴더 속 파일)를 하나 더 넣고 요리(ingest)해 보자. 이번 건 "AI 한테 시키는 법"에 대한 글이야.||이번에도 확인 창이 두 번 뜰 거야. 재료(raw 폴더 속 파일) 넣기 한 번, 요리(ingest) 한 번. 둘 다 "만들기"를 눌러 줘.' } },
    { replay: 'raw', n: 3, carry: false },
    { replay: 'ingest', stage: 3 },
    { waitFor: 'fileCountIn', args: { path: 'practice:wiki/concepts', min: 7 }, hint: { say: { ko: '확인 창에서 "만들기"를 눌러 줘.' } } },
    {
      say: {
        ko: '재료(raw 폴더 속 파일)가 쌓이면 꼭 생기는 문제가 세 가지 있어.||1. 글마다 말이 달라. 한 글은 "하루 세 줄", 다른 글은 "하루 한 줄" 하는 식으로. 새 재료(raw 폴더 속 파일)와 안 맞게 낡아 버린 내용도 생겨.||2. 다른 노트 어디에서도 링크되지 않은 노트가 생겨. 이런 노트를 **고아 노트**라고 해.||3. 여러 노트에서 말은 나오는데, 정작 그 개념을 설명하는 노트는 없어.',
      },
    },
    {
      say: {
        ko: '이런 걸 찾아서 고치는 작업을 **lint** 라고 해. 원래는 프로그램 코드에서 실수를 찾아 주는 도구 이름이야.||앞으로 이 작업을 **위키 청소(lint)**라고 부를게.||이걸로 AI 가 하는 일 세 가지가 다 나왔어. 1. 요리(ingest) 2. 물어보기(query) 3. 위키 청소(lint).',
      },
      figure: OPS_FIG,
    },
    { say: { ko: '지금 위키를 청소해 볼게. 결과가 뜨면 읽어 보고 "고쳐 줘"를 눌러 줘.' } },
    { replay: 'lint' },
    { say: { ko: '청소는 매일 할 필요 없어. 노트가 꽤 쌓였다 싶을 때 한 번씩 하면 돼.||청소할 때 AI 가 "이런 재료(raw 폴더 속 파일)를 더 넣어 보면 좋겠다", "이런 걸 물어보면 좋겠다" 하고 추천해 주기도 해.' } },
    {
      quiz: {
        q: { ko: '위키 청소(lint)가 찾는 건?' },
        choices: [{ ko: '어긋난 말 · 고아 노트 · 빠진 개념 노트' }, { ko: '맞춤법 틀린 곳' }],
        answer: 0,
        fb: { ko: '맞아. 노트끼리 말이 맞고 잘 이어지게 하는 거야.' },
        wrong: { ko: '맞춤법은 상관없어. 노트끼리 내용이 맞는지, 잘 이어져 있는지를 봐. 다시 골라 봐.' },
      },
    },
    { done: true },
  ],
};

const B7 = {
  id: 'B7',
  course: 'B',
  minutes: 5,
  title: { ko: '규칙 바꾸기 — AGENTS.md' },
  intro: {
    ko: '이번 시간엔 규칙 파일(AGENTS.md)에 규칙 한 줄을 더해서 개념 노트의 정리 형식을 바꿔 볼 거야. 그 한 줄 때문에 wiki 노트가 한꺼번에 바뀌는 걸 보게 될 거야. AI 가 일하는 방식을 사용자가 정하는 방법이야.',
  },
  steps: [
    { say: { ko: '마지막으로 배울 건 AI 가 일하는 방식을 바꾸는 방법이야.||방법은 간단해. 규칙 파일 AGENTS.md 에 원하는 규칙을 한 줄 기록하면 돼.' } },
    { do: 'point', anchor: 'file:practice:AGENTS.md', label: { ko: 'AGENTS.md' } },
    {
      say: {
        ko: '이런 상황이라고 해 보자. 개념 폴더(concepts)의 노트를 읽어 보니 한 줄 요약만으로는 감이 잘 안 와. 그래서 개념 노트를 정리하는 형식을 바꾸고 싶어.||그럴 땐 노트를 하나하나 고쳐 달라고 하지 말고, AGENTS.md 에 이 규칙을 더하면 돼. "개념 노트마다 **예시** 칸을 두고, 일상에서 볼 수 있는 예시를 하나 적는다."||확인 창이 두 번 뜰 거야. 규칙 더하기 한 번, 다시 요리(ingest) 한 번. 둘 다 "만들기"를 눌러 줘.',
      },
    },
    { do: 'unpoint' },
    { replay: 'schema' },
    {
      say: {
        ko: 'AGENTS.md 에 한 줄 더했을 뿐인데 개념 노트가 전부 바뀌었지? 개념 폴더(concepts)의 노트를 아무거나 열어서 맨 아래 **예시** 칸을 봐.||노트를 하나하나 고칠 필요 없이, 규칙만 바꾸고 다시 요리(ingest)하면 돼.||AI 가 원하는 대로 안 해 줄 때도 매번 말로 부탁하기보다 규칙 파일에 기록해 두는 게 좋아. 규칙 파일은 쓰면서 조금씩 다듬어 가는 거야.',
      },
      figure: { kind: 'ops', labels: { ko: ['규칙 한 줄 추가', '다시 요리', '노트가 전부 바뀜'] } },
    },
    {
      quiz: {
        q: { ko: 'AI 가 노트 쓰는 방식을 바꾸고 싶으면?' },
        choices: [{ ko: 'AGENTS.md 에 규칙을 적는다' }, { ko: '노트를 하나씩 직접 고친다' }],
        answer: 0,
        fb: { ko: '맞아. 규칙 한 줄이 모든 노트에 적용돼.' },
        wrong: { ko: 'wiki 노트는 AI 만 고치는 거고, 하나씩 고치다 보면 금방 지쳐. 다시 골라 봐.' },
      },
    },
    { done: true },
  ],
};

const B8 = {
  id: 'B8',
  course: 'B',
  minutes: 8,
  title: { ko: '수료 — 네 재료를 실제 AI 로' },
  intro: {
    ko: '마지막 시간이야. 지금까지는 내가 재현해서 보여 준 결과를 봤는데, 이번엔 네가 평소 쓰는 AI 로 네 재료(raw 폴더 속 파일) 하나를 직접 요리(ingest)해 볼 거야. 끝나면 수료야.',
  },
  steps: [
    {
      say: { ko: '지금까지 본 요리(ingest)는 전부 내가 재현해서 보여 준 거였어.||이번엔 네가 평소에 쓰는 **실제 AI** 로 직접 해 보자.' },
      figure: { kind: 'loop', labels: { ko: ['재료 하나', 'AI 에게 요리(ingest) 부탁', '첫 노트가 생긴다', '매일 세 줄 · 일주일에 한 번 요리'] } },
    },
    { real: 'askMode' },
    { if: 'mode', eq: 'folder', then: [{ real: 'folderGuide' }], else: [] },
    {
      card: {
        title: { ko: '재료 하나 넣기' },
        body: {
          ko: 'raw 폴더에 **네 글 하나**를 넣어 줘. 이게 네 첫 재료(raw 폴더 속 파일)야. 방법은 편한 걸로 골라.\n\n1. 볼트에 있는 네 노트 하나를 파일 탐색기에서 raw 폴더 위로 끌어다 놓기 (원래 있던 자리에선 옮겨져). 옵시디언 사용법 기초 과정(A1)에서 만든 "오늘 알게 된 것" 노트도 좋아.\n2. raw 폴더를 오른쪽 클릭해서 새 노트를 만들고, 오늘 있었던 일 세 줄 기록하기\n3. Web Clipper 로 기사 하나 저장하기\n\n고르기 어려우면 그냥 기다려. 조금 있다가 내가 연습용 재료(raw 폴더 속 파일)를 대신 넣어 줄지 물어볼게.',
        },
        buttons: [{ ko: '알았어' }],
      },
    },
    { do: 'point', anchor: 'folder:practice:raw', label: { ko: 'raw 폴더' } },
    { do: 'mood', mood: 'wait' },
    {
      waitFor: 'fileCountIn',
      args: { path: 'practice:raw', min: 5 },
      hint: { anchor: 'folder:practice:raw', say: { ko: '노트 하나를 파일 탐색기에서 이 raw 폴더 위로 끌어다 놓으면 돼.' } },
      fallback: {
        write: {
          op: 'note',
          path: FIRST_RAW,
          content: { ko: '# 내 첫 재료\n\n- 위키 정리는 AI 한테 맡기면 된다\n- 저장만 하면 잊는다\n- 매일 세 줄이면 된다\n' },
        },
        preview: false,
      },
    },
    { do: 'unpoint' },
    { do: 'mood', mood: 'idle' },
    { real: 'ingest' },
    { do: 'mood', mood: 'wait' },
    {
      waitFor: 'newFileUnder',
      args: { path: 'practice:wiki', since: '$ingestAt' },
      hint: { anchor: 'folder:practice:wiki', say: { ko: 'AI 가 다 쓰면 wiki 폴더에 새 노트가 생겨. 아직이면 AI 창을 한번 확인해 봐.' } },
    },
    { do: 'mood', mood: 'idle' },
    { do: 'act', motion: 'tgradcap', ms: 2300 },
    { say: { ko: '네 재료(raw 폴더 속 파일)로, 네 AI 가 만든 첫 노트가 생겼어. 수료 축하해!' }, kind: 'cheer' },
    {
      card: {
        title: { ko: '앞으로 할 일' },
        body: {
          ko: '1. **매일 세 줄**: raw 폴더에 오늘 한 일, 알게 된 것, 메모. 형식은 상관없어.\n2. **일주일에 한 번 요리(ingest)**: 요일을 정해 둬. "생각날 때 하지" 하면 잘 안 하게 돼.\n3. **처음엔 재료를 하나씩**: 재료(raw 폴더 속 파일)를 한꺼번에 몰아넣지 말고, 하나 요리할 때마다 AI 가 쓴 노트를 훑어봐. 마음에 안 들면 AGENTS.md 에 규칙을 더하면 돼.\n4. **이번 달 안에 한 번 꺼내 쓰기**: 한 주 정리를 부탁하든, "그때 왜 그렇게 했더라"를 물어보든. 한 번 해 보면 왜 기록하는지 실감이 나.',
        },
        buttons: [{ ko: '알았어' }],
      },
    },
    { real: 'promptCards' },
    {
      card: {
        title: { ko: '다음에 쓸 도구' },
        body: {
          ko: '이 연습 폴더를 그대로 계속 써도 되고, 더 본격적인 도구로 옮겨 가도 돼.\n\n1. **Karpathy LLM Wiki 플러그인**: 옵시디언 설정의 커뮤니티 플러그인에서 설치할 수 있어. 위키 폴더를 이 연습 폴더의 `wiki` 로 지정하면 지금까지 만든 노트에 이어서 쓸 수 있어.\n2. **클로드 데스크톱 앱**: 볼트 폴더를 연결해 두면 "ingest 해 줘" 한마디로 요리(ingest)할 수 있어.\n\n나는 화면 아래에 계속 있을게. 가끔 "오늘 세 줄 기록했어?" 하고 물어볼 거야.',
        },
        buttons: [{ ko: '고마워' }],
      },
    },
    {
      say: {
        ko: '마지막으로 하나만. 지금까지는 "매일 세 줄"이라고 했지만, 세 줄은 습관을 만드는 시작일 뿐이야.||매일 기록하는 내용의 질이 높을수록, 그리고 "왜 그렇게 했는지", "그때 무슨 생각이었는지" 같은 맥락이 많이 기록될수록 AI 가 만들어 주는 위키도 훨씬 풍성해져.||세 줄로 시작해서, 익숙해지면 조금씩 더 자세히 기록해 봐. 네 위키는 네가 남긴 기록만큼 자라.',
      },
      kind: 'cheer',
    },
    { done: true },
  ],
};

module.exports = { B0, B1, B2, B3, B4, B5, B6, B7, B8, COURSE_B: [B0, B1, B2, B3, B4, B5, B6, B7, B8] };

};

__defs["core/lessons/en"] = function (module, exports, require) {
// 레슨 · 필기 글의 영어판. 한국어 원문(courseA · courseB · notes)을 열쇠로 찾는다 — lessons/index.js 의 translate().
// 한국어를 고치면 그 글은 열쇠가 안 맞아 "번역 대기"로 돌아간다 (tests/run.js 가 센다). 그때 여기 열쇠와 번역을 같이 고친다.
'use strict';

module.exports = {
  // ── 코스 A ──
  '만남, 그리고 화면 둘러보기': 'Hello, and a look around',
  '첫 시간이야. 인사하고, 옵시디언 화면이 어떻게 생겼는지 같이 둘러본 다음 연습용 폴더를 하나 만들 거야.': 'Our first lesson. We\'ll say hi, take a quick tour of the Obsidian screen, and then make a folder to practice in.',
  '안녕! 나는 이 수업을 맡은 고양이야.||이름은 아직 없어. 같이 하다가 좋은 이름이 떠오르면 지어 줘.': 'Hi! I\'m the cat teaching this class.||I don\'t have a name yet. If a good one comes to you along the way, go ahead and give me one.',
  '"AI 가 알아서 정리해 주는 위키" 얘기 듣고 왔지?': 'You heard about the "wiki the AI organizes for you," right?',
  '응, SNS 에서 봤어': 'Yeah, saw it on social media',
  '그냥 궁금해서': 'Just curious',
  '나도 그거 보고 해 보고 싶었는데, 막상 어디서부터 해야 할지 모르겠더라.||그래서 처음부터 하나씩 같이 해 보려고.': 'I saw it too and wanted to try, but I had no idea where to start.||So let\'s go through it together, step by step from the beginning.',
  '궁금해서 왔으면 충분해.||처음부터 하나씩 같이 해 보자.': 'Curious is plenty.||Let\'s go through it together, one step at a time.',
  '수업은 두 부분이야.||앞부분(A)은 옵시디언 기본 사용법이고, 뒷부분(B)은 AI 가 정리해 주는 위키를 실제로 만들어 보는 거야. 레슨 하나는 5분 안팎이야.': 'The class has two parts.||Part A covers Obsidian basics, and part B is where we actually build a wiki the AI organizes for you. Each lesson takes about 5 minutes.',
  '말풍선 보는 법부터 알려 줄게.||내 말은 네가 넘기기 전까지 그대로 있어. 다 읽었으면 말풍선을 한 번 누르면 다음 말로 넘어가.||지나간 말을 다시 보고 싶으면 왼쪽 아래 "← 이전"을 누르면 돼. 지금 한번 눌러 봐도 좋아.': 'First, how speech bubbles work.||What I say stays put until you move on. When you\'re done reading, click the bubble once to see the next line.||Want to see an earlier line again? Click "← Back" at the bottom left. Feel free to try it now.',
  '이제 옵시디언 화면을 같이 둘러보자. 처음엔 세 군데만 알면 돼. 하나씩 깜빡이는 테두리로 짚어 줄게.': 'Now let\'s look around the Obsidian screen. You only need to know three spots for now. I\'ll point each one out with a blinking outline.',
  '파일 탐색기': 'File explorer',
  '1. 왼쪽 칸은 **파일 탐색기**야.||지금 옵시디언이 열고 있는 폴더 안의 폴더와 노트가 여기 목록으로 다 나와. 노트를 열 때도 여기서 이름을 클릭하면 돼.': '1. The left pane is the **File explorer**.||It lists every folder and note inside the folder Obsidian has open. To open a note, just click its name here.',
  '아이콘 줄': 'Ribbon',
  '2. 화면 맨 왼쪽 끝에 작은 아이콘이 세로로 늘어서 있지? 테두리로 감싼 곳이야.||자주 쓰는 기능을 바로 여는 버튼들이야. 아이콘에 마우스를 올리면 이름이 떠. 나중에 여기서 "그래프 뷰"라는 화면을 열 거야.': '2. See the column of small icons on the far left edge? That\'s the outlined spot, called the ribbon.||These buttons open features you use a lot. Hover over an icon to see its name. Later we\'ll open a screen called "Graph view" from here.',
  '3. 가운데 넓은 곳은 노트를 열어서 읽고 쓰는 화면이야.||노트를 여러 개 열면 위쪽에 탭으로 쌓여. 웹 브라우저 탭이랑 똑같아.': '3. The big area in the middle is where you open, read, and write notes.||Open several notes and they stack up as tabs along the top, just like browser tabs.',
  '하나만 더. 옵시디언이 열고 있는 이 폴더 전체를 **볼트(vault)**라고 불러. 한국어 화면에선 "보관함"이라고 나와.||볼트가 정확히 뭔지는 A2 에서 직접 확인해 볼 거야.': 'One more thing. The whole folder Obsidian has open is called a **vault**.||We\'ll see exactly what a vault is in A2.',
  '이제 연습할 폴더를 만들자.||볼트 안에 폴더를 하나 새로 만들고, 수업에서 하는 건 전부 그 안에서만 해. 네가 원래 갖고 있던 노트는 건드리지 않아.': 'Now let\'s make a folder to practice in.||We\'ll create a new folder inside your vault and do everything in class inside it. Your existing notes won\'t be touched.',
  '"{root}" 라는 폴더를 만들어도 될까?': 'Okay if I create a folder called "{root}"?',
  '응, 만들어': 'Sure, go ahead',
  '잠깐만': 'Hold on',
  '알았어. 준비되면 맨 왼쪽 아이콘 줄에서 고양이 아이콘을 눌러 줘. 거기서부터 이어서 할게.': 'Got it. When you\'re ready, click the cat icon in the ribbon on the far left. We\'ll pick up from there.',
  '파일 탐색기에 폴더가 안 보이면 목록을 위아래로 스크롤해 봐. 폴더는 이름 순서대로 놓여 있어.': 'Don\'t see the folder in the File explorer? Try scrolling the list up or down. Folders are sorted by name.',
  '연습 폴더': 'Practice folder',
  '파일 탐색기에 "{root}" 폴더가 생겼지?||앞으로 수업에서 만드는 노트는 전부 이 폴더 안에 들어가.': 'See the "{root}" folder in the File explorer?||Every note we make in class goes inside this folder.',
  '폴더 이름 왼쪽의 작은 화살표를 클릭하면 폴더가 펼쳐지고, 한 번 더 클릭하면 접혀.||지금은 비어 있어서 펼쳐도 아무것도 없을 거야.': 'Click the small arrow left of the folder name to expand it, and click again to collapse it.||It\'s empty right now, so you won\'t see anything inside yet.',
  '왜 기록해 둬야 할까': 'Why write things down',
  '이번 시간엔 기록해 두지 않으면 어떤 일이 생기는지 내 얘기 다섯 개로 보고, 1분 동안 세 줄을 직접 기록해 볼 거야. 궁금한 건 중간에 물어봐도 돼.': 'This time I\'ll tell you five short stories about what happens when you don\'t write things down, and then you\'ll spend one minute writing down three lines yourself. Ask questions anytime.',
  '본격적으로 하기 전에 내 얘기 좀 들어 줘. 짧은 거 다섯 개야. 1번부터 차례로 할게.': 'Before we really start, hear me out. Five short stories. I\'ll go in order, starting with number 1.',
  '1. 분명히 저장해 둔 글이 있었는데 못 찾겠어.||북마크, 스크린샷, 나한테 보낸 메시지까지 다 뒤졌는데 없더라.': '1. I know I saved that article somewhere, but I can\'t find it.||I dug through bookmarks, screenshots, even messages to myself. Nothing.',
  '## 기록해 두지 않으면 생기는 일': '## What happens when you don\'t write things down',
  '1. 저장만 하고 다시 안 봄 → 결국 잊힌다': '1. Saved but never revisited → eventually forgotten',
  '1. 저장했는데 못 찾는다': '1. Saved it, can\'t find it',
  '지식관리 앱 사용자를 조사한 연구를 보면, 사람들은 저장하는 데는 시간을 꽤 쓰는데 나중에 **다시 찾아보는 일**은 잘 안 된다고 답했어.\n\n저장만 하고 다시 보지 않은 건 결국 잊혀.': 'In a study of people who use note-taking apps, people said they spend a lot of time saving things, but rarely manage to **go back and find them** later.\n\nWhat you save and never look at again ends up forgotten.',
  '다음': 'Next',
  '2. 읽을 책을 잔뜩 사 놓고 뿌듯했어.||근데 사실 한 권도 안 읽었어.': '2. I bought a stack of books to read and felt great about it.||Truth is, I haven\'t read a single one.',
  '2. 모은다고 아는 건 아니다': '2. Collecting isn\'t knowing',
  '"이런 게 있다는 걸 안다"와 "내용을 안다"는 달라.\n\n저장 버튼 누르기가 너무 쉬워서, 저장만 해도 뭔가 한 기분이 들어. 이걸 **수집가의 오류**라고 해.': '"Knowing something exists" and "knowing what it says" are different things.\n\nHitting save is so easy that just saving feels like getting something done. This is called the **collector\'s fallacy**.',
  '2. **수집가의 오류** — 모으기 ≠ 알기': '2. **Collector\'s fallacy** — collecting ≠ knowing',
  '3. 어제 들은 얘기가 오늘 벌써 가물가물해.': '3. What I heard yesterday is already fuzzy today.',
  '3. 금방 잊힌다': '3. We forget fast',
  '사람은 새로 들은 걸 처음 몇 시간 사이에 가장 많이 잊어버려. 이걸 **망각 곡선**이라고 해.\n\n그래서 그날 기록해 두지 않으면 남는 게 거의 없어.': 'People forget most of what they\'ve just learned within the first few hours. This is called the **forgetting curve**.\n\nSo if you don\'t write it down that same day, almost nothing sticks.',
  '3. **망각 곡선** — 몇 시간 안에 가장 많이 잊음 → 그날 기록': '3. **Forgetting curve** — most is lost within hours → write it down that day',
  '4. 그래서 정리를 잘해 보려고 폴더랑 태그를 잔뜩 만들었어.||일주일 만에 지쳐서 그만뒀어.': '4. So I made tons of folders and tags to get really organized.||I burned out and quit within a week.',
  '4. 정리하다 지친다': '4. Burning out on organizing',
  '메모 정리가 오래 못 가는 건 대부분 **관리하는 일** 때문이야.\n\n새 글이 들어올 때마다 어디에 넣을지 고르고, 관련 있는 글끼리 이어 주고, 오래된 내용을 고치는 일. 이걸 사람이 다 하려고 하면 금방 지쳐.': 'Note systems usually fall apart because of **the upkeep**.\n\nEvery time something new comes in, you pick where it goes, connect it to related notes, and fix what\'s gone out of date. Try to do all of that yourself and you\'ll burn out fast.',
  '4. 정리가 멈추는 이유 — **관리**(분류 · 연결 · 고치기)가 힘들어서': '4. Why organizing stalls — **upkeep** (sorting · linking · fixing) is hard work',
  '5. 그 관리를 AI 한테 맡기면 된다는 걸 알았어.||사용자는 글을 넣고 읽기만 하고, 분류하고 잇고 요약하는 건 AI 가 하는 거야.': '5. Then I learned you can hand that upkeep to an AI.||You just add writing and read. Sorting, linking, and summarizing is the AI\'s job.',
  '## 해결: LLM Wiki': '## The fix: LLM Wiki',
  '**LLM Wiki** — 관리는 AI, 사용자는 넣고 읽기': '**LLM Wiki** — the AI does the upkeep, you add and read',
  '5. LLM Wiki 가 뭐냐면': '5. So what\'s an LLM Wiki?',
  'AI 가 관리해 주는 개인 위키를 **LLM Wiki** 라고 해. LLM 은 ChatGPT 나 클로드 같은 AI 를 가리키는 말이야. 2026년 4월에 AI 연구자 **안드레 카파시(Andrej Karpathy)**가 이 방법을 글로 소개하면서 널리 알려졌어.\n\n여기서 중요한 건 AI 가 얼마나 똑똑하냐가 아니라 **AI 가 읽을 거리가 있느냐**야. 사용자가 평소에 어떤 식으로 일하는지, 어떤 일을 왜 그렇게 정했는지, 지금 어떤 상황인지. 이런 **사용자의 일과 맥락에 대한 기록**이 있어야 AI 가 사용자에게 맞는 답을 줄 수 있어.\n\n똑같은 질문에도 AI 답이 뻔하게 느껴질 때가 있지? 대개 AI 가 사용자에 대해 읽을 기록이 없어서 그래.': 'A personal wiki that an AI maintains for you is called an **LLM Wiki**. LLM refers to AIs like ChatGPT or Claude. The idea spread widely after AI researcher **Andrej Karpathy** wrote it up in April 2026.\n\nWhat matters here isn\'t how smart the AI is, but **whether it has something to read**. How you usually work, why you decided things the way you did, what\'s going on right now. The AI needs **records of your work and context** like these to give you answers that fit you.\n\nEver notice the AI giving you generic answers to the same question? Usually that\'s because it has no records about you to read.',
  '사용자': 'You',
  '글을 넣고, 읽는다': 'Add writing, read',
  'AI': 'AI',
  '분류 · 연결 · 요약': 'Sort · link · summarize',
  '알았어': 'Got it',
  '카파시(Andrej Karpathy)가 2026년 4월에 소개': 'Introduced by Andrej Karpathy in April 2026',
  '**AI 가 읽을 거리** — 사용자의 일 · 맥락 기록': '**Something for the AI to read** — records of your work · context',
  '여기서 말 하나를 정해 두자. AI 가 읽고 정리할 원래 글, 그러니까 사용자의 일과 맥락을 기록해 둔 글을 앞으로 **재료**라고 부를게.||재료는 B 코스에서 만들 **raw 폴더**에 모아 둘 거야. 그래서 앞으로 "재료"라고 하면 **raw 폴더 속 파일**을 말하는 거야.||직접 쓴 메모든 회의 기록이든 저장해 둔 기사든, AI 한테 넘겨줄 글이면 다 재료(raw 폴더 속 파일)가 될 수 있어.': 'Let\'s settle on a word here. The original writing the AI reads and organizes, meaning anything that records your work and context, I\'ll call an **ingredient** from now on.||We\'ll collect ingredients in the **raw folder** you\'ll make in course B. So from now on, "ingredient" means **a file in the raw folder**.||Notes you wrote yourself, meeting notes, saved articles: anything you hand to the AI can be an ingredient (a file in the raw folder).',
  '## 말 정하기': '## Words we use',
  '**재료** — raw 폴더 속 파일 (AI 가 읽고 정리할 원래 글)': '**Ingredient** — a file in the raw folder (original writing the AI reads and organizes)',
  '궁금한 거 있어?': 'Any questions?',
  '궁금한 걸 누르면 답해 줄게. 다 봤으면 "넘어가기".': 'Click a question and I\'ll answer it. When you\'re done, click "Move on".',
  '그냥 메모 앱이랑 뭐가 달라?': 'How is this different from a regular notes app?',
  '메모 앱은 기록하는 것도 사용자가, 정리하는 것도 사용자가 해. 그래서 쌓일수록 찾기가 어려워져.\n\nLLM Wiki 에선 사용자는 재료(raw 폴더 속 파일)만 넣고, 요약하고 서로 잇고 목차를 고치는 건 AI 가 해. 그래서 쌓일수록 오히려 찾기 쉬워져.': 'In a notes app, you do the writing and you do the organizing. So the more you pile up, the harder things are to find.\n\nIn an LLM Wiki, you just add ingredients (files in the raw folder), and the AI summarizes, links them together, and updates the contents. So the more you pile up, the easier things get to find.',
  'AI 가 글을 읽어도 안전해?': 'Is it safe to let an AI read my writing?',
  '네가 고른 AI 에게, 네가 고른 폴더만 보여 주는 거야. 이 플러그인은 네 글을 어디로도 보내지 않아.\n\n그래도 고객 개인정보, 비밀번호, 민감한 금액 같은 건 처음부터 재료(raw 폴더 속 파일)로 넣지 마. 꼭 필요하면 "A사 담당자"처럼 바꿔서 적으면 돼.': 'You show only the folder you choose, to the AI you choose. This plugin doesn\'t send your writing anywhere.\n\nStill, keep things like customer personal info, passwords, or sensitive amounts out of your ingredients (files in the raw folder) from the start. If you really need them, swap in something like "the contact at Company A".',
  '매일 세 줄이면 정말 돼?': 'Is three lines a day really enough?',
  '응. 오늘 한 일, 알게 된 것, 그 밖의 메모. 형식도 맞춤법도 신경 안 써도 돼.\n\n며칠 빼먹어도 괜찮아. 출석 체크가 아니라 나중에 꺼내 쓸 재료(raw 폴더 속 파일)를 모으는 거니까. 제일 쓸모 있는 건 "이건 다음에 조심해야겠다" 같은 한 줄이야.': 'Yep. What you did today, what you learned, and anything else. Don\'t worry about format or spelling.\n\nSkipping a few days is fine too. It\'s not a streak to keep. You\'re collecting ingredients (files in the raw folder) to get back later. The most useful kind is a line like "Watch out for this next time."',
  '그럼 지금 재료가 될 글을 하나 만들어 보자. 1분이면 돼.': 'So let\'s make something that can become an ingredient right now. It takes a minute.',
  '- \n': '- \n',
  '방금 연습 폴더 안에 "오늘 알게 된 것"이라는 노트를 만들어서 가운데 화면에 열어 뒀어.||왼쪽 파일 탐색기에서 연습 폴더를 펼쳐 보면 이 노트가 있을 거야.': 'I just made a note called "What I learned today" in the practice folder and opened it in the middle.||Expand the practice folder in the File explorer on the left and you\'ll see it.',
  '여기에 오늘 알게 된 거나 느낀 걸 세 줄만 기록해 봐. 아무거나 괜찮아.||가운데 노트를 한 번 클릭하면 글자를 쓸 수 있어. 첫 줄 앞의 점(•)은 목록 표시야. 한 줄 쓰고 Enter 를 누르면 다음 줄에도 점이 생겨.||맞춤법이나 문장은 신경 쓰지 마. 단어만 적어도 돼.': 'Write down just three lines here: something you learned or felt today. Anything works.||Click the note in the middle once and you can type. The dot (•) at the start of the first line is a list marker. Type a line and press Enter, and the next line gets a dot too.||Don\'t worry about spelling or sentences. Single words are fine.',
  '## 매일 할 일': '## Every day',
  '**세 줄** — 한 일 · 알게 된 것 · 메모': '**Three lines** — what you did · what you learned · notes',
  '가운데 노트를 클릭하고 한 줄에 하나씩 적으면 돼. 세 줄이 되면 내가 알아챌게.': 'Click the note in the middle and write one thing per line. I\'ll notice once there are three.',
  '- 위키 정리는 AI 한테 맡기면 된다\n- 저장만 하면 잊는다\n- 매일 세 줄이면 된다\n': '- Let the AI organize the wiki\n- If you only save it, you forget it\n- Three lines a day is enough\n',
  '됐다! 하루에 할 일은 이게 다야.||참, 저장 버튼은 따로 없어. 옵시디언은 쓰는 대로 바로 저장돼.||방금 쓴 세 줄을 나중에 raw 폴더에 넣으면, 그게 AI 가 읽을 재료(raw 폴더 속 파일)야.': 'Done! That\'s all you need to do each day.||Oh, and there\'s no save button. Obsidian saves as you type.||Later, put those three lines in the raw folder and they become an ingredient (a file in the raw folder) for the AI to read.',
  '**자동 저장** — 옵시디언엔 저장 버튼이 없다': '**Autosave** — Obsidian has no save button',
  '사용자가 매일 할 일은?': 'What do you do every day?',
  '편하게 세 줄 기록하기': 'Write down three lines, no pressure',
  '폴더와 태그 정리하기': 'Organize folders and tags',
  '맞아. 정리는 AI 가 할 일이야.': 'Right. Organizing is the AI\'s job.',
  '그건 4번 얘기에서 일주일 만에 지친 방법이야. 다시 골라 봐.': 'That\'s the approach from story 4 that burned out in a week. Try again.',
  '옵시디언 노트는 그냥 파일이다': 'Obsidian notes are just files',
  '이번 시간엔 옵시디언이 어떤 앱인지 알아보고, 아까 쓴 노트가 네 컴퓨터에 진짜 파일로 저장돼 있는지 윈도우 폴더 창에서 직접 확인해 볼 거야.': 'This time we\'ll see what kind of app Obsidian is, and check in a Windows folder window that the note you wrote earlier really is a file on your computer.',
  '옵시디언이 어떤 앱인지부터 말해 줄게.||옵시디언은 컴퓨터에 있는 폴더 하나를 열어서, 그 안의 글 파일을 보기 좋게 보여 주고 고칠 수 있게 해 주는 앱이야.': 'Let me start with what Obsidian is.||Obsidian opens a folder on your computer and shows the text files inside it in a nice, readable way so you can edit them.',
  '## 옵시디언': '## Obsidian',
  '컴퓨터의 **폴더를 열어 보여 주는 앱**': 'An **app that opens a folder on your computer and shows it**',
  '볼트와 노트': 'Vaults and notes',
  '**볼트(vault)**: 옵시디언이 여는 폴더 하나. 한국어 화면에선 "보관함"이라고 나와. 왼쪽 파일 탐색기에 보이는 건 전부 이 볼트 안에 있는 거야.\n\n**노트**: 볼트 안의 글 파일 하나. 파일 이름 끝에 `.md` 가 붙어. md 는 마크다운이라는 글 형식인데, 다음 레슨에서 배울 거야.\n\n회원가입이나 서버가 필요 없어. 파일이 사용자 컴퓨터에 있으니까 옵시디언을 지워도 노트는 그대로 남아.': '**Vault**: the one folder Obsidian opens. Everything you see in the File explorer on the left lives inside this vault.\n\n**Note**: one text file inside the vault. Its file name ends in `.md`. md stands for Markdown, a text format we\'ll learn in the next lesson.\n\nNo sign-up, no server. The files live on your computer, so even if you uninstall Obsidian, your notes stay put.',
  '정말?': 'Really?',
  '**볼트**(보관함) — 옵시디언이 여는 폴더': '**Vault** — the folder Obsidian opens',
  '**노트** — 볼트 안의 `.md` 파일 하나': '**Note** — one `.md` file inside the vault',
  '서버 · 회원가입 없음 → 파일은 사용자 것': 'No server · no sign-up → the files are yours',
  '직접 확인해 보자. 아까 쓴 "오늘 알게 된 것" 노트를 윈도우 폴더 창에서 열어 볼게.': 'Let\'s check for ourselves. I\'ll open the "What I learned today" note you wrote earlier in a Windows folder window.',
  '오늘 알게 된 것': 'What I learned today',
  '혼자 할 땐 이렇게 해. 파일 탐색기에서 노트 이름 위에 마우스를 두고 **오른쪽 버튼**을 누르면 메뉴가 떠.||거기서 **"폴더에서 보기"**를 고르면 돼. 맥에선 "Finder에서 보기"라고 나와.||이번엔 내가 대신 열어 줄게.': 'Here\'s how to do it on your own. In the File explorer, hover over a note\'s name and **right-click** to open a menu.||Then pick **"Show in system explorer"**. On a Mac it says "Reveal in Finder".||This time I\'ll open it for you.',
  '## 파일 위치 보기': '## Finding the file',
  '노트 **우클릭 → 폴더에서 보기**': '**Right-click** a note **→ Show in system explorer**',
  '윈도우 폴더 창이 하나 떴지? 그 안에 "오늘 알게 된 것.md" 파일이 있을 거야.||그 파일이 방금 네가 옵시디언에서 쓴 노트야. 확인했으면 옵시디언으로 돌아와서 눌러 줘.': 'See the Windows folder window that popped up? There should be a "What I learned today.md" file in it.||That file is the note you just wrote in Obsidian. Once you\'ve seen it, come back to Obsidian and click below.',
  '봤어': 'Saw it',
  '창이 안 떴어': 'No window showed up',
  '폴더 창이 옵시디언 뒤에 가려져 있을 수도 있어. 화면 아래 작업 표시줄을 한번 봐 줘.||그래도 없으면 나중에 노트 이름을 오른쪽 클릭해서 "폴더에서 보기"로 직접 열어 봐.': 'The folder window might be hiding behind Obsidian. Take a look at the taskbar at the bottom of the screen.||If it\'s still not there, later on right-click the note\'s name and open it yourself with "Show in system explorer".',
  '맞아. 옵시디언은 이 파일을 열어서 보여 주고 있었던 거야.||폴더 창은 이제 닫아도 돼.': 'Right. Obsidian was just opening this file and showing it to you.||You can close the folder window now.',
  '이게 왜 중요하냐면,||노트가 평범한 파일이니까 **AI 도 이 파일을 직접 읽고 쓸 수 있어.** AI 가 관리하는 위키를 옵시디언에 만드는 이유가 이거야.': 'Here\'s why this matters.||Since notes are ordinary files, **the AI can read and write them directly too.** That\'s why we build an AI-maintained wiki in Obsidian.',
  '## 왜 중요한가': '## Why it matters',
  '평범한 파일 → **AI 도 직접 읽고 씀**': 'Ordinary files → **the AI can read and write them directly**',
  '옵시디언 노트 하나는 실제로 뭐야?': 'What is an Obsidian note, really?',
  '컴퓨터 폴더 안의 파일 하나': 'A file in a folder on your computer',
  '옵시디언 서버에 올라간 글': 'Text uploaded to Obsidian\'s server',
  '맞아. 그래서 사용자 것이고, AI 도 읽을 수 있어.': 'Right. So it\'s yours, and the AI can read it too.',
  '옵시디언엔 서버가 없어. 방금 윈도우 폴더 창에서 파일을 봤잖아. 다시 골라 봐.': 'Obsidian has no server. You just saw the file in a Windows folder window. Try again.',
  '마크다운 기호 세 개': 'Three Markdown symbols',
  '이번 시간엔 노트에 쓰는 마크다운 기호 세 개를 직접 쳐 보고, AI 가 왜 이 형식을 잘 읽는지 알아볼 거야.': 'This time you\'ll type three Markdown symbols into a note yourself, and we\'ll see why AI reads this format so well.',
  '옵시디언 노트는 **마크다운**이라는 방식으로 써.||글 앞뒤에 기호 몇 개를 붙여서 "여긴 제목", "여긴 목록" 하고 표시하는 방식이야. 아까 본 `.md` 가 마크다운 파일이라는 뜻이야.': 'Obsidian notes are written in **Markdown**.||You add a few symbols around your text to mark "this is a heading" or "this is a list." That `.md` you saw earlier means it\'s a Markdown file.',
  '## 마크다운': '## Markdown',
  '기호로 제목 · 목록을 표시하는 글 형식': 'A text format that marks headings · lists with symbols',
  '처음엔 기호 세 개만 알면 돼. 이렇게 생겼어.': 'You only need three symbols to start. Here\'s what they look like.',
  '안녕': 'Hello',
  '할 일': 'To do',
  '다른 노트': 'Another note',
  '연습하라고 "연습장"이라는 노트를 만들어서 가운데에 열어 뒀어. 여기에 쳐 보자.': 'I made a note called "Scratchpad" for practice and opened it in the middle. Let\'s type in there.',
  '1. 첫 번째는 **제목**이야.||줄 맨 앞에 `#` 을 치고 한 칸 띄운 다음 글을 쓰면 제목이 돼. `#` 은 Shift 를 누른 채 숫자 3 을 누르면 나와.||예를 들면 `# 오늘`. 치고 나면 글자가 크게 바뀌는 게 보일 거야. 아무 제목이나 하나 써 봐.': '1. The first one is the **heading**.||Type `#` at the very start of a line, add a space, then your text, and it becomes a heading. For `#`, hold Shift and press 3.||For example, `# Today`. Once you type it, you\'ll see the text get bigger. Write any heading you like.',
  '1. **제목** — `# 제목` (# = Shift+3, 뒤에 한 칸)': '1. **Heading** — `# Heading` (# = Shift+3, then a space)',
  '연습장 노트를 클릭하고 맨 앞에 `# 오늘` 처럼 쳐 봐. # 다음에 한 칸 띄우는 걸 잊지 마.': 'Click the Scratchpad note and type something like `# Today` at the start. Don\'t forget the space after #.',
  '# 오늘\n': '# Today\n',
  '잘했어. 커서를 그 줄에 두면 `#` 이 보이고, 다른 줄로 옮기면 숨어.||기호는 그대로 있고, 옵시디언이 보기 좋게 감춰 줄 뿐이야.': 'Nice. With the cursor on that line you see the `#`, and when you move to another line it hides.||The symbol is still there. Obsidian just tucks it away so it looks clean.',
  '2. 두 번째는 **목록**이야.||Enter 로 새 줄을 만들고, 맨 앞에 `-` (빼기 기호)를 친 다음 한 칸 띄우고 글을 써. 예: `- 할 일`.||A1 에서 본 그 점(•)이 바로 이거야. 한 줄 써 봐.': '2. The second one is the **list**.||Press Enter for a new line, type `-` (a minus sign) at the start, add a space, then your text. Like `- To do`.||That\'s the dot (•) you saw in A1. Write a line.',
  '2. **목록** — `- 내용` (빼기 + 한 칸)': '2. **List** — `- item` (minus + a space)',
  '새 줄 맨 앞에 `- 할 일` 처럼 쳐 봐. 빼기 기호 다음에 한 칸.': 'At the start of a new line, type something like `- To do`. A space after the minus sign.',
  '- 세 줄 적기\n': '- Write three lines\n',
  '3. 세 번째는 **굵게**야.||강조하고 싶은 단어 앞뒤를 별표 두 개로 감싸면 돼. 별표(*)는 Shift 를 누른 채 숫자 8. 예: `**중요**`.||아무 단어나 감싸 봐.': '3. The third one is **bold**.||Wrap a word you want to stress in two asterisks on each side. For the asterisk (*), hold Shift and press 8. Like `**important**`.||Wrap any word.',
  '3. **굵게** — `**단어**` (* = Shift+8)': '3. **Bold** — `**word**` (* = Shift+8)',
  '`**중요**` 처럼 단어 앞뒤에 별표를 두 개씩 붙이면 돼.': 'Put two asterisks before and after a word, like `**important**`.',
  '**중요**\n': '**important**\n',
  '왜 마크다운일까': 'Why Markdown?',
  '워드나 한글 같은 프로그램은 "여긴 제목"이라는 걸 글자 크기나 색으로 표시해. 그런 꾸밈은 파일 안에 복잡한 형태로 저장돼서 AI 가 읽기 어려워.\n\n마크다운은 `#`, `-`, `**` 같은 기호가 **글자 그대로** 파일에 들어 있어. 그래서 AI 가 어디가 제목이고 어디가 목록인지 바로 알아.\n\n기호를 몰라도 괜찮아. 그냥 줄글로 적어도 AI 가 알아서 형식을 맞춰 줘.': 'Programs like Word show "this is a heading" with font size or color. That formatting is saved inside the file in a complicated way, which makes it hard for an AI to read.\n\nIn Markdown, symbols like `#`, `-`, and `**` sit in the file **as plain text**. So the AI can tell right away which part is a heading and which is a list.\n\nDon\'t know the symbols? No problem. Just write plain sentences and the AI will tidy up the format for you.',
  '제목': 'Heading',
  '목록': 'List',
  '굵게': 'Bold',
  '링크': 'Link',
  '## 왜 마크다운?': '## Why Markdown?',
  '기호가 글자로 남음 → AI 가 구조를 바로 읽음': 'Symbols stay as text → the AI reads the structure right away',
  '제목을 만들려면?': 'How do you make a heading?',
  '줄 맨 앞에 # 을 치고 한 칸 띄운다': 'Type # at the start of a line, then a space',
  '글자 크기를 키운다': 'Make the text bigger',
  '맞아. 기호를 글자로 적는 거야.': 'Right. You write the symbol as text.',
  '글자 크기는 파일에 글자로 남지 않아서 AI 가 못 읽어. 다시 골라 봐.': 'Text size isn\'t saved as text in the file, so the AI can\'t read it. Try again.',
  '노트를 링크로 잇기': 'Connecting notes with links',
  '이번 시간엔 노트 두 개를 링크로 이어 보고, 노트들이 어떻게 이어져 있는지 한눈에 보여 주는 그래프 뷰를 열어 볼 거야.': 'This time we\'ll connect two notes with a link, then open Graph view, which shows at a glance how your notes are connected.',
  '노트는 하나하나 따로 있는 파일이지만, 서로 이어 줄 수 있어.||노트 안에 다른 노트 이름을 대괄호 두 겹으로 감싸서 `[[노트 이름]]` 이라고 쓰면, 그 노트로 가는 **링크**가 생겨.||노트와 노트를 잇는 고리라서, 앞으로 링크를 **연결고리**라고도 부를게.': 'Each note is its own separate file, but you can connect them.||Inside a note, wrap another note\'s name in double square brackets, like `[[Note name]]`, and you get a **link** to that note.||A link ties one note to another. That\'s all it is.',
  '고양이': 'Cat',
  '츄르': 'Churu',
  '[[츄르]] 라고 쓰면 연결고리가 생긴다': 'Write [[Churu]] to make a link',
  '## 링크': '## Links',
  '**링크** — `[[노트 이름]]` (= 연결고리)': '**Link** — `[[Note name]]` (ties two notes together)',
  '고양이는 츄르를 좋아한다.\n': 'Cats love churu.\n',
  '고양이가 좋아하는 간식.\n': 'A treat cats love.\n',
  '연습 폴더에 "고양이" 노트와 "츄르" 노트를 만들고, "고양이" 노트를 열어 뒀어.||고양이 노트에 츄르 얘기가 나오지? 그러니까 두 노트를 이어 보자.': 'I made a "Cat" note and a "Churu" note in the practice folder, and opened the "Cat" note.||The Cat note mentions churu, right? So let\'s connect the two notes.',
  '고양이 노트 아래에 새 줄을 만들고 `[[츄르]]` 라고 써 봐.||대괄호 `[` 는 키보드에서 P 오른쪽에 있어. 두 번 누르면 노트 목록이 뜨는데, 거기서 "츄르"를 클릭해도 되고 이름을 끝까지 쳐도 돼.': 'Make a new line at the bottom of the Cat note and type `[[Churu]]`.||The `[` key is just right of P on your keyboard. Press it twice and a list of notes pops up. You can click "Churu" there or type out the whole name.',
  '`[` 두 번 → 노트 목록이 뜸 (`[` = P 오른쪽)': '`[` twice → a list of notes pops up (`[` = right of P)',
  '고양이 노트 아래쪽에 `[[츄르]]`. 이름을 대괄호 두 개로 감싸면 돼.': '`[[Churu]]` at the bottom of the Cat note. Just wrap the name in two square brackets.',
  '관련: [[츄르]]\n': 'Related: [[Churu]]\n',
  '연결됐다! `[[츄르]]` 가 색이 다른 글자로 바뀌었지?||그 글자를 클릭하면 츄르 노트가 열려. 지금은 안 눌러도 돼.': 'Connected! `[[Churu]]` turned a different color, see?||Click that text and the Churu note opens. No need to click it now.',
  '링크 글자 클릭 → 그 노트가 열림': 'Click link text → that note opens',
  '이렇게 이어진 노트들을 그림 한 장으로 보여 주는 화면이 있어. **그래프 뷰**야.||노트 하나가 점 하나, 링크 하나가 선 하나로 그려져.': 'There\'s a screen that shows your connected notes as a single picture. It\'s called **Graph view**.||Each note is drawn as a dot, and each link as a line.',
  '## 그래프 뷰': '## Graph view',
  '점 = 노트, 선 = 링크': 'Dot = note, line = link',
  '그래프 뷰는 맨 왼쪽 세로 아이콘 줄에서 열어. 어떤 아이콘인지 가리켜 줄게.': 'You open Graph view from the ribbon on the far left. I\'ll point out which icon.',
  '**여는 곳** — 맨 왼쪽 아이콘 줄 (동그라미 + 선 아이콘)': '**Where to open it** — the ribbon on the far left (circles + lines icon)',
  '그래프 뷰': 'Graph view',
  '이 아이콘이야. 동그라미 몇 개가 선으로 이어진 모양이지? 마우스를 올리면 "그래프 뷰 열기"라고 떠.||이번엔 내가 눌러 줄게.': 'It\'s this icon. See how a few circles are joined by lines? Hover over it and it says "Open graph view".||This time I\'ll click it for you.',
  '맨 왼쪽 아이콘 줄에서 동그라미들이 선으로 이어진 아이콘을 눌러 봐.': 'In the ribbon on the far left, click the icon with circles joined by lines.',
  '가운데에 그래프 뷰가 새 탭으로 열렸어.||"고양이"랑 "츄르" 점 사이에 선이 보이지? 방금 만든 링크야. 점이 작아서 이름이 안 보이면 마우스 휠을 굴려서 확대해 봐.||다른 점들은 볼트에 있는 다른 노트들이야. 어디에도 이어지지 않은 노트는 점만 혼자 떠 있어.': 'Graph view opened in a new tab in the middle.||See the line between the "Cat" and "Churu" dots? That\'s the link you just made. If the dots are too small to show names, scroll your mouse wheel to zoom in.||The other dots are other notes in your vault. A note that isn\'t connected to anything just floats there on its own.',
  '지금은 네가 직접 이었지만, 위키를 만들면 이 링크를 AI 가 대신 걸어 줘.||노트가 쌓일수록 이 그림에 선이 점점 많아질 거야.||그래프 뷰는 다 봤으면 위쪽 탭의 X 를 눌러 닫으면 돼.': 'You made this link yourself, but once you build the wiki, the AI makes these links for you.||The more notes you add, the more lines this picture will have.||When you\'re done with Graph view, close it with the X on its tab at the top.',
  '노트 두 개를 이으려면?': 'How do you connect two notes?',
  '[[이을 노트 이름]] 을 쓴다': 'Write [[name of the note to link]]',
  '두 노트를 같은 폴더에 넣는다': 'Put both notes in the same folder',
  '맞아. 링크로 잇는 거야.': 'Right. You connect them with a link.',
  '같은 폴더에 있어도 서로 이어지진 않아. 그래프 뷰에 선이 생기는 건 [[ ]] 링크뿐이야. 다시 골라 봐.': 'Being in the same folder doesn\'t connect them. Only [[ ]] links make lines in Graph view. Try again.',
  '같은 폴더 ≠ 연결. 잇는 건 `[[ ]]` 뿐': 'Same folder ≠ connected. Only `[[ ]]` connects',
  '왜 옵시디언에 만들까': 'Why build it in Obsidian?',
  '기초 코스 마지막 시간이야. AI 위키를 왜 하필 옵시디언에 만드는지 정리하고, 다음 코스에서 만들 폴더 구조를 미리 볼 거야.': 'This is the last lesson of the basics course. We\'ll sum up why we build an AI wiki in Obsidian of all places, and preview the folder structure you\'ll make in the next course.',
  '기초는 여기까지야. 지금까지 배운 걸로, AI 위키를 왜 옵시디언에 만드는지 정리해 보자.': 'That\'s it for the basics. Using what we\'ve learned, let\'s sum up why we build an AI wiki in Obsidian.',
  '이유 세 가지': 'Three reasons',
  '1. **노트가 전부 평범한 파일**이라 AI 가 직접 읽고 쓸 수 있어. (A2)\n2. **링크와 그래프 뷰**가 있어서 AI 가 이어 준 연결을 눈으로 확인할 수 있어. (A4)\n3. **파일이 사용자 컴퓨터에 있어서** 어떤 폴더를 AI 에게 보여 줄지 사용자가 정해. 옵시디언이 AI 에 접속하는 게 아니라, 사용자가 허락한 폴더를 **AI 가 읽으러 오는 거야.**': '1. **Every note is an ordinary file**, so the AI can read and write it directly. (A2)\n2. **Links and Graph view** let you see the connections the AI makes with your own eyes. (A4)\n3. **The files live on your computer**, so you decide which folder the AI gets to see. Obsidian doesn\'t connect to the AI. **The AI comes to read** the folder you\'ve allowed.',
  '## 옵시디언에 만드는 이유': '## Why build it in Obsidian',
  '1. 평범한 파일 → AI 가 읽고 씀': '1. Ordinary files → the AI reads and writes them',
  '2. 링크 · 그래프 뷰 → 연결이 눈에 보임': '2. Links · Graph view → connections you can see',
  '3. 사용자 컴퓨터 → AI 에게 보여 줄 폴더는 **사용자**가 정함': '3. Your computer → **you** decide which folder the AI sees',
  '다음 코스(B)에선 연습 폴더 안에 위키 구조를 만들어. 어떻게 생겼는지 먼저 보여 줄게.': 'In the next course (B), you\'ll build a wiki structure inside the practice folder. Let me show you what it looks like first.',
  '연습 폴더 안에 이렇게 세 가지를 만들 거야.||1. raw 폴더: 사용자가 AI 에게 줄 글을 넣는 곳. A1 에서 정한 재료(raw 폴더 속 파일)가 여기 들어가.||2. wiki 폴더: AI 가 재료(raw 폴더 속 파일)를 정리한 노트가 쌓이는 곳.||3. AGENTS.md: AI 에게 어떻게 정리하라고 알려 주는 규칙 파일.||자세한 건 다음 시간에 하나씩 만들면서 볼게.': 'We\'ll make these three things inside the practice folder.||1. raw folder: where you put writing for the AI. The ingredients (files in the raw folder) we defined in A1 go here.||2. wiki folder: where the notes the AI organizes from your ingredients (files in the raw folder) pile up.||3. AGENTS.md: the rules file that tells the AI how to organize.||We\'ll go through each one as we build it next time.',
  '사용자가 재료를 넣는 곳': 'Where you add ingredients',
  'AI 가 정리한 노트': 'Notes the AI organized',
  'AI 에게 주는 규칙': 'Rules for the AI',
  '다음 코스에서 만든다': 'Built in the next course',
  '## 다음 코스 구조': '## Next course structure',
  'raw 폴더 · wiki 폴더 · AGENTS.md': 'raw folder · wiki folder · AGENTS.md',
  '옵시디언과 AI 는 어떻게 연결될까?': 'How do Obsidian and the AI connect?',
  '사용자가 허락한 폴더를 AI 가 읽으러 온다': 'The AI comes to read the folder you allowed',
  '옵시디언이 AI 에 접속한다': 'Obsidian connects to the AI',
  '맞아. 어느 폴더를 보여 줄지는 사용자가 정해.': 'Right. You decide which folder to show.',
  '옵시디언은 폴더를 열어 보여 주는 앱일 뿐이고, AI 와 따로 연결돼 있지 않아. 다시 골라 봐.': 'Obsidian is just an app that opens a folder and shows it. It isn\'t connected to any AI. Try again.',
  // ── 코스 B ──
  '위키를 이루는 세 가지': 'The three parts of a wiki',
  'LLM Wiki 코스 첫 시간이야. 위키를 이루는 세 가지(raw 폴더 · wiki 폴더 · AGENTS.md)가 각각 뭘 하는지 알아보고, 연습 폴더 안에 직접 만들어 볼 거야.': 'This is the first lesson of the LLM Wiki course. You\'ll see what each of the three parts of a wiki (raw folder · wiki folder · AGENTS.md) does, then build them yourself inside the practice folder.',
  '이제 진짜 위키를 만들어 보자.||생각보다 간단해. 폴더 두 개랑 파일 하나면 돼.': 'Now let\'s build a real wiki.||It\'s simpler than you think. Two folders and one file.',
  'raw · wiki · AGENTS.md': 'raw · wiki · AGENTS.md',
  '1. **raw 폴더**: 사용자가 재료(raw 폴더 속 파일)를 넣는 곳. 메모, 저장한 기사, 회의 기록 같은 걸 여기 넣어. raw 는 "가공하기 전"이라는 뜻이야. 그러니까 **AI 는 raw 폴더 속 파일은 절대 건드리지 않아.** 읽기만 해.\n\n2. **wiki 폴더**: wiki 폴더는 **AI 만 수정할 수 있어.** raw 폴더에 사용자가 넣어 둔 재료(raw 폴더 속 파일)에서 여러 인사이트를 뽑아 AI 가 wiki 폴더에 정리하는 거야. 요약, 개념 정리, 목차가 여기 생겨.\n\n3. **AGENTS.md**: AI 에게 주는 규칙 파일. "재료(raw 폴더 속 파일)를 이렇게 정리해 줘"라는 설명서야. AI 는 일을 시작하기 전에 이 파일부터 읽어.\n\nLLM Wiki 는 이 세 가지가 전부야.': '1. **raw folder**: where you put your ingredients (the files in the raw folder). Notes, saved articles, meeting notes: they all go here. "Raw" means "not yet processed." So **the AI never touches the files in the raw folder.** It only reads them.\n\n2. **wiki folder**: **only the AI edits the wiki folder.** The AI pulls insights out of the ingredients you put in raw and organizes them in the wiki folder. Summaries, concept notes and the contents page live here.\n\n3. **AGENTS.md**: the rules file you give the AI. It\'s a manual that says "organize the ingredients like this." The AI reads this file before it starts any work.\n\nThat\'s all an LLM Wiki is: these three things.',
  '사용자가 재료를 넣는 곳': 'Where you put ingredients',
  'AI 만 고치는 노트': 'Notes only the AI edits',
  'AI 에게 주는 규칙': 'Rules for the AI',
  '이 세 가지가 LLM Wiki 의 전부': 'That\'s the whole LLM Wiki',
  '만들어 보자': 'Let\'s build it',
  '## 위키를 이루는 세 가지': '## The three parts of a wiki',
  '1. **raw 폴더** — 사용자가 재료를 넣는 곳. AI 는 읽기만': '1. **raw folder** — where you put ingredients. The AI only reads',
  '2. **wiki 폴더** — AI 만 고치는 노트': '2. **wiki folder** — notes only the AI edits',
  '3. **AGENTS.md** — AI 규칙 파일 (AI 가 먼저 읽음)': '3. **AGENTS.md** — the AI\'s rules file (the AI reads it first)',
  '만들기 전에 궁금한 거 있어?': 'Any questions before we build?',
  'AI 는 왜 raw 폴더를 안 고쳐?': 'Why doesn\'t the AI edit the raw folder?',
  'AI 가 재료(raw 폴더 속 파일)를 고치면, 나중에 wiki 노트의 내용이 원래 어디서 왔는지 확인할 수 없게 돼.\n\nraw 폴더 속 파일은 원본 기록이야. 재료에 틀린 내용이 있어도 AI 는 그대로 두고, "이 글은 틀렸다"는 판단은 wiki 노트 쪽에 기록해.\n\n재료(raw 폴더 속 파일)는 사용자 것이니까, 사용자가 직접 고치거나 지우는 건 괜찮아. 고치지 않는 건 AI 의 규칙이야.': 'If the AI edited the ingredients (the files in the raw folder), you could never check where something in a wiki note originally came from.\n\nThe files in the raw folder are the original record. Even if an ingredient has something wrong in it, the AI leaves it as is and writes "this is wrong" in the wiki notes instead.\n\nThe ingredients are yours, so it\'s fine for you to edit or delete them yourself. Not editing them is a rule for the AI.',
  'AGENTS.md 는 꼭 이 이름이어야 해?': 'Does it have to be called AGENTS.md?',
  '꼭 그렇진 않아. 요즘 AI 도구들이 폴더에서 이 이름의 파일을 먼저 찾아 읽는 경우가 많아서 이 이름을 쓰는 거야. 클로드 코드는 CLAUDE.md 라는 이름을 찾기도 해.\n\n이름보다 중요한 건 AI 에게 일을 시킬 때 "이 파일부터 읽어"라고 말해 주는 거야. 수업 끝나고 혼자 할 때도 매번 그렇게 하게 될 거야.': 'Not really. A lot of AI tools these days look for a file with this name in a folder and read it first, so that\'s why we use it. Claude Code also looks for one called CLAUDE.md.\n\nWhat matters more than the name is telling the AI "read this file first" when you give it a job. You\'ll do that every time when you\'re on your own after the course, too.',
  '원래 있던 노트는 괜찮아?': 'Are my existing notes safe?',
  '응, 안 건드려. 이번에 만드는 건 전부 연습 폴더 안에 생겨.\n\n나중에 실제로 쓸 땐 이 연습 폴더를 그대로 키워도 되고, 다른 폴더에 같은 구조를 새로 만들어도 돼.': 'Yep, I won\'t touch them. Everything we make this time goes inside the practice folder.\n\nWhen you use it for real later, you can keep growing this practice folder, or set up the same structure in another folder.',
  '이제 만들게. 세 가지에 더해서 몇 개를 같이 만들 거야.||raw 폴더 안엔 **README.md**, wiki 폴더 안엔 **index.md** 와 **log.md** 를 넣을 거야.||**README.md** 는 "이 폴더가 뭐 하는 곳인지" 알려 주는 안내 파일이야. raw 폴더를 열면 AI 가 가장 처음 읽게 되는 파일이라서, 관례대로 README(읽어 주세요)라는 이름을 붙여.||index.md 와 log.md 는 조금 뒤에 설명할게.': 'Let me build it. Along with the three parts, I\'ll make a few more files.||Inside the raw folder goes **README.md**, and inside the wiki folder go **index.md** and **log.md**.||**README.md** is a guide that explains "what this folder is for." It\'s the first file the AI reads when it opens the raw folder, so by convention it\'s called README ("read me").||I\'ll explain index.md and log.md in a bit.',
  '## 같이 만드는 파일': '## Files we make too',
  '**README.md** — raw 폴더 안내. AI 가 가장 처음 읽음': '**README.md** — guide to the raw folder. The AI reads it first',
  '만들기 전에 뭘 만들지 보여 주는 창이 뜰 거야.||"raw > README.md" 는 raw 폴더 안에 README.md 파일이 생긴다는 뜻이야. 목록을 확인하고 괜찮으면 "만들기" 버튼을 눌러 줘.': 'A window will pop up showing what I\'m about to make.||"raw > README.md" means a README.md file will be created inside the raw folder. Check the list, and if it looks good, click the "Create" button.',
  '창에서 "만들기"를 눌러야 폴더가 생겨.': 'The folders appear once you click "Create" in the window.',
  'raw 폴더': 'raw folder',
  '여기가 **raw 폴더**야. 사용자가 AI 에게 줄 글은 전부 여기에 넣어. 이 파일들이 재료(raw 폴더 속 파일)야.||지금은 안내 파일 README.md 하나만 들어 있어.': 'This is the **raw folder**. Anything you want to give the AI goes in here. These files are your ingredients.||Right now there\'s just one guide file in it, README.md.',
  'wiki 폴더': 'wiki folder',
  '여기가 **wiki 폴더**. AI 가 정리한 노트가 여기 쌓이고, AI 만 고쳐.||폴더 이름 왼쪽 화살표를 눌러 펼쳐 보면 지금은 index.md 랑 log.md 두 개만 있을 거야.': 'This is the **wiki folder**. The notes the AI organizes pile up here, and only the AI edits them.||Click the arrow left of the folder name to expand it. For now there are just two files: index.md and log.md.',
  '**index.md** 는 wiki 에 어떤 노트가 있는지 한 줄씩 기록해 둔 **목차**야.||**log.md** 는 AI 가 언제 무슨 작업을 했는지 한 줄씩 남기는 **작업 기록**이야. 둘 다 AI 가 알아서 고쳐.': '**index.md** is the **contents**: one line for each note in the wiki.||**log.md** is the **work log**: one line each time the AI does something, and when. The AI keeps both up to date on its own.',
  '**index.md** — 목차': '**index.md** — contents',
  '**log.md** — 작업 기록 (둘 다 AI 가 갱신)': '**log.md** — work log (the AI updates both)',
  'AGENTS.md': 'AGENTS.md',
  '그리고 이게 **AGENTS.md**, 규칙 파일이야.||파일 탐색기에서 AGENTS.md 를 클릭해서 열어 봐. AI 가 할 일이 다 기록돼 있어.': 'And this is **AGENTS.md**, the rules file.||Click AGENTS.md in the File explorer to open it. Everything the AI has to do is written there.',
  '왼쪽 파일 탐색기의 연습 폴더 안에서 AGENTS.md 를 클릭해 봐.': 'Click AGENTS.md inside the practice folder in the File explorer on the left.',
  '천천히 읽어 봐. 어려운 말은 없을 거야.||ingest, query, lint 같은 영어 단어가 나오는데, 다음 레슨부터 하나씩 직접 해 볼 거라 지금은 몰라도 돼.||나중에 AI 가 일하는 방식을 바꾸고 싶으면 이 파일만 고치면 돼. 그것도 뒤에서 해 볼 거야.': 'Take your time reading it. Nothing hard in there.||You\'ll see English words like ingest, query and lint. We\'ll try each one hands-on starting next lesson, so don\'t worry about them yet.||Later, if you want to change how the AI works, you only need to edit this file. We\'ll try that later too.',
  'AI 일하는 방식 바꾸기 → AGENTS.md 만 고치기': 'Change how the AI works → edit only AGENTS.md',
  'wiki 폴더의 노트는 누가 쓸까?': 'Who writes the notes in the wiki folder?',
  'AI 가 쓰고 사용자는 읽는다': 'The AI writes, you read',
  '사용자가 직접 쓴다': 'You write them yourself',
  '맞아. 사용자는 재료(raw 폴더 속 파일)를 넣고, 정리는 AI 가 해.': 'Right. You add the ingredients, and the AI does the organizing.',
  'wiki 폴더는 AI 만 고치는 곳이야. 사람이 정리까지 하면 금방 지쳐. 다시 골라 봐.': 'Only the AI edits the wiki folder. If you have to do the organizing too, you\'ll burn out fast. Try again.',
  '첫 재료 넣기': 'Add your first ingredient',
  '이번 시간엔 raw 폴더에 첫 재료(raw 폴더 속 파일)를 넣어 볼 거야. AI 가 raw 폴더를 어떻게 다루는지도 알아볼게.': 'This time you\'ll put your first ingredient (a file in the raw folder) into the raw folder. We\'ll also see how the AI treats the raw folder.',
  'raw 폴더엔 아직 안내 파일 README.md 뿐이니까 재료(raw 폴더 속 파일)부터 넣자.||연습용으로 내가 글 하나를 준비해 왔어. "개인 위키가 뭔가"에 대한 짧은 글이야.': 'The raw folder only has the guide file README.md so far, so let\'s add an ingredient first.||I brought a piece of writing for practice. It\'s a short piece on "What a personal wiki is."',
  'AI 가 raw 폴더를 다루는 규칙이 하나 있어. **AI 는 raw 폴더 속 파일을 읽기만 하고 절대 고치지 않아.**||그래서 파일 이름이 중요해. AI 가 이름을 바꿔 주지 않으니까, 처음 넣을 때 "문서1" 같은 이름 말고 내용을 알 수 있는 이름으로 넣어 줘.': 'There\'s one rule for how the AI treats the raw folder: **the AI only reads the files in raw and never edits them.**||That\'s why file names matter. The AI won\'t rename anything for you, so when you add a file, give it a name that tells you what\'s inside, not something like "Document1."',
  '## AI 의 raw 규칙': '## The AI\'s raw rule',
  'AI 는 raw 폴더 속 파일을 **읽기만, 절대 안 고침**': 'The AI **only reads, never edits** files in raw',
  '파일 이름은 내용을 알 수 있게': 'Name files so you can tell what\'s inside',
  '이번에도 넣기 전에 확인 창이 뜰 거야. "만들기"를 눌러 줘.': 'A confirmation window will pop up before I add it, same as before. Click "Create."',
  '확인 창에서 "만들기"를 누르면 재료(raw 폴더 속 파일)가 들어가.': 'Click "Create" in the confirmation window to add the ingredient.',
  '재료 1': 'Ingredient 1',
  '들어갔다. raw 폴더를 펼쳐 보면 "01-개인 위키가 뭔가"가 있을 거야. 클릭해서 읽어 봐도 돼.||혼자 할 땐 메모 파일을 파일 탐색기에서 raw 폴더 위로 끌어다 놓거나, raw 폴더를 오른쪽 클릭해서 새 노트를 만들어 쓰면 돼.||웹에서 본 기사는 **Web Clipper** 라는 옵시디언 공식 브라우저 확장 프로그램으로 바로 저장할 수도 있어. 그건 필요할 때 찾아봐.': 'It\'s in. Expand the raw folder and you\'ll see "01-What a personal wiki is." Feel free to click it and read.||On your own, you can drag a memo file onto the raw folder in the File explorer, or right-click the raw folder and make a new note.||You can also save web articles straight in with **Web Clipper**, Obsidian\'s official browser extension. Look it up when you need it.',
  '## 재료 넣는 법': '## How to add ingredients',
  '끌어다 놓기 · 우클릭 → 새 노트 · Web Clipper': 'Drag and drop · Right-click → New note · Web Clipper',
  'AI 는 raw 폴더 속 파일을 어떻게 다룰까?': 'How does the AI treat the files in raw?',
  '읽기만 하고 절대 고치지 않는다': 'It only reads them, never edits',
  '읽고 나서 알아서 고쳐 둔다': 'It reads them, then fixes them up',
  '맞아. 재료(raw 폴더 속 파일)는 원본 그대로 두고, 정리한 내용은 wiki 폴더에 기록해.': 'Right. The ingredients stay as the originals, and what it organizes goes into the wiki folder.',
  'AI 가 재료(raw 폴더 속 파일)를 고치면 나중에 wiki 내용이 어디서 왔는지 확인할 수 없어. 다시 골라 봐.': 'If the AI edited the ingredients, you couldn\'t check later where the wiki\'s content came from. Try again.',
  '첫 요리 — ingest': 'First cooking — ingest',
  '이번 시간엔 AI 가 재료(raw 폴더 속 파일)를 읽고 wiki 에 노트를 쓰는 작업, ingest 를 처음으로 볼 거야. 재료 한 편에서 노트가 몇 개 생기는지 직접 확인해 봐.': 'This time you\'ll see ingest for the first time: the AI reading ingredients (files in the raw folder) and writing notes in the wiki. See for yourself how many notes come out of one ingredient.',
  'AI 가 raw 폴더 속 파일, 곧 재료를 읽고 wiki 폴더에 노트를 쓰는 작업을 **ingest** 라고 해. 원래 "받아들여서 소화한다"는 뜻이야.||재료(raw 폴더 속 파일)를 받아서 먹기 좋게 만드는 일이니까, 앞으로 이 작업을 **요리(ingest)**라고도 부를게. "요리한다"고 하면 ingest 한다는 뜻이야.': 'When the AI reads the files in the raw folder, the ingredients, and writes notes in the wiki folder, that\'s called **ingest**. It originally means "take in and digest."||It takes ingredients and makes them easy to consume, so from now on I\'ll also call it **cooking (ingest)**. When I say "cook," I mean ingest.',
  '## 요리(ingest)': '## Cooking (ingest)',
  'AI 가 재료를 읽고 wiki 에 노트 쓰기': 'The AI reads ingredients and writes notes in the wiki',
  '재료(raw 폴더 속 파일) 한 편을 요리(ingest)하면 wiki 에 이런 게 생기거나 바뀌어.||1. 그 글을 요약한 노트 1개. wiki 안 **요약 폴더(sources)**에 들어가.||2. 글에 나온 중요한 개념마다 노트 1개씩. wiki 안 **개념 폴더(concepts)**에 들어가.||3. 목차(index.md)에 새 노트 이름이 추가되고, 작업 기록(log.md)에 한 줄이 붙어.': 'When you cook (ingest) one ingredient, here\'s what gets created or changed in the wiki.||1. One note summarizing that piece. It goes into the **summaries folder (sources)** in the wiki.||2. One note for each important concept in the piece. These go into the **concepts folder (concepts)** in the wiki.||3. The new note names are added to the contents (index.md), and a line is added to the work log (log.md).',
  '재료 1편': '1 ingredient',
  '요약 1': '1 summary',
  '개념 3': '3 concepts',
  '목차': 'Contents',
  '작업 기록': 'Work log',
  '재료 하나로 노트 여러 개가 바뀐다': 'One ingredient changes many notes',
  '## 요리하면 생기는 것': '## What cooking creates',
  '1. **요약 폴더(sources)** — 재료 하나에 요약 1개': '1. **summaries folder (sources)** — 1 summary per ingredient',
  '2. **개념 폴더(concepts)** — 개념마다 노트 1개': '2. **concepts folder (concepts)** — 1 note per concept',
  '3. index.md · log.md 갱신': '3. index.md · log.md updated',
  '이번엔 실제 AI 대신 내가 AI 가 ingest 명령어를 수행하는 과정을 재현해 볼게. 실제 AI 로 하는 건 마지막 레슨(B8)에서 해.||확인 창이 뜨면 "만들기"를 눌러 줘.': 'This time, instead of a real AI, I\'ll replay what an AI does when it runs ingest. You\'ll do it with a real AI in the last lesson (B8).||When the confirmation window pops up, click "Create."',
  '확인 창에서 "만들기"를 눌러야 요리(ingest)가 시작돼.': 'Cooking (ingest) starts once you click "Create" in the confirmation window.',
  '요약 폴더(sources)': 'Summaries folder (sources)',
  'wiki 폴더 안에 요약 폴더(sources)가 생겼지? 여기엔 재료(raw 폴더 속 파일)를 요약한 노트가 들어 있어. 재료 하나에 요약 하나야.': 'See the summaries folder (sources) that appeared in the wiki folder? It holds notes that summarize the ingredients. One summary per ingredient.',
  '개념 폴더(concepts)': 'Concepts folder (concepts)',
  '그 아래 개념 폴더(concepts)엔 개념 노트가 3개 생겼어. "개인 위키", "꺼내 쓰기", "매일 기록".||raw 폴더에 있는 글 재료들에서 중요한 개념들을 유목화해 정리해 둔 거야.': 'Below it, the concepts folder (concepts) now has 3 concept notes: "Personal wiki," "Getting it back" and "Daily log."||These are the important concepts from the ingredients in the raw folder, sorted out and organized.',
  '목차(index.md)랑 작업 기록(log.md)도 바뀌었어. 궁금하면 열어 봐.||이렇게 재료(raw 폴더 속 파일) 하나를 요리(ingest)하면 wiki 노트 여러 개가 한꺼번에 바뀌어. 사람이 하면 귀찮아서 안 하게 되는 일(기록 유목화, 태그 붙이기, 인사이트 추출 등)을 AI 가 훨씬 정교하게 대신 하는 거야.': 'The contents (index.md) and work log (log.md) changed too. Open them if you\'re curious.||Cook (ingest) one ingredient, and several wiki notes change at once. The chores people skip because they\'re tedious (sorting notes into topics, tagging, pulling out insights and so on), the AI does for you, and much more carefully.',
  '재료 하나 → wiki 노트 여러 개가 한꺼번에 바뀜': 'One ingredient → many wiki notes change at once',
  '요리(ingest) 보고 궁금한 거 있어?': 'Any questions after watching the cooking (ingest)?',
  '방금 건 진짜 AI 가 한 거야?': 'Was that a real AI just now?',
  '아니. AI 가 하는 과정을 내가 재현해서 보여 준 거야. 그래서 빠르고 돈도 안 들어.\n\n마지막 레슨(B8)에선 네가 쓰는 실제 AI 로 네 재료(raw 폴더 속 파일)를 요리(ingest)해 볼 거야. 그 전까지는 결과가 어떻게 생기는지 익히는 거야.': 'Nope. I replayed what an AI would do to show you. That\'s why it was quick and free.\n\nIn the last lesson (B8), you\'ll cook (ingest) your own ingredient with the real AI you use. Until then, you\'re learning what the results look like.',
  '요약 폴더(sources)랑 개념 폴더(concepts)는 뭐가 달라?': 'What\'s the difference between the summaries folder (sources) and the concepts folder (concepts)?',
  '**요약 폴더(sources)** 엔 재료(raw 폴더 속 파일) 하나를 요약한 노트가 들어가. 재료 하나에 요약 하나.\n\n**개념 폴더(concepts)** 엔 개념 하나를 정리한 노트가 들어가. 여러 재료(raw 폴더 속 파일)에서 같은 개념이 나오면 같은 개념 노트에 내용이 계속 더해져. 그래서 재료가 쌓일수록 개념 노트가 점점 풍부해져.': 'The **summaries folder (sources)** holds notes that each summarize one ingredient. One summary per ingredient.\n\nThe **concepts folder (concepts)** holds notes that each explain one concept. When the same concept shows up in several ingredients, more keeps getting added to that one concept note. So the more ingredients pile up, the richer your concept notes get.',
  '직접 쓴 메모도 재료(raw 폴더 속 파일)가 돼?': 'Can my own notes be ingredients too?',
  '그럼. 오히려 제일 좋은 재료(raw 폴더 속 파일)야. 남이 쓴 글보다 "그때 무슨 생각을 했지"가 나중에 훨씬 쓸모 있어.\n\n옵시디언 사용법 기초 과정(A1)에서 만든 "오늘 알게 된 것" 노트도 raw 폴더에 넣으면 재료(raw 폴더 속 파일)가 돼. 마지막 레슨에서 그걸 요리(ingest)할 수도 있어.': 'Of course. They\'re actually the best ingredients. Down the line, "what was I thinking back then?" is way more useful than something someone else wrote.\n\nThe "What I learned today" note you made in the Obsidian Basics course (A1) becomes an ingredient too if you put it in the raw folder. You could cook (ingest) it in the last lesson.',
  'AI 가 쓴 노트 읽기': 'Reading a note the AI wrote',
  '이번 시간엔 AI 가 쓴 노트를 하나 열어서 어떻게 생겼는지 보고, wiki 노트는 왜 사용자가 직접 고치지 않는지 알아볼 거야.': 'This time we\'ll open a note the AI wrote to see what it looks like, and find out why you don\'t edit wiki notes yourself.',
  'AI 가 쓴 노트를 하나 열어 보자.||wiki 폴더 안 개념 폴더(concepts)에서 "개인 위키" 노트를 클릭해 봐.': 'Let\'s open a note the AI wrote.||In the wiki folder, click the "Personal wiki" note in the concepts folder (concepts).',
  '개념 폴더(concepts) 안에': 'In the concepts folder (concepts)',
  'wiki 폴더와 그 안의 개념 폴더(concepts)를 펼치고 "개인 위키"를 클릭해 봐.': 'Expand the wiki folder and the concepts folder (concepts) inside it, then click "Personal wiki."',
  '네가 쓴 노트는 아니지만, 네 raw 폴더의 재료로 AI 가 만든 노트야. 위에서부터 같이 보자.||**한 줄** 칸엔 이 개념을 한 문장으로 요약해 뒀어.||**재료** 칸엔 이 내용이 raw 폴더의 어느 파일에서 왔는지 기록돼 있어. 원본을 확인하고 싶을 때 보면 돼.||**내용** 칸 중간에 색이 다른 글자들은 다른 wiki 노트로 가는 링크(연결고리)야. 노트끼리 잇는 연결고리를 AI 가 걸어 둔 거야.': 'You didn\'t write this note, but the AI made it from the ingredients in your raw folder. Let\'s go through it from the top.||The **In one line** section sums up the concept in one sentence.||The **Ingredients** section records which file in the raw folder this came from. Check it when you want to see the original.||The differently colored words in the **Content** section are links to other wiki notes. The AI added those links to connect the notes.',
  '## AI 노트 구조': '## How an AI note is built',
  '**한 줄** — 한 문장 요약': '**In one line** — a one-sentence summary',
  '**재료** — 어느 raw 파일에서 왔는지': '**Ingredients** — which raw file it came from',
  '**내용** — 정리 + 링크(연결고리)': '**Content** — the write-up + links',
  'wiki 는 읽고, raw 에 쓴다': 'Read the wiki, write to raw',
  'wiki 노트를 사용자가 직접 고치면, 다음에 AI 가 요리(ingest)할 때 같은 노트를 다시 쓰면서 사용자가 고친 부분이 사라질 수 있어. 그래서 wiki 폴더는 AI 만 고쳐.\n\n고칠 게 보이면 파일을 직접 고치지 말고 **AI 에게 말해.** 예를 들어 "개인 위키 노트에서 ○○ 부분 고쳐 줘" 하고.\n\n사용자의 생각을 덧붙이고 싶으면 raw 폴더에 새 재료(raw 폴더 속 파일)로 기록해 넣으면 돼. 그러면 다음에 요리(ingest)할 때 AI 가 반영해.': 'If you edit a wiki note yourself, the next time the AI cooks (ingests), it may rewrite that note and your changes can disappear. That\'s why only the AI edits the wiki folder.\n\nIf you spot something to fix, don\'t edit the file yourself. **Tell the AI.** For example: "Fix the ○○ part in the Personal wiki note."\n\nIf you want to add your own thoughts, write them down as a new ingredient in the raw folder. The AI will work them in the next time it cooks (ingests).',
  '알았어': 'Got it',
  '## 고칠 게 보이면': '## If you spot something to fix',
  'wiki 직접 수정 ✕ → **AI 에게 고쳐 달라고**': 'Edit the wiki yourself ✕ → **ask the AI to fix it**',
  '사용자 생각은 raw 폴더에 새 재료로': 'Your own thoughts → a new ingredient in raw',
  'wiki 노트에서 틀린 내용을 발견하면?': 'What if you find something wrong in a wiki note?',
  'AI 에게 고쳐 달라고 한다': 'Ask the AI to fix it',
  '사용자가 바로 고친다': 'Fix it yourself right away',
  '맞아. 그래야 다음에 요리(ingest)할 때도 고친 내용이 남아.': 'Right. That way the fix sticks the next time it cooks (ingests), too.',
  '직접 고치면 다음 요리(ingest) 때 AI 가 덮어쓸 수 있어. 다시 골라 봐.': 'If you fix it yourself, the AI may overwrite it on the next cooking (ingest). Try again.',
  '재료가 늘면 연결고리도 는다': 'More ingredients, more links',
  '이번 시간엔 그래프 뷰로 지금 위키를 보고, 재료(raw 폴더 속 파일)를 하나 더 요리(ingest)한 다음 연결고리가 어떻게 늘어나는지 비교해 볼 거야. 목차(index.md)가 왜 중요한지도 알아볼게.': 'This time we\'ll look at the wiki in Graph view, cook (ingest) one more ingredient, and compare how the links grow. We\'ll also see why the contents (index.md) matter.',
  '먼저 지금 위키가 어떻게 이어져 있는지 그래프 뷰로 보자.||그래프 뷰에선 점 하나가 노트 하나, 선 하나가 링크(연결고리) 하나야.||그래프 뷰는 맨 왼쪽 아이콘 줄에 있는 이 아이콘으로 열어.': 'First, let\'s see how the wiki is connected right now in Graph view.||In Graph view, each dot is a note and each line is a link.||You open Graph view with this icon in the ribbon (the icon strip on the far left).',
  '## 그래프 뷰로 보기': '## Seeing it in Graph view',
  '점 = 노트, 선 = 링크(연결고리)': 'Dot = note, line = link',
  '그래프 뷰': 'Graph view',
  '여기. 동그라미 몇 개가 선으로 이어진 아이콘이야. 이번엔 내가 눌러 줄게.': 'Here. It\'s the icon with a few circles joined by lines. I\'ll click it for you this time.',
  '맨 왼쪽 아이콘 줄에서 동그라미들이 선으로 이어진 아이콘을 눌러 봐.': 'In the ribbon on the far left, click the icon with circles joined by lines.',
  '점이 몇 개 있고 선도 몇 개 있지? 아직은 단출해.||그래프 뷰는 볼트 전체를 보여 줘서, raw · wiki 말고 다른 노트도 같이 보여. 옵시디언 사용법 기초 과정(A4)에서 만든 고양이, 츄르 노트가 선으로 이어져 있는 것도 보일 거야.||이제 재료(raw 폴더 속 파일)를 하나 더 넣고 요리(ingest)한 다음, 어떻게 바뀌는지 보자.': 'A few dots and a few lines, right? Still pretty sparse.||Graph view shows your whole vault, so notes outside raw and wiki show up too. You may also spot the Cat and Churu notes from the Obsidian Basics course (A4), joined by a line.||Now let\'s add one more ingredient, cook (ingest) it, and see what changes.',
  '이번 재료(raw 폴더 속 파일)는 "왜 다들 실패하나"라는 글이야.||확인 창이 두 번 뜰 거야. 한 번은 재료(raw 폴더 속 파일) 넣기, 한 번은 요리(ingest). 둘 다 "만들기"를 눌러 줘.': 'This ingredient is a piece called "Why everyone fails."||The confirmation window will pop up twice: once to add the ingredient, once to cook (ingest). Click "Create" both times.',
  '확인 창에서 "만들기"를 눌러 줘.': 'Click "Create" in the confirmation window.',
  '점도 선도 늘었지?||새 재료(raw 폴더 속 파일)에서 개념 노트가 2개 더 생겼고, 원래 있던 "개인 위키" 노트에도 새 내용과 링크가 더해졌어. 새 재료가 옛 노트까지 고쳐 준 거야.||재료(raw 폴더 속 파일)가 쌓일수록 노트끼리 더 촘촘하게 이어지고, 그래서 나중에 물어봤을 때 답도 좋아져.': 'More dots and more lines, right?||The new ingredient produced 2 more concept notes, and the existing "Personal wiki" note got new content and links too. A new ingredient even improved an old note.||The more ingredients pile up, the more tightly your notes connect, and the better the answers when you ask later.',
  '재료 넣기': 'Add ingredient',
  '요리(ingest)': 'Cooking (ingest)',
  '연결고리가 늘어남': 'More links',
  '다음 답이 좋아짐': 'Better next answer',
  '## 재료가 쌓이면': '## As ingredients pile up',
  '새 재료가 옛 노트도 고침': 'New ingredients improve old notes too',
  '재료 ↑ → 연결고리 ↑ → 답 품질 ↑': 'Ingredients ↑ → links ↑ → answer quality ↑',
  '채팅에 파일 올리기와 뭐가 달라?': 'How is this different from uploading a file to a chat?',
  'AI 채팅에 파일을 올려서 물어보면, AI 는 질문할 때마다 원래 글을 처음부터 다시 읽고 답을 만들어. 대화가 끝나면 AI 가 정리한 건 아무 데도 남지 않아.\n\nLLM Wiki 에선 AI 가 정리한 결과를 wiki 폴더에 노트로 남겨 둬. 새 재료(raw 폴더 속 파일)가 들어오면 그 노트에 더하고 고쳐. 방금 본 것처럼 재료가 쌓일수록 위키가 점점 좋아지는 거야.\n\n카파시가 이 방법을 제안한 핵심 이유가 이거야. **정리한 결과가 쌓인다.**': 'When you upload a file to an AI chat and ask about it, the AI rereads the original from scratch every time you ask, then builds an answer. When the chat ends, nothing the AI organized is kept anywhere.\n\nIn an LLM Wiki, the AI keeps what it organized as notes in the wiki folder. When a new ingredient comes in, it adds to and fixes those notes. Like you just saw, the more ingredients pile up, the better the wiki gets.\n\nThat\'s the core reason Karpathy proposed this approach: **the organized results accumulate.**',
  '채팅에 파일 올리기 ✕ 남는 것 없음 → 위키는 정리 결과가 **쌓인다**': 'Uploading to a chat ✕ nothing kept → in a wiki, the organized results **accumulate**',
  '목차 (index.md)': 'Contents (index.md)',
  'wiki 에 어떤 노트가 있는지 한 줄씩 기록해 둔 목록이야. AI 가 요리(ingest)할 때마다 새 노트를 여기에 추가해.\n\n나중에 AI 에게 뭘 물어보면, AI 는 **이 목차부터 읽고** 관련 있는 노트만 골라서 열어 봐. 그래서 노트가 수백 개가 돼도 전부 읽지 않고 답을 찾을 수 있어.\n\nwiki 폴더의 index.md 를 열어 보면 지금까지 생긴 노트가 정리돼 있을 거야.': 'It\'s a list with one line for each note in the wiki. Every time the AI cooks (ingests), it adds the new notes here.\n\nLater, when you ask the AI something, it **reads the contents first** and opens only the relevant notes. So even with hundreds of notes, it can find the answer without reading them all.\n\nOpen index.md in the wiki folder and you\'ll see every note made so far, all listed.',
  '## 목차(index.md)': '## Contents (index.md)',
  'AI 가 질문을 받으면 **제일 먼저 읽음**': 'When the AI gets a question, it **reads this first**',
  '물어보기 — query': 'Asking — query',
  '이번 시간엔 위키에 쌓인 내용을 꺼내 쓰는 법을 배워. 질문을 골라서 출처가 달린 답을 받아 보고, 좋은 답은 위키에 저장해 볼 거야.': 'This time you\'ll learn how to get back what\'s piled up in your wiki. You\'ll pick a question, get an answer with sources, and save a good answer to the wiki.',
  '위키에서 뭔가를 꺼내 쓰는 걸 **query** 라고 해. 우리말로는 그냥 **물어보기**야.||특별한 명령어는 없어. AI 채팅창에 평소처럼 말로 물어보면 돼.': 'Getting something back out of the wiki is called **query**. In plain words, it\'s just **asking**.||No special command needed. Just ask in the AI chat the way you normally would.',
  '## 물어보기(query)': '## Asking (query)',
  'AI 채팅창에 말로 질문': 'Ask in plain words in the AI chat',
  '물어보면 AI 는 이 순서로 답해.||1. 먼저 목차(index.md)를 보고,||2. 질문과 관련된 노트를 열어 읽은 다음,||3. 답 끝에 **어느 노트를 보고 답했는지(출처)**를 달아.||출처가 있으니까, 답이 맞는지 원래 노트를 열어서 확인할 수 있어.': 'When you ask, the AI answers in this order.||1. First it looks at the contents (index.md),||2. then opens and reads the notes related to your question,||3. and at the end of its answer, lists **which notes it used (sources)**.||Since there are sources, you can open the original notes and check whether the answer is right.',
  '1. 목차(index.md) 보기': '1. Check the contents (index.md)',
  '2. 관련 노트 읽기': '2. Read related notes',
  '3. **출처** 달아 답하기': '3. Answer with **sources**',
  '지금은 연습이라 질문 세 개에 대한 답을 raw 폴더의 재료를 바탕으로 미리 기록해 뒀어. 하나씩 눌러 보고, 다 봤으면 "넘어가기" 버튼을 눌러 줘.||마음에 드는 답이 있으면 "위키에 저장"도 눌러 봐.': 'Since this is practice, I\'ve written down answers to three questions ahead of time, based on the ingredients in the raw folder. Click each one, and when you\'re done, click the "Move on" button.||If you like an answer, try clicking "Save to wiki" too.',
  '저장한 답은 wiki 폴더 안 답변 폴더(answers)에 들어가.||좋은 답을 이렇게 위키에 다시 넣어 두면, 다음에 물어볼 때 AI 가 그 답까지 같이 읽어. 쓸수록 위키가 좋아지는 이유야.||실제로 할 땐 AI 한테 "이 답 위키에 저장해 줘"라고 말하면 돼.': 'Saved answers go into the answers folder (answers) inside the wiki folder.||When you put good answers back into the wiki like this, the AI reads them too the next time you ask. That\'s why the wiki gets better the more you use it.||For real, just tell the AI "Save this answer to the wiki."',
  '좋은 답 → **답변 폴더(answers)** 에 저장 → 다음 답이 좋아짐': 'Good answer → save to **answers folder (answers)** → better next answer',
  '잘 물어보는 요령': 'Tips for asking well',
  '1. **어디를 보라고 말해 줘.** 예: "raw 폴더에 있는 지난주 기록을 읽고"\n2. **답의 모양을 정해 줘.** 예: "표로 정리해 줘", "체크리스트로 만들어 줘"\n3. **"기록에 없으면 없다고 말해 줘"를 붙여.** 이 한 줄이 있으면 AI 가 없는 내용을 지어내는 걸 막을 수 있어.': '1. **Tell it where to look.** E.g., "Read last week\'s notes in the raw folder and..."\n2. **Decide the shape of the answer.** E.g., "Put it in a table," "Make it a checklist."\n3. **Add "If it\'s not in my notes, say so."** That one line keeps the AI from making things up.',
  '## 잘 물어보는 요령': '## Tips for asking well',
  '1) 어디를 볼지 말하기': '1) Say where to look',
  '2) 답 모양 정하기': '2) Decide the answer\'s shape',
  '3) "기록에 없으면 없다고"': '3) "If it\'s not in my notes, say so"',
  '위키 청소 — lint': 'Wiki cleanup — lint',
  '이번 시간엔 재료(raw 폴더 속 파일)를 하나 더 요리(ingest)한 다음, 노트가 쌓이면 생기는 문제를 AI 가 찾아서 고치는 작업(lint)을 볼 거야.': 'This time we\'ll cook (ingest) one more ingredient, then watch the AI find and fix the problems that show up as notes pile up (lint).',
  '재료(raw 폴더 속 파일)를 하나 더 넣고 요리(ingest)해 보자. 이번 건 "AI 한테 시키는 법"에 대한 글이야.||이번에도 확인 창이 두 번 뜰 거야. 재료(raw 폴더 속 파일) 넣기 한 번, 요리(ingest) 한 번. 둘 다 "만들기"를 눌러 줘.': 'Let\'s add one more ingredient and cook (ingest) it. This one is a piece on "How to make the AI do it."||The confirmation window will pop up twice again: once to add the ingredient, once to cook (ingest). Click "Create" both times.',
  '재료(raw 폴더 속 파일)가 쌓이면 꼭 생기는 문제가 세 가지 있어.||1. 글마다 말이 달라. 한 글은 "하루 세 줄", 다른 글은 "하루 한 줄" 하는 식으로. 새 재료(raw 폴더 속 파일)와 안 맞게 낡아 버린 내용도 생겨.||2. 다른 노트 어디에서도 링크되지 않은 노트가 생겨. 이런 노트를 **고아 노트**라고 해.||3. 여러 노트에서 말은 나오는데, 정작 그 개념을 설명하는 노트는 없어.': 'As ingredients pile up, three problems always show up.||1. Pieces say different things. One says "three lines a day," another says "one line a day." Some content also goes stale and no longer fits newer ingredients.||2. Some notes aren\'t linked from any other note. These are called **orphan notes**.||3. A term comes up in several notes, but there\'s no note that actually explains that concept.',
  '## 쌓이면 생기는 문제': '## Problems as notes pile up',
  '1. 어긋난 말 · 낡은 내용': '1. Mismatched wording · stale content',
  '2. **고아 노트** — 아무도 링크 안 함': '2. **Orphan notes** — nothing links to them',
  '3. 빠진 개념 노트': '3. Missing concept notes',
  '이런 걸 찾아서 고치는 작업을 **lint** 라고 해. 원래는 프로그램 코드에서 실수를 찾아 주는 도구 이름이야.||앞으로 이 작업을 **위키 청소(lint)**라고 부를게.||이걸로 AI 가 하는 일 세 가지가 다 나왔어. 1. 요리(ingest) 2. 물어보기(query) 3. 위키 청소(lint).': 'Finding and fixing these is called **lint**. It\'s originally the name of a tool that finds mistakes in program code.||From now on I\'ll call it **wiki cleanup (lint)**.||That covers all three jobs the AI does: 1. cooking (ingest) 2. asking (query) 3. wiki cleanup (lint).',
  'ingest · 요리': 'ingest · cooking',
  'query · 물어보기': 'query · asking',
  'lint · 위키 청소': 'lint · wiki cleanup',
  '## 위키 청소(lint)': '## Wiki cleanup (lint)',
  '위 문제를 찾아 고치기': 'Find and fix the problems above',
  '**AI 의 일 세 가지** — ingest · query · lint': '**The AI\'s three jobs** — ingest · query · lint',
  '지금 위키를 청소해 볼게. 결과가 뜨면 읽어 보고 "고쳐 줘"를 눌러 줘.': 'Let me clean up the wiki now. When the results appear, read them and click "Fix it."',
  '청소는 매일 할 필요 없어. 노트가 꽤 쌓였다 싶을 때 한 번씩 하면 돼.||청소할 때 AI 가 "이런 재료(raw 폴더 속 파일)를 더 넣어 보면 좋겠다", "이런 걸 물어보면 좋겠다" 하고 추천해 주기도 해.': 'You don\'t need to clean up every day. Just do it once in a while, when the notes have piled up a fair bit.||While cleaning up, the AI may also suggest things like "it\'d be good to add ingredients like this" or "try asking about this."',
  '**주기** — 노트가 꽤 쌓였을 때 가끔': '**How often** — now and then, once notes have piled up',
  '위키 청소(lint)가 찾는 건?': 'What does wiki cleanup (lint) look for?',
  '어긋난 말 · 고아 노트 · 빠진 개념 노트': 'Mismatched wording · orphan notes · missing concept notes',
  '맞춤법 틀린 곳': 'Spelling mistakes',
  '맞아. 노트끼리 말이 맞고 잘 이어지게 하는 거야.': 'Right. It makes sure notes agree with each other and connect well.',
  '맞춤법은 상관없어. 노트끼리 내용이 맞는지, 잘 이어져 있는지를 봐. 다시 골라 봐.': 'Spelling doesn\'t matter here. It checks whether notes agree with each other and are well connected. Try again.',
  '규칙 바꾸기 — AGENTS.md': 'Changing the rules — AGENTS.md',
  '이번 시간엔 규칙 파일(AGENTS.md)에 규칙 한 줄을 더해서 개념 노트의 정리 형식을 바꿔 볼 거야. 그 한 줄 때문에 wiki 노트가 한꺼번에 바뀌는 걸 보게 될 거야. AI 가 일하는 방식을 사용자가 정하는 방법이야.': 'This time we\'ll add one rule to the rules file (AGENTS.md) to change how concept notes are formatted. You\'ll see that one line change the wiki notes all at once. This is how you decide how the AI works.',
  '마지막으로 배울 건 AI 가 일하는 방식을 바꾸는 방법이야.||방법은 간단해. 규칙 파일 AGENTS.md 에 원하는 규칙을 한 줄 기록하면 돼.': 'The last thing to learn is how to change the way the AI works.||It\'s simple. Write the rule you want as one line in the rules file, AGENTS.md.',
  '## 규칙 바꾸기': '## Changing the rules',
  'AI 일하는 방식 바꾸기 → **AGENTS.md 에 규칙 한 줄**': 'Change how the AI works → **one rule line in AGENTS.md**',
  '이런 상황이라고 해 보자. 개념 폴더(concepts)의 노트를 읽어 보니 한 줄 요약만으로는 감이 잘 안 와. 그래서 개념 노트를 정리하는 형식을 바꾸고 싶어.||그럴 땐 노트를 하나하나 고쳐 달라고 하지 말고, AGENTS.md 에 이 규칙을 더하면 돼. "개념 노트마다 **예시** 칸을 두고, 일상에서 볼 수 있는 예시를 하나 적는다."||확인 창이 두 번 뜰 거야. 규칙 더하기 한 번, 다시 요리(ingest) 한 번. 둘 다 "만들기"를 눌러 줘.': 'Say this happens: you read the notes in the concepts folder (concepts), and a one-line summary isn\'t quite enough to get the idea. So you want to change how concept notes are formatted.||Instead of asking it to fix the notes one by one, add this rule to AGENTS.md: "Give every concept note an **Example** section with one example from everyday life."||The confirmation window will pop up twice: once to add the rule, once to cook (ingest) again. Click "Create" both times.',
  '예: 개념 노트에 **예시** 칸을 두는 규칙': 'E.g., a rule to give concept notes an **Example** section',
  'AGENTS.md 에 한 줄 더했을 뿐인데 개념 노트가 전부 바뀌었지? 개념 폴더(concepts)의 노트를 아무거나 열어서 맨 아래 **예시** 칸을 봐.||노트를 하나하나 고칠 필요 없이, 규칙만 바꾸고 다시 요리(ingest)하면 돼.||AI 가 원하는 대로 안 해 줄 때도 매번 말로 부탁하기보다 규칙 파일에 기록해 두는 게 좋아. 규칙 파일은 쓰면서 조금씩 다듬어 가는 거야.': 'Just one line added to AGENTS.md, and every concept note changed, right? Open any note in the concepts folder (concepts) and look at the **Example** section at the bottom.||No need to edit notes one by one. Just change the rule and cook (ingest) again.||Even when the AI doesn\'t do what you want, it\'s better to write it down in the rules file than to ask in words every time. You refine the rules file little by little as you use it.',
  '규칙 한 줄 추가': 'Add one rule line',
  '다시 요리': 'Cook again',
  '노트가 전부 바뀜': 'Every note changes',
  '규칙 바꾸고 다시 요리 → 노트 전부 반영': 'Change the rule, cook again → every note updated',
  '매번 말로 부탁 ✕ → 규칙 파일에 기록': 'Asking in words every time ✕ → write it in the rules file',
  'AI 가 노트 쓰는 방식을 바꾸고 싶으면?': 'What if you want to change how the AI writes notes?',
  'AGENTS.md 에 규칙을 적는다': 'Write a rule in AGENTS.md',
  '노트를 하나씩 직접 고친다': 'Edit the notes yourself, one by one',
  '맞아. 규칙 한 줄이 모든 노트에 적용돼.': 'Right. One rule line applies to every note.',
  'wiki 노트는 AI 만 고치는 거고, 하나씩 고치다 보면 금방 지쳐. 다시 골라 봐.': 'Only the AI edits wiki notes, and fixing them one by one wears you out fast. Try again.',
  '수료 — 네 재료를 실제 AI 로': 'Graduation — your ingredient, a real AI',
  '마지막 시간이야. 지금까지는 내가 재현해서 보여 준 결과를 봤는데, 이번엔 네가 평소 쓰는 AI 로 네 재료(raw 폴더 속 파일) 하나를 직접 요리(ingest)해 볼 거야. 끝나면 수료야.': 'This is the last lesson. So far you\'ve seen results I replayed for you. This time you\'ll cook (ingest) one of your own ingredients (a file in the raw folder) yourself, with the AI you normally use. After that, you graduate.',
  '지금까지 본 요리(ingest)는 전부 내가 재현해서 보여 준 거였어.||이번엔 네가 평소에 쓰는 **실제 AI** 로 직접 해 보자.': 'All the cooking (ingest) you\'ve seen so far was me replaying it for you.||This time, let\'s do it ourselves with the **real AI** you normally use.',
  '재료 하나': 'One ingredient',
  'AI 에게 요리(ingest) 부탁': 'Ask the AI to cook (ingest)',
  '첫 노트가 생긴다': 'Your first note appears',
  '매일 세 줄 · 일주일에 한 번 요리': 'Three lines a day · cook once a week',
  '## 실제 AI 로 요리': '## Cooking with a real AI',
  '클로드 앱에 폴더 연결 / 복사 · 붙여넣기': 'Connect the folder in the Claude app / copy & paste',
  '재료 하나 넣기': 'Add one ingredient',
  'raw 폴더에 **네 글 하나**를 넣어 줘. 이게 네 첫 재료(raw 폴더 속 파일)야. 방법은 편한 걸로 골라.\n\n1. 볼트에 있는 네 노트 하나를 파일 탐색기에서 raw 폴더 위로 끌어다 놓기 (원래 있던 자리에선 옮겨져). 옵시디언 사용법 기초 과정(A1)에서 만든 "오늘 알게 된 것" 노트도 좋아.\n2. raw 폴더를 오른쪽 클릭해서 새 노트를 만들고, 오늘 있었던 일 세 줄 기록하기\n3. Web Clipper 로 기사 하나 저장하기\n\n고르기 어려우면 그냥 기다려. 조금 있다가 내가 연습용 재료(raw 폴더 속 파일)를 대신 넣어 줄지 물어볼게.': 'Put **one piece of your own writing** into the raw folder. This is your first ingredient (a file in the raw folder). Pick whichever way is easiest.\n\n1. Drag one of your notes in the vault onto the raw folder in the File explorer (it moves out of its original spot). The "What I learned today" note from the Obsidian Basics course (A1) works great too.\n2. Right-click the raw folder, make a new note, and write three lines about your day\n3. Save an article with Web Clipper\n\nIf you can\'t decide, just wait. In a bit I\'ll ask if you want me to add a practice ingredient for you.',
  '먼저 raw 폴더에 사용자 글 하나 넣기': 'First, put one piece of your writing into raw',
  '**AI 에게** — "AGENTS.md 읽고 raw 의 새 재료 ingest 해 줘"': '**To the AI** — "Read AGENTS.md and ingest the new ingredients in raw"',
  '노트 하나를 파일 탐색기에서 이 raw 폴더 위로 끌어다 놓으면 돼.': 'Just drag a note from the File explorer onto this raw folder.',
  '# 내 첫 재료\n\n- 위키 정리는 AI 한테 맡기면 된다\n- 저장만 하면 잊는다\n- 매일 세 줄이면 된다\n': '# My first ingredient\n\n- Leave organizing the wiki to the AI\n- If I only save things, I forget them\n- Three lines a day is enough\n',
  'AI 가 다 쓰면 wiki 폴더에 새 노트가 생겨. 아직이면 AI 창을 한번 확인해 봐.': 'When the AI finishes writing, new notes will appear in the wiki folder. If nothing\'s there yet, check the AI window.',
  '네 재료(raw 폴더 속 파일)로, 네 AI 가 만든 첫 노트가 생겼어. 수료 축하해!': 'Your first note, made by your AI from your own ingredient. Congrats on graduating!',
  '앞으로 할 일': 'What\'s next',
  '1. **매일 세 줄**: raw 폴더에 오늘 한 일, 알게 된 것, 메모. 형식은 상관없어.\n2. **일주일에 한 번 요리(ingest)**: 요일을 정해 둬. "생각날 때 하지" 하면 잘 안 하게 돼.\n3. **처음엔 재료를 하나씩**: 재료(raw 폴더 속 파일)를 한꺼번에 몰아넣지 말고, 하나 요리할 때마다 AI 가 쓴 노트를 훑어봐. 마음에 안 들면 AGENTS.md 에 규칙을 더하면 돼.\n4. **이번 달 안에 한 번 꺼내 쓰기**: 한 주 정리를 부탁하든, "그때 왜 그렇게 했더라"를 물어보든. 한 번 해 보면 왜 기록하는지 실감이 나.': '1. **Three lines a day**: in the raw folder, what you did today, what you learned, any notes. Any format is fine.\n2. **Cook (ingest) once a week**: pick a day. "I\'ll do it when I remember" usually means you won\'t.\n3. **One ingredient at a time at first**: don\'t dump in a pile of ingredients at once. Each time you cook one, skim the notes the AI wrote. If you don\'t like them, add a rule to AGENTS.md.\n4. **Get something back at least once this month**: ask for a recap of your week, or ask "why did I do it that way back then?" Once you try it, you\'ll really feel why you keep a record.',
  '## 앞으로 할 일': '## What\'s next',
  '1. 매일 세 줄': '1. Three lines a day',
  '2. 일주일에 한 번 요리(ingest)': '2. Cook (ingest) once a week',
  '3. 처음엔 재료를 하나씩': '3. One ingredient at a time at first',
  '4. 한 달에 한 번 꺼내 쓰기': '4. Get something back once a month',
  '다음에 쓸 도구': 'Tools to use next',
  '이 연습 폴더를 그대로 계속 써도 되고, 더 본격적인 도구로 옮겨 가도 돼.\n\n1. **Karpathy LLM Wiki 플러그인**: 옵시디언 설정의 커뮤니티 플러그인에서 설치할 수 있어. 위키 폴더를 이 연습 폴더의 `wiki` 로 지정하면 지금까지 만든 노트에 이어서 쓸 수 있어.\n2. **클로드 데스크톱 앱**: 볼트 폴더를 연결해 두면 "ingest 해 줘" 한마디로 요리(ingest)할 수 있어.\n\n나는 화면 아래에 계속 있을게. 가끔 "오늘 세 줄 기록했어?" 하고 물어볼 거야.': 'You can keep using this practice folder as is, or move on to more full-fledged tools.\n\n1. **Karpathy LLM Wiki plugin**: install it from Community plugins in Obsidian\'s Settings. Set its wiki folder to this practice folder\'s `wiki` and you can pick up right where your notes left off.\n2. **Claude desktop app**: connect your vault folder, and just saying "Run ingest" is enough to cook (ingest).\n\nI\'ll stay at the bottom of your screen. Every now and then I\'ll ask, "Did you write your three lines today?"',
  '고마워': 'Thanks',
  '## 다음 도구': '## Next tools',
  'Karpathy LLM Wiki 플러그인 · 클로드 데스크톱 앱': 'Karpathy LLM Wiki plugin · Claude desktop app',
  '마지막으로 하나만. 지금까지는 "매일 세 줄"이라고 했지만, 세 줄은 습관을 만드는 시작일 뿐이야.||매일 기록하는 내용의 질이 높을수록, 그리고 "왜 그렇게 했는지", "그때 무슨 생각이었는지" 같은 맥락이 많이 기록될수록 AI 가 만들어 주는 위키도 훨씬 풍성해져.||세 줄로 시작해서, 익숙해지면 조금씩 더 자세히 기록해 봐. 네 위키는 네가 남긴 기록만큼 자라.': 'One last thing. I\'ve been saying "three lines a day," but three lines is just a start for building the habit.||The better the quality of what you write each day, and the more context you record, like "why I did it that way" or "what I was thinking then," the richer the wiki the AI builds for you.||Start with three lines, and once you\'re used to it, write in a bit more detail. Your wiki grows as much as the records you leave.',
  '## 위키를 키우는 법': '## How to grow your wiki',
  '세 줄은 시작일 뿐': 'Three lines is just the start',
  '기록의 질 ↑ · 맥락(왜, 무슨 생각) ↑ → 위키가 **풍성해짐**': 'Record quality ↑ · context (why, what you thought) ↑ → a **richer** wiki',
};

};

__defs["core/lessons/index"] = function (module, exports, require) {
'use strict';
const { COURSE_A } = require('./courseA');
const { COURSE_B } = require('./courseB');
const { attach } = require('./notes');
const EN = require('./en');
const ZH = require('./zh');

// 전체 순서. A3~A5 는 코스 A 에 더 붙는다
const ALL = [...COURSE_A, ...COURSE_B];

// 필기 노트(notes.js)를 단계에 붙인다. 못 찾은 것은 tests/run.js 가 실패로 본다
const NOTES_MISSING = attach(ALL);

// 레슨 · 필기는 한국어만 적고, 영어 · 중국어는 한국어 원문을 열쇠로 en.js · zh.js 에서 채운다.
// 이미 en · zh 가 적힌 글(경로 등)은 그대로 둔다. 그림 라벨({ ko: [...] })은 칸이 다 있을 때만 채운다
const TABLES = { en: EN, zh: ZH };
function translate(o) {
  if (Array.isArray(o)) return o.forEach(translate);
  if (!o || typeof o !== 'object') return;
  for (const [lang, T] of Object.entries(TABLES)) {
    if (o[lang] != null) continue;
    if (typeof o.ko === 'string' && T[o.ko] != null) o[lang] = T[o.ko];
    else if (Array.isArray(o.ko) && o.ko.every((s) => T[s] != null)) o[lang] = o.ko.map((s) => T[s]);
  }
  for (const [k, v] of Object.entries(o)) if (k !== 'ko' && k !== 'en' && k !== 'zh') translate(v);
}
translate(ALL);

module.exports = { ALL, COURSE_A, COURSE_B, NOTES_MISSING };

};

__defs["core/lessons/notes"] = function (module, exports, require) {
// 필기 노트 내용. 레슨마다 [이 단계에서, 기록할 줄(들)].
// "이 단계"는 단계 글의 앞부분이다: 말(say)의 한국어 첫머리, 카드 · 궁금한 점 제목, 퀴즈 질문.
// index.js 가 맞는 단계에 note 로 붙이고, 엔진은 그 단계를 시작할 때 기록한다(plugin/notes.js). 못 찾은 표시는 tests/run.js 가 잡는다.
// 정말 핵심 키워드만. 실습하면서 곁눈질로 볼 수 있게 한 줄을 짧게. A0 은 필기하지 않는다.
// 줄 모양 (plugin/mapview.js 가 그린다):
//  '## 제목'          작은 소제목 (주제가 바뀔 때)
//  '1. …'             번호 붙은 줄 (차례로 나오는 개념)
//  '**말** — 설명'    말은 굵게, 설명은 그 아래 흐리게
//  그 밖              점(•) 목록 한 줄
// 한 레슨 안에서 같은 줄은 두 번 기록하지 않으니 소제목도 레슨 안에서 겹치지 않게 쓴다.
// en · zh 는 한국어판을 기준으로 나중에 옮긴다.
'use strict';

const NOTES = {
  A1: [
    ['1. 분명히 저장해', ['## 기록해 두지 않으면 생기는 일', '1. 저장만 하고 다시 안 봄 → 결국 잊힌다']],
    ['2. 모은다고 아는 건', '2. **수집가의 오류** — 모으기 ≠ 알기'],
    ['3. 금방 잊힌다', '3. **망각 곡선** — 몇 시간 안에 가장 많이 잊음 → 그날 기록'],
    ['4. 정리하다 지친다', '4. 정리가 멈추는 이유 — **관리**(분류 · 연결 · 고치기)가 힘들어서'],
    ['5. 그 관리를', ['## 해결: LLM Wiki', '**LLM Wiki** — 관리는 AI, 사용자는 넣고 읽기']],
    ['5. LLM Wiki 가 뭐냐면', ['카파시(Andrej Karpathy)가 2026년 4월에 소개', '**AI 가 읽을 거리** — 사용자의 일 · 맥락 기록']],
    ['여기서 말 하나를 정해 두자.', ['## 말 정하기', '**재료** — raw 폴더 속 파일 (AI 가 읽고 정리할 원래 글)']],
    ['여기에 오늘 알게 된 거나', ['## 매일 할 일', '**세 줄** — 한 일 · 알게 된 것 · 메모']],
    ['됐다! 하루에', '**자동 저장** — 옵시디언엔 저장 버튼이 없다'],
  ],
  A2: [
    ['옵시디언이 어떤 앱인지부터', ['## 옵시디언', '컴퓨터의 **폴더를 열어 보여 주는 앱**']],
    ['볼트와 노트', ['**볼트**(보관함) — 옵시디언이 여는 폴더', '**노트** — 볼트 안의 `.md` 파일 하나', '서버 · 회원가입 없음 → 파일은 사용자 것']],
    ['혼자 할 땐 이렇게 해.', ['## 파일 위치 보기', '노트 **우클릭 → 폴더에서 보기**']],
    ['이게 왜 중요하냐면', ['## 왜 중요한가', '평범한 파일 → **AI 도 직접 읽고 씀**']],
  ],
  A3: [
    ['옵시디언 노트는 **마크다운**', ['## 마크다운', '기호로 제목 · 목록을 표시하는 글 형식']],
    ['1. 첫 번째는 **제목**', '1. **제목** — `# 제목` (# = Shift+3, 뒤에 한 칸)'],
    ['2. 두 번째는 **목록**', '2. **목록** — `- 내용` (빼기 + 한 칸)'],
    ['3. 세 번째는 **굵게**', '3. **굵게** — `**단어**` (* = Shift+8)'],
    ['왜 마크다운일까', ['## 왜 마크다운?', '기호가 글자로 남음 → AI 가 구조를 바로 읽음']],
  ],
  A4: [
    ['노트는 하나하나', ['## 링크', '**링크** — `[[노트 이름]]` (= 연결고리)']],
    ['고양이 노트 아래에 새 줄', '`[` 두 번 → 노트 목록이 뜸 (`[` = P 오른쪽)'],
    ['연결됐다!', '링크 글자 클릭 → 그 노트가 열림'],
    ['이렇게 이어진 노트들을', ['## 그래프 뷰', '점 = 노트, 선 = 링크']],
    ['그래프 뷰는 맨 왼쪽 세로', '**여는 곳** — 맨 왼쪽 아이콘 줄 (동그라미 + 선 아이콘)'],
    ['노트 두 개를 이으려면?', '같은 폴더 ≠ 연결. 잇는 건 `[[ ]]` 뿐'],
  ],
  A5: [
    ['이유 세 가지', ['## 옵시디언에 만드는 이유', '1. 평범한 파일 → AI 가 읽고 씀', '2. 링크 · 그래프 뷰 → 연결이 눈에 보임', '3. 사용자 컴퓨터 → AI 에게 보여 줄 폴더는 **사용자**가 정함']],
    ['연습 폴더 안에 이렇게 세 가지', ['## 다음 코스 구조', 'raw 폴더 · wiki 폴더 · AGENTS.md']],
  ],
  B0: [
    ['raw · wiki · AGENTS.md', ['## 위키를 이루는 세 가지', '1. **raw 폴더** — 사용자가 재료를 넣는 곳. AI 는 읽기만', '2. **wiki 폴더** — AI 만 고치는 노트', '3. **AGENTS.md** — AI 규칙 파일 (AI 가 먼저 읽음)']],
    ['이제 만들게.', ['## 같이 만드는 파일', '**README.md** — raw 폴더 안내. AI 가 가장 처음 읽음']],
    ['**index.md** 는 wiki 에', ['**index.md** — 목차', '**log.md** — 작업 기록 (둘 다 AI 가 갱신)']],
    ['천천히 읽어 봐.', 'AI 일하는 방식 바꾸기 → AGENTS.md 만 고치기'],
  ],
  B1: [
    ['AI 가 raw 폴더를 다루는 규칙', ['## AI 의 raw 규칙', 'AI 는 raw 폴더 속 파일을 **읽기만, 절대 안 고침**', '파일 이름은 내용을 알 수 있게']],
    ['들어갔다. raw 폴더를', ['## 재료 넣는 법', '끌어다 놓기 · 우클릭 → 새 노트 · Web Clipper']],
  ],
  B2: [
    ['AI 가 raw 폴더 속 파일, 곧 재료를', ['## 요리(ingest)', 'AI 가 재료를 읽고 wiki 에 노트 쓰기']],
    ['재료(raw 폴더 속 파일) 한 편을 요리', ['## 요리하면 생기는 것', '1. **요약 폴더(sources)** — 재료 하나에 요약 1개', '2. **개념 폴더(concepts)** — 개념마다 노트 1개', '3. index.md · log.md 갱신']],
    ['목차(index.md)랑 작업 기록', '재료 하나 → wiki 노트 여러 개가 한꺼번에 바뀜'],
  ],
  B3: [
    ['네가 쓴 노트는 아니지만', ['## AI 노트 구조', '**한 줄** — 한 문장 요약', '**재료** — 어느 raw 파일에서 왔는지', '**내용** — 정리 + 링크(연결고리)']],
    ['wiki 는 읽고, raw 에 쓴다', ['## 고칠 게 보이면', 'wiki 직접 수정 ✕ → **AI 에게 고쳐 달라고**', '사용자 생각은 raw 폴더에 새 재료로']],
  ],
  B4: [
    ['먼저 지금 위키가', ['## 그래프 뷰로 보기', '점 = 노트, 선 = 링크(연결고리)']],
    ['점도 선도 늘었지?', ['## 재료가 쌓이면', '새 재료가 옛 노트도 고침', '재료 ↑ → 연결고리 ↑ → 답 품질 ↑']],
    ['채팅에 파일 올리기와', '채팅에 파일 올리기 ✕ 남는 것 없음 → 위키는 정리 결과가 **쌓인다**'],
    ['목차 (index.md)', ['## 목차(index.md)', 'AI 가 질문을 받으면 **제일 먼저 읽음**']],
  ],
  B5: [
    ['위키에서 뭔가를 꺼내', ['## 물어보기(query)', 'AI 채팅창에 말로 질문']],
    ['물어보면 AI 는 이 순서로', ['1. 목차(index.md) 보기', '2. 관련 노트 읽기', '3. **출처** 달아 답하기']],
    ['저장한 답은 wiki 폴더', '좋은 답 → **답변 폴더(answers)** 에 저장 → 다음 답이 좋아짐'],
    ['잘 물어보는 요령', ['## 잘 물어보는 요령', '1) 어디를 볼지 말하기', '2) 답 모양 정하기', '3) "기록에 없으면 없다고"']],
  ],
  B6: [
    ['재료(raw 폴더 속 파일)가 쌓이면 꼭', ['## 쌓이면 생기는 문제', '1. 어긋난 말 · 낡은 내용', '2. **고아 노트** — 아무도 링크 안 함', '3. 빠진 개념 노트']],
    ['이런 걸 찾아서 고치는', ['## 위키 청소(lint)', '위 문제를 찾아 고치기', '**AI 의 일 세 가지** — ingest · query · lint']],
    ['청소는 매일 할 필요', '**주기** — 노트가 꽤 쌓였을 때 가끔'],
  ],
  B7: [
    ['마지막으로 배울 건', ['## 규칙 바꾸기', 'AI 일하는 방식 바꾸기 → **AGENTS.md 에 규칙 한 줄**']],
    ['이런 상황이라고 해 보자.', '예: 개념 노트에 **예시** 칸을 두는 규칙'],
    ['AGENTS.md 에 한 줄 더했을 뿐인데', ['규칙 바꾸고 다시 요리 → 노트 전부 반영', '매번 말로 부탁 ✕ → 규칙 파일에 기록']],
  ],
  B8: [
    ['지금까지 본 요리', ['## 실제 AI 로 요리', '클로드 앱에 폴더 연결 / 복사 · 붙여넣기']],
    ['재료 하나 넣기', ['먼저 raw 폴더에 사용자 글 하나 넣기', '**AI 에게** — "AGENTS.md 읽고 raw 의 새 재료 ingest 해 줘"']],
    ['앞으로 할 일', ['## 앞으로 할 일', '1. 매일 세 줄', '2. 일주일에 한 번 요리(ingest)', '3. 처음엔 재료를 하나씩', '4. 한 달에 한 번 꺼내 쓰기']],
    ['다음에 쓸 도구', ['## 다음 도구', 'Karpathy LLM Wiki 플러그인 · 클로드 데스크톱 앱']],
    ['마지막으로 하나만.', ['## 위키를 키우는 법', '세 줄은 시작일 뿐', '기록의 질 ↑ · 맥락(왜, 무슨 생각) ↑ → 위키가 **풍성해짐**']],
  ],
};

// 단계의 "첫머리"들: 말 · 카드 제목 · 궁금한 점 제목 · 퀴즈 질문 (한국어)
function heads(s) {
  const ko = (o) => (o && typeof o === 'object' ? o.ko : o);
  return [s.say && ko(s.say), s.card && ko(s.card.title), s.faq && ko(s.faq.title), s.quiz && ko(s.quiz.q)].filter((t) => typeof t === 'string');
}

// 레슨 단계에 note 를 붙인다. 못 찾은 표시는 [레슨 id, 표시] 로 돌려준다
function attach(lessons) {
  const missing = [];
  for (const L of lessons) {
    for (const [at, lines] of NOTES[L.id] || []) {
      let hit = null;
      const walk = (steps) => {
        for (const s of steps || []) {
          if (hit) return;
          if (heads(s).some((h) => h.startsWith(at))) hit = s;
          walk(s.then);
          walk(s.else);
        }
      };
      walk(L.steps);
      if (!hit) {
        missing.push([L.id, at]);
        continue;
      }
      hit.note = (Array.isArray(lines) ? lines : [lines]).map((t) => ({ ko: t }));
    }
  }
  return missing;
}

module.exports = { NOTES, attach };

};

__defs["core/lessons/zh"] = function (module, exports, require) {
// 레슨 · 필기 글의 중국어(간체)판. 한국어 원문(courseA · courseB · notes)을 열쇠로 찾는다 — lessons/index.js 의 translate().
// 한국어를 고치면 그 글은 열쇠가 안 맞아 "번역 대기"로 돌아간다 (tests/run.js 가 센다). 그때 여기 열쇠와 번역을 같이 고친다.
'use strict';

module.exports = {
  // ── 코스 A ──
  '만남, 그리고 화면 둘러보기': '初次见面，看看界面',
  '첫 시간이야. 인사하고, 옵시디언 화면이 어떻게 생겼는지 같이 둘러본 다음 연습용 폴더를 하나 만들 거야.': '第一节课。我们先打个招呼，一起看看 Obsidian 的界面长什么样，然后建一个练习用的文件夹。',
  '안녕! 나는 이 수업을 맡은 고양이야.||이름은 아직 없어. 같이 하다가 좋은 이름이 떠오르면 지어 줘.': '你好！我是负责这门课的猫。||我还没有名字。一起学的时候想到好名字，就帮我起一个吧。',
  '"AI 가 알아서 정리해 주는 위키" 얘기 듣고 왔지?': '你是听说了“AI 自动帮你整理的维基”才来的吧？',
  '응, SNS 에서 봤어': '嗯，在社交媒体上看到的',
  '그냥 궁금해서': '就是好奇',
  '나도 그거 보고 해 보고 싶었는데, 막상 어디서부터 해야 할지 모르겠더라.||그래서 처음부터 하나씩 같이 해 보려고.': '我也是看到那个就想试试，可真要动手，又不知道从哪儿开始。||所以我们从头开始，一步一步一起来。',
  '궁금해서 왔으면 충분해.||처음부터 하나씩 같이 해 보자.': '好奇就够了。||我们从头开始，一步一步一起来。',
  '수업은 두 부분이야.||앞부분(A)은 옵시디언 기본 사용법이고, 뒷부분(B)은 AI 가 정리해 주는 위키를 실제로 만들어 보는 거야. 레슨 하나는 5분 안팎이야.': '课程分两部分。||前半部分（A）是 Obsidian 的基本用法，后半部分（B）是亲手做一个由 AI 帮你整理的维基。每节课大约 5 分钟。',
  '말풍선 보는 법부터 알려 줄게.||내 말은 네가 넘기기 전까지 그대로 있어. 다 읽었으면 말풍선을 한 번 누르면 다음 말로 넘어가.||지나간 말을 다시 보고 싶으면 왼쪽 아래 "← 이전"을 누르면 돼. 지금 한번 눌러 봐도 좋아.': '先教你怎么看对话气泡。||在你翻页之前，我的话会一直停在这里。读完了就点一下气泡，翻到下一句。||想回看前面的话，点左下角的“← 上一句”就行。现在点一下试试也可以。',
  '이제 옵시디언 화면을 같이 둘러보자. 처음엔 세 군데만 알면 돼. 하나씩 깜빡이는 테두리로 짚어 줄게.': '现在一起看看 Obsidian 的界面。一开始只要认识三个地方就够了。我会用闪烁的边框一个一个指给你看。',
  '파일 탐색기': '文件列表',
  '1. 왼쪽 칸은 **파일 탐색기**야.||지금 옵시디언이 열고 있는 폴더 안의 폴더와 노트가 여기 목록으로 다 나와. 노트를 열 때도 여기서 이름을 클릭하면 돼.': '1. 左边这一栏是**文件列表**。||Obsidian 当前打开的文件夹里，所有的文件夹和笔记都会列在这里。想打开笔记，也是在这里点它的名字。',
  '아이콘 줄': '图标栏',
  '2. 화면 맨 왼쪽 끝에 작은 아이콘이 세로로 늘어서 있지? 테두리로 감싼 곳이야.||자주 쓰는 기능을 바로 여는 버튼들이야. 아이콘에 마우스를 올리면 이름이 떠. 나중에 여기서 "그래프 뷰"라는 화면을 열 거야.': '2. 屏幕最左边有一列竖着排的小图标，看到了吗？就是边框圈起来的地方。||这些按钮用来直接打开常用功能，也叫功能区。鼠标移到图标上会显示名字。之后我们会在这里打开一个叫“关系图谱”的界面。',
  '3. 가운데 넓은 곳은 노트를 열어서 읽고 쓰는 화면이야.||노트를 여러 개 열면 위쪽에 탭으로 쌓여. 웹 브라우저 탭이랑 똑같아.': '3. 中间宽宽的区域，是打开笔记、阅读和书写的地方。||打开多篇笔记时，它们会在上方排成标签页，和浏览器的标签页一样。',
  '하나만 더. 옵시디언이 열고 있는 이 폴더 전체를 **볼트(vault)**라고 불러. 한국어 화면에선 "보관함"이라고 나와.||볼트가 정확히 뭔지는 A2 에서 직접 확인해 볼 거야.': '还有一件事。Obsidian 打开的这整个文件夹，叫作**仓库（vault）**，中文界面上显示的就是“仓库”。||仓库到底是什么，我们在 A2 里亲眼看看。',
  '이제 연습할 폴더를 만들자.||볼트 안에 폴더를 하나 새로 만들고, 수업에서 하는 건 전부 그 안에서만 해. 네가 원래 갖고 있던 노트는 건드리지 않아.': '现在来建练习用的文件夹。||在仓库里新建一个文件夹，上课做的所有事都只在这个文件夹里进行。你原来的笔记，我一概不碰。',
  '"{root}" 라는 폴더를 만들어도 될까?': '可以建一个叫“{root}”的文件夹吗？',
  '응, 만들어': '好，建吧',
  '잠깐만': '等一下',
  '알았어. 준비되면 맨 왼쪽 아이콘 줄에서 고양이 아이콘을 눌러 줘. 거기서부터 이어서 할게.': '好的。准备好了就点最左边图标栏里的猫图标，我们从这里接着来。',
  '파일 탐색기에 폴더가 안 보이면 목록을 위아래로 스크롤해 봐. 폴더는 이름 순서대로 놓여 있어.': '如果在文件列表里没看到文件夹，就上下滚动一下列表。文件夹是按名称顺序排列的。',
  '연습 폴더': '练习文件夹',
  '파일 탐색기에 "{root}" 폴더가 생겼지?||앞으로 수업에서 만드는 노트는 전부 이 폴더 안에 들어가.': '文件列表里出现“{root}”文件夹了吧？||之后上课建的笔记，都会放在这个文件夹里。',
  '폴더 이름 왼쪽의 작은 화살표를 클릭하면 폴더가 펼쳐지고, 한 번 더 클릭하면 접혀.||지금은 비어 있어서 펼쳐도 아무것도 없을 거야.': '点文件夹名称左边的小箭头，文件夹就会展开，再点一次就会收起。||现在里面还是空的，展开了也什么都没有。',
  '왜 기록해 둬야 할까': '为什么要记下来',
  '이번 시간엔 기록해 두지 않으면 어떤 일이 생기는지 내 얘기 다섯 개로 보고, 1분 동안 세 줄을 직접 기록해 볼 거야. 궁금한 건 중간에 물어봐도 돼.': '这节课我们通过我的五个小故事，看看不记下来会发生什么，然后花 1 分钟亲手记下三行。有疑问可以随时问我。',
  '본격적으로 하기 전에 내 얘기 좀 들어 줘. 짧은 거 다섯 개야. 1번부터 차례로 할게.': '正式开始之前，先听我讲讲。一共五个短故事，从第 1 个开始按顺序讲。',
  '1. 분명히 저장해 둔 글이 있었는데 못 찾겠어.||북마크, 스크린샷, 나한테 보낸 메시지까지 다 뒤졌는데 없더라.': '1. 我明明存过一篇文章，就是找不到了。||书签、截图、发给自己的消息，全都翻遍了，还是没有。',
  '## 기록해 두지 않으면 생기는 일': '## 不记下来会怎样',
  '1. 저장만 하고 다시 안 봄 → 결국 잊힌다': '1. 只存不看 → 最后忘光',
  '1. 저장했는데 못 찾는다': '1. 存了却找不到',
  '지식관리 앱 사용자를 조사한 연구를 보면, 사람들은 저장하는 데는 시간을 꽤 쓰는데 나중에 **다시 찾아보는 일**은 잘 안 된다고 답했어.\n\n저장만 하고 다시 보지 않은 건 결국 잊혀.': '有一项针对知识管理应用用户的研究发现：人们在保存上花了不少时间，但很少会**回头再找来看**。\n\n只存不看的东西，最后都会被忘掉。',
  '다음': '下一个',
  '2. 읽을 책을 잔뜩 사 놓고 뿌듯했어.||근데 사실 한 권도 안 읽었어.': '2. 买了一大堆要读的书，心里特别满足。||可其实一本都没读。',
  '2. 모은다고 아는 건 아니다': '2. 收集不等于知道',
  '"이런 게 있다는 걸 안다"와 "내용을 안다"는 달라.\n\n저장 버튼 누르기가 너무 쉬워서, 저장만 해도 뭔가 한 기분이 들어. 이걸 **수집가의 오류**라고 해.': '“知道有这么个东西”和“知道里面讲了什么”是两回事。\n\n点保存实在太容易了，光是保存，就让人觉得自己做了点什么。这叫**收藏家谬误**。',
  '2. **수집가의 오류** — 모으기 ≠ 알기': '2. **收藏家谬误** — 收集 ≠ 知道',
  '3. 어제 들은 얘기가 오늘 벌써 가물가물해.': '3. 昨天听到的事，今天就已经记不太清了。',
  '3. 금방 잊힌다': '3. 忘得很快',
  '사람은 새로 들은 걸 처음 몇 시간 사이에 가장 많이 잊어버려. 이걸 **망각 곡선**이라고 해.\n\n그래서 그날 기록해 두지 않으면 남는 게 거의 없어.': '人新学到的东西，在最初几个小时里忘得最多。这叫**遗忘曲线**。\n\n所以当天不记下来，就几乎什么都留不下。',
  '3. **망각 곡선** — 몇 시간 안에 가장 많이 잊음 → 그날 기록': '3. **遗忘曲线** — 几小时内忘得最多 → 当天记录',
  '4. 그래서 정리를 잘해 보려고 폴더랑 태그를 잔뜩 만들었어.||일주일 만에 지쳐서 그만뒀어.': '4. 为了好好整理，我建了一大堆文件夹和标签。||结果一周就累得放弃了。',
  '4. 정리하다 지친다': '4. 整理到累垮',
  '메모 정리가 오래 못 가는 건 대부분 **관리하는 일** 때문이야.\n\n새 글이 들어올 때마다 어디에 넣을지 고르고, 관련 있는 글끼리 이어 주고, 오래된 내용을 고치는 일. 이걸 사람이 다 하려고 하면 금방 지쳐.': '整理笔记坚持不下去，大多是因为**维护的活儿**。\n\n每来一篇新内容，都要决定放在哪儿，把相关的内容连起来，再修改过时的内容。这些全靠人来做，很快就会累。',
  '4. 정리가 멈추는 이유 — **관리**(분류 · 연결 · 고치기)가 힘들어서': '4. 整理停下来的原因 — **维护**（分类 · 连接 · 修改）太累',
  '5. 그 관리를 AI 한테 맡기면 된다는 걸 알았어.||사용자는 글을 넣고 읽기만 하고, 분류하고 잇고 요약하는 건 AI 가 하는 거야.': '5. 后来我发现，可以把这些维护交给 AI。||你只管放进内容、阅读，分类、连接、总结都由 AI 来做。',
  '## 해결: LLM Wiki': '## 解决办法：LLM Wiki',
  '**LLM Wiki** — 관리는 AI, 사용자는 넣고 읽기': '**LLM Wiki** — 维护交给 AI，你只管放进去和读',
  '5. LLM Wiki 가 뭐냐면': '5. LLM Wiki 是什么',
  'AI 가 관리해 주는 개인 위키를 **LLM Wiki** 라고 해. LLM 은 ChatGPT 나 클로드 같은 AI 를 가리키는 말이야. 2026년 4월에 AI 연구자 **안드레 카파시(Andrej Karpathy)**가 이 방법을 글로 소개하면서 널리 알려졌어.\n\n여기서 중요한 건 AI 가 얼마나 똑똑하냐가 아니라 **AI 가 읽을 거리가 있느냐**야. 사용자가 평소에 어떤 식으로 일하는지, 어떤 일을 왜 그렇게 정했는지, 지금 어떤 상황인지. 이런 **사용자의 일과 맥락에 대한 기록**이 있어야 AI 가 사용자에게 맞는 답을 줄 수 있어.\n\n똑같은 질문에도 AI 답이 뻔하게 느껴질 때가 있지? 대개 AI 가 사용자에 대해 읽을 기록이 없어서 그래.': '由 AI 来维护的个人维基，叫作 **LLM Wiki**。LLM 指的是 ChatGPT、Claude 这类 AI。2026 年 4 月，AI 研究者 **安德烈·卡帕西（Andrej Karpathy）**写文章介绍了这个方法，它也因此广为人知。\n\n这里关键的不是 AI 有多聪明，而是**有没有东西给 AI 读**。你平时怎么工作，某件事为什么那样决定，现在处在什么情况。有了这些**关于你的工作和背景的记录**，AI 才能给出适合你的回答。\n\n同样的问题，有时 AI 的回答让人觉得很空泛吧？多半是因为 AI 没有关于你的记录可读。',
  '사용자': '你',
  '글을 넣고, 읽는다': '放进内容，阅读',
  'AI': 'AI',
  '분류 · 연결 · 요약': '分类 · 连接 · 总结',
  '알았어': '知道了',
  '카파시(Andrej Karpathy)가 2026년 4월에 소개': '卡帕西（Andrej Karpathy）在 2026 年 4 月提出',
  '**AI 가 읽을 거리** — 사용자의 일 · 맥락 기록': '**给 AI 读的东西** — 你的工作 · 背景记录',
  '여기서 말 하나를 정해 두자. AI 가 읽고 정리할 원래 글, 그러니까 사용자의 일과 맥락을 기록해 둔 글을 앞으로 **재료**라고 부를게.||재료는 B 코스에서 만들 **raw 폴더**에 모아 둘 거야. 그래서 앞으로 "재료"라고 하면 **raw 폴더 속 파일**을 말하는 거야.||직접 쓴 메모든 회의 기록이든 저장해 둔 기사든, AI 한테 넘겨줄 글이면 다 재료(raw 폴더 속 파일)가 될 수 있어.': '在这里先定一个说法。AI 要阅读和整理的原始文字，也就是记录了你的工作和背景的文字，以后我叫它**食材**。||食材会集中放在 B 课程里要建的 **raw 文件夹**里。所以以后说“食材”，指的就是 **raw 文件夹里的文件**。||不管是自己写的笔记、会议记录，还是收藏的文章，只要是要交给 AI 的文字，都可以成为食材（raw 文件夹里的文件）。',
  '## 말 정하기': '## 定个说法',
  '**재료** — raw 폴더 속 파일 (AI 가 읽고 정리할 원래 글)': '**食材** — raw 文件夹里的文件（AI 要阅读和整理的原始文字）',
  '궁금한 거 있어?': '有什么想问的吗？',
  '궁금한 걸 누르면 답해 줄게. 다 봤으면 "넘어가기".': '点你想问的，我来回答。都看完了就点“下一步”。',
  '그냥 메모 앱이랑 뭐가 달라?': '这和普通笔记应用有什么不同？',
  '메모 앱은 기록하는 것도 사용자가, 정리하는 것도 사용자가 해. 그래서 쌓일수록 찾기가 어려워져.\n\nLLM Wiki 에선 사용자는 재료(raw 폴더 속 파일)만 넣고, 요약하고 서로 잇고 목차를 고치는 건 AI 가 해. 그래서 쌓일수록 오히려 찾기 쉬워져.': '用笔记应用时，记录是你，整理也是你。所以越积越多，就越难找。\n\n在 LLM Wiki 里，你只要放进食材（raw 文件夹里的文件），总结、互相连接、更新目录都由 AI 来做。所以越积越多，反而越好找。',
  'AI 가 글을 읽어도 안전해?': '让 AI 读我的文字安全吗？',
  '네가 고른 AI 에게, 네가 고른 폴더만 보여 주는 거야. 이 플러그인은 네 글을 어디로도 보내지 않아.\n\n그래도 고객 개인정보, 비밀번호, 민감한 금액 같은 건 처음부터 재료(raw 폴더 속 파일)로 넣지 마. 꼭 필요하면 "A사 담당자"처럼 바꿔서 적으면 돼.': '你只是把你选的文件夹，给你选的 AI 看。这个插件不会把你的文字发到任何地方。\n\n不过，客户个人信息、密码、敏感金额这类东西，一开始就别放进食材（raw 文件夹里的文件）。实在需要的话，就换个说法写，比如“A 公司负责人”。',
  '매일 세 줄이면 정말 돼?': '每天三行真的就够吗？',
  '응. 오늘 한 일, 알게 된 것, 그 밖의 메모. 형식도 맞춤법도 신경 안 써도 돼.\n\n며칠 빼먹어도 괜찮아. 출석 체크가 아니라 나중에 꺼내 쓸 재료(raw 폴더 속 파일)를 모으는 거니까. 제일 쓸모 있는 건 "이건 다음에 조심해야겠다" 같은 한 줄이야.': '嗯。今天做了什么、学到了什么、其他备忘。格式和错别字都不用管。\n\n漏几天也没关系。这不是打卡，而是在攒以后能拿出来用的食材（raw 文件夹里的文件）。最有用的，往往是“这个下次得注意”这样的一句话。',
  '그럼 지금 재료가 될 글을 하나 만들어 보자. 1분이면 돼.': '那我们现在就写一篇能当食材的文字吧。1 分钟就好。',
  '- \n': '- \n',
  '방금 연습 폴더 안에 "오늘 알게 된 것"이라는 노트를 만들어서 가운데 화면에 열어 뒀어.||왼쪽 파일 탐색기에서 연습 폴더를 펼쳐 보면 이 노트가 있을 거야.': '我刚在练习文件夹里建了一篇叫“今天学到的”的笔记，已经在中间打开了。||在左边的文件列表里展开练习文件夹，就能看到这篇笔记。',
  '여기에 오늘 알게 된 거나 느낀 걸 세 줄만 기록해 봐. 아무거나 괜찮아.||가운데 노트를 한 번 클릭하면 글자를 쓸 수 있어. 첫 줄 앞의 점(•)은 목록 표시야. 한 줄 쓰고 Enter 를 누르면 다음 줄에도 점이 생겨.||맞춤법이나 문장은 신경 쓰지 마. 단어만 적어도 돼.': '在这里记下三行今天学到的或感受到的东西。写什么都行。||点一下中间的笔记就能输入文字。第一行前面的点（•）是列表符号。写完一行按 Enter，下一行也会出现点。||不用管错别字和句子通不通，只写几个词也可以。',
  '## 매일 할 일': '## 每天要做的事',
  '**세 줄** — 한 일 · 알게 된 것 · 메모': '**三行** — 做了什么 · 学到了什么 · 备忘',
  '가운데 노트를 클릭하고 한 줄에 하나씩 적으면 돼. 세 줄이 되면 내가 알아챌게.': '点一下中间的笔记，一行写一条就行。写满三行我就会发现。',
  '- 위키 정리는 AI 한테 맡기면 된다\n- 저장만 하면 잊는다\n- 매일 세 줄이면 된다\n': '- 维基整理交给 AI 就行\n- 只存不看就会忘\n- 每天三行就够了\n',
  '됐다! 하루에 할 일은 이게 다야.||참, 저장 버튼은 따로 없어. 옵시디언은 쓰는 대로 바로 저장돼.||방금 쓴 세 줄을 나중에 raw 폴더에 넣으면, 그게 AI 가 읽을 재료(raw 폴더 속 파일)야.': '好了！每天要做的就这些。||对了，这里没有单独的保存按钮。Obsidian 边写边自动保存。||之后把刚写的三行放进 raw 文件夹，它就是 AI 要读的食材（raw 文件夹里的文件）。',
  '**자동 저장** — 옵시디언엔 저장 버튼이 없다': '**自动保存** — Obsidian 没有保存按钮',
  '사용자가 매일 할 일은?': '你每天要做的是？',
  '편하게 세 줄 기록하기': '轻松记下三行',
  '폴더와 태그 정리하기': '整理文件夹和标签',
  '맞아. 정리는 AI 가 할 일이야.': '对。整理是 AI 的活儿。',
  '그건 4번 얘기에서 일주일 만에 지친 방법이야. 다시 골라 봐.': '那是第 4 个故事里一周就累垮的方法。再选一次吧。',
  '옵시디언 노트는 그냥 파일이다': 'Obsidian 笔记就是普通文件',
  '이번 시간엔 옵시디언이 어떤 앱인지 알아보고, 아까 쓴 노트가 네 컴퓨터에 진짜 파일로 저장돼 있는지 윈도우 폴더 창에서 직접 확인해 볼 거야.': '这节课我们来了解 Obsidian 是个什么样的应用，再到 Windows 的文件夹窗口里亲眼确认：刚才写的笔记，是不是真的作为文件存在你的电脑上。',
  '옵시디언이 어떤 앱인지부터 말해 줄게.||옵시디언은 컴퓨터에 있는 폴더 하나를 열어서, 그 안의 글 파일을 보기 좋게 보여 주고 고칠 수 있게 해 주는 앱이야.': '先说说 Obsidian 是什么样的应用。||Obsidian 会打开电脑里的一个文件夹，把里面的文本文件好看地显示出来，还能让你修改。',
  '## 옵시디언': '## Obsidian',
  '컴퓨터의 **폴더를 열어 보여 주는 앱**': '把电脑里的**文件夹打开并显示出来的应用**',
  '볼트와 노트': '仓库和笔记',
  '**볼트(vault)**: 옵시디언이 여는 폴더 하나. 한국어 화면에선 "보관함"이라고 나와. 왼쪽 파일 탐색기에 보이는 건 전부 이 볼트 안에 있는 거야.\n\n**노트**: 볼트 안의 글 파일 하나. 파일 이름 끝에 `.md` 가 붙어. md 는 마크다운이라는 글 형식인데, 다음 레슨에서 배울 거야.\n\n회원가입이나 서버가 필요 없어. 파일이 사용자 컴퓨터에 있으니까 옵시디언을 지워도 노트는 그대로 남아.': '**仓库（vault）**：Obsidian 打开的一个文件夹，中文界面上就叫“仓库”。左边文件列表里看到的一切，都在这个仓库里。\n\n**笔记**：仓库里的一个文本文件。文件名以 `.md` 结尾。md 是一种叫 Markdown 的文字格式，下一课会学。\n\n不需要注册账号，也不需要服务器。文件就在你的电脑上，所以就算卸载 Obsidian，笔记也会原样留着。',
  '정말?': '真的？',
  '**볼트**(보관함) — 옵시디언이 여는 폴더': '**仓库**（vault） — Obsidian 打开的文件夹',
  '**노트** — 볼트 안의 `.md` 파일 하나': '**笔记** — 仓库里的一个 `.md` 文件',
  '서버 · 회원가입 없음 → 파일은 사용자 것': '没有服务器 · 无需注册 → 文件归你所有',
  '직접 확인해 보자. 아까 쓴 "오늘 알게 된 것" 노트를 윈도우 폴더 창에서 열어 볼게.': '来亲眼确认一下。我把刚才写的“今天学到的”笔记，在 Windows 的文件夹窗口里打开给你看。',
  '오늘 알게 된 것': '今天学到的',
  '혼자 할 땐 이렇게 해. 파일 탐색기에서 노트 이름 위에 마우스를 두고 **오른쪽 버튼**을 누르면 메뉴가 떠.||거기서 **"폴더에서 보기"**를 고르면 돼. 맥에선 "Finder에서 보기"라고 나와.||이번엔 내가 대신 열어 줄게.': '自己操作时这样做：在文件列表里把鼠标放在笔记名上，按**右键**，就会弹出菜单。||在菜单里选**“在系统资源管理器中显示”**就行。Mac 上显示的是“在 Finder 中显示”。||这次我替你打开。',
  '## 파일 위치 보기': '## 查看文件位置',
  '노트 **우클릭 → 폴더에서 보기**': '笔记 **右键 → 在系统资源管理器中显示**',
  '윈도우 폴더 창이 하나 떴지? 그 안에 "오늘 알게 된 것.md" 파일이 있을 거야.||그 파일이 방금 네가 옵시디언에서 쓴 노트야. 확인했으면 옵시디언으로 돌아와서 눌러 줘.': '弹出了一个 Windows 文件夹窗口吧？里面应该有“今天学到的.md”这个文件。||这个文件就是你刚才在 Obsidian 里写的笔记。确认好了，就回到 Obsidian 点一下。',
  '봤어': '看到了',
  '창이 안 떴어': '窗口没弹出来',
  '폴더 창이 옵시디언 뒤에 가려져 있을 수도 있어. 화면 아래 작업 표시줄을 한번 봐 줘.||그래도 없으면 나중에 노트 이름을 오른쪽 클릭해서 "폴더에서 보기"로 직접 열어 봐.': '文件夹窗口可能被 Obsidian 挡在后面了。看看屏幕下方的任务栏。||还是没有的话，以后可以右键点笔记名，用“在系统资源管理器中显示”自己打开。',
  '맞아. 옵시디언은 이 파일을 열어서 보여 주고 있었던 거야.||폴더 창은 이제 닫아도 돼.': '没错。Obsidian 一直是在打开这个文件，显示给你看。||文件夹窗口现在可以关掉了。',
  '이게 왜 중요하냐면,||노트가 평범한 파일이니까 **AI 도 이 파일을 직접 읽고 쓸 수 있어.** AI 가 관리하는 위키를 옵시디언에 만드는 이유가 이거야.': '为什么这很重要呢？||因为笔记是普通文件，**AI 也能直接读写这些文件。**这就是要在 Obsidian 里建一个由 AI 维护的维基的原因。',
  '## 왜 중요한가': '## 为什么重要',
  '평범한 파일 → **AI 도 직접 읽고 씀**': '普通文件 → **AI 也能直接读写**',
  '옵시디언 노트 하나는 실제로 뭐야?': '一篇 Obsidian 笔记，实际上是什么？',
  '컴퓨터 폴더 안의 파일 하나': '电脑文件夹里的一个文件',
  '옵시디언 서버에 올라간 글': '上传到 Obsidian 服务器的文字',
  '맞아. 그래서 사용자 것이고, AI 도 읽을 수 있어.': '对。所以它归你所有，AI 也能读。',
  '옵시디언엔 서버가 없어. 방금 윈도우 폴더 창에서 파일을 봤잖아. 다시 골라 봐.': 'Obsidian 没有服务器。你刚才在 Windows 文件夹窗口里看到文件了吧。再选一次吧。',
  '마크다운 기호 세 개': '三个 Markdown 符号',
  '이번 시간엔 노트에 쓰는 마크다운 기호 세 개를 직접 쳐 보고, AI 가 왜 이 형식을 잘 읽는지 알아볼 거야.': '这节课我们亲手敲一敲笔记里用的三个 Markdown 符号，再看看为什么 AI 特别擅长读这种格式。',
  '옵시디언 노트는 **마크다운**이라는 방식으로 써.||글 앞뒤에 기호 몇 개를 붙여서 "여긴 제목", "여긴 목록" 하고 표시하는 방식이야. 아까 본 `.md` 가 마크다운 파일이라는 뜻이야.': 'Obsidian 笔记是用一种叫 **Markdown** 的方式来写的。||就是在文字前后加几个符号，标出“这里是标题”“这里是列表”。刚才看到的 `.md`，意思就是 Markdown 文件。',
  '## 마크다운': '## Markdown',
  '기호로 제목 · 목록을 표시하는 글 형식': '用符号标出标题 · 列表的文字格式',
  '처음엔 기호 세 개만 알면 돼. 이렇게 생겼어.': '一开始只要会三个符号就行。长这样。',
  '안녕': '你好',
  '할 일': '待办',
  '다른 노트': '另一篇笔记',
  '연습하라고 "연습장"이라는 노트를 만들어서 가운데에 열어 뒀어. 여기에 쳐 보자.': '我建了一篇叫“练习本”的笔记给你练习，已经在中间打开了。就在这里敲吧。',
  '1. 첫 번째는 **제목**이야.||줄 맨 앞에 `#` 을 치고 한 칸 띄운 다음 글을 쓰면 제목이 돼. `#` 은 Shift 를 누른 채 숫자 3 을 누르면 나와.||예를 들면 `# 오늘`. 치고 나면 글자가 크게 바뀌는 게 보일 거야. 아무 제목이나 하나 써 봐.': '1. 第一个是**标题**。||在行首敲 `#`，空一格再写字，就成了标题。`#` 是按住 Shift 再按数字 3。||比如 `# 今天`。敲完你会看到字变大了。随便写一个标题吧。',
  '1. **제목** — `# 제목` (# = Shift+3, 뒤에 한 칸)': '1. **标题** — `# 标题`（# = Shift+3，后面空一格）',
  '연습장 노트를 클릭하고 맨 앞에 `# 오늘` 처럼 쳐 봐. # 다음에 한 칸 띄우는 걸 잊지 마.': '点一下练习本笔记，在最前面敲 `# 今天` 这样的内容。别忘了 # 后面要空一格。',
  '# 오늘\n': '# 今天\n',
  '잘했어. 커서를 그 줄에 두면 `#` 이 보이고, 다른 줄로 옮기면 숨어.||기호는 그대로 있고, 옵시디언이 보기 좋게 감춰 줄 뿐이야.': '很好。光标放在那一行时能看到 `#`，移到别的行它就藏起来了。||符号其实还在，只是 Obsidian 帮你藏起来，看着更清爽。',
  '2. 두 번째는 **목록**이야.||Enter 로 새 줄을 만들고, 맨 앞에 `-` (빼기 기호)를 친 다음 한 칸 띄우고 글을 써. 예: `- 할 일`.||A1 에서 본 그 점(•)이 바로 이거야. 한 줄 써 봐.': '2. 第二个是**列表**。||按 Enter 换一行，在行首敲 `-`（减号），空一格再写字。比如：`- 待办`。||A1 里看到的那个点（•）就是它。写一行试试。',
  '2. **목록** — `- 내용` (빼기 + 한 칸)': '2. **列表** — `- 内容`（减号 + 空一格）',
  '새 줄 맨 앞에 `- 할 일` 처럼 쳐 봐. 빼기 기호 다음에 한 칸.': '在新的一行最前面敲 `- 待办` 这样的内容。减号后面空一格。',
  '- 세 줄 적기\n': '- 写三行\n',
  '3. 세 번째는 **굵게**야.||강조하고 싶은 단어 앞뒤를 별표 두 개로 감싸면 돼. 별표(*)는 Shift 를 누른 채 숫자 8. 예: `**중요**`.||아무 단어나 감싸 봐.': '3. 第三个是**加粗**。||把想强调的词前后各用两个星号包起来就行。星号（*）是按住 Shift 再按数字 8。比如：`**重要**`。||随便包一个词试试。',
  '3. **굵게** — `**단어**` (* = Shift+8)': '3. **加粗** — `**词语**`（* = Shift+8）',
  '`**중요**` 처럼 단어 앞뒤에 별표를 두 개씩 붙이면 돼.': '像 `**重要**` 这样，在词的前后各加两个星号就行。',
  '**중요**\n': '**重要**\n',
  '왜 마크다운일까': '为什么用 Markdown',
  '워드나 한글 같은 프로그램은 "여긴 제목"이라는 걸 글자 크기나 색으로 표시해. 그런 꾸밈은 파일 안에 복잡한 형태로 저장돼서 AI 가 읽기 어려워.\n\n마크다운은 `#`, `-`, `**` 같은 기호가 **글자 그대로** 파일에 들어 있어. 그래서 AI 가 어디가 제목이고 어디가 목록인지 바로 알아.\n\n기호를 몰라도 괜찮아. 그냥 줄글로 적어도 AI 가 알아서 형식을 맞춰 줘.': 'Word、WPS 这类软件，是用字号或颜色来表示“这里是标题”的。这些修饰在文件里以复杂的形式保存，AI 很难读懂。\n\nMarkdown 里，`#`、`-`、`**` 这些符号会**原样以文字**存在文件里。所以 AI 一眼就知道哪里是标题、哪里是列表。\n\n不会这些符号也没关系。直接写成普通段落，AI 也会帮你把格式整理好。',
  '제목': '标题',
  '목록': '列表',
  '굵게': '加粗',
  '링크': '链接',
  '## 왜 마크다운?': '## 为什么用 Markdown？',
  '기호가 글자로 남음 → AI 가 구조를 바로 읽음': '符号以文字保留 → AI 直接读懂结构',
  '제목을 만들려면?': '想做一个标题，该怎么办？',
  '줄 맨 앞에 # 을 치고 한 칸 띄운다': '在行首敲 #，再空一格',
  '글자 크기를 키운다': '把字号调大',
  '맞아. 기호를 글자로 적는 거야.': '对。就是把符号写成文字。',
  '글자 크기는 파일에 글자로 남지 않아서 AI 가 못 읽어. 다시 골라 봐.': '字号不会以文字留在文件里，所以 AI 读不到。再选一次吧。',
  '노트를 링크로 잇기': '用链接把笔记连起来',
  '이번 시간엔 노트 두 개를 링크로 이어 보고, 노트들이 어떻게 이어져 있는지 한눈에 보여 주는 그래프 뷰를 열어 볼 거야.': '这节课我们用链接把两篇笔记连起来，再打开关系图谱，一眼看清笔记之间是怎么连在一起的。',
  '노트는 하나하나 따로 있는 파일이지만, 서로 이어 줄 수 있어.||노트 안에 다른 노트 이름을 대괄호 두 겹으로 감싸서 `[[노트 이름]]` 이라고 쓰면, 그 노트로 가는 **링크**가 생겨.||노트와 노트를 잇는 고리라서, 앞으로 링크를 **연결고리**라고도 부를게.': '每篇笔记都是单独的文件，但它们之间可以连起来。||在笔记里用两层方括号把另一篇笔记的名字包起来，写成 `[[笔记名]]`，就会生成一个通往那篇笔记的**链接**。||链接就像把笔记和笔记串在一起的线，后面我们会经常用到它。',
  '고양이': '猫',
  '츄르': '猫条',
  '[[츄르]] 라고 쓰면 연결고리가 생긴다': '写下 [[猫条]] 就有了链接',
  '## 링크': '## 链接',
  '**링크** — `[[노트 이름]]` (= 연결고리)': '**链接** — `[[笔记名]]`（把笔记串起来的线）',
  '고양이는 츄르를 좋아한다.\n': '猫喜欢猫条。\n',
  '고양이가 좋아하는 간식.\n': '猫爱吃的零食。\n',
  '연습 폴더에 "고양이" 노트와 "츄르" 노트를 만들고, "고양이" 노트를 열어 뒀어.||고양이 노트에 츄르 얘기가 나오지? 그러니까 두 노트를 이어 보자.': '我在练习文件夹里建了“猫”和“猫条”两篇笔记，并打开了“猫”这篇。||猫的笔记里提到了猫条吧？那我们就把这两篇笔记连起来。',
  '고양이 노트 아래에 새 줄을 만들고 `[[츄르]]` 라고 써 봐.||대괄호 `[` 는 키보드에서 P 오른쪽에 있어. 두 번 누르면 노트 목록이 뜨는데, 거기서 "츄르"를 클릭해도 되고 이름을 끝까지 쳐도 돼.': '在猫笔记下方新起一行，写 `[[猫条]]`。||方括号 `[` 在键盘上 P 的右边（记得切换成英文输入）。连按两次会弹出笔记列表，可以直接点“猫条”，也可以把名字完整敲出来。',
  '`[` 두 번 → 노트 목록이 뜸 (`[` = P 오른쪽)': '连按两次 `[` → 弹出笔记列表（`[` 在 P 的右边）',
  '고양이 노트 아래쪽에 `[[츄르]]`. 이름을 대괄호 두 개로 감싸면 돼.': '在猫笔记下方写 `[[猫条]]`。用两层方括号把名字包起来就行。',
  '관련: [[츄르]]\n': '相关：[[猫条]]\n',
  '연결됐다! `[[츄르]]` 가 색이 다른 글자로 바뀌었지?||그 글자를 클릭하면 츄르 노트가 열려. 지금은 안 눌러도 돼.': '连上了！`[[猫条]]` 变成另一种颜色的文字了吧？||点这几个字就会打开猫条笔记。现在先不用点。',
  '링크 글자 클릭 → 그 노트가 열림': '点链接文字 → 打开那篇笔记',
  '이렇게 이어진 노트들을 그림 한 장으로 보여 주는 화면이 있어. **그래프 뷰**야.||노트 하나가 점 하나, 링크 하나가 선 하나로 그려져.': '有一个界面，能把这些连起来的笔记画成一张图，叫**关系图谱**。||一篇笔记是一个点，一个链接是一条线。',
  '## 그래프 뷰': '## 关系图谱',
  '점 = 노트, 선 = 링크': '点 = 笔记，线 = 链接',
  '그래프 뷰는 맨 왼쪽 세로 아이콘 줄에서 열어. 어떤 아이콘인지 가리켜 줄게.': '关系图谱要从最左边那列竖着的图标栏打开。我来指给你看是哪个图标。',
  '**여는 곳** — 맨 왼쪽 아이콘 줄 (동그라미 + 선 아이콘)': '**打开位置** — 最左边的图标栏（圆圈 + 线条的图标）',
  '그래프 뷰': '关系图谱',
  '이 아이콘이야. 동그라미 몇 개가 선으로 이어진 모양이지? 마우스를 올리면 "그래프 뷰 열기"라고 떠.||이번엔 내가 눌러 줄게.': '就是这个图标。几个小圆圈用线连在一起，对吧？鼠标移上去会显示“查看关系图谱”。||这次我替你点。',
  '맨 왼쪽 아이콘 줄에서 동그라미들이 선으로 이어진 아이콘을 눌러 봐.': '在最左边的图标栏里，点那个几个圆圈用线连起来的图标。',
  '가운데에 그래프 뷰가 새 탭으로 열렸어.||"고양이"랑 "츄르" 점 사이에 선이 보이지? 방금 만든 링크야. 점이 작아서 이름이 안 보이면 마우스 휠을 굴려서 확대해 봐.||다른 점들은 볼트에 있는 다른 노트들이야. 어디에도 이어지지 않은 노트는 점만 혼자 떠 있어.': '关系图谱以新标签页在中间打开了。||“猫”和“猫条”两个点之间有一条线吧？那就是刚才建的链接。点太小看不清名字的话，滚动鼠标滚轮放大看看。||其他的点是仓库里的其他笔记。没有和任何笔记相连的笔记，就只是一个孤零零的点。',
  '지금은 네가 직접 이었지만, 위키를 만들면 이 링크를 AI 가 대신 걸어 줘.||노트가 쌓일수록 이 그림에 선이 점점 많아질 거야.||그래프 뷰는 다 봤으면 위쪽 탭의 X 를 눌러 닫으면 돼.': '现在是你亲手连的，等做出维基以后，这些链接会由 AI 替你连。||笔记越积越多，这张图上的线也会越来越多。||关系图谱看完了，点上方标签页上的 X 就能关掉。',
  '노트 두 개를 이으려면?': '要把两篇笔记连起来，该怎么做？',
  '[[이을 노트 이름]] 을 쓴다': '写 [[要连的笔记名]]',
  '두 노트를 같은 폴더에 넣는다': '把两篇笔记放进同一个文件夹',
  '맞아. 링크로 잇는 거야.': '对。就是用链接连起来。',
  '같은 폴더에 있어도 서로 이어지진 않아. 그래프 뷰에 선이 생기는 건 [[ ]] 링크뿐이야. 다시 골라 봐.': '放在同一个文件夹里，它们也不会连起来。在关系图谱里能生成线的，只有 [[ ]] 链接。再选一次吧。',
  '같은 폴더 ≠ 연결. 잇는 건 `[[ ]]` 뿐': '同一文件夹 ≠ 连接。能连起来的只有 `[[ ]]`',
  '왜 옵시디언에 만들까': '为什么要建在 Obsidian 里',
  '기초 코스 마지막 시간이야. AI 위키를 왜 하필 옵시디언에 만드는지 정리하고, 다음 코스에서 만들 폴더 구조를 미리 볼 거야.': '这是基础课程的最后一节。我们来理一理，为什么偏偏要在 Obsidian 里建 AI 维基，再提前看看下一门课程要建的文件夹结构。',
  '기초는 여기까지야. 지금까지 배운 걸로, AI 위키를 왜 옵시디언에 만드는지 정리해 보자.': '基础就到这里。用目前学到的东西，来总结一下为什么要在 Obsidian 里建 AI 维基。',
  '이유 세 가지': '三个理由',
  '1. **노트가 전부 평범한 파일**이라 AI 가 직접 읽고 쓸 수 있어. (A2)\n2. **링크와 그래프 뷰**가 있어서 AI 가 이어 준 연결을 눈으로 확인할 수 있어. (A4)\n3. **파일이 사용자 컴퓨터에 있어서** 어떤 폴더를 AI 에게 보여 줄지 사용자가 정해. 옵시디언이 AI 에 접속하는 게 아니라, 사용자가 허락한 폴더를 **AI 가 읽으러 오는 거야.**': '1. **笔记全都是普通文件**，所以 AI 能直接读写。（A2）\n2. **有链接和关系图谱**，AI 帮你建的连接，你能亲眼看到。（A4）\n3. **文件在你的电脑上**，所以给 AI 看哪个文件夹由你决定。不是 Obsidian 去连接 AI，而是 **AI 来读你允许的文件夹。**',
  '## 옵시디언에 만드는 이유': '## 在 Obsidian 里建的理由',
  '1. 평범한 파일 → AI 가 읽고 씀': '1. 普通文件 → AI 能读写',
  '2. 링크 · 그래프 뷰 → 연결이 눈에 보임': '2. 链接 · 关系图谱 → 连接看得见',
  '3. 사용자 컴퓨터 → AI 에게 보여 줄 폴더는 **사용자**가 정함': '3. 你的电脑 → 给 AI 看哪个文件夹由**你**决定',
  '다음 코스(B)에선 연습 폴더 안에 위키 구조를 만들어. 어떻게 생겼는지 먼저 보여 줄게.': '下一门课程（B）会在练习文件夹里建维基结构。先给你看看它长什么样。',
  '연습 폴더 안에 이렇게 세 가지를 만들 거야.||1. raw 폴더: 사용자가 AI 에게 줄 글을 넣는 곳. A1 에서 정한 재료(raw 폴더 속 파일)가 여기 들어가.||2. wiki 폴더: AI 가 재료(raw 폴더 속 파일)를 정리한 노트가 쌓이는 곳.||3. AGENTS.md: AI 에게 어떻게 정리하라고 알려 주는 규칙 파일.||자세한 건 다음 시간에 하나씩 만들면서 볼게.': '练习文件夹里会建这三样东西。||1. raw 文件夹：放你要交给 AI 的文字。A1 里说好的食材（raw 文件夹里的文件）就放在这里。||2. wiki 文件夹：AI 把食材（raw 文件夹里的文件）整理成笔记，都存在这里。||3. AGENTS.md：告诉 AI 该怎么整理的规则文件。||具体的，下节课我们边建边看。',
  '사용자가 재료를 넣는 곳': '你放食材的地方',
  'AI 가 정리한 노트': 'AI 整理好的笔记',
  'AI 에게 주는 규칙': '给 AI 的规则',
  '다음 코스에서 만든다': '下一门课程里建',
  '## 다음 코스 구조': '## 下一门课程的结构',
  'raw 폴더 · wiki 폴더 · AGENTS.md': 'raw 文件夹 · wiki 文件夹 · AGENTS.md',
  '옵시디언과 AI 는 어떻게 연결될까?': 'Obsidian 和 AI 是怎么连起来的？',
  '사용자가 허락한 폴더를 AI 가 읽으러 온다': 'AI 来读你允许的文件夹',
  '옵시디언이 AI 에 접속한다': 'Obsidian 去连接 AI',
  '맞아. 어느 폴더를 보여 줄지는 사용자가 정해.': '对。给 AI 看哪个文件夹，由你决定。',
  '옵시디언은 폴더를 열어 보여 주는 앱일 뿐이고, AI 와 따로 연결돼 있지 않아. 다시 골라 봐.': 'Obsidian 只是一个打开并显示文件夹的应用，并没有另外和 AI 连在一起。再选一次吧。',
  // ── 코스 B ──
  '위키를 이루는 세 가지': '构成维基的三样东西',
  'LLM Wiki 코스 첫 시간이야. 위키를 이루는 세 가지(raw 폴더 · wiki 폴더 · AGENTS.md)가 각각 뭘 하는지 알아보고, 연습 폴더 안에 직접 만들어 볼 거야.': '这是 LLM 维基课程的第一节课。我们来看看构成维基的三样东西（raw 文件夹 · wiki 文件夹 · AGENTS.md）各自是干什么的，然后在练习文件夹里亲手建出来。',
  '이제 진짜 위키를 만들어 보자.||생각보다 간단해. 폴더 두 개랑 파일 하나면 돼.': '现在来做一个真正的维基吧。||比你想的简单。两个文件夹加一个文件就够了。',
  'raw · wiki · AGENTS.md': 'raw · wiki · AGENTS.md',
  '1. **raw 폴더**: 사용자가 재료(raw 폴더 속 파일)를 넣는 곳. 메모, 저장한 기사, 회의 기록 같은 걸 여기 넣어. raw 는 "가공하기 전"이라는 뜻이야. 그러니까 **AI 는 raw 폴더 속 파일은 절대 건드리지 않아.** 읽기만 해.\n\n2. **wiki 폴더**: wiki 폴더는 **AI 만 수정할 수 있어.** raw 폴더에 사용자가 넣어 둔 재료(raw 폴더 속 파일)에서 여러 인사이트를 뽑아 AI 가 wiki 폴더에 정리하는 거야. 요약, 개념 정리, 목차가 여기 생겨.\n\n3. **AGENTS.md**: AI 에게 주는 규칙 파일. "재료(raw 폴더 속 파일)를 이렇게 정리해 줘"라는 설명서야. AI 는 일을 시작하기 전에 이 파일부터 읽어.\n\nLLM Wiki 는 이 세 가지가 전부야.': '1. **raw 文件夹**：你放食材（raw 文件夹里的文件）的地方。笔记、收藏的文章、会议记录之类的都放这里。raw 的意思是“未加工的”。所以 **AI 绝不会动 raw 文件夹里的文件**。只会读。\n\n2. **wiki 文件夹**：wiki 文件夹**只有 AI 能修改**。AI 从你放进 raw 文件夹的食材（raw 文件夹里的文件）里提炼出各种见解，整理到 wiki 文件夹里。摘要、概念整理、目录都会出现在这里。\n\n3. **AGENTS.md**：给 AI 的规则文件，是一份“请这样整理食材（raw 文件夹里的文件）”的说明书。AI 开始干活前会先读这个文件。\n\nLLM 维基就这三样，没别的了。',
  '사용자가 재료를 넣는 곳': '你放食材的地方',
  'AI 만 고치는 노트': '只有 AI 修改的笔记',
  'AI 에게 주는 규칙': '给 AI 的规则',
  '이 세 가지가 LLM Wiki 의 전부': 'LLM 维基就这三样',
  '만들어 보자': '动手做吧',
  '## 위키를 이루는 세 가지': '## 构成维基的三样东西',
  '1. **raw 폴더** — 사용자가 재료를 넣는 곳. AI 는 읽기만': '1. **raw 文件夹** — 你放食材的地方。AI 只读',
  '2. **wiki 폴더** — AI 만 고치는 노트': '2. **wiki 文件夹** — 只有 AI 修改的笔记',
  '3. **AGENTS.md** — AI 규칙 파일 (AI 가 먼저 읽음)': '3. **AGENTS.md** — AI 规则文件（AI 先读它）',
  '만들기 전에 궁금한 거 있어?': '动手之前，有什么想问的吗？',
  'AI 는 왜 raw 폴더를 안 고쳐?': 'AI 为什么不改 raw 文件夹？',
  'AI 가 재료(raw 폴더 속 파일)를 고치면, 나중에 wiki 노트의 내용이 원래 어디서 왔는지 확인할 수 없게 돼.\n\nraw 폴더 속 파일은 원본 기록이야. 재료에 틀린 내용이 있어도 AI 는 그대로 두고, "이 글은 틀렸다"는 판단은 wiki 노트 쪽에 기록해.\n\n재료(raw 폴더 속 파일)는 사용자 것이니까, 사용자가 직접 고치거나 지우는 건 괜찮아. 고치지 않는 건 AI 의 규칙이야.': '如果 AI 改了食材（raw 文件夹里的文件），以后就没法确认 wiki 笔记里的内容原本是从哪儿来的。\n\nraw 文件夹里的文件是原始记录。就算食材里有错的内容，AI 也会原样保留，把“这篇写错了”的判断记在 wiki 笔记那边。\n\n食材（raw 文件夹里的文件）是你的，你自己改或删都没问题。不改它，是 AI 的规则。',
  'AGENTS.md 는 꼭 이 이름이어야 해?': 'AGENTS.md 一定要叫这个名字吗？',
  '꼭 그렇진 않아. 요즘 AI 도구들이 폴더에서 이 이름의 파일을 먼저 찾아 읽는 경우가 많아서 이 이름을 쓰는 거야. 클로드 코드는 CLAUDE.md 라는 이름을 찾기도 해.\n\n이름보다 중요한 건 AI 에게 일을 시킬 때 "이 파일부터 읽어"라고 말해 주는 거야. 수업 끝나고 혼자 할 때도 매번 그렇게 하게 될 거야.': '不一定。现在很多 AI 工具会先在文件夹里找这个名字的文件来读，所以才用它。Claude Code 有时也会找叫 CLAUDE.md 的文件。\n\n比名字更重要的是，让 AI 干活时告诉它“先读这个文件”。课程结束后你自己用的时候，每次也都会这么做。',
  '원래 있던 노트는 괜찮아?': '我原来的笔记没事吧？',
  '응, 안 건드려. 이번에 만드는 건 전부 연습 폴더 안에 생겨.\n\n나중에 실제로 쓸 땐 이 연습 폴더를 그대로 키워도 되고, 다른 폴더에 같은 구조를 새로 만들어도 돼.': '没事，不会动它们。这次建的东西全都在练习文件夹里。\n\n以后真正用的时候，可以直接把这个练习文件夹慢慢养大，也可以在别的文件夹里重新搭一套同样的结构。',
  '이제 만들게. 세 가지에 더해서 몇 개를 같이 만들 거야.||raw 폴더 안엔 **README.md**, wiki 폴더 안엔 **index.md** 와 **log.md** 를 넣을 거야.||**README.md** 는 "이 폴더가 뭐 하는 곳인지" 알려 주는 안내 파일이야. raw 폴더를 열면 AI 가 가장 처음 읽게 되는 파일이라서, 관례대로 README(읽어 주세요)라는 이름을 붙여.||index.md 와 log.md 는 조금 뒤에 설명할게.': '现在开始建了。除了这三样，还会顺手多建几个。||raw 文件夹里放 **README.md**，wiki 文件夹里放 **index.md** 和 **log.md**。||**README.md** 是告诉别人“这个文件夹是干什么的”的说明文件。打开 raw 文件夹时 AI 最先读的就是它，所以按惯例取名 README（请读我）。||index.md 和 log.md 等一下再讲。',
  '## 같이 만드는 파일': '## 一起建的文件',
  '**README.md** — raw 폴더 안내. AI 가 가장 처음 읽음': '**README.md** — raw 文件夹说明。AI 最先读',
  '만들기 전에 뭘 만들지 보여 주는 창이 뜰 거야.||"raw > README.md" 는 raw 폴더 안에 README.md 파일이 생긴다는 뜻이야. 목록을 확인하고 괜찮으면 "만들기" 버튼을 눌러 줘.': '建之前会弹出一个窗口，告诉你要建哪些东西。||“raw > README.md” 的意思是在 raw 文件夹里建一个 README.md 文件。看一下列表，没问题就点“创建”按钮。',
  '창에서 "만들기"를 눌러야 폴더가 생겨.': '要在窗口里点“创建”，文件夹才会建好。',
  'raw 폴더': 'raw 文件夹',
  '여기가 **raw 폴더**야. 사용자가 AI 에게 줄 글은 전부 여기에 넣어. 이 파일들이 재료(raw 폴더 속 파일)야.||지금은 안내 파일 README.md 하나만 들어 있어.': '这里就是 **raw 文件夹**。你要给 AI 的文字全都放这里。这些文件就是食材（raw 文件夹里的文件）。||现在里面只有一个说明文件 README.md。',
  'wiki 폴더': 'wiki 文件夹',
  '여기가 **wiki 폴더**. AI 가 정리한 노트가 여기 쌓이고, AI 만 고쳐.||폴더 이름 왼쪽 화살표를 눌러 펼쳐 보면 지금은 index.md 랑 log.md 두 개만 있을 거야.': '这里是 **wiki 文件夹**。AI 整理好的笔记会堆在这里，而且只有 AI 修改。||点文件夹名左边的箭头展开看看，现在应该只有 index.md 和 log.md 两个。',
  '**index.md** 는 wiki 에 어떤 노트가 있는지 한 줄씩 기록해 둔 **목차**야.||**log.md** 는 AI 가 언제 무슨 작업을 했는지 한 줄씩 남기는 **작업 기록**이야. 둘 다 AI 가 알아서 고쳐.': '**index.md** 是**目录**，一行一条记下 wiki 里有哪些笔记。||**log.md** 是**工作记录**，一行一条记下 AI 什么时候做了什么。这两个都由 AI 自己更新。',
  '**index.md** — 목차': '**index.md** — 目录',
  '**log.md** — 작업 기록 (둘 다 AI 가 갱신)': '**log.md** — 工作记录（两个都由 AI 更新）',
  'AGENTS.md': 'AGENTS.md',
  '그리고 이게 **AGENTS.md**, 규칙 파일이야.||파일 탐색기에서 AGENTS.md 를 클릭해서 열어 봐. AI 가 할 일이 다 기록돼 있어.': '还有这个就是 **AGENTS.md**，规则文件。||在文件列表里点 AGENTS.md 打开看看。AI 要做的事全都写在里面。',
  '왼쪽 파일 탐색기의 연습 폴더 안에서 AGENTS.md 를 클릭해 봐.': '在左边文件列表的练习文件夹里点一下 AGENTS.md。',
  '천천히 읽어 봐. 어려운 말은 없을 거야.||ingest, query, lint 같은 영어 단어가 나오는데, 다음 레슨부터 하나씩 직접 해 볼 거라 지금은 몰라도 돼.||나중에 AI 가 일하는 방식을 바꾸고 싶으면 이 파일만 고치면 돼. 그것도 뒤에서 해 볼 거야.': '慢慢读。里面没有难懂的话。||会看到 ingest、query、lint 这些英文词，下一课开始会一个个亲手试，现在不懂也没关系。||以后想改变 AI 的工作方式，只要改这个文件就行。这个后面也会试。',
  'AI 일하는 방식 바꾸기 → AGENTS.md 만 고치기': '改变 AI 工作方式 → 只改 AGENTS.md',
  'wiki 폴더의 노트는 누가 쓸까?': 'wiki 文件夹里的笔记由谁来写？',
  'AI 가 쓰고 사용자는 읽는다': 'AI 写，你来读',
  '사용자가 직접 쓴다': '你自己写',
  '맞아. 사용자는 재료(raw 폴더 속 파일)를 넣고, 정리는 AI 가 해.': '对。你负责放食材（raw 文件夹里的文件），整理交给 AI。',
  'wiki 폴더는 AI 만 고치는 곳이야. 사람이 정리까지 하면 금방 지쳐. 다시 골라 봐.': 'wiki 文件夹是只有 AI 修改的地方。要是人连整理也自己做，很快就会累垮。再选一次。',
  '첫 재료 넣기': '放进第一份食材',
  '이번 시간엔 raw 폴더에 첫 재료(raw 폴더 속 파일)를 넣어 볼 거야. AI 가 raw 폴더를 어떻게 다루는지도 알아볼게.': '这节课我们往 raw 文件夹里放第一份食材（raw 文件夹里的文件），也看看 AI 是怎么对待 raw 文件夹的。',
  'raw 폴더엔 아직 안내 파일 README.md 뿐이니까 재료(raw 폴더 속 파일)부터 넣자.||연습용으로 내가 글 하나를 준비해 왔어. "개인 위키가 뭔가"에 대한 짧은 글이야.': 'raw 文件夹里现在只有说明文件 README.md，先放食材（raw 文件夹里的文件）吧。||我准备了一篇练习用的文章，是讲“什么是个人维基”的短文。',
  'AI 가 raw 폴더를 다루는 규칙이 하나 있어. **AI 는 raw 폴더 속 파일을 읽기만 하고 절대 고치지 않아.**||그래서 파일 이름이 중요해. AI 가 이름을 바꿔 주지 않으니까, 처음 넣을 때 "문서1" 같은 이름 말고 내용을 알 수 있는 이름으로 넣어 줘.': 'AI 对待 raw 文件夹有一条规则：**AI 只读 raw 文件夹里的文件，绝不修改**。||所以文件名很重要。AI 不会帮你改名，所以第一次放进去时，别用“文档1”这种名字，要用一看就知道内容的名字。',
  '## AI 의 raw 규칙': '## AI 的 raw 规则',
  'AI 는 raw 폴더 속 파일을 **읽기만, 절대 안 고침**': 'AI 对 raw 文件夹里的文件**只读，绝不修改**',
  '파일 이름은 내용을 알 수 있게': '文件名要能看出内容',
  '이번에도 넣기 전에 확인 창이 뜰 거야. "만들기"를 눌러 줘.': '这次放进去之前也会弹出确认窗口。点“创建”就好。',
  '확인 창에서 "만들기"를 누르면 재료(raw 폴더 속 파일)가 들어가.': '在确认窗口里点“创建”，食材（raw 文件夹里的文件）就放进去了。',
  '재료 1': '食材 1',
  '들어갔다. raw 폴더를 펼쳐 보면 "01-개인 위키가 뭔가"가 있을 거야. 클릭해서 읽어 봐도 돼.||혼자 할 땐 메모 파일을 파일 탐색기에서 raw 폴더 위로 끌어다 놓거나, raw 폴더를 오른쪽 클릭해서 새 노트를 만들어 쓰면 돼.||웹에서 본 기사는 **Web Clipper** 라는 옵시디언 공식 브라우저 확장 프로그램으로 바로 저장할 수도 있어. 그건 필요할 때 찾아봐.': '放进去了。展开 raw 文件夹，会看到“01-什么是个人维基”。点开读读也行。||自己用的时候，把笔记文件从文件列表拖到 raw 文件夹上，或者右键 raw 文件夹新建笔记来写就行。||网上看到的文章，也可以用 Obsidian 官方的浏览器扩展 **Web Clipper** 直接保存。需要的时候再去找。',
  '## 재료 넣는 법': '## 放食材的方法',
  '끌어다 놓기 · 우클릭 → 새 노트 · Web Clipper': '拖进去 · 右键 → 新建笔记 · Web Clipper',
  'AI 는 raw 폴더 속 파일을 어떻게 다룰까?': 'AI 怎么对待 raw 文件夹里的文件？',
  '읽기만 하고 절대 고치지 않는다': '只读，绝不修改',
  '읽고 나서 알아서 고쳐 둔다': '读完自己顺手改好',
  '맞아. 재료(raw 폴더 속 파일)는 원본 그대로 두고, 정리한 내용은 wiki 폴더에 기록해.': '对。食材（raw 文件夹里的文件）保持原样，整理出来的内容记到 wiki 文件夹里。',
  'AI 가 재료(raw 폴더 속 파일)를 고치면 나중에 wiki 내용이 어디서 왔는지 확인할 수 없어. 다시 골라 봐.': '如果 AI 改了食材（raw 文件夹里的文件），以后就没法确认 wiki 的内容是从哪儿来的。再选一次。',
  '첫 요리 — ingest': '第一次烹饪 — ingest',
  '이번 시간엔 AI 가 재료(raw 폴더 속 파일)를 읽고 wiki 에 노트를 쓰는 작업, ingest 를 처음으로 볼 거야. 재료 한 편에서 노트가 몇 개 생기는지 직접 확인해 봐.': '这节课第一次来看 ingest：AI 读食材（raw 文件夹里的文件），在 wiki 里写笔记。亲眼看看一篇食材能生出几篇笔记。',
  'AI 가 raw 폴더 속 파일, 곧 재료를 읽고 wiki 폴더에 노트를 쓰는 작업을 **ingest** 라고 해. 원래 "받아들여서 소화한다"는 뜻이야.||재료(raw 폴더 속 파일)를 받아서 먹기 좋게 만드는 일이니까, 앞으로 이 작업을 **요리(ingest)**라고도 부를게. "요리한다"고 하면 ingest 한다는 뜻이야.': 'AI 读 raw 文件夹里的文件（也就是食材），在 wiki 文件夹里写笔记，这个工作叫 **ingest**，原意是“吸收消化”。||把食材（raw 文件夹里的文件）拿来做成好入口的东西，所以接下来我也把它叫作**烹饪（ingest）**。说“烹饪”，就是指 ingest。',
  '## 요리(ingest)': '## 烹饪（ingest）',
  'AI 가 재료를 읽고 wiki 에 노트 쓰기': 'AI 读食材，在 wiki 里写笔记',
  '재료(raw 폴더 속 파일) 한 편을 요리(ingest)하면 wiki 에 이런 게 생기거나 바뀌어.||1. 그 글을 요약한 노트 1개. wiki 안 **요약 폴더(sources)**에 들어가.||2. 글에 나온 중요한 개념마다 노트 1개씩. wiki 안 **개념 폴더(concepts)**에 들어가.||3. 목차(index.md)에 새 노트 이름이 추가되고, 작업 기록(log.md)에 한 줄이 붙어.': '烹饪（ingest）一篇食材（raw 文件夹里的文件），wiki 里会新增或改动这些东西。||1. 一篇总结这篇文章的笔记，放进 wiki 里的**摘要文件夹（sources）**。||2. 文中每个重要概念各一篇笔记，放进 wiki 里的**概念文件夹（concepts）**。||3. 目录（index.md）里加上新笔记的名字，工作记录（log.md）里多一行。',
  '재료 1편': '1 篇食材',
  '요약 1': '摘要 1',
  '개념 3': '概念 3',
  '목차': '目录',
  '작업 기록': '工作记录',
  '재료 하나로 노트 여러 개가 바뀐다': '一份食材，改动多篇笔记',
  '## 요리하면 생기는 것': '## 烹饪后会出现什么',
  '1. **요약 폴더(sources)** — 재료 하나에 요약 1개': '1. **摘要文件夹（sources）** — 一份食材一篇摘要',
  '2. **개념 폴더(concepts)** — 개념마다 노트 1개': '2. **概念文件夹（concepts）** — 每个概念一篇笔记',
  '3. index.md · log.md 갱신': '3. 更新 index.md · log.md',
  '이번엔 실제 AI 대신 내가 AI 가 ingest 명령어를 수행하는 과정을 재현해 볼게. 실제 AI 로 하는 건 마지막 레슨(B8)에서 해.||확인 창이 뜨면 "만들기"를 눌러 줘.': '这次不用真的 AI，由我来演示 AI 执行 ingest 指令的过程。用真的 AI 来做，在最后一课（B8）。||弹出确认窗口后点“创建”。',
  '확인 창에서 "만들기"를 눌러야 요리(ingest)가 시작돼.': '要在确认窗口里点“创建”，烹饪（ingest）才会开始。',
  '요약 폴더(sources)': '摘要文件夹（sources）',
  'wiki 폴더 안에 요약 폴더(sources)가 생겼지? 여기엔 재료(raw 폴더 속 파일)를 요약한 노트가 들어 있어. 재료 하나에 요약 하나야.': 'wiki 文件夹里多了个摘要文件夹（sources）吧？这里放的是总结食材（raw 文件夹里的文件）的笔记。一份食材一篇摘要。',
  '개념 폴더(concepts)': '概念文件夹（concepts）',
  '그 아래 개념 폴더(concepts)엔 개념 노트가 3개 생겼어. "개인 위키", "꺼내 쓰기", "매일 기록".||raw 폴더에 있는 글 재료들에서 중요한 개념들을 유목화해 정리해 둔 거야.': '下面的概念文件夹（concepts）里生成了 3 篇概念笔记：“个人维基”“拿出来用”“每日记录”。||这是把 raw 文件夹里那些文章食材中的重要概念分门别类整理出来的。',
  '목차(index.md)랑 작업 기록(log.md)도 바뀌었어. 궁금하면 열어 봐.||이렇게 재료(raw 폴더 속 파일) 하나를 요리(ingest)하면 wiki 노트 여러 개가 한꺼번에 바뀌어. 사람이 하면 귀찮아서 안 하게 되는 일(기록 유목화, 태그 붙이기, 인사이트 추출 등)을 AI 가 훨씬 정교하게 대신 하는 거야.': '目录（index.md）和工作记录（log.md）也变了，好奇就打开看看。||像这样烹饪（ingest）一份食材（raw 文件夹里的文件），好几篇 wiki 笔记会一起变。人自己做会嫌麻烦、最后干脆不做的事（给记录分类、打标签、提炼见解等），AI 会替你做得精细得多。',
  '재료 하나 → wiki 노트 여러 개가 한꺼번에 바뀜': '一份食材 → 多篇 wiki 笔记一起变',
  '요리(ingest) 보고 궁금한 거 있어?': '看完烹饪（ingest），有什么想问的吗？',
  '방금 건 진짜 AI 가 한 거야?': '刚才是真的 AI 做的吗？',
  '아니. AI 가 하는 과정을 내가 재현해서 보여 준 거야. 그래서 빠르고 돈도 안 들어.\n\n마지막 레슨(B8)에선 네가 쓰는 실제 AI 로 네 재료(raw 폴더 속 파일)를 요리(ingest)해 볼 거야. 그 전까지는 결과가 어떻게 생기는지 익히는 거야.': '不是。是我把 AI 的工作过程演示给你看的，所以又快又不花钱。\n\n最后一课（B8）你会用自己的真 AI 来烹饪（ingest）你的食材（raw 文件夹里的文件）。在那之前，先熟悉一下结果长什么样。',
  '요약 폴더(sources)랑 개념 폴더(concepts)는 뭐가 달라?': '摘要文件夹（sources）和概念文件夹（concepts）有什么不同？',
  '**요약 폴더(sources)** 엔 재료(raw 폴더 속 파일) 하나를 요약한 노트가 들어가. 재료 하나에 요약 하나.\n\n**개념 폴더(concepts)** 엔 개념 하나를 정리한 노트가 들어가. 여러 재료(raw 폴더 속 파일)에서 같은 개념이 나오면 같은 개념 노트에 내용이 계속 더해져. 그래서 재료가 쌓일수록 개념 노트가 점점 풍부해져.': '**摘要文件夹（sources）**里放的是总结一份食材（raw 文件夹里的文件）的笔记。一份食材一篇摘要。\n\n**概念文件夹（concepts）**里放的是整理一个概念的笔记。如果多份食材（raw 文件夹里的文件）里出现同一个概念，内容会不断加到同一篇概念笔记里。所以食材越多，概念笔记就越丰富。',
  '직접 쓴 메모도 재료(raw 폴더 속 파일)가 돼?': '我自己写的笔记也能当食材（raw 文件夹里的文件）吗？',
  '그럼. 오히려 제일 좋은 재료(raw 폴더 속 파일)야. 남이 쓴 글보다 "그때 무슨 생각을 했지"가 나중에 훨씬 쓸모 있어.\n\n옵시디언 사용법 기초 과정(A1)에서 만든 "오늘 알게 된 것" 노트도 raw 폴더에 넣으면 재료(raw 폴더 속 파일)가 돼. 마지막 레슨에서 그걸 요리(ingest)할 수도 있어.': '当然。那反而是最好的食材（raw 文件夹里的文件）。比起别人写的文章，“我当时在想什么”以后有用得多。\n\n在 Obsidian 基础课（A1）里写的“今天学到的”笔记，放进 raw 文件夹也会变成食材（raw 文件夹里的文件）。最后一课可以拿它来烹饪（ingest）。',
  'AI 가 쓴 노트 읽기': '读 AI 写的笔记',
  '이번 시간엔 AI 가 쓴 노트를 하나 열어서 어떻게 생겼는지 보고, wiki 노트는 왜 사용자가 직접 고치지 않는지 알아볼 거야.': '这节课打开一篇 AI 写的笔记，看看它长什么样，再聊聊为什么 wiki 笔记不由你亲手改。',
  'AI 가 쓴 노트를 하나 열어 보자.||wiki 폴더 안 개념 폴더(concepts)에서 "개인 위키" 노트를 클릭해 봐.': '打开一篇 AI 写的笔记看看。||在 wiki 文件夹的概念文件夹（concepts）里点“个人维基”笔记。',
  '개념 폴더(concepts) 안에': '在概念文件夹（concepts）里',
  'wiki 폴더와 그 안의 개념 폴더(concepts)를 펼치고 "개인 위키"를 클릭해 봐.': '展开 wiki 文件夹和里面的概念文件夹（concepts），点“个人维基”。',
  '네가 쓴 노트는 아니지만, 네 raw 폴더의 재료로 AI 가 만든 노트야. 위에서부터 같이 보자.||**한 줄** 칸엔 이 개념을 한 문장으로 요약해 뒀어.||**재료** 칸엔 이 내용이 raw 폴더의 어느 파일에서 왔는지 기록돼 있어. 원본을 확인하고 싶을 때 보면 돼.||**내용** 칸 중간에 색이 다른 글자들은 다른 wiki 노트로 가는 링크(연결고리)야. 노트끼리 잇는 연결고리를 AI 가 걸어 둔 거야.': '这不是你写的笔记，但它是 AI 用你 raw 文件夹里的食材做出来的。从上往下一起看。||**一句话**栏用一句话概括了这个概念。||**食材**栏记着这些内容来自 raw 文件夹里的哪个文件。想核对原文时看这里。||**内容**栏中间颜色不同的字，是通往其他 wiki 笔记的链接。笔记之间的链接是 AI 加上的。',
  '## AI 노트 구조': '## AI 笔记的结构',
  '**한 줄** — 한 문장 요약': '**一句话** — 一句话概括',
  '**재료** — 어느 raw 파일에서 왔는지': '**食材** — 来自哪个 raw 文件',
  '**내용** — 정리 + 링크(연결고리)': '**内容** — 整理 + 链接',
  'wiki 는 읽고, raw 에 쓴다': 'wiki 用来读，raw 用来写',
  'wiki 노트를 사용자가 직접 고치면, 다음에 AI 가 요리(ingest)할 때 같은 노트를 다시 쓰면서 사용자가 고친 부분이 사라질 수 있어. 그래서 wiki 폴더는 AI 만 고쳐.\n\n고칠 게 보이면 파일을 직접 고치지 말고 **AI 에게 말해.** 예를 들어 "개인 위키 노트에서 ○○ 부분 고쳐 줘" 하고.\n\n사용자의 생각을 덧붙이고 싶으면 raw 폴더에 새 재료(raw 폴더 속 파일)로 기록해 넣으면 돼. 그러면 다음에 요리(ingest)할 때 AI 가 반영해.': '如果你亲手改了 wiki 笔记，下次 AI 烹饪（ingest）时会重写同一篇笔记，你改的部分可能就没了。所以 wiki 文件夹只有 AI 修改。\n\n看到要改的地方，别直接改文件，**告诉 AI**。比如：“把个人维基笔记里○○那部分改一下。”\n\n想补充自己的想法，就在 raw 文件夹里记成一份新食材（raw 文件夹里的文件）放进去。下次烹饪（ingest）时 AI 会把它吸收进去。',
  '알았어': '知道了',
  '## 고칠 게 보이면': '## 看到要改的地方',
  'wiki 직접 수정 ✕ → **AI 에게 고쳐 달라고**': '直接改 wiki ✕ → **请 AI 来改**',
  '사용자 생각은 raw 폴더에 새 재료로': '你的想法记成新食材，放进 raw 文件夹',
  'wiki 노트에서 틀린 내용을 발견하면?': '在 wiki 笔记里发现错误怎么办？',
  'AI 에게 고쳐 달라고 한다': '请 AI 来改',
  '사용자가 바로 고친다': '自己马上改',
  '맞아. 그래야 다음에 요리(ingest)할 때도 고친 내용이 남아.': '对。这样下次烹饪（ingest）时，改过的内容也还在。',
  '직접 고치면 다음 요리(ingest) 때 AI 가 덮어쓸 수 있어. 다시 골라 봐.': '直接改的话，下次烹饪（ingest）时可能被 AI 覆盖。再选一次。',
  '재료가 늘면 연결고리도 는다': '食材越多，链接越多',
  '이번 시간엔 그래프 뷰로 지금 위키를 보고, 재료(raw 폴더 속 파일)를 하나 더 요리(ingest)한 다음 연결고리가 어떻게 늘어나는지 비교해 볼 거야. 목차(index.md)가 왜 중요한지도 알아볼게.': '这节课先用关系图谱看看现在的维基，再烹饪（ingest）一份食材（raw 文件夹里的文件），比较一下链接是怎么变多的。也会讲讲目录（index.md）为什么重要。',
  '먼저 지금 위키가 어떻게 이어져 있는지 그래프 뷰로 보자.||그래프 뷰에선 점 하나가 노트 하나, 선 하나가 링크(연결고리) 하나야.||그래프 뷰는 맨 왼쪽 아이콘 줄에 있는 이 아이콘으로 열어.': '先用关系图谱看看现在的维基是怎么连起来的。||在关系图谱里，一个点是一篇笔记，一条线是一个链接。||关系图谱用最左边功能区（图标栏）里的这个图标打开。',
  '## 그래프 뷰로 보기': '## 用关系图谱看',
  '점 = 노트, 선 = 링크(연결고리)': '点 = 笔记，线 = 链接',
  '그래프 뷰': '关系图谱',
  '여기. 동그라미 몇 개가 선으로 이어진 아이콘이야. 이번엔 내가 눌러 줄게.': '就这里。几个圆圈用线连起来的图标。这次我帮你点。',
  '맨 왼쪽 아이콘 줄에서 동그라미들이 선으로 이어진 아이콘을 눌러 봐.': '在最左边的功能区（图标栏）里，点那个几个圆圈用线连起来的图标。',
  '점이 몇 개 있고 선도 몇 개 있지? 아직은 단출해.||그래프 뷰는 볼트 전체를 보여 줘서, raw · wiki 말고 다른 노트도 같이 보여. 옵시디언 사용법 기초 과정(A4)에서 만든 고양이, 츄르 노트가 선으로 이어져 있는 것도 보일 거야.||이제 재료(raw 폴더 속 파일)를 하나 더 넣고 요리(ingest)한 다음, 어떻게 바뀌는지 보자.': '有几个点，也有几条线吧？现在还挺简单。||关系图谱显示的是整个仓库，所以除了 raw · wiki，别的笔记也会一起显示。你应该还能看到 Obsidian 基础课（A4）里建的“猫”和“猫条”笔记用线连在一起。||现在再放一份食材（raw 文件夹里的文件）进去烹饪（ingest），看看会怎么变。',
  '이번 재료(raw 폴더 속 파일)는 "왜 다들 실패하나"라는 글이야.||확인 창이 두 번 뜰 거야. 한 번은 재료(raw 폴더 속 파일) 넣기, 한 번은 요리(ingest). 둘 다 "만들기"를 눌러 줘.': '这次的食材（raw 文件夹里的文件）是一篇叫“为什么大家都失败”的文章。||确认窗口会弹两次。一次是放食材（raw 文件夹里的文件），一次是烹饪（ingest）。两次都点“创建”。',
  '확인 창에서 "만들기"를 눌러 줘.': '在确认窗口里点“创建”。',
  '점도 선도 늘었지?||새 재료(raw 폴더 속 파일)에서 개념 노트가 2개 더 생겼고, 원래 있던 "개인 위키" 노트에도 새 내용과 링크가 더해졌어. 새 재료가 옛 노트까지 고쳐 준 거야.||재료(raw 폴더 속 파일)가 쌓일수록 노트끼리 더 촘촘하게 이어지고, 그래서 나중에 물어봤을 때 답도 좋아져.': '点和线都变多了吧？||新食材（raw 文件夹里的文件）多生成了 2 篇概念笔记，原来的“个人维基”笔记也加上了新内容和链接。新食材连旧笔记都帮你更新了。||食材（raw 文件夹里的文件）越积越多，笔记之间就连得越紧密，以后提问时回答也会更好。',
  '재료 넣기': '放食材',
  '요리(ingest)': '烹饪（ingest）',
  '연결고리가 늘어남': '链接变多',
  '다음 답이 좋아짐': '下次回答更好',
  '## 재료가 쌓이면': '## 食材积累起来',
  '새 재료가 옛 노트도 고침': '新食材也会更新旧笔记',
  '재료 ↑ → 연결고리 ↑ → 답 품질 ↑': '食材 ↑ → 链接 ↑ → 回答质量 ↑',
  '채팅에 파일 올리기와 뭐가 달라?': '和在聊天里上传文件有什么不同？',
  'AI 채팅에 파일을 올려서 물어보면, AI 는 질문할 때마다 원래 글을 처음부터 다시 읽고 답을 만들어. 대화가 끝나면 AI 가 정리한 건 아무 데도 남지 않아.\n\nLLM Wiki 에선 AI 가 정리한 결과를 wiki 폴더에 노트로 남겨 둬. 새 재료(raw 폴더 속 파일)가 들어오면 그 노트에 더하고 고쳐. 방금 본 것처럼 재료가 쌓일수록 위키가 점점 좋아지는 거야.\n\n카파시가 이 방법을 제안한 핵심 이유가 이거야. **정리한 결과가 쌓인다.**': '在 AI 聊天里上传文件提问，AI 每次都要从头重读原文再生成回答。对话一结束，AI 整理过的东西哪儿也留不下。\n\n在 LLM 维基里，AI 整理的结果会作为笔记留在 wiki 文件夹里。有新食材（raw 文件夹里的文件）进来，就在这些笔记上补充、修改。就像刚才看到的，食材越多，维基越好。\n\n这正是卡帕西提出这个方法的核心原因：**整理的结果会积累下来。**',
  '채팅에 파일 올리기 ✕ 남는 것 없음 → 위키는 정리 결과가 **쌓인다**': '在聊天里上传文件 ✕ 什么也留不下 → 维基会把整理结果**积累下来**',
  '목차 (index.md)': '目录（index.md）',
  'wiki 에 어떤 노트가 있는지 한 줄씩 기록해 둔 목록이야. AI 가 요리(ingest)할 때마다 새 노트를 여기에 추가해.\n\n나중에 AI 에게 뭘 물어보면, AI 는 **이 목차부터 읽고** 관련 있는 노트만 골라서 열어 봐. 그래서 노트가 수백 개가 돼도 전부 읽지 않고 답을 찾을 수 있어.\n\nwiki 폴더의 index.md 를 열어 보면 지금까지 생긴 노트가 정리돼 있을 거야.': '这是一行一条记下 wiki 里有哪些笔记的列表。AI 每次烹饪（ingest）都会把新笔记加进来。\n\n以后你问 AI 问题，AI 会**先读这个目录**，只挑相关的笔记打开看。所以就算笔记有几百篇，也不用全读一遍就能找到答案。\n\n打开 wiki 文件夹里的 index.md，会看到目前为止生成的笔记都整理在里面。',
  '## 목차(index.md)': '## 目录（index.md）',
  'AI 가 질문을 받으면 **제일 먼저 읽음**': 'AI 收到问题时**最先读它**',
  '물어보기 — query': '提问 — query',
  '이번 시간엔 위키에 쌓인 내용을 꺼내 쓰는 법을 배워. 질문을 골라서 출처가 달린 답을 받아 보고, 좋은 답은 위키에 저장해 볼 거야.': '这节课学怎么把维基里积累的内容拿出来用。选一个问题，拿到带出处的回答，再把好的回答存进维基。',
  '위키에서 뭔가를 꺼내 쓰는 걸 **query** 라고 해. 우리말로는 그냥 **물어보기**야.||특별한 명령어는 없어. AI 채팅창에 평소처럼 말로 물어보면 돼.': '从维基里拿东西出来用，叫 **query**，说白了就是**提问**。||没有什么特别的指令。在 AI 聊天框里像平时一样用话问就行。',
  '## 물어보기(query)': '## 提问（query）',
  'AI 채팅창에 말로 질문': '在 AI 聊天框里用话提问',
  '물어보면 AI 는 이 순서로 답해.||1. 먼저 목차(index.md)를 보고,||2. 질문과 관련된 노트를 열어 읽은 다음,||3. 답 끝에 **어느 노트를 보고 답했는지(출처)**를 달아.||출처가 있으니까, 답이 맞는지 원래 노트를 열어서 확인할 수 있어.': '你一问，AI 会按这个顺序回答。||1. 先看目录（index.md），||2. 打开并读和问题相关的笔记，||3. 在回答末尾注明**参考了哪些笔记（出处）**。||有出处，你就可以打开原笔记，核对答案对不对。',
  '1. 목차(index.md) 보기': '1. 看目录（index.md）',
  '2. 관련 노트 읽기': '2. 读相关笔记',
  '3. **출처** 달아 답하기': '3. 附上**出处**回答',
  '지금은 연습이라 질문 세 개에 대한 답을 raw 폴더의 재료를 바탕으로 미리 기록해 뒀어. 하나씩 눌러 보고, 다 봤으면 "넘어가기" 버튼을 눌러 줘.||마음에 드는 답이 있으면 "위키에 저장"도 눌러 봐.': '现在是练习，所以我已经根据 raw 文件夹里的食材，提前写好了三个问题的回答。一个个点开看，看完就点“下一步”按钮。||有喜欢的回答，也可以点“保存到维基”。',
  '저장한 답은 wiki 폴더 안 답변 폴더(answers)에 들어가.||좋은 답을 이렇게 위키에 다시 넣어 두면, 다음에 물어볼 때 AI 가 그 답까지 같이 읽어. 쓸수록 위키가 좋아지는 이유야.||실제로 할 땐 AI 한테 "이 답 위키에 저장해 줘"라고 말하면 돼.': '保存的回答会放进 wiki 文件夹里的回答文件夹（answers）。||像这样把好回答放回维基，下次提问时 AI 会连这些回答一起读。这就是维基越用越好的原因。||实际用的时候，跟 AI 说“把这个回答存进维基”就行。',
  '좋은 답 → **답변 폴더(answers)** 에 저장 → 다음 답이 좋아짐': '好回答 → 存进**回答文件夹（answers）** → 下次回答更好',
  '잘 물어보는 요령': '提问的小窍门',
  '1. **어디를 보라고 말해 줘.** 예: "raw 폴더에 있는 지난주 기록을 읽고"\n2. **답의 모양을 정해 줘.** 예: "표로 정리해 줘", "체크리스트로 만들어 줘"\n3. **"기록에 없으면 없다고 말해 줘"를 붙여.** 이 한 줄이 있으면 AI 가 없는 내용을 지어내는 걸 막을 수 있어.': '1. **告诉它看哪里**。例：“读 raw 文件夹里上周的记录”\n2. **定好回答的样子**。例：“整理成表格”“做成清单”\n3. **加上“记录里没有就说没有”**。有这一句，就能防止 AI 编造不存在的内容。',
  '## 잘 물어보는 요령': '## 提问的小窍门',
  '1) 어디를 볼지 말하기': '1) 说清楚看哪里',
  '2) 답 모양 정하기': '2) 定好回答的样子',
  '3) "기록에 없으면 없다고"': '3) “记录里没有就说没有”',
  '위키 청소 — lint': '维基清理 — lint',
  '이번 시간엔 재료(raw 폴더 속 파일)를 하나 더 요리(ingest)한 다음, 노트가 쌓이면 생기는 문제를 AI 가 찾아서 고치는 작업(lint)을 볼 거야.': '这节课再烹饪（ingest）一份食材（raw 文件夹里的文件），然后看看笔记多了以后出现的问题，AI 是怎么找出来并修好的（lint）。',
  '재료(raw 폴더 속 파일)를 하나 더 넣고 요리(ingest)해 보자. 이번 건 "AI 한테 시키는 법"에 대한 글이야.||이번에도 확인 창이 두 번 뜰 거야. 재료(raw 폴더 속 파일) 넣기 한 번, 요리(ingest) 한 번. 둘 다 "만들기"를 눌러 줘.': '再放一份食材（raw 文件夹里的文件）进去烹饪（ingest）吧。这次是一篇讲“怎么让 AI 来做”的文章。||这次确认窗口也会弹两次。放食材（raw 文件夹里的文件）一次，烹饪（ingest）一次。两次都点“创建”。',
  '재료(raw 폴더 속 파일)가 쌓이면 꼭 생기는 문제가 세 가지 있어.||1. 글마다 말이 달라. 한 글은 "하루 세 줄", 다른 글은 "하루 한 줄" 하는 식으로. 새 재료(raw 폴더 속 파일)와 안 맞게 낡아 버린 내용도 생겨.||2. 다른 노트 어디에서도 링크되지 않은 노트가 생겨. 이런 노트를 **고아 노트**라고 해.||3. 여러 노트에서 말은 나오는데, 정작 그 개념을 설명하는 노트는 없어.': '食材（raw 文件夹里的文件）多了，一定会出现三种问题。||1. 每篇说法不一样。比如一篇说“每天三行”，另一篇说“每天一行”。也会有跟新食材（raw 文件夹里的文件）对不上、已经过时的内容。||2. 出现没有被任何其他笔记链接的笔记。这种笔记叫**孤立笔记**。||3. 好几篇笔记都提到某个词，却没有一篇专门解释这个概念的笔记。',
  '## 쌓이면 생기는 문제': '## 积累后会出现的问题',
  '1. 어긋난 말 · 낡은 내용': '1. 说法冲突 · 内容过时',
  '2. **고아 노트** — 아무도 링크 안 함': '2. **孤立笔记** — 没人链接它',
  '3. 빠진 개념 노트': '3. 缺少的概念笔记',
  '이런 걸 찾아서 고치는 작업을 **lint** 라고 해. 원래는 프로그램 코드에서 실수를 찾아 주는 도구 이름이야.||앞으로 이 작업을 **위키 청소(lint)**라고 부를게.||이걸로 AI 가 하는 일 세 가지가 다 나왔어. 1. 요리(ingest) 2. 물어보기(query) 3. 위키 청소(lint).': '找出并修好这些问题的工作叫 **lint**。它原本是一种帮你找出程序代码错误的工具的名字。||以后我把这个工作叫作**维基清理（lint）**。||这样 AI 要做的三件事就都出场了：1. 烹饪（ingest） 2. 提问（query） 3. 维基清理（lint）。',
  'ingest · 요리': 'ingest · 烹饪',
  'query · 물어보기': 'query · 提问',
  'lint · 위키 청소': 'lint · 维基清理',
  '## 위키 청소(lint)': '## 维基清理（lint）',
  '위 문제를 찾아 고치기': '找出并修好上面的问题',
  '**AI 의 일 세 가지** — ingest · query · lint': '**AI 的三件事** — ingest · query · lint',
  '지금 위키를 청소해 볼게. 결과가 뜨면 읽어 보고 "고쳐 줘"를 눌러 줘.': '现在来清理一下维基。结果出来后读一读，然后点“帮我修好”。',
  '청소는 매일 할 필요 없어. 노트가 꽤 쌓였다 싶을 때 한 번씩 하면 돼.||청소할 때 AI 가 "이런 재료(raw 폴더 속 파일)를 더 넣어 보면 좋겠다", "이런 걸 물어보면 좋겠다" 하고 추천해 주기도 해.': '清理不用天天做。觉得笔记攒得差不多了，偶尔做一次就行。||清理时，AI 有时还会推荐：“再放点这类食材（raw 文件夹里的文件）会更好”“可以问问这类问题”。',
  '**주기** — 노트가 꽤 쌓였을 때 가끔': '**频率** — 笔记攒得差不多时偶尔做',
  '위키 청소(lint)가 찾는 건?': '维基清理（lint）要找的是？',
  '어긋난 말 · 고아 노트 · 빠진 개념 노트': '说法冲突 · 孤立笔记 · 缺少的概念笔记',
  '맞춤법 틀린 곳': '错别字',
  '맞아. 노트끼리 말이 맞고 잘 이어지게 하는 거야.': '对。就是让笔记之间说法一致、连接顺畅。',
  '맞춤법은 상관없어. 노트끼리 내용이 맞는지, 잘 이어져 있는지를 봐. 다시 골라 봐.': '错别字不归它管。它看的是笔记之间内容是否一致、连接是否顺畅。再选一次。',
  '규칙 바꾸기 — AGENTS.md': '改规则 — AGENTS.md',
  '이번 시간엔 규칙 파일(AGENTS.md)에 규칙 한 줄을 더해서 개념 노트의 정리 형식을 바꿔 볼 거야. 그 한 줄 때문에 wiki 노트가 한꺼번에 바뀌는 걸 보게 될 거야. AI 가 일하는 방식을 사용자가 정하는 방법이야.': '这节课往规则文件（AGENTS.md）里加一行规则，改变概念笔记的整理格式。你会看到就因为这一行，wiki 笔记一下子全变了。这就是由你来决定 AI 工作方式的办法。',
  '마지막으로 배울 건 AI 가 일하는 방식을 바꾸는 방법이야.||방법은 간단해. 규칙 파일 AGENTS.md 에 원하는 규칙을 한 줄 기록하면 돼.': '最后要学的是怎么改变 AI 的工作方式。||方法很简单。在规则文件 AGENTS.md 里写上一行你想要的规则就行。',
  '## 규칙 바꾸기': '## 改规则',
  'AI 일하는 방식 바꾸기 → **AGENTS.md 에 규칙 한 줄**': '改变 AI 工作方式 → **在 AGENTS.md 里加一行规则**',
  '이런 상황이라고 해 보자. 개념 폴더(concepts)의 노트를 읽어 보니 한 줄 요약만으로는 감이 잘 안 와. 그래서 개념 노트를 정리하는 형식을 바꾸고 싶어.||그럴 땐 노트를 하나하나 고쳐 달라고 하지 말고, AGENTS.md 에 이 규칙을 더하면 돼. "개념 노트마다 **예시** 칸을 두고, 일상에서 볼 수 있는 예시를 하나 적는다."||확인 창이 두 번 뜰 거야. 규칙 더하기 한 번, 다시 요리(ingest) 한 번. 둘 다 "만들기"를 눌러 줘.': '假设是这种情况：读了概念文件夹（concepts）里的笔记，光看一句话概括还是不太明白。所以你想改一下概念笔记的整理格式。||这时别让 AI 一篇篇去改笔记，在 AGENTS.md 里加上这条规则就行：“每篇概念笔记都设一个**例子**栏，写一个日常生活中能见到的例子。”||确认窗口会弹两次。加规则一次，重新烹饪（ingest）一次。两次都点“创建”。',
  '예: 개념 노트에 **예시** 칸을 두는 규칙': '例：让概念笔记设一个**例子**栏的规则',
  'AGENTS.md 에 한 줄 더했을 뿐인데 개념 노트가 전부 바뀌었지? 개념 폴더(concepts)의 노트를 아무거나 열어서 맨 아래 **예시** 칸을 봐.||노트를 하나하나 고칠 필요 없이, 규칙만 바꾸고 다시 요리(ingest)하면 돼.||AI 가 원하는 대로 안 해 줄 때도 매번 말로 부탁하기보다 규칙 파일에 기록해 두는 게 좋아. 규칙 파일은 쓰면서 조금씩 다듬어 가는 거야.': '只在 AGENTS.md 里加了一行，概念笔记就全变了吧？随便打开概念文件夹（concepts）里的一篇笔记，看看最下面的**例子**栏。||不用一篇篇改笔记，只要改规则、重新烹饪（ingest）就行。||AI 没按你想的做时，与其每次用嘴说，不如记在规则文件里。规则文件是边用边慢慢打磨的。',
  '규칙 한 줄 추가': '加一行规则',
  '다시 요리': '重新烹饪',
  '노트가 전부 바뀜': '笔记全部更新',
  '규칙 바꾸고 다시 요리 → 노트 전부 반영': '改规则再烹饪 → 所有笔记都更新',
  '매번 말로 부탁 ✕ → 규칙 파일에 기록': '每次口头拜托 ✕ → 记进规则文件',
  'AI 가 노트 쓰는 방식을 바꾸고 싶으면?': '想改变 AI 写笔记的方式，怎么做？',
  'AGENTS.md 에 규칙을 적는다': '在 AGENTS.md 里写规则',
  '노트를 하나씩 직접 고친다': '自己一篇篇改笔记',
  '맞아. 규칙 한 줄이 모든 노트에 적용돼.': '对。一行规则会用到所有笔记上。',
  'wiki 노트는 AI 만 고치는 거고, 하나씩 고치다 보면 금방 지쳐. 다시 골라 봐.': 'wiki 笔记只由 AI 修改，而且一篇篇改很快就会累垮。再选一次。',
  '수료 — 네 재료를 실제 AI 로': '结业 — 用真的 AI 烹饪你的食材',
  '마지막 시간이야. 지금까지는 내가 재현해서 보여 준 결과를 봤는데, 이번엔 네가 평소 쓰는 AI 로 네 재료(raw 폴더 속 파일) 하나를 직접 요리(ingest)해 볼 거야. 끝나면 수료야.': '最后一节课了。到现在为止看的都是我演示出来的结果，这次你要用平时用的 AI，亲手烹饪（ingest）一份你自己的食材（raw 文件夹里的文件）。做完就结业。',
  '지금까지 본 요리(ingest)는 전부 내가 재현해서 보여 준 거였어.||이번엔 네가 평소에 쓰는 **실제 AI** 로 직접 해 보자.': '到现在为止看到的烹饪（ingest），全都是我演示给你看的。||这次用你平时用的**真 AI** 亲手做一次吧。',
  '재료 하나': '一份食材',
  'AI 에게 요리(ingest) 부탁': '请 AI 烹饪（ingest）',
  '첫 노트가 생긴다': '第一篇笔记诞生',
  '매일 세 줄 · 일주일에 한 번 요리': '每天三行 · 每周烹饪一次',
  '## 실제 AI 로 요리': '## 用真的 AI 烹饪',
  '클로드 앱에 폴더 연결 / 복사 · 붙여넣기': '在 Claude 应用里连接文件夹 / 复制 · 粘贴',
  '재료 하나 넣기': '放一份食材',
  'raw 폴더에 **네 글 하나**를 넣어 줘. 이게 네 첫 재료(raw 폴더 속 파일)야. 방법은 편한 걸로 골라.\n\n1. 볼트에 있는 네 노트 하나를 파일 탐색기에서 raw 폴더 위로 끌어다 놓기 (원래 있던 자리에선 옮겨져). 옵시디언 사용법 기초 과정(A1)에서 만든 "오늘 알게 된 것" 노트도 좋아.\n2. raw 폴더를 오른쪽 클릭해서 새 노트를 만들고, 오늘 있었던 일 세 줄 기록하기\n3. Web Clipper 로 기사 하나 저장하기\n\n고르기 어려우면 그냥 기다려. 조금 있다가 내가 연습용 재료(raw 폴더 속 파일)를 대신 넣어 줄지 물어볼게.': '往 raw 文件夹里放**一篇你自己的文字**。这就是你的第一份食材（raw 文件夹里的文件）。方法挑顺手的。\n\n1. 从文件列表里把仓库中你的一篇笔记拖到 raw 文件夹上（会从原来的位置移过来）。在 Obsidian 基础课（A1）里写的“今天学到的”笔记也不错。\n2. 右键 raw 文件夹新建一篇笔记，用三行记下今天发生的事\n3. 用 Web Clipper 保存一篇文章\n\n实在挑不出来就等一下。过一会儿我会问你要不要我替你放一份练习用的食材（raw 文件夹里的文件）。',
  '먼저 raw 폴더에 사용자 글 하나 넣기': '先往 raw 文件夹里放一篇你自己的文字',
  '**AI 에게** — "AGENTS.md 읽고 raw 의 새 재료 ingest 해 줘"': '**对 AI 说** — “读 AGENTS.md，然后 ingest raw 里的新食材”',
  '노트 하나를 파일 탐색기에서 이 raw 폴더 위로 끌어다 놓으면 돼.': '从文件列表里把一篇笔记拖到这个 raw 文件夹上就行。',
  '# 내 첫 재료\n\n- 위키 정리는 AI 한테 맡기면 된다\n- 저장만 하면 잊는다\n- 매일 세 줄이면 된다\n': '# 我的第一份食材\n\n- 维基整理交给 AI 就行\n- 只存下来就会忘\n- 每天三行就够了\n',
  'AI 가 다 쓰면 wiki 폴더에 새 노트가 생겨. 아직이면 AI 창을 한번 확인해 봐.': 'AI 写完后，wiki 文件夹里会出现新笔记。还没出现的话，去 AI 窗口看一眼。',
  '네 재료(raw 폴더 속 파일)로, 네 AI 가 만든 첫 노트가 생겼어. 수료 축하해!': '用你的食材（raw 文件夹里的文件），由你的 AI 做出的第一篇笔记诞生了。恭喜结业！',
  '앞으로 할 일': '接下来要做的事',
  '1. **매일 세 줄**: raw 폴더에 오늘 한 일, 알게 된 것, 메모. 형식은 상관없어.\n2. **일주일에 한 번 요리(ingest)**: 요일을 정해 둬. "생각날 때 하지" 하면 잘 안 하게 돼.\n3. **처음엔 재료를 하나씩**: 재료(raw 폴더 속 파일)를 한꺼번에 몰아넣지 말고, 하나 요리할 때마다 AI 가 쓴 노트를 훑어봐. 마음에 안 들면 AGENTS.md 에 규칙을 더하면 돼.\n4. **이번 달 안에 한 번 꺼내 쓰기**: 한 주 정리를 부탁하든, "그때 왜 그렇게 했더라"를 물어보든. 한 번 해 보면 왜 기록하는지 실감이 나.': '1. **每天三行**：往 raw 文件夹里写今天做了什么、学到了什么、随手笔记。格式无所谓。\n2. **每周烹饪（ingest）一次**：定好星期几。“想起来再做”的话，往往就不会做了。\n3. **一开始一次一份食材**：别把食材（raw 文件夹里的文件）一股脑全塞进去，每烹饪一份就扫一眼 AI 写的笔记。不满意就在 AGENTS.md 里加规则。\n4. **这个月内拿出来用一次**：不管是请它整理一周，还是问“我那时为什么那么做来着”。试过一次，你就会真切体会到为什么要记录。',
  '## 앞으로 할 일': '## 接下来要做的事',
  '1. 매일 세 줄': '1. 每天三行',
  '2. 일주일에 한 번 요리(ingest)': '2. 每周烹饪（ingest）一次',
  '3. 처음엔 재료를 하나씩': '3. 一开始一次一份食材',
  '4. 한 달에 한 번 꺼내 쓰기': '4. 每月拿出来用一次',
  '다음에 쓸 도구': '接下来用的工具',
  '이 연습 폴더를 그대로 계속 써도 되고, 더 본격적인 도구로 옮겨 가도 돼.\n\n1. **Karpathy LLM Wiki 플러그인**: 옵시디언 설정의 커뮤니티 플러그인에서 설치할 수 있어. 위키 폴더를 이 연습 폴더의 `wiki` 로 지정하면 지금까지 만든 노트에 이어서 쓸 수 있어.\n2. **클로드 데스크톱 앱**: 볼트 폴더를 연결해 두면 "ingest 해 줘" 한마디로 요리(ingest)할 수 있어.\n\n나는 화면 아래에 계속 있을게. 가끔 "오늘 세 줄 기록했어?" 하고 물어볼 거야.': '这个练习文件夹可以一直接着用，也可以换到更正式的工具。\n\n1. **Karpathy LLM Wiki 插件**：可以在 Obsidian 设置的第三方插件里安装。把维基文件夹指定为这个练习文件夹的 `wiki`，就能接着目前做好的笔记继续写。\n2. **Claude 桌面应用**：连上仓库文件夹后，一句“ingest 一下”就能烹饪（ingest）。\n\n我会一直待在屏幕下方。偶尔会问你：“今天的三行记了吗？”',
  '고마워': '谢谢',
  '## 다음 도구': '## 接下来的工具',
  'Karpathy LLM Wiki 플러그인 · 클로드 데스크톱 앱': 'Karpathy LLM Wiki 插件 · Claude 桌面应用',
  '마지막으로 하나만. 지금까지는 "매일 세 줄"이라고 했지만, 세 줄은 습관을 만드는 시작일 뿐이야.||매일 기록하는 내용의 질이 높을수록, 그리고 "왜 그렇게 했는지", "그때 무슨 생각이었는지" 같은 맥락이 많이 기록될수록 AI 가 만들어 주는 위키도 훨씬 풍성해져.||세 줄로 시작해서, 익숙해지면 조금씩 더 자세히 기록해 봐. 네 위키는 네가 남긴 기록만큼 자라.': '最后再说一句。到现在一直说“每天三行”，但三行只是养成习惯的开始。||每天记录的质量越高，“为什么那么做”“当时在想什么”这类背景记得越多，AI 帮你做出的维基也会丰富得多。||从三行开始，习惯了就慢慢记得更详细些。你的维基，会随着你留下的记录一起长大。',
  '## 위키를 키우는 법': '## 让维基长大的方法',
  '세 줄은 시작일 뿐': '三行只是开始',
  '기록의 질 ↑ · 맥락(왜, 무슨 생각) ↑ → 위키가 **풍성해짐**': '记录质量 ↑ · 背景（为什么、在想什么）↑ → 维基**更丰富**',
};

};

__defs["core/practice"] = function (module, exports, require) {
// 연습 폴더. 수업의 모든 쓰기는 이 폴더 안에서만 일어나고, 레슨마다 만든 것을 기억해 두었다가 되돌릴 수 있다.
// 경로의 'practice:' 접두사는 연습 폴더 루트로 바뀐다 ('practice:' = 루트, 'practice:raw/x.md' = 루트/raw/x.md).
'use strict';

const DEFAULT_ROOT = { ko: '내 위키 연습', en: 'My Wiki Practice', zh: '我的维基练习' };

class Practice {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  root() {
    const s = this.plugin.settings;
    return (s.practiceFolder || DEFAULT_ROOT[s.language] || DEFAULT_ROOT.ko).replace(/\/+$/, '');
  }

  // 경로. { ko, en } 꼴이면 지금 언어 것을 고른다 (엔진을 거치지 않고 바로 올 때도 있다 — waitFor 의 fallback 쓰기)
  resolve(p) {
    if (p && typeof p === 'object') {
      const lang = this.plugin.settings.language;
      p = p[lang] != null ? p[lang] : p.ko;
    }
    if (typeof p !== 'string') return p;
    if (!p.startsWith('practice:')) return p;
    const rest = p.slice(9).replace(/^\/+/, '').replace(/\/+$/, '');
    return rest ? `${this.root()}/${rest}` : this.root();
  }

  inside(path) {
    const r = this.root();
    return path === r || path.startsWith(r + '/');
  }

  snapshot(lessonId) {
    const st = this.plugin.state;
    st.snapshots = st.snapshots || {};
    const s = (st.snapshots[lessonId] = st.snapshots[lessonId] || { created: [], appended: [], replaced: [] });
    s.replaced = s.replaced || [];
    return s;
  }

  // 미리보기용: 이 쓰기가 만들 것 { path, content, op }
  // label 은 연습 폴더 안 자리를 "raw > README.md" 처럼 (폴더 > 파일) 보여 준다
  describe(w, text) {
    const path = this.resolve(w.path);
    const r = this.root();
    const rel = path === r ? path : path.startsWith(r + '/') ? path.slice(r.length + 1) : path;
    return { op: w.op, path, label: rel.split('/').join(' > '), content: w.content ? text(w.content) : '' };
  }

  async ensureFolder(path) {
    const { vault } = this.app;
    const parts = path.split('/');
    let cur = '';
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!vault.getAbstractFileByPath(cur)) await vault.createFolder(cur);
    }
  }

  // 쓰기 하나를 적용한다. w = { op: 'folder' | 'note' | 'append' | 'move', path, to?, content?, open? }
  async apply(w, lessonId, text) {
    const { vault, workspace } = this.app;
    const path = this.resolve(w.path);
    if (!this.inside(path)) throw new Error('practice: write outside practice folder ' + path);
    const snap = this.snapshot(lessonId);
    const exists = () => vault.getAbstractFileByPath(path);
    switch (w.op) {
      case 'folder': {
        if (!exists()) {
          await this.ensureFolder(path);
          snap.created.push(path);
        }
        return path;
      }
      case 'note': {
        let f = exists();
        if (!f) {
          const dir = path.split('/').slice(0, -1).join('/');
          if (dir) await this.ensureFolder(dir);
          f = await vault.create(path, w.content ? text(w.content) : '');
          snap.created.push(path);
        }
        if (w.open) await workspace.getLeaf(false).openFile(f, { active: true });
        return path;
      }
      // 만들거나 덮어쓴다 (체험 모드 ingest 가 같은 쪽을 다시 쓴다). 덮어쓴 건 이전 내용을 기억해 되돌린다
      case 'put': {
        const f = exists();
        const t = w.content ? text(w.content) : '';
        if (!f) {
          const dir = path.split('/').slice(0, -1).join('/');
          if (dir) await this.ensureFolder(dir);
          await vault.create(path, t);
          snap.created.push(path);
        } else if (!Array.isArray(f.children)) {
          const prev = await vault.read(f);
          if (prev !== t) {
            await vault.modify(f, t);
            snap.replaced.push({ path, prev });
          }
        }
        return path;
      }
      case 'append': {
        const f = exists();
        if (!f || Array.isArray(f.children)) throw new Error('practice: no note to append ' + path);
        const t = w.content ? text(w.content) : '';
        await vault.append(f, t);
        snap.appended.push({ path, text: t });
        return path;
      }
      case 'move': {
        const f = exists();
        const to = this.resolve(w.to);
        if (!f || !this.inside(to)) throw new Error('practice: bad move ' + path + ' → ' + to);
        const dir = to.split('/').slice(0, -1).join('/');
        if (dir) await this.ensureFolder(dir);
        await this.app.fileManager.renameFile(f, to);
        snap.created.push(to);
        return to;
      }
      default:
        throw new Error('practice: unknown op ' + w.op);
    }
  }

  // 연습 폴더를 통째로 비운다 (휴지통으로). "노트까지 초기화"
  async wipe() {
    const { vault } = this.app;
    const root = vault.getAbstractFileByPath(this.root());
    if (!root) return 0;
    const files = vault.getAllLoadedFiles().filter((f) => this.inside(f.path) && f.path !== this.root());
    // 깊은 것부터 (파일 → 폴더)
    files.sort((a, b) => b.path.length - a.path.length);
    let n = 0;
    for (const f of files) {
      if (!vault.getAbstractFileByPath(f.path)) continue;
      await this.app.fileManager.trashFile(f);
      n++;
    }
    const again = vault.getAbstractFileByPath(this.root());
    if (again) {
      await this.app.fileManager.trashFile(again);
      n++;
    }
    this.plugin.state.snapshots = {};
    this.plugin.state.ingested = [];
    return n;
  }

  // 그 레슨이 만든 것을 지운다 (연습 폴더 안만). 덧붙인 글은 뒤에서부터 잘라 낸다
  async undo(lessonId) {
    const st = this.plugin.state;
    const snap = st.snapshots && st.snapshots[lessonId];
    if (!snap) return 0;
    const { vault } = this.app;
    let n = 0;
    for (const { path, text } of [...snap.appended].reverse()) {
      const f = vault.getAbstractFileByPath(path);
      if (!f || Array.isArray(f.children)) continue;
      const cur = await vault.read(f);
      if (cur.endsWith(text)) {
        await vault.modify(f, cur.slice(0, cur.length - text.length));
        n++;
      }
    }
    for (const { path, prev } of [...(snap.replaced || [])].reverse()) {
      const f = vault.getAbstractFileByPath(path);
      if (!f || Array.isArray(f.children)) continue;
      await vault.modify(f, prev);
      n++;
    }
    for (const path of [...snap.created].reverse()) {
      if (!this.inside(path)) continue;
      const f = vault.getAbstractFileByPath(path);
      if (!f) continue;
      await this.app.fileManager.trashFile(f);
      n++;
    }
    delete st.snapshots[lessonId];
    return n;
  }
}

module.exports = { Practice, DEFAULT_ROOT };

};

__defs["core/realmode"] = function (module, exports, require) {
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

};

__defs["core/replay"] = function (module, exports, require) {
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

};

__defs["core/samples/en"] = function (module, exports, require) {
// 체험 모드 샘플 (영어). 재료 글 3편과, 그걸 AGENTS.md 규칙대로 요리(ingest)한 결과를 미리 기록해 둔 것. ko.js 와 같은 모양.
// 단계(STAGES[n])마다 '그때까지 ingest 한 결과'를 통째로 둔다 (put = 만들거나 덮어씀, append = 덧붙임).
// B6 lint 용으로 1편(하루 세 줄)과 3편(하루 한 줄)의 말이 일부러 어긋나고, 3편에서 아무도 링크하지 않는 노트(Graph view)가 생긴다.
// wiki 노트는 AGENTS.md 규칙대로 "## In one line" · "## Ingredients" · "## Content" 칸으로 쓴다. B7 에서 규칙이 바뀌면 개념 노트에 "## Example" 칸이 붙는다.
'use strict';

const RAW = [
  {
    name: '01-What a personal wiki is.md',
    content: `# What a personal wiki is

A second brain that keeps what your head can't hold. You write it down outside, and get it back when you need it. That's a personal wiki.

The point is not "saving". The point is "getting it back". Saving alone is like stuffing receipts into a drawer. If you can't find it later, it doesn't exist.

So a personal wiki does two jobs.
1. Write down what comes in — what you learned today, what you felt, what you were given.
2. Link what you wrote — similar things, opposite things, things that follow on.

Three lines a day is enough. What you did, what you learned, a memo. Any format is fine.

If a person does the linking, they get tired fast. So these days we hand it to an AI.
`,
  },
  {
    name: '02-Why everyone fails.md',
    content: `# Why everyone fails

Most people who start a personal wiki quit within a month. There are three reasons.

First, they mistake collecting for knowing. 500 bookmarks, 2,000 screenshots. "Knowing about something" is not the same as "knowing it". This is called the collector's fallacy.

Second, they build the system first. Twelve folders, thirty tags, color rules. The bigger the system, the more you hesitate each time you add something. And the more you hesitate, the less you add.

Third, a person does the maintenance. Sorting, linking and summarizing pile up every day. You can keep it up for a week, but not for a month. What fails is not the format. It's the maintenance.

So do it the other way around. Keep the system tiny, add things any old way, and let something that isn't a person do the tidying.
`,
  },
  {
    name: '03-How to make the AI do it.md',
    content: `# How to make the AI do it

In spring 2026, AI researcher Andrej Karpathy posted an "LLM-maintained wiki" pattern, and many people copied it. The pattern is simple.

Split things into two folders. In raw, a person puts ingredients. In wiki, the AI writes organized notes. The AI only reads raw, and the person only reads wiki.

There are three operations. ingest reads new ingredients and updates the wiki. query reads the wiki and answers with sources. lint looks for contradictions and gaps.

The rules are written down in one file. The AI reads that file first, every time. To change the rules, you edit only that file.

Obsidian works for this because everything is just files. Open the Graph view and you can see the links the AI planted.

A person's job is one line a day. That's enough. The AI does everything else.
`,
  },
];

// 노트 경로는 Karpathy LLM Wiki 플러그인과 겹치게 wiki/sources · wiki/concepts 를 쓴다
const SUM1 = 'wiki/sources/01-What a personal wiki is.md';
const SUM2 = 'wiki/sources/02-Why everyone fails.md';
const SUM3 = 'wiki/sources/03-How to make the AI do it.md';
const C_SB = 'wiki/concepts/Personal wiki.md';
const C_RET = 'wiki/concepts/Getting it back.md';
const C_DAILY = 'wiki/concepts/Daily log.md';
const C_COLL = "wiki/concepts/Collector's fallacy.md";
const C_MAINT = 'wiki/concepts/Maintenance.md';
const C_LLMW = 'wiki/concepts/LLM wiki.md';
const C_GRAPH = 'wiki/concepts/Graph view.md';
const C_INGEST = 'wiki/concepts/ingest.md';
const INDEX = 'wiki/index.md';
const LOG = 'wiki/log.md';
const R1 = 'raw/01-What a personal wiki is.md';
const R2 = 'raw/02-Why everyone fails.md';
const R3 = 'raw/03-How to make the AI do it.md';

const put = (path, content) => ({ op: 'put', path: 'practice:' + path, content });
const append = (path, content) => ({ op: 'append', path: 'practice:' + path, content });

// AGENTS.md 의 노트 형식: 제목 · 한 줄 · 재료 · 내용 (· 예시)
function page(title, line, raws, body, example) {
  let s = `# ${title}\n\n## In one line\n${line}\n\n## Ingredients\n${raws.map((r) => `- ${r}`).join('\n')}\n\n## Content\n${body.trim()}\n`;
  if (example) s += `\n## Example\n${example.trim()}\n`;
  return s;
}

// 개념 노트들. 단계마다 바뀌는 판을 따로 둔다
const N = {
  sb1: (ex) =>
    page(
      'Personal wiki',
      "A second brain: what your head can't hold, written down outside and taken back out when needed.",
      [R1],
      `It does two jobs.
1. Write down what comes in → [[Daily log]]
2. Link what you wrote → the part that tires people out

Saving is not the goal. [[Getting it back]] is the goal.`,
      ex
    ),
  sb2: (ex) =>
    page(
      'Personal wiki',
      "A second brain: what your head can't hold, written down outside and taken back out when needed.",
      [R1, R2],
      `It does two jobs.
1. Write down what comes in → [[Daily log]]
2. Link what you wrote → the part that tires people out = [[Maintenance]]

Saving is not the goal. [[Getting it back]] is the goal.

Why it fails: [[Collector's fallacy]] · a big system · [[Maintenance]] done by a person.`,
      ex
    ),
  ret: (ex) =>
    page(
      'Getting it back',
      'Finding what you wrote down again, at the moment you need it. The real goal of a personal wiki.',
      [R1],
      `- If you save it but can't find it, it's as good as gone (receipts in a drawer).
- To get things back, what you wrote has to be linked → [[Personal wiki]]`,
      ex
    ),
  daily1: () =>
    page(
      'Daily log',
      'Three lines a day — what you did · what you learned · a memo. Any format is fine.',
      [R1],
      `- The only way ingredients get into the [[Personal wiki]].
- Don't try to write well. Single words are fine.`
    ),
  daily3: () =>
    page(
      'Daily log',
      'The one thing a person does every day. One line a day is enough.',
      [R1, R3],
      `- The only way ingredients get into the [[Personal wiki]].
- Don't try to write well. Single words are fine.
- The AI does everything else → [[LLM wiki]]`
    ),
  dailyFix: (ex) =>
    page(
      'Daily log',
      'The one thing a person does every day. "A little, every day" is the point — three lines (article 1) or one line (article 3).',
      [R1, R3],
      `- The only way ingredients get into the [[Personal wiki]].
- Don't try to write well. Single words are fine.
- How many lines depends on the ingredient: three in article 1, one in article 3. Both agree on "a little, every day".
- The AI does everything else → [[LLM wiki]] · [[ingest]]`,
      ex
    ),
  coll: (ex) =>
    page(
      "Collector's fallacy",
      'Mistaking collecting for knowing. "Knowing about something" ≠ "knowing it".',
      [R2],
      `- Saving is so easy that saving itself feels like the reward.
- The first reason a [[Personal wiki]] fails. The second and third come down to [[Maintenance]].`,
      ex
    ),
  maint: (ex) =>
    page(
      'Maintenance',
      'Work that piles up every day, like sorting, linking and summarizing. A person can do it for a week, but not for a month.',
      [R2],
      `- Where a personal wiki really dies. It's not the format's fault.
- The fix: hand it to something that isn't a person → [[Personal wiki]]
- Named as a reason for failure, along with the [[Collector's fallacy]].`,
      ex
    ),
  llmw3: () =>
    page(
      'LLM wiki',
      'A personal wiki that an AI maintains. raw is for the person, wiki is for the AI, and the rules are one file.',
      [R3],
      `- Three operations: ingest (read ingredients, update the wiki) · query (answer with sources) · lint (find contradictions and gaps).
- The [[Maintenance]] problem of a [[Personal wiki]], handed over to an AI.
- Change the rules file and the results change.`
    ),
  llmwFix: (ex) =>
    page(
      'LLM wiki',
      'A personal wiki that an AI maintains. raw is for the person, wiki is for the AI, and the rules are one file.',
      [R3],
      `- Three operations: [[ingest]] (read ingredients, update the wiki) · query (answer with sources) · lint (find contradictions and gaps).
- The [[Maintenance]] problem of a [[Personal wiki]], handed over to an AI.
- Change the rules file and the results change.
- See how the links pile up in the [[Graph view]].`,
      ex
    ),
  graph: (ex) =>
    page(
      'Graph view',
      'The Obsidian screen that draws the links between notes as dots and lines. You can see the links the AI planted.',
      [R3],
      `- Spot hubs (notes with many links) and orphans (notes nothing links to) at a glance.`,
      ex
    ),
  ingest: (ex) =>
    page(
      'ingest',
      'The operation that reads new ingredients in raw and writes or updates the wiki. It means "to digest".',
      [R3],
      `- One ingredient touches many notes (a summary + several concepts + the contents + the work log).
- The first of the three [[LLM wiki]] operations. The person only keeps the [[Daily log]].`,
      ex
    ),
};

// ── 1편을 ingest 한 뒤 ──
const STAGE1 = [
  put(
    SUM1,
    page(
      'What a personal wiki is (summary)',
      'A second brain you write down outside your head and take back out. The point is getting it back, not saving.',
      [R1],
      `- A [[Personal wiki]] does two jobs: 1. write down 2. link.
- Saving alone is putting receipts in a drawer. Without [[Getting it back]], it doesn't exist.
- For the [[Daily log]], three lines a day is enough. Any format.
- Linking tires people out, so hand it to an AI.`
    )
  ),
  put(C_SB, N.sb1()),
  put(C_RET, N.ret()),
  put(C_DAILY, N.daily1()),
  put(INDEX, `# Contents (index.md)

One line for each note in the wiki. The AI updates it on every ingest, and reads it first when you ask a question.

## Summaries (sources)
- [[01-What a personal wiki is]] — a second brain you write down outside your head and take back out

## Concepts
- [[Personal wiki]] — write down + link. The goal is getting it back
- [[Getting it back]] — saved but can't find it = gone
- [[Daily log]] — three lines a day
`),
  append(LOG, `- ingest · ${R1} → 1 summary, 3 concepts (Personal wiki · Getting it back · Daily log), contents updated
`),
];

// ── 2편까지 ──
const STAGE2 = [
  put(
    SUM2,
    page(
      'Why everyone fails (summary)',
      'Most people quit within a month. Because they mistake collecting for knowing, build a big system, and do the maintenance by hand.',
      [R2],
      `- [[Collector's fallacy]]: 500 bookmarks is not knowing.
- The bigger the system, the more you hesitate each time you add something. The more you hesitate, the less you add.
- What fails is not the format. It's the [[Maintenance]].
- The other way around: a tiny system, add things any old way, let something that isn't a person tidy up → [[Personal wiki]]`
    )
  ),
  put(C_COLL, N.coll()),
  put(C_MAINT, N.maint()),
  put(C_SB, N.sb2()),
  put(INDEX, `# Contents (index.md)

One line for each note in the wiki. The AI updates it on every ingest, and reads it first when you ask a question.

## Summaries (sources)
- [[01-What a personal wiki is]] — a second brain you write down outside your head and take back out
- [[02-Why everyone fails]] — collecting mistaken for knowing, a big system, maintenance by hand

## Concepts
- [[Personal wiki]] — write down + link. The goal is getting it back
- [[Getting it back]] — saved but can't find it = gone
- [[Daily log]] — three lines a day
- [[Collector's fallacy]] — collecting ≠ knowing
- [[Maintenance]] — where a personal wiki really dies
`),
  append(LOG, `- ingest · ${R2} → 1 summary, 2 new concepts (Collector's fallacy · Maintenance), Personal wiki note updated, contents updated
`),
];

// ── 3편까지 (Daily log 가 1편과 어긋나고, Graph view 노트는 아무도 링크하지 않는다 → B6 lint 거리) ──
const STAGE3 = [
  put(
    SUM3,
    page(
      'How to make the AI do it (summary)',
      'Split into raw (the person adds) and wiki (the AI writes), and have the AI run three operations — ingest · query · lint — by a rules file.',
      [R3],
      `- In spring 2026, Andrej Karpathy's "LLM-maintained wiki" post spread widely → [[LLM wiki]]
- The AI only reads raw. The person only reads wiki.
- The rules go in one file. The AI reads that file first, every time.
- Why Obsidian: everything is just files.
- The person's job is the [[Daily log]], one line a day.`
    )
  ),
  put(C_LLMW, N.llmw3()),
  put(C_GRAPH, N.graph()),
  put(C_DAILY, N.daily3()),
  put(INDEX, `# Contents (index.md)

One line for each note in the wiki. The AI updates it on every ingest, and reads it first when you ask a question.

## Summaries (sources)
- [[01-What a personal wiki is]] — a second brain you write down outside your head and take back out
- [[02-Why everyone fails]] — collecting mistaken for knowing, a big system, maintenance by hand
- [[03-How to make the AI do it]] — split into raw/wiki, then ingest · query · lint

## Concepts
- [[Personal wiki]] — write down + link. The goal is getting it back
- [[Getting it back]] — saved but can't find it = gone
- [[Daily log]] — one line a day
- [[Collector's fallacy]] — collecting ≠ knowing
- [[Maintenance]] — where a personal wiki really dies
- [[LLM wiki]] — a personal wiki that an AI maintains
- [[Graph view]] — links as dots and lines
`),
  append(LOG, `- ingest · ${R3} → 1 summary, 2 new concepts (LLM wiki · Graph view), Daily log note updated, contents updated
`),
];

// ── B5 물어보기 ──
const QUERY = [
  {
    q: 'Why do personal wikis fail?',
    a: `There are three reasons.

1. **Mistaking collecting for knowing** — 500 bookmarks is not knowing ([[Collector's fallacy]]).
2. **A big system** — twelve folders, thirty tags. You hesitate every time you add something, and the more you hesitate, the less you add.
3. **Maintenance by hand** — sorting, linking and summarizing pile up every day. You can keep it up for a week, but not for a month ([[Maintenance]]).

So do it the other way around: a tiny system, add things any old way, and let the AI tidy up ([[LLM wiki]]).`,
    sources: [SUM2, C_COLL, C_MAINT],
    save: 'wiki/answers/Why personal wikis fail.md',
  },
  {
    q: 'What do I do every day?',
    a: `Just one thing: the [[Daily log]]. Write down what you did · what you learned · a memo, any way you like.

How many lines depends on the ingredient — article 1 says three lines, article 3 says one line. Both agree on "a little, every day". Everything else (sorting, linking, summarizing) is done by the AI ([[LLM wiki]]).`,
    sources: [C_DAILY, SUM1, SUM3],
    save: 'wiki/answers/What to do every day.md',
  },
  {
    q: 'What exactly do I have the AI do?',
    a: `Three things ([[LLM wiki]]).

1. **ingest** — when a new ingredient lands in raw, read it, write or update wiki notes, and update the contents (index) and the work log (log).
2. **query** — look at the contents first, read the related notes, and answer with sources. If there's nothing, say so.
3. **lint** — find contradictions, notes nothing links to, and notes that should exist but don't.

The rules live in one file, AGENTS.md, and the AI reads it first every time.`,
    sources: [SUM3, C_LLMW],
    save: 'wiki/answers/What the AI does.md',
  },
];

// ── B6 위키 청소 ──
const LINT = {
  findings: [
    { kind: 'contradiction', text: '**Contradiction** — [[Daily log]]: article 1 says "three lines a day", article 3 says "one line a day". Right now the note only records what article 3 says.', pages: [C_DAILY, SUM1, SUM3] },
    { kind: 'orphan', text: '**Orphan note** — apart from the contents, not a single link points to the [[Graph view]] note.', pages: [C_GRAPH] },
    { kind: 'missing', text: '**Missing concept** — three notes talk about ingest, but there is no concept note that explains ingest.', pages: [] },
  ],
  fix: [
    put(C_DAILY, N.dailyFix()),
    put(C_LLMW, N.llmwFix()),
    put(C_INGEST, N.ingest()),
    append(LOG, `- lint → 1 contradiction resolved (Daily log: three lines vs one line), 1 orphan linked (Graph view), 1 missing concept added (ingest)
`),
  ],
};

// ── B7 규칙 바꾸기: 사용자가 개념 노트의 정리 형식을 바꾸고 싶다 → 개념 노트마다 "## Example" 칸 ──
const SCHEMA = {
  rule: `
## Concept note format (added)

- Every concept note (\`wiki/concepts/\`) gets an \`## Example\` section under \`## Content\`. Write one everyday example in two or three sentences.
`,
  after: [
    put(C_SB, N.sb2('You hear an idea in a meeting and leave one line about it in raw that day. Three months later, when you plan something similar, the AI finds that line and brings it back. If it had stayed only in your memory, that idea would be gone.')),
    put(C_RET, N.ret("You want to go back to a place you loved on last year's trip, but you can't remember its name. Instead of digging through your photos for an hour, you ask the wiki \"Where was that place?\" and find it right away.")),
    put(C_DAILY, N.dailyFix('On the way home, you leave just one line: "Today\'s meeting: schedule pushed back two weeks. Reason: design review." You don\'t polish it. The AI tidies it up later.')),
    put(C_COLL, N.coll('You save 300 articles to "Read later" and feel proud. But when someone asks what you learned from them, you can\'t explain a single one.')),
    put(C_MAINT, N.maint('In the first week, you tagged every memo and picked a folder for each. From the third week, put-off memos piled up, and in the end you stopped tidying.')),
    put(C_LLMW, N.llmwFix('On the weekend, you drop this week\'s memos into raw and just say "ingest this". On Monday, you ask the tidy wiki "What did we decide last week?"')),
    put(C_GRAPH, N.graph('You open the Graph view and see lots of lines crowding into the "Daily log" dot. That means it\'s the central concept the wiki links to most often.')),
    put(C_INGEST, N.ingest('You drop one set of meeting notes into raw and run ingest. One summary note appears, and concept notes like "Schedule" and "Design review" get new content too.')),
    append(LOG, `- rules changed (Example section in concept notes) → re-ingest · "## Example" added to 8 concept notes
`),
  ],
};

module.exports = { RAW, STAGES: { 1: STAGE1, 2: STAGE2, 3: STAGE3 }, QUERY, LINT, SCHEMA, PATHS: { SUM1, SUM2, SUM3, C_DAILY, C_GRAPH, INDEX, LOG } };

};

__defs["core/samples/index"] = function (module, exports, require) {
'use strict';
const ko = require('./ko');
const en = require('./en');
const zh = require('./zh');

const SAMPLES = { ko, en, zh };
const samples = (lang) => SAMPLES[lang] || SAMPLES.ko;

module.exports = { SAMPLES, samples };

};

__defs["core/samples/ko"] = function (module, exports, require) {
// 체험 모드 샘플 (한국어). 재료 글 3편과, 그걸 AGENTS.md 규칙대로 요리(ingest)한 결과를 미리 기록해 둔 것.
// 단계(STAGES[n])마다 '그때까지 ingest 한 결과'를 통째로 둔다 (put = 만들거나 덮어씀, append = 덧붙임).
// B6 lint 용으로 1편(하루 세 줄)과 3편(하루 한 줄)의 말이 일부러 어긋나고, 3편에서 아무도 링크하지 않는 노트(그래프 뷰)가 생긴다.
// wiki 노트는 AGENTS.md 규칙대로 "## 한 줄" · "## 재료" · "## 내용" 칸으로 쓴다. B7 에서 규칙이 바뀌면 개념 노트에 "## 예시" 칸이 붙는다.
'use strict';

const RAW = [
  {
    name: '01-개인 위키가 뭔가.md',
    content: `# 개인 위키가 뭔가

머릿속에 다 넣지 못하는 것을 밖에 기록해 두고, 필요할 때 꺼내 쓰는 두 번째 머리. 그게 개인 위키다.

핵심은 "저장"이 아니라 "꺼내 쓰기"다. 저장만 하는 건 서랍에 영수증을 쑤셔 넣는 것과 같다. 나중에 찾을 수 없으면 없는 것이다.

그래서 개인 위키는 두 가지 일을 한다.
1. 들어온 것을 기록한다 — 오늘 알게 된 것, 느낀 것, 받은 자료.
2. 기록한 것끼리 잇는다 — 비슷한 것, 반대되는 것, 이어지는 것.

하루에 세 줄이면 충분하다. 한 일, 알게 된 것, 메모. 형식은 상관없다.

잇는 일은 사람이 하면 금방 지친다. 그래서 요즘은 AI에게 맡긴다.
`,
  },
  {
    name: '02-왜 다들 실패하나.md',
    content: `# 왜 다들 실패하나

개인 위키를 시작한 사람의 대부분이 한 달 안에 그만둔다. 이유는 세 가지다.

첫째, 모으는 것을 아는 것으로 착각한다. 북마크 500개, 스크린샷 2천 장. "무언가에 대해 안다"와 "안다"는 다르다. 이걸 수집가의 오류라고 부른다.

둘째, 정리 체계를 먼저 만든다. 폴더 열두 개, 태그 서른 개, 색깔 규칙. 체계가 거창할수록 넣을 때마다 고민이 늘고, 고민이 늘면 안 넣는다.

셋째, 유지보수를 사람이 한다. 분류하고 잇고 요약하는 일은 매일 쌓인다. 일주일은 하지만 한 달은 못 한다. 실패하는 건 형식이 아니라 유지보수다.

그러니 거꾸로 하면 된다. 체계는 최소로, 넣는 건 아무렇게나, 정리는 사람이 아닌 것에게.
`,
  },
  {
    name: '03-AI한테 시키는 법.md',
    content: `# AI한테 시키는 법

2026년 봄, AI 연구자 안드레 카파시가 "LLM이 관리하는 위키" 방식을 올렸고 많은 사람이 따라 했다. 방식은 단순하다.

폴더를 둘로 나눈다. raw에는 사람이 재료를 넣는다. wiki에는 AI가 정리한 노트를 쓴다. AI는 raw를 읽기만 하고, 사람은 wiki를 읽기만 한다.

동작은 셋이다. ingest는 새 재료를 읽어 wiki를 고치는 것, query는 wiki를 읽고 출처를 달아 답하는 것, lint는 모순과 빠진 것을 찾는 것.

규칙은 한 파일에 기록해 둔다. AI는 매번 그 파일을 먼저 읽는다. 규칙을 바꾸고 싶으면 그 파일만 고친다.

옵시디언을 쓰는 이유는 전부 그냥 파일이기 때문이다. 그래프 뷰를 열면 AI가 심은 연결이 눈에 보인다.

사람이 할 일은 하루 한 줄이면 충분하다. 나머지는 전부 AI가 한다.
`,
  },
];

// 노트 경로는 Karpathy LLM Wiki 플러그인과 겹치게 wiki/sources · wiki/concepts 를 쓴다
const SUM1 = 'wiki/sources/01-개인 위키가 뭔가.md';
const SUM2 = 'wiki/sources/02-왜 다들 실패하나.md';
const SUM3 = 'wiki/sources/03-AI한테 시키는 법.md';
const C_SB = 'wiki/concepts/개인 위키.md';
const C_RET = 'wiki/concepts/꺼내 쓰기.md';
const C_DAILY = 'wiki/concepts/매일 기록.md';
const C_COLL = 'wiki/concepts/수집가의 오류.md';
const C_MAINT = 'wiki/concepts/유지보수.md';
const C_LLMW = 'wiki/concepts/LLM 위키.md';
const C_GRAPH = 'wiki/concepts/그래프 뷰.md';
const C_INGEST = 'wiki/concepts/ingest.md';
const INDEX = 'wiki/index.md';
const LOG = 'wiki/log.md';
const R1 = 'raw/01-개인 위키가 뭔가.md';
const R2 = 'raw/02-왜 다들 실패하나.md';
const R3 = 'raw/03-AI한테 시키는 법.md';

const put = (path, content) => ({ op: 'put', path: 'practice:' + path, content });
const append = (path, content) => ({ op: 'append', path: 'practice:' + path, content });

// AGENTS.md 의 노트 형식: 제목 · 한 줄 · 재료 · 내용 (· 예시)
function page(title, line, raws, body, example) {
  let s = `# ${title}\n\n## 한 줄\n${line}\n\n## 재료\n${raws.map((r) => `- ${r}`).join('\n')}\n\n## 내용\n${body.trim()}\n`;
  if (example) s += `\n## 예시\n${example.trim()}\n`;
  return s;
}

// 개념 노트들. 단계마다 바뀌는 판을 따로 둔다
const N = {
  sb1: (ex) =>
    page(
      '개인 위키',
      '머릿속에 못 담는 것을 밖에 기록해 두고 필요할 때 꺼내 쓰는 두 번째 머리.',
      [R1],
      `하는 일은 둘이다.
1. 들어온 것을 기록한다 → [[매일 기록]]
2. 기록한 것끼리 잇는다 → 사람이 하면 지치는 일

저장이 목적이 아니다. [[꺼내 쓰기]]가 목적이다.`,
      ex
    ),
  sb2: (ex) =>
    page(
      '개인 위키',
      '머릿속에 못 담는 것을 밖에 기록해 두고 필요할 때 꺼내 쓰는 두 번째 머리.',
      [R1, R2],
      `하는 일은 둘이다.
1. 들어온 것을 기록한다 → [[매일 기록]]
2. 기록한 것끼리 잇는다 → 사람이 하면 지치는 일 = [[유지보수]]

저장이 목적이 아니다. [[꺼내 쓰기]]가 목적이다.

실패하는 이유: [[수집가의 오류]] · 거창한 체계 · 사람이 하는 [[유지보수]].`,
      ex
    ),
  ret: (ex) =>
    page(
      '꺼내 쓰기',
      '기록해 둔 것을 필요한 순간에 다시 찾아 쓰는 것. 개인 위키의 진짜 목적.',
      [R1],
      `- 저장만 하고 못 찾으면 없는 것과 같다 (서랍 속 영수증).
- 꺼내 쓰려면 기록한 것끼리 이어져 있어야 한다 → [[개인 위키]]`,
      ex
    ),
  daily1: () =>
    page(
      '매일 기록',
      '하루 세 줄 — 한 일 · 알게 된 것 · 메모. 형식은 상관없다.',
      [R1],
      `- [[개인 위키]]에 재료가 들어오는 유일한 길.
- 잘 쓰려고 하지 않는다. 단어만 적어도 된다.`
    ),
  daily3: () =>
    page(
      '매일 기록',
      '사람이 매일 하는 유일한 일. 하루 한 줄이면 충분하다.',
      [R1, R3],
      `- [[개인 위키]]에 재료가 들어오는 유일한 길.
- 잘 쓰려고 하지 않는다. 단어만 적어도 된다.
- 나머지는 전부 AI가 한다 → [[LLM 위키]]`
    ),
  dailyFix: (ex) =>
    page(
      '매일 기록',
      '사람이 매일 하는 유일한 일. "적게, 매일"이 핵심 — 세 줄(1편)이든 한 줄(3편)이든.',
      [R1, R3],
      `- [[개인 위키]]에 재료가 들어오는 유일한 길.
- 잘 쓰려고 하지 않는다. 단어만 적어도 된다.
- 몇 줄이냐는 재료마다 다르다: 1편 세 줄, 3편 한 줄. 공통은 "적게, 매일".
- 나머지는 전부 AI가 한다 → [[LLM 위키]] · [[ingest]]`,
      ex
    ),
  coll: (ex) =>
    page(
      '수집가의 오류',
      '모으는 것을 아는 것으로 착각하는 것. "무언가에 대해 안다" ≠ "안다".',
      [R2],
      `- 저장이 너무 쉬워서 저장 자체가 보상이 된다.
- [[개인 위키]]가 실패하는 첫 번째 이유. 둘째·셋째는 [[유지보수]].`,
      ex
    ),
  maint: (ex) =>
    page(
      '유지보수',
      '분류·잇기·요약처럼 매일 쌓이는 일. 사람이 하면 일주일은 되고 한 달은 안 된다.',
      [R2],
      `- 개인 위키가 죽는 진짜 자리. 형식 탓이 아니다.
- 해법: 사람이 아닌 것에게 맡긴다 → [[개인 위키]]
- [[수집가의 오류]]와 함께 실패 이유로 꼽힌다.`,
      ex
    ),
  llmw3: () =>
    page(
      'LLM 위키',
      'AI가 유지보수하는 개인 위키. raw는 사람, wiki는 AI, 규칙은 파일 하나.',
      [R3],
      `- 동작 셋: ingest(재료 읽어 wiki 고치기) · query(출처 달아 답하기) · lint(모순·빠진 것 찾기).
- [[개인 위키]]의 [[유지보수]] 문제를 AI에게 넘긴 형태.
- 규칙 파일을 고치면 정리 결과가 달라진다.`
    ),
  llmwFix: (ex) =>
    page(
      'LLM 위키',
      'AI가 유지보수하는 개인 위키. raw는 사람, wiki는 AI, 규칙은 파일 하나.',
      [R3],
      `- 동작 셋: [[ingest]](재료 읽어 wiki 고치기) · query(출처 달아 답하기) · lint(모순·빠진 것 찾기).
- [[개인 위키]]의 [[유지보수]] 문제를 AI에게 넘긴 형태.
- 규칙 파일을 고치면 정리 결과가 달라진다.
- 연결이 쌓이는 모양은 [[그래프 뷰]]로 본다.`,
      ex
    ),
  graph: (ex) =>
    page(
      '그래프 뷰',
      '옵시디언이 노트 사이의 링크를 점과 선으로 그려 주는 화면. AI가 심은 연결이 눈에 보인다.',
      [R3],
      `- 허브(링크가 많은 노트)와 고아(아무도 안 잇는 노트)를 한눈에 본다.`,
      ex
    ),
  ingest: (ex) =>
    page(
      'ingest',
      'raw 에 새로 들어온 재료를 읽고 wiki 를 쓰거나 고치는 동작. "소화하다"라는 뜻.',
      [R3],
      `- 재료 하나가 여러 노트를 건드린다 (요약 + 개념 여럿 + 목차 + 작업 기록).
- [[LLM 위키]]의 세 동작 중 첫 번째. 사람은 [[매일 기록]]만 하면 된다.`,
      ex
    ),
};

// ── 1편을 ingest 한 뒤 ──
const STAGE1 = [
  put(
    SUM1,
    page(
      '개인 위키가 뭔가 (요약)',
      '머리 밖에 기록해 두고 꺼내 쓰는 두 번째 머리. 핵심은 저장이 아니라 꺼내 쓰기.',
      [R1],
      `- [[개인 위키]]는 1. 기록하기 2. 잇기 두 가지 일을 한다.
- 저장만 하는 건 서랍에 영수증 넣기. [[꺼내 쓰기]]가 안 되면 없는 것.
- [[매일 기록]]은 하루 세 줄이면 충분. 형식 무관.
- 잇는 일은 사람이 하면 지치니 AI에게 맡긴다.`
    )
  ),
  put(C_SB, N.sb1()),
  put(C_RET, N.ret()),
  put(C_DAILY, N.daily1()),
  put(INDEX, `# 목차 (index.md)

wiki 에 어떤 노트가 있는지 한 줄씩. AI가 ingest 때마다 갱신하고, 질문을 받으면 제일 먼저 본다.

## 요약 (sources)
- [[01-개인 위키가 뭔가]] — 머리 밖에 기록해 두고 꺼내 쓰는 두 번째 머리

## 개념 (concepts)
- [[개인 위키]] — 기록하기 + 잇기. 목적은 꺼내 쓰기
- [[꺼내 쓰기]] — 저장만 하고 못 찾으면 없는 것
- [[매일 기록]] — 하루 세 줄
`),
  append(LOG, `- ingest · ${R1} → 요약 1, 개념 3 (개인 위키 · 꺼내 쓰기 · 매일 기록), 목차 갱신
`),
];

// ── 2편까지 ──
const STAGE2 = [
  put(
    SUM2,
    page(
      '왜 다들 실패하나 (요약)',
      '대부분 한 달 안에 그만둔다. 모으기=알기 착각, 거창한 체계, 사람이 하는 유지보수 때문.',
      [R2],
      `- [[수집가의 오류]]: 북마크 500개는 아는 게 아니다.
- 체계가 거창할수록 넣을 때마다 고민이 늘고, 고민이 늘면 안 넣는다.
- 실패하는 건 형식이 아니라 [[유지보수]]다.
- 거꾸로: 체계는 최소, 넣기는 아무렇게나, 정리는 사람이 아닌 것에게 → [[개인 위키]]`
    )
  ),
  put(C_COLL, N.coll()),
  put(C_MAINT, N.maint()),
  put(C_SB, N.sb2()),
  put(INDEX, `# 목차 (index.md)

wiki 에 어떤 노트가 있는지 한 줄씩. AI가 ingest 때마다 갱신하고, 질문을 받으면 제일 먼저 본다.

## 요약 (sources)
- [[01-개인 위키가 뭔가]] — 머리 밖에 기록해 두고 꺼내 쓰는 두 번째 머리
- [[02-왜 다들 실패하나]] — 모으기=알기 착각, 거창한 체계, 사람이 하는 유지보수

## 개념 (concepts)
- [[개인 위키]] — 기록하기 + 잇기. 목적은 꺼내 쓰기
- [[꺼내 쓰기]] — 저장만 하고 못 찾으면 없는 것
- [[매일 기록]] — 하루 세 줄
- [[수집가의 오류]] — 모으는 것 ≠ 아는 것
- [[유지보수]] — 개인 위키가 죽는 진짜 자리
`),
  append(LOG, `- ingest · ${R2} → 요약 1, 개념 2 새로 (수집가의 오류 · 유지보수), 개인 위키 노트 갱신, 목차 갱신
`),
];

// ── 3편까지 (매일 기록이 1편과 어긋나고, 그래프 뷰 노트는 아무도 링크하지 않는다 → B6 lint 거리) ──
const STAGE3 = [
  put(
    SUM3,
    page(
      'AI한테 시키는 법 (요약)',
      'raw(사람이 넣음)와 wiki(AI가 씀)로 나누고, ingest · query · lint 세 동작을 규칙 파일대로 시킨다.',
      [R3],
      `- 2026년 봄 안드레 카파시의 "LLM이 관리하는 위키" 글이 널리 퍼졌다 → [[LLM 위키]]
- AI는 raw를 읽기만, 사람은 wiki를 읽기만.
- 규칙은 한 파일에. AI는 매번 그 파일을 먼저 읽는다.
- 옵시디언을 쓰는 이유: 전부 그냥 파일이라서.
- 사람이 할 일은 [[매일 기록]] 하루 한 줄.`
    )
  ),
  put(C_LLMW, N.llmw3()),
  put(C_GRAPH, N.graph()),
  put(C_DAILY, N.daily3()),
  put(INDEX, `# 목차 (index.md)

wiki 에 어떤 노트가 있는지 한 줄씩. AI가 ingest 때마다 갱신하고, 질문을 받으면 제일 먼저 본다.

## 요약 (sources)
- [[01-개인 위키가 뭔가]] — 머리 밖에 기록해 두고 꺼내 쓰는 두 번째 머리
- [[02-왜 다들 실패하나]] — 모으기=알기 착각, 거창한 체계, 사람이 하는 유지보수
- [[03-AI한테 시키는 법]] — raw/wiki 로 나누고 ingest · query · lint

## 개념 (concepts)
- [[개인 위키]] — 기록하기 + 잇기. 목적은 꺼내 쓰기
- [[꺼내 쓰기]] — 저장만 하고 못 찾으면 없는 것
- [[매일 기록]] — 하루 한 줄
- [[수집가의 오류]] — 모으는 것 ≠ 아는 것
- [[유지보수]] — 개인 위키가 죽는 진짜 자리
- [[LLM 위키]] — AI가 유지보수하는 개인 위키
- [[그래프 뷰]] — 링크를 점과 선으로
`),
  append(LOG, `- ingest · ${R3} → 요약 1, 개념 2 새로 (LLM 위키 · 그래프 뷰), 매일 기록 노트 갱신, 목차 갱신
`),
];

// ── B5 물어보기 ──
const QUERY = [
  {
    q: '개인 위키는 왜 실패해?',
    a: `세 가지 때문이야.

1. **모으는 걸 아는 걸로 착각** — 북마크 500개는 아는 게 아니야 ([[수집가의 오류]]).
2. **거창한 체계** — 폴더 열두 개, 태그 서른 개. 넣을 때마다 고민이 늘고, 고민이 늘면 안 넣어.
3. **사람이 하는 유지보수** — 분류·잇기·요약은 매일 쌓여. 일주일은 되고 한 달은 안 돼 ([[유지보수]]).

그래서 거꾸로 하면 돼: 체계는 최소, 넣기는 아무렇게나, 정리는 AI에게 ([[LLM 위키]]).`,
    sources: [SUM2, C_COLL, C_MAINT],
    save: 'wiki/answers/개인 위키는 왜 실패해.md',
  },
  {
    q: '매일 할 일은 뭐야?',
    a: `딱 하나, [[매일 기록]]이야. 한 일 · 알게 된 것 · 메모를 아무렇게나 기록해.

몇 줄이냐는 재료마다 말이 달라 — 1편은 세 줄, 3편은 한 줄. 공통점은 "적게, 매일". 나머지(분류·잇기·요약)는 전부 AI가 해 ([[LLM 위키]]).`,
    sources: [C_DAILY, SUM1, SUM3],
    save: 'wiki/answers/매일 할 일.md',
  },
  {
    q: 'AI한테는 정확히 뭘 시켜?',
    a: `세 가지야 ([[LLM 위키]]).

1. **ingest** — raw에 새 재료가 들어오면 읽고, wiki 노트를 쓰거나 고치고, 목차(index)와 작업 기록(log)을 갱신.
2. **query** — 목차를 먼저 보고 관련 노트를 읽어 출처를 달아 답하기. 없으면 없다고.
3. **lint** — 모순, 아무도 안 잇는 노트, 있어야 하는데 없는 노트 찾기.

규칙은 AGENTS.md 한 파일에 있고, AI는 매번 그걸 먼저 읽어.`,
    sources: [SUM3, C_LLMW],
    save: 'wiki/answers/AI한테 시키는 것.md',
  },
];

// ── B6 위키 청소 ──
const LINT = {
  findings: [
    { kind: 'contradiction', text: '**모순** — [[매일 기록]]: 1편은 "하루 세 줄", 3편은 "하루 한 줄". 지금 노트엔 3편 말만 기록돼 있어.', pages: [C_DAILY, SUM1, SUM3] },
    { kind: 'orphan', text: '**고아 노트** — [[그래프 뷰]] 노트로 오는 링크가 목차 말고는 하나도 없어.', pages: [C_GRAPH] },
    { kind: 'missing', text: '**빠진 개념** — 노트 세 개가 ingest 를 말하는데, ingest 를 설명하는 개념 노트가 없어.', pages: [] },
  ],
  fix: [
    put(C_DAILY, N.dailyFix()),
    put(C_LLMW, N.llmwFix()),
    put(C_INGEST, N.ingest()),
    append(LOG, `- lint → 모순 1 (매일 기록: 세 줄 vs 한 줄) 해소, 고아 1 (그래프 뷰) 연결, 빠진 개념 1 (ingest) 추가
`),
  ],
};

// ── B7 규칙 바꾸기: 사용자가 개념 노트의 정리 형식을 바꾸고 싶다 → 개념 노트마다 "## 예시" 칸 ──
const SCHEMA = {
  rule: `
## 개념 노트 형식 (추가)

- 개념 노트(\`wiki/concepts/\`)마다 \`## 내용\` 아래에 \`## 예시\` 칸을 둔다. 일상에서 볼 수 있는 예시를 하나, 두세 문장으로 적는다.
`,
  after: [
    put(C_SB, N.sb2('회의에서 들은 아이디어를 그날 raw 에 한 줄 남겨 두면, 석 달 뒤 비슷한 기획을 할 때 AI 가 그 줄을 찾아 다시 꺼내 준다. 기억에만 두었으면 사라졌을 아이디어다.')),
    put(C_RET, N.ret('작년 여행 때 좋았던 숙소를 다시 가고 싶은데 이름이 기억나지 않는다. 사진첩을 한 시간 뒤지는 대신 위키에 "그 숙소 어디였지?" 하고 물어 바로 찾는다.')),
    put(C_DAILY, N.dailyFix('퇴근길에 "오늘 회의: 일정 2주 미룸. 이유는 디자인 검토." 한 줄만 남긴다. 문장을 다듬지 않아도 AI 가 나중에 정리해 준다.')),
    put(C_COLL, N.coll('"나중에 읽기"에 기사 300개를 모아 두고 뿌듯해한다. 하지만 그중 무엇을 아는지 물어보면 하나도 설명하지 못한다.')),
    put(C_MAINT, N.maint('첫 주엔 메모마다 태그를 달고 폴더를 골랐다. 셋째 주부터는 미뤄 둔 메모가 쌓였고, 결국 정리를 그만뒀다.')),
    put(C_LLMW, N.llmwFix('주말에 이번 주 메모를 raw 에 넣고 "ingest 해 줘" 한마디만 한다. 월요일엔 정리된 위키에 "지난주에 뭘 결정했지?" 하고 물어본다.')),
    put(C_GRAPH, N.graph('그래프 뷰를 열어 보니 "매일 기록" 점에 선이 잔뜩 몰려 있다. 위키에서 가장 자주 이어지는 중심 개념이라는 뜻이다.')),
    put(C_INGEST, N.ingest('회의록 하나를 raw 에 넣고 ingest 를 시키면, 요약 노트 하나가 생기고 "일정", "디자인 검토" 같은 개념 노트에도 내용이 더해진다.')),
    append(LOG, `- 규칙 바뀜 (개념 노트에 예시 칸) → 재 ingest · 개념 노트 8개에 "## 예시" 추가
`),
  ],
};

module.exports = { RAW, STAGES: { 1: STAGE1, 2: STAGE2, 3: STAGE3 }, QUERY, LINT, SCHEMA, PATHS: { SUM1, SUM2, SUM3, C_DAILY, C_GRAPH, INDEX, LOG } };

};

__defs["core/samples/zh"] = function (module, exports, require) {
// 체험 모드 샘플 (중국어 간체). ko.js 와 같은 꼴: 재료 글 3편과, 그걸 AGENTS.md 규칙대로 요리(ingest)한 결과를 미리 기록해 둔 것.
// 단계(STAGES[n])마다 '그때까지 ingest 한 결과'를 통째로 둔다 (put = 만들거나 덮어씀, append = 덧붙임).
// B6 lint 용으로 1편(하루 세 줄)과 3편(하루 한 줄)의 말이 일부러 어긋나고, 3편에서 아무도 링크하지 않는 노트(关系图谱)가 생긴다.
// wiki 노트는 AGENTS.md 규칙대로 "## 一句话" · "## 食材" · "## 内容" 칸으로 쓴다. B7 에서 규칙이 바뀌면 개념 노트에 "## 例子" 칸이 붙는다.
'use strict';

const RAW = [
  {
    name: '01-什么是个人维基.md',
    content: `# 什么是个人维基

脑子里装不下的东西，记在外面，需要的时候再拿出来用——这个第二大脑，就是个人维基。

关键不是“存”，而是“拿出来用”。只存不用，就像把收据胡乱塞进抽屉。以后找不到，就等于没有。

所以个人维基做两件事。
1. 把进来的东西记下来 — 今天学到的、感受到的、收到的资料。
2. 把记下的东西连起来 — 相似的、相反的、接得上的。

一天三行就够了：做了什么、学到什么、备忘。格式无所谓。

连接这件事，靠人来做很快就会累。所以现在都交给 AI。
`,
  },
  {
    name: '02-为什么大家都失败.md',
    content: `# 为什么大家都失败

开始做个人维基的人，大多数一个月内就放弃了。原因有三个。

第一，把收集当成了懂。500 个书签，2000 张截图。“知道有这么回事”和“懂”不是一回事。这叫收藏家谬误。

第二，先搭整理体系。十二个文件夹，三十个标签，再加一套颜色规则。体系越宏大，每次放东西就越要琢磨；越琢磨，就越不想放。

第三，维护靠人。分类、连接、摘要，每天都在堆积。坚持一周可以，一个月就不行了。失败的不是形式，而是维护。

所以反过来做就行：体系越少越好，放东西随手放，整理交给人以外的东西。
`,
  },
  {
    name: '03-怎么让 AI 来做.md',
    content: `# 怎么让 AI 来做

2026 年春天，AI 研究者安德烈·卡帕西（Andrej Karpathy）分享了“由 LLM 维护的维基”这种做法，很多人跟着做了起来。做法很简单。

文件夹分成两个。raw 里由人放食材。wiki 里由 AI 写整理好的笔记。AI 只读 raw，人只读 wiki。

动作有三个。ingest 是读新食材、修改 wiki；query 是读 wiki、附上出处来回答；lint 是找出矛盾和缺漏。

规则记在一个文件里。AI 每次都先读这个文件。想改规则，只改这个文件就行。

用 Obsidian 的原因是：全都只是普通文件。打开关系图谱，AI 建立的连接一目了然。

人要做的事，一天一行就够了。剩下的全部交给 AI。
`,
  },
];

// 노트 경로는 Karpathy LLM Wiki 플러그인과 겹치게 wiki/sources · wiki/concepts 를 쓴다
const SUM1 = 'wiki/sources/01-什么是个人维基.md';
const SUM2 = 'wiki/sources/02-为什么大家都失败.md';
const SUM3 = 'wiki/sources/03-怎么让 AI 来做.md';
const C_SB = 'wiki/concepts/个人维基.md';
const C_RET = 'wiki/concepts/拿出来用.md';
const C_DAILY = 'wiki/concepts/每日记录.md';
const C_COLL = 'wiki/concepts/收藏家谬误.md';
const C_MAINT = 'wiki/concepts/维护.md';
const C_LLMW = 'wiki/concepts/LLM 维基.md';
const C_GRAPH = 'wiki/concepts/关系图谱.md';
const C_INGEST = 'wiki/concepts/ingest.md';
const INDEX = 'wiki/index.md';
const LOG = 'wiki/log.md';
const R1 = 'raw/01-什么是个人维基.md';
const R2 = 'raw/02-为什么大家都失败.md';
const R3 = 'raw/03-怎么让 AI 来做.md';

const put = (path, content) => ({ op: 'put', path: 'practice:' + path, content });
const append = (path, content) => ({ op: 'append', path: 'practice:' + path, content });

// AGENTS.md 의 노트 형식: 제목 · 一句话 · 食材 · 内容 (· 例子)
function page(title, line, raws, body, example) {
  let s = `# ${title}\n\n## 一句话\n${line}\n\n## 食材\n${raws.map((r) => `- ${r}`).join('\n')}\n\n## 内容\n${body.trim()}\n`;
  if (example) s += `\n## 例子\n${example.trim()}\n`;
  return s;
}

// 개념 노트들. 단계마다 바뀌는 판을 따로 둔다
const N = {
  sb1: (ex) =>
    page(
      '个人维基',
      '把脑子里装不下的东西记在外面、需要时再拿出来用的第二大脑。',
      [R1],
      `做的事有两件。
1. 把进来的东西记下来 → [[每日记录]]
2. 把记下的东西连起来 → 靠人做会累的活

目的不是存，而是[[拿出来用]]。`,
      ex
    ),
  sb2: (ex) =>
    page(
      '个人维基',
      '把脑子里装不下的东西记在外面、需要时再拿出来用的第二大脑。',
      [R1, R2],
      `做的事有两件。
1. 把进来的东西记下来 → [[每日记录]]
2. 把记下的东西连起来 → 靠人做会累的活 = [[维护]]

目的不是存，而是[[拿出来用]]。

失败的原因：[[收藏家谬误]] · 宏大的体系 · 靠人做的[[维护]]。`,
      ex
    ),
  ret: (ex) =>
    page(
      '拿出来用',
      '在需要的那一刻，把记下的东西重新找出来用。这才是个人维基真正的目的。',
      [R1],
      `- 只存不找，就等于没有（抽屉里的收据）。
- 要能拿出来用，记下的东西之间就得连着 → [[个人维基]]`,
      ex
    ),
  daily1: () =>
    page(
      '每日记录',
      '一天三行 — 做了什么 · 学到什么 · 备忘。格式无所谓。',
      [R1],
      `- 食材进入[[个人维基]]的唯一通道。
- 不求写得好，只写几个词也行。`
    ),
  daily3: () =>
    page(
      '每日记录',
      '人每天唯一要做的事。一天一行就够了。',
      [R1, R3],
      `- 食材进入[[个人维基]]的唯一通道。
- 不求写得好，只写几个词也行。
- 剩下的全部由 AI 来做 → [[LLM 维基]]`
    ),
  dailyFix: (ex) =>
    page(
      '每日记录',
      '人每天唯一要做的事。关键是“少量、每天”——三行（第 1 篇）也好，一行（第 3 篇）也好。',
      [R1, R3],
      `- 食材进入[[个人维基]]的唯一通道。
- 不求写得好，只写几个词也行。
- 写几行，各篇食材说法不同：第 1 篇三行，第 3 篇一行。共同点是“少量、每天”。
- 剩下的全部由 AI 来做 → [[LLM 维基]] · [[ingest]]`,
      ex
    ),
  coll: (ex) =>
    page(
      '收藏家谬误',
      '把收集当成了懂。“知道有这么回事” ≠ “懂”。',
      [R2],
      `- 存东西太容易，存这个动作本身就成了奖励。
- [[个人维基]]失败的第一个原因。第二、第三个见[[维护]]。`,
      ex
    ),
  maint: (ex) =>
    page(
      '维护',
      '分类、连接、摘要这类每天都在堆积的活。靠人做，一周还行，一个月就不行。',
      [R2],
      `- 个人维基真正死掉的地方。不怪形式。
- 解法：交给人以外的东西 → [[个人维基]]
- 和[[收藏家谬误]]一起被列为失败的原因。`,
      ex
    ),
  llmw3: () =>
    page(
      'LLM 维基',
      '由 AI 来维护的个人维基。raw 归人，wiki 归 AI，规则只有一个文件。',
      [R3],
      `- 三个动作：ingest（读食材、改 wiki）· query（附上出处回答）· lint（找矛盾和缺漏）。
- 把[[个人维基]]的[[维护]]问题交给 AI 的做法。
- 改了规则文件，整理结果就会跟着变。`
    ),
  llmwFix: (ex) =>
    page(
      'LLM 维基',
      '由 AI 来维护的个人维基。raw 归人，wiki 归 AI，规则只有一个文件。',
      [R3],
      `- 三个动作：[[ingest]]（读食材、改 wiki）· query（附上出处回答）· lint（找矛盾和缺漏）。
- 把[[个人维基]]的[[维护]]问题交给 AI 的做法。
- 改了规则文件，整理结果就会跟着变。
- 链接越积越多的样子，可以在[[关系图谱]]里看。`,
      ex
    ),
  graph: (ex) =>
    page(
      '关系图谱',
      'Obsidian 把笔记之间的链接画成点和线的画面。AI 建立的连接一目了然。',
      [R3],
      `- 枢纽（链接很多的笔记）和孤立笔记（没人链接的笔记）一眼就能看出来。`,
      ex
    ),
  ingest: (ex) =>
    page(
      'ingest',
      '读取 raw 里新进来的食材，写入或修改 wiki 的动作。意思是“消化”。',
      [R3],
      `- 一份食材会动到好几篇笔记（摘要 + 好几个概念 + 目录 + 工作记录）。
- [[LLM 维基]]三个动作里的第一个。人只要做[[每日记录]]就行。`,
      ex
    ),
};

// ── 1편을 ingest 한 뒤 ──
const STAGE1 = [
  put(
    SUM1,
    page(
      '什么是个人维基（摘要）',
      '记在脑子外面、需要时拿出来用的第二大脑。关键不是存，而是拿出来用。',
      [R1],
      `- [[个人维基]]做两件事：1. 记下来 2. 连起来。
- 只存不用，就是把收据塞进抽屉。不能[[拿出来用]]，就等于没有。
- [[每日记录]]一天三行就够，格式无所谓。
- 连接这件事靠人做会累，所以交给 AI。`
    )
  ),
  put(C_SB, N.sb1()),
  put(C_RET, N.ret()),
  put(C_DAILY, N.daily1()),
  put(INDEX, `# 目录（index.md）

wiki 里有哪些笔记，一行一篇。AI 每次 ingest 都会更新它，被提问时最先看这里。

## 摘要（sources）
- [[01-什么是个人维基]] — 记在脑子外面、拿出来用的第二大脑

## 概念（concepts）
- [[个人维基]] — 记下来 + 连起来。目的是拿出来用
- [[拿出来用]] — 只存不找，就等于没有
- [[每日记录]] — 一天三行
`),
  append(LOG, `- ingest · ${R1} → 摘要 1，概念 3（个人维基 · 拿出来用 · 每日记录），目录已更新
`),
];

// ── 2편까지 ──
const STAGE2 = [
  put(
    SUM2,
    page(
      '为什么大家都失败（摘要）',
      '大多数人一个月内就放弃。原因是把收集当成懂、体系太宏大、维护靠人。',
      [R2],
      `- [[收藏家谬误]]：500 个书签不等于懂。
- 体系越宏大，每次放东西越要琢磨；越琢磨，就越不想放。
- 失败的不是形式，而是[[维护]]。
- 反过来：体系最小，随手放，整理交给人以外的东西 → [[个人维基]]`
    )
  ),
  put(C_COLL, N.coll()),
  put(C_MAINT, N.maint()),
  put(C_SB, N.sb2()),
  put(INDEX, `# 目录（index.md）

wiki 里有哪些笔记，一行一篇。AI 每次 ingest 都会更新它，被提问时最先看这里。

## 摘要（sources）
- [[01-什么是个人维基]] — 记在脑子外面、拿出来用的第二大脑
- [[02-为什么大家都失败]] — 把收集当成懂、体系太宏大、维护靠人

## 概念（concepts）
- [[个人维基]] — 记下来 + 连起来。目的是拿出来用
- [[拿出来用]] — 只存不找，就等于没有
- [[每日记录]] — 一天三行
- [[收藏家谬误]] — 收集 ≠ 懂
- [[维护]] — 个人维基真正死掉的地方
`),
  append(LOG, `- ingest · ${R2} → 摘要 1，新增概念 2（收藏家谬误 · 维护），个人维基笔记已更新，目录已更新
`),
];

// ── 3편까지 (每日记录이 1편과 어긋나고, 关系图谱 노트는 아무도 링크하지 않는다 → B6 lint 거리) ──
const STAGE3 = [
  put(
    SUM3,
    page(
      '怎么让 AI 来做（摘要）',
      '分成 raw（人放）和 wiki（AI 写），按规则文件让 AI 做 ingest · query · lint 三个动作。',
      [R3],
      `- 2026 年春天，安德烈·卡帕西关于“由 LLM 维护的维基”的文章广为流传 → [[LLM 维基]]
- AI 只读 raw，人只读 wiki。
- 规则写在一个文件里。AI 每次都先读这个文件。
- 用 Obsidian 的原因：全都只是普通文件。
- 人要做的事：[[每日记录]]，一天一行。`
    )
  ),
  put(C_LLMW, N.llmw3()),
  put(C_GRAPH, N.graph()),
  put(C_DAILY, N.daily3()),
  put(INDEX, `# 目录（index.md）

wiki 里有哪些笔记，一行一篇。AI 每次 ingest 都会更新它，被提问时最先看这里。

## 摘要（sources）
- [[01-什么是个人维基]] — 记在脑子外面、拿出来用的第二大脑
- [[02-为什么大家都失败]] — 把收集当成懂、体系太宏大、维护靠人
- [[03-怎么让 AI 来做]] — 分成 raw/wiki，再 ingest · query · lint

## 概念（concepts）
- [[个人维基]] — 记下来 + 连起来。目的是拿出来用
- [[拿出来用]] — 只存不找，就等于没有
- [[每日记录]] — 一天一行
- [[收藏家谬误]] — 收集 ≠ 懂
- [[维护]] — 个人维基真正死掉的地方
- [[LLM 维基]] — 由 AI 来维护的个人维基
- [[关系图谱]] — 把链接画成点和线
`),
  append(LOG, `- ingest · ${R3} → 摘要 1，新增概念 2（LLM 维基 · 关系图谱），每日记录笔记已更新，目录已更新
`),
];

// ── B5 물어보기 ──
const QUERY = [
  {
    q: '个人维基为什么会失败？',
    a: `原因有三个。

1. **把收集当成懂** — 500 个书签不等于懂（[[收藏家谬误]]）。
2. **宏大的体系** — 十二个文件夹、三十个标签。每次放东西都要琢磨，一琢磨就不想放了。
3. **维护靠人** — 分类、连接、摘要每天都在堆积。一周还行，一个月就不行（[[维护]]）。

所以反过来做就行：体系最小，随手放，整理交给 AI（[[LLM 维基]]）。`,
    sources: [SUM2, C_COLL, C_MAINT],
    save: 'wiki/answers/个人维基为什么会失败.md',
  },
  {
    q: '每天要做什么？',
    a: `就一件事：[[每日记录]]。做了什么 · 学到什么 · 备忘，随便记下来就行。

记几行，各篇食材说法不一样 — 第 1 篇说三行，第 3 篇说一行。共同点是“少量、每天”。剩下的（分类、连接、摘要）全部由 AI 来做（[[LLM 维基]]）。`,
    sources: [C_DAILY, SUM1, SUM3],
    save: 'wiki/answers/每天要做的事.md',
  },
  {
    q: '到底要让 AI 做什么？',
    a: `三件事（[[LLM 维基]]）。

1. **ingest** — raw 里进来新食材时，读它，写入或修改 wiki 笔记，并更新目录（index）和工作记录（log）。
2. **query** — 先看目录，再读相关笔记，附上出处来回答。找不到就说没有。
3. **lint** — 找出矛盾、没人链接的笔记、该有却没有的笔记。

规则都在 AGENTS.md 这一个文件里，AI 每次都先读它。`,
    sources: [SUM3, C_LLMW],
    save: 'wiki/answers/让 AI 做的事.md',
  },
];

// ── B6 위키 청소 ──
const LINT = {
  findings: [
    { kind: 'contradiction', text: '**矛盾** — [[每日记录]]：第 1 篇说“一天三行”，第 3 篇说“一天一行”。现在笔记里只记了第 3 篇的说法。', pages: [C_DAILY, SUM1, SUM3] },
    { kind: 'orphan', text: '**孤立笔记** — 除了目录，没有任何链接指向[[关系图谱]]这篇笔记。', pages: [C_GRAPH] },
    { kind: 'missing', text: '**缺失的概念** — 有三篇笔记提到了 ingest，却没有一篇解释 ingest 的概念笔记。', pages: [] },
  ],
  fix: [
    put(C_DAILY, N.dailyFix()),
    put(C_LLMW, N.llmwFix()),
    put(C_INGEST, N.ingest()),
    append(LOG, `- lint → 解决矛盾 1（每日记录：三行 vs 一行），连上孤立笔记 1（关系图谱），补上缺失概念 1（ingest）
`),
  ],
};

// ── B7 규칙 바꾸기: 사용자가 개념 노트의 정리 형식을 바꾸고 싶다 → 개념 노트마다 "## 例子" 칸 ──
const SCHEMA = {
  rule: `
## 概念笔记格式（新增）

- 每篇概念笔记（\`wiki/concepts/\`）都在 \`## 内容\` 下面加一个 \`## 例子\` 栏。写一个日常生活中能见到的例子，两三句话就行。
`,
  after: [
    put(C_SB, N.sb2('开会时听到一个点子，当天在 raw 里留一行。三个月后做类似的策划时，AI 会找到这一行，重新拿出来给你。要是只放在记忆里，这个点子早就没了。')),
    put(C_RET, N.ret('想再去去年旅行时住过的那家好民宿，却想不起名字。不用翻一小时相册，直接问维基“那家民宿是哪儿来着？”，马上就能找到。')),
    put(C_DAILY, N.dailyFix('下班路上只留一行：“今天开会：日程推迟两周。原因是设计评审。”句子不用打磨，之后 AI 会帮你整理。')),
    put(C_COLL, N.coll('在“稍后阅读”里攒了 300 篇文章，心里很有成就感。可要是问你其中懂了什么，一篇也讲不出来。')),
    put(C_MAINT, N.maint('第一周，每条备忘都打标签、挑文件夹。到了第三周，拖着没整理的备忘越堆越多，最后干脆不整理了。')),
    put(C_LLMW, N.llmwFix('周末把这一周的备忘放进 raw，只说一句“帮我 ingest”。到了周一，直接问整理好的维基：“上周我们定了什么？”')),
    put(C_GRAPH, N.graph('打开关系图谱，看到“每日记录”这个点上聚了一大堆线。说明它是维基里被连接得最多的核心概念。')),
    put(C_INGEST, N.ingest('把一份会议记录放进 raw，让 AI 做 ingest，就会多出一篇摘要笔记，“日程”“设计评审”这类概念笔记里也会补上内容。')),
    append(LOG, `- 规则变更（概念笔记加例子栏）→ 重新 ingest · 8 篇概念笔记加上“## 例子”
`),
  ],
};

module.exports = { RAW, STAGES: { 1: STAGE1, 2: STAGE2, 3: STAGE3 }, QUERY, LINT, SCHEMA, PATHS: { SUM1, SUM2, SUM3, C_DAILY, C_GRAPH, INDEX, LOG } };

};

__defs["core/templates"] = function (module, exports, require) {
// 연습 폴더에 만드는 파일의 원문. Karpathy LLM Wiki 의 3층(raw · wiki · 스키마) · 3동작(ingest · query · lint) · 2파일(index · log)을
// 쉬운 말로 적은 짧은 판이다. 폴더 이름(raw/ · wiki/)과 wiki/index.md 자리는 Karpathy LLM Wiki 플러그인(karpathywiki)이 쓰는 것과 같아서
// 졸업 뒤 그 플러그인으로 넘어가도 그대로 쓸 수 있다 (그쪽은 wiki/ 아래 sources · entities · concepts 를 더 만든다).
'use strict';

const AGENTS = {
  ko: `# 규칙 파일 (AGENTS.md)

이 폴더는 "내 위키" 연습장입니다. AI는 일을 시작하기 전에 이 파일을 먼저 읽고, 아래 규칙대로 일합니다.

## 폴더와 파일

- \`raw/\` — 재료 폴더. 사람이 글·메모·스크랩을 넣는 곳. **AI는 이 폴더의 파일을 읽기만 하고 절대 고치지 않는다.**
- \`raw/README.md\` — raw 폴더 안내. 재료가 아니므로 ingest 하지 않는다.
- \`wiki/\` — AI만 고치는 곳. AI가 재료에서 뽑은 내용을 정리한 노트를 쓴다. 사람은 읽기만 하고, 고칠 게 있으면 AI에게 말한다.
- \`wiki/sources/\` — 요약 폴더. 재료 하나에 요약 노트 하나.
- \`wiki/concepts/\` — 개념 폴더. 개념 하나에 노트 하나.
- \`wiki/answers/\` — 답변 폴더. 물어보기(query)에서 저장할 만한 답.
- \`wiki/index.md\` — 목차. wiki에 어떤 노트가 있는지 한 줄씩 적는다.
- \`wiki/log.md\` — 작업 기록. AI가 언제 무슨 작업을 했는지 한 줄씩 덧붙인다.
- \`AGENTS.md\` — 이 파일. AI가 일하는 규칙.

## 작업 세 가지

- **ingest (요리)** — \`raw/\`에 새로 들어온 재료를 읽고, \`wiki/sources/\`에 요약 노트 하나, \`wiki/concepts/\`에 관련 개념 노트를 쓰거나 고친다. 노트끼리 \`[[링크]]\`로 잇는다. 끝나면 \`wiki/index.md\`와 \`wiki/log.md\`를 갱신한다.
- **query (물어보기)** — 먼저 \`wiki/index.md\`를 보고, 관련 노트를 읽고, 출처(노트 이름)를 달아 답한다. 위키에 없으면 "없다"고 말한다. 사람이 원하면 좋은 답을 \`wiki/answers/\`에 노트로 저장한다.
- **lint (위키 청소)** — 서로 어긋나는 내용, 새 재료와 맞지 않게 낡은 내용, 어디서도 링크되지 않은 노트, 있어야 하는데 없는 개념 노트를 찾아 알려 준다.

## 노트를 쓸 때

- 제목만 봐도 무슨 내용인지 알 수 있게.
- 제목 아래에 소제목 칸을 이 순서로 둔다.
  - \`## 한 줄\` — 한 문장 요약.
  - \`## 재료\` — 어느 재료에서 왔는지 \`raw/파일이름\`으로 한 줄에 하나씩.
  - \`## 내용\` — 정리한 내용.
- 관련 노트는 \`[[노트 이름]]\`으로 잇는다.
`,
  en: `# Rules file (AGENTS.md)

This folder is a "my wiki" practice space. Before starting any work, the AI reads this file first and works by the rules below.

## Folders and files

- \`raw/\` — the ingredients folder. People put writing, memos and clippings here. **The AI only reads files in this folder and never edits them.**
- \`raw/README.md\` — a guide to the raw folder. It is not an ingredient, so don't ingest it.
- \`wiki/\` — only the AI edits here. The AI writes notes that organize what it pulled out of the ingredients. People only read; if something needs fixing, they tell the AI.
- \`wiki/sources/\` — the summaries folder. One summary note per ingredient.
- \`wiki/concepts/\` — the concepts folder. One note per concept.
- \`wiki/answers/\` — the answers folder. Answers from asking (query) that are worth keeping.
- \`wiki/index.md\` — contents. One line for each note in the wiki.
- \`wiki/log.md\` — work log. The AI appends one line for each piece of work it did, and when.
- \`AGENTS.md\` — this file. The rules the AI works by.

## Three jobs

- **ingest (cooking)** — read ingredients newly added to \`raw/\`, then write one summary note in \`wiki/sources/\` and write or update related concept notes in \`wiki/concepts/\`. Link notes to each other with \`[[links]]\`. When done, update \`wiki/index.md\` and \`wiki/log.md\`.
- **query (asking)** — look at \`wiki/index.md\` first, read the related notes, and answer with sources (note names). If the wiki doesn't have it, say so. If the person wants, save a good answer as a note in \`wiki/answers/\`.
- **lint (wiki cleanup)** — find and report contradictions, content gone stale against newer ingredients, notes nothing links to, and concept notes that should exist but don't.

## When writing a note

- A title that tells you what it's about at a glance.
- Under the title, these sections in this order:
  - \`## In one line\` — a one-sentence summary.
  - \`## Ingredients\` — which ingredients it came from, one \`raw/filename\` per line.
  - \`## Content\` — the organized content.
- Link related notes with \`[[note name]]\`.
`,
};

AGENTS.zh = `# 规则文件（AGENTS.md）

这个文件夹是"我的维基"练习场。AI 在开始任何工作之前，先读这个文件，并按下面的规则工作。

## 文件夹和文件

- \`raw/\` — 食材文件夹。人往这里放文章、备忘和剪藏。**AI 只读这个文件夹里的文件，绝不修改。**
- \`raw/README.md\` — raw 文件夹的说明。它不是食材，不要 ingest。
- \`wiki/\` — 只有 AI 修改这里。AI 把从食材中提炼出的内容整理成笔记写在这里。人只负责读，要改什么就告诉 AI。
- \`wiki/sources/\` — 摘要文件夹。一份食材一篇摘要笔记。
- \`wiki/concepts/\` — 概念文件夹。一个概念一篇笔记。
- \`wiki/answers/\` — 回答文件夹。提问（query）中值得保存的回答。
- \`wiki/index.md\` — 目录。wiki 里有哪些笔记，一行一篇。
- \`wiki/log.md\` — 工作记录。AI 什么时候做了什么，一行一条往后加。
- \`AGENTS.md\` — 这个文件。AI 工作的规则。

## 三项工作

- **ingest（烹饪）** — 读 \`raw/\` 里新放进来的食材，在 \`wiki/sources/\` 写一篇摘要笔记，在 \`wiki/concepts/\` 写或更新相关的概念笔记。笔记之间用 \`[[链接]]\` 连起来。做完后更新 \`wiki/index.md\` 和 \`wiki/log.md\`。
- **query（提问）** — 先看 \`wiki/index.md\`，再读相关笔记，附上出处（笔记名）回答。维基里没有就说"没有"。用户需要的话，把好的回答作为笔记保存到 \`wiki/answers/\`。
- **lint（维基清理）** — 找出互相矛盾的内容、和新食材对不上的过时内容、没有任何地方链接到的笔记、应该有却没有的概念笔记，并告诉用户。

## 写笔记时

- 只看标题就能知道写的是什么。
- 标题下面按这个顺序放小标题：
  - \`## 一句话\` — 一句话摘要。
  - \`## 食材\` — 来自哪份食材，用 \`raw/文件名\`，一行一个。
  - \`## 内容\` — 整理好的内容。
- 相关笔记用 \`[[笔记名]]\` 连起来。
`;

const INDEX = {
  zh: `# 目录（index.md）

wiki 里有哪些笔记，一行一篇。AI 每次 ingest 都会更新它，被提问时最先看这里。

（目前为空）
`,
  ko: `# 목차 (index.md)

wiki 에 어떤 노트가 있는지 한 줄씩. AI가 ingest 때마다 갱신하고, 질문을 받으면 제일 먼저 본다.

(아직 비어 있음)
`,
  en: `# Contents (index.md)

One line for each note in the wiki. The AI updates this on every ingest and reads it first when asked a question.

(empty for now)
`,
};

const LOG = {
  zh: `# 工作记录（log.md）

AI 什么时候做了什么，一行一条往后加。不删除。

`,
  ko: `# 작업 기록 (log.md)

AI가 언제 무슨 작업을 했는지 한 줄씩 덧붙인다. 지우지 않는다.

`,
  en: `# Work log (log.md)

The AI appends one line for each piece of work it did, and when. Nothing is deleted.

`,
};

const RAW_README = {
  zh: `# README — raw 文件夹说明

这是食材文件夹。把要让 AI 读取并整理的文章、备忘、剪藏放在这里。

- AI 只读这个文件夹里的文件，绝不修改。
- 文件名请起得能看出内容。（例如："2026-10-29 会议记录"）
- 这个 README 文件是说明，不当作食材使用。
`,
  ko: `# README — raw 폴더 안내

재료 폴더입니다. AI가 읽고 정리할 글·메모·스크랩을 여기 넣으세요.

- AI는 이 폴더의 파일을 읽기만 하고 절대 고치지 않습니다.
- 파일 이름은 내용을 알 수 있게 지어 주세요. (예: "2026-10-29 회의 기록")
- 이 README 파일은 안내문이라 재료로 쓰지 않습니다.
`,
  en: `# README — about the raw folder

This is the ingredients folder. Put writing, memos and clippings here for the AI to read and organize.

- The AI only reads files in this folder and never edits them.
- Give files names that tell you what's inside. (e.g. "2026-10-29 meeting notes")
- This README file is a guide, so it is not used as an ingredient.
`,
};

module.exports = { AGENTS, INDEX, LOG, RAW_README };

};

__defs["plugin/anchors"] = function (module, exports, require) {
// 옵시디언 UI 요소의 자리를 무대 좌표로 돌려준다. 고양이가 걸어갈 x, 가리킬 y 를 여기서 얻는다.
//
// anchor 형식:
//  'folder:<경로>' 'file:<경로>' : 파일 탐색기의 그 줄 (접혀 있으면 부모를 펼친다)
//  'graph'                       : 열린 그래프 뷰
//  'editor'                      : 지금 편집 중인 노트
//  'ribbon:<aria-label>'         : 왼쪽 리본 아이콘
//  'statusbar'                   : 상태 표시줄
//  'sel:<css 선택자>'            : 아무 요소
//  'x:<숫자>' 또는 숫자          : 무대 x 좌표 그대로
//
// 돌려주는 것: { x, y, top, bottom, left, right, width, height } (무대 기준) 또는 null (못 찾음).
// 파일 탐색기의 fileItems 는 공개 API 가 아니라 옵시디언이 바뀌면 깨질 수 있다. 그때는 null 을 돌려주고 수업은 말로 안내한다.
const { MarkdownView } = require('obsidian');

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toStage(rect, r) {
  return {
    x: r.left + r.width / 2 - rect.left,
    y: r.top + r.height / 2 - rect.top,
    top: r.top - rect.top,
    bottom: r.bottom - rect.top,
    left: r.left - rect.left,
    right: r.right - rect.left,
    width: r.width,
    height: r.height,
  };
}

async function explorerItem(app, path, quiet) {
  const leaf = app.workspace.getLeavesOfType('file-explorer')[0];
  if (!leaf) return null;
  const view = leaf.view;
  const items = view && view.fileItems;
  if (!items) return null;
  const item = items[path];
  if (!item) return null;
  if (quiet) return item.innerEl || item.titleInnerEl || item.selfEl || item.el;
  // 접힌 부모 폴더를 펼친다
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    const p = items[parts.slice(0, i).join('/')];
    if (p && p.collapsed && typeof p.setCollapsed === 'function') {
      try {
        await p.setCollapsed(false, false);
      } catch {
        // 옛 옵시디언
      }
    }
  }
  // 사이드바가 접혀 있으면 펼친다
  try {
    await app.workspace.revealLeaf(leaf);
  } catch {
    // 무시
  }
  const row = item.selfEl || item.titleEl || item.el;
  if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  await sleep(80);
  // 줄 전체가 아니라 이름 글자 부분을 가리킨다 (줄은 패널 폭을 다 차지해서 가운데가 엉뚱한 곳이 된다)
  return item.innerEl || item.titleInnerEl || (row && row.querySelector('.tree-item-inner')) || row;
}

// quiet: 이미 가리키는 중에 자리만 다시 잴 때 (펼치기 · 스크롤 같은 부작용 없이)
async function locate(app, stage, anchor, quiet = false) {
  if (anchor == null) return null;
  if (typeof anchor === 'number') return { x: anchor };
  const s = String(anchor);
  const at = s.indexOf(':');
  const kind = at < 0 ? s : s.slice(0, at);
  const arg = at < 0 ? '' : s.slice(at + 1);
  let el = null;
  switch (kind) {
    case 'x':
      return { x: Number(arg) };
    case 'folder':
    case 'file':
      el = await explorerItem(app, arg, quiet);
      break;
    case 'graph': {
      const leaf = app.workspace.getLeavesOfType('graph')[0];
      el = leaf && leaf.view && leaf.view.containerEl;
      break;
    }
    case 'editor': {
      const v = app.workspace.getActiveViewOfType(MarkdownView);
      el = v && v.contentEl;
      break;
    }
    case 'ribbon':
      el = document.querySelector(`.side-dock-ribbon-action[aria-label="${CSS.escape(arg)}"]`);
      break;
    case 'statusbar':
      el = document.querySelector('.status-bar');
      break;
    case 'sel':
      el = document.querySelector(arg);
      break;
    default:
      return null;
  }
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  const rect = stage.rect();
  const o = toStage(rect, r);
  o.x = clamp(o.x, 0, rect.width);
  o.kind = kind;
  return o;
}

module.exports = { locate };

};

__defs["plugin/frame"] = function (module, exports, require) {
// 펫 판(iframe)과 플러그인 사이의 다리. Vault Pet 의 frame.js 와 같은 구조다.
// 펫 판 코드(src/kit/*)는 iframe 안에서 돈다: 스타일이 옵시디언과 섞이지 않고, window.innerWidth 처럼
// '창 하나를 통째로 쓴다'는 가정이 그대로 맞는다. window.pet 으로 아래 API 를 넣어 준다.
const ASSETS = require('./kit-assets');

// [이름, 종류, 채널]. 종류: send = 펫 판 → 플러그인, on = 플러그인 → 펫 판 알림 받기
const API = [
  ['ready', 'send', 'pet:ready'],
  ['hover', 'send', 'pet:hover'], // 고양이·말풍선 위에 마우스가 올라왔다 (그때만 iframe 이 클릭을 받는다)
  ['drag', 'send', 'pet:drag'], // 'start' | 'end' { x }
  ['poke', 'send', 'pet:poke'],
  ['rub', 'send', 'pet:rub'],
  ['bubbleEnd', 'send', 'pet:bubble-end'], // (id, reason) 말풍선이 닫혔다
  ['bubbleReply', 'send', 'pet:bubble-reply'], // (ask, i) 질문에 대답
  ['cardReply', 'send', 'pet:card-reply'], // (id, i) 카드 버튼
  ['arrived', 'send', 'pet:arrived'], // (id) goto · carry 가 끝났다
  ['open', 'send', 'pet:open'], // 더블클릭
  ['context', 'send', 'pet:context'], // 우클릭
  ['onConfig', 'on', 'pet:config'],
  ['onBubble', 'on', 'pet:bubble'], // { id, text, kind, ask, choices, ms }
  ['onBubbleClear', 'on', 'pet:bubble-clear'],
  ['onCard', 'on', 'pet:card'], // { id, title, body, buttons }
  ['onAction', 'on', 'pet:action'], // 모션 키
  ['onGoto', 'on', 'pet:goto'], // { id, x, run }
  ['onPoint', 'on', 'pet:point'], // { on, x, y, label, dir }
  ['onCarry', 'on', 'pet:carry'], // { id, from, to }
  ['onProp', 'on', 'pet:prop'], // { key, on }
  ['onFx', 'on', 'pet:fx'], // { type: 'paper' | 'confetti', … }
  ['onMood', 'on', 'pet:mood'], // 'idle' | 'wait' | 'busy' | 'sleep'
  ['onReset', 'on', 'pet:reset'],
  ['onSound', 'on', 'pet:sound'],
];

class PetFrame {
  constructor(host) {
    this.host = host;
    this.listeners = {};
    this.iframe = null;
    this.win = null;
    this.dead = false;
  }

  mount(parent, opts = {}) {
    const doc = parent.ownerDocument;
    const iframe = doc.createElement('iframe');
    iframe.className = 'lwt-frame lwt-frame-pet';
    iframe.setAttribute('title', 'LLM Wiki Tutor');
    iframe.setAttribute('allowtransparency', 'true');
    iframe.setAttribute('scrolling', 'no');
    parent.appendChild(iframe);
    this.iframe = iframe;
    const win = iframe.contentWindow;
    this.win = win;
    const d = win.document;
    // 빈 iframe(about:blank) 문서에 화면 뼈대를 넣는다. 글은 전부 이 플러그인이 가진 고정 HTML 이다
    const parsed = new win.DOMParser().parseFromString(`<!doctype html><html><head><meta charset="utf-8"><title>LLM Wiki Tutor</title></head><body>${ASSETS.petBody}</body></html>`, 'text/html');
    d.replaceChild(d.importNode(parsed.documentElement, true), d.documentElement);
    d.documentElement.lang = (this.host.T && this.host.T.locale) || 'ko';
    d.documentElement.className = `${opts.dark ? 'theme-dark' : 'theme-light'} lwt-pet`;
    const style = d.createElement('style');
    style.textContent = ASSETS.petCss + '\n' + (opts.fontCss || '');
    d.head.appendChild(style);
    win.pet = this.api();
    this.run();
    return iframe;
  }

  // 화면 코드를 돌린다. 빌드할 때 한 함수로 묶어 두었고(scripts/build.js 의 run), iframe 의 window·document·window.pet 을 넘겨서 부른다.
  // 런타임에 스크립트를 꽂거나 eval 하지 않는다
  run() {
    const win = this.win;
    try {
      ASSETS.run(win, win.document, win.pet);
      win.__lwtLoaded = true;
    } catch (e) {
      this.failed = true;
      console.error('[LLM Wiki Tutor] screen', e);
    }
  }

  clone(v) {
    if (v === undefined || v === null || typeof v !== 'object') return v;
    try {
      return this.win.structuredClone(v);
    } catch {
      try {
        return this.win.JSON.parse(JSON.stringify(v));
      } catch {
        return v;
      }
    }
  }

  api() {
    const api = {};
    for (const [name, type, ch] of API) {
      if (type === 'on') {
        api[name] = (fn) => {
          (this.listeners[ch] ||= new Set()).add(fn);
          return () => this.listeners[ch] && this.listeners[ch].delete(fn);
        };
      } else {
        // IPC 처럼 한 박자 늦게 보낸다 (보내는 쪽 코드가 끝난 다음에 받는다)
        api[name] = (...args) => {
          const a = args.map((x) => (x && typeof x === 'object' ? JSON.parse(JSON.stringify(x)) : x));
          setTimeout(() => !this.dead && this.host.onSend(ch, this, ...a), 0);
        };
      }
    }
    return api;
  }

  emit(ch, payload) {
    if (this.dead || !this.win) return;
    const set = this.listeners[ch];
    if (!set || !set.size) return;
    const p = this.clone(payload);
    for (const fn of [...set]) {
      try {
        fn(p);
      } catch (e) {
        console.error('[LLM Wiki Tutor]', ch, e);
      }
    }
  }

  setDark(dark) {
    if (!this.win) return;
    const el = this.win.document.documentElement;
    el.classList.toggle('theme-dark', !!dark);
    el.classList.toggle('theme-light', !dark);
  }

  destroy() {
    this.dead = true;
    this.listeners = {};
    if (this.iframe) this.iframe.remove();
    this.iframe = null;
    this.win = null;
  }
}

module.exports = { PetFrame, API };

};

__defs["plugin/host"] = function (module, exports, require) {
// 펫 판과 플러그인 사이의 호스트. 레슨 엔진은 이 클래스의 say · ask · card · goto · point · carry · prop · act · fx · mood 만 쓴다.
// 펫 판이 보내는 것(pet:*)은 onSend 로 받는다. 기다리는 일(말풍선 끝 · 대답 · 도착)은 id 로 묶어 Promise 로 돌려준다.
const { Menu } = require('obsidian');
const anchors = require('./anchors');

// 이보다 넓은 자리(가로 × 세로, px²)는 화살표 대신 테두리 상자로 가리킨다. 아이콘 하나 · 탐색기 한 줄은 이보다 훨씬 작다
const BOX_AREA = 15000;

class TutorHost {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.pet = null;
    this.stage = null;
    this.pending = new Map(); // id → resolve
    this.seq = 0;
  }

  get T() {
    return this.plugin.T;
  }

  attachPet(frame) {
    this.pet = frame;
  }

  detachPet() {
    this.pet = null;
    for (const r of this.pending.values()) r(null);
    this.pending.clear();
  }

  destroy() {
    this.untrackPoint();
    this.detachPet();
  }

  send(ch, payload) {
    if (this.pet) this.pet.emit(ch, payload);
  }

  config() {
    const s = this.plugin.settings;
    return { scale: s.scale, language: s.language, sound: s.sound, fur: 'cheese', ears: 'perk', startX: this.plugin.state.catX };
  }

  pushConfig() {
    this.send('pet:config', this.config());
  }

  nextId() {
    return 'h' + ++this.seq;
  }

  wait(id) {
    return new Promise((resolve) => this.pending.set(id, resolve));
  }

  resolve(id, v) {
    const r = this.pending.get(id);
    if (!r) return;
    this.pending.delete(id);
    r(v);
  }

  // 펫 판 → 플러그인
  onSend(ch, frame, ...a) {
    const stage = this.stage;
    switch (ch) {
      case 'pet:ready':
        this.pushConfig();
        break;
      case 'pet:hover':
        if (stage) stage.setInteractive(!!a[0]);
        break;
      case 'pet:drag':
        if (a[0] === 'start' && stage) stage.setInteractive(true);
        if (a[0] === 'end') {
          if (a[1] && typeof a[1].x === 'number') this.plugin.state.catX = a[1].x;
          this.plugin.saveSoon();
        }
        break;
      case 'pet:poke':
        this.plugin.onPoke();
        break;
      case 'pet:rub':
        break;
      case 'pet:bubble-end':
        this.resolve(a[0], null);
        break;
      case 'pet:bubble-reply':
        this.resolve(a[0], a[1]);
        break;
      case 'pet:card-reply':
        this.resolve(a[0], a[1]);
        break;
      case 'pet:arrived':
        this.resolve(a[0], true);
        break;
      case 'pet:open':
        this.plugin.onOpen();
        break;
      case 'pet:context':
        this.petContextMenu(stage ? stage.lastMouse() : { x: 0, y: 0 });
        break;
      default:
        break;
    }
  }

  /* ── 레슨 엔진이 쓰는 API ── */

  // 말풍선. '앞말||뒷말' 은 두 번에 나눠 말한다. opts.choices 가 있으면 마지막 말풍선에 선택지가 붙고 고른 번호(0·1)로 끝난다.
  // 선택지가 없으면 사용자가 넘길 때 null 로 끝난다. 수업 말은 저절로 넘어가지 않는다. opts.ms 는 kind: 'status'(진행 표시)에만 먹는다
  // opts: { choices, ms, kind, title, figure }. 제목·인포그래픽은 첫 말풍선에, 선택지는 마지막 말풍선에
  say(text, opts = {}) {
    const parts = String(text || '')
      .split('||')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return Promise.resolve(null);
    let last = null;
    parts.forEach((p, i) => {
      const id = this.nextId();
      const isLast = i === parts.length - 1;
      this.send('pet:bubble', {
        id,
        text: p,
        kind: opts.kind || 'lesson',
        title: i === 0 ? opts.title : undefined,
        figure: i === 0 ? opts.figure : undefined,
        ms: isLast ? opts.ms : undefined,
        ask: isLast && opts.choices ? id : undefined,
        choices: isLast ? opts.choices : undefined,
      });
      last = id;
    });
    return this.wait(last);
  }

  ask(text, choices, opts = {}) {
    return this.say(text, { ...opts, choices });
  }

  // 긴 설명 카드. 버튼을 누른 번호로 끝난다 (버튼이 없으면 카드를 눌러 닫을 때 -1)
  card(title, body, buttons = [], figure) {
    const id = this.nextId();
    this.send('pet:card', { id, title, body, buttons, figure });
    return this.wait(id);
  }

  clearBubbles() {
    this.send('pet:bubble-clear');
  }

  locate(anchor, quiet = false) {
    if (!this.stage) return Promise.resolve(null);
    return anchors.locate(this.app, this.stage, anchor, quiet);
  }

  // anchor 의 자리에서 표식 좌표를 정한다
  markerFor(a) {
    const r = this.stage.rect();
    if (a.kind === 'folder' || a.kind === 'file') {
      // 파일 탐색기 줄: 이름 글자 오른쪽에 표식을 두고 왼쪽을 가리킨다
      return { x: a.right + 8, y: a.y, dir: 'left' };
    }
    // 넓은 자리(파일 탐색기 칸 · 아이콘 줄 · 노트 화면 · 그래프 뷰)는 화살표 한 점으로는 어디인지 모호하다. 깜빡이는 테두리 상자로 감싼다
    if (a.width != null && a.width * a.height >= BOX_AREA) {
      const left = Math.max(0, a.left);
      const top = Math.max(0, a.top);
      const right = Math.min(r.width, a.right);
      const bottom = Math.min(r.height, a.bottom);
      return { x: (left + right) / 2, y: (top + bottom) / 2, dir: 'box', box: { x: left, y: top, w: right - left, h: bottom - top } };
    }
    // 무대 아래쪽 30% 안에 있는 것은 위에서 내려다보는 표식으로
    const dir = a.y != null && a.y > r.height * 0.7 ? 'down' : 'up';
    return { x: a.x, y: dir === 'down' ? a.top : a.bottom, dir };
  }

  // 가리키는 동안 자리를 다시 잰다: 노트가 늘거나 폴더가 펼쳐지거나 스크롤 · 창 크기가 바뀌어도 화살표가 따라간다
  trackPoint(anchor, label) {
    this.untrackPoint();
    this.pointTimer = setInterval(async () => {
      const a = await this.locate(anchor, true);
      if (!this.pointTimer) return;
      if (!a) return;
      const p = this.markerFor(a);
      const last = this.pointLast;
      if (last && Math.abs(last.x - p.x) < 1 && Math.abs(last.y - p.y) < 1 && (!p.box || (last.box && Math.abs(last.box.w - p.box.w) < 1 && Math.abs(last.box.h - p.box.h) < 1))) return;
      this.pointLast = p;
      this.send('pet:point', { on: true, ...p, label: label || '', keep: true });
    }, 500);
  }

  untrackPoint() {
    clearInterval(this.pointTimer);
    this.pointTimer = null;
    this.pointLast = null;
  }

  // anchor 아래까지 걸어간다. 못 찾으면 false
  async goto(target, opts = {}) {
    const a = await this.locate(target);
    if (!a) return false;
    const id = this.nextId();
    this.send('pet:goto', { id, x: a.x, run: !!opts.run });
    await this.wait(id);
    return true;
  }

  // anchor 아래로 가서 가리킨다 (표식 + 팔 들기). unpoint() 로 끝낸다. 못 찾으면 false
  async point(anchor, label, opts = {}) {
    const a = await this.locate(anchor);
    if (!a) return false;
    if (!opts.stay) await this.goto(a.x);
    // 걸어가는 사이 자리가 바뀌었을 수 있으니 한 번 더 잰다
    const b = (await this.locate(anchor, true)) || a;
    const p = this.markerFor(b);
    this.pointLast = p;
    this.send('pet:point', { on: true, ...p, label: label || '' });
    this.send('pet:prop', { key: 'point', on: true });
    this.trackPoint(anchor, label);
    return true;
  }

  unpoint() {
    this.untrackPoint();
    this.send('pet:point', { on: false });
    this.send('pet:prop', { key: 'point', on: false });
  }

  // from 에서 종이를 물고 to 에 내려놓는다
  async carry(from, to) {
    const a = await this.locate(from);
    const b = await this.locate(to);
    if (!a || !b) return false;
    const id = this.nextId();
    this.send('pet:carry', { id, from: a.x, to: b.x });
    await this.wait(id);
    return true;
  }

  prop(key, on) {
    this.send('pet:prop', { key, on: !!on });
  }

  // 걸어 둔 자세(모래시계 등)를 전부 내린다
  clearProps() {
    this.send('pet:prop', { key: '*', on: false });
  }

  act(key) {
    this.send('pet:action', key);
  }

  fx(o) {
    this.send('pet:fx', o);
  }

  mood(m) {
    this.send('pet:mood', m);
  }

  sound(s) {
    this.send('pet:sound', s);
  }

  resetPosition() {
    this.plugin.state.catX = null;
    this.plugin.saveSoon();
    this.send('pet:reset');
  }

  // 우클릭: 크기 넷 · 직전 말 · 숨기기 · 자리 초기화
  petContextMenu(pos) {
    const T = this.T;
    const menu = new Menu();
    const cur = this.plugin.settings.scale;
    for (const [key, n] of [['small', 4], ['normal', 5], ['large', 6], ['xlarge', 7]]) {
      menu.addItem((it) =>
        it
          .setTitle((cur === n ? '✓ ' : '') + T.t('menu.size.' + key))
          .setIcon('scaling')
          .onClick(() => this.plugin.setScale(n)),
      );
    }
    menu.addSeparator();
    menu.addItem((it) => it.setTitle(T.t('menu.map')).setIcon('map').onClick(() => this.plugin.openMap()));
    menu.addItem((it) => it.setTitle(T.t('menu.hide')).setIcon('eye-off').onClick(() => this.plugin.hideFor(10 * 60_000)));
    menu.addItem((it) => it.setTitle(T.t('menu.reset')).setIcon('move').onClick(() => this.resetPosition()));
    menu.showAtPosition(pos);
  }
}

module.exports = { TutorHost };

};

__defs["plugin/main"] = function (module, exports, require) {
'use strict';
/*
 * LLM Wiki Tutor — Obsidian plugin
 *
 * 옵시디언 기초와 LLM Wiki 를 가르치는 픽셀 고양이. 작업 영역 바닥을 돌아다니며 말풍선으로 설명하고,
 * 파일 탐색기의 폴더를 가리키고, 파일을 물고 옮기는 연출을 한다.
 *
 * 구조
 *  - src/kit   : 펫 판 (iframe 안에서 돈다). 고양이 렌더러는 Vault Pet 에서 가져왔다
 *  - src/core  : 레슨 데이터 · 엔진 (2단계부터)
 *  - src/plugin: 무대(stage) · iframe 다리(frame) · 호스트(host) · UI 자리 찾기(anchors) · 이 파일
 *
 * 1단계(이 판): 고양이가 걷고 · 말하고 · 선택지를 묻고 · 파일 탐색기 폴더 아래로 가서 가리키고 · 파일을 물고 옮긴다.
 */
const obsidian = require('obsidian');
const { Plugin, PluginSettingTab, Setting, Notice, TFile, TFolder } = obsidian;
const { TutorHost } = require('./host');
const { PetStage } = require('./stage');
const { load: loadStore } = require('./store');
const { confirmWrites } = require('./preview');
const { askPaste } = require('./paste');
const { MapView, VIEW_TYPE: MAP_VIEW } = require('./mapview');
const { askRestart } = require('./restart');
const { LectureNotes } = require('./notes');
const { Habit, DAYS } = require('../core/habit');
const { Checks } = require('../core/checks');
const { Practice } = require('../core/practice');
const { Engine } = require('../core/engine');
const I18N = require('../kit/i18n');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function obsidianLanguage() {
  try {
    if (typeof obsidian.getLanguage === 'function') return String(obsidian.getLanguage() || 'en').toLowerCase();
  } catch {
    // 옛 옵시디언
  }
  return String((window.moment && window.moment.locale()) || document.documentElement.lang || 'en').toLowerCase();
}

class TutorSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const p = this.plugin;
    const T = p.T;
    containerEl.empty();
    new Setting(containerEl)
      .setName(T.t('set.language'))
      .setDesc(T.t('set.languageDesc'))
      .addDropdown((d) =>
        d
          .addOptions({ ko: '한국어', en: 'English', zh: '中文' })
          .setValue(p.settings.language)
          .onChange(async (v) => {
            p.settings.language = v;
            p.T.set(v);
            await p.save();
            p.host.pushConfig();
            this.display();
          }),
      );
    new Setting(containerEl)
      .setName(T.t('set.scale'))
      .setDesc(T.t('set.scaleDesc'))
      .addSlider((s) =>
        s
          .setLimits(3, 8, 1)
          .setValue(p.settings.scale)
          .setDynamicTooltip()
          .onChange(async (v) => {
            p.settings.scale = v;
            await p.save();
            p.host.pushConfig();
          }),
      );
    new Setting(containerEl)
      .setName(T.t('set.showPet'))
      .setDesc(T.t('set.showPetDesc'))
      .addToggle((t) =>
        t.setValue(p.settings.showPet).onChange(async (v) => {
          p.settings.showPet = v;
          await p.save();
          if (v) p.mountStage();
          else p.unmountStage();
        }),
      );
    new Setting(containerEl)
      .setName(T.t('set.sound'))
      .setDesc(T.t('set.soundDesc'))
      .addToggle((t) =>
        t.setValue(p.settings.sound).onChange(async (v) => {
          p.settings.sound = v;
          await p.save();
          p.host.pushConfig();
        }),
      );
    new Setting(containerEl)
      .setName(T.t('set.practiceFolder'))
      .setDesc(T.t('set.practiceFolderDesc'))
      .addText((t) =>
        t
          .setPlaceholder(p.practice.root())
          .setValue(p.settings.practiceFolder || '')
          .onChange(async (v) => {
            p.settings.practiceFolder = v.trim().replace(/[\\/:*?"<>|]/g, '') || null;
            await p.save();
          }),
      );
    new Setting(containerEl)
      .setName(T.t('set.habitCoach'))
      .setDesc(T.t('set.habitCoachDesc'))
      .addToggle((t) =>
        t.setValue(p.settings.habitCoach !== false).onChange(async (v) => {
          p.settings.habitCoach = v;
          await p.save();
        }),
      );
    new Setting(containerEl)
      .setName(T.t('set.ingestDay'))
      .setDesc(T.t('set.ingestDayDesc'))
      .addDropdown((d) => {
        const opts = {};
        for (const k of DAYS) opts[k] = T.t('day.' + k);
        d.addOptions(opts)
          .setValue(p.settings.ingestDay || 'fri')
          .onChange(async (v) => {
            p.settings.ingestDay = v;
            await p.save();
          });
      });
    new Setting(containerEl)
      .setName(T.t('set.yieldVaultPet'))
      .setDesc(T.t('set.yieldVaultPetDesc'))
      .addToggle((t) =>
        t.setValue(p.settings.yieldVaultPet !== false).onChange(async (v) => {
          p.settings.yieldVaultPet = v;
          await p.save();
        }),
      );
    containerEl.createDiv({ cls: 'lwt-disclaimer', text: 'The cat renderer comes from Vault Pet (MIT). No network access.' });
  }
}

class TutorPlugin extends Plugin {
  async onload() {
    const data = loadStore(await this.loadData());
    this.settings = data.settings;
    this.state = data.state;
    if (!(await this.loadData())) {
      const ol = obsidianLanguage();
      this.settings.language = ol.startsWith('ko') ? 'ko' : ol.startsWith('zh') ? 'zh' : 'en';
    }
    this.T = new I18N.Strings(this.settings.language);
    this.host = new TutorHost(this);
    this.checks = new Checks(this.app);
    this.practice = new Practice(this);
    this.engine = new Engine(this);
    this.notes = new LectureNotes(this);
    this.habit = new Habit(this);
    this.stage = null;
    this.saveTimer = null;
    this.running = false; // 1단계 데모가 도는 중

    this.registerView(MAP_VIEW, (leaf) => new MapView(leaf, this));
    this.addSettingTab(new TutorSettingTab(this.app, this));
    this.addRibbonIcon('cat', 'LLM Wiki Tutor', () => this.onOpen());
    const T = this.T;
    this.addCommand({ id: 'open', name: T.t('cmd.open'), callback: () => this.onOpen() });
    this.addCommand({ id: 'map', name: T.t('cmd.map'), callback: () => this.openMap() });
    this.addCommand({ id: 'resume', name: T.t('cmd.resume'), callback: () => this.withStage(() => this.engine.resume()) });
    this.addCommand({ id: 'restart', name: T.t('cmd.restart'), callback: () => this.restartPrompt() });
    this.addCommand({ id: 'skip', name: T.t('cmd.skip'), callback: () => this.withStage(() => this.engine.skip()) });
    this.addCommand({ id: 'stop', name: T.t('cmd.stop'), callback: () => this.engine.stop() });
    this.addCommand({ id: 'undo', name: T.t('cmd.undo'), callback: () => this.undoCurrent() });
    this.addCommand({ id: 'demo', name: T.t('cmd.demo'), callback: () => this.demo() });

    // 볼트 · 작업 영역 이벤트 → 조건 판정 (+ 습관 코치의 '오늘 raw 에 손댔나')
    const feed = (f) => {
      this.checks.feed();
      if (f && (this.habit.graduated() || this.state.habit)) this.habit.onVaultChange(f);
    };
    const { vault, workspace } = this.app;
    for (const ev of ['create', 'modify', 'delete', 'rename']) this.registerEvent(vault.on(ev, feed));
    // 습관 코치: 1분마다 본다 (졸업 전엔 바로 돌아온다)
    this.registerInterval(window.setInterval(() => this.habit.tick().catch((e) => console.error('[LLM Wiki Tutor] habit', e)), 60_000));
    for (const ev of ['file-open', 'layout-change', 'active-leaf-change']) this.registerEvent(workspace.on(ev, feed));
    this.registerEvent(this.app.metadataCache.on('resolved', feed));
    this.addCommand({ id: 'reset-position', name: this.T.t('cmd.resetPosition'), callback: () => this.host.resetPosition() });
    this.addCommand({
      id: 'toggle-pet',
      name: this.T.t('cmd.togglePet'),
      callback: async () => {
        this.settings.showPet = !this.settings.showPet;
        await this.save();
        if (this.settings.showPet) this.mountStage();
        else this.unmountStage();
      },
    });

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.showPet) this.mountStage();
    });
    this.registerEvent(this.app.workspace.on('css-change', () => this.applyTheme()));
  }

  onunload() {
    clearTimeout(this.saveTimer);
    if (this.engine) this.engine.stop();
    this.yieldVaultPet(false);
    this.unmountStage();
    if (this.host) this.host.destroy();
  }

  /* ── 진행 지도 ── */

  async openMap() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(MAP_VIEW)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: MAP_VIEW, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  // 엔진이 한 단계 넘길 때마다. 열린 진행 지도를 다시 그린다
  progressChanged() {
    for (const leaf of this.app.workspace.getLeavesOfType(MAP_VIEW)) if (leaf.view && leaf.view.render) leaf.view.render();
  }

  // 필기 노트가 바뀌었다 (plugin/notes.js). 열린 진행 지도의 필기 칸만 고친다
  notesChanged(ev) {
    for (const leaf of this.app.workspace.getLeavesOfType(MAP_VIEW)) if (leaf.view && leaf.view.onNotes) leaf.view.onNotes(ev);
  }

  // "수업 처음부터": 수업만 / 노트까지 / 취소
  async restartPrompt() {
    const r = await askRestart(this.app, this.T, this.practice.root());
    if (!r) return;
    this.engine.stop();
    if (r === 'wipe') {
      const n = await this.practice.wipe();
      new Notice(this.T.t('restart.wiped', { n }));
    }
    this.withStage(() => this.engine.restart());
  }

  async setScale(n) {
    this.settings.scale = n;
    await this.save();
    this.host.pushConfig();
  }

  async undoCurrent() {
    const T = this.T;
    const id = this.engine.progress.lessonId;
    this.engine.stop();
    const n = id ? await this.practice.undo(id) : 0;
    await this.save();
    this.progressChanged();
    new Notice(n ? T.t('engine.undone', { n }) : T.t('engine.nothingToUndo'));
  }

  // Vault Pet 이 같이 켜져 있으면 수업 중엔 그쪽 고양이가 비킨다 (hideFor 는 Vault Pet 2.0.0 의 공개 메서드)
  yieldVaultPet(on) {
    clearInterval(this.yieldTimer);
    this.yieldTimer = null;
    const vp = this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins['vault-pet'];
    const host = vp && vp.host;
    if (!host) return;
    if (on && this.settings.yieldVaultPet !== false) {
      const hide = () => {
        try {
          if (host.hideFor) host.hideFor(70_000);
        } catch {
          // Vault Pet 쪽이 바뀌었을 수 있다
        }
      };
      hide();
      this.yieldTimer = setInterval(hide, 60_000);
    } else {
      try {
        if (host.showPet) host.showPet();
      } catch {
        // 무시
      }
    }
  }

  // 고양이가 없으면 띄우고 나서 한다
  withStage(fn) {
    if (!this.stage) {
      this.settings.showPet = true;
      this.mountStage();
    }
    return fn();
  }

  confirmWrites(items) {
    return confirmWrites(this.app, this.T, items);
  }

  askPaste(opts) {
    return askPaste(this.app, this.T, opts);
  }

  notice(text, ms = 4000) {
    new Notice(text, ms);
  }

  async save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.saveData({ version: 1, settings: this.settings, state: this.state });
  }

  saveSoon() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 1500);
  }

  isDark() {
    return document.body.classList.contains('theme-dark');
  }

  applyTheme() {
    if (this.stage && this.stage.frame) this.stage.frame.setDark(this.isDark());
  }

  mountStage() {
    if (this.stage) return;
    this.stage = new PetStage(this, this.host);
    this.host.stage = this.stage;
    this.stage.mount();
  }

  unmountStage() {
    if (!this.stage) return;
    this.stage.unmount();
    this.stage = null;
    this.host.stage = null;
  }

  hideFor(ms) {
    if (!this.stage) return;
    this.stage.setHidden(true);
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.stage && this.stage.setHidden(false), ms);
  }

  onPoke() {
    if (this.running || this.engine.running) return;
    const n = Math.floor(Math.random() * 3);
    this.host.say(this.T.t(`poke.${n}`), { ms: 2500 });
  }

  // 리본 · 더블클릭: 진행 지도를 열고, 수업을 시작하거나 이어 한다
  onOpen() {
    this.openMap();
    if (this.engine.running) return;
    this.withStage(() => this.engine.resume());
  }

  /* ── 1단계 데모: 고양이가 걷고 · 말하고 · 묻고 · 폴더를 가리키고 · 파일을 옮긴다 ── */

  demoTargets() {
    const all = this.app.vault.getAllLoadedFiles();
    const folder = all.find((f) => f instanceof TFolder && f.name === 'raw') || all.find((f) => f instanceof TFolder && f.path !== '/');
    const file = all.find((f) => f instanceof TFile && f.extension === 'md' && !(folder && f.path.startsWith(folder.path + '/')));
    return { folder: folder ? 'folder:' + folder.path : null, file: file ? 'file:' + file.path : null };
  }

  async demo() {
    if (this.running) return;
    if (!this.stage) this.mountStage();
    this.running = true;
    const h = this.host;
    const t = (k) => this.T.t(k);
    try {
      h.clearBubbles();
      h.unpoint();
      h.mood('idle');
      await h.say(t('demo.hello'));
      const i = await h.ask(t('demo.ask'), [t('demo.yes'), t('demo.no')]);
      await h.say(i === 0 ? t('demo.first') : t('demo.notFirst'), { ms: 2600 });

      const { folder, file } = this.demoTargets();
      await h.say(t('demo.goFolder'), { ms: 2200 });
      const ok = folder && (await h.point(folder, t('demo.point')));
      if (!ok) await h.say(t('demo.noExplorer'));
      else await sleep(2600);
      h.unpoint();

      if (ok && file) {
        await h.say(t('demo.carry'), { ms: 2200 });
        await h.carry(file, folder);
      }
      h.mood('busy');
      await h.say(t('demo.busy'), { ms: 2600 });
      h.mood('idle');
      h.fx({ type: 'confetti' });
      await h.say(t('demo.done'), { kind: 'cheer', ms: 3500 });
    } catch (e) {
      console.error('[LLM Wiki Tutor] demo', e);
      new Notice('LLM Wiki Tutor: demo failed (see console)');
    } finally {
      this.running = false;
    }
  }
}

module.exports = TutorPlugin;

};

__defs["plugin/mapview"] = function (module, exports, require) {
// 진행 지도. 오른쪽 사이드바. 위에 도넛(한 칸 = 레슨 하나), 아래 두 코스 목록과 처음부터, 맨 아래 필기 노트.
// 위쪽(mainEl)은 단계가 넘어갈 때마다 다시 그린다. 필기 노트 칸(notesEl)은 따로 두고 한 줄씩 덧붙인다 (쓰는 중인 글이 끊기지 않게).
const { ItemView } = require('obsidian');

const VIEW_TYPE = 'llm-wiki-tutor-map';
const WRITE_MS = 24; // 한 글자 쓰는 시간. 말풍선 타자 속도(kit/pet.js)와 같다

// **굵게** · `코드` 만 받는 작은 마크다운을 DOM 으로
function fillInline(el, text) {
  el.empty();
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let at = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > at) el.appendText(text.slice(at, m.index));
    if (m[1] != null) el.createEl('strong', { text: m[1] });
    else el.createEl('code', { text: m[2] });
    at = m.index + m[0].length;
  }
  if (at < text.length) el.appendText(text.slice(at));
}
const plain = (t) => String(t).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');

// 필기 한 줄의 모양 (core/lessons/notes.js 머리말): '## 소제목' · '1. 번호 줄' · '말 — 설명' · 그 밖은 점 목록
const NUM_RE = /^(\d+[.)]) (.*)$/;
function noteKind(text) {
  if (text.startsWith('## ')) return 'head';
  return NUM_RE.test(text) ? 'num' : 'item';
}
function setNoteKind(li, text) {
  const kind = noteKind(text);
  li.toggleClass('is-head', kind === 'head');
  li.toggleClass('is-num', kind === 'num');
}
// 쓰는 동안 보일 글자 (꾸밈 기호 없이)
const notePlain = (text) => plain(text.replace(/^## /, ''));
function fillNote(li, text) {
  setNoteKind(li, text);
  li.empty();
  let body = text.replace(/^## /, '');
  const m = noteKind(text) === 'num' && body.match(NUM_RE);
  if (m) {
    li.createSpan({ cls: 'lwt-note-num', text: m[1] });
    body = m[2];
  }
  const at = body.indexOf(' — ');
  if (at > 0) {
    fillInline(li.createSpan({ cls: 'lwt-note-key' }), body.slice(0, at));
    fillInline(li.createSpan({ cls: 'lwt-note-desc' }), body.slice(at + 3));
  } else fillInline(li.createSpan(), body);
}

class MapView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return this.plugin.T.t('map.title');
  }

  getIcon() {
    return 'map';
  }

  async onOpen() {
    this.contentEl.addClass('lwt-map');
    this.mainEl = this.contentEl.createDiv();
    this.notesEl = this.contentEl.createDiv({ cls: 'lwt-notes' });
    this.writing = []; // 써야 할 줄 { li, text }
    this.writeTimer = null;
    this.render();
  }

  async onClose() {
    this.stopWriting();
    this.contentEl.empty();
  }

  // 도넛: 레슨 수만큼 칸. 끝난 칸은 진하게, 지금 칸은 강조, 나머지는 옅게
  donut(el, lessons, finished, cur) {
    const n = lessons.length;
    const R = 44;
    const r = 30;
    const C = 56;
    const gap = 0.045; // 칸 사이 틈 (라디안)
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 112 112');
    svg.setAttribute('class', 'lwt-donut');
    const arc = (a0, a1, cls) => {
      const p = (a, rad) => [C + Math.cos(a) * rad, C + Math.sin(a) * rad];
      const [x0, y0] = p(a0, R);
      const [x1, y1] = p(a1, R);
      const [x2, y2] = p(a1, r);
      const [x3, y3] = p(a0, r);
      const big = a1 - a0 > Math.PI ? 1 : 0;
      const d = `M${x0},${y0} A${R},${R} 0 ${big} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${big} 0 ${x3},${y3} Z`;
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'lwt-donut-seg ' + cls);
      svg.appendChild(path);
    };
    lessons.forEach((l, i) => {
      const a0 = -Math.PI / 2 + (i / n) * Math.PI * 2 + gap / 2;
      const a1 = -Math.PI / 2 + ((i + 1) / n) * Math.PI * 2 - gap / 2;
      arc(a0, a1, finished.has(l.id) ? 'is-done' : l.id === cur ? 'is-cur' : 'is-todo');
    });
    const done = lessons.filter((l) => finished.has(l.id)).length;
    const pct = Math.round((done / n) * 100);
    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', '56');
    text.setAttribute('y', '60');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'lwt-donut-pct');
    text.textContent = `${pct}%`;
    svg.appendChild(text);
    const sub = document.createElementNS(ns, 'text');
    sub.setAttribute('x', '56');
    sub.setAttribute('y', '74');
    sub.setAttribute('text-anchor', 'middle');
    sub.setAttribute('class', 'lwt-donut-sub');
    sub.textContent = `${done} / ${n}`;
    svg.appendChild(sub);
    el.appendChild(svg);
  }

  render() {
    const { mainEl: el, plugin } = this;
    if (!el) return;
    const T = plugin.T;
    const E = plugin.engine;
    const p = E.progress;
    const lessons = E.lessons();
    const finished = new Set(p.finished || []);
    const cur = p.lessonId;
    el.empty();

    // 머리: 도넛 + 지금 레슨 + 버튼
    const head = el.createDiv({ cls: 'lwt-map-head' });
    this.donut(head.createDiv({ cls: 'lwt-map-donut' }), lessons, finished, cur);
    const now = head.createDiv({ cls: 'lwt-map-now' });
    const curL = E.lesson(cur);
    const allDone = lessons.every((l) => finished.has(l.id));
    now.createDiv({ cls: 'lwt-map-eyebrow', text: allDone ? T.t('map.allDone') : curL ? T.t('map.nowLabel') : T.t('map.notStarted') });
    now.createDiv({ cls: 'lwt-map-now-title', text: allDone ? T.t('map.allDoneSub') : curL ? E.text(curL.title) : T.t('map.notStartedSub') });
    if (curL && !allDone) now.createDiv({ cls: 'lwt-map-now-sub', text: T.t('map.stepOf', { n: Math.min(p.stepIndex + 1, curL.steps.length), total: curL.steps.length, min: curL.minutes }) });
    const btn = now.createEl('button', { cls: 'mod-cta lwt-map-go', text: E.running ? T.t('map.running') : allDone ? T.t('map.replay') : cur ? T.t('cmd.resume') : T.t('map.start') });
    btn.disabled = E.running;
    btn.addEventListener('click', () => (allDone ? plugin.restartPrompt() : plugin.withStage(() => E.resume())));

    // 목록
    const courses = [
      { id: 'A', name: T.t('map.courseA'), list: lessons.filter((l) => l.course === 'A') },
      { id: 'B', name: T.t('map.courseB'), list: lessons.filter((l) => l.course === 'B') },
    ];
    // 코스마다 접었다 펴기. 정한 적 없으면 다 마친 코스만 접어 둔다
    const fold = (plugin.state.mapFold = plugin.state.mapFold || {});
    for (const c of courses) {
      const done = c.list.filter((l) => finished.has(l.id)).length;
      const folded = fold[c.id] ?? done === c.list.length;
      const sec = el.createDiv({ cls: 'lwt-map-course' + (folded ? ' is-folded' : '') });
      const h = sec.createDiv({ cls: 'lwt-map-course-head' });
      h.setAttr('role', 'button');
      h.setAttr('aria-expanded', String(!folded));
      h.createSpan({ cls: 'lwt-map-fold', text: '▾' });
      h.createSpan({ cls: 'lwt-map-course-name', text: c.name });
      h.createSpan({ cls: 'lwt-map-count', text: `${done}/${c.list.length}` });
      h.addEventListener('click', () => {
        fold[c.id] = !folded;
        plugin.saveSoon();
        this.render();
      });
      // 기초 코스 건너뛰기: 들은 걸로 치고, 그 코스에서 만들었을 노트를 만들어 둔다
      if (c.id === 'A' && done < c.list.length) {
        const skip = h.createEl('button', { cls: 'lwt-map-skip', text: T.t('map.skipA') });
        skip.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          if (await E.skipCourse('A')) plugin.notice(T.t('map.skippedA'));
        });
      }
      const rows = sec.createDiv({ cls: 'lwt-map-rows' });
      for (const l of c.list) {
        const locked = !finished.has(l.id) && l.id !== cur && !!E.blocker(l.id);
        const state = finished.has(l.id) ? 'done' : l.id === cur ? 'cur' : locked ? 'locked' : 'todo';
        const row = rows.createDiv({ cls: `lwt-map-lesson is-${state}` });
        row.createSpan({ cls: 'lwt-map-mark' });
        row.createSpan({ cls: 'lwt-map-id', text: l.id });
        row.createSpan({ cls: 'lwt-map-name', text: E.text(l.title) });
        row.createSpan({ cls: 'lwt-map-min', text: locked ? '🔒' : `${l.minutes}′` });
        if (locked) row.setAttr('aria-label', E.lockedText(l.id));
        row.addEventListener('click', () => (locked ? plugin.notice(E.lockedText(l.id)) : plugin.withStage(() => E.start(l.id))));
      }
    }

    const foot = el.createDiv({ cls: 'lwt-map-foot' });
    const reset = foot.createEl('button', { cls: 'lwt-map-reset', text: T.t('cmd.restart') });
    reset.addEventListener('click', () => plugin.restartPrompt());

    // 레슨이 바뀌었으면 필기 칸도 그 레슨으로
    if (this.notesLesson !== cur) this.renderNotes();
  }

  /* ── 필기 노트 ── */

  stopWriting() {
    clearInterval(this.writeTimer);
    this.writeTimer = null;
    this.writing = [];
  }

  // 필기 칸 전체를 지금 적힌 줄로 다시 그린다 (쓰는 연출 없이)
  renderNotes() {
    const { notesEl: el, plugin } = this;
    if (!el) return;
    const T = plugin.T;
    const E = plugin.engine;
    const N = plugin.notes;
    this.stopWriting();
    el.empty();
    const id = E.progress.lessonId;
    this.notesLesson = id;
    const L = E.lesson(id);
    const all = N.all(id);
    const lines = N.lines();

    const head = el.createDiv({ cls: 'lwt-notes-head' });
    head.createSpan({ cls: 'lwt-notes-title', text: T.t('notes.title') });
    if (all.length) {
      const btn = head.createEl('button', { cls: 'lwt-notes-all', text: T.t('notes.showAll') });
      btn.disabled = all.every((t) => lines.includes(t));
      btn.addEventListener('click', () => N.showAll());
      this.allBtn = btn;
    } else this.allBtn = null;

    const page = el.createDiv({ cls: 'lwt-notes-page' });
    if (L) page.createDiv({ cls: 'lwt-notes-lesson', text: `${L.id} · ${E.text(L.title)}` });
    this.emptyEl = page.createDiv({ cls: 'lwt-notes-empty', text: all.length ? T.t('notes.empty') : T.t('notes.none') });
    this.emptyEl.toggleClass('is-hidden', lines.length > 0);
    this.listEl = page.createEl('ul', { cls: 'lwt-notes-list' });
    for (const t of lines) fillNote(this.listEl.createEl('li', { cls: 'lwt-note' }), t);
  }

  // plugin/notes.js 가 알려 준다: reset · all 은 다시 그리고, add 는 한 줄을 말풍선 속도로 써 넣는다
  onNotes(ev) {
    if (!this.notesEl) return;
    if (ev.type !== 'add' || this.notesLesson !== this.plugin.engine.progress.lessonId || !this.listEl) return this.renderNotes();
    this.emptyEl.addClass('is-hidden');
    const li = this.listEl.createEl('li', { cls: 'lwt-note is-writing' });
    setNoteKind(li, ev.text);
    this.writing.push({ li, text: ev.text });
    if (this.allBtn) this.allBtn.disabled = this.plugin.notes.all().every((t) => this.plugin.notes.lines().includes(t));
    this.pumpWriting();
  }

  pumpWriting() {
    if (this.writeTimer || !this.writing.length) return;
    const { li, text } = this.writing.shift();
    const chars = [...notePlain(text)];
    let i = 0;
    li.scrollIntoView({ block: 'nearest' });
    this.writeTimer = setInterval(() => {
      li.setText(chars.slice(0, ++i).join(''));
      if (i < chars.length) return;
      clearInterval(this.writeTimer);
      this.writeTimer = null;
      fillNote(li, text);
      li.removeClass('is-writing');
      this.pumpWriting();
    }, WRITE_MS);
  }
}

module.exports = { MapView, VIEW_TYPE };

};

__defs["plugin/notes"] = function (module, exports, require) {
// 필기 노트. 고양이가 설명하는 동안 진행 지도(mapview.js) 아래 칸에 핵심만 한 줄씩 적는다.
//
// - 레슨 단계에 note 가 있으면(core/lessons) 그 단계가 시작될 때 한 줄을 적는다. 말풍선과 같은 속도로 써진다(쓰는 연출은 mapview).
// - 말풍선을 "← 이전"으로 되돌려도 지우지 않는다. 같은 줄은 두 번 적지 않는다.
// - 레슨을 처음부터 열면(레슨 머리말이 나올 때) 빈 노트로 다시 시작한다. 중간에 멈췄다 이어 하면 적힌 데까지 남아 있다.
// - "한번에 보기"는 그 레슨의 필기를 전부 한꺼번에 적는다.
// 적힌 줄은 data.json 의 state.notes = { lessonId, lines: [글] } 에 둔다.
'use strict';

class LectureNotes {
  constructor(plugin) {
    this.plugin = plugin;
  }

  get state() {
    const s = this.plugin.state;
    if (!s.notes || typeof s.notes !== 'object' || !Array.isArray(s.notes.lines)) s.notes = { lessonId: null, lines: [] };
    return s.notes;
  }

  // 지금 진행 지도에 보일 레슨 (진행 중인 레슨)
  get lessonId() {
    return this.plugin.engine.progress.lessonId || null;
  }

  // 지금 레슨의 적힌 줄. 다른 레슨의 필기가 남아 있으면 빈 것으로 본다
  lines() {
    const st = this.state;
    return st.lessonId === this.lessonId ? st.lines.slice() : [];
  }

  // 레슨의 필기 전부 (단계 순서대로, 분기 · fallback 안까지)
  all(lessonId = this.lessonId) {
    const E = this.plugin.engine;
    const L = E.lesson(lessonId);
    if (!L) return [];
    const out = [];
    const walk = (steps) => {
      for (const s of steps || []) {
        for (const n of [].concat(s.note || [])) {
          const t = E.text(n);
          if (t && !out.includes(t)) out.push(t);
        }
        if (s.then) walk(s.then);
        if (s.else) walk(s.else);
        if (s.fallback) walk([s.fallback]);
      }
    };
    walk(L.steps);
    return out;
  }

  // 레슨을 처음부터 연다: 빈 노트
  open(lessonId) {
    const st = this.state;
    st.lessonId = lessonId;
    st.lines = [];
    this.plugin.saveSoon();
    this.emit({ type: 'reset' });
  }

  // 한 줄 적기 (말풍선 속도로 써지는 건 mapview 가 한다)
  write(lessonId, text) {
    if (!text) return;
    const st = this.state;
    if (st.lessonId !== lessonId) this.open(lessonId);
    if (st.lines.includes(text)) return;
    st.lines.push(text);
    this.plugin.saveSoon();
    this.emit({ type: 'add', text });
  }

  // 한번에 보기: 이 레슨 필기를 전부 적는다
  showAll() {
    const id = this.lessonId;
    if (!id) return;
    const st = this.state;
    const all = this.all(id);
    const have = st.lessonId === id ? st.lines : [];
    st.lessonId = id;
    st.lines = [...all, ...have.filter((t) => !all.includes(t))];
    this.plugin.saveSoon();
    this.emit({ type: 'all' });
  }

  emit(ev) {
    this.plugin.notesChanged(ev);
  }
}

module.exports = { LectureNotes };

};

__defs["plugin/paste"] = function (module, exports, require) {
// 복붙 길의 붙여넣기 창. AI 의 답을 여기에 붙여넣으면 엔진이 쪽으로 쪼갠다. 클립보드를 몰래 읽지 않는다
const { Modal } = require('obsidian');

class PasteModal extends Modal {
  constructor(app, T, resolve, opts = {}) {
    super(app);
    this.T = T;
    this.resolve = resolve;
    this.opts = opts;
    this.answered = false;
  }

  onOpen() {
    const { contentEl, T } = this;
    contentEl.addClass('lwt-paste');
    contentEl.createEl('h3', { text: this.opts.title || T.t('paste.title') });
    contentEl.createEl('p', { cls: 'lwt-paste-help', text: this.opts.help || T.t('paste.help') });
    const ta = contentEl.createEl('textarea', { cls: 'lwt-paste-area', attr: { rows: '14', placeholder: T.t('paste.placeholder') } });
    const btns = contentEl.createDiv({ cls: 'lwt-preview-buttons' });
    const ok = btns.createEl('button', { cls: 'mod-cta', text: T.t('paste.apply') });
    const no = btns.createEl('button', { text: T.t('paste.later') });
    ok.addEventListener('click', () => this.answer(ta.value));
    no.addEventListener('click', () => this.answer(null));
    setTimeout(() => ta.focus(), 0);
  }

  answer(v) {
    if (this.answered) return;
    this.answered = true;
    this.resolve(v);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
    if (!this.answered) this.answer(null);
  }
}

function askPaste(app, T, opts) {
  return new Promise((resolve) => new PasteModal(app, T, resolve, opts).open());
}

module.exports = { askPaste };

};

__defs["plugin/preview"] = function (module, exports, require) {
// 쓰기 미리보기 · 승인 모달. 볼트에 뭔가 만들기 전에 무엇을 만드는지 보여 주고 허락을 받는다
const { Modal } = require('obsidian');

class PreviewModal extends Modal {
  constructor(app, T, items, resolve) {
    super(app);
    this.T = T;
    this.items = items;
    this.resolve = resolve;
    this.answered = false;
  }

  onOpen() {
    const { contentEl, T } = this;
    contentEl.addClass('lwt-preview');
    // 전부 wiki 안에 쓰는 거면(요리 · 청소 · 규칙 반영) 재료로 위키 노트를 만든다고 말한다
    const wikiOnly = this.items.length > 0 && this.items.every((it) => /(^|\/)wiki(\/|$)/.test(it.path) && it.op !== 'folder');
    contentEl.createEl('h3', { text: T.t(wikiOnly ? 'preview.titleWiki' : 'preview.title') });
    const list = contentEl.createDiv({ cls: 'lwt-preview-list' });
    for (const it of this.items) {
      const row = list.createDiv({ cls: 'lwt-preview-item' });
      row.createDiv({ cls: 'lwt-preview-path', text: (it.op === 'folder' ? '📁 ' : it.op === 'append' ? '＋ ' : '📄 ') + (it.label || it.path) });
      if (it.content) {
        const lines = it.content.split('\n');
        row.createEl('pre', { cls: 'lwt-preview-body', text: lines.slice(0, 8).join('\n') + (lines.length > 8 ? '\n…' : '') });
      }
    }
    const btns = contentEl.createDiv({ cls: 'lwt-preview-buttons' });
    const ok = btns.createEl('button', { cls: 'mod-cta', text: T.t('preview.apply') });
    const no = btns.createEl('button', { text: T.t('preview.cancel') });
    ok.addEventListener('click', () => this.answer(true));
    no.addEventListener('click', () => this.answer(false));
    setTimeout(() => ok.focus(), 0);
  }

  answer(v) {
    if (this.answered) return;
    this.answered = true;
    this.resolve(v);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
    if (!this.answered) this.answer(false);
  }
}

function confirmWrites(app, T, items) {
  return new Promise((resolve) => new PreviewModal(app, T, items, resolve).open());
}

module.exports = { confirmWrites };

};

__defs["plugin/restart"] = function (module, exports, require) {
// "수업 처음부터": 수업만 처음부터 / 노트까지 초기화 / 취소
const { Modal } = require('obsidian');

class RestartModal extends Modal {
  constructor(app, T, root, resolve) {
    super(app);
    this.T = T;
    this.root = root;
    this.resolve = resolve;
    this.answered = false;
  }

  onOpen() {
    const { contentEl, T } = this;
    contentEl.addClass('lwt-restart');
    contentEl.createEl('h3', { text: T.t('restart.title') });
    contentEl.createEl('p', { text: T.t('restart.body', { root: this.root }) });
    const btns = contentEl.createDiv({ cls: 'lwt-preview-buttons' });
    const only = btns.createEl('button', { cls: 'mod-cta', text: T.t('restart.lessonsOnly') });
    const wipe = btns.createEl('button', { cls: 'mod-warning', text: T.t('restart.wipeNotes') });
    const no = btns.createEl('button', { text: T.t('preview.cancel') });
    only.addEventListener('click', () => this.answer('lessons'));
    wipe.addEventListener('click', () => this.answer('wipe'));
    no.addEventListener('click', () => this.answer(null));
    setTimeout(() => only.focus(), 0);
  }

  answer(v) {
    if (this.answered) return;
    this.answered = true;
    this.resolve(v);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
    if (!this.answered) this.answer(null);
  }
}

function askRestart(app, T, root) {
  return new Promise((resolve) => new RestartModal(app, T, root, resolve).open());
}

module.exports = { askRestart };

};

__defs["plugin/stage"] = function (module, exports, require) {
// 펫 무대. Vault Pet 의 stage.js 를 그대로 가져왔다 (클래스 이름만 바꿈).
// 옵시디언 작업 영역(.workspace) 위에 투명한 iframe 을 한 장 덮는다. 바닥은 작업 영역 맨 아래(상태 표시줄 바로 위)다.
//
// 클릭 통과: iframe 을 pointer-events: none 으로 두고, 옵시디언 쪽에서 받은 mousemove 를 iframe 안으로 흘려 넣는다.
// 고양이·말풍선·카드 위에 올라가면 펫 판이 hover(true) 를 보내고, 그때만 iframe 이 마우스를 받는다.
const { PetFrame } = require('./frame');

class PetStage {
  constructor(plugin, host) {
    this.plugin = plugin;
    this.host = host;
    this.el = null;
    this.frame = null;
    this.hidden = false;
    this.interactive = false;
    this.mouse = null;
    this.dragInset = 0;
    this.cleanup = [];
  }

  mount() {
    if (this.el) return;
    const doc = document;
    const el = doc.body.createDiv({ cls: 'lwt-stage' });
    this.el = el;
    this.fit();
    const frame = new PetFrame(this.host);
    frame.mount(el, { dark: this.plugin.isDark() });
    this.frame = frame;
    this.setInteractive(false);
    this.host.attachPet(frame);

    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn, opts));
    };
    on(doc, 'mousemove', (e) => this.forward(e), { capture: true, passive: true });
    on(doc.documentElement, 'mouseleave', () => this.leave(), { passive: true });
    on(window, 'blur', () => this.leave());
    const fw = frame.win;
    const own = (e) => {
      const r = this.rect();
      this.mouse = { x: r.left + e.clientX, y: r.top + e.clientY };
    };
    fw.addEventListener('mousemove', own, { passive: true });
    fw.addEventListener('mousedown', own, { passive: true });
    fw.addEventListener('contextmenu', own, { capture: true });
    // 고양이를 눌러도 쓰던 노트에서 커서가 빠지지 않게 되돌려 준다
    fw.addEventListener('mousedown', () => {
      const a = doc.activeElement;
      this.prevFocus = a && a !== doc.body && a !== frame.iframe ? a : null;
    }, { capture: true });
    fw.addEventListener('mouseup', () => {
      const prev = this.prevFocus;
      this.prevFocus = null;
      const inner = fw.document.activeElement;
      if (inner && ['INPUT', 'TEXTAREA', 'SELECT'].includes(inner.tagName)) return;
      if (prev && prev.isConnected) setTimeout(() => prev.focus({ preventScroll: true }), 0);
    }, { capture: true });
    const ws = doc.querySelector('.workspace');
    if (ws && window.ResizeObserver) {
      const ro = new ResizeObserver(() => this.fit());
      ro.observe(ws);
      this.cleanup.push(() => ro.disconnect());
    }
    on(window, 'resize', () => this.fit());
    const wsp = this.plugin.app && this.plugin.app.workspace;
    if (wsp && wsp.on) {
      const ref = wsp.on('layout-change', () => this.fit());
      this.cleanup.push(() => wsp.offref(ref));
    }
  }

  unmount() {
    for (const f of this.cleanup) f();
    this.cleanup = [];
    this.host.detachPet();
    if (this.frame) this.frame.destroy();
    this.frame = null;
    if (this.el) this.el.remove();
    this.el = null;
  }

  // 작업 영역에 맞춘다. 바닥은 상태 표시줄 바로 위, 윗변은 맨 위 탭 바 아래 (Vault Pet 이슈 #2 · #6)
  rect() {
    const ws = document.querySelector('.workspace');
    if (ws) {
      const r = ws.getBoundingClientRect();
      if (r.width > 50 && r.height > 50) {
        const sb = document.querySelector('.status-bar');
        const sr = sb && sb.offsetParent ? sb.getBoundingClientRect() : null;
        const spans = sr && sr.width >= r.width * 0.6;
        const bottom = spans && sr.height && sr.top < r.bottom && sr.top > r.top + r.height / 2 ? sr.top : r.bottom;
        const top = Math.min(r.top + this.dragInset, bottom - 50);
        return { left: r.left, top, width: r.width, height: bottom - top, right: r.right, bottom };
      }
    }
    const sb = document.querySelector('.status-bar');
    const h = window.innerHeight - (sb ? sb.getBoundingClientRect().height : 0);
    return { left: 0, top: 0, width: window.innerWidth, height: h, right: window.innerWidth, bottom: h };
  }

  measureDragInset() {
    const ws = document.querySelector('.workspace');
    if (!ws) return 0;
    const top = ws.getBoundingClientRect().top;
    let inset = 0;
    for (const el of ws.querySelectorAll('.workspace-tab-header-container')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.top > top + 4) continue;
      if (getComputedStyle(el).webkitAppRegion !== 'drag') continue;
      inset = Math.max(inset, r.bottom - top);
    }
    return inset;
  }

  fit() {
    if (!this.el) return;
    this.dragInset = this.measureDragInset();
    const r = this.rect();
    Object.assign(this.el.style, { left: `${Math.round(r.left)}px`, top: `${Math.round(r.top)}px`, width: `${Math.round(r.width)}px`, height: `${Math.round(r.height)}px` });
  }

  forward(e) {
    if (!this.frame || !this.frame.win || this.hidden) return;
    const r = this.rect();
    this.mouse = { x: e.clientX, y: e.clientY };
    if (this.interactive && e.target && e.target.ownerDocument === this.frame.win.document) return;
    const inside = e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
    if (!inside) return this.leave();
    this.outside = false;
    const W = this.frame.win;
    try {
      const ev = new W.MouseEvent('mousemove', {
        clientX: e.clientX - r.left,
        clientY: e.clientY - r.top,
        screenX: e.screenX,
        screenY: e.screenY,
        buttons: e.buttons,
        bubbles: true,
        cancelable: true,
      });
      W.document.dispatchEvent(ev);
    } catch {
      // 펫 판이 막 닫히는 중
    }
  }

  leave() {
    if (this.interactive || this.outside || !this.frame || !this.frame.win) return;
    this.outside = true;
    try {
      this.frame.win.dispatchEvent(new this.frame.win.MouseEvent('mouseleave'));
    } catch {
      // 무시
    }
  }

  setInteractive(v) {
    this.interactive = !!v;
    if (this.frame && this.frame.iframe) this.frame.iframe.style.pointerEvents = v ? 'auto' : 'none';
  }

  setHidden(v) {
    this.hidden = !!v;
    if (this.el) this.el.style.display = v ? 'none' : '';
    if (v) this.setInteractive(false);
  }

  visible() {
    return !!this.el && !this.hidden;
  }

  lastMouse() {
    return this.mouse || { x: window.innerWidth - 160, y: window.innerHeight - 160 };
  }
}

module.exports = { PetStage };

};

__defs["plugin/store"] = function (module, exports, require) {
// 설정 · 진행 · 고양이 자리. 플러그인 data.json 한 파일에 둔다
const DEFAULT_SETTINGS = {
  language: 'ko', // 'ko' | 'en' | 'zh'
  scale: 5, // 3~8. 우클릭 메뉴의 작게 4 · 보통 5 · 크게 6 · 아주 크게 7
  showPet: true,
  sound: true,
  practiceFolder: null, // null 이면 언어에 맞는 기본 이름
  habitCoach: true, // 졸업 뒤 세 줄 · ingest 요일 챙기기 (core/habit.js)
  ingestDay: 'fri', // ingest 요일 (sun~sat)
  yieldVaultPet: true, // Vault Pet 이 같이 켜져 있으면 수업 중엔 그쪽 고양이가 비킨다
};

const DEFAULT_STATE = {
  catX: null, // 마지막으로 둔 자리 (무대 x)
  progress: null, // 레슨 진행 (core/engine.js) — 아직 없음
  notes: null, // 필기 노트 { lessonId, lines } (plugin/notes.js)
};

function load(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) },
    state: { ...DEFAULT_STATE, ...(d.state || {}) },
  };
}

module.exports = { DEFAULT_SETTINGS, DEFAULT_STATE, load };

};

__defs["kit/i18n"] = function (module, exports, require) {
// 사람이 읽는 글. 플러그인(호스트)과 펫 판(iframe)이 같이 쓴다.
// 고양이가 수업 중에 하는 말은 레슨 데이터(core/lessons)에 있고, 여기엔 버튼·명령·설정 같은 UI 글만 둔다.
// 언어: ko · en · zh(간체). 빠진 키는 한국어로 떨어진다. tests/run.js 가 세 언어의 키가 같은지 본다.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.I18N = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const LANGS = ['ko', 'en', 'zh'];
  const LOCALES = { ko: 'ko-KR', en: 'en-US', zh: 'zh-CN' };
  const DEFAULT_LANG = 'ko';

  const UI = {
    ko: {
      'pet.clickNext': '클릭하면 다음 →',
      'pet.next': '다음 →',
      'pet.prev': '← 이전',
      'pet.nextTip': '말풍선 아무 데나 눌러도 넘어가',
      'pet.replay': '💬 직전 말 다시 보기',
      'cmd.open': '수업 열기',
      'cmd.resume': '수업 이어 하기',
      'cmd.restart': '수업 처음부터',
      'cmd.skip': '이 레슨 건너뛰기',
      'cmd.undo': '이 레슨 되돌리기',
      'cmd.stop': '수업 잠깐 멈추기',
      'cmd.map': '진행 지도 열기',
      'cmd.resetPosition': '고양이 자리 초기화',
      'cmd.togglePet': '고양이 보이기 · 숨기기',
      'cmd.demo': '데모: 고양이 시험',
      'menu.size.small': '작게',
      'menu.size.normal': '보통',
      'menu.size.large': '크게',
      'menu.size.xlarge': '아주 크게',
      'menu.map': '진행 지도',
      'menu.hide': '잠깐 숨기기',
      'menu.reset': '자리 초기화',
      'map.title': '수업 진행 지도',
      'map.nowLabel': '지금 레슨',
      'map.allDone': '전부 마쳤어요',
      'map.allDoneSub': '이제 매일 세 줄, 주 1회 ingest. 고양이가 가끔 챙길게요.',
      'map.notStarted': '아직 시작 전',
      'map.notStartedSub': '옵시디언 사용법 기초(약 30분) → LLM Wiki 만들기(약 50분)',
      'map.stepOf': '{n} / {total} 단계 · 약 {min}분',
      'map.running': '수업 중…',
      'map.replay': '처음부터 다시',
      'map.start': '시작하기',
      'map.courseA': '옵시디언 사용법 기초',
      'map.courseB': 'LLM Wiki 만들기',
      'map.skipA': '건너뛰기',
      'map.skippedA': '옵시디언 사용법 기초를 들은 걸로 쳤어요. 기초 코스에서 만들었을 노트도 연습 폴더에 만들어 두었어요.',
      'map.locked': '앞 레슨({id} · {title})을 먼저 마쳐야 열려요.',
      'map.lockedCourse': 'LLM Wiki 만들기는 옵시디언 사용법 기초를 다 듣거나, 기초 코스 옆 "건너뛰기"를 누른 뒤에 열려요. 기초 코스에서 만드는 노트를 뒤 코스에서 쓰기 때문이에요.',
      'notes.title': '필기 노트',
      'notes.showAll': '한번에 보기',
      'notes.empty': '고양이가 설명하는 동안 핵심만 여기에 기록해 둘게.',
      'notes.none': 'A1 부터 고양이가 설명하는 핵심을 여기에 기록해 줄게.',
      'restart.title': '수업을 처음부터',
      'restart.body': '수업 진행만 처음으로 돌릴까요, 아니면 연습 폴더 "{root}"에 만든 노트까지 전부 지울까요? 지우는 건 휴지통으로 가요.',
      'restart.lessonsOnly': '수업만 처음부터',
      'restart.wipeNotes': '노트까지 초기화',
      'restart.wiped': '연습 폴더의 {n}개를 휴지통으로 보냈어요',
      'set.language': '언어',
      'set.languageDesc': '고양이 말과 메뉴의 언어',
      'set.scale': '고양이 크기',
      'set.scaleDesc': '3(작게) ~ 8(크게). 고양이를 우클릭해도 바꿀 수 있어요',
      'set.showPet': '고양이 보이기',
      'set.showPetDesc': '작업 영역 바닥에 고양이를 둔다',
      'set.sound': '효과음',
      'set.soundDesc': '말풍선 · 축하 소리',
      'set.practiceFolder': '연습 폴더 이름',
      'set.practiceFolderDesc': '수업이 파일을 만드는 유일한 폴더. 비우면 기본 이름',
      'set.habitCoach': '수료 후 습관 챙기기',
      'set.habitCoachDesc': '코스를 마친 뒤, ingest 요일과 저녁에 세 줄을 챙겨요 (하루 2번까지)',
      'set.ingestDay': 'ingest 요일',
      'set.ingestDayDesc': '이 요일에 옵시디언을 열면 고양이가 요리(ingest)하자고 해요',
      'set.yieldVaultPet': 'Vault Pet 에게 비켜 달라고 하기',
      'set.yieldVaultPetDesc': 'Vault Pet 이 같이 켜져 있으면 수업 중엔 그쪽 고양이를 숨겨요',
      'day.sun': '일요일',
      'day.mon': '월요일',
      'day.tue': '화요일',
      'day.wed': '수요일',
      'day.thu': '목요일',
      'day.fri': '금요일',
      'day.sat': '토요일',
      'habit.ingestDay': '오늘은 요리(ingest)하는 날이야. raw 폴더에 새 재료(raw 폴더 속 파일)가 {n}개 있어.',
      'habit.threeLines': '오늘 세 줄, 아직이지? 지금 적을래?',
      'habit.write': '적을게',
      'engine.hintDoIt': '내가 대신 해 줄까?',
      'engine.yesDoIt': '해 줘',
      'engine.illDoIt': '내가 할게',
      'engine.skip': '넘어가기',
      'engine.back': '돌아가기',
      'engine.next': '다음은 "{title}" ({min}분). 바로 갈까?',
      'engine.goOn': '가자',
      'engine.later': '나중에',
      'engine.laterOk': '알았어. 준비되면 맨 왼쪽 아이콘 줄의 고양이 아이콘을 눌러 줘. 거기서부터 이어서 할게.',
      'engine.allDone': '수업은 여기까지야! 이제 매일 기록하고, 일주일에 한 번 요리(ingest)만 하면 돼.',
      'engine.declined': '알았어, 안 만들게. 준비되면 맨 왼쪽 아이콘 줄의 고양이 아이콘을 눌러 줘.',
      'engine.answerWas': '답은 "{a}" 였어.',
      'engine.undone': '되돌렸어 ({n}개).',
      'engine.nothingToUndo': '되돌릴 게 없어.',
      'replay.writing': '{name} 쓰는 중…',
      'replay.ingestDone': '요리(ingest) 끝! wiki 에 노트 {n}개를 썼어.',
      'replay.queryTitle': '뭘 물어볼까?',
      'replay.queryIntro': '질문을 하나 누르면 AI 가 위키를 읽고 출처를 달아 답해. 다른 질문도 눌러 보고, 다 봤으면 "넘어가기".',
      'replay.sources': '출처',
      'replay.save': '위키에 저장',
      'replay.close': '닫기',
      'replay.saved': 'wiki 안 답변 폴더(answers)에 저장했어. 다음에 물어보면 이 답도 같이 읽어.',
      'replay.lintTitle': '위키 청소 결과',
      'replay.fix': '고쳐 줘',
      'replay.lintLater': '나중에',
      'replay.fixed': '다 고쳤어. 어긋난 내용은 맞추고, 고아 노트는 잇고, 빠진 개념 노트는 새로 썼어.',
      'replay.ruleAdded': 'AGENTS.md 에 규칙 한 줄을 더했어. 이 규칙대로 다시 요리(ingest)해 볼게.',
      'replay.schemaTitle': '규칙이 바뀌어서 달라진 노트',
      'replay.schemaBody': '개념 폴더(concepts)의 노트마다 "예시" 칸이 생겼어. 아래 노트를 눌러 확인해 봐.',
      'replay.ok': '확인',
      'real.askMode': '평소 쓰는 AI 가 뭐야? 클로드 데스크톱 앱이면 폴더를 바로 연결할 수 있어.',
      'real.modeClaude': '클로드 데스크톱 앱',
      'real.modeOther': '그 밖 (ChatGPT 등)',
      'real.folderTitle': '클로드 앱에 이 볼트 연결하기',
      'real.folderBody': '1. 브라우저 말고 **설치한 클로드 데스크톱 앱**을 연다.\n2. 입력창 아래 **Cowork** 탭을 누른다. 내 폴더를 읽고 쓰는 건 코워크에서만 된다.\n3. **프로젝트 또는 폴더 → 폴더 추가**에서 이 볼트 폴더("{vault}")를 고른다.\n4. 폴더 접근을 허용할지 물으면 허용.\n\n제대로 됐는지는 아래 확인 문장을 붙여넣어 보면 돼. raw 와 wiki 를 말하면 된 거야.\n\n연결을 마쳤으면 **다 했어**를 눌러 줘. 다음으로 넘어갈게.',
      'real.copyCheck': '확인 문장 복사',
      'real.ok': '다 했어',
      'real.checkPrompt': '지금 작업 폴더에 뭐가 있는지 알려줘',
      'real.checkSay': '클로드 창에 붙여넣어 봐. raw 랑 wiki 를 말하면 연결된 거야.',
      'real.ingestFolderTitle': '실제 요리(ingest) 한 번',
      'real.ingestFolderBody': '클로드 코워크 대화창에 아래 문장을 붙여넣으면 돼. 클로드가 규칙 파일(AGENTS.md)을 읽고 raw 폴더의 새 재료(raw 폴더 속 파일)를 요리(ingest)해서 wiki 에 노트를 쓸 거야.\n\n`{root}/AGENTS.md 를 읽고 raw 의 새 재료를 ingest 해 줘`\n\n"이 범위로 할까요?" 하고 물으면 훑어보고 진행. wiki 에 새 노트가 생기면 고양이가 알아차릴게.\n\n붙여넣었으면 **다 했어**를 눌러 줘.',
      'real.ingestPrompt': '{root}/AGENTS.md 를 읽고 raw 폴더의 새 재료를 ingest 해 줘. 결과 노트는 wiki 폴더에 써 주고, wiki/index.md 와 wiki/log.md 도 갱신해 줘.',
      'real.copyPrompt': '프롬프트 복사',
      'real.waitFolder': '붙여넣고 기다려 봐. wiki 에 새 노트가 생기면 바로 알려 줄게.',
      'real.pasteTitle': 'AI 에게 줄 묶음',
      'real.pasteBody': '규칙 파일(AGENTS.md) + 목차(index.md) + 아직 요리(ingest) 안 한 재료(raw 폴더 속 파일) {n}개를 글 한 덩어리로 묶었어.\n\n**프롬프트 복사** → 평소 쓰는 AI 채팅에 붙여넣기 → AI 의 답을 통째로 복사 → 다시 여기로.',
      'real.pasteSay': 'AI 답이 오면 전부 복사해서, 뜨는 창에 붙여넣어 줘.',
      'real.noFresh': 'raw 폴더에 아직 요리(ingest) 안 한 재료(raw 폴더 속 파일)가 없어. 하나 넣고 다시 불러 줘.',
      'real.noBlocks': '답에 노트를 나누는 표시가 없어서 노트 하나로 받아 뒀어. 나중에 AI 에게 나눠 달라고 해도 돼.',
      'real.rawAnswerName': '받은 답 {stamp}',
      'real.skipped': 'wiki 밖 경로 {n}개는 건너뛰었어요',
      'real.pages': '개',
      'real.applied': 'wiki 에 노트 {n}개를 넣었어. 실제 요리(ingest) 끝!',
      'real.copied': '복사했어요. AI 채팅에 붙여넣으세요',
      'real.copyFailed': '복사가 안 됐어요. 카드 내용을 직접 복사해 주세요',
      'real.cardsTitle': '수료 선물 — 매일 쓸 문장 3개',
      'real.cardsBody': '버튼을 누르면 복사돼. AI 채팅에 붙여넣기만 하면 돼.',
      'real.card1': '이번 주 정리',
      'real.card1Text': '{root}/AGENTS.md 를 읽고, raw 의 이번 주 재료를 ingest 해 줘. 끝나면 어떤 노트를 썼는지 알려 줘.',
      'real.card2': '그때 왜 그랬더라',
      'real.card2Text': '{root}/wiki 를 읽고, [무엇]을 내가 왜 그렇게 했는지 찾아서 알려 줘. 근거가 된 노트도 같이. 기록에 없으면 없다고 말해 줘.',
      'real.card3': '청소 한 번',
      'real.card3Text': '{root}/wiki 를 점검(lint)해 줘. 서로 어긋나는 말, 아무도 링크하지 않는 노트, 있어야 하는데 없는 개념 노트를 찾아서 고칠지 물어봐 줘.',
      'paste.title': 'AI 의 답 붙여넣기',
      'paste.help': 'AI 가 준 답을 전부 복사해서 여기 붙여넣으세요. "=== FILE: wiki/… ===" 표시대로 노트를 나눠 미리 보여 드려요.',
      'paste.placeholder': '여기에 붙여넣기',
      'paste.apply': '노트로 나누기',
      'paste.later': '나중에',
      'preview.title': '이걸 만들게',
      'preview.titleWiki': '재료를 바탕으로 위키에 이 노트들을 만들게',
      'preview.apply': '만들기',
      'preview.cancel': '취소',
      'poke.0': '응?',
      'poke.1': '나 여기 있어.',
      'poke.2': '같이 하자.',
      'demo.hello': '안녕! 나는 위키 룸메이트 고양이야.||위키 보고 왔지?',
      'demo.ask': '옵시디언은 처음이야?',
      'demo.yes': '응, 처음',
      'demo.no': '좀 써 봤어',
      'demo.first': '그럼 기초부터 같이 가자.',
      'demo.notFirst': '좋아, 그럼 바로 위키로.',
      'demo.goFolder': '저기 raw 폴더로 가 볼게.',
      'demo.point': '여기가 raw 폴더야',
      'demo.noExplorer': '파일 탐색기가 안 보여서 못 가리키겠어. 왼쪽 패널을 열어 줘.',
      'demo.carry': '샘플 글을 물고 raw 로 옮겨 볼게.',
      'demo.busy': '잠깐, 요리(ingest) 중…',
      'demo.done': '끝! 시험 통과.',
    },
    en: {
      'pet.clickNext': 'Click to continue →',
      'pet.next': 'Next →',
      'pet.prev': '← Back',
      'pet.nextTip': 'Click anywhere on the bubble to continue',
      'pet.replay': '💬 Show last message again',
      'cmd.open': 'Open the lesson',
      'cmd.resume': 'Resume the lesson',
      'cmd.restart': 'Restart from the beginning',
      'cmd.skip': 'Skip this lesson',
      'cmd.undo': 'Undo this lesson',
      'cmd.stop': 'Pause the lesson',
      'cmd.map': 'Open the progress map',
      'cmd.resetPosition': 'Reset cat position',
      'cmd.togglePet': 'Show / hide the cat',
      'cmd.demo': 'Demo: cat test',
      'menu.size.small': 'Small',
      'menu.size.normal': 'Normal',
      'menu.size.large': 'Large',
      'menu.size.xlarge': 'Extra large',
      'menu.map': 'Progress map',
      'menu.hide': 'Hide for a while',
      'menu.reset': 'Reset position',
      'map.title': 'Lesson progress map',
      'map.nowLabel': 'Current lesson',
      'map.allDone': 'All done',
      'map.allDoneSub': 'From now on: three lines a day, one ingest a week. The cat will check in now and then.',
      'map.notStarted': 'Not started yet',
      'map.notStartedSub': 'Obsidian Basics (about 30 min) → Build an LLM Wiki (about 50 min)',
      'map.stepOf': 'Step {n} / {total} · about {min} min',
      'map.running': 'In a lesson…',
      'map.replay': 'Start over',
      'map.start': 'Start',
      'map.courseA': 'Obsidian Basics',
      'map.courseB': 'Build an LLM Wiki',
      'map.skipA': 'Skip',
      'map.skippedA': 'Obsidian Basics is marked as done. The notes the basics course would have made are now in your practice folder.',
      'map.locked': 'Opens after you finish the previous lesson ({id} · {title}).',
      'map.lockedCourse': 'Build an LLM Wiki opens after you finish Obsidian Basics, or click "Skip" next to the basics course. The later course uses notes made in the basics course.',
      'notes.title': 'Notes',
      'notes.showAll': 'Show all',
      'notes.empty': 'While the cat explains, I\'ll write down just the key points here.',
      'notes.none': 'Starting with A1, I\'ll write down the key points the cat explains here.',
      'restart.title': 'Restart from the beginning',
      'restart.body': 'Reset only the lesson progress, or also delete every note made in the practice folder "{root}"? Deleted notes go to the trash.',
      'restart.lessonsOnly': 'Reset lessons only',
      'restart.wipeNotes': 'Reset notes too',
      'restart.wiped': 'Moved {n} item(s) from the practice folder to the trash',
      'set.language': 'Language',
      'set.languageDesc': 'Language for the cat and the menus',
      'set.scale': 'Cat size',
      'set.scaleDesc': '3 (small) to 8 (large). You can also right-click the cat to change it',
      'set.showPet': 'Show the cat',
      'set.showPetDesc': 'Keep the cat at the bottom of the workspace',
      'set.sound': 'Sound effects',
      'set.soundDesc': 'Speech bubble and celebration sounds',
      'set.practiceFolder': 'Practice folder name',
      'set.practiceFolderDesc': 'The only folder the lessons create files in. Leave empty for the default name',
      'set.habitCoach': 'Habit reminders after graduation',
      'set.habitCoachDesc': 'After the course, reminds you on ingest day and about three lines in the evening (at most twice a day)',
      'set.ingestDay': 'Ingest day',
      'set.ingestDayDesc': 'When you open Obsidian on this day, the cat suggests cooking (ingest)',
      'set.yieldVaultPet': 'Ask Vault Pet to step aside',
      'set.yieldVaultPetDesc': 'If Vault Pet is also enabled, its cat hides during lessons',
      'day.sun': 'Sunday',
      'day.mon': 'Monday',
      'day.tue': 'Tuesday',
      'day.wed': 'Wednesday',
      'day.thu': 'Thursday',
      'day.fri': 'Friday',
      'day.sat': 'Saturday',
      'habit.ingestDay': 'Today\'s cooking (ingest) day. There are {n} new ingredient(s) in the raw folder.',
      'habit.threeLines': 'No three lines yet today, right? Want to write them now?',
      'habit.write': 'I\'ll write',
      'engine.hintDoIt': 'Want me to do it for you?',
      'engine.yesDoIt': 'Do it',
      'engine.illDoIt': 'I\'ll do it',
      'engine.skip': 'Move on',
      'engine.back': 'Go back',
      'engine.next': 'Next up is "{title}" ({min} min). Go now?',
      'engine.goOn': 'Let\'s go',
      'engine.later': 'Later',
      'engine.laterOk': 'Got it. When you\'re ready, click the cat icon in the ribbon on the far left. We\'ll pick up from there.',
      'engine.allDone': 'That\'s the end of class! From here, just write things down every day and cook (ingest) once a week.',
      'engine.declined': 'Okay, I won\'t create it. When you\'re ready, click the cat icon in the ribbon on the far left.',
      'engine.answerWas': 'The answer was "{a}".',
      'engine.undone': 'Undone ({n} item(s)).',
      'engine.nothingToUndo': 'Nothing to undo.',
      'replay.writing': 'Writing {name}…',
      'replay.ingestDone': 'Cooking (ingest) done! I wrote {n} note(s) in wiki.',
      'replay.queryTitle': 'What should we ask?',
      'replay.queryIntro': 'Click a question and the AI reads the wiki and answers with sources. Try the other questions too, and when you\'re done, click "Move on".',
      'replay.sources': 'Sources',
      'replay.save': 'Save to wiki',
      'replay.close': 'Close',
      'replay.saved': 'Saved it to the answers folder (answers) in wiki. Next time you ask, this answer gets read too.',
      'replay.lintTitle': 'Wiki cleanup results',
      'replay.fix': 'Fix it',
      'replay.lintLater': 'Later',
      'replay.fixed': 'All fixed. I lined up the conflicting bits, linked the orphan notes, and wrote the missing concept notes.',
      'replay.ruleAdded': 'I added one rule to AGENTS.md. Let me cook (ingest) again with this rule.',
      'replay.schemaTitle': 'Notes changed by the new rule',
      'replay.schemaBody': 'Every note in the concepts folder (concepts) now has an "Example" section. Click a note below to check.',
      'replay.ok': 'OK',
      'real.askMode': 'Which AI do you usually use? If it\'s the Claude desktop app, you can connect the folder directly.',
      'real.modeClaude': 'Claude desktop app',
      'real.modeOther': 'Something else (ChatGPT, etc.)',
      'real.folderTitle': 'Connect this vault to the Claude app',
      'real.folderBody': '1. Open the **installed Claude desktop app**, not the browser.\n2. Click the **Cowork** tab under the input box. Only Cowork can read and write your folders.\n3. Under **Project or folder → Add folder**, choose this vault folder ("{vault}").\n4. If it asks whether to allow folder access, allow it.\n\nTo check it worked, paste the check sentence below. If it mentions raw and wiki, you\'re connected.\n\nOnce you\'re connected, click **Done**. We\'ll move on.',
      'real.copyCheck': 'Copy check sentence',
      'real.ok': 'Done',
      'real.checkPrompt': 'Tell me what\'s in the current working folder',
      'real.checkSay': 'Paste it into the Claude window. If it mentions raw and wiki, you\'re connected.',
      'real.ingestFolderTitle': 'One real cook (ingest)',
      'real.ingestFolderBody': 'Paste the sentence below into the Claude Cowork chat. Claude will read the rules file (AGENTS.md), cook (ingest) the new ingredients in the raw folder, and write notes in wiki.\n\n`Read {root}/AGENTS.md and ingest the new ingredients in raw`\n\nIf it asks something like "Should I go with this scope?", skim it and go ahead. The cat will notice when new notes show up in wiki.\n\nOnce you\'ve pasted it, click **Done**.',
      'real.ingestPrompt': 'Read {root}/AGENTS.md and ingest the new ingredients in the raw folder. Write the resulting notes in the wiki folder, and update wiki/index.md and wiki/log.md too.',
      'real.copyPrompt': 'Copy prompt',
      'real.waitFolder': 'Paste it and wait. I\'ll tell you as soon as a new note shows up in wiki.',
      'real.pasteTitle': 'A bundle for your AI',
      'real.pasteBody': 'I bundled the rules file (AGENTS.md) + contents (index.md) + {n} uncooked ingredient(s) (files in the raw folder) into one block of text.\n\n**Copy prompt** → paste into your usual AI chat → copy the AI\'s whole answer → come back here.',
      'real.pasteSay': 'When the AI answers, copy all of it and paste it into the window that opens.',
      'real.noFresh': 'There are no uncooked ingredients in the raw folder yet. Add one and call me again.',
      'real.noBlocks': 'The answer had no markers splitting it into notes, so I saved it as one note. You can ask the AI to split it later.',
      'real.rawAnswerName': 'Received answer {stamp}',
      'real.skipped': 'Skipped {n} path(s) outside wiki',
      'real.pages': 'notes',
      'real.applied': 'Put {n} note(s) in wiki. Real cooking (ingest) done!',
      'real.copied': 'Copied. Paste it into your AI chat',
      'real.copyFailed': 'Couldn\'t copy. Please copy the card text yourself',
      'real.cardsTitle': 'Graduation gift — 3 sentences for every day',
      'real.cardsBody': 'Click a button to copy. Then just paste it into your AI chat.',
      'real.card1': 'This week\'s cooking',
      'real.card1Text': 'Read {root}/AGENTS.md and ingest this week\'s ingredients in raw. When you\'re done, tell me which notes you wrote.',
      'real.card2': 'Why did I do that again?',
      'real.card2Text': 'Read {root}/wiki and find out why I did [what] the way I did. Include the notes it\'s based on. If it\'s not in the records, tell me so.',
      'real.card3': 'A quick cleanup',
      'real.card3Text': 'Check (lint) {root}/wiki. Find statements that contradict each other, notes nothing links to, and concept notes that should exist but don\'t, then ask me whether to fix them.',
      'paste.title': 'Paste the AI\'s answer',
      'paste.help': 'Copy the AI\'s whole answer and paste it here. I\'ll split it into notes by the "=== FILE: wiki/… ===" markers and show you a preview.',
      'paste.placeholder': 'Paste here',
      'paste.apply': 'Split into notes',
      'paste.later': 'Later',
      'preview.title': 'I\'ll create this',
      'preview.titleWiki': 'From the ingredients, I\'ll create these notes in the wiki',
      'preview.apply': 'Create',
      'preview.cancel': 'Cancel',
      'poke.0': 'Hm?',
      'poke.1': 'I\'m right here.',
      'poke.2': 'Let\'s do this together.',
      'demo.hello': 'Hi! I\'m your wiki roommate cat.||You\'re here because of the wiki, right?',
      'demo.ask': 'Is this your first time in Obsidian?',
      'demo.yes': 'Yes, first time',
      'demo.no': 'I\'ve used it a bit',
      'demo.first': 'Then let\'s start with the basics together.',
      'demo.notFirst': 'Great, straight to the wiki then.',
      'demo.goFolder': 'I\'ll walk over to the raw folder.',
      'demo.point': 'This is the raw folder',
      'demo.noExplorer': 'I can\'t see the File explorer, so I can\'t point at it. Please open the left sidebar.',
      'demo.carry': 'I\'ll carry the sample note over to raw.',
      'demo.busy': 'One sec, cooking (ingest)…',
      'demo.done': 'Done! Test passed.',
    },
    zh: {
      'pet.clickNext': '点击继续 →',
      'pet.next': '继续 →',
      'pet.prev': '← 上一句',
      'pet.nextTip': '点气泡任意处也可以继续',
      'pet.replay': '💬 再看一遍刚才的话',
      'cmd.open': '打开课程',
      'cmd.resume': '继续课程',
      'cmd.restart': '从头开始课程',
      'cmd.skip': '跳过这一课',
      'cmd.undo': '撤销这一课',
      'cmd.stop': '暂停课程',
      'cmd.map': '打开进度地图',
      'cmd.resetPosition': '重置猫的位置',
      'cmd.togglePet': '显示 · 隐藏猫',
      'cmd.demo': '演示：测试猫',
      'menu.size.small': '小',
      'menu.size.normal': '中',
      'menu.size.large': '大',
      'menu.size.xlarge': '特大',
      'menu.map': '进度地图',
      'menu.hide': '暂时隐藏',
      'menu.reset': '重置位置',
      'map.title': '课程进度地图',
      'map.nowLabel': '当前这一课',
      'map.allDone': '全部学完了',
      'map.allDoneSub': '接下来每天三行，每周一次 ingest。猫会时不时提醒你。',
      'map.notStarted': '尚未开始',
      'map.notStartedSub': 'Obsidian 基础（约 30 分钟）→ 制作 LLM Wiki（约 50 分钟）',
      'map.stepOf': '第 {n} / {total} 步 · 约 {min} 分钟',
      'map.running': '上课中…',
      'map.replay': '从头再来',
      'map.start': '开始',
      'map.courseA': 'Obsidian 基础',
      'map.courseB': '制作 LLM Wiki',
      'map.skipA': '跳过',
      'map.skippedA': '已将 Obsidian 基础视为学完。基础课程里会建的笔记，也已经在练习文件夹里建好了。',
      'map.locked': '要先学完前一课（{id} · {title}）才能打开。',
      'map.lockedCourse': '学完 Obsidian 基础，或点基础课程旁边的“跳过”之后，才能打开“制作 LLM Wiki”。因为后面的课程会用到基础课程里建的笔记。',
      'notes.title': '笔记',
      'notes.showAll': '查看全部',
      'notes.empty': '猫讲解的时候，我只把要点记在这里。',
      'notes.none': '从 A1 开始，我会把猫讲的要点记在这里。',
      'restart.title': '从头开始课程',
      'restart.body': '只把课程进度重置，还是连练习文件夹“{root}”里建的笔记也全部删除？删除的内容会移到回收站。',
      'restart.lessonsOnly': '只重置课程',
      'restart.wipeNotes': '连笔记一起重置',
      'restart.wiped': '已把练习文件夹里的 {n} 项移到回收站',
      'set.language': '语言',
      'set.languageDesc': '猫的对话和菜单使用的语言',
      'set.scale': '猫的大小',
      'set.scaleDesc': '3（小）～ 8（大）。也可以右键点猫来调整',
      'set.showPet': '显示猫',
      'set.showPetDesc': '让猫待在工作区底部',
      'set.sound': '音效',
      'set.soundDesc': '对话气泡 · 庆祝的声音',
      'set.practiceFolder': '练习文件夹名称',
      'set.practiceFolderDesc': '课程唯一会创建文件的文件夹。留空则使用默认名称',
      'set.habitCoach': '结业后的习惯提醒',
      'set.habitCoachDesc': '学完课程后，在 ingest 日提醒烹饪，在晚上提醒写三行（每天最多两次）',
      'set.ingestDay': 'ingest 日',
      'set.ingestDayDesc': '在这一天打开 Obsidian 时，猫会提议烹饪（ingest）',
      'set.yieldVaultPet': '请 Vault Pet 让位',
      'set.yieldVaultPetDesc': '如果同时启用了 Vault Pet，上课时会隐藏那边的猫',
      'day.sun': '周日',
      'day.mon': '周一',
      'day.tue': '周二',
      'day.wed': '周三',
      'day.thu': '周四',
      'day.fri': '周五',
      'day.sat': '周六',
      'habit.ingestDay': '今天是烹饪（ingest）日。raw 文件夹里有 {n} 份新食材（raw 文件夹里的文件）。',
      'habit.threeLines': '今天的三行还没写吧？现在写吗？',
      'habit.write': '这就写',
      'engine.hintDoIt': '要我替你做吗？',
      'engine.yesDoIt': '帮我做',
      'engine.illDoIt': '我自己来',
      'engine.skip': '下一步',
      'engine.back': '返回',
      'engine.next': '下一课是“{title}”（{min} 分钟）。现在就去吗？',
      'engine.goOn': '走吧',
      'engine.later': '稍后',
      'engine.laterOk': '好。准备好了就点最左边图标栏里的猫图标，我们从这里接着来。',
      'engine.allDone': '课程就到这里！之后只要每天记录，每周烹饪（ingest）一次就行。',
      'engine.declined': '好，那就不建了。准备好了就点最左边图标栏里的猫图标。',
      'engine.answerWas': '答案是“{a}”。',
      'engine.undone': '撤销好了（{n} 项）。',
      'engine.nothingToUndo': '没有可以撤销的。',
      'replay.writing': '正在写 {name}…',
      'replay.ingestDone': '烹饪（ingest）完成！在 wiki 里写了 {n} 篇笔记。',
      'replay.queryTitle': '想问什么？',
      'replay.queryIntro': '点一个问题，AI 就会读维基，附上出处来回答。其他问题也可以点点看，都看完了就点“下一步”。',
      'replay.sources': '出处',
      'replay.save': '保存到维基',
      'replay.close': '关闭',
      'replay.saved': '已保存到 wiki 里的回答文件夹（answers）。下次提问时，也会一起读这个回答。',
      'replay.lintTitle': '维基清理结果',
      'replay.fix': '帮我修好',
      'replay.lintLater': '稍后',
      'replay.fixed': '都修好了。互相矛盾的内容统一了，孤立笔记连上了，缺的概念笔记也新写好了。',
      'replay.ruleAdded': '在 AGENTS.md 里加了一条规则。我按这条规则再烹饪（ingest）一次。',
      'replay.schemaTitle': '规则变了，这些笔记也跟着变了',
      'replay.schemaBody': '概念文件夹（concepts）里的每篇笔记都多了“例子”一栏。点下面的笔记看看吧。',
      'replay.ok': '好的',
      'real.askMode': '你平时用哪个 AI？如果是 Claude 桌面应用，可以直接连接文件夹。',
      'real.modeClaude': 'Claude 桌面应用',
      'real.modeOther': '其他（ChatGPT 等）',
      'real.folderTitle': '把这个仓库连接到 Claude 应用',
      'real.folderBody': '1. 打开**已安装的 Claude 桌面应用**，不是浏览器。\n2. 点输入框下方的 **Cowork** 标签。只有在 Cowork 里才能读写你的文件夹。\n3. 在**项目或文件夹 → 添加文件夹**里，选择这个仓库文件夹（“{vault}”）。\n4. 询问是否允许访问文件夹时，选允许。\n\n想确认是否成功，把下面的检查句粘贴进去试试。它提到 raw 和 wiki 就说明连上了。\n\n连好之后点**做好了**，我们继续下一步。',
      'real.copyCheck': '复制检查句',
      'real.ok': '做好了',
      'real.checkPrompt': '告诉我当前工作文件夹里有什么',
      'real.checkSay': '粘贴到 Claude 窗口里试试。它提到 raw 和 wiki 就说明连上了。',
      'real.ingestFolderTitle': '真正烹饪（ingest）一次',
      'real.ingestFolderBody': '把下面这句粘贴到 Claude Cowork 的对话框里就行。Claude 会读规则文件（AGENTS.md），把 raw 文件夹里的新食材（raw 文件夹里的文件）烹饪（ingest）好，在 wiki 里写成笔记。\n\n`读一下 {root}/AGENTS.md，然后 ingest raw 里的新食材`\n\n如果它问“按这个范围做吗？”，看一眼就继续。wiki 里出现新笔记时，我会发现的。\n\n粘贴好了就点**做好了**。',
      'real.ingestPrompt': '请读 {root}/AGENTS.md，然后 ingest raw 文件夹里的新食材。把结果笔记写进 wiki 文件夹，并更新 wiki/index.md 和 wiki/log.md。',
      'real.copyPrompt': '复制提示词',
      'real.waitFolder': '粘贴后等一等。wiki 里一出现新笔记，我马上告诉你。',
      'real.pasteTitle': '给 AI 的打包内容',
      'real.pasteBody': '我把规则文件（AGENTS.md）+ 目录（index.md）+ {n} 份还没烹饪（ingest）的食材（raw 文件夹里的文件）打包成了一整段文字。\n\n**复制提示词** → 粘贴到你常用的 AI 对话 → 把 AI 的回答整个复制 → 回到这里。',
      'real.pasteSay': 'AI 回答后，把它全部复制，粘贴到弹出的窗口里。',
      'real.noFresh': 'raw 文件夹里还没有待烹饪（ingest）的食材（raw 文件夹里的文件）。放一份进去再叫我。',
      'real.noBlocks': '回答里没有拆分笔记的标记，我先存成了一篇笔记。之后也可以让 AI 帮你拆开。',
      'real.rawAnswerName': '收到的回答 {stamp}',
      'real.skipped': '已跳过 {n} 个 wiki 之外的路径',
      'real.pages': '篇',
      'real.applied': '已在 wiki 里放入 {n} 篇笔记。真正的烹饪（ingest）完成！',
      'real.copied': '已复制。请粘贴到 AI 对话中',
      'real.copyFailed': '复制失败。请手动复制卡片内容',
      'real.cardsTitle': '结业礼物 — 每天都能用的三句话',
      'real.cardsBody': '点按钮就会复制。粘贴到 AI 对话里就行。',
      'real.card1': '整理这周',
      'real.card1Text': '请读 {root}/AGENTS.md，然后 ingest raw 里这周的食材。做完后告诉我写了哪些笔记。',
      'real.card2': '当时为什么那样来着',
      'real.card2Text': '请读 {root}/wiki，帮我找出我当时为什么那样处理 [某事]，并附上作为依据的笔记。记录里没有的话，就直说没有。',
      'real.card3': '清理一次',
      'real.card3Text': '请检查（lint）{root}/wiki。找出互相矛盾的说法、没有任何笔记链接到的笔记、本该有却没有的概念笔记，并先问我要不要修改。',
      'paste.title': '粘贴 AI 的回答',
      'paste.help': '请把 AI 的回答全部复制后粘贴到这里。我会按“=== FILE: wiki/… ===”标记拆成笔记，先给你预览。',
      'paste.placeholder': '粘贴到这里',
      'paste.apply': '拆成笔记',
      'paste.later': '稍后',
      'preview.title': '我要建这些',
      'preview.titleWiki': '我会根据食材，在维基里建这些笔记',
      'preview.apply': '创建',
      'preview.cancel': '取消',
      'poke.0': '嗯？',
      'poke.1': '我在这儿。',
      'poke.2': '一起来吧。',
      'demo.hello': '你好！我是你的维基室友猫。||是听说了维基才来的吧？',
      'demo.ask': '第一次用 Obsidian 吗？',
      'demo.yes': '对，第一次',
      'demo.no': '用过一点',
      'demo.first': '那我们从基础开始。',
      'demo.notFirst': '好，那直接进维基。',
      'demo.goFolder': '我去那边的 raw 文件夹看看。',
      'demo.point': '这里就是 raw 文件夹',
      'demo.noExplorer': '看不到文件列表，没法指给你看。请打开左侧面板。',
      'demo.carry': '我把示例文章叼到 raw 里去。',
      'demo.busy': '稍等，烹饪（ingest）中…',
      'demo.done': '完成！测试通过。',
    },
  };

  const fill = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s);

  class Strings {
    constructor(lang) {
      this.lang = DEFAULT_LANG;
      this.set(lang);
    }
    get locale() {
      return LOCALES[this.lang] || LOCALES[DEFAULT_LANG];
    }
    set(lang) {
      if (LANGS.includes(lang)) this.lang = lang;
    }
    t(key, vars) {
      const table = UI[this.lang] || UI[DEFAULT_LANG];
      const v = key in table ? table[key] : UI[DEFAULT_LANG][key];
      if (v === undefined) return key;
      return fill(v, vars);
    }
    // { ko, en, zh } 꼴의 글에서 지금 언어 것을 고른다
    pick(obj, vars) {
      if (obj == null) return '';
      if (typeof obj === 'string') return fill(obj, vars);
      return fill(obj[this.lang] != null ? obj[this.lang] : obj[DEFAULT_LANG] != null ? obj[DEFAULT_LANG] : '', vars);
    }
  }

  return { Strings, LANGS, LOCALES, DEFAULT_LANG, UI };
});

};

__defs["plugin/kit-assets"] = function (module, exports, require) {
module.exports = {"petBody":"\n    <div id=\"bubble\" class=\"bubble\" hidden>\n      <span class=\"title\"></span>\n      <span class=\"text\"></span>\n      <div class=\"figure\"></div>\n      <div class=\"choices\"></div>\n      <div class=\"nav\"><button class=\"prev\" type=\"button\"></button><button class=\"next\" type=\"button\"></button></div>\n    </div>\n    <div id=\"card\" class=\"card\" hidden>\n      <div class=\"card-title\"></div>\n      <div class=\"card-body\"></div>\n      <div class=\"figure\"></div>\n      <div class=\"card-buttons\"></div>\n      <span class=\"hint\"></span>\n    </div>\n    <div id=\"point\" class=\"point\" hidden></div>\n    <button id=\"replay\" class=\"replay\" type=\"button\" hidden></button>\n    <canvas id=\"pet\"></canvas>\n    <canvas id=\"field\"></canvas>","petCss":":root {\n  --ink: #3a2118;\n  --paper: #fffaf3;\n  --paper2: #f6eee2;\n  --accent: #d97757;\n  --accent2: #5b8a72;\n  --muted: #8b6f60;\n  --line: #e7d9c6;\n}\n\nhtml,\nbody {\n  margin: 0;\n  width: 100%;\n  height: 100%;\n  overflow: hidden;\n  background: transparent;\n  user-select: none;\n  font-family: 'Pretendard', 'Malgun Gothic', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;\n  cursor: default;\n}\n\n/* 고양이 자리(left·bottom)는 pet.js 가 정한다 */\n#pet {\n  position: absolute;\n  z-index: 2;\n  bottom: 0;\n  left: 0;\n  image-rendering: pixelated;\n  cursor: grab;\n}\nbody.dragging #pet {\n  cursor: grabbing;\n}\n\n#floor-shadow {\n  position: absolute;\n  z-index: 1;\n  image-rendering: pixelated;\n  pointer-events: none;\n}\n\n/* 화살표 · 종이 날리기를 그리는 화면 전체 캔버스. 마우스는 통과시킨다 */\n#field {\n  position: absolute;\n  z-index: 3;\n  left: 0;\n  top: 0;\n  width: 100%;\n  height: 100%;\n  pointer-events: none;\n}\n\n/* 입에 문 종이 · 날아가는 종이 */\n.paper {\n  position: absolute;\n  z-index: 3;\n  width: 18px;\n  height: 23px;\n  background: #fff;\n  border: 2px solid var(--ink);\n  border-radius: 2px;\n  box-shadow: 2px 2px 0 rgba(58, 33, 24, 0.25);\n  pointer-events: none;\n}\n.paper::before,\n.paper::after {\n  content: '';\n  position: absolute;\n  left: 3px;\n  right: 3px;\n  height: 2px;\n  background: #c9b8a8;\n}\n.paper::before {\n  top: 5px;\n}\n.paper::after {\n  top: 11px;\n}\n\n/* ---------- 말풍선 (학습 패널) ---------- */\n\n.bubble {\n  position: absolute;\n  z-index: 4;\n  left: 50%;\n  max-width: 480px;\n  min-width: 220px;\n  width: max-content;\n  box-sizing: border-box;\n  padding: 12px 14px 10px;\n  background: var(--paper);\n  color: var(--ink);\n  font-size: 15px;\n  line-height: 1.5;\n  word-break: keep-all;\n  overflow-wrap: anywhere;\n  border: 2.5px solid var(--ink);\n  border-radius: 10px;\n  box-shadow: 4px 4px 0 rgba(58, 33, 24, 0.22);\n  transform: translateX(-50%) scale(0.6);\n  transform-origin: 50% 100%;\n  opacity: 0;\n  transition: transform 0.18s steps(3), opacity 0.12s;\n  cursor: pointer;\n}\n.bubble.show {\n  transform: translateX(-50%) scale(1);\n  opacity: 1;\n}\n.bubble::before,\n.bubble::after {\n  content: '';\n  position: absolute;\n  left: calc(50% + var(--tail-x, 0px));\n  width: 0;\n  height: 0;\n  border: solid transparent;\n}\n.bubble::before {\n  bottom: -13px;\n  margin-left: -9px;\n  border-width: 11px 9px 0;\n  border-top-color: var(--ink);\n}\n.bubble::after {\n  bottom: -8px;\n  margin-left: -6px;\n  border-width: 7px 6px 0;\n  border-top-color: var(--paper);\n}\n.bubble.below {\n  transform-origin: 50% 0;\n}\n.bubble.below::before {\n  bottom: auto;\n  top: -13px;\n  border-width: 0 9px 11px;\n  border-top-color: transparent;\n  border-bottom-color: var(--ink);\n}\n.bubble.below::after {\n  bottom: auto;\n  top: -8px;\n  border-width: 0 6px 7px;\n  border-top-color: transparent;\n  border-bottom-color: var(--paper);\n}\n.bubble.cheer {\n  background: #fff4c7;\n  --paper: #fff4c7;\n}\n.bubble .title {\n  display: block;\n  font-weight: 800;\n  font-size: 13px;\n  letter-spacing: 0.02em;\n  color: var(--accent);\n  margin-bottom: 4px;\n}\n.bubble .title:empty {\n  display: none;\n}\n.bubble .text {\n  display: block;\n}\n.bubble .text b {\n  color: #1f1410;\n  background: linear-gradient(transparent 60%, #ffe2a8 60%);\n}\n.bubble .text code {\n  font-family: Consolas, 'D2Coding', monospace;\n  font-size: 13.5px;\n  background: var(--paper2);\n  padding: 1px 5px;\n  border-radius: 4px;\n}\n\n/* 고양이 질문의 고를 것 (두 개까지) */\n.bubble .choices {\n  display: flex;\n  gap: 8px;\n  margin-top: 10px;\n}\n.bubble .choices:empty {\n  display: none;\n}\n.bubble .choices button,\n.card-buttons button {\n  flex: 1 0 auto;\n  white-space: nowrap;\n  font: inherit;\n  font-size: 14px;\n  font-weight: 700;\n  padding: 6px 14px;\n  color: var(--ink);\n  background: var(--paper);\n  border: 2px solid var(--ink);\n  border-radius: 999px;\n  cursor: pointer;\n  box-shadow: 2px 2px 0 rgba(58, 33, 24, 0.25);\n}\n.bubble .choices button:hover,\n.card-buttons button:hover {\n  background: #ffe9c7;\n  transform: translateY(-1px);\n}\n.bubble .choices button:first-child,\n.card-buttons button.primary {\n  background: #ffe2a8;\n}\n\n/* 좌측 하단 \"← 이전\" · 우측 하단 \"다음 →\" */\n.bubble .nav {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  margin-top: 6px;\n}\n.bubble .nav[hidden] {\n  display: none;\n}\n.bubble .nav button {\n  font: inherit;\n  font-size: 12px;\n  font-weight: 700;\n  color: var(--muted);\n  background: none;\n  border: 0;\n  padding: 2px 0;\n  cursor: pointer;\n}\n.bubble .nav button:hover {\n  color: var(--accent);\n  text-decoration: underline;\n}\n.bubble .nav button:empty {\n  visibility: hidden;\n}\n/* 지난 말을 다시 보는 중 */\n.bubble.past {\n  background: #f3ece2;\n  --paper: #f3ece2;\n}\n\n/* ---------- 카드 (긴 설명) ---------- */\n\n.card {\n  position: absolute;\n  z-index: 5;\n  left: 50%;\n  width: 480px;\n  max-width: calc(100% - 24px);\n  max-height: 78vh;\n  /* 창이 낮으면 본문만 스크롤하고 제목 · 버튼은 늘 보이게 */\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n  box-sizing: border-box;\n  padding: 14px 16px 12px;\n  background: var(--paper);\n  color: var(--ink);\n  font-size: 15px;\n  line-height: 1.55;\n  word-break: keep-all;\n  border: 2.5px solid var(--ink);\n  border-radius: 12px;\n  box-shadow: 5px 5px 0 rgba(58, 33, 24, 0.22);\n  transform: translateX(-50%) scale(0.8);\n  opacity: 0;\n  transition: transform 0.18s steps(3), opacity 0.12s;\n}\n.card.show {\n  transform: translateX(-50%) scale(1);\n  opacity: 1;\n}\n.card-title {\n  font-weight: 800;\n  font-size: 16px;\n  margin-bottom: 8px;\n  padding-bottom: 6px;\n  border-bottom: 2px dashed var(--line);\n}\n.card[hidden] {\n  display: none;\n}\n.card-title,\n.card > .figure,\n.card-buttons,\n.card > .hint {\n  flex-shrink: 0;\n}\n.card-body {\n  min-height: 0;\n  overflow-y: auto;\n}\n.card-body p {\n  margin: 0 0 8px;\n}\n.card-body p:last-child {\n  margin-bottom: 0;\n}\n.card-body code,\n.figure code {\n  font-family: Consolas, 'D2Coding', monospace;\n  font-size: 13.5px;\n  background: var(--paper2);\n  padding: 1px 5px;\n  border-radius: 4px;\n}\n.card-body b {\n  background: linear-gradient(transparent 60%, #ffe2a8 60%);\n}\n.card-buttons {\n  display: flex;\n  gap: 8px;\n  justify-content: flex-end;\n  flex-wrap: wrap;\n  margin-top: 12px;\n}\n.card-buttons:empty {\n  display: none;\n}\n.card-buttons button {\n  flex: 0 0 auto;\n  border-radius: 8px;\n}\n.card .hint {\n  display: block;\n  text-align: right;\n  margin-top: 6px;\n  color: var(--muted);\n  font-size: 11px;\n}\n.card .hint:empty {\n  display: none;\n}\n\n/* ---------- 인포그래픽 ---------- */\n\n.figure {\n  margin: 8px 0 4px;\n  padding: 10px 12px;\n  background: var(--paper2);\n  border-radius: 8px;\n  font-size: 13px;\n  line-height: 1.4;\n  word-break: keep-all;\n  overflow-wrap: normal;\n}\n.figure:empty {\n  display: none;\n}\n.fig-row {\n  display: flex;\n  align-items: stretch;\n  justify-content: center;\n  gap: 8px;\n  flex-wrap: wrap;\n}\n.fig-box {\n  flex: 1 1 auto;\n  min-width: fit-content;\n  max-width: 100%;\n  padding: 8px 8px 7px;\n  background: #fff;\n  border: 2px solid var(--ink);\n  border-radius: 8px;\n  text-align: center;\n}\n.fig-box .ico {\n  font-size: 22px;\n  line-height: 1;\n  display: block;\n  margin-bottom: 4px;\n}\n.fig-box .name {\n  display: block;\n  font-weight: 800;\n  white-space: nowrap;\n}\n.fig-box .sub {\n  display: block;\n  color: var(--muted);\n  font-size: 11.5px;\n  max-width: 11em;\n  margin: 0 auto;\n}\n.fig-box.ai {\n  border-color: var(--accent2);\n  background: #eef5f0;\n}\n.fig-box.me {\n  border-color: var(--accent);\n  background: #fff2ea;\n}\n.fig-arrow {\n  align-self: center;\n  font-size: 18px;\n  color: var(--muted);\n}\n.fig-note {\n  margin-top: 6px;\n  color: var(--muted);\n  font-size: 11.5px;\n  text-align: center;\n}\n/* 마크다운 입력 → 결과 */\n.fig-md {\n  display: grid;\n  grid-template-columns: 1fr 24px 1fr;\n  gap: 4px 6px;\n  align-items: center;\n}\n.fig-md code {\n  display: block;\n  padding: 3px 7px;\n  background: #fff;\n  border: 1.5px solid var(--line);\n  border-radius: 5px;\n}\n.fig-md .arrow {\n  text-align: center;\n  color: var(--muted);\n}\n.fig-md .out {\n  padding: 3px 7px;\n}\n.fig-md .out.h {\n  font-size: 18px;\n  font-weight: 800;\n}\n.fig-md .out.b b {\n  background: none;\n}\n.fig-md .out.li::before {\n  content: '• ';\n}\n/* 종이 두 장 + 실 */\n.fig-link {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 0;\n}\n.fig-link .sheet {\n  padding: 8px 10px;\n  background: #fff;\n  border: 2px solid var(--ink);\n  border-radius: 4px;\n  font-weight: 700;\n}\n.fig-link .thread {\n  width: 60px;\n  height: 2px;\n  background: repeating-linear-gradient(90deg, var(--accent) 0 6px, transparent 6px 10px);\n}\n/* 순환 */\n.fig-loop {\n  display: flex;\n  justify-content: center;\n  gap: 6px;\n  align-items: center;\n  flex-wrap: wrap;\n}\n.fig-loop .step {\n  white-space: nowrap;\n  padding: 5px 10px;\n  border-radius: 999px;\n  background: #fff;\n  border: 2px solid var(--ink);\n  font-weight: 700;\n}\n.fig-loop .step.ai {\n  border-color: var(--accent2);\n  background: #eef5f0;\n}\n\n/* ---------- 직전 말 다시 보기 ---------- */\n\n.replay {\n  position: absolute;\n  z-index: 6;\n  padding: 5px 10px;\n  font: inherit;\n  font-size: 12px;\n  font-weight: 700;\n  color: var(--ink);\n  background: var(--paper);\n  border: 2px solid var(--ink);\n  border-radius: 999px;\n  box-shadow: 2px 2px 0 rgba(58, 33, 24, 0.25);\n  cursor: pointer;\n  white-space: nowrap;\n}\n.replay:hover {\n  background: #ffe9c7;\n}\n\n/* ---------- 가리키기 표식 (라벨. 화살표와 과녁은 #field 에 그린다) ---------- */\n\n.point {\n  position: absolute;\n  z-index: 5;\n  padding: 3px 10px;\n  background: var(--accent);\n  color: #fff;\n  font-size: 13px;\n  font-weight: 700;\n  border-radius: 6px;\n  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);\n  white-space: nowrap;\n  pointer-events: none;\n}\n\n[hidden]:not(#lwt-a):not(#lwt-b) {\n  display: none;\n}\n\n/* iframe 안에만 더하는 스타일. 펫 무대는 투명하다 */\nhtml.lwt-pet,\nhtml.lwt-pet body {\n  background: transparent;\n}\n"};
module.exports.run = function run(window, document, pet) {
  var module, exports, require;
  var globalThis = window, self = window;
  var setTimeout = window.setTimeout.bind(window), clearTimeout = window.clearTimeout.bind(window);
  var setInterval = window.setInterval.bind(window), clearInterval = window.clearInterval.bind(window);
  var requestAnimationFrame = window.requestAnimationFrame.bind(window), cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  var getComputedStyle = window.getComputedStyle.bind(window);
  var performance = window.performance;
  var AudioContext = window.AudioContext;
  var PetSprite, PetSound, I18N;
/* kit/i18n.js */
// 사람이 읽는 글. 플러그인(호스트)과 펫 판(iframe)이 같이 쓴다.
// 고양이가 수업 중에 하는 말은 레슨 데이터(core/lessons)에 있고, 여기엔 버튼·명령·설정 같은 UI 글만 둔다.
// 언어: ko · en · zh(간체). 빠진 키는 한국어로 떨어진다. tests/run.js 가 세 언어의 키가 같은지 본다.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.I18N = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const LANGS = ['ko', 'en', 'zh'];
  const LOCALES = { ko: 'ko-KR', en: 'en-US', zh: 'zh-CN' };
  const DEFAULT_LANG = 'ko';

  const UI = {
    ko: {
      'pet.clickNext': '클릭하면 다음 →',
      'pet.next': '다음 →',
      'pet.prev': '← 이전',
      'pet.nextTip': '말풍선 아무 데나 눌러도 넘어가',
      'pet.replay': '💬 직전 말 다시 보기',
      'cmd.open': '수업 열기',
      'cmd.resume': '수업 이어 하기',
      'cmd.restart': '수업 처음부터',
      'cmd.skip': '이 레슨 건너뛰기',
      'cmd.undo': '이 레슨 되돌리기',
      'cmd.stop': '수업 잠깐 멈추기',
      'cmd.map': '진행 지도 열기',
      'cmd.resetPosition': '고양이 자리 초기화',
      'cmd.togglePet': '고양이 보이기 · 숨기기',
      'cmd.demo': '데모: 고양이 시험',
      'menu.size.small': '작게',
      'menu.size.normal': '보통',
      'menu.size.large': '크게',
      'menu.size.xlarge': '아주 크게',
      'menu.map': '진행 지도',
      'menu.hide': '잠깐 숨기기',
      'menu.reset': '자리 초기화',
      'map.title': '수업 진행 지도',
      'map.nowLabel': '지금 레슨',
      'map.allDone': '전부 마쳤어요',
      'map.allDoneSub': '이제 매일 세 줄, 주 1회 ingest. 고양이가 가끔 챙길게요.',
      'map.notStarted': '아직 시작 전',
      'map.notStartedSub': '옵시디언 사용법 기초(약 30분) → LLM Wiki 만들기(약 50분)',
      'map.stepOf': '{n} / {total} 단계 · 약 {min}분',
      'map.running': '수업 중…',
      'map.replay': '처음부터 다시',
      'map.start': '시작하기',
      'map.courseA': '옵시디언 사용법 기초',
      'map.courseB': 'LLM Wiki 만들기',
      'map.skipA': '건너뛰기',
      'map.skippedA': '옵시디언 사용법 기초를 들은 걸로 쳤어요. 기초 코스에서 만들었을 노트도 연습 폴더에 만들어 두었어요.',
      'map.locked': '앞 레슨({id} · {title})을 먼저 마쳐야 열려요.',
      'map.lockedCourse': 'LLM Wiki 만들기는 옵시디언 사용법 기초를 다 듣거나, 기초 코스 옆 "건너뛰기"를 누른 뒤에 열려요. 기초 코스에서 만드는 노트를 뒤 코스에서 쓰기 때문이에요.',
      'notes.title': '필기 노트',
      'notes.showAll': '한번에 보기',
      'notes.empty': '고양이가 설명하는 동안 핵심만 여기에 기록해 둘게.',
      'notes.none': 'A1 부터 고양이가 설명하는 핵심을 여기에 기록해 줄게.',
      'restart.title': '수업을 처음부터',
      'restart.body': '수업 진행만 처음으로 돌릴까요, 아니면 연습 폴더 "{root}"에 만든 노트까지 전부 지울까요? 지우는 건 휴지통으로 가요.',
      'restart.lessonsOnly': '수업만 처음부터',
      'restart.wipeNotes': '노트까지 초기화',
      'restart.wiped': '연습 폴더의 {n}개를 휴지통으로 보냈어요',
      'set.language': '언어',
      'set.languageDesc': '고양이 말과 메뉴의 언어',
      'set.scale': '고양이 크기',
      'set.scaleDesc': '3(작게) ~ 8(크게). 고양이를 우클릭해도 바꿀 수 있어요',
      'set.showPet': '고양이 보이기',
      'set.showPetDesc': '작업 영역 바닥에 고양이를 둔다',
      'set.sound': '효과음',
      'set.soundDesc': '말풍선 · 축하 소리',
      'set.practiceFolder': '연습 폴더 이름',
      'set.practiceFolderDesc': '수업이 파일을 만드는 유일한 폴더. 비우면 기본 이름',
      'set.habitCoach': '수료 후 습관 챙기기',
      'set.habitCoachDesc': '코스를 마친 뒤, ingest 요일과 저녁에 세 줄을 챙겨요 (하루 2번까지)',
      'set.ingestDay': 'ingest 요일',
      'set.ingestDayDesc': '이 요일에 옵시디언을 열면 고양이가 요리(ingest)하자고 해요',
      'set.yieldVaultPet': 'Vault Pet 에게 비켜 달라고 하기',
      'set.yieldVaultPetDesc': 'Vault Pet 이 같이 켜져 있으면 수업 중엔 그쪽 고양이를 숨겨요',
      'day.sun': '일요일',
      'day.mon': '월요일',
      'day.tue': '화요일',
      'day.wed': '수요일',
      'day.thu': '목요일',
      'day.fri': '금요일',
      'day.sat': '토요일',
      'habit.ingestDay': '오늘은 요리(ingest)하는 날이야. raw 폴더에 새 재료(raw 폴더 속 파일)가 {n}개 있어.',
      'habit.threeLines': '오늘 세 줄, 아직이지? 지금 적을래?',
      'habit.write': '적을게',
      'engine.hintDoIt': '내가 대신 해 줄까?',
      'engine.yesDoIt': '해 줘',
      'engine.illDoIt': '내가 할게',
      'engine.skip': '넘어가기',
      'engine.back': '돌아가기',
      'engine.next': '다음은 "{title}" ({min}분). 바로 갈까?',
      'engine.goOn': '가자',
      'engine.later': '나중에',
      'engine.laterOk': '알았어. 준비되면 맨 왼쪽 아이콘 줄의 고양이 아이콘을 눌러 줘. 거기서부터 이어서 할게.',
      'engine.allDone': '수업은 여기까지야! 이제 매일 기록하고, 일주일에 한 번 요리(ingest)만 하면 돼.',
      'engine.declined': '알았어, 안 만들게. 준비되면 맨 왼쪽 아이콘 줄의 고양이 아이콘을 눌러 줘.',
      'engine.answerWas': '답은 "{a}" 였어.',
      'engine.undone': '되돌렸어 ({n}개).',
      'engine.nothingToUndo': '되돌릴 게 없어.',
      'replay.writing': '{name} 쓰는 중…',
      'replay.ingestDone': '요리(ingest) 끝! wiki 에 노트 {n}개를 썼어.',
      'replay.queryTitle': '뭘 물어볼까?',
      'replay.queryIntro': '질문을 하나 누르면 AI 가 위키를 읽고 출처를 달아 답해. 다른 질문도 눌러 보고, 다 봤으면 "넘어가기".',
      'replay.sources': '출처',
      'replay.save': '위키에 저장',
      'replay.close': '닫기',
      'replay.saved': 'wiki 안 답변 폴더(answers)에 저장했어. 다음에 물어보면 이 답도 같이 읽어.',
      'replay.lintTitle': '위키 청소 결과',
      'replay.fix': '고쳐 줘',
      'replay.lintLater': '나중에',
      'replay.fixed': '다 고쳤어. 어긋난 내용은 맞추고, 고아 노트는 잇고, 빠진 개념 노트는 새로 썼어.',
      'replay.ruleAdded': 'AGENTS.md 에 규칙 한 줄을 더했어. 이 규칙대로 다시 요리(ingest)해 볼게.',
      'replay.schemaTitle': '규칙이 바뀌어서 달라진 노트',
      'replay.schemaBody': '개념 폴더(concepts)의 노트마다 "예시" 칸이 생겼어. 아래 노트를 눌러 확인해 봐.',
      'replay.ok': '확인',
      'real.askMode': '평소 쓰는 AI 가 뭐야? 클로드 데스크톱 앱이면 폴더를 바로 연결할 수 있어.',
      'real.modeClaude': '클로드 데스크톱 앱',
      'real.modeOther': '그 밖 (ChatGPT 등)',
      'real.folderTitle': '클로드 앱에 이 볼트 연결하기',
      'real.folderBody': '1. 브라우저 말고 **설치한 클로드 데스크톱 앱**을 연다.\n2. 입력창 아래 **Cowork** 탭을 누른다. 내 폴더를 읽고 쓰는 건 코워크에서만 된다.\n3. **프로젝트 또는 폴더 → 폴더 추가**에서 이 볼트 폴더("{vault}")를 고른다.\n4. 폴더 접근을 허용할지 물으면 허용.\n\n제대로 됐는지는 아래 확인 문장을 붙여넣어 보면 돼. raw 와 wiki 를 말하면 된 거야.\n\n연결을 마쳤으면 **다 했어**를 눌러 줘. 다음으로 넘어갈게.',
      'real.copyCheck': '확인 문장 복사',
      'real.ok': '다 했어',
      'real.checkPrompt': '지금 작업 폴더에 뭐가 있는지 알려줘',
      'real.checkSay': '클로드 창에 붙여넣어 봐. raw 랑 wiki 를 말하면 연결된 거야.',
      'real.ingestFolderTitle': '실제 요리(ingest) 한 번',
      'real.ingestFolderBody': '클로드 코워크 대화창에 아래 문장을 붙여넣으면 돼. 클로드가 규칙 파일(AGENTS.md)을 읽고 raw 폴더의 새 재료(raw 폴더 속 파일)를 요리(ingest)해서 wiki 에 노트를 쓸 거야.\n\n`{root}/AGENTS.md 를 읽고 raw 의 새 재료를 ingest 해 줘`\n\n"이 범위로 할까요?" 하고 물으면 훑어보고 진행. wiki 에 새 노트가 생기면 고양이가 알아차릴게.\n\n붙여넣었으면 **다 했어**를 눌러 줘.',
      'real.ingestPrompt': '{root}/AGENTS.md 를 읽고 raw 폴더의 새 재료를 ingest 해 줘. 결과 노트는 wiki 폴더에 써 주고, wiki/index.md 와 wiki/log.md 도 갱신해 줘.',
      'real.copyPrompt': '프롬프트 복사',
      'real.waitFolder': '붙여넣고 기다려 봐. wiki 에 새 노트가 생기면 바로 알려 줄게.',
      'real.pasteTitle': 'AI 에게 줄 묶음',
      'real.pasteBody': '규칙 파일(AGENTS.md) + 목차(index.md) + 아직 요리(ingest) 안 한 재료(raw 폴더 속 파일) {n}개를 글 한 덩어리로 묶었어.\n\n**프롬프트 복사** → 평소 쓰는 AI 채팅에 붙여넣기 → AI 의 답을 통째로 복사 → 다시 여기로.',
      'real.pasteSay': 'AI 답이 오면 전부 복사해서, 뜨는 창에 붙여넣어 줘.',
      'real.noFresh': 'raw 폴더에 아직 요리(ingest) 안 한 재료(raw 폴더 속 파일)가 없어. 하나 넣고 다시 불러 줘.',
      'real.noBlocks': '답에 노트를 나누는 표시가 없어서 노트 하나로 받아 뒀어. 나중에 AI 에게 나눠 달라고 해도 돼.',
      'real.rawAnswerName': '받은 답 {stamp}',
      'real.skipped': 'wiki 밖 경로 {n}개는 건너뛰었어요',
      'real.pages': '개',
      'real.applied': 'wiki 에 노트 {n}개를 넣었어. 실제 요리(ingest) 끝!',
      'real.copied': '복사했어요. AI 채팅에 붙여넣으세요',
      'real.copyFailed': '복사가 안 됐어요. 카드 내용을 직접 복사해 주세요',
      'real.cardsTitle': '수료 선물 — 매일 쓸 문장 3개',
      'real.cardsBody': '버튼을 누르면 복사돼. AI 채팅에 붙여넣기만 하면 돼.',
      'real.card1': '이번 주 정리',
      'real.card1Text': '{root}/AGENTS.md 를 읽고, raw 의 이번 주 재료를 ingest 해 줘. 끝나면 어떤 노트를 썼는지 알려 줘.',
      'real.card2': '그때 왜 그랬더라',
      'real.card2Text': '{root}/wiki 를 읽고, [무엇]을 내가 왜 그렇게 했는지 찾아서 알려 줘. 근거가 된 노트도 같이. 기록에 없으면 없다고 말해 줘.',
      'real.card3': '청소 한 번',
      'real.card3Text': '{root}/wiki 를 점검(lint)해 줘. 서로 어긋나는 말, 아무도 링크하지 않는 노트, 있어야 하는데 없는 개념 노트를 찾아서 고칠지 물어봐 줘.',
      'paste.title': 'AI 의 답 붙여넣기',
      'paste.help': 'AI 가 준 답을 전부 복사해서 여기 붙여넣으세요. "=== FILE: wiki/… ===" 표시대로 노트를 나눠 미리 보여 드려요.',
      'paste.placeholder': '여기에 붙여넣기',
      'paste.apply': '노트로 나누기',
      'paste.later': '나중에',
      'preview.title': '이걸 만들게',
      'preview.titleWiki': '재료를 바탕으로 위키에 이 노트들을 만들게',
      'preview.apply': '만들기',
      'preview.cancel': '취소',
      'poke.0': '응?',
      'poke.1': '나 여기 있어.',
      'poke.2': '같이 하자.',
      'demo.hello': '안녕! 나는 위키 룸메이트 고양이야.||위키 보고 왔지?',
      'demo.ask': '옵시디언은 처음이야?',
      'demo.yes': '응, 처음',
      'demo.no': '좀 써 봤어',
      'demo.first': '그럼 기초부터 같이 가자.',
      'demo.notFirst': '좋아, 그럼 바로 위키로.',
      'demo.goFolder': '저기 raw 폴더로 가 볼게.',
      'demo.point': '여기가 raw 폴더야',
      'demo.noExplorer': '파일 탐색기가 안 보여서 못 가리키겠어. 왼쪽 패널을 열어 줘.',
      'demo.carry': '샘플 글을 물고 raw 로 옮겨 볼게.',
      'demo.busy': '잠깐, 요리(ingest) 중…',
      'demo.done': '끝! 시험 통과.',
    },
    en: {
      'pet.clickNext': 'Click to continue →',
      'pet.next': 'Next →',
      'pet.prev': '← Back',
      'pet.nextTip': 'Click anywhere on the bubble to continue',
      'pet.replay': '💬 Show last message again',
      'cmd.open': 'Open the lesson',
      'cmd.resume': 'Resume the lesson',
      'cmd.restart': 'Restart from the beginning',
      'cmd.skip': 'Skip this lesson',
      'cmd.undo': 'Undo this lesson',
      'cmd.stop': 'Pause the lesson',
      'cmd.map': 'Open the progress map',
      'cmd.resetPosition': 'Reset cat position',
      'cmd.togglePet': 'Show / hide the cat',
      'cmd.demo': 'Demo: cat test',
      'menu.size.small': 'Small',
      'menu.size.normal': 'Normal',
      'menu.size.large': 'Large',
      'menu.size.xlarge': 'Extra large',
      'menu.map': 'Progress map',
      'menu.hide': 'Hide for a while',
      'menu.reset': 'Reset position',
      'map.title': 'Lesson progress map',
      'map.nowLabel': 'Current lesson',
      'map.allDone': 'All done',
      'map.allDoneSub': 'From now on: three lines a day, one ingest a week. The cat will check in now and then.',
      'map.notStarted': 'Not started yet',
      'map.notStartedSub': 'Obsidian Basics (about 30 min) → Build an LLM Wiki (about 50 min)',
      'map.stepOf': 'Step {n} / {total} · about {min} min',
      'map.running': 'In a lesson…',
      'map.replay': 'Start over',
      'map.start': 'Start',
      'map.courseA': 'Obsidian Basics',
      'map.courseB': 'Build an LLM Wiki',
      'map.skipA': 'Skip',
      'map.skippedA': 'Obsidian Basics is marked as done. The notes the basics course would have made are now in your practice folder.',
      'map.locked': 'Opens after you finish the previous lesson ({id} · {title}).',
      'map.lockedCourse': 'Build an LLM Wiki opens after you finish Obsidian Basics, or click "Skip" next to the basics course. The later course uses notes made in the basics course.',
      'notes.title': 'Notes',
      'notes.showAll': 'Show all',
      'notes.empty': 'While the cat explains, I\'ll write down just the key points here.',
      'notes.none': 'Starting with A1, I\'ll write down the key points the cat explains here.',
      'restart.title': 'Restart from the beginning',
      'restart.body': 'Reset only the lesson progress, or also delete every note made in the practice folder "{root}"? Deleted notes go to the trash.',
      'restart.lessonsOnly': 'Reset lessons only',
      'restart.wipeNotes': 'Reset notes too',
      'restart.wiped': 'Moved {n} item(s) from the practice folder to the trash',
      'set.language': 'Language',
      'set.languageDesc': 'Language for the cat and the menus',
      'set.scale': 'Cat size',
      'set.scaleDesc': '3 (small) to 8 (large). You can also right-click the cat to change it',
      'set.showPet': 'Show the cat',
      'set.showPetDesc': 'Keep the cat at the bottom of the workspace',
      'set.sound': 'Sound effects',
      'set.soundDesc': 'Speech bubble and celebration sounds',
      'set.practiceFolder': 'Practice folder name',
      'set.practiceFolderDesc': 'The only folder the lessons create files in. Leave empty for the default name',
      'set.habitCoach': 'Habit reminders after graduation',
      'set.habitCoachDesc': 'After the course, reminds you on ingest day and about three lines in the evening (at most twice a day)',
      'set.ingestDay': 'Ingest day',
      'set.ingestDayDesc': 'When you open Obsidian on this day, the cat suggests cooking (ingest)',
      'set.yieldVaultPet': 'Ask Vault Pet to step aside',
      'set.yieldVaultPetDesc': 'If Vault Pet is also enabled, its cat hides during lessons',
      'day.sun': 'Sunday',
      'day.mon': 'Monday',
      'day.tue': 'Tuesday',
      'day.wed': 'Wednesday',
      'day.thu': 'Thursday',
      'day.fri': 'Friday',
      'day.sat': 'Saturday',
      'habit.ingestDay': 'Today\'s cooking (ingest) day. There are {n} new ingredient(s) in the raw folder.',
      'habit.threeLines': 'No three lines yet today, right? Want to write them now?',
      'habit.write': 'I\'ll write',
      'engine.hintDoIt': 'Want me to do it for you?',
      'engine.yesDoIt': 'Do it',
      'engine.illDoIt': 'I\'ll do it',
      'engine.skip': 'Move on',
      'engine.back': 'Go back',
      'engine.next': 'Next up is "{title}" ({min} min). Go now?',
      'engine.goOn': 'Let\'s go',
      'engine.later': 'Later',
      'engine.laterOk': 'Got it. When you\'re ready, click the cat icon in the ribbon on the far left. We\'ll pick up from there.',
      'engine.allDone': 'That\'s the end of class! From here, just write things down every day and cook (ingest) once a week.',
      'engine.declined': 'Okay, I won\'t create it. When you\'re ready, click the cat icon in the ribbon on the far left.',
      'engine.answerWas': 'The answer was "{a}".',
      'engine.undone': 'Undone ({n} item(s)).',
      'engine.nothingToUndo': 'Nothing to undo.',
      'replay.writing': 'Writing {name}…',
      'replay.ingestDone': 'Cooking (ingest) done! I wrote {n} note(s) in wiki.',
      'replay.queryTitle': 'What should we ask?',
      'replay.queryIntro': 'Click a question and the AI reads the wiki and answers with sources. Try the other questions too, and when you\'re done, click "Move on".',
      'replay.sources': 'Sources',
      'replay.save': 'Save to wiki',
      'replay.close': 'Close',
      'replay.saved': 'Saved it to the answers folder (answers) in wiki. Next time you ask, this answer gets read too.',
      'replay.lintTitle': 'Wiki cleanup results',
      'replay.fix': 'Fix it',
      'replay.lintLater': 'Later',
      'replay.fixed': 'All fixed. I lined up the conflicting bits, linked the orphan notes, and wrote the missing concept notes.',
      'replay.ruleAdded': 'I added one rule to AGENTS.md. Let me cook (ingest) again with this rule.',
      'replay.schemaTitle': 'Notes changed by the new rule',
      'replay.schemaBody': 'Every note in the concepts folder (concepts) now has an "Example" section. Click a note below to check.',
      'replay.ok': 'OK',
      'real.askMode': 'Which AI do you usually use? If it\'s the Claude desktop app, you can connect the folder directly.',
      'real.modeClaude': 'Claude desktop app',
      'real.modeOther': 'Something else (ChatGPT, etc.)',
      'real.folderTitle': 'Connect this vault to the Claude app',
      'real.folderBody': '1. Open the **installed Claude desktop app**, not the browser.\n2. Click the **Cowork** tab under the input box. Only Cowork can read and write your folders.\n3. Under **Project or folder → Add folder**, choose this vault folder ("{vault}").\n4. If it asks whether to allow folder access, allow it.\n\nTo check it worked, paste the check sentence below. If it mentions raw and wiki, you\'re connected.\n\nOnce you\'re connected, click **Done**. We\'ll move on.',
      'real.copyCheck': 'Copy check sentence',
      'real.ok': 'Done',
      'real.checkPrompt': 'Tell me what\'s in the current working folder',
      'real.checkSay': 'Paste it into the Claude window. If it mentions raw and wiki, you\'re connected.',
      'real.ingestFolderTitle': 'One real cook (ingest)',
      'real.ingestFolderBody': 'Paste the sentence below into the Claude Cowork chat. Claude will read the rules file (AGENTS.md), cook (ingest) the new ingredients in the raw folder, and write notes in wiki.\n\n`Read {root}/AGENTS.md and ingest the new ingredients in raw`\n\nIf it asks something like "Should I go with this scope?", skim it and go ahead. The cat will notice when new notes show up in wiki.\n\nOnce you\'ve pasted it, click **Done**.',
      'real.ingestPrompt': 'Read {root}/AGENTS.md and ingest the new ingredients in the raw folder. Write the resulting notes in the wiki folder, and update wiki/index.md and wiki/log.md too.',
      'real.copyPrompt': 'Copy prompt',
      'real.waitFolder': 'Paste it and wait. I\'ll tell you as soon as a new note shows up in wiki.',
      'real.pasteTitle': 'A bundle for your AI',
      'real.pasteBody': 'I bundled the rules file (AGENTS.md) + contents (index.md) + {n} uncooked ingredient(s) (files in the raw folder) into one block of text.\n\n**Copy prompt** → paste into your usual AI chat → copy the AI\'s whole answer → come back here.',
      'real.pasteSay': 'When the AI answers, copy all of it and paste it into the window that opens.',
      'real.noFresh': 'There are no uncooked ingredients in the raw folder yet. Add one and call me again.',
      'real.noBlocks': 'The answer had no markers splitting it into notes, so I saved it as one note. You can ask the AI to split it later.',
      'real.rawAnswerName': 'Received answer {stamp}',
      'real.skipped': 'Skipped {n} path(s) outside wiki',
      'real.pages': 'notes',
      'real.applied': 'Put {n} note(s) in wiki. Real cooking (ingest) done!',
      'real.copied': 'Copied. Paste it into your AI chat',
      'real.copyFailed': 'Couldn\'t copy. Please copy the card text yourself',
      'real.cardsTitle': 'Graduation gift — 3 sentences for every day',
      'real.cardsBody': 'Click a button to copy. Then just paste it into your AI chat.',
      'real.card1': 'This week\'s cooking',
      'real.card1Text': 'Read {root}/AGENTS.md and ingest this week\'s ingredients in raw. When you\'re done, tell me which notes you wrote.',
      'real.card2': 'Why did I do that again?',
      'real.card2Text': 'Read {root}/wiki and find out why I did [what] the way I did. Include the notes it\'s based on. If it\'s not in the records, tell me so.',
      'real.card3': 'A quick cleanup',
      'real.card3Text': 'Check (lint) {root}/wiki. Find statements that contradict each other, notes nothing links to, and concept notes that should exist but don\'t, then ask me whether to fix them.',
      'paste.title': 'Paste the AI\'s answer',
      'paste.help': 'Copy the AI\'s whole answer and paste it here. I\'ll split it into notes by the "=== FILE: wiki/… ===" markers and show you a preview.',
      'paste.placeholder': 'Paste here',
      'paste.apply': 'Split into notes',
      'paste.later': 'Later',
      'preview.title': 'I\'ll create this',
      'preview.titleWiki': 'From the ingredients, I\'ll create these notes in the wiki',
      'preview.apply': 'Create',
      'preview.cancel': 'Cancel',
      'poke.0': 'Hm?',
      'poke.1': 'I\'m right here.',
      'poke.2': 'Let\'s do this together.',
      'demo.hello': 'Hi! I\'m your wiki roommate cat.||You\'re here because of the wiki, right?',
      'demo.ask': 'Is this your first time in Obsidian?',
      'demo.yes': 'Yes, first time',
      'demo.no': 'I\'ve used it a bit',
      'demo.first': 'Then let\'s start with the basics together.',
      'demo.notFirst': 'Great, straight to the wiki then.',
      'demo.goFolder': 'I\'ll walk over to the raw folder.',
      'demo.point': 'This is the raw folder',
      'demo.noExplorer': 'I can\'t see the File explorer, so I can\'t point at it. Please open the left sidebar.',
      'demo.carry': 'I\'ll carry the sample note over to raw.',
      'demo.busy': 'One sec, cooking (ingest)…',
      'demo.done': 'Done! Test passed.',
    },
    zh: {
      'pet.clickNext': '点击继续 →',
      'pet.next': '继续 →',
      'pet.prev': '← 上一句',
      'pet.nextTip': '点气泡任意处也可以继续',
      'pet.replay': '💬 再看一遍刚才的话',
      'cmd.open': '打开课程',
      'cmd.resume': '继续课程',
      'cmd.restart': '从头开始课程',
      'cmd.skip': '跳过这一课',
      'cmd.undo': '撤销这一课',
      'cmd.stop': '暂停课程',
      'cmd.map': '打开进度地图',
      'cmd.resetPosition': '重置猫的位置',
      'cmd.togglePet': '显示 · 隐藏猫',
      'cmd.demo': '演示：测试猫',
      'menu.size.small': '小',
      'menu.size.normal': '中',
      'menu.size.large': '大',
      'menu.size.xlarge': '特大',
      'menu.map': '进度地图',
      'menu.hide': '暂时隐藏',
      'menu.reset': '重置位置',
      'map.title': '课程进度地图',
      'map.nowLabel': '当前这一课',
      'map.allDone': '全部学完了',
      'map.allDoneSub': '接下来每天三行，每周一次 ingest。猫会时不时提醒你。',
      'map.notStarted': '尚未开始',
      'map.notStartedSub': 'Obsidian 基础（约 30 分钟）→ 制作 LLM Wiki（约 50 分钟）',
      'map.stepOf': '第 {n} / {total} 步 · 约 {min} 分钟',
      'map.running': '上课中…',
      'map.replay': '从头再来',
      'map.start': '开始',
      'map.courseA': 'Obsidian 基础',
      'map.courseB': '制作 LLM Wiki',
      'map.skipA': '跳过',
      'map.skippedA': '已将 Obsidian 基础视为学完。基础课程里会建的笔记，也已经在练习文件夹里建好了。',
      'map.locked': '要先学完前一课（{id} · {title}）才能打开。',
      'map.lockedCourse': '学完 Obsidian 基础，或点基础课程旁边的“跳过”之后，才能打开“制作 LLM Wiki”。因为后面的课程会用到基础课程里建的笔记。',
      'notes.title': '笔记',
      'notes.showAll': '查看全部',
      'notes.empty': '猫讲解的时候，我只把要点记在这里。',
      'notes.none': '从 A1 开始，我会把猫讲的要点记在这里。',
      'restart.title': '从头开始课程',
      'restart.body': '只把课程进度重置，还是连练习文件夹“{root}”里建的笔记也全部删除？删除的内容会移到回收站。',
      'restart.lessonsOnly': '只重置课程',
      'restart.wipeNotes': '连笔记一起重置',
      'restart.wiped': '已把练习文件夹里的 {n} 项移到回收站',
      'set.language': '语言',
      'set.languageDesc': '猫的对话和菜单使用的语言',
      'set.scale': '猫的大小',
      'set.scaleDesc': '3（小）～ 8（大）。也可以右键点猫来调整',
      'set.showPet': '显示猫',
      'set.showPetDesc': '让猫待在工作区底部',
      'set.sound': '音效',
      'set.soundDesc': '对话气泡 · 庆祝的声音',
      'set.practiceFolder': '练习文件夹名称',
      'set.practiceFolderDesc': '课程唯一会创建文件的文件夹。留空则使用默认名称',
      'set.habitCoach': '结业后的习惯提醒',
      'set.habitCoachDesc': '学完课程后，在 ingest 日提醒烹饪，在晚上提醒写三行（每天最多两次）',
      'set.ingestDay': 'ingest 日',
      'set.ingestDayDesc': '在这一天打开 Obsidian 时，猫会提议烹饪（ingest）',
      'set.yieldVaultPet': '请 Vault Pet 让位',
      'set.yieldVaultPetDesc': '如果同时启用了 Vault Pet，上课时会隐藏那边的猫',
      'day.sun': '周日',
      'day.mon': '周一',
      'day.tue': '周二',
      'day.wed': '周三',
      'day.thu': '周四',
      'day.fri': '周五',
      'day.sat': '周六',
      'habit.ingestDay': '今天是烹饪（ingest）日。raw 文件夹里有 {n} 份新食材（raw 文件夹里的文件）。',
      'habit.threeLines': '今天的三行还没写吧？现在写吗？',
      'habit.write': '这就写',
      'engine.hintDoIt': '要我替你做吗？',
      'engine.yesDoIt': '帮我做',
      'engine.illDoIt': '我自己来',
      'engine.skip': '下一步',
      'engine.back': '返回',
      'engine.next': '下一课是“{title}”（{min} 分钟）。现在就去吗？',
      'engine.goOn': '走吧',
      'engine.later': '稍后',
      'engine.laterOk': '好。准备好了就点最左边图标栏里的猫图标，我们从这里接着来。',
      'engine.allDone': '课程就到这里！之后只要每天记录，每周烹饪（ingest）一次就行。',
      'engine.declined': '好，那就不建了。准备好了就点最左边图标栏里的猫图标。',
      'engine.answerWas': '答案是“{a}”。',
      'engine.undone': '撤销好了（{n} 项）。',
      'engine.nothingToUndo': '没有可以撤销的。',
      'replay.writing': '正在写 {name}…',
      'replay.ingestDone': '烹饪（ingest）完成！在 wiki 里写了 {n} 篇笔记。',
      'replay.queryTitle': '想问什么？',
      'replay.queryIntro': '点一个问题，AI 就会读维基，附上出处来回答。其他问题也可以点点看，都看完了就点“下一步”。',
      'replay.sources': '出处',
      'replay.save': '保存到维基',
      'replay.close': '关闭',
      'replay.saved': '已保存到 wiki 里的回答文件夹（answers）。下次提问时，也会一起读这个回答。',
      'replay.lintTitle': '维基清理结果',
      'replay.fix': '帮我修好',
      'replay.lintLater': '稍后',
      'replay.fixed': '都修好了。互相矛盾的内容统一了，孤立笔记连上了，缺的概念笔记也新写好了。',
      'replay.ruleAdded': '在 AGENTS.md 里加了一条规则。我按这条规则再烹饪（ingest）一次。',
      'replay.schemaTitle': '规则变了，这些笔记也跟着变了',
      'replay.schemaBody': '概念文件夹（concepts）里的每篇笔记都多了“例子”一栏。点下面的笔记看看吧。',
      'replay.ok': '好的',
      'real.askMode': '你平时用哪个 AI？如果是 Claude 桌面应用，可以直接连接文件夹。',
      'real.modeClaude': 'Claude 桌面应用',
      'real.modeOther': '其他（ChatGPT 等）',
      'real.folderTitle': '把这个仓库连接到 Claude 应用',
      'real.folderBody': '1. 打开**已安装的 Claude 桌面应用**，不是浏览器。\n2. 点输入框下方的 **Cowork** 标签。只有在 Cowork 里才能读写你的文件夹。\n3. 在**项目或文件夹 → 添加文件夹**里，选择这个仓库文件夹（“{vault}”）。\n4. 询问是否允许访问文件夹时，选允许。\n\n想确认是否成功，把下面的检查句粘贴进去试试。它提到 raw 和 wiki 就说明连上了。\n\n连好之后点**做好了**，我们继续下一步。',
      'real.copyCheck': '复制检查句',
      'real.ok': '做好了',
      'real.checkPrompt': '告诉我当前工作文件夹里有什么',
      'real.checkSay': '粘贴到 Claude 窗口里试试。它提到 raw 和 wiki 就说明连上了。',
      'real.ingestFolderTitle': '真正烹饪（ingest）一次',
      'real.ingestFolderBody': '把下面这句粘贴到 Claude Cowork 的对话框里就行。Claude 会读规则文件（AGENTS.md），把 raw 文件夹里的新食材（raw 文件夹里的文件）烹饪（ingest）好，在 wiki 里写成笔记。\n\n`读一下 {root}/AGENTS.md，然后 ingest raw 里的新食材`\n\n如果它问“按这个范围做吗？”，看一眼就继续。wiki 里出现新笔记时，我会发现的。\n\n粘贴好了就点**做好了**。',
      'real.ingestPrompt': '请读 {root}/AGENTS.md，然后 ingest raw 文件夹里的新食材。把结果笔记写进 wiki 文件夹，并更新 wiki/index.md 和 wiki/log.md。',
      'real.copyPrompt': '复制提示词',
      'real.waitFolder': '粘贴后等一等。wiki 里一出现新笔记，我马上告诉你。',
      'real.pasteTitle': '给 AI 的打包内容',
      'real.pasteBody': '我把规则文件（AGENTS.md）+ 目录（index.md）+ {n} 份还没烹饪（ingest）的食材（raw 文件夹里的文件）打包成了一整段文字。\n\n**复制提示词** → 粘贴到你常用的 AI 对话 → 把 AI 的回答整个复制 → 回到这里。',
      'real.pasteSay': 'AI 回答后，把它全部复制，粘贴到弹出的窗口里。',
      'real.noFresh': 'raw 文件夹里还没有待烹饪（ingest）的食材（raw 文件夹里的文件）。放一份进去再叫我。',
      'real.noBlocks': '回答里没有拆分笔记的标记，我先存成了一篇笔记。之后也可以让 AI 帮你拆开。',
      'real.rawAnswerName': '收到的回答 {stamp}',
      'real.skipped': '已跳过 {n} 个 wiki 之外的路径',
      'real.pages': '篇',
      'real.applied': '已在 wiki 里放入 {n} 篇笔记。真正的烹饪（ingest）完成！',
      'real.copied': '已复制。请粘贴到 AI 对话中',
      'real.copyFailed': '复制失败。请手动复制卡片内容',
      'real.cardsTitle': '结业礼物 — 每天都能用的三句话',
      'real.cardsBody': '点按钮就会复制。粘贴到 AI 对话里就行。',
      'real.card1': '整理这周',
      'real.card1Text': '请读 {root}/AGENTS.md，然后 ingest raw 里这周的食材。做完后告诉我写了哪些笔记。',
      'real.card2': '当时为什么那样来着',
      'real.card2Text': '请读 {root}/wiki，帮我找出我当时为什么那样处理 [某事]，并附上作为依据的笔记。记录里没有的话，就直说没有。',
      'real.card3': '清理一次',
      'real.card3Text': '请检查（lint）{root}/wiki。找出互相矛盾的说法、没有任何笔记链接到的笔记、本该有却没有的概念笔记，并先问我要不要修改。',
      'paste.title': '粘贴 AI 的回答',
      'paste.help': '请把 AI 的回答全部复制后粘贴到这里。我会按“=== FILE: wiki/… ===”标记拆成笔记，先给你预览。',
      'paste.placeholder': '粘贴到这里',
      'paste.apply': '拆成笔记',
      'paste.later': '稍后',
      'preview.title': '我要建这些',
      'preview.titleWiki': '我会根据食材，在维基里建这些笔记',
      'preview.apply': '创建',
      'preview.cancel': '取消',
      'poke.0': '嗯？',
      'poke.1': '我在这儿。',
      'poke.2': '一起来吧。',
      'demo.hello': '你好！我是你的维基室友猫。||是听说了维基才来的吧？',
      'demo.ask': '第一次用 Obsidian 吗？',
      'demo.yes': '对，第一次',
      'demo.no': '用过一点',
      'demo.first': '那我们从基础开始。',
      'demo.notFirst': '好，那直接进维基。',
      'demo.goFolder': '我去那边的 raw 文件夹看看。',
      'demo.point': '这里就是 raw 文件夹',
      'demo.noExplorer': '看不到文件列表，没法指给你看。请打开左侧面板。',
      'demo.carry': '我把示例文章叼到 raw 里去。',
      'demo.busy': '稍等，烹饪（ingest）中…',
      'demo.done': '完成！测试通过。',
    },
  };

  const fill = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s);

  class Strings {
    constructor(lang) {
      this.lang = DEFAULT_LANG;
      this.set(lang);
    }
    get locale() {
      return LOCALES[this.lang] || LOCALES[DEFAULT_LANG];
    }
    set(lang) {
      if (LANGS.includes(lang)) this.lang = lang;
    }
    t(key, vars) {
      const table = UI[this.lang] || UI[DEFAULT_LANG];
      const v = key in table ? table[key] : UI[DEFAULT_LANG][key];
      if (v === undefined) return key;
      return fill(v, vars);
    }
    // { ko, en, zh } 꼴의 글에서 지금 언어 것을 고른다
    pick(obj, vars) {
      if (obj == null) return '';
      if (typeof obj === 'string') return fill(obj, vars);
      return fill(obj[this.lang] != null ? obj[this.lang] : obj[DEFAULT_LANG] != null ? obj[DEFAULT_LANG] : '', vars);
    }
  }

  return { Strings, LANGS, LOCALES, DEFAULT_LANG, UI };
});

;if (window.PetSprite !== undefined) PetSprite = window.PetSprite; if (window.PetSound !== undefined) PetSound = window.PetSound; if (window.I18N !== undefined) I18N = window.I18N;
/* kit/sprite.js */
// 도트 고양이를 코드로 그린다. 48×48 도트 캔버스에 그리고 CSS 로 확대한다.
// 펫 창과 하우스 창(미리보기)이 같이 쓴다.
//
// 컨셉 보드(Pixel Cat)를 따른다:
//  - 정면을 보는 3/4. 머리와 몸이 외곽선 하나로 이어진 둥근 네모 한 덩어리
//  - 정수리에 귀 두 개, 그 사이 이마에 세로 줄무늬, 오른쪽에 통통한 꼬리
//  - 얼굴은 점 눈 두 개 + 작은 ω 코 + 볼터치뿐 (주둥이 판·수염 없음)
//  - 몸은 단색. 그러데이션 없이 굵은 외곽선 한 겹으로만 형태를 잡는다
//
// 그리는 순서: 오프스크린 캔버스에 고양이를 그리고 → 몸 전체 변형(p.xf: 회전·뒤집기·늘이기)을 걸어
// 진짜 캔버스에 합성한 뒤 → 그 위에 효과(fx: 글자·눈물·색종이…)를 뿌린다.
// 모션은 renderer/motions.js, 악세사리는 renderer/accessories.js 가 여기에 꽂는다.
(function (global) {
  const G = 48;
  const GROUND = 44;
  // 한 상황에 여러 모션을 골랐을 때, 한 모션을 최소 몇 초나 반복하고 다음 것으로 넘어갈지 (초)
  const MOOD_HOLD = 5 * 60;

  // ---------- 털색 ----------
  // 종은 하나뿐이다. 컨셉 보드 원본에서 그대로 뽑은 치즈 고양이 색.
  const CAT = {
    body: "#f4a859", shade: "#e08f4c", light: "#f7bd7f", belly: "#f6b878",
    stripe: "#e88034", outline: "#31200f", ear: "#f4a859", nose: "#31200f",
    cheek: "#f7ab8c", eye: "#31200f", lash: "#31200f",
  };

  // ---------- 털색 17종 + 별 전용 3종 (레벨 · 별로 해금: main/growth.js 의 FURS) ----------
  // pal = 팔레트, mask(i, j) = 몸 도트(15×13) 칸마다 색 바꾸기 (null 원래대로 · 'B' 바탕 · 'W' 흰 털 · 'K' 짙은 얼룩 · 'A' 주황 얼룩),
  // tail(j) = 꼬리 줄 (0 = 꼬리 끝), rainbow = 줄마다 무지갯빛, sparkle = 털이 가끔 반짝, stars = 별이 박힌 털
  const furPal = (o) => ({ ear: o.body, nose: o.outline, cheek: '#f7ab8c', eye: o.outline, lash: o.outline, white: '#fffaf3', K: '#2f2a2a', A: '#f0a050', ...o });
  const inR = (i, a, b) => i >= a && i <= b;
  const FURS = {
    cheese: { pal: CAT },
    cream: { pal: furPal({ body: '#f6d9a8', shade: '#e9c48a', light: '#fbe8c6', belly: '#f9e2b8', stripe: '#e3b068', outline: '#3a2a18' }) },
    ginger: { pal: furPal({ body: '#ec7a34', shade: '#cc6122', light: '#f59c5e', belly: '#f2945a', stripe: '#b84e14', outline: '#2e1608' }) },
    gray: { pal: furPal({ body: '#aaa6a1', shade: '#8e8a85', light: '#c6c2bd', belly: '#bfbbb6', stripe: '#6e6a66', outline: '#262422', cheek: '#e8a9a0' }) },
    silver: { pal: furPal({ body: '#d6d9de', shade: '#bbbfc6', light: '#eef0f3', belly: '#e6e8ec', stripe: '#8a9099', outline: '#2c3038', cheek: '#f0b0b0' }) },
    blue: { pal: furPal({ body: '#8190a6', shade: '#6b7a90', light: '#9eacbf', belly: '#93a1b4', stripe: '#607086', outline: '#1e2430', eye: '#1f6b45', lash: '#1e2430', cheek: '#d7a0b0' }) },
    black: { pal: furPal({ body: '#2f2a2a', shade: '#231f1f', light: '#463e3e', belly: '#3a3434', stripe: '#1f1b1b', outline: '#120e0e', eye: '#e8c547', lash: '#120e0e', cheek: '#b86f78' }) },
    white: { pal: furPal({ body: '#f7f3ea', shade: '#e2dccf', light: '#ffffff', belly: '#ffffff', stripe: '#e6dfd1', outline: '#4a3f36', nose: '#e8878a', cheek: '#f6b3b0' }) },
    choco: { pal: furPal({ body: '#7d5034', shade: '#653f27', light: '#976648', belly: '#8c5c40', stripe: '#553320', outline: '#22120a', eye: '#1a0e06', cheek: '#d98a7a' }) },
    lilac: { pal: furPal({ body: '#cbbac6', shade: '#b4a3b0', light: '#dfd2db', belly: '#d8cad4', stripe: '#a08e9f', outline: '#3a2e38', cheek: '#f0a8bc' }) },
    peach: { pal: furPal({ body: '#ffb9a8', shade: '#f39d8c', light: '#ffd1c5', belly: '#ffc9bc', stripe: '#ee8674', outline: '#4a2420', cheek: '#ff8f9a' }) },
    mint: { pal: furPal({ body: '#a3e4ca', shade: '#83cdb0', light: '#c5f1de', belly: '#b8ecd6', stripe: '#67b596', outline: '#1f3a30', cheek: '#f6a8b8' }) },
    gold: { pal: furPal({ body: '#f6c744', shade: '#dba623', light: '#ffe27c', belly: '#fcd965', stripe: '#c98f12', outline: '#4a3208' }), sparkle: '#fffbe0' },
    galaxy: { pal: furPal({ body: '#2b2b5c', shade: '#20204a', light: '#3e3e7c', belly: '#35356c', stripe: '#6a45a0', outline: '#0c0c22', eye: '#ffd65a', lash: '#0c0c22', cheek: '#c07ad8' }), stars: true },
    rainbow: { pal: furPal({ body: '#ffd43b', shade: '#fab005', light: '#fff3bf', belly: '#fff3bf', stripe: '#f59f00', outline: '#3a2a4a' }), rainbow: true },
    // ---- 별 전용 털색 (8차, Lv80 뒤 별로 산다. main/growth.js 의 FURS 에 stars 가 붙은 것) ----
    // 오로라: 청록·초록·보랏빛이 몸을 따라 천천히 흘러간다
    aurora: { pal: furPal({ body: '#5fd4b0', shade: '#3fae92', light: '#a8f0da', belly: '#bdf5e3', stripe: '#7a6ad8', outline: '#122a2a', eye: '#0e1a2a', cheek: '#f0a0d0' }), aurora: true },
    // 네온: 까만 털에 외곽선과 줄무늬가 네온사인처럼 색을 바꾸며 빛난다
    neon: { pal: furPal({ body: '#1d1a2a', shade: '#15121f', light: '#2c2840', belly: '#26223a', stripe: '#ff3fd0', outline: '#38f0ff', eye: '#38f0ff', lash: '#1d1a2a', nose: '#ff3fd0', cheek: '#ff3fd0' }), neon: true },
    // 홀로그램 (투영 홀로그램): 은빛 털에 굵은 무지개 결이 비스듬히 흐르고, 한 줄 건너 주사선 · 내려가는 밝은 주사 띠가 깔린다.
    // 몸 양옆엔 자홍 · 청록 잔상이 어긋나 비치고(색 번짐) 가끔 지직 흔들린다. 색은 holoColor, 잔상은 drawMap
    holo: { pal: furPal({ body: '#d6dbe7', shade: '#b6bdce', light: '#f0f3f9', belly: '#eaeef6', stripe: '#a6b0c6', outline: '#1d2a50', eye: '#1a2448', cheek: '#ff9ad8' }), holo: true },
    // 흰 양말: 치즈 고양이에 네 발만 하얗게
    socks: { pal: CAT, mask: (i, j) => (j === 11 ? 'W' : null) },
    // 삼색: 흰 바탕에 주황·검정 얼룩
    calico: {
      pal: furPal({ body: '#f7f3ea', shade: '#e2dccf', light: '#ffffff', belly: '#ffffff', stripe: '#e6dfd1', outline: '#4a3f36', nose: '#e8878a', cheek: '#f6b3b0' }),
      mask: (i, j) => {
        if ((j <= 2 && i <= 5) || (inR(j, 3, 5) && inR(i, 2, 5)) || (inR(j, 8, 10) && i >= 10)) return 'A';
        if ((j <= 2 && i >= 9) || (inR(j, 3, 4) && inR(i, 9, 12)) || (inR(j, 8, 10) && i <= 3)) return 'K';
        return 'B';
      },
      tail: (j) => (j < 2 ? 'K' : j < 4 ? 'A' : 'B'),
    },
  };
  const RAINBOW = ['#ff6b6b', '#ff6b6b', '#ff6b6b', '#ffa94d', '#ffd43b', '#ffd43b', '#8ce99a', '#8ce99a', '#74c0fc', '#74c0fc', '#b197fc', '#b197fc', '#e599f7'];
  // 홀로그램 털 색: 은빛 4칸 + 무지개 결 5칸이 비스듬히 번갈아 흐르고, 한 줄 건너 주사선이 깔리며 밝은 주사 띠가 위에서 아래로 훑는다.
  // 외곽선(O)은 남빛으로 은은히 색이 돈다. x · y 는 캔버스 칸, sec 는 초. 눈 · 볼(E · C)처럼 표에 없는 글자는 null (원래 색)
  const HOLO_L = { B: 74, P: 74, S: 62, L: 86, M: 84 };
  function holoColor(ch, x, y, sec) {
    const hsl = (h, sat, l) => `hsl(${Math.round(((h % 360) + 360) % 360)},${sat}%,${Math.round(l)}%)`;
    if (ch === 'O') return hsl(215 + 40 * Math.sin(sec * 2 + y * 0.6), 60, 22);
    if (HOLO_L[ch] == null) return null;
    let l = HOLO_L[ch];
    if ((y + Math.floor(sec * 3)) % 2) l -= 5; // 주사선
    const scan = ((sec * 7) % 26) - 4;
    if (Math.abs(y - (32 + scan)) < 0.6 || Math.abs(y - (6 + scan)) < 0.6) return hsl(185, 100, 90); // 주사 띠
    const d = (((x - y * 0.7 + sec * 4) % 9) + 9) % 9;
    if (d >= 5) return hsl(220, 22, l + 4);
    return hsl((d / 5) * 300 - 10, 88, l);
  }

  // 털색과 상관없는 색 (소품·입자)
  const P = {
    white: '#ffffff', shadow: 'rgba(30,15,8,0.22)',
    laptop: '#8a93a3', laptopDark: '#4d5563', laptopOutline: '#2c313a',
    heart: '#ff6f91', spark: '#ffd35c', z: '#7d8bff',
    bowl: '#f4f1ea', bowlShade: '#c9c1b3', bowlBand: '#d97757', rice: '#ffffff',
    tongue: '#f07a7a',
    bang: '#ffcf3a', thought: '#ffffff',
  };

  // 악세사리·모션 소품이 같이 쓰는 색. 글자 하나 = 색 하나 (K 는 고양이 외곽선을 따른다)
  const PAL = {
    W: '#fffaf3', w: '#efe4d0', G: '#cfc8bd', g: '#8f95a0', D: '#454b57', k: '#1f1c1b',
    R: '#e8534a', r: '#a8322c', P: '#ff9bb8', p: '#d9668b', Q: '#ffd3df',
    O: '#f59a3c', o: '#c56d1e', M: '#ff8c1a', m: '#d96608',
    Y: '#ffd65a', y: '#d9a21f', N: '#78c46a', n: '#4b8f43',
    B: '#6fb0ea', b: '#3d6fb0', U: '#c6e4f7', u: '#8fc2e3',
    V: '#b784f5', v: '#8456c6', T: '#c48b56', t: '#8a5a32', S: '#f3d9b1', s: '#d9b27a',
    E: '#7d8bff', e: '#5160c9', H: '#ffffff', C: '#d97757', c: '#a34f34',
    L: 'rgba(195,232,255,0.5)', X: '#2f3a33', Z: '#9fe3c8',
  };
  const TEAR = '#7cc4f2';
  const TONGUE = '#f07a8a';
  const BLUSH = '#ff8fa3';

  // ---------- 고양이 도트 ----------
  // 글자: O 외곽선 / B 털 / S 진한 줄무늬 / L 밝은 털뭉치 / C 볼터치
  // ax  = 화면 가운데에 올 열,  cy/rx/ry = 소품·입자가 쓰는 몸 기준,
  // hx/hy = 얼굴 중심,  hr = 머리 반지름(꾸미기용),  br = 숨 쉴 때 늘었다 줄었다 하는 행
  // tail = 몸 뒤에 먼저 찍는 꼬리 조각
  const STAGE = {
    // 하나뿐인 고양이. 이마 줄무늬 셋에 옆구리 무늬, 가늘고 곧은 꼬리
    cat: {
      eye: { w: 2, h: 2, spread: 2, dy: 0 },
      nose: { w: 3, h: 3 },
      paw: 2,
      map: {
        ax: 8, cy: 7, rx: 7, ry: 6.5, hx: 7, hy: 5, hr: 6, br: 8, earRows: 2,
        acc: { top: 2, ears: [3.5, 10.5], hw: 6, neck: 9 },
        rows: [
          "..OBBO...OBBO..",
          "..OBBO...OBBO..",
          "..OBBOOOOOBBO..",
          ".OBBBSBSBSBBBO.",
          ".OBBBBBSBBBBBO.",
          ".OBBBBBBBBBBBO.",
          ".OBBBBBBBBBBBO.",
          ".OBBBBBBBBBBBO.",
          ".OSBBBBBBBBBSO.",
          ".OBBBBBBBBBBBO.",
          ".OBBBBBBBBBBBO.",
          ".OBBOOBBOOBBOO.",
          "..OO..OO..OO...",
        ],
        // 가늘고 곧은 꼬리. 굵은 꼬리를 접고 이걸로 확정했다 (2026-09-21).
        // 왼쪽 줄이 몸통 외곽선 자리(13열)에 겹쳐서 몸에 붙은 것처럼 보인다
        tail: {
          x: 13, y: 4,
          rows: [
            ".OO.",
            "OBBO",
            "OBBO",
            "OBBO",
            "OBBO",
            ".OO.",
          ],
        },
      },
      curl: {
        // br: 숨 쉬는 줄. 잘 때 이 줄이 한 줄 늘었다 줄었다 해서 등이 부풀었다 가라앉는다 (바닥은 그대로)
        ax: 7.5, cy: 4, rx: 8, ry: 4.5, hx: 6.5, hy: 3, hr: 5, earRows: 1, br: 4,
        acc: { top: 1, ears: [3.5, 10.5], hw: 6, neck: 6 },
        rows: [
          "..OBBO...OBBO..",
          "..OBBOOOOOBBO..",
          ".OBBBBBBBBBBBO.",
          "OBBBBBBBBBBBBBO",
          "OBBBBBBBBBBBBBO",
          "OBBBBBBBBBBBBBO",
          ".OBBBBBBBBBBBO.",
          "..OOOOOOOOOOO..",
        ],
      },
    },
  };

  // ---------- 귀 모양 (2026-10-10) ----------
  // 처음 시작할 때(그리고 옷장에서) 고르는 귀 13가지. 몸 테두리와 코스튬 기준점은 그대로 두고 맨 위 세 줄(귀 칸)만 바꾼다.
  // 머리를 감싸는 코스튬(hood)은 도트 지도를 따라 칠해서 귀 모양을 저절로 따라간다.
  //  rows  = 맨 위 세 줄 (15칸). sym() 은 왼쪽 8칸만 적으면 오른쪽을 거울로 채운다
  //  above = 테두리 위로 더 올라가는 줄 (위에서부터, 왼쪽 8칸). 이 귀는 작은 모자 밖으로 조금 삐진다
  //  paint = [열, 줄, 색] 덧칠 (W 흰 털)
  // 이름은 i18n 'ear.<key>'. 고른 값은 settings.ears (main/growth.js 의 EAR_SHAPES 와 키가 같아야 한다)
  const sym = (l) => l + l.slice(0, 7).split('').reverse().join('');
  const syms = (a) => a.map(sym);
  const EARS = {
    perk: {},
    round: { rows: syms(['........', '...OO...', '..OBBOOO']) },
    pointy: { rows: syms(['...O....', '..OBO...', '..OBBOOO']) },
    small: { rows: syms(['........', '...O....', '..OBOOOO']) },
    fold: { rows: syms(['........', '..OOO...', '..OBBOOO']) },
    outtilt: { rows: syms(['..O.....', '..OBO...', '..OBBOOO']) },
    intilt: { rows: syms(['....O...', '...OBO..', '..OBBOOO']) },
    darktip: { rows: syms(['..OSSO..', '..OBBO..', '..OBBOOO']) },
    whitetip: { paint: [[3, 0, 'W'], [4, 0, 'W'], [10, 0, 'W'], [11, 0, 'W']] },
    // 길고양이 중성화 표시처럼 오른쪽 귀 끝이 비스듬히 잘렸다
    tnr: { rows: ['..OBBO...OO....', '..OBBO...OBO...', '..OBBOOOOOBBO..'] },
    // 오른쪽 귀만 접혔다
    mismatch: { rows: ['..OBBO.........', '..OBBO....OOO..', '..OBBOOOOOBBO..'] },
    lynx: { above: ['..O.....', '...O....'] },
    fox: { rows: syms(['..OBBO..', '..OCBO..', '..OCBOOO']), above: ['....O...', '...OBO..'] },
  };
  // 단계 + 귀를 합친 정의. 단계 · 귀마다 한 번만 만든다 (기본 귀는 단계 그대로)
  const earStages = {};
  function earStage(stage, ear) {
    const s = STAGE[stage];
    const E = EARS[ear];
    if (!s || !E || (!E.rows && !E.above && !E.paint)) return s;
    const key = stage + '|' + ear;
    if (!earStages[key]) {
      const R = E.rows;
      earStages[key] = {
        ...s,
        ear: E,
        map: { ...s.map, rows: R ? s.map.rows.map((r, j) => (j < 3 ? R[j] : r)) : s.map.rows, _meta: undefined },
        // 잘 때는 귀가 한 줄 낮다 (맨 윗줄 = 귀 둘째 줄)
        curl: { ...s.curl, rows: R ? s.curl.rows.map((r, j) => (j === 0 ? R[1] : j === 1 ? R[2] : r)) : s.curl.rows, _meta: undefined },
      };
    }
    return earStages[key];
  }

  // 코드로 짠 기본 동작의 길이(초). 모션(motions.js)은 각자 len 을 갖는다
  const ACTION_LEN = { happy: 0.9, levelup: 2.2, evolve: 1.5, wave: 1.8, eat: 7, stretch: 4, yawn: 2.5, achieve: 2.4, groom: 4.5, pounce: 0.8, perk: 1.1, nibble: 1.3, bored: 3.6 };

  const PATTERNS = {
    heart: ['.X.X.', 'XXXXX', '.XXX.', '..X..'],
    sparkle: ['.X.', 'XWX', '.X.'],
    z: ['XXXX', '..X.', '.X..', 'XXXX'],
    zs: ['XXX', '.X.', 'XXX'],
    note: ['.XX', '.X.', 'XX.'],
  };

  // 한 줄에서 '.' 이 아닌 칸이 이어지는 구간들. 맨 윗줄이면 귀 둘, 맨 아랫줄이면 발 여럿이다
  function runsOf(row) {
    const runs = [];
    let i = 0;
    while (i < row.length) {
      if (row[i] === '.') { i++; continue; }
      let j = i;
      while (j < row.length && row[j] !== '.') j++;
      runs.push([i, j - 1]);
      i = j;
    }
    return runs;
  }

  // 지도마다 한 번만 재고 결과를 붙여 둔다.
  // 귀 폭은 귀의 '맨 아랫줄'(가장 넓은 줄)에서 잰다 — 뾰족한 귀는 맨 윗줄이 한 칸뿐이라
  // 거기서 재면 귀가 한 칸으로 잘려 버린다
  function metaOf(m) {
    if (!m._meta) {
      const er = Math.max(1, m.earRows || 1);
      m._meta = { ears: runsOf(m.rows[er - 1]), legs: runsOf(m.rows[m.rows.length - 1]) };
    }
    return m._meta;
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const seg = (k, a, b) => clamp((k - a) / (b - a), 0, 1); // a~b 구간에서 0→1
  const bump = (k, a, b) => Math.sin(Math.PI * seg(k, a, b)); // a~b 구간에서 0→1→0
  const ease = (x) => x * x * (3 - 2 * x);

  // 모션·악세사리 모음. motions.js / accessories.js 가 나중에 채운다
  const motions = () => (global.PetSprite && global.PetSprite.MOTIONS) || {};
  const accessories = () => (global.PetSprite && global.PetSprite.ACCESSORIES) || {};
  // 장난감 놀이 전용 자세(toys.js). 모션과 같은 모양이지만 상점·설정에는 안 나온다
  const toyPoses = () => (global.PetSprite && global.PetSprite.TOY_POSES) || {};
  const carries = () => (global.PetSprite && global.PetSprite.CARRY) || {};
  const anim = (key) => motions()[key] || toyPoses()[key];

  // 모션·악세사리가 쓰는 기준점 (머리 한가운데 열, 정수리 줄, 눈, 코, 목…)
  function anchorsOf(g) {
    const acc = g.m.acc;
    const col = (i) => Math.round(g.x0 + i);
    const row = (j) => Math.round(g.y0 + j + g.lift(j));
    const E = g.s.eye;
    const fx = Math.round(g.hx + g.p.lookX);
    const ey = Math.round(g.hy + E.dy);
    const sp = Math.round(E.spread);
    const hx = col(g.m.hx);
    return {
      hx, fx, ey, sp,
      eyeL: fx - sp - E.w + 1, eyeR: fx + sp, ew: E.w, eh: E.h,
      my: ey + E.h,
      top: row(acc.top), earTop: row(0),
      hw: Math.round(acc.hw), left: hx - Math.round(acc.hw), right: hx + Math.round(acc.hw),
      neck: Math.min(GROUND - 1, row(acc.neck)),
      cx: Math.round(g.cx), cy: Math.round(g.cy), ground: GROUND,
      curled: g.m === g.s.curl, t: g.t,
    };
  }

  // ---------- 효과(fx) ----------
  // 합성이 끝난 진짜 캔버스에 찍는다. 몸이 돌거나 뒤집혀도 글자·눈물은 똑바로 나온다.

  // 3×5 미니 글꼴 (효과 글자용)
  const FONT = {
    A: ['.X.', 'X.X', 'XXX', 'X.X', 'X.X'], B: ['XX.', 'X.X', 'XX.', 'X.X', 'XX.'], C: ['.XX', 'X..', 'X..', 'X..', '.XX'],
    D: ['XX.', 'X.X', 'X.X', 'X.X', 'XX.'], E: ['XXX', 'X..', 'XX.', 'X..', 'XXX'], F: ['XXX', 'X..', 'XX.', 'X..', 'X..'],
    G: ['.XX', 'X..', 'X.X', 'X.X', '.XX'], H: ['X.X', 'X.X', 'XXX', 'X.X', 'X.X'], I: ['XXX', '.X.', '.X.', '.X.', 'XXX'],
    J: ['..X', '..X', '..X', 'X.X', '.X.'], K: ['X.X', 'X.X', 'XX.', 'X.X', 'X.X'], L: ['X..', 'X..', 'X..', 'X..', 'XXX'],
    M: ['X.X', 'XXX', 'X.X', 'X.X', 'X.X'], N: ['XX.', 'X.X', 'X.X', 'X.X', 'X.X'], O: ['.X.', 'X.X', 'X.X', 'X.X', '.X.'],
    P: ['XX.', 'X.X', 'XX.', 'X..', 'X..'], Q: ['.X.', 'X.X', 'X.X', 'XXX', '.XX'], R: ['XX.', 'X.X', 'XX.', 'X.X', 'X.X'],
    S: ['.XX', 'X..', '.X.', '..X', 'XX.'], T: ['XXX', '.X.', '.X.', '.X.', '.X.'], U: ['X.X', 'X.X', 'X.X', 'X.X', 'XXX'],
    V: ['X.X', 'X.X', 'X.X', 'X.X', '.X.'], W: ['X.X', 'X.X', 'X.X', 'XXX', 'X.X'], X: ['X.X', 'X.X', '.X.', 'X.X', 'X.X'],
    Y: ['X.X', 'X.X', '.X.', '.X.', '.X.'], Z: ['XXX', '..X', '.X.', 'X..', 'XXX'],
    0: ['XXX', 'X.X', 'X.X', 'X.X', 'XXX'], 1: ['.X.', 'XX.', '.X.', '.X.', 'XXX'], 2: ['XX.', '..X', '.X.', 'X..', 'XXX'],
    3: ['XX.', '..X', '.X.', '..X', 'XX.'], 4: ['X.X', 'X.X', 'XXX', '..X', '..X'], 5: ['XXX', 'X..', 'XX.', '..X', 'XX.'],
    6: ['.XX', 'X..', 'XXX', 'X.X', 'XXX'], 7: ['XXX', '..X', '.X.', '.X.', '.X.'], 8: ['XXX', 'X.X', 'XXX', 'X.X', 'XXX'],
    9: ['XXX', 'X.X', 'XXX', '..X', 'XX.'],
    '!': ['X', 'X', 'X', '.', 'X'], '?': ['XX.', '..X', '.X.', '...', '.X.'], '.': ['.', '.', '.', '.', 'X'],
    ';': ['.', 'X', '.', 'X', 'X'], ':': ['.', 'X', '.', 'X', '.'], '@': ['.XX.', 'X.XX', 'X.XX', 'X...', '.XX.'],
    '#': ['.X.X', 'XXXX', '.X.X', 'XXXX', '.X.X'], '&': ['.X..', 'X.X.', '.X..', 'X.XX', '.XX.'], '♥': ['...', 'X.X', 'XXX', '.X.', '...'],
    '+': ['...', '.X.', 'XXX', '.X.', '...'], '-': ['...', '...', 'XXX', '...', '...'], '%': ['X.X', '..X', '.X.', 'X..', 'X.X'],
    '$': ['.X.', 'XXX', 'XX.', '.XX', 'XXX'], '~': ['....', '.X.X', 'X.X.', '....', '....'],
    ' ': ['..', '..', '..', '..', '..'],
  };

  function textWidth(s) {
    let w = 0;
    for (const ch of s) w += (FONT[ch] || FONT[' '])[0].length + 1;
    return w - 1;
  }

  const dot = (ctx, x, y, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  };
  const stamp = (ctx, rows, x, y, map) => {
    rows.forEach((r, j) => {
      for (let i = 0; i < r.length; i++) {
        const c = map[r[i]];
        if (c) dot(ctx, x + i, y + j, c);
      }
    });
  };
  function drawText(ctx, s, x, y, fill, outline = '#2b1a10') {
    const glyphs = [];
    let cx = Math.round(x);
    for (const ch of s) {
      const gl = FONT[ch] || FONT[' '];
      glyphs.push([gl, cx]);
      cx += gl[0].length + 1;
    }
    for (const [gl, gx] of glyphs)
      gl.forEach((r, j) => {
        for (let i = 0; i < r.length; i++)
          if (r[i] === 'X') for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) dot(ctx, gx + i + dx, y + j + dy, outline);
      });
    for (const [gl, gx] of glyphs)
      gl.forEach((r, j) => {
        for (let i = 0; i < r.length; i++) if (r[i] === 'X') dot(ctx, gx + i, y + j, fill);
      });
  }

  const FX = {
    text(r, ctx, f) { drawText(ctx, f.s, f.x, f.y, f.c || '#fff'); },
    drop(r, ctx, f) { dot(ctx, f.x, f.y, f.c || TEAR); dot(ctx, f.x, f.y + 1, f.c || TEAR); },
    spray(r, ctx, f) { dot(ctx, f.x, f.y, f.c || '#bfe6ff'); },
    confetti(r, ctx, f) {
      const flip = Math.floor(f.life * 12) % 2;
      dot(ctx, f.x, f.y, f.c);
      dot(ctx, f.x + (flip ? 1 : 0), f.y + (flip ? 0 : 1), f.c);
    },
    dust(r, ctx, f) {
      const k = 1 - f.life / f.max;
      const rows = k < 0.4 ? ['.g.', 'ggg', '.g.'] : ['.g.g.', 'g...g', '.g.g.'];
      stamp(ctx, rows, f.x - (rows[0].length >> 1), f.y - 1, { g: f.c || '#d6cfc4' });
    },
    note(r, ctx, f) { stamp(ctx, ['.XX', '.X.', 'XX.'], f.x, f.y, { X: f.c || '#2b1a10' }); },
    heart(r, ctx, f) {
      const big = f.big && f.life / f.max > 0.3;
      stamp(ctx, big ? ['.X.X.', 'XXXXX', 'XXXXX', '.XXX.', '..X..'] : ['X.X', 'XXX', '.X.'], f.x, f.y, { X: f.c || '#ff6f91' });
    },
    spark(r, ctx, f) { stamp(ctx, ['.Y.', 'YWY', '.Y.'], f.x - 1, f.y - 1, { Y: f.c || '#ffd35c', W: '#fff' }); },
    star(r, ctx, f) { stamp(ctx, ['.Y.', 'YYY', '.Y.'], f.x - 1, f.y - 1, { Y: f.c || '#ffd35c' }); },
    puff(r, ctx, f) {
      const k = 1 - f.life / f.max;
      const rows = k < 0.5 ? ['.XX.', 'XXXX', '.XX.'] : ['.XXX.', 'XXXXX', 'XXXXX', '.XXX.'];
      stamp(ctx, rows, f.x - (rows[0].length >> 1), f.y - (rows.length >> 1), { X: f.c || '#e9e4dc' });
    },
    soul(r, ctx, f) {
      const wig = Math.floor(f.life * 6) % 2;
      stamp(ctx, ['.KKK.', 'KWWWK', 'KkWkK', 'KWWWK', wig ? 'KW.WK' : 'K.W.K'], f.x - 2, f.y - 2, {
        K: '#9ab7cf', W: 'rgba(245,250,255,0.95)', k: '#2b1a10',
      });
    },
    fly(r, ctx, f) {
      dot(ctx, f.x, f.y, '#2b1a10');
      if (Math.floor(f.life * 30) % 2) { dot(ctx, f.x - 1, f.y - 1, '#c9d6e3'); dot(ctx, f.x + 1, f.y - 1, '#c9d6e3'); }
    },
    bird(r, ctx, f) {
      const up = Math.floor(f.life * 8) % 2;
      stamp(ctx, up ? ['K...K', '.KBK.', '..K..'] : ['.....', 'KKBKK', '..K..'], f.x - 2, f.y - 1, { K: '#3a2a20', B: '#6fb0ea' });
    },
    line(r, ctx, f) { for (let i = 0; i < (f.len || 4); i++) dot(ctx, f.x + i, f.y, f.c || 'rgba(120,110,100,0.7)'); },
    vline(r, ctx, f) { for (let i = 0; i < (f.len || 4); i++) dot(ctx, f.x, f.y + i, f.c || 'rgba(120,100,200,0.6)'); },
    ember(r, ctx, f) { dot(ctx, f.x, f.y, Math.floor(f.life * 10) % 2 ? '#ffd35c' : '#ff8a3c'); },
    bubble(r, ctx, f) {
      const rr = f.r || 1.5;
      for (let a = 0; a < 12; a++) dot(ctx, f.x + Math.cos((a / 12) * Math.PI * 2) * rr, f.y + Math.sin((a / 12) * Math.PI * 2) * rr, 'rgba(150,205,240,0.9)');
      dot(ctx, f.x - rr * 0.4, f.y - rr * 0.4, '#fff');
    },
    char(r, ctx, f) { drawText(ctx, f.s, f.x, f.y, f.c || '#9fe3c8', '#1f2a24'); },
    flash(r, ctx, f) { ctx.fillStyle = `rgba(255,255,255,${(f.life / f.max) * 0.85})`; ctx.fillRect(0, 0, G, G); },
    stink(r, ctx, f) {
      const k = 1 - f.life / f.max;
      const rows = k < 0.4 ? ['.XX.', 'XXXX', '.XX.'] : ['..XX..', '.XXXX.', 'XXXXXX', '.XXXX.'];
      stamp(ctx, rows, f.x - (rows[0].length >> 1), f.y - (rows.length >> 1), { X: 'rgba(170,190,120,0.85)' });
    },
    shock(r, ctx, f) {
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (let i = 1; i <= 2; i++) dot(ctx, f.x + dx * (f.r + i), f.y + dy * (f.r + i), '#2b1a10');
    },
    // 고양이(와 이미 찍힌 것)에만 색을 덧칠한다. mode 를 destination-out 으로 주면 반투명하게 지운다
    tint(r, ctx, f) {
      ctx.save();
      ctx.globalCompositeOperation = f.mode || 'source-atop';
      ctx.globalAlpha = f.a;
      ctx.fillStyle = f.c;
      ctx.fillRect(0, 0, G, G);
      ctx.restore();
    },
    // 분신: 방금 그린 고양이를 옆에 반투명하게 한 번 더
    clone(r, ctx, f) {
      ctx.save();
      ctx.globalAlpha = f.a;
      ctx.drawImage(r.off, Math.round(f.dx), Math.round(f.dy || 0));
      ctx.restore();
    },
    bill(r, ctx, f) {
      const flip = Math.floor(f.life * 8) % 2;
      stamp(ctx, flip ? ['GGGG', 'GgGG', 'GGGG'] : ['GG', 'Gg', 'GG', 'GG'], f.x, f.y, { G: '#78c46a', g: '#2f6b2a' });
    },
    coin(r, ctx, f) {
      const flip = Math.floor(f.life * 10) % 3;
      stamp(ctx, flip === 1 ? ['Y', 'y', 'Y'] : ['.Y.', 'YyY', '.Y.'], f.x - 1, f.y - 1, { Y: '#ffd65a', y: '#d9a21f' });
    },
    shuriken(r, ctx, f) {
      const a = Math.floor(f.life * 20) % 2;
      stamp(ctx, a ? ['.K.', 'KgK', '.K.'] : ['K.K', '.g.', 'K.K'], f.x - 1, f.y - 1, { K: '#454b57', g: '#cfc8bd' });
    },
    // 연기 고리. 날아가면서 점점 커진다
    ring(r, ctx, f) {
      const rr = f.r + (1 - f.life / f.max) * (f.grow || 3);
      for (let i = 0; i < 16; i++) dot(ctx, f.x + Math.cos((i / 16) * Math.PI * 2) * rr, f.y + Math.sin((i / 16) * Math.PI * 2) * rr * 0.6, f.c || 'rgba(225,225,225,0.9)');
    },
    light(r, ctx, f) {
      ctx.fillStyle = f.c;
      ctx.fillRect(Math.round(f.x) - 1, Math.round(f.y) - 1, 3, 3);
    },
    rain(r, ctx, f) { dot(ctx, f.x, f.y, '#7cc4f2'); dot(ctx, f.x, f.y + 1, '#7cc4f2'); },
    // 두 점을 잇는 선 (거미줄)
    seg(r, ctx, f) {
      const n = Math.max(1, Math.abs(f.x2 - f.x), Math.abs(f.y2 - f.y));
      for (let i = 0; i <= n; i++) dot(ctx, f.x + ((f.x2 - f.x) * i) / n, f.y + ((f.y2 - f.y) * i) / n, f.c || '#f4f4f4');
    },
    // 연기로 만든 해골
    skull(r, ctx, f) {
      stamp(ctx, ['.XXXXX.', 'XXXXXXX', 'X..X..X', 'XXXXXXX', '.XX.XX.', '.XXXXX.', '.X.X.X.'], f.x - 3, f.y - 3, { X: f.c || 'rgba(232,232,232,0.92)' });
    },
    // 아무 도트나 날린다 (던진 게임패드·튀어나온 생선…)
    sprite(r, ctx, f) { stamp(ctx, f.rows, f.x, f.y, f.map); },
    bolt(r, ctx, f) {
      let x = f.x;
      for (let y = 0; y < f.y; y++) {
        if (y % 4 === 0) x += y % 8 === 0 ? 2 : -2;
        dot(ctx, x, y, '#fff6a0');
        dot(ctx, x + 1, y, '#ffd35c');
      }
    },
    // 번개 맞았을 때 보이는 뼈
    skel(r, ctx, f) {
      stamp(ctx, ['.WWWWW.', 'W.W.W.W', 'WWWWWWW', '.W.W.W.', '...W...', 'WWWWWWW', '...W...', 'WWWWWWW', '...W...', 'WW.W.WW'], f.x - 3, f.y, { W: '#ffffff' });
    },
    ufo(r, ctx, f) {
      stamp(ctx, ['....KKK....', '...KUUUK...', '..KUUUUUK..', 'KKKKKKKKKKK', 'KgYgYgYgYgK', '.KKKKKKKKK.'], f.x - 5, f.y, { K: '#2b1a10', U: '#bfe6ff', g: '#8f95a0', Y: Math.floor(f.life * 8) % 2 ? '#ffd35c' : '#ff9bb8' });
    },
    beam(r, ctx, f) {
      for (let y = f.y; y < GROUND + 1; y++) {
        const w = Math.round(2 + (y - f.y) * 0.3);
        for (let x = f.x - w; x <= f.x + w; x++) dot(ctx, x, y, 'rgba(190,255,190,0.35)');
      }
    },
  };

  class PetRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      canvas.width = G;
      canvas.height = G;
      this.realCtx = canvas.getContext('2d', { willReadFrequently: true });
      this.ctx = this.realCtx;
      // 고양이는 여기에 먼저 그리고, 몸 변형을 걸어 진짜 캔버스에 옮긴다
      const off = document.createElement('canvas');
      off.width = off.height = G;
      this.off = off;
      this.offCtx = off.getContext('2d');
      this.stage = 'cat';
      this.ears = 'perk'; // 귀 모양 (setEars)
      this.mood = 'idle';
      this.accessory = 'none';
      this.look = 0;
      this.action = null; // 지금 하는 한 번짜리 동작 (기본 동작이든 모션이든)
      this.actionAt = 0;
      this.actionLen = 0;
      this.pendingWear = null; // 모션 도중에 갈아입을 코스튬 { acc, at, action } — wearDuring 참고
      this.particles = [];
      this.fx = [];
      this.ms = {}; // 지금 모션이 쓰는 메모장 (한 바퀴 돌 때마다 비운다)
      this.moodMotions = {}; // 기분 → 그 기분 동안 차례로 돌릴 모션 목록 (설정에서 고른 것)
      this.moodTurn = {}; // 기분마다 지금 몇 번째 모션인지 { i, at }
      this.toyPose = null; // 장난감 놀이 중 반복하는 자세 (기분 모션보다 먼저)
      this.toyOff = 0; // 상자·봉투처럼 고양이가 직접 그리는 장난감이 고양이한테서 떨어진 거리(도트, 화면 기준)
      this.carry = null; // 입에 물고 다니는 것 (쥐돌이 · 'treasure' 면 carryKey 의 보물)
      this.carryKey = null;
      this.held = null; // 사람 손에 들려 있나 (setHeld)
      this.heldAt = 0;
      this.loopKey = null;
      this.loopAt = 0;
      this.cycle = 0;
      this.savedFacing = 1;
      this.last = performance.now() / 1000;
      this.spawnClock = 0;
      this.top = GROUND - 20;
      this.facing = 1; // 1 = 오른쪽, -1 = 왼쪽. 걸어가는 쪽을 본다
      this.move = 0; // 지금 걷는 속도(px/s). 0 이면 서 있다
      this.walkPhase = 0; // 걸음 박자 0~1
      // 심심할 때 알아서 하는 잔동작 (두리번, 귀 씰룩, 꼬리 탁)
      this.idle = { next: 2, look: null, ear: null, flick: 0 };
      this._p = null;
      this._an = null;
      this._mo = null;
      this._shadow = null;
      this._dt = 0.05;
    }

    setStage(s) { if (STAGE[s]) this.stage = s; }
    // 귀 모양 (EARS 의 키). 없는 키면 기본 귀
    setEars(k) { this.ears = EARS[k] ? k : 'perk'; }
    // 지금 단계에 귀 모양까지 입힌 정의
    stageDef() { return earStage(this.stage, this.ears); }
    setMood(m) { this.mood = m; }
    // 입힐 코스튬. 'a,b,c' 처럼 쉼표로 여러 벌, 또는 배열. 앞에 있는 것부터(뒤쪽부터) 그린다
    setAccessory(a) {
      const list = (Array.isArray(a) ? a : String(a || 'none').split(',')).map((x) => x.trim()).filter((x) => x && x !== 'none');
      this.accessories = list;
      this.accessory = list[0] || 'none';
    }
    // 코스튬을 지금 말고 모션 도중에 갈아입는다. 연기 펑·커튼처럼 고양이를 가렸다 '짠' 하고 보여 주는
    // 모션은 motions.js 에 reveal(0~1, 모션 길이 중 가려진 순간)이 적혀 있다. 그런 모션이 아니면 바로 갈아입는다
    wearDuring(action, acc) {
      const M = anim(action);
      const at = M && M.reveal ? M.reveal * M.len : 0;
      if (!at) return this.setAccessory(acc);
      this.pendingWear = { acc, at, action };
    }

    // 입은 코스튬 그림들 (그리는 순서)
    accList() {
      const all = accessories();
      return (this.accessories || []).map((k) => all[k]).filter(Boolean);
    }
    // { thinking: 'codefrenzy', sleeping: 'snot', … } 기분마다 반복할 모션. 없는 기분은 기본 자세
    setMoodMotions(map) { this.moodMotions = map || {}; }
    // 지금 기분의 모션. 여러 개면 한 모션을 5분 분량(한 바퀴 단위로 딱 떨어지게) 반복하고 다음 것으로 넘어간다.
    // 한 바퀴마다 바꾸면 눈이 어지러워서 최소 5분은 같은 걸 계속 돌린다
    moodPick(t) {
      const mm = this.moodMotions[this.mood];
      if (!Array.isArray(mm)) return mm || null;
      if (!mm.length) return null;
      const st = this.moodTurn[this.mood] || (this.moodTurn[this.mood] = { i: 0, at: t });
      let k = mm[st.i % mm.length];
      const dur = anim(k) ? anim(k).len : 8;
      // 5분을 채우는 데 필요한 바퀴 수만큼 (중간에 끊기지 않게 바퀴 단위로 올림)
      const hold = Math.ceil(MOOD_HOLD / dur) * dur;
      if (mm.length > 1 && t - st.at > hold) { st.i++; st.at = t; k = mm[st.i % mm.length]; }
      return anim(k) ? k : null;
    }
    // -1(왼쪽) ~ 1(오른쪽). 장난감을 눈으로 따라갈 때 쓴다
    setLook(x) { this.look = Math.max(-1, Math.min(1, x || 0)); }
    // 몸이 향하는 쪽. 왼쪽이면 그림을 통째로 뒤집는다
    setFacing(dir) { this.facing = dir < 0 ? -1 : 1; }
    // 걷는 속도(px/s, 부호 = 방향). 0 이 아니면 걸음 애니메이션이 돈다
    setMove(v) {
      this.move = v || 0;
      if (v) this.setFacing(v);
    }

    // 털색 (FURS 의 키). 손님 고양이의 fur 가 있으면 그게 먼저다
    setFur(key) { this.furKey = FURS[key] && key !== 'cheese' ? key : null; }

    get colors() {
      // fur 가 있으면 그 털색 (깜짝 이벤트의 손님 고양이)
      if (this.fur) return this.fur;
      if (this.furKey) return FURS[this.furKey].pal;
      const s = this.stageDef();
      return (s && s.colors) || CAT;
    }

    static isMotion(key) {
      return !!anim(key);
    }

    // 지금 하는 게 모션이면 그 정의
    get motion() {
      return this.action ? anim(this.action) || null : null;
    }

    // 장난감 놀이 중에 계속 반복할 자세 (상자 속에 숨기, 봉투 속에서 부스럭…). null 이면 끈다
    setToyPose(key) {
      if (key === this.toyPose) return;
      this.toyPose = key || null;
      this.loopKey = null;
    }

    // 끌어서 들어 올렸을 때. { rot, legs, px, py } — rot 는 몸이 흔들리는 각도, legs 는 뒷발이 늦게 따라오는 만큼(칸)
    // px·py 는 잡은 자리(도트 좌표). 그 점을 중심으로 대롱대롱 흔들린다. null 이면 내려놓은 것
    setHeld(h) {
      if (h && !this.held) this.heldAt = performance.now() / 1000;
      this.held = h || null;
    }

    // 동작 하나를 튼다. 모션(motions.js)이면 times 바퀴 돈다
    play(action, opts = {}) {
      const M = anim(action);
      const len = M ? M.len * Math.max(1, opts.times || 1) : ACTION_LEN[action];
      if (!len) return;
      if (this.motion) this.facing = this.savedFacing;
      this.undoMotion();
      this.action = action;
      this.actionAt = performance.now() / 1000;
      this.actionLen = len;
      this.loopKey = null;
      if (M) {
        this.savedFacing = this.facing;
        this.ms = {};
        this.fx = [];
        this.cycle = 0;
        if (M.start) M.start(this);
        return;
      }
      const { cx, cy, rx, ry } = this.geom();
      if (action === 'happy') for (let i = 0; i < 3; i++) this.spawn('heart', cx + rand(-rx, rx), cy - ry, rand(-4, 4), rand(-14, -8), 1.2);
      if (action === 'levelup' || action === 'achieve') for (let i = 0; i < 10; i++) this.spawn('sparkle', cx + rand(-rx - 4, rx + 4), cy + rand(-ry, ry), rand(-8, 8), rand(-16, -4), 1.6);
    }

    // 모션이 잠깐 바꿔 둔 것(둔갑한 털색·꺼진 십자가 불…)을 되돌린다. 모션이 끝나거나 끊기거나 다른 동작으로 넘어갈 때.
    // 모션의 start(r) 가 r._undo 에 되돌리는 함수를 걸어 둔다
    undoMotion() {
      const u = this._undo;
      this._undo = null;
      if (u) u();
    }

    // 하던 동작을 그만둔다 (간식이 떨어지면 하던 모션을 멈추고 주우러 간다)
    cancel() {
      if (!this.action) return;
      if (this.motion) this.facing = this.savedFacing;
      this.undoMotion();
      this.action = null;
      this.fx = [];
      this.loopKey = null;
    }

    geom() {
      const m = this.stageDef().map;
      const x0 = Math.round(G / 2 - m.ax);
      const y0 = GROUND - (m.rows.length - 1);
      return { cx: x0 + m.ax, cy: y0 + m.cy, rx: m.rx, ry: m.ry };
    }

    spawn(type, x, y, vx, vy, life) {
      if (this.particles.length > 60) return;
      this.particles.push({ type, x, y, vx, vy, life, max: life });
    }

    // 모션이 효과를 뿌린다 (화면 좌표. 방향이 뒤집히면 scr 로 뒤집어서 넣는다)
    emit(o) {
      if (this.fx.length > 140) return;
      // perFrame 은 이번 프레임에만 한 번 찍히는 효과 (분신·색 입히기처럼 매 프레임 새로 뿌리는 것)
      const life = o.perFrame ? this._dt + 0.0005 : o.life || 1;
      this.fx.push(Object.assign({ vx: 0, vy: 0, ay: 0 }, o, { life, max: life }));
    }

    scr(x) {
      return this.facing < 0 ? G - 1 - x : x;
    }

    // 기본 깜빡임과 같은 박자
    blinkAt(t) {
      const bt = t % 4.3;
      return bt < 0.12 || (Math.floor(t / 4.3) % 3 === 1 && bt > 0.24 && bt < 0.36);
    }

    headTop() { return this.top; }

    hit(px, py) {
      const x = Math.floor(px), y = Math.floor(py);
      if (x < 0 || y < 0 || x >= G || y >= G) return false;
      return this.realCtx.getImageData(x, y, 1, 1).data[3] > 160;
    }

    // ---------- 자세 ----------

    pose(t) {
      const p = {
        dy: 0, sx: 1, sy: 1, shear: 0, eyes: 'open', mouth: 'smile', lookX: 0, lookY: 0,
        armL: 'rest', armR: 'rest', prop: null, overlay: null, flash: 0, curl: false,
        tail: 'idle', ear: 0, earDy: [0, 0], step: null,
        // 모션이 켜는 것들: 몸 변형, 볼터치, 식은땀, 눈썹, 그림자 끄기, 바닥 아래 가리기, 꼬리 숨기기
        xf: null, blush: false, sweat: false, brow: null, noShadow: false, clipGround: false, noTail: false,
        // 뒷발을 길게 늘어뜨린다(들렸을 때·발차기). 값은 발끝이 옆으로 밀린 칸 수. hide 는 몸을 안 그린다(봉투 속)
        dangle: null, hide: false, scruff: 0,
      };
      // 눈 깜빡임. 세 번에 한 번은 두 번 연달아 깜빡인다
      const bt = t % 4.3;
      const twice = Math.floor(t / 4.3) % 3 === 1;
      const blink = bt < 0.12 || (twice && bt > 0.24 && bt < 0.36) || (t + 1.7) % 11 < 0.1;
      const breathe = Math.sin(t * 2.2);

      switch (this.mood) {
        case 'thinking':
          p.dy = -3; // 노트북 뒤에 앉은 높이 (타자 박자는 어깨로 — pose 끝부분)
          p.armL = p.armR = 'type';
          p.prop = 'laptop';
          p.overlay = 'dots';
          p.mouth = 'flat';
          p.tail = 'flick';
          if (blink) p.eyes = 'blink';
          break;
        case 'waiting': {
          const ph = (t % 0.9) / 0.9;
          p.dy = -Math.sin(ph * Math.PI) * 4;
          if (ph < 0.12) { p.sy = 0.9; p.sx = 1.08; }
          p.overlay = 'bang';
          p.armR = 'wave';
          p.mouth = 'open';
          p.tail = 'up';
          p.ear = 1;
          break;
        }
        case 'hungry':
          // 빈 밥그릇 앞에 앉아 올려다본다. 꼬리는 축 늘어진다
          p.prop = 'emptyBowl';
          p.lookX = -1;
          p.tail = 'slow';
          p.ear = -1;
          p.mouth = Math.sin(t * 1.6) > 0.7 ? 'open' : 'smile';
          if (blink) p.eyes = 'blink';
          break;
        case 'sleepy': {
          p.eyes = 'half';
          p.mouth = 'flat';
          p.tail = 'slow';
          p.ear = -1;
          p.sy = 0.96;
          const yawn = t % 9 < 1.5;
          if (yawn) { p.mouth = 'o'; p.eyes = 'closed'; }
          break;
        }
        case 'sleeping':
          p.curl = true;
          // 숨 쉴 때 등만 부풀었다 가라앉는다 (바닥에서 뜨지 않는다 — 그림자와 늘 붙어 있게). 들숨이 조금 짧고 날숨이 길다
          p.sy = Math.sin(t * 1.2) > 0.35 ? 1.02 : 1;
          p.eyes = 'closed';
          p.mouth = 'flat';
          p.ear = -1;
          break;
        case 'active':
          // 구경하는 중: 통통 뛰지 않고 제자리에서 들썩(몸을 살짝 늘였다 줄였다)하며 꼬리를 흔든다
          p.sy = 1 + Math.abs(Math.sin(t * 2.5)) * 0.04 + breathe * 0.015;
          p.tail = 'wag';
          if (blink) p.eyes = 'blink';
          break;
        default: // idle
          p.sy = 1 + breathe * 0.03;
          if (blink) p.eyes = 'blink';
      }

      if (this.look) p.lookX += this.look;
      else if (this.gaze && !this.action && !this.motion && !this.move && !this.loopKey && (this.mood === 'idle' || this.mood === 'active')) {
        // 마우스 커서 쪽을 본다 (gaze 는 화면 기준이라 캔버스가 뒤집혀 있으면 가로를 뒤집는다)
        p.lookX = this.gaze.x * this.facing;
        p.lookY = this.gaze.y;
      } else if (this.idle.look) p.lookX += this.idle.look.x;
      if (p.tail === 'idle' && t < this.idle.flick) p.tail = 'flick';

      // 걷는 중 — 발을 번갈아 딛고 몸이 한 칸씩 오르내린다. 꼬리는 균형을 잡느라 올라간다
      if (this.move && !p.curl) {
        p.step = this.walkPhase;
        // 걸음마다 몸이 살짝 눌렸다 펴진다 (발은 바닥에서 안 뜬다)
        if (Math.sin(this.walkPhase * Math.PI * 4) > 0) p.sy *= 0.96;
        p.tail = 'wag';
        p.ear = 1;
        p.mouth = 'flat';
      }

      // 가려진 사이에 갈아입기 — 그 순간이 됐거나, 모션이 중간에 끊겼으면 바로 갈아입힌다
      if (this.pendingWear && (this.action !== this.pendingWear.action || t - this.actionAt >= this.pendingWear.at)) {
        const w = this.pendingWear;
        this.pendingWear = null;
        this.setAccessory(w.acc);
      }

      // 한 번짜리 동작이 끝났나
      if (this.action && t - this.actionAt > this.actionLen) {
        if (this.motion) this.facing = this.savedFacing;
        this.undoMotion();
        this.action = null;
        this.loopKey = null;
      }

      this._mo = null;
      const M = this.motion;
      if (this.held) {
        this.heldPose(p, t);
      } else if (M) {
        // 모션 — 여러 바퀴면 바퀴마다 메모장을 비우고 처음부터
        let at = t - this.actionAt;
        const c = Math.floor(at / M.len);
        if (c !== this.cycle) {
          this.cycle = c;
          this.ms = {};
          if (M.start) M.start(this);
        }
        at -= c * M.len;
        this.runMotion(M, p, at, t);
      } else if (this.action) {
        const at = t - this.actionAt;
        const k = at / this.actionLen;
        p.overlay = null;
        p.prop = null;
        p.curl = false;
        p.step = null;
        p.tail = 'wag';
        this.basicAction(p, k, at);
      } else {
        // 장난감 자세가 있으면 그걸, 아니면 기분마다 설정에서 고른 모션을 계속 돌린다 (걷거나 뭔가를 쳐다볼 때는 쉰다)
        const key = this.toyPose || (!this.move && !this.look ? this.moodPick(t) : null);
        const L = key ? anim(key) : null;
        if (L) {
          if (this.loopKey !== key || t - this.loopAt > L.len) {
            if (this.loopKey !== key) this.fx = [];
            this.loopKey = key;
            this.loopAt = t;
            this.ms = {};
            if (L.start) L.start(this);
          }
          this.runMotion(L, p, t - this.loopAt, t);
        } else this.loopKey = null;
      }

      // 귀 — 기분이 높이를 정하고, 가만히 있을 때는 가끔 한쪽만 씰룩인다
      p.earDy = p.ear > 0 ? [-1, -1] : p.ear < 0 ? [1, 1] : [0, 0];
      if (!p.ear && this.idle.ear && !this._mo) p.earDy[this.idle.ear.side] = this.idle.ear.up ? -1 : 1;
      // 노트북 타자: 앞발은 화면 뒤에 가려져 안 보이니, 어깨(몸)가 번갈아 들썩이는 걸로 친다는 걸 보여 준다.
      // 모션이 몸 변형(xf)을 이미 쓰고 있으면 건드리지 않는다
      if ((p.armL === 'type' || p.armL === 'typefast') && !p.xf && !this.held) {
        const f = p.armL === 'typefast' ? 16 : 9;
        const beat = Math.floor(t * f) % 2 ? 1 : -1;
        p.xf = { rot: beat * (p.armL === 'typefast' ? 0.035 : 0.022), py: GROUND };
        // 노트북 화면 불빛이 얼굴에 비친다 (아래를 내려다보는 눈)
        if (p.lookY === 0) p.lookY = 1;
      }
      this._p = p;
      return p;
    }

    // 목덜미를 잡혀 들린 고양이. 머리는 손에 붙들린 채 가만히 있고, 목 아래 몸통만
    // 진자처럼 흔들린다. 뒷발과 꼬리는 몸보다 한 박자 더 늦게 대롱대롱.
    // 처음엔 눈이 동그래졌다가 곧 얌전히 체념한다 (목덜미 잡힌 고양이는 얌전해진다)
    heldPose(p, t) {
      const h = this.held;
      const since = t - this.heldAt;
      Object.assign(p, {
        curl: false, step: null, prop: null, overlay: null, armL: 'rest', armR: 'rest', noTail: true,
        lookX: 0, lookY: 0, dy: -2, sy: 1, sx: 1, ear: since < 0.6 ? 1 : -1, tail: 'slow', xf: null,
      });
      // 눈은 평소 크기 그대로 (놀라서 커지지 않는다)
      p.eyes = this.blinkAt(t) ? 'blink' : 'open';
      p.mouth = since < 0.6 ? 'o' : 'smile';
      if (since >= 0.6) p.blush = true;
      // 몸통 맨 아래가 옆으로 밀리는 칸 수 (화면에서 오른쪽이 +). 캔버스가 뒤집혀 있으면 부호도 뒤집는다.
      // 통통한 고양이라 몸이 한 덩어리로 묵직하게 움직인다: 휘는 건 두어 칸까지만
      p.scruff = clamp(Math.round(-Math.sin(h.rot) * 4), -2, 2) * this.facing;
      p.dangle = clamp(Math.round(h.legs * this.facing), -1, 1);
      // 오래 들고 있으면 버둥버둥: 뒷발을 번갈아 차고, 귀를 눕히고, 입을 벌린다
      if (h.struggle) {
        p.dangle = Math.floor(t * 12) % 2 ? 1 : -1;
        p.scruff = Math.floor(t * 6) % 2 ? 1 : -1;
        p.ear = -1;
        p.mouth = 'o';
        p.eyes = 'squint';
        p.blush = false;
      }
      p.noShadow = true;
    }

    // 모션 한 프레임. 자세를 깨끗이 비운 다음 모션이 원하는 대로 채운다
    runMotion(M, p, at, t) {
      Object.assign(p, {
        overlay: null, prop: null, curl: false, step: null, eyes: this.blinkAt(t) ? 'blink' : 'open', mouth: 'smile',
        armL: 'rest', armR: 'rest', tail: 'idle', ear: 0, dy: 0, sy: 1, sx: 1, lookX: 0, lookY: 0,
      });
      const k = clamp(at / M.len, 0, 1);
      M.pose(p, k, at, this, t);
      this._mo = { M, k, at };
    }

    basicAction(p, k, at) {
      const len = this.actionLen;
      switch (this.action) {
        case 'happy': {
          p.dy = -Math.sin(k * Math.PI) * 6;
          if (k > 0.85) { p.sy = 0.88; p.sx = 1.1; }
          p.eyes = 'happy'; p.mouth = 'open'; p.armL = p.armR = 'up'; p.ear = 1; p.tail = 'up';
          break;
        }
        case 'levelup':
        case 'achieve': {
          const j = (k * 2) % 1;
          p.dy = -Math.sin(j * Math.PI) * 7;
          if (j > 0.88) { p.sy = 0.86; p.sx = 1.12; }
          p.eyes = 'happy'; p.mouth = 'open'; p.armL = p.armR = 'up'; p.ear = 1; p.tail = 'up';
          break;
        }
        case 'evolve': {
          const freq = 4 + k * 26;
          p.flash = k < 0.92 ? (Math.sin(at * freq) > 0 ? 1 : 0) : 1 - (k - 0.92) / 0.08;
          p.eyes = 'closed'; p.mouth = 'flat'; p.dy = -k * 3; p.tail = 'up';
          if (k > 0.9 && !this.burst) {
            this.burst = true;
            const { cx, cy } = this.geom();
            for (let i = 0; i < 18; i++) {
              const a = (i / 18) * Math.PI * 2;
              this.spawn('sparkle', cx, cy, Math.cos(a) * 26, Math.sin(a) * 26, 1.4);
            }
          }
          break;
        }
        case 'wave':
          p.armR = 'wave'; p.eyes = 'happy'; p.mouth = 'open'; p.ear = 1; p.tail = 'up';
          break;
        case 'eat':
          p.prop = 'bowl'; p.lookX = -1; p.lookY = 1;
          p.mouth = Math.floor(at * 5) % 2 ? 'chew' : 'open';
          p.eyes = Math.floor(at * 0.8) % 2 ? 'happy' : 'open';
          break;
        case 'stretch': {
          const sn = Math.sin(k * Math.PI);
          p.sy = 1 - sn * 0.12; p.sx = 1 + sn * 0.12;
          p.eyes = 'closed'; p.mouth = 'o'; p.tail = 'up';
          break;
        }
        case 'yawn':
          p.eyes = 'closed'; p.mouth = 'o'; p.ear = -1;
          break;
        case 'nibble':
          // 바닥에 떨어진 먹이를 주워 먹는다. 밥그릇 없이 고개만 숙인다
          p.dy = 1;
          p.lookY = 1;
          p.eyes = 'half';
          p.mouth = Math.floor(at * 7) % 2 ? 'chew' : 'open';
          p.ear = 1;
          p.tail = 'wag';
          break;
        case 'pounce': {
          // 몸을 한 번 낮췄다가 앞으로 튀어 오른다
          if (k < 0.38) {
            p.sy = 0.86; p.sx = 1.12; p.dy = 1; p.tail = 'up';
          } else {
            const j = (k - 0.38) / 0.62;
            p.dy = -Math.sin(j * Math.PI) * 9;
            p.armL = p.armR = 'up';
          }
          p.eyes = 'open'; p.mouth = 'open'; p.ear = 1;
          break;
        }
        case 'bored':
          // 놀다가 질렸다. 멍하니 서 있다가 크게 하품하고, 식빵 자세로 앉아 버린다
          p.tail = 'slow';
          p.ear = -1;
          if (k < 0.3) { p.eyes = 'half'; p.mouth = 'flat'; }
          else if (k < 0.55) { p.eyes = 'closed'; p.mouth = 'o'; p.sy = 1.04; }
          else { p.curl = true; p.eyes = 'half'; p.mouth = 'flat'; }
          break;
        case 'perk':
          // 무슨 소리가 났나? 귀를 세우고 고개를 돌려 본다
          p.ear = 1;
          p.lookX = at < len / 2 ? -1 : 1;
          p.mouth = 'flat';
          p.tail = 'flick';
          break;
        case 'groom':
          // 앞발로 얼굴을 쓱쓱
          p.armR = 'groom';
          p.eyes = Math.floor(at * 2) % 2 ? 'happy' : 'blink';
          p.mouth = 'flat';
          p.tail = 'slow';
          break;
      }
      if (this.action !== 'evolve') this.burst = false;
    }

    // 걸음 박자와 잔동작을 한 프레임만큼 굴린다
    tick(dt, t) {
      const id = this.idle;
      if (this.move) {
        const cadence = clamp(1.1 + Math.abs(this.move) / 70, 1.1, 3.2);
        this.walkPhase = (this.walkPhase + dt * cadence) % 1;
      } else this.walkPhase = 0;

      // 자거나 뭔가 하는 중이면 잔동작은 쉰다
      if (this.action || this.move || this.look || this.mood === 'sleeping' || this.loopKey) {
        id.look = null;
        id.ear = null;
        return;
      }
      id.next -= dt;
      if (id.next <= 0) {
        id.next = rand(2.4, 6.4);
        const r = Math.random();
        if (r < 0.35) id.look = { x: Math.random() < 0.5 ? -1 : 1, until: t + rand(0.9, 2) };
        else if (r < 0.75) id.ear = { side: Math.random() < 0.5 ? 0 : 1, up: Math.random() < 0.6, until: t + rand(0.2, 0.45) };
        else id.flick = t + 0.7;
      }
      if (id.look && t > id.look.until) id.look = null;
      if (id.ear && t > id.ear.until) id.ear = null;
    }

    // ---------- 그리기 ----------

    frame() {
      const t = performance.now() / 1000;
      this._tj = 0; // 꼬리를 몇 줄째 그리는지 (털 무늬용)
      const dt = Math.min(0.2, t - this.last);
      this.last = t;
      this._dt = dt;
      const real = this.realCtx;
      const off = this.offCtx;

      // 1) 고양이를 오프스크린에
      this.ctx = off;
      off.setTransform(1, 0, 0, 1, 0, 0);
      off.clearRect(0, 0, G, G);
      this.top = G;
      this.tick(dt, t);
      const p = this.pose(t);
      off.save();
      if (this.facing < 0) off.setTransform(-1, 0, 0, 1, G, 0);
      const g = this.layout(this.stageDef(), p, t, p.curl);
      this._shadow = [g.cx, g.body.rx * 1.15, -p.dy];
      if (p.curl) this.drawCurled(g);
      else this.drawCat(g);
      this.ambient({ cx: g.cx, cy: g.cy, rx: g.body.rx, ry: g.body.ry, p }, dt);
      this.drawOverlay({ cx: g.cx, cy: g.cy - 1, rx: g.body.rx, ry: g.body.ry, p, t });
      this.drawParticles(dt);
      off.restore();

      // 2) 진짜 캔버스에 그림자 → 몸 변형을 건 고양이
      this.ctx = real;
      real.setTransform(1, 0, 0, 1, 0, 0);
      real.clearRect(0, 0, G, G);
      const xf = p.xf;
      // 창 안에서 떠 있으면(뛰어오름·들림) 그림자는 펫 창이 바닥에 따로 그린다 (floorShadow). 여기서 그리면 같이 떠오른다
      if (!p.noShadow && !this.floorShadow) {
        const [cx, rx, h] = this._shadow;
        const x = (this.facing < 0 ? G - 1 - cx : cx) + (xf && xf.ox ? xf.ox : 0);
        this.drawShadow(x, rx * (xf && xf.sx ? Math.abs(xf.sx) : 1), h + (xf && xf.oy < 0 ? -xf.oy : 0));
      }
      real.save();
      real.imageSmoothingEnabled = false;
      if (p.clipGround || p.clipY != null) {
        real.beginPath();
        real.rect(0, 0, G, (p.clipY != null ? p.clipY : GROUND) + 1);
        real.clip();
      }
      if (xf) {
        const px = xf.px != null ? xf.px : 24;
        const py = xf.py != null ? xf.py : GROUND;
        real.translate(Math.round(px + (xf.ox || 0)), Math.round(py + (xf.oy || 0)));
        if (xf.rot) real.rotate(xf.rot);
        real.scale((xf.sx || 1) * (xf.flipX ? -1 : 1), (xf.sy || 1) * (xf.flipY ? -1 : 1));
        real.translate(-px, -py);
      }
      real.drawImage(this.off, 0, 0);
      real.restore();

      // 3) 효과
      const mo = this._mo;
      if (mo && mo.M.step && this._an) mo.M.step(this, mo.k, mo.at, dt, this._an, p);
      this.fx = this.fx.filter((f) => (f.life -= dt) > 0);
      for (const f of this.fx) {
        f.vy += f.ay * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        real.globalAlpha = f.fade === false ? 1 : clamp((f.life / f.max) * 2.2, 0, 1);
        FX[f.type](this, real, f);
      }
      real.globalAlpha = 1;
    }

    // 도트 맵 하나를 화면 어디에 찍을지 계산한다.
    // 숨을 쉬면 br 행이 한 줄 늘거나 줄어서 몸통만 부풀었다 꺼진다 (발은 바닥에 그대로)
    layout(s, p, t, curled) {
      const m = curled ? s.curl : s.map;
      const grow = curled && m.br == null ? 0 : p.sy > 1.012 ? 1 : p.sy < 0.988 ? -1 : 0;
      const x0 = Math.round(G / 2 - m.ax);
      const y0 = Math.round(GROUND - (m.rows.length - 1 + grow) + p.dy);
      const lift = (row) => (m.br != null && row > m.br ? grow : 0); // br 위쪽만 통째로 올라간다
      return {
        s, p, t, m, x0, y0, grow, lift,
        cx: x0 + m.ax, cy: y0 + m.cy + lift(m.cy),
        body: { rx: m.rx, ry: m.ry },
        head: { rx: m.hr, ry: m.hr },
        hx: x0 + m.hx, hy: y0 + m.hy + lift(m.hy) + p.lookY,
        c: this.colors, flash: p.flash > 0.5,
      };
    }

    // 도트로 찍은 몸을 그대로 찍어낸다. 글자 → 털색
    // rows 는 [from, to) 만, cols 는 [a, b] 칸만 찍을 수 있다 (귀·발이 따로 움직일 때 쓴다)
    drawMap(g, rows, dx = 0, dy = 0, squash = true, rowRange = null, cols = null) {
      const { c, flash } = g;
      const map = { O: c.outline, B: c.body, S: c.stripe || c.shade, L: c.light, M: c.belly, P: c.ear, C: c.cheek, E: c.eye };
      // 털색 무늬 (흰 양말·삼색·무지개·반짝이). 손님 고양이(fur)는 자기 mask·tail 이 있을 때만 (GUEST_FURS)
      const F = this.fur ? (this.fur.mask || this.fur.tail ? this.fur : null) : this.furKey ? FURS[this.furKey] : null;
      const isBody = F && rows === g.m.rows;
      const isTail = F && !isBody && rows.length === 1 && g.m.tail && g.m.tail.rows.includes(rows[0]);
      const tj = isTail ? this._tj++ : -1;
      const main = isBody && g.m === this.stageDef().map;
      const now = F && (F.sparkle || F.stars || F.aurora || F.neon || F.holo) ? performance.now() : 0;
      const pick = (ch, i, j, x, y) => {
        // 홀로그램: 캔버스 자리 · 시간으로 칸마다 색을 고른다 (몸 · 꼬리 · 귀 모두)
        if (F && F.holo) {
          const hc = holoColor(ch, x, y, now / 1000);
          if (hc) return hc;
        }
        // 네온: 외곽선 · 줄무늬가 시간에 따라 색을 바꾼다 (몸 · 꼬리 · 귀 모두)
        if (F && F.neon && (ch === 'O' || ch === 'S')) return `hsl(${Math.round((now / 18 + (ch === 'S' ? 120 : 0) + j * 6) % 360)},100%,${ch === 'O' ? 62 : 58}%)`;
        if (!F || ch === 'O' || ch === 'E' || ch === 'C') return map[ch] || c.body;
        if (F.rainbow && (isBody || isTail)) return RAINBOW[isBody ? j % RAINBOW.length : (tj + 3) % RAINBOW.length];
        if (F.aurora && (isBody || isTail)) {
          const w = Math.sin(now / 1400 + j * 0.45 + i * 0.12);
          const lt = { B: 58, S: 50, L: 72, M: 76 }[ch] || 58;
          return `hsl(${Math.round(170 + w * 70)},70%,${lt}%)`;
        }
        const m = main && F.mask ? F.mask(i, j) : isTail && F.tail ? F.tail(tj) : null;
        if (m) return m === 'W' ? c.white : m === 'K' ? c.K : m === 'A' ? c.A : c.body;
        if (isBody && F.stars && (i * 11 + j * 7) % 13 === 0) return (Math.floor(now / 400) + i) % 3 ? c.light : '#ffffff';
        if (isBody && F.sparkle && (i * 5 + j * 9 + Math.floor(now / 300)) % 29 === 0) return F.sparkle;
        return map[ch] || c.body;
      };
      const br = squash ? g.m.br : null;
      // 숨을 쉴 때 br 줄이 한 줄 늘거나 준다
      const times = (j) => (br != null && j === br ? (g.grow > 0 ? 2 : g.grow < 0 ? 0 : 1) : 1);
      const from = rowRange ? rowRange[0] : 0;
      const to = rowRange ? rowRange[1] : rows.length;
      let y0 = g.y0 + dy;
      for (let j = 0; j < from; j++) y0 += times(j); // 건너뛴 줄만큼 아래로 내려놓는다
      // 홀로그램 몸: 먼저 왼쪽에 자홍, 오른쪽에 청록 잔상을 반투명하게 깔고(색 번짐) 그 위에 몸을 찍는다. 3.1초마다 잠깐 지직 어긋난다
      const passes = [[0, null]];
      if (F && F.holo && isBody && !flash) {
        const gl = now % 3100 < 140 ? (Math.floor(now / 25) % 2 ? 2 : -1) : 0;
        passes.unshift([-1 - Math.max(0, gl), 'rgba(255,60,210,0.5)'], [1 + Math.max(0, -gl) + (gl > 0 ? 1 : 0), 'rgba(40,235,255,0.5)']);
      }
      for (const [gx, gc] of passes) {
        let y = y0;
        for (let j = from; j < to; j++) {
          const row = rows[j];
          const a = cols ? cols[0] : 0;
          const b = cols ? Math.min(cols[1], row.length - 1) : row.length - 1;
          for (let k = 0; k < times(j); k++) {
            for (let i = a; i <= b; i++) {
              const ch = row[i];
              if (!ch || ch === '.') continue;
              const x = g.x0 + dx + i;
              if (gc) this.px(x + gx, y, gc, false);
              else this.px(x, y, flash ? P.white : pick(ch, i, j, x, y));
            }
            y++;
          }
        }
      }
    }

    px(x, y, c, solid = true) {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= G || y >= G) return;
      this.ctx.fillStyle = c;
      this.ctx.fillRect(x, y, 1, 1);
      if (solid && y < this.top) this.top = y;
    }

    rect(x, y, w, h, c) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c);
    }

    pattern(rows, x, y, map, solid = true) {
      rows.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) {
          const ch = row[i];
          if (ch !== '.' && map[ch]) this.px(x + i, y + j, map[ch], solid);
        }
      });
    }

    shape(inside, box, fill, outline) {
      const [x0, y0, x1, y1] = box.map(Math.round);
      for (let y = y0 - 1; y <= y1 + 1; y++)
        for (let x = x0 - 1; x <= x1 + 1; x++) {
          if (inside(x, y)) {
            const c = fill(x, y);
            if (c) this.px(x, y, c);
          } else if (outline && (inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1))) {
            this.px(x, y, outline);
          }
        }
    }

    ellipse(cx, cy, rx, ry, fill, outline) {
      this.shape(
        (x, y) => {
          const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
          return nx * nx + ny * ny <= 1;
        },
        [cx - rx - 2, cy - ry - 2, cx + rx + 2, cy + ry + 2],
        typeof fill === 'function' ? fill : () => fill,
        outline,
      );
    }

    drawShadow(cx, rx, height) {
      const w = Math.max(3, rx * (0.95 - Math.min(height, 8) * 0.05));
      for (let x = Math.round(cx - w); x <= Math.round(cx + w); x++) {
        this.px(x, GROUND + 1, P.shadow, false);
        if (Math.abs(x - cx) < w - 2) this.px(x, GROUND + 2, P.shadow, false);
      }
    }

    // 악세사리·모션 소품이 쓰는 색 (외곽선은 고양이 선 색을 따른다)
    colorsFor(g) {
      if (!this._col || this._col.K !== g.c.outline) this._col = Object.assign({}, PAL, { K: g.c.outline });
      return this._col;
    }

    // ---------- 고양이 ----------

    drawCat(g) {
      const { p, m } = g;
      const an = (this._an = anchorsOf(g));
      const AL = this.accList();
      const mo = this._mo;
      const col = this.colorsFor(g);
      if (p.hide) {
        // 봉투 속에 쏙 들어가 안 보인다. 소품(봉투)만 그린다
        if (mo && mo.M.back) mo.M.back.call(this, g, an, mo.k, mo.at, col);
        if (mo && mo.M.front) mo.M.front.call(this, g, an, mo.k, mo.at, col);
        return;
      }
      if (!g.flash) for (const A of AL) if (A.back) A.back.call(this, g, an, col, g.t);
      if (mo && mo.M.back) mo.M.back.call(this, g, an, mo.k, mo.at, col);
      if (m.tail && !p.noTail) this.drawTail(g);
      if (p.dangle != null && this.held) this.drawHangTail(g);
      this.drawTorso(g);
      if (!g.flash) this.drawFace(g);
      // 코스튬은 몸·얼굴 바로 위에 입힌다. 노트북·밥그릇·모션 소품·앞발은 그 뒤에 그려서 옷에 가려지지 않는다
      if (!g.flash) this.drawAccessory(g);
      // 손님 고양이의 표시 (졸린 눈·불티·볼 빗금 같은 GUEST_FURS 의 mark)
      if (!g.flash && this.fur && this.fur.mark) this.fur.mark.call(this, g, an, g.t);
      // 타자 치는 앞발은 노트북보다 먼저 그린다: 화면 윗변 뒤로 발끝만 빼꼼 보이게
      if (p.prop === 'laptop') {
        this.drawTypingPaws(g);
        this.drawLaptop(g);
      }
      if (mo && mo.M.mid) mo.M.mid.call(this, g, an, mo.k, mo.at, col);
      this.drawFrontPaws(g);
      const C = this.carry && carries()[this.carry];
      if (C) C.call(this, g, an, col, g.t);
      if (p.prop === 'bowl') this.drawBowl(g, false);
      if (p.prop === 'emptyBowl') this.drawBowl(g, true);
      if (p.sweat) this.drawSweat(an, g.t);
      if (mo && mo.M.front) mo.M.front.call(this, g, an, mo.k, mo.at, col);
    }

    // 잘 때: 식빵 굽듯 동그랗게 만 도트 맵으로 갈아탄다
    drawCurled(g) {
      const an = (this._an = anchorsOf(g));
      const mo = this._mo;
      const col = this.colorsFor(g);
      if (!g.flash) for (const A of this.accList()) if (A.back) A.back.call(this, g, an, col, g.t);
      if (mo && mo.M.back) mo.M.back.call(this, g, an, mo.k, mo.at, col);
      this.drawTorso(g);
      if (!g.flash) this.drawFace(g);
      if (!g.flash) this.drawAccessory(g);
      if (mo && mo.M.mid) mo.M.mid.call(this, g, an, mo.k, mo.at, col);
      if (mo && mo.M.front) mo.M.front.call(this, g, an, mo.k, mo.at, col);
    }

    // 몸통·귀·발을 나눠 찍는다.
    //  - 귀는 기분 따라 쫑긋 서거나 눕고, 가만히 있을 때는 한쪽만 씰룩인다
    //  - 걸을 때는 발이 번갈아 한 칸씩 들린다
    drawTorso(g) {
      const { m, p } = g;
      const meta = metaOf(m);
      const er = m.earRows || 0;
      const legRow = m.rows.length - 1;
      const walking = p.step != null && meta.legs.length > 1;

      if (p.dangle != null && meta.legs.length > 1) {
        if (p.scruff) {
          // 목덜미 아래부터 한 줄씩 옆으로 밀어 찍는다. 아래로 갈수록 많이 (머리는 그대로)
          for (let j = er; j < legRow; j++) this.drawMap(g, m.rows, this.scruffDx(p, j, legRow), 0, true, [j, j + 1]);
        } else this.drawMap(g, m.rows, 0, 0, true, [er, legRow]);
        this.drawDangleLegs(g, meta.legs, legRow);
        if (er) this.drawEars(g);
        return;
      }

      this.drawMap(g, m.rows, 0, 0, true, [er, walking ? legRow : m.rows.length]);

      if (walking) {
        meta.legs.forEach((run, i) => {
          // 앞뒤 발이 엇갈리게 — 한쪽이 들리면 반대쪽은 땅을 딛는다
          const up = Math.sin(p.step * Math.PI * 2 + i * Math.PI) > 0.3 ? -1 : 0;
          this.drawMap(g, m.rows, 0, up, true, [legRow, legRow + 1], run);
        });
      }

      if (er) this.drawEars(g);
    }

    drawEars(g) {
      const { m, p } = g;
      const er = m.earRows || 0;
      metaOf(m).ears.forEach((run, side) => {
        const dy = (p.earDy && p.earDy[side]) || 0;
        this.drawMap(g, m.rows, 0, dy, true, [0, er], run);
        // 쫑긋 세우면 귀뿌리가 한 칸 뜨니까 밑줄을 제자리에 한 번 더 채운다
        if (dy < 0) this.drawMap(g, m.rows, 0, 0, true, [er - 1, er], run);
      });
      if (g.s.ear && !g.flash) this.drawEarExtra(g);
    }

    // 귀 모양의 덧칠(흰 귀 끝)과 테두리 위로 올라가는 귀(스라소니 털 · 여우 귀). 귀가 씰룩이면 같이 움직인다
    drawEarExtra(g) {
      const { c, p } = g;
      const E = g.s.ear;
      const curled = g.m === g.s.curl;
      const col = { O: c.outline, B: c.body, C: c.cheek, S: c.stripe || c.shade, W: c.white || '#fffaf3' };
      const dyOf = (x) => ((p.earDy && p.earDy[x < 7 ? 0 : 1]) || 0) - (curled ? 1 : 0);
      for (const [x, y, k] of E.paint || []) if (!(curled && y === 0)) this.px(g.x0 + x, g.y0 + y + dyOf(x), col[k]);
      if (curled || !E.above) return;
      E.above.forEach((l, i) => {
        const row = sym(l);
        const y = i - E.above.length;
        for (let x = 0; x < row.length; x++) if (row[x] !== '.') this.px(g.x0 + x, g.y0 + y + dyOf(x), col[row[x]] || c.outline);
      });
    }

    // 들려서 축 늘어진 뒷발. 평소보다 조금만 길다 (바깥 두 발 2칸, 가운데 1칸).
    // 발끝으로 갈수록 p.dangle 칸만큼 옆으로 밀려서 몸보다 한 박자 늦게 흔들리는 것처럼 보인다
    // 목덜미를 잡혔을 때 j 번째 줄이 옆으로 밀리는 칸 수. 목(7번째 줄) 위는 0, 발끝으로 갈수록 p.scruff 까지
    scruffDx(p, j, legRow) {
      const NECK = 7;
      if (!p.scruff || j < NECK) return 0;
      return Math.round((p.scruff * (j - NECK + 1)) / (legRow - NECK + 1));
    }

    drawDangleLegs(g, legs, legRow) {
      const { p, c, m, flash } = g;
      const O = flash ? P.white : c.outline;
      const B = flash ? P.white : c.body;
      const y0 = g.y0 + legRow + (m.br != null && m.br < legRow ? g.grow : 0);
      const base = p.scruff || 0; // 몸통이 밀린 만큼 발도 같이 간다
      legs.forEach(([a, b], i) => {
        const L = i === 0 || i === legs.length - 1 ? 2 : 1;
        for (let j = 0; j <= L; j++) {
          const dx = base + Math.round((p.dangle * j) / L);
          const y = y0 + j;
          if (j === L) {
            for (let x = a; x <= b; x++) this.px(g.x0 + x + dx, y, O);
            continue;
          }
          this.px(g.x0 + a - 1 + dx, y, O);
          this.px(g.x0 + b + 1 + dx, y, O);
          for (let x = a; x <= b; x++) this.px(g.x0 + x + dx, y, B);
        }
      });
    }

    // 들렸을 때 꼬리. 엉덩이 옆에서 아래로 축 늘어져 뒷발보다 더 늦게 흔들린다
    drawHangTail(g) {
      const { p, c, flash } = g;
      const O = flash ? P.white : c.outline;
      const B = flash ? P.white : c.body;
      const x = g.x0 + 12 + this.scruffDx(p, 9, g.m.rows.length - 1);
      const y0 = g.y0 + 9;
      const L = 7;
      for (let j = 0; j <= L; j++) {
        const dx = Math.round(((p.dangle + (p.scruff || 0) * 0.5) * 1.5 * j * j) / (L * L));
        const y = y0 + j;
        if (j === L) { this.px(x + dx, y, O); this.px(x + 1 + dx, y, O); continue; }
        this.px(x - 1 + dx, y, O);
        this.px(x + 2 + dx, y, O);
        this.px(x + dx, y, j > L - 3 ? c.stripe || B : B);
        this.px(x + 1 + dx, y, j > L - 3 ? c.stripe || B : B);
      }
    }

    // 꼬리는 몸보다 먼저(뒤에) 찍는다.
    // 뿌리는 몸에 붙어 있고 끝으로 갈수록 옆으로 크게 휜다. 줄마다 한 칸씩만 어긋나서 끊기지 않는다.
    // (세로로 밀면 줄끼리 같은 자리에 겹쳐서 꼬리가 뭉개진다. 그래서 휘는 건 가로로만 한다)
    drawTail(g) {
      const { p, t, m } = g;
      const T = m.tail;
      const SPEED = { up: 0, wag: 6.5, flick: 9, slow: 0.8, idle: 1.6 };
      const AMP = { up: 0, wag: 2, flick: 2, slow: 1, idle: 1 };
      const speed = SPEED[p.tail] != null ? SPEED[p.tail] : SPEED.idle;
      const amp = AMP[p.tail] != null ? AMP[p.tail] : AMP.idle;
      const ph = t * speed;
      const swing = p.tail === 'flick' ? (Math.sin(ph) > 0.82 ? -amp : 0) : Math.sin(ph) * amp;
      const rise = p.tail === 'up' ? -1 : p.tail === 'slow' ? 1 : 0; // 꼬리 전체 높이
      const last = Math.max(1, T.rows.length - 1);
      T.rows.forEach((row, j) => {
        const k = 1 - j / last; // 윗줄(꼬리 끝)일수록 1 에 가깝다
        const dx = Math.round(swing * k);
        this.drawMap(g, [row], T.x + dx, T.y + j + rise + g.lift(T.y), false);
      });
    }

    // 얼굴: 점 눈 두 개, 작은 ω 코, 눈 바깥 아래에 볼터치.
    // 모션용 눈(wide x dot star heart wink squint side teary sparkle none)과 입(blep big wavy frown lick grin kiss none),
    // 눈썹(angry sad), 볼터치(blush)가 더 있다
    drawFace(g) {
      const { s, p, c } = g;
      const E = s.eye;
      const fx = Math.round(g.hx + p.lookX);
      const ey = Math.round(g.hy + E.dy);
      const sp = Math.round(E.spread);
      const L = c.lash;
      for (const side of [-1, 1]) {
        const x = side < 0 ? fx - sp - E.w + 1 : fx + sp;
        const wx = side < 0 ? x - 1 : x; // 커지는 눈은 바깥쪽으로 한 칸 넓힌다
        const outer = side < 0 ? x - 1 : x + E.w;
        const inner = side < 0 ? x + E.w : x - 1;
        let kind = p.eyes;
        if (kind === 'wink') kind = side < 0 ? 'open' : 'happy';
        switch (kind) {
          case 'blink':
          case 'half':
            if (E.h === 1) this.rect(side < 0 ? x - 1 : x, ey, E.w + 1, 1, L);
            else this.rect(x, ey + E.h - 1, E.w, 1, L);
            break;
          case 'closed':
            this.px(x, ey + E.h - 2, L);
            this.rect(x, ey + E.h - 1, E.w, 1, L);
            this.px(outer, ey + E.h - 2, L);
            break;
          case 'happy': // ^^
            this.px(outer, ey + E.h - 1, L);
            this.rect(x, ey + E.h - 2, E.w, 1, L);
            break;
          case 'wide':
            this.rect(wx, ey - 1, E.w + 1, E.h + 1, c.eye);
            this.px(side < 0 ? wx + E.w : wx, ey - 1, '#fff');
            break;
          case 'x':
            this.pattern(['X.X', '.X.', 'X.X'], wx, ey - 1, { X: L });
            break;
          case 'dot':
            this.px(side < 0 ? x + E.w - 1 : x, ey + E.h - 1, c.eye);
            break;
          case 'star':
            this.pattern(['.Y.', 'YWY', '.Y.'], wx, ey - 1, { Y: '#ffc93c', W: '#fff' });
            this.px(wx + 1, ey - 2, L);
            break;
          case 'heart':
            this.pattern(['R.R', 'RRR', '.R.'], wx, ey - 1, { R: '#ff4f7a' });
            break;
          case 'squint':
            if (side < 0) this.pattern(['X.', '.X', 'X.'], x, ey - 1, { X: L });
            else this.pattern(['.X', 'X.', '.X'], x, ey - 1, { X: L });
            break;
          case 'side': {
            const dir = p.sideDir || 1;
            this.rect(side < 0 ? x - 1 : x, ey, E.w + 1, 1, L);
            this.px(dir > 0 ? x + E.w - 1 : x, ey + 1, c.eye);
            break;
          }
          case 'teary':
            this.rect(x, ey, E.w, E.h, c.eye);
            this.px(side < 0 ? x : x + E.w - 1, ey, '#fff');
            this.px(outer, ey + E.h, TEAR, false);
            break;
          case 'sparkle':
            this.rect(x, ey, E.w, E.h, c.eye);
            this.px(side < 0 ? x : x + E.w - 1, ey, '#fff');
            this.px(side < 0 ? x + E.w - 1 : x, ey + E.h - 1, '#fff');
            break;
          case 'none':
            break;
          default:
            this.rect(x, ey, E.w, E.h, c.eye);
            if (c.eye !== c.outline) this.px(x, ey, P.white);
        }
        if (p.brow === 'angry') {
          this.px(outer, ey - 3, L);
          this.px(side < 0 ? x : x + 1, ey - 3, L);
          this.px(side < 0 ? x + 1 : x, ey - 2, L);
          this.px(inner, ey - 2, L);
        } else if (p.brow === 'sad') {
          this.px(outer, ey - 2, L);
          this.px(side < 0 ? x : x + 1, ey - 2, L);
          this.px(side < 0 ? x + 1 : x, ey - 3, L);
          this.px(inner, ey - 3, L);
        }
        // 볼터치 — 눈 바깥쪽 한 칸 아래
        if (c.cheek && p.eyes !== 'none') this.px(side < 0 ? x - 2 : x + E.w + 1, ey + E.h, c.cheek, false);
        if (p.blush) {
          this.px(side < 0 ? x - 2 : x + E.w + 1, ey + E.h, BLUSH, false);
          this.px(side < 0 ? x - 3 : x + E.w + 2, ey + E.h, BLUSH, false);
          this.px(side < 0 ? x - 2 : x + E.w + 1, ey + E.h + 1, BLUSH, false);
        }
      }

      // 코와 입 (ω)
      const N = s.nose;
      const my = ey + E.h;
      const nx = fx - Math.floor(N.w / 2);
      const nc = c.nose;
      const smile = () => {
        // .O.  /  OOO  /  O.O
        let y = my;
        if (N.h > 2) this.px(fx, y++, nc);
        this.rect(nx, y, N.w, 1, nc);
        this.px(nx, y + 1, nc);
        this.px(nx + N.w - 1, y + 1, nc);
      };
      switch (p.mouth) {
        case 'open':
          this.rect(nx, my, N.w, 2, nc);
          break;
        case 'o':
          this.rect(nx, my, N.w, 2, nc);
          this.px(fx, my + 1, P.tongue);
          break;
        case 'chew':
          this.rect(nx, my, N.w, 1, nc);
          break;
        case 'flat':
          this.rect(nx + 1, my, N.w - 2, 1, nc);
          break;
        case 'blep':
          smile();
          this.px(fx, my + (N.h > 2 ? 2 : 1), TONGUE);
          break;
        case 'lick':
          smile();
          this.px(fx, my + (N.h > 2 ? 2 : 1), TONGUE);
          this.px(fx, my + (N.h > 2 ? 3 : 2), TONGUE);
          break;
        case 'big':
          this.px(fx, my, nc);
          this.rect(fx - 1, my + 1, 3, 3, nc);
          this.px(fx, my + 2, '#7a2230');
          this.px(fx, my + 3, TONGUE);
          break;
        case 'wavy':
          this.px(fx, my, nc);
          [[-2, 2], [-1, 1], [0, 2], [1, 1], [2, 2]].forEach(([dx, dy]) => this.px(fx + dx, my + dy, nc));
          break;
        case 'frown':
          this.px(fx, my, nc);
          this.px(fx, my + 1, nc);
          this.px(fx - 1, my + 2, nc);
          this.px(fx + 1, my + 2, nc);
          break;
        case 'grin':
          this.px(fx, my, nc);
          this.px(fx - 2, my + 1, nc);
          this.rect(fx - 1, my + 2, 3, 1, nc);
          this.px(fx + 2, my + 1, nc);
          break;
        case 'kiss':
          this.px(fx, my, nc);
          this.px(fx + 1, my + 1, nc);
          this.px(fx, my + 2, nc);
          this.px(fx + 1, my + 2, TONGUE);
          break;
        case 'none':
          this.px(fx, my, nc);
          break;
        default:
          smile();
      }
    }

    // 앞발. rest 면 몸에 붙어 있고(도트 맵의 다리), 아니면 자세에 맞게 든다
    drawFrontPaws(g) {
      const { s, p, t, m, c, flash } = g;
      const skin = (v) => (flash ? P.white : v);
      const r = s.paw;
      const an = this._an || anchorsOf(g);
      for (const [i, side] of [-1, 1].entries()) {
        const mode = side < 0 ? p.armL : p.armR;
        if (!mode || mode === 'rest') continue;
        let x = g.hx + side * m.hr * 0.5;
        let y = g.cy;
        switch (mode) {
          case 'type':
          case 'typefast':
            // 앞에서 보면 키보드는 노트북 화면 뒤에 있다. 앞발은 화면에 가려서 안 보인다 (어깨만 들썩인다 — pose 끝부분)
            continue;
          case 'up':
            x = g.hx + side * (m.hr - r * 0.4);
            y = g.hy + 1;
            break;
          case 'wave':
            if (side < 0) continue;
            x = g.hx + m.hr + r * 0.5;
            y = g.hy + 1 + Math.round(Math.sin(t * 16));
            break;
          case 'groom':
            // 얼굴 옆을 위아래로 문지른다
            if (side < 0) continue;
            x = g.hx + m.hr * 0.55;
            y = g.hy + 1 + Math.round(Math.sin(t * 9) * 1.6);
            break;
          case 'hold':
            x = g.hx + side * (r + 0.8);
            y = an.my + 3;
            break;
          case 'cross':
            x = g.hx + side * 1.3;
            y = an.my + 3;
            break;
          case 'front':
            x = g.hx + side * 3.5;
            y = GROUND - 1;
            break;
          case 'claw': {
            const k = (p.claw || [0, 0])[i];
            x = g.hx + side * 2.5;
            // 눈높이까지 쭉 뻗었다가 바닥까지 긁어내린다
            y = Math.round(an.ey - 1 + k * (GROUND - 2 - (an.ey - 1)));
            break;
          }
          case 'knead':
            x = g.hx + side * 3;
            y = GROUND - 1 - ((Math.floor(t * 5) + i) % 2 ? 2 : 0);
            break;
          case 'clap': {
            const k = p.clapK != null ? p.clapK : (Math.sin(t * 14) + 1) / 2;
            x = g.hx + side * (1.8 + k * 3.2);
            y = an.my + 1;
            break;
          }
          case 'lick':
            if (side < 0) continue;
            x = an.fx + 1.5;
            y = an.my + 2;
            break;
          case 'kiss':
            if (side < 0) continue;
            x = an.fx + 0.5;
            y = an.my + 1;
            break;
          case 'out':
            if (side < 0) continue;
            x = g.hx + m.hr + 2.5;
            y = an.ey - 1;
            break;
          case 'cover':
            x = (side < 0 ? an.eyeL : an.eyeR) + an.ew / 2 - 0.5;
            y = an.ey + 1;
            break;
          case 'lift':
            x = g.hx + side * 4.5;
            y = an.top - 1 - (p.liftUp || 0) * 4;
            break;
          case 'point':
            if (side < 0) continue;
            x = g.hx + m.hr + 1.5;
            y = an.top - 1;
            break;
          case 'cheer':
            x = g.hx + side * (m.hr + 0.5);
            y = an.top - 2 + ((Math.floor(t * 6) + i) % 2 ? -1 : 0);
            break;
          case 'float':
            x = g.hx + side * 2.2;
            y = GROUND - 2.5;
            break;
        }
        // 홀로그램 털은 앞발도 몸과 같은 결로 칠한다
        const holo = !flash && !this.fur && this.furKey && FURS[this.furKey].holo;
        const sec = holo ? performance.now() / 1000 : 0;
        if (holo) this.ellipse(x, y, r, r * 0.8, (px, py) => holoColor('B', px, py, sec), holoColor('O', 0, Math.round(y), sec));
        else this.ellipse(x, y, r, r * 0.8, skin(c.body), skin(c.outline));
      }
    }

    // 노트북 뒤에서 투닥투닥: 앞발이 번갈아 올라올 때만 화면 윗변 위로 발끝이 한두 줄 보인다.
    // 박자마다 어느 발이 올라올지 섞어서, 가끔은 둘 다 내려가 있다 (앞발 몸통은 뒤에 그릴 노트북이 가린다)
    drawTypingPaws(g) {
      const { s, p, t, m, c, flash } = g;
      const mode = p.armL;
      if (mode !== 'type' && mode !== 'typefast') return;
      const lidTop = GROUND - 1 - Math.max(4, Math.round(m.ry * 0.5));
      const fast = mode === 'typefast';
      const f = fast ? 16 : 9; // 1초에 몇 번 두드리나 (빠를수록 타닥타닥)
      const beat = Math.floor(t * f);
      const ph = t * f - beat; // 이번 박자 안에서 0→1
      // 박자마다 정해진 무늬: 두 발이 번갈아 가며, 가끔 같은 발로 연타한다
      const pick = (b) => (b * 7 + (b >> 2) * 3) % 5;
      const isUp = (b, i) => {
        const k = pick(b);
        return k === 1 + i || (fast && k === 3) || (k === 4 && i === (b & 1)) || (k === 0 && i === ((b >> 1) & 1));
      };
      const O = flash ? P.white : c.outline;
      const B = flash ? P.white : c.body;
      for (const [i, side] of [-1, 1].entries()) {
        // 두 눈 바깥쪽(볼 자리)에 둬서 눈을 가리지 않는다
        const x = Math.round(g.hx) + (side < 0 ? -6 : 3);
        if (isUp(beat, i)) {
          // 올라온 발: 박자 앞쪽 절반은 한 칸 더 콩 튀어 올랐다가 뒤쪽 절반에 내려앉는다 (화면 윗변 뒤로 발끝만 빼꼼)
          const hop = ph < 0.5 ? 1 : 0;
          this.pattern(['.OO.', 'OLLO', 'OBBO'].slice(0, 2 + hop), x, lidTop - 3 - hop, { O, L: flash ? P.white : c.light, B });
        } else if (isUp(beat - 1, i) && ph < 0.45 && !flash) {
          // 방금 자판을 톡 누른 발: 발 자리 양옆으로 작은 '타닥' 불티가 튄다
          this.px(x - 1, lidTop - 2, 'rgba(255,255,255,0.85)', false);
          this.px(x + 4, lidTop - 2, 'rgba(255,255,255,0.85)', false);
          this.px(x - 2, lidTop - 3, 'rgba(255,255,255,0.5)', false);
          this.px(x + 5, lidTop - 3, 'rgba(255,255,255,0.5)', false);
        }
      }
    }

    drawSweat(an, t) {
      const y = an.top + 1 + (Math.floor(t * 2) % 3);
      this.pattern(['.U.', 'UUU', 'UHU', '.U.'], an.right + 1, y, { U: '#8fd0f5', H: '#fff' }, false);
    }

    // 노트북. 정면이니까 고양이 앞에 가로로 놓이고, 우리는 화면 뒤통수를 본다.
    // 아래쪽 몸을 가려서 "책상에 앉아 일하는" 느낌이 난다
    drawLaptop(g) {
      const { t, m, c } = g;
      const w = Math.max(11, Math.round(m.rx * 1.9));
      const x0 = Math.round(g.cx - w / 2);
      const base = GROUND - 1; // 받침(키보드) 줄
      const lidH = Math.max(4, Math.round(m.ry * 0.5));
      const y0 = base - lidH;

      // 장난감 '고양이 전용 노트북'(p.laptopSkin = 'cat')은 꺼내 둔 모습·잘 때 모습과 같게: 짙은 회색 뚜껑에 민트 고양이 얼굴,
      // 받침은 회색 체크 자판. 평소 일할 때 노트북은 그대로 은색
      const cat = g.p.laptopSkin === 'cat';
      // 화면 뒷판
      this.rect(x0 - 1, y0 - 1, w + 2, lidH + 1, P.laptopOutline);
      this.rect(x0, y0, w, lidH - 1, cat ? '#565d69' : P.laptop);
      this.rect(x0, y0 + lidH - 2, w, 1, cat ? '#3f4550' : P.laptopDark);
      if (cat) {
        // 뒷판 가운데 고양이 얼굴 로고 (귀 둘 + 얼굴). 가끔 반짝
        const lx = Math.round(g.cx) - 1;
        const ly = y0 + Math.max(0, Math.round(lidH / 2) - 2);
        const col = Math.floor(t * 1.5) % 4 === 0 ? '#ffffff' : '#9fe3c8';
        this.px(lx - 1, ly, col);
        this.px(lx + 1, ly, col);
        this.rect(lx - 1, ly + 1, 3, 1, col);
      } else if (Math.floor(t * 2) % 2) this.px(Math.round(g.cx), y0 + Math.round(lidH / 2) - 1, c.light);

      // 받침
      if (cat) {
        for (let x = x0 - 2; x < x0 + w + 2; x++) this.px(x, base, (x & 1) ? '#9aa0aa' : '#d3cabb');
      } else this.rect(x0 - 2, base, w + 4, 1, P.laptopDark);
      this.rect(x0 - 2, base + 1, w + 4, 1, P.laptopOutline);
    }

    // 밥그릇. 고양이 왼쪽 바닥에 놓는다. 비면 안이 비어 보인다
    drawBowl(g, empty) {
      const x0 = Math.round(g.cx - g.m.rx - 10);
      const y0 = GROUND - 4;
      const map = { O: g.c.outline, C: P.bowlBand, W: P.rice, S: P.bowlShade };
      const rows = empty
        ? ['.O.....O.', 'OSSSSSSSO', 'OCCCCCCCO', '.OCCCCCO.', '..OOOOO..']
        : ['.O.WWW.O.', 'OWWWWWWWO', 'OCCCCCCCO', '.OCCCCCO.', '..OOOOO..'];
      this.pattern(rows, x0, y0, map);
      if (!empty && Math.random() < 0.2) this.spawn('steam', x0 + 4 + rand(-1, 1), y0 - 3, rand(-1, 1), -6, 1.1);
    }

    // ---------- 꾸미기 ----------
    // 그림은 accessories.js 에 있다. front 는 몸 위에, back 은 몸보다 먼저 그린다.
    // ears 가 켜진 모자는 다 그린 뒤 귀를 한 번 더 찍어서 귀가 구멍으로 쏙 나온 것처럼 보이게 한다
    drawAccessory(g) {
      const AL = this.accList();
      if (!AL.length) return;
      const an = this._an || anchorsOf(g);
      const col = this.colorsFor(g);
      // 손에 드는 코스튬(hand: true)은 앞발을 쓰는 동안(타자·밥 먹기·물건 물기·손 흔들기·들려 있을 때…) 잠깐 안 그린다.
      // 세트처럼 일부만 손에 드는 코스튬은 this.pawsBusy 를 보고 그 부분만 뺀다
      const p = g.p;
      const busy = (p.armL && p.armL !== 'rest') || (p.armR && p.armR !== 'rest') || !!p.prop || !!this.carry || !!this.held;
      this.pawsBusy = busy;
      // 뒤쪽 칸(효과·등·목…)부터 앞쪽 칸(머리·손) 순서로 겹쳐 그린다. 귀가 뚫린 모자면 그 위에 귀를 다시 찍는다
      for (const A of AL) {
        if (A.hand && busy) continue;
        if (A.front) A.front.call(this, g, an, col, g.t);
        if (A.ears && g.m.earRows) this.drawEars(g);
      }
      for (const A of AL) if (A.over) A.over.call(this, g, an, col, g.t);
    }

    // ---------- 머리 위 표시 ----------

    drawOverlay({ cx, cy, rx, ry, p, t }) {
      const c = this.colors;
      const top = Math.min(this.top, Math.round(cy - ry));
      if (p.overlay === 'dots') {
        const x0 = Math.round(cx + rx * 0.3);
        const y0 = Math.max(1, top - 8);
        this.shape((x, y) => x >= x0 && x < x0 + 11 && y >= y0 && y < y0 + 5 && !((x === x0 || x === x0 + 10) && (y === y0 || y === y0 + 4)),
          [x0, y0, x0 + 10, y0 + 4], () => P.thought, c.outline);
        const n = Math.floor(t * 3) % 4;
        for (let i = 0; i < 3; i++) if (i < n) this.px(x0 + 2 + i * 3, y0 + 2, c.outline);
        this.px(x0 - 1, y0 + 6, c.outline);
      }
      if (p.overlay === 'bang') {
        const x0 = Math.round(cx + rx * 0.55);
        const y0 = Math.max(1, top - 8 + Math.round(Math.sin(t * 8)));
        this.pattern(['OXO', 'OXO', 'OXO', '.O.', 'OXO', '.O.'], x0 - 1, y0, { X: P.bang, O: c.outline });
      }
    }

    ambient({ cx, cy, rx, ry, p }, dt) {
      this.spawnClock += dt;
      if (this.mood === 'sleeping' && !this.action && !this.loopKey && this.spawnClock > 1.6) {
        this.spawnClock = 0;
        this.spawn(Math.random() < 0.5 ? 'z' : 'zs', cx - rx * 0.5, cy - ry - 2, rand(-5, -2), -5, 2.4);
      }
      if (this.action === 'evolve' && Math.random() < 0.5) {
        this.spawn('sparkle', cx + rand(-rx - 5, rx + 5), cy + rand(-ry - 4, ry), 0, rand(-10, -4), 0.8);
      }
      if (p.mouth === 'open' && this.action === 'wave' && this.spawnClock > 0.9) {
        this.spawnClock = 0;
        this.spawn('note', cx - rx - 3, cy - ry, -4, -8, 1.2);
      }
    }

    drawParticles(dt) {
      const c = this.colors;
      const map = {
        heart: { X: P.heart },
        sparkle: { X: P.spark, W: P.white },
        z: { X: P.z },
        zs: { X: P.z },
        note: { X: c.outline },
      };
      this.particles = this.particles.filter((q) => (q.life -= dt) > 0);
      for (const q of this.particles) {
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        if (q.type === 'sparkle') { q.vx *= 0.94; q.vy *= 0.94; }
        if (q.type === 'z' || q.type === 'zs') q.vx = Math.sin(q.life * 3) * 3;
        this.ctx.globalAlpha = clamp((q.life / q.max) * 1.5, 0, 1);
        if (q.type === 'steam') this.px(q.x, q.y, 'rgba(255,255,255,0.9)', false);
        else this.pattern(PATTERNS[q.type], Math.round(q.x), Math.round(q.y), map[q.type], false);
        this.ctx.globalAlpha = 1;
      }
    }

    busy() {
      return !!this.action || this.particles.length > 0 || this.fx.length > 0;
    }
  }

  // 동네 친구 고양이 털색 (main/friends.js 의 fur 번호): 먼지(회색 줄무늬) · 연탄이(까망) · 두부(하양) · (호떡은 떠났다) · 최번개(노랑) · 돈돈까스(샴)
  //  팔레트에 더해 mask(i, j)·tail(j) (털색 17종과 같은 규칙: 'W' white · 'K' · 'A' · 'B' 바탕)와
  //  mark(g, a, t) (몸·얼굴·코스튬 위에 찍는 작은 표시, this = PetRenderer, a = 악세사리 기준점)를 가질 수 있다 (2026-09-24 디자인 2차)
  const gPer = (t, every, len) => t % every < len;
  const gAt = (list) => { const s = new Set(list.map(([i, j]) => i + ',' + j)); return (i, j) => s.has(i + ',' + j); };
  // 졸린 눈: 눈 윗줄을 털색으로 덮어 반쯤 감긴 눈
  function guestLids(g, a) {
    for (const x of [a.eyeL, a.eyeR]) for (let i = 0; i < a.ew; i++) this.px(x + i, a.ey, g.c.body);
  }
  const dustStripe = gAt([[2, 8], [3, 9], [12, 8], [11, 9], [2, 4], [12, 4]]);
  const dustFluff = gAt([[6, 9], [7, 9], [8, 9], [5, 10], [6, 10], [7, 10], [8, 10], [9, 10]]);
  const coalEmber = gAt([[4, 1], [10, 1], [4, 2], [10, 2]]);
  const GUEST_FURS = [
    // 먼지: 먼지뭉치. 부스스한 회색 줄무늬, 정수리에 먼지뭉치를 얹고 볼 털이 삐죽, 늘 반쯤 감긴 졸린 눈 (하루 18시간 잔다)
    {
      body: '#b9b6b1', shade: '#9a968f', light: '#d2cfca', belly: '#cfccc6', stripe: '#77736c', outline: '#2a2724', ear: '#b9b6b1', nose: '#2a2724', cheek: '#e8a9a0', eye: '#2a2724', lash: '#2a2724',
      white: '#e6e3de', K: '#6b675f', A: '#f0a050',
      mask: (i, j) => (dustStripe(i, j) ? 'K' : dustFluff(i, j) ? 'W' : null),
      tail: (j) => (j % 2 ? 'K' : null),
      mark(g, a, t) {
        guestLids.call(this, g, a);
        const f = '#e6e3de', o = g.c.outline;
        // 정수리 먼지뭉치 (가끔 살랑)
        this.pattern(['.F.F.', 'FfFfF', '.fFf.'], a.hx - 2 + (gPer(t, 3, 0.4) ? 1 : 0), a.top - 2, { F: f, f: '#c4c0ba' });
        // 볼 옆 삐죽 털
        for (const [x, d] of [[a.left, -1], [a.right, 1]]) {
          this.px(x + d, a.ey + 2, o);
          this.px(x + d * 2, a.ey + 3, o);
          this.px(x + d, a.ey + 3, f);
        }
      },
    },
    // 연탄이: 달아오른 연탄. 까만 털에 귀 안쪽·꼬리 끝·볼이 불씨 주황, 머리 위로 불티가 톡톡 (까만데 뜨거운 남자)
    {
      body: '#302a2a', shade: '#221e1e', light: '#453d3d', belly: '#3a3434', stripe: '#1f1b1b', outline: '#120e0e', ear: '#302a2a', nose: '#120e0e', cheek: '#e8603a', eye: '#ffc23a', lash: '#120e0e',
      white: '#fffaf3', K: '#b8401a', A: '#ff7a2a',
      mask: (i, j) => (coalEmber(i, j) ? 'A' : null),
      tail: (j) => (j === 0 ? 'A' : j === 1 ? 'K' : null),
      mark(g, a, t) {
        // 불티 세 알이 차례로 떠오르며 사라진다
        for (let k = 0; k < 3; k++) {
          const p = (t * 0.9 + k / 3) % 1;
          if (p > 0.75) continue;
          this.px(a.hx + [-5, 6, 1][k] + (Math.floor(p * 6) % 2), a.top - 1 - Math.floor(p * 9), p < 0.4 ? '#ffd65a' : '#ff7a2a', false);
        }
      },
    },
    // 두부: 수줍은 두부. 무늬 없이 새하얗고 분홍 귓속, 늘 발그레한 볼 빗금, 정수리에 한 올, 가끔 식은땀 (낯가림)
    {
      body: '#f7f3ea', shade: '#e2dccf', light: '#ffffff', belly: '#ffffff', stripe: '#e2dccf', outline: '#4a3f36', ear: '#f7c6c6', nose: '#4a3f36', cheek: '#f79aa6', eye: '#4a3f36', lash: '#4a3f36',
      white: '#fffaf3', K: '#2f2a2a', A: '#f7b8c0',
      mask: (i, j) => ((i === 4 || i === 10) && (j === 1 || j === 2) ? 'A' : j === 3 || j === 4 ? 'B' : null),
      mark(g, a, t) {
        const p = '#f58a9c';
        for (const x of [a.eyeL - 1, a.eyeR + a.ew - 1]) {
          this.px(x, a.my + 1, p);
          this.px(x + 1, a.my, p);
        }
        this.pattern(['.O', 'O.', '.O'], a.hx, a.top - 3, { O: g.c.outline });
        if (gPer(t, 4, 0.8)) {
          this.px(a.right + 2, a.top + 1, '#7cc4f2', false);
          this.px(a.right + 2, a.top + 2, '#7cc4f2', false);
        }
      },
    },
    { body: '#f6efe3', shade: '#e3d6c2', light: '#ffffff', belly: '#ffffff', stripe: '#e0893b', outline: '#3a2718', ear: '#3b3434', nose: '#3a2718', cheek: '#f4b3b0', eye: '#3a2718', lash: '#3a2718' },
    // 최번개 (2026-09-25): 노란 정전기 고양이. 샛노란 털에 귀 끝만 까맣고, 볼에 빨간 동그라미.
    // 꼬리 뿌리는 갈색, 이마에 갈색 줄 둘. 가끔 볼에서 파직 불꽃이 튀고 머리 위로 작은 번개가 번쩍
    {
      body: '#ffd84a', shade: '#f0bf2a', light: '#ffe98a', belly: '#ffe27a', stripe: '#b8862a', outline: '#3a2a08', ear: '#ffd84a', nose: '#3a2a08', cheek: '#e8403a', eye: '#2a1a08', lash: '#2a1a08',
      white: '#fffaf3', K: '#2a2018', A: '#9a6a2a',
      mask: (i, j) => (j <= 1 && (i === 3 || i === 4 || i === 10 || i === 11) ? 'K' : j === 3 && (i === 6 || i === 8) ? 'A' : null),
      tail: (j) => (j <= 1 ? 'A' : null),
      mark(g, a, t) {
        const R = '#e8403a';
        // 볼 빨간 동그라미 (2×2)
        for (const x of [a.eyeL - 2, a.eyeR + a.ew]) this.pattern(['RR', 'RR'], x, a.my, { R });
        // 볼에서 파직: 짧게 번쩍이는 불꽃 두 알
        if (gPer(t, 2.6, 0.35)) {
          const f = Math.floor(t * 12) % 2;
          this.px(a.eyeL - 3 - f, a.my - 1 + f, '#fff6a0', false);
          this.px(a.eyeR + a.ew + 2 + f, a.my - 1 + f, '#fff6a0', false);
        }
        // 머리 위 작은 번개 (가끔)
        if (gPer(t, 5, 0.6)) this.pattern(['..Y', '.Y.', 'YYY', '.Y.', 'Y..'], a.hx + 4, a.top - 6, { Y: '#ffe24a' }, false);
      },
    },
    // 돈돈까스 (2026-09-25): 츄르 공장 공장장. 크림색 샴 고양이 (귀·얼굴 가운데·발·꼬리가 초콜릿색, 파란 눈).
    // 목에 굵은 금목걸이, 펜던트 다이아가 가끔 반짝 (코스튬을 입으면 목걸이는 뺀다)
    {
      body: '#f3e6d0', shade: '#e2d0b4', light: '#fbf4e8', belly: '#fbf4e8', stripe: '#e2d0b4', outline: '#2a1a10', ear: '#5a3a26', nose: '#2a1a10', cheek: '#e8b0a8', eye: '#3f8fe0', lash: '#2a1a10',
      white: '#fffaf3', K: '#6a4630', A: '#d9a522',
      mask: (i, j) => (j <= 2 ? 'K' : (j === 6 || j === 7) && i >= 5 && i <= 9 ? 'K' : j === 5 && i >= 6 && i <= 8 ? 'K' : j >= 11 ? 'K' : null),
      tail: (j) => (j === 0 ? null : 'K'),
      mark(g, a, t) {
        if (this.accessories && this.accessories.length) return;
        const G = '#f2c14e', g2 = '#c98f12';
        for (let x = a.hx - 4; x <= a.hx + 4; x++) this.px(x, a.neck, (x + Math.floor(t * 3)) % 3 ? G : g2);
        this.pattern(['.D.', 'DdD', '.D.'], a.hx - 1, a.neck + 1, { D: '#bfe9ff', d: '#ffffff' });
        if (gPer(t, 3.5, 0.3)) this.pattern(['.W.', 'W.W', '.W.'], a.hx + 1, a.neck - 1, { W: '#ffffff' }, false);
      },
    },
  ];

  global.PetSprite = Object.assign(global.PetSprite || {}, {
    PetRenderer,
    GUEST_FURS,
    FURS, // 털색 17종 (옷장의 털색 고르기가 쓴다)
    GRID: G,
    GROUND,
    STAGE, // 도트 지도 자체. 디자인 시안 뷰어가 여기에 후보를 꽂아 본다
    STAGES: Object.keys(STAGE),
    EAR_KEYS: Object.keys(EARS), // 귀 모양 13가지 (옷장 · 첫 실행의 귀 고르기)
    CAT,
    PAL,
    FX, // 효과 종류. 시안 페이지가 새 효과를 여기에 더해 본다
    ACTION_LEN,
    util: { clamp, rand, seg, bump, ease, textWidth, drawText, stamp, dot, anchorsOf, TEAR, TONGUE, BLUSH, GROUND, G },
  });
  global.PetSprite.MOTIONS = global.PetSprite.MOTIONS || {};
  global.PetSprite.ACCESSORIES = global.PetSprite.ACCESSORIES || {};
})(window);

;if (window.PetSprite !== undefined) PetSprite = window.PetSprite; if (window.PetSound !== undefined) PetSound = window.PetSound; if (window.I18N !== undefined) I18N = window.I18N;
/* kit/motions.js */
// 모션. sprite.js 의 PetRenderer.play(key) 로 틀거나, 기분마다 계속 반복하게 걸어 둔다.
//  len               : 한 바퀴 길이(초). loop 이면 반복해도 자연스럽게 이어지는 모션
//  pose(p, k, at, r)  : 자세를 정한다. k = 0~1 진행도, at = 시작 후 초
//  back/mid/front(g, a, k, at, c) : 몸 뒤·앞발 밑·맨 앞에 소품을 그린다 (a = 기준점, c = 색)
//  step(r, k, at, dt, a, p)       : 효과를 뿌린다 (화면 좌표. 방향이 뒤집히면 r.scr 로 뒤집는다)
// 어느 상황에 쓰는지·상점 가격은 main/shop.js 의 MOTION_SLOTS / MOTIONS, 이름은 i18n.js 의 'motion.<key>'.
(function (root) {
  const { rand, seg, bump, ease, GROUND } = root.PetSprite.util;
  // 조건이 처음 참이 될 때 한 번만
  const once = (r, tag, cond) => {
    if (cond && !r.ms[tag]) { r.ms[tag] = true; return true; }
    return false;
  };
  // period 초마다 한 번씩
  const every = (r, tag, at, period) => {
    const n = Math.floor(at / period);
    if (r.ms[tag] !== n) { r.ms[tag] = n; return true; }
    return false;
  };
  const CONFETTI = ['#ff6f91', '#ffd35c', '#6fb0ea', '#78c46a', '#b784f5', '#ff9a3c'];
  // 소품 도트
  const SHADES = ['kkkkkkkkkkk', '.kkkk.kkkk.', '.kHkk.kHkk.', '..kk...kk..']; // 선글라스
  const CIG = ['WWWWWo']; // 담배 (끝이 빨갛게 탄다)
  const BOTTLE = ['.KK.', '.KK.', 'KNNK', 'KNWK', 'KNNK', 'KNNK', '.KK.']; // 초록 소주병
  const SHOT = ['KUK', 'KUK', '.K.']; // 소주잔
  const PAD = ['.KKKKK.', 'KDDDDDK', 'KDRDBDK', 'KDDDDDK', 'KK...KK']; // 게임패드
  const FISH = ['.KKKK.K.', 'KkBBBKBK', '.KKKK.K.']; // 모자에서 튀어나오는 생선

  // ---------- 4차 (상황별) 에서 쓰는 것 ----------
  const txt = (r, s, x, y, c, life = 0.8, vy = -4) => r.emit({ type: 'text', s, x, y, vy, life, c });
  // 노트북 앞에 앉아 일하는 기본 자세 (기분 '일하는 중'과 같은 높이)
  const desk = (p, fast) => { p.prop = 'laptop'; p.armL = p.armR = fast ? 'typefast' : 'type'; p.dy = -3; p.mouth = 'flat'; };
  const CROWN = ['.K.K.K.', 'KYKYKYK', 'KYYYYYK', 'KYRYBYK', 'KKKKKKK']; // 대관식 왕관
  const POPPER = ['...KK', '..KYK', '.KYRK', 'KRYK.', 'KKK..']; // 파티 폭죽
  const MONITOR = ['KKKKKKKKK', 'KBBBBBBBK', 'KBWWBBBBK', 'KBBBWWWBK', 'KBBBBBBBK', 'KKKKKKKKK', '....K....', '..KKKKK..'];
  const FISHDREAM = ['..KKKK.K.', '.KOOOOKOK', 'KOHOOOOOK', '.KOOOOKOK', '..KKKK.K.']; // 상상 속 음식들
  const STEAK = ['.KKKKKK.', 'KrRRRRrK', 'KRRWRRRK', 'KrRRRRrK', '.KKKKKK.'];
  const CAKE = ['...Y...', '..KRK..', '.KWWWK.', 'KPPPPPK', 'KWWWWWK', 'KKKKKKK'];

  // ---------- 5차 (2026-09-22) 에서 쓰는 것 ----------
  const MUG = ['KtttK.', 'KWWWKK', 'KWCWKK', 'KWWWK.', '.KKK..'];
  const PHONE = ['KKKK', 'KUUK', 'KUUK', 'KUUK', 'KKKK'];
  const CONF = CONFETTI;

  // ---------- 7차 다듬기 (2026-09-24) 에서 쓰는 것 ----------
  // 고양이에만 색을 덧칠한다. 효과 목록 맨 앞에 끼워서, 먼저 떠 있던 글자·연기·번개는 물들이지 않는다
  const tintUnder = (r, c, a, mode) => {
    const n = r.fx.length;
    r.emit({ type: 'tint', c, a, mode, perFrame: true, fade: false });
    if (r.fx.length > n) r.fx.unshift(r.fx.pop());
  };
  // 번쩍! 캔버스 전체(투명한 바탕화면 위의 흰 네모)가 아니라 고양이만 하얗게 번쩍인다. s = 0(시작)~1(끝)
  const flashCat = (r, s) => { if (s >= 0 && s < 1) tintUnder(r, '#ffffff', 0.9 * (1 - s)); };
  // 가느다란 김 한 가닥 (얼굴을 덮는 뭉게구름 대신 점 몇 개가 하늘하늘 올라간다)
  const steam = (r, x, y, c = 'rgba(255,255,255,0.75)', vx = 0) => r.emit({ type: 'spray', x: x + rand(-0.6, 0.6), y, vx: vx + rand(-1.6, 1.6), vy: -5, life: 1, c });
  // 오프스크린(고양이 그림)에서 이미 칠해진 도트에만 색을 얹는다 — 얼굴만 빨개질 때 (back/mid/front 안에서 this 로 부른다)
  function tintArea(x, y, w, h, c) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    ctx.restore();
  }
  // 몸에서 뻗어 나온 앞다리 하나 (어깨 → 발끝). 2칸 굵기에 외곽선, 끝에 동그란 발. back/mid/front 안에서 this 로 부른다
  function limb(g, x0, y0, x1, y1) {
    const O = g.c.outline, B = g.c.body;
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0)));
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push([Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n)]);
    // 어깨쪽 두 점은 몸 안이라 외곽선을 긋지 않는다 (몸통 외곽선이 열리며 다리가 이어져 나온다)
    pts.forEach(([x, y], i) => { if (i >= 2) for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) this.px(x + dx, y + dy, O); });
    for (const [x, y] of pts) { this.px(x, y, B); this.px(x + 1, y, B); this.px(x, y + 1, B); this.px(x + 1, y + 1, B); }
    this.pattern(['.OO.', 'OBBO', 'OBBO', '.OO.'], Math.round(x1) - 1, Math.round(y1) - 1, { O, B });
  }
  root.PetSprite.motionFx = { tintUnder, flashCat, steam, tintArea, limb }; // 뒤쪽 묶음(세트 전용·6차)도 같이 쓴다

  // ---------- 디자인 개선 (2026-10-10) 에서 쓰는 것 ----------
  const INK = '#2b1a10';
  // 캔버스에 바로 찍는 그림 · 점 (이번 프레임에만)
  const spr = (r, rows, x, y, map) => r.emit({ type: 'sprite', rows, x: Math.round(x), y: Math.round(y), map, perFrame: true, fade: false });
  const dot = (r, x, y, c) => r.emit({ type: 'spray', x: Math.round(x), y: Math.round(y), c, perFrame: true, fade: false });
  const mirror = (rows) => rows.map((s) => s.split('').reverse().join(''));
  // 천천히 깜빡: 눈 감는 박자 (뜸 → 반쯤 → 꼬옥 → 반쯤 → 반짝) · 말풍선 속 큰 눈
  const blinkEyes = (k) => (k < 0.12 ? 'open' : k < 0.26 ? 'half' : k < 0.68 ? 'closed' : k < 0.8 ? 'half' : 'sparkle');
  const BIG_EYE = { open: ['.KK.', 'KWKK', 'KKKK', '.KK.'], half: ['....', 'KKKK', 'KWKK', '.KK.'], closed: ['....', '....', 'K..K', '.KK.'], sparkle: ['.KK.', 'KWKK', 'KKWK', '.KK.'] };
  // 털 윤기 반짝: 반짝이 (작게 → 크게 → 중간 → 사라짐, 0.4초)
  const TW = [
    ['.Y.', 'YHY', '.Y.'],
    ['..Y..', '..Y..', 'YYHYY', '..Y..', '..Y..'],
    ['...Y...', '...Y...', '..YHY..', 'YYHHHYY', '..YHY..', '...Y...', '...Y...'],
  ];
  const TWM = { Y: '#ffd35c', H: '#ffffff' };
  const twinkle = (r, x, y, age) => {
    if (age < 0 || age > 0.4) return;
    const rows = TW[age < 0.07 ? 0 : age < 0.24 ? 2 : age < 0.33 ? 1 : 0];
    spr(r, rows, x - (rows[0].length >> 1), y - (rows.length >> 1), TWM);
  };
  // 뜨개질: 털실 뭉치 (큰·중간·작은) · 대바늘 두 개 (X 자, L = 길이 반쯤) · 처지는 실 · 목도리 줄무늬
  const BALL = [
    ['..KKKKK..', '.KPPpPPK.', 'KPpPPPpPK', 'KPPPpPPPK', 'KpPPPPPpK', 'KPPpPPPPK', 'KPPPPpPPK', '.KPpPPPK.', '..KKKKK..'],
    ['.KKKKK.', 'KPpPPpK', 'KPPpPPK', 'KpPPPpK', 'KPPpPPK', 'KPpPPPK', '.KKKKK.'],
    ['.KKK.', 'KPpPK', 'KpPPK', 'KPPpK', '.KKK.'],
  ];
  const yarnBall = function (c, cx, by, size, roll) {
    const rows = roll ? mirror(BALL[size]) : BALL[size];
    this.pattern(rows, cx - (rows[0].length >> 1), by - rows.length + 1, c);
    return by - rows.length + 1;
  };
  const needles = function (cx, y, click, L = 4) {
    const needle = (x0, y0, x1, y1) => {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let i = 0; i <= n; i++) {
        const x = Math.round(x0 + ((x1 - x0) * i) / n), yy = Math.round(y0 + ((y1 - y0) * i) / n);
        this.px(x, yy, i >= n - 1 ? '#ffd65a' : '#dfe5ec');
        if (i < n - 1) this.px(x, yy + 1, '#8f95a0');
      }
    };
    if (click) { needle(cx + L, y + 5, cx - L, y + 1); needle(cx - L, y + 5, cx + L, y); }
    else { needle(cx - L, y + 5, cx + L, y + 1); needle(cx + L, y + 5, cx - L, y); }
  };
  const thread = function (x0, y0, x1, y1, sag = 3) {
    const n = Math.max(6, Math.round(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 1; i < n; i++) { const t = i / n; this.px(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * sag), '#ff9bb8', false); }
  };
  const SCARF_STRIPE = (c, i) => [c.P, c.P, c.W][i % 3];
  // 종이비행기 (큰·중간·작은). dir = 화면에서 날아가는 쪽 (1 오른쪽)
  const PLANE = ['K........', 'KWKK.....', 'KWWWKK...', 'KWWWWWKKK', 'KwwwKK...', 'KwwKK....', 'KKK......'];
  const PLANE_M = ['K....', 'KWKK.', 'KWWWK', 'KwKK.', 'KK...'];
  const PLANE_S = ['KK.', 'KwK'];
  const PM = { K: INK, W: '#ffffff', w: '#bcd0e6' };
  const planeAt = (r, rows, x, y, dir) => {
    // dir = 화면에서 날아가는 쪽 (1 오른쪽)
    const R = dir < 0 ? mirror(rows) : rows;
    spr(r, R, Math.round(x) - (R[0].length >> 1), Math.round(y) - (R.length >> 1), PM);
  };
  // 영혼 가출: 분신 높이 (0 = 몸, 1 = 꼭대기). 빠져나감 → 둥실 → 쏙 돌아옴
  const soulUp = (k) => (k < 0.14 ? 0 : k < 0.46 ? ease(seg(k, 0.14, 0.46)) : k < 0.78 ? 1 : 1 - ease(seg(k, 0.78, 0.84)));
  const soulPose = (p, k) => {
    if (k < 0.14) { p.eyes = 'half'; p.mouth = 'o'; return; }
    if (k < 0.84) { p.eyes = 'dot'; p.mouth = 'o'; p.ear = -1; p.tail = 'slow'; p.xf = { sy: 0.88, sx: 1.06 }; p.dy = 1; return; }
    p.eyes = 'wide'; p.mouth = 'o'; p.ear = 1; p.dy = k < 0.88 ? -2 : 0;
  };
  // 뿡: 초록 연기 색 · 로켓 높이
  const GREEN = '#8fae4a', GREEN_L = '#c4dc7a';
  const rocketH = (k) => (k < 0.3 || k > 0.6 ? 0 : k < 0.42 ? 11 * (1 - (1 - seg(k, 0.3, 0.42)) ** 2) : 11 * (1 - seg(k, 0.42, 0.6) ** 2));

  const M = {
    stretch: {
      // 기지개 — 앞발을 쭉 내밀며 상체를 낮추고(엉덩이·꼬리는 번쩍) 쩌억 하품, 이번엔 몸을 위로 쭉 늘인 뒤
      // 부르르 털고 개운한 얼굴 (7차: 납작하게 눌리기만 하던 걸 앞으로 → 위로 두 번 늘이는 기지개로)
      len: 3.8,
      pose(p, k, at) {
        const lo = ease(bump(k, 0.06, 0.48)); // 앞으로 쭉 (상체를 낮춘다)
        const hi = ease(bump(k, 0.46, 0.68)); // 위로 쭉
        p.xf = { sx: 1 + 0.2 * lo - 0.06 * hi, sy: 1 - 0.14 * lo + 0.1 * hi };
        if (lo > 0.2) {
          p.armL = p.armR = 'front'; p.tail = 'up'; p.ear = -1; p.lookY = 1;
          p.eyes = lo > 0.75 ? 'closed' : 'squint';
          if (lo > 0.8) p.mouth = 'big'; // 쩌억 하품
          else if (lo > 0.5) p.mouth = 'o';
        }
        if (hi > 0.2) { p.eyes = 'closed'; p.mouth = 'flat'; p.tail = 'up'; p.ear = -1; p.lookY = -1; }
        if (k > 0.7 && k < 0.84) {
          // 부르르 — 머리부터 꼬리까지 털고 귀가 파닥
          const d = 1 - seg(k, 0.7, 0.84);
          p.xf = { ox: Math.round(Math.sin(at * 50) * 1.4 * d) };
          p.eyes = 'closed'; p.ear = Math.floor(at * 16) % 2 ? 1 : -1; p.tail = 'flick';
        }
        if (k >= 0.84) { p.eyes = 'happy'; p.mouth = 'smile'; p.tail = 'wag'; }
      },
      step(r, k, at, dt, a) {
        if (once(r, 'y', k > 0.3)) txt(r, 'YAWN', r.scr(a.hx + 5), a.top - 6, '#fff', 0.9, -3);
        if (once(r, 's', k > 0.86)) r.emit({ type: 'spark', x: r.scr(a.hx + 8), y: a.top - 2, life: 0.6 });
      },
    },
    loaf: {
      // 식빵 굽기 — 앞발을 몸 밑에 넣고 식빵 자세. 등에서 김이 모락모락(구워지는 중)
      len: 4, loop: true,
      pose(p, k, at) {
        p.curl = true;
        p.eyes = Math.floor(at * 0.7) % 2 ? 'half' : 'happy';
        // 바닥에서 뜨지 않고 등만 부풀었다 가라앉는다 (빵이 부푸는 것처럼)
        p.sy = Math.sin(at * 1.6) > 0.3 ? 1.02 : 1;
        p.tail = 'slow';
      },
      step(r, k, at, dt, a) {
        // 갓 구운 빵 김: 등 위에서 가느다랗게 모락모락
        if (every(r, 'steam', at, 0.22)) steam(r, r.scr(a.hx + [-3, 0, 3][Math.floor(at / 0.22) % 3]), a.top - 1, 'rgba(255,255,255,0.8)');
      },
    },
    nodoff: {
      // 꾸벅꾸벅 — 조는 중… 고개가 스르르 떨어지다가 화들짝!
      len: 4.2, loop: true,
      pose(p, k) {
        if (k < 0.6) {
          const s = seg(k, 0, 0.6);
          // 고개가 스르르 — 시선이 먼저 떨어지고, 몸이 조금씩 가라앉는다
          const e = ease(s);
          p.eyes = s < 0.3 ? 'half' : 'closed';
          p.lookY = s > 0.35 ? 1 : 0;
          p.dy = s > 0.55 ? 1 : 0;
          p.xf = { sy: 1 - e * 0.08, sx: 1 + e * 0.03 };
          p.ear = s > 0.2 ? -1 : 0;
          p.mouth = 'flat';
          p.tail = 'slow';
        } else if (k < 0.7) { p.dy = k < 0.64 ? -2 : -1; p.eyes = 'wide'; p.ear = 1; p.mouth = 'o'; p.tail = 'up'; }
        else { p.eyes = k < 0.8 ? 'open' : 'half'; p.mouth = 'flat'; p.lookX = k < 0.8 ? (k < 0.75 ? -1 : 1) : 0; p.tail = 'slow'; }
      },
      step(r, k, at, dt, a) {
        if (k < 0.55 && every(r, 'z', at, 1.1)) r.emit({ type: 'text', s: 'Z', x: r.scr(a.hx + 6), y: a.top - 6, vy: -4, vx: 2, life: 1.2, c: '#9aa6ff' });
        if (once(r, 'jolt', k > 0.6)) r.emit({ type: 'text', s: '!', x: r.scr(a.hx + 6), y: a.top - 8, vy: -4, life: 0.8, c: '#ffd35c' });
      },
    },
    lick: {
      // 발 핥고 세수 — 앞발을 날름날름 핥은 다음 그 발로 얼굴을 쓱쓱
      len: 3.4, loop: true,
      pose(p, k, at, r) {
        if (k < 0.55) { p.armR = 'lick'; p.mouth = Math.floor(at * 8) % 2 ? 'lick' : 'smile'; p.eyes = 'closed'; }
        else { p.armR = 'groom'; p.eyes = Math.floor(at * 2) % 2 ? 'happy' : 'closed'; p.mouth = 'flat'; }
        p.tail = 'slow';
      },
    },
    bath: {
      // 거품 목욕 — 욕조에 몸 담그고 머리엔 거품, 옆엔 고무 오리
      len: 4.4, loop: true,
      pose(p) { p.dy = 3; p.eyes = 'happy'; p.blush = true; p.noTail = true; },
      back(g, a) {
        for (let x = a.hx - 11; x <= a.hx + 11; x++) this.px(x, 41, x === a.hx - 11 || x === a.hx + 11 ? g.c.outline : '#e8f2fa');
      },
      front(g, a, k, at, c) {
        const L = a.hx - 11;
        this.pattern(
          ['KKKKKKKKKKKKKKKKKKKKKKK', 'KWWWWWWWWWWWWWWWWWWWWWK', 'KWWWWWWWWWWWWWWWWWWWWWK', 'KBBBBBBBBBBBBBBBBBBBBBK', 'KWWWWWWWWWWWWWWWWWWWWWK', '.KKKKKKKKKKKKKKKKKKKKK.', '..KK...............KK..'],
          L, 42, c,
        );
        [[-9, 41], [-7, 40], [-4, 41], [5, 41], [8, 40]].forEach(([dx, y]) => this.ellipse(a.hx + dx, y, 1.3, 1.1, '#fff', '#cfe3f2'));
        this.ellipse(a.hx, a.top - 1, 2.6, 1.4, '#fff', '#cfe3f2');
        this.ellipse(a.hx - 2, a.top - 2, 1.4, 1.2, '#fff', '#cfe3f2');
        const bob = Math.round(Math.sin(at * 3));
        this.pattern(['.KK..', 'KYYK.', 'KYYYOK'.slice(0, 5), '.KKK.'], a.hx + 7, 38 + bob, c);
      },
      step(r, k, at, dt, a) {
        if (every(r, 'bb', at, 0.4)) r.emit({ type: 'bubble', x: r.scr(a.hx + rand(-9, 9)), y: 40, vy: -8, r: rand(0.8, 1.6), life: 1.3 });
      },
    },

    zoomies: {
      // 우다다 — 갑자기 미친 듯이 왔다 갔다. 먼지 폴폴, 귀는 뒤로 착
      len: 2.6,
      pose(p, k, at, r) {
        const pass = Math.min(2, Math.floor(k * 3));
        const ph = k * 3 - pass;
        const dir = pass % 2 === 0 ? 1 : -1;
        r.setFacing(k > 0.98 ? 1 : dir);
        p.xf = { ox: dir > 0 ? -14 + ph * 28 : 14 - ph * 28 };
        if (k > 0.98) p.xf.ox = 0;
        p.step = (at * 5) % 1;
        p.eyes = 'wide';
        p.mouth = 'o';
        p.ear = -1;
        p.tail = 'up';
        p.dy = Math.floor(at * 10) % 2 ? -1 : 0;
      },
      step(r, k, at, dt, a, p) {
        const ox = p.xf ? p.xf.ox || 0 : 0;
        if (every(r, 'dust', at, 0.07)) r.emit({ type: 'dust', x: 24 + ox - r.facing * 8, y: GROUND, vx: -r.facing * 6, vy: -3, life: 0.5 });
        if (every(r, 'ln', at, 0.09)) r.emit({ type: 'line', x: 24 + ox - r.facing * 11 - (r.facing > 0 ? 4 : 0), y: 34 + Math.floor(rand(0, 8)), len: 4, life: 0.22 });
      },
    },
    box: {
      // 박스 들어가기 — 상자만 보면 일단 들어간다. 눈만 빼꼼
      len: 4, reveal: 0.4, loop: true,
      pose(p, k, at) {
        if (k < 0.12) { p.eyes = 'wide'; p.ear = 1; }
        else if (k < 0.3) {
          const s = seg(k, 0.12, 0.3);
          p.dy = Math.round(-7 * Math.sin(s * Math.PI) + s * 3);
          p.eyes = 'wide';
          p.armL = p.armR = 'up';
        } else { p.dy = 3; p.eyes = Math.floor(at * 0.8) % 3 === 0 ? 'happy' : 'open'; p.ear = 1; p.noTail = true; }
      },
      back(g, a, k, at, c) {
        for (let y = 40; y <= 42; y++) for (let x = a.hx - 8; x <= a.hx + 8; x++) this.px(x, y, x === a.hx - 8 || x === a.hx + 8 ? c.K : c.t);
        this.pattern(['KKKK...', '.KTTKK.', '..KKTTK'], a.hx - 11, 39, c);
        this.pattern(['...KKKK', '.KKTTK.', 'KTTKK..'], a.hx + 5, 39, c);
      },
      front(g, a, k, at, c) {
        this.pattern(['KKKKKKKKKKKKKKKKK', 'KTTTTTTYYTTTTTTTK', 'KTTTTTTYYTTTTTTTK', 'KTTtTTTTTTTTTtTTK', 'KKKKKKKKKKKKKKKKK'], a.hx - 8, 42, c);
      },
    },
    coffee: {
      // 커피 한 잔 — 두 발로 머그를 쥐고 호로록… 하아, 볼이 발그레
      len: 4.4, loop: true,
      pose(p, k, at, r) {
        p.armL = p.armR = 'hold';
        if (k < 0.4) p.eyes = r.blinkAt(at) ? 'blink' : 'open';
        else if (k < 0.66) { p.eyes = 'closed'; p.mouth = 'none'; }
        else { p.eyes = 'happy'; p.blush = true; }
      },
      mid(g, a, k, at, c) {
        const lift = k >= 0.4 && k < 0.66 ? -3 : 0;
        this.pattern(['KtttK.', 'KWWWKK', 'KWCWKK', 'KWWWK.', '.KKK..'], a.hx - 2, a.my + 1 + lift, c);
      },
      step(r, k, at, dt, a) {
        // 김은 잔에서 가늘게. 마시는 동안(잔이 입에 붙어 있을 때)은 쉰다 — 얼굴을 덮지 않게
        const sip = k >= 0.4 && k < 0.66;
        if (!sip && every(r, 'st', at, 0.16)) steam(r, r.scr(a.hx + 3), a.my + 1, undefined, r.facing * 5); // 볼 옆으로 비껴 올라간다
        if (once(r, 'ha', k > 0.68)) r.emit({ type: 'puff', x: r.scr(a.fx + 5), y: a.my, vx: r.facing * 8, vy: -2, life: 0.9, c: 'rgba(255,255,255,0.7)' });
      },
    },
    cafe: {
      // 커피 한 잔의 여유 — 작은 카페 탁자에 앉아 김 오르는 잔을 들고 호로록… 후우 한숨 쉬고
      // 잔을 내려놓은 뒤 등을 기대 눈을 감는다. 머리 위로 낙엽이 팔랑
      len: 8, loop: true,
      pose(p, k, at, r) {
        p.tail = 'slow';
        if (k < 0.14) {
          p.lookX = 1;
          p.eyes = r.blinkAt(at) ? 'blink' : 'open';
        } else if (k < 0.5) {
          p.armL = p.armR = 'hold';
          const sip = k > 0.2 && k < 0.36;
          p.eyes = sip ? 'closed' : k < 0.2 ? 'half' : 'happy';
          p.mouth = sip ? 'none' : k > 0.36 && k < 0.44 ? 'o' : 'smile';
          p.blush = k >= 0.36;
        } else if (k < 0.58) {
          p.lookX = 1;
          p.eyes = 'happy';
          p.blush = true;
        } else {
          p.xf = { rot: -0.07 * r.facing, py: 44 };
          p.eyes = Math.floor(at * 0.6) % 3 === 0 ? 'half' : 'closed';
          p.blush = true;
          p.ear = -1;
        }
      },
      back(g, a, k, at, c) {
        // 대리석 윗판에 나무 다리 하나짜리 카페 탁자
        const x = a.hx + 9;
        this.pattern(
          ['.KKKKKKKKK.', 'KWWWWWWWwwK', '.KKKKKKKKK.', '....KTK....', '....KTK....', '....KTK....', '....KtK....', '....KtK....', '..KKKtKKK..', '.KtttttttK.'],
          x, 35, c,
        );
        // 탁자 위 크루아상
        this.pattern(['.KKK.', 'KOoOK', '.KKK.'], x + 6, 32, c);
        // 잔을 들고 있지 않을 때는 받침 위에 놓여 있다
        if (k < 0.14 || k >= 0.5) {
          this.pattern(['KtttK.', 'KWWWKK', 'KWCWKK', 'KWWWK.'], x + 1, 30, c);
          this.pattern(['KwwwwwK'], x, 34, c);
        } else this.pattern(['KwwwwwK'], x, 34, c);
      },
      mid(g, a, k, at, c) {
        if (k < 0.14 || k >= 0.5) return;
        const lift = k > 0.2 && k < 0.36 ? -3 : 0;
        this.pattern(['KtttK.', 'KWWWKK', 'KWCWKK', 'KWWWK.', '.KKK..'], a.hx - 2, a.my + 1 + lift, c);
      },
      step(r, k, at, dt, a) {
        const held = k >= 0.14 && k < 0.5;
        const sip = k > 0.2 && k < 0.36;
        // 김은 가늘게. 들고 있을 땐 볼 옆으로 비껴 오르고, 마시는 동안은 쉰다
        if (!sip && every(r, 'st', at, 0.18)) steam(r, r.scr(held ? a.hx + 3 : a.hx + 12), held ? a.my + 1 : 29, undefined, held ? r.facing * 5 : 0);
        // 후우 — 한숨과 함께 작은 하트
        if (once(r, 'sigh', k > 0.37)) {
          r.emit({ type: 'puff', x: r.scr(a.fx + 5), y: a.my - 1, vx: r.facing * 9, vy: -3, life: 1.3, c: 'rgba(255,255,255,0.9)' });
          r.emit({ type: 'heart', x: r.scr(a.fx + 7), y: a.my - 5, vx: r.facing * 5, vy: -7, life: 1.4 });
        }
        if (k > 0.58 && every(r, 'n', at, 1.4)) r.emit({ type: 'note', x: r.scr(a.hx - 10), y: a.top - 2, vy: -4, vx: -2, life: 1.4, c: '#c48b56' });
        if (every(r, 'leaf', at, 1.7)) r.emit({ type: 'confetti', x: r.scr(a.hx + rand(-14, 16)), y: 2, vx: rand(-5, -1), vy: 7, life: 4.5, c: rand(0, 1) < 0.5 ? '#e8923c' : '#d9a21f' });
      },
    },
    monitors: {
      // 모니터 세 대 — 뒤에 모니터 세 대를 띄워 놓고 왼쪽·가운데·오른쪽을 번갈아 보며 타자. 화면마다 글이 올라간다
      len: 3.6, loop: true,
      pose(p, k) {
        desk(p);
        p.lookX = k < 0.33 ? -1 : k < 0.66 ? 0 : 1;
        p.lookY = k >= 0.33 && k < 0.66 ? -1 : 0;
      },
      back(g, a, k, at, c) {
        const scroll = Math.floor(at * 3) % 3;
        for (const [dx, y] of [[-20, 24], [-4, 18], [12, 24]]) {
          const rows = MONITOR.map((r, j) => (j >= 2 && j <= 4 ? MONITOR[2 + ((j - 2 + scroll) % 3)] : r));
          this.pattern(rows, a.hx + dx, y, c);
        }
      },
    },

    papers: {
      // 서류 산더미 — 양옆으로 서류가 점점 쌓여 산더미. 식은땀 흘리며 타자 치는데 맨 위 종이가 팔랑 날아간다
      len: 4.2, loop: true,
      pose(p) { desk(p, true); p.sweat = true; p.eyes = 'dot'; },
      back(g, a, k, at, c) {
        const n = 3 + Math.floor(k * 8);
        for (const [dx, m] of [[-17, 0], [10, 2]]) {
          const h = Math.max(2, n - m);
          for (let i = 0; i < h; i++) this.pattern([i % 2 ? 'KwwwwwK' : 'KWWWWWK'], a.hx + dx + (i % 4 === 1 ? 1 : 0), GROUND - i, c);
        }
      },
      step(r, k, at, dt, a) {
        if (every(r, 'p', at, 1.1)) r.emit({ type: 'sprite', rows: ['WWW', 'www'], map: { W: '#fffaf3', w: '#d6cfc4' }, x: r.scr(a.hx + 12), y: GROUND - 10, vx: rand(4, 12) * r.facing, vy: -10, ay: 8, life: 1.6 });
      },
    },

    aura: {
      // 초사이언 코딩 — 한계를 넘었다. 금빛 오라가 활활, 번개가 튀고, 눈에 불을 켠 채 신의 속도로 타자
      len: 2.6, loop: true,
      pose(p, k, at) { desk(p, true); p.eyes = 'wide'; p.brow = 'angry'; p.ear = 1; p.tail = 'up'; p.dy = -3 + (Math.floor(at * 16) % 2 ? -1 : 0); },
      back(g, a, k, at) {
        for (let x = a.hx - 11; x <= a.hx + 11; x++) {
          const h = Math.max(0, Math.round(26 - Math.abs(x - a.hx) * 1.6 + Math.sin(at * 16 + x * 2.1) * 2.5));
          for (let i = 0; i < h; i++) {
            const f = i / h;
            this.px(x, GROUND - i, f > 0.8 ? '#fffbd0' : f > 0.45 ? '#ffe45c' : '#ffc21a', false);
          }
        }
      },
      step(r, k, at, dt, a) {
        if (every(r, 's', at, 0.1)) r.emit({ type: 'spark', x: r.scr(a.hx + rand(-12, 12)), y: a.top + rand(-8, 10), life: 0.3, c: '#fff6a0' });
        if (every(r, 'b', at, 0.5)) r.emit({ type: 'vline', x: r.scr(a.hx + (Math.random() < 0.5 ? -13 : 13)), y: a.top + rand(0, 8), len: 5, life: 0.15, c: '#fff6a0' });
      },
    },

    tapfoot: {
      // 발 동동 시계 보기 — 머리 위 시계가 째깍째깍. 발을 동동 구르며 곁눈질, 꼬리는 탁탁
      // (7차: 몸 전체가 통통 튀던 걸, 몸은 가만히 있고 발만 톡톡 구르게)
      len: 3, loop: true,
      pose(p, k, at) {
        const b = at % 0.75;
        p.step = b < 0.1 || (b > 0.2 && b < 0.3) ? 0.25 : 0; // 톡-톡, 쉬고 (바깥 두 발을 들었다 내린다)
        p.mouth = 'flat'; p.tail = 'flick';
        if (k < 0.45) { p.eyes = 'side'; p.sideDir = 1; p.lookY = -1; } // 시계를 곁눈질
        else if (k < 0.58) { p.eyes = 'half'; p.mouth = 'wavy'; p.ear = -1; } // 하아…
        else p.brow = 'sad'; // 빨리 좀… (눈은 평소처럼 깜빡)
      },
      front(g, a, k, at, c) {
        const cx = a.hx + 9;
        const cy = a.top - 6;
        this.ellipse(cx, cy, 3.6, 3.6, '#fffaf3', c.K);
        // 초침이 째깍째깍 한 칸씩 뛴다 (0.5초마다 30도). 시침은 3시 방향
        const ang = Math.floor(at * 2) * (Math.PI / 6);
        this.px(cx, cy, c.K);
        this.px(cx + 1, cy, c.K);
        for (const d of [1, 2]) this.px(Math.round(cx + Math.sin(ang) * d), Math.round(cy - Math.cos(ang) * d), '#e8534a');
        this.px(cx, cy - 1, c.K);
        // 시계가 째깍할 때마다 살짝 들썩
        if (Math.floor(at * 2) % 2 === 0 && (at * 2) % 1 < 0.15) { this.px(cx - 4, cy - 3, c.K); this.px(cx + 4, cy - 3, c.K); }
      },
      step(r, k, at, dt, a) {
        // 발이 바닥에 닿을 때마다 먼지 톡
        const b = at % 0.75;
        const n = Math.floor(at / 0.75) * 2 + (b > 0.2 ? 1 : 0);
        if ((b >= 0.1 && b < 0.2) || b >= 0.3) if (once(r, 'd' + n, true)) for (const s of [-1, 1]) r.emit({ type: 'dust', x: r.scr(a.hx + s * 5), y: GROUND, vx: s * 4, life: 0.3 });
      },
    },

    blanket: {
      // 이불 덮고 쿨쿨 — 나무 침대에 베개 베고 알록달록 이불을 턱밑까지 덮고 새근새근. 숨 쉴 때마다 이불이 오르락내리락
      // (7차: 베개가 머리 양옆 날개처럼 보여서, 침대 머리판을 세우고 이불을 침대 폭만큼 넓혔다)
      len: 4, loop: true,
      pose(p, k, at) {
        p.eyes = 'closed'; p.mouth = 'flat'; p.ear = -1; p.dy = 1; p.noTail = true; p.clipY = 46; p.noShadow = true;
        if (k > 0.55 && k < 0.62) p.ear = 0; // 꿈결에 귀 한 번 씰룩
      },
      back(g, a, k, at, c) {
        // 침대 머리판: 둥근 윗변에 나뭇결, 양 끝에 기둥과 동그란 손잡이. 치즈색 털과 섞이지 않게 짙은 호두나무색
        const x0 = a.hx - 12, top = a.earTop - 3, W = 25;
        const WD = '#6b4428', wd = '#553520', wk = '#2b1a10';
        for (let y = top; y <= GROUND; y++) for (let x = x0; x < x0 + W; x++) {
          const i = x - x0, j = y - top;
          if (j === 0 && (i < 2 || i > W - 3)) continue;
          if (j === 1 && (i === 0 || i === W - 1)) continue;
          const edge = j === 0 || i === 0 || i === W - 1 || (j === 1 && (i === 1 || i === W - 2));
          this.px(x, y, edge ? wk : i % 5 === 2 ? wd : WD);
        }
        for (const x of [x0 - 1, x0 + W]) {
          for (let y = top - 1; y <= GROUND + 1; y++) this.px(x, y, y === top - 1 ? wk : wd);
          this.pattern(['KK', 'tt', 'KK'], x - (x < a.hx ? 1 : 0), top - 3, { K: wk, t: '#c48b56' });
        }
        // 베개 (머리판 폭에 가깝게 넓적하게)
        this.pattern(['.KKKKKKKKKKKKKKKKKKKKK.', 'KWWWWWWWWWWWWWWWWWWWWWK', 'KWWWWWWWWWWWWWWWWWWWWwK', 'KwwwwwwwwwwwwwwwwwwwwwK', '.KKKKKKKKKKKKKKKKKKKKK.'], a.hx - 11, a.ey - 2, c);
      },
      front(g, a, k, at, c) {
        // 숨 쉴 때마다 이불 윗단이 한 칸 오르락내리락 (들숨이 짧고 날숨이 길다)
        const b = Math.sin(at * 1.6) > 0.3 ? -1 : 0;
        const y0 = a.my + 2 + b;
        const W = 25;
        for (let y = y0; y <= GROUND + 2; y++) {
          const j = y - y0;
          let row = '';
          for (let i = 0; i < W; i++) {
            if (i === 0 || i === W - 1 || j === 0) row += 'K';
            else if (j === 1) row += i === W - 2 ? 'w' : 'W'; // 접어 내린 흰 홑청
            else row += (Math.floor(i / 2) + j) % 2 ? 'P' : 'Q'; // 체크무늬 이불
          }
          this.pattern([row], a.hx - 12, y, c);
        }
      },
      step(r, k, at, dt, a) {
        if (every(r, 'z', at, 1.3)) txt(r, 'Z', r.scr(a.hx + 8), a.top - 4, '#9aa6ff', 1.3);
      },
    },

    grumpy: {
      // 짜증 팍 — 귀를 뒤로 착 눕히고 털을 부풀린다. 이마에 빠직 마크, "HISS" 하고 앞발로 휙
      len: 2.4,
      pose(p, k, at) {
        p.ear = -1; p.brow = 'angry'; p.eyes = 'squint'; p.mouth = 'frown'; p.tail = 'flick';
        p.xf = { sx: 1.1, sy: 1.05, ox: k < 0.15 ? Math.sin(at * 50) : 0 };
        if (k > 0.5 && k < 0.65) { p.armR = 'out'; p.mouth = 'big'; }
      },
      step(r, k, at, dt, a) {
        const pulse = Math.floor(at * 5) % 2;
        r.emit({ type: 'sprite', rows: pulse ? ['.R.R.', 'RR.RR', '.....', 'RR.RR', '.R.R.'] : ['R...R', '.R.R.', '.....', '.R.R.', 'R...R'], map: { R: '#e8534a' }, x: r.scr(a.hx + 5) - 2, y: a.top - 4, perFrame: true, fade: false });
        if (once(r, 'h', k > 0.5)) { txt(r, 'HISS', r.scr(a.hx + 6), a.top - 9, '#ff9a9a', 0.8); r.emit({ type: 'line', x: r.scr(a.hx + 11), y: a.ey + 1, len: 5, life: 0.2 }); }
      },
    },


    startle: {
      // 화들짝 — 건드리자마자 털이 쭈뼛 서며 공중으로 펄쩍! 착지하고도 눈이 콩알만 해서 두리번
      len: 2.2,
      pose(p, k) {
        if (k < 0.1) { p.eyes = 'open'; return; }
        if (k < 0.45) {
          const s = seg(k, 0.1, 0.45);
          p.dy = Math.round(-11 * Math.sin(s * Math.PI));
          p.eyes = 'wide'; p.mouth = 'o'; p.ear = 1; p.armL = p.armR = 'up'; p.tail = 'up';
          p.xf = { sy: 1.15, sx: 0.92 };
          p.spiky = true;
        } else if (k < 0.55) { p.xf = { sx: 1.15, sy: 0.85 }; p.eyes = 'dot'; }
        else { p.eyes = 'dot'; p.lookX = k < 0.75 ? -1 : 1; p.sweat = true; p.mouth = 'flat'; }
      },
      front(g, a) {
        if (!this._p || !this._p.spiky) return;
        const O = g.c.outline;
        for (let y = a.top + 2; y < a.cy + 5; y += 3) { this.px(a.left - 2, y, O); this.px(a.left - 3, y - 1, O); this.px(a.right + 2, y, O); this.px(a.right + 3, y - 1, O); }
      },
      step(r, k, at, dt, a) {
        if (once(r, '!', k > 0.1)) { txt(r, '!!', r.scr(a.hx + 6), a.top - 12, '#ffd35c', 1); r.emit({ type: 'shock', x: r.scr(a.hx), y: a.cy, r: 8, life: 0.25 }); }
      },
    },

    melt: {
      // 녹아내리기 — 너무 좋아서 녹는다… 몸이 치즈처럼 바닥으로 주르륵 퍼졌다가, 뿅 하고 다시 모인다
      len: 3.4, reveal: 0.7,
      pose(p, k) {
        p.blush = true; p.eyes = 'happy'; p.mouth = 'wavy'; p.tail = 'slow';
        let s;
        if (k < 0.15) s = 0;
        else if (k < 0.55) s = ease(seg(k, 0.15, 0.55));
        else if (k < 0.8) s = 1;
        else { const q = seg(k, 0.8, 1); s = 1 - q; if (q > 0.6) { p.eyes = 'open'; p.mouth = 'smile'; } }
        p.xf = { sy: 1 - 0.55 * s, sx: 1 + 0.55 * s };
        if (s > 0.8) p.ear = -1;
      },
      step(r, k, at, dt, a) {
        if (k > 0.3 && k < 0.8 && every(r, 'd', at, 0.18)) r.emit({ type: 'drop', x: r.scr(24 + (Math.random() < 0.5 ? -12 : 12)), y: GROUND - 1, vy: 2, life: 0.6, c: '#f4a859' });
        if (every(r, 'h', at, 0.6)) r.emit({ type: 'heart', x: r.scr(24 + rand(-8, 8)), y: 30, vy: -5, life: 1 });
        if (once(r, 'b', k > 0.95)) txt(r, 'POP', r.scr(30), 20, '#fff', 0.5);
      },
    },

    popper: {
      // 폭죽 팡 — 파티 폭죽을 하늘로 겨누고… 팡! 색종이가 우르르 쏟아지고 만세 점프
      len: 2.6,
      pose(p, k) {
        if (k < 0.3) { p.armR = 'hold'; p.eyes = 'squint'; p.mouth = 'flat'; p.ear = -1; }
        else { const s = seg(k, 0.3, 0.7); p.dy = Math.round(-6 * Math.sin(s * Math.PI)); p.armL = p.armR = 'cheer'; p.eyes = 'happy'; p.mouth = 'open'; p.ear = 1; p.tail = 'up'; }
      },
      mid(g, a, k, at, c) { if (k < 0.45) this.pattern(POPPER, a.hx + 4, a.my - 3, c); },
      step(r, k, at, dt, a) {
        if (once(r, 'p', k > 0.3)) {
          txt(r, 'PANG!', r.scr(a.hx + 2), a.top - 12, '#ffd35c', 0.9);
          for (let i = 0; i < 40; i++) r.emit({ type: 'confetti', x: r.scr(a.hx + 7), y: a.top - 2, vx: rand(-30, 30), vy: rand(-40, -12), ay: 45, life: rand(1.2, 2), c: CONFETTI[i % 6] });
        }
      },
    },

    coronation: {
      // 대관식 — 하늘에서 왕관이 반짝이며 스르르 내려와 머리 위에 착. 나팔 소리에 맞춰 가슴을 쭉 편다
      len: 3.4, reveal: 0.52,
      pose(p, k) {
        if (k < 0.5) { p.lookY = -1; p.eyes = 'sparkle'; p.mouth = 'o'; p.ear = 1; }
        else { p.eyes = 'closed'; p.mouth = 'smile'; p.xf = { sy: 1.06 }; p.tail = 'up'; p.blush = true; }
      },
      front(g, a, k, at, c) {
        const y = k < 0.5 ? Math.round(-8 + (a.top - 4 + 8) * ease(seg(k, 0, 0.5))) : a.top - 4;
        this.pattern(CROWN, a.hx - 3, y, c);
      },
      step(r, k, at, dt, a) {
        if (k < 0.5 && every(r, 's', at, 0.08)) r.emit({ type: 'spark', x: r.scr(a.hx + rand(-4, 4)), y: Math.round(-8 + (a.top + 4) * seg(k, 0, 0.5)), vy: -4, life: 0.4 });
        if (once(r, 'f', k > 0.5)) for (let i = 0; i < 10; i++) r.emit({ type: 'star', x: r.scr(a.hx), y: a.top - 2, vx: rand(-18, 18), vy: rand(-18, -4), life: 0.8 });
        if (k > 0.5 && every(r, 'n', at, 0.3)) r.emit({ type: 'note', x: r.scr(a.hx + (Math.random() < 0.5 ? -14 : 12)), y: a.top + 2, vy: -8, life: 0.9, c: '#d9a21f' });
      },
    },

    levelbanner: {
      // LEVEL UP! 게임 화면 — 옛날 게임처럼 머리 위에 반짝이는 "LEVEL UP!" 글자, 동전이 분수처럼 솟고 고양이는 두 번 점프
      len: 3,
      pose(p, k) {
        const j = (k * 2) % 1;
        p.dy = Math.round(-6 * Math.sin(j * Math.PI));
        p.armL = p.armR = 'cheer'; p.eyes = 'star'; p.mouth = 'open'; p.ear = 1; p.tail = 'up';
      },
      step(r, k, at, dt, a) {
        const col = ['#ffd35c', '#ff6f91', '#6fb0ea', '#78c46a'][Math.floor(at * 8) % 4];
        r.emit({ type: 'text', s: 'LEVEL UP!', x: 7, y: 6 + (Math.floor(at * 4) % 2), perFrame: true, fade: false, c: col });
        if (every(r, 'c', at, 0.15)) r.emit({ type: 'coin', x: r.scr(a.hx + rand(-3, 3)), y: GROUND - 2, vx: rand(-14, 14), vy: rand(-36, -24), ay: 60, life: 1.2 });
      },
    },

    hammock: {
      // 해먹 흔들흔들 — 기둥 두 개 사이 해먹에 쏙 들어가 흔들흔들. 눈을 감고 낙엽이 팔랑
      len: 4, loop: true,
      pose(p, k, at) { p.curl = true; p.dy = -4; p.eyes = 'happy'; p.xf = { ox: Math.round(Math.sin(at * 1.6) * 2) }; p.noShadow = true; },
      front(g, a, k, at, c) {
        const ox = Math.round(Math.sin(at * 1.6) * 2);
        for (let x = a.hx - 10; x <= a.hx + 10; x++) {
          const sag = Math.round(3 - (x - a.hx) * (x - a.hx) / 40);
          this.px(x, 38 + sag, c.K);
          this.px(x, 39 + sag, (x & 1) ? '#e8534a' : '#fffaf3');
          this.px(x, 40 + sag, c.K);
        }
        // 기둥 꼭대기에서 해먹 끝까지 줄 (몸이 흔들려도 기둥은 제자리)
        for (const s of [-1, 1]) {
          const px = a.hx + s * 15 - ox;
          for (let i = 0; i <= 5; i++) this.px(Math.round(px + (a.hx + s * 10 - px) * (i / 5)), 31 + Math.round((38 - 31) * (i / 5)), '#8a5a32');
        }
      },
      step(r, k, at, dt, a) {
        for (const s of [-1, 1]) r.emit({ type: 'vline', x: r.scr(a.hx + s * 15), y: 30, len: GROUND - 29, perFrame: true, fade: false, c: '#8a5a32' });
        if (every(r, 'l', at, 1.6)) r.emit({ type: 'confetti', x: r.scr(a.hx + rand(-14, 16)), y: 2, vx: rand(-5, -1), vy: 7, life: 4, c: '#e8923c' });
        if (every(r, 'z', at, 1.5)) txt(r, 'Z', r.scr(a.hx + 6), a.top - 4, '#9aa6ff', 1.2);
      },
    },

    fooddream: {
      // 맛있는 상상 — 허공을 보며 멍… 생각 풍선 속에 스테이크 → 생선구이 → 케이크가 차례로 떠오른다. 침이 주르륵
      len: 4.8, loop: true,
      pose(p) { p.eyes = 'sparkle'; p.lookX = 1; p.lookY = -1; p.mouth = 'open'; p.blush = true; p.tail = 'wag'; },
      front(g, a, k, at, c) {
        const cx = a.hx + 13;
        const cy = 11;
        this.ellipse(cx, cy, 9, 6.5, '#fffaf3', c.K);
        this.ellipse(a.hx + 6, a.top - 3, 1.4, 1.2, '#fffaf3', c.K);
        this.ellipse(a.hx + 8, a.top - 7, 2, 1.6, '#fffaf3', c.K);
        const food = [STEAK, FISHDREAM, CAKE][Math.min(2, Math.floor(k * 3))];
        this.pattern(food, cx - (food[0].length >> 1), cy - (food.length >> 1), c);
      },
      step(r, k, at, dt, a) {
        if (every(r, 'd', at, 0.9)) r.emit({ type: 'drop', x: r.scr(a.fx + 1), y: a.my + 1, vy: 6, ay: 20, life: 0.8, c: '#bfe6ff' });
        if (every(r, 's', at, 0.5)) r.emit({ type: 'spark', x: r.scr(a.hx + 13 + rand(-8, 8)), y: 11 + rand(-5, 5), life: 0.4 });
      },
    },

    // ================= 5차 (2026-09-22 확정) =================
    sipcode: {
      // 한 손 코딩 한 모금 — 타닥타닥 치다가 머그를 들어 홀짝, 다시 타닥. 여유 있는 프로의 코딩
      len: 4, loop: true,
      pose(p, k) { desk(p); if (k > 0.6 && k < 0.85) { p.armL = 'hold'; p.eyes = 'closed'; p.mouth = 'none'; } },
      mid(g, a, k, at, c) { if (k > 0.6 && k < 0.85) this.pattern(MUG, a.hx - 5, a.my, c); else this.pattern(MUG, a.hx + 11, GROUND - 5, c); },
      // 김은 책상 위 머그에서만 가늘게 (들어 마시는 동안은 얼굴을 가리지 않게 쉰다)
      step(r, k, at, dt, a) { if (!(k > 0.6 && k < 0.85) && every(r, 's', at, 0.2)) steam(r, r.scr(a.hx + 13), GROUND - 6); } },
    headbang: {
      // 헤드폰 리듬 코딩 — 헤드폰 쓰고 박자에 맞춰 고개를 까딱까딱. 음표가 둥실
      len: 2, loop: true,
      pose(p, k, at) { desk(p, true); p.xf = { rot: Math.sin(at * 8) * 0.08, py: GROUND }; p.eyes = 'closed'; p.mouth = 'smile'; },
      front(g, a, k, at, c) { this.pattern(['...KKKKKKKKK...', '.KKDDDDDDDDDKK.', 'KKK.........KKK', 'KDK.........KDK', 'KDK.........KDK', 'KKK.........KKK'], a.hx - 7, a.earTop - 3, c); },
      step(r, k, at, dt, a) { if (every(r, 'n', at, 0.5)) r.emit({ type: 'note', x: r.scr(a.hx + rand(-10, 10)), y: a.top - 4, vy: -8, life: 1 }); } },
    eureka: {
      // 유레카! — 턱 괴고 흠… 고민하다 머리 위 전구가 번쩍! 신나서 타다다닥
      len: 4, loop: true,
      pose(p, k) { if (k < 0.45) { p.armR = 'hold'; p.eyes = 'half'; p.mouth = 'flat'; p.lookY = -1; p.prop = 'laptop'; p.dy = -3; } else if (k < 0.55) { p.eyes = 'star'; p.mouth = 'open'; p.ear = 1; p.prop = 'laptop'; p.dy = -4; } else { desk(p, true); p.eyes = 'happy'; } },
      front(g, a, k, at, c) {
        if (k <= 0.45 || k >= 0.72) return;
        // 전구가 딸깍 켜지며 번쩍 — 처음 잠깐은 빛살이 사방으로 퍼진다
        const x = a.hx + 6, y = a.top - 10;
        const on = k < 0.5 || Math.floor(at * 6) % 3;
        this.pattern(['.KKKKK.', 'KYYYYYK', 'KYYWWYK', 'KYYYWYK', '.KYYYK.', '..KgK..', '..KgK..', '..KKK..'], x - 1, y, on ? c : { ...c, Y: '#e8d9a0', W: '#e8d9a0' });
        if (k < 0.56) {
          const L = k < 0.5 ? 2 : 3;
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) for (let i = 1; i <= L; i++) this.px(x + 2 + dx * (3 + i), y + 2 + dy * (2 + i), '#fff6a0', false);
        }
      },
      step(r, k, at, dt, a) { if (k < 0.45 && every(r, 'd', at, 0.6)) txt(r, '...', r.scr(a.hx + 5), a.top - 4, '#ffffff', 0.6, -2); } },
    smokingkeys: {
      // 키보드 과열 — 너무 빨리 쳐서 키보드에서 연기가 모락모락. 그래도 멈추지 않는다
      len: 3, loop: true,
      pose(p) { desk(p, true); p.brow = 'angry'; },
      // 연기는 키보드 양 끝에서 피어올라 바깥으로 흩어진다 (얼굴은 가리지 않는다). 가끔 불티가 톡
      step(r, k, at, dt, a) {
        if (every(r, 's', at, 0.15)) { const s = Math.floor(at / 0.15) % 2 ? 1 : -1; r.emit({ type: 'puff', x: r.scr(a.hx + s * rand(8, 11)), y: GROUND - 3, vy: -9, vx: r.facing * s * rand(5, 9), life: 0.9, c: 'rgba(160,160,160,0.8)' }); }
        if (every(r, 'e', at, 0.35)) r.emit({ type: 'ember', x: r.scr(a.hx + rand(-6, 6)), y: GROUND - 2, vx: rand(-8, 8), vy: -12, ay: 30, life: 0.4 });
      } },
    soulcode: {
      // 영혼 가출 코딩 — 몸은 계속 타자 치는데 영혼은 빠져나와 위에서 둥실. 그래도 손은 멈추지 않는다
      len: 4, loop: true,
      pose(p) { desk(p); p.eyes = 'dot'; p.mouth = 'blep'; },
      step(r, k, at, dt, a) { r.emit({ type: 'soul', x: r.scr(a.hx + Math.round(Math.sin(at * 2) * 3)), y: a.top - 8 - Math.round(bump(k, 0, 1) * 4), perFrame: true, fade: false }); } },
    ivcoffee: {
      // 커피 링거 — 옆에 커피 링거를 꽂고 똑똑 수혈받으며 코딩
      len: 3, loop: true,
      pose(p) { desk(p); p.eyes = 'half'; },
      back(g, a, k, at, c) { this.pattern(['KKKKK', 'KtttK', 'KtttK', 'KtttK', '.KKK.', '..K..'], a.hx + 11, 22, c); for (let y = 28; y < GROUND; y++) this.px(a.hx + 13, y, '#8f95a0'); for (let i = 0; i < 6; i++) this.px(a.hx + 13 - i, a.cy - 2 + Math.round(i * 0.2), '#cfd6de'); },
      step(r, k, at, dt, a) { if (every(r, 'd', at, 0.4)) r.emit({ type: 'drop', x: r.scr(a.hx + 13), y: 28, vy: 8, life: 0.4, c: '#6b4226' }); } },
    overheat: {
      // 머리에서 김 폴폴 — 뇌 과부하. 얼굴이 빨개지고 머리에서 김이 폭폭 솟는다
      len: 3, loop: true,
      pose(p) { desk(p, true); p.blush = true; p.eyes = 'squint'; p.brow = 'angry'; },
      // 얼굴(머리)만 벌겋게 달아오른다 — 노트북·김까지 물들던 전체 tint 대신 머리 영역에만 (7차)
      front(g, a, k, at) { tintArea.call(this, a.left - 1, a.earTop - 1, a.hw * 2 + 3, GROUND - 6 - a.earTop, `rgba(255,70,60,${(0.2 + 0.08 * Math.sin(at * 6)).toFixed(2)})`); },
      step(r, k, at, dt, a) { if (every(r, 's', at, 0.12)) r.emit({ type: 'puff', x: r.scr(a.hx + rand(-4, 4)), y: a.top - 2, vy: -14, vx: rand(-4, 4), life: 0.7, c: 'rgba(255,255,255,0.9)' }); } },
    raisehand: {
      // 저요 저요! — 앞발을 번쩍 들고 흔들며 폴짝폴짝. 선생님 저 좀 봐 주세요
      len: 1.6, loop: true,
      pose(p, k, at) { p.armR = 'cheer'; p.dy = Math.round(-3 * Math.abs(Math.sin(at * 6))); p.eyes = 'sparkle'; p.mouth = 'open'; p.ear = 1; },
      step(r, k, at, dt, a) { if (every(r, 'e', at, 0.8)) txt(r, '!', r.scr(a.hx + 9), a.top - 8, '#ffd35c', 0.6); } },
    pray: {
      // 제발요 기도 — 앞발을 모으고 초롱초롱한 눈으로 "PLZ". 반짝반짝 빛까지
      len: 2.4, loop: true,
      pose(p) { p.armL = p.armR = 'cross'; p.eyes = 'sparkle'; p.mouth = 'o'; p.ear = 1; p.blush = true; },
      step(r, k, at, dt, a) { if (every(r, 's', at, 0.35)) r.emit({ type: 'spark', x: r.scr(a.hx + rand(-12, 12)), y: a.top + rand(-4, 8), life: 0.5 }); if (every(r, 'p', at, 1.2)) txt(r, 'PLZ', r.scr(a.hx + 6), a.top - 7, '#ffd3df', 0.9); } },
    fishdream: {
      // 생선 꿈 — 자면서 생선 먹는 꿈을 꾼다. 꿈 풍선 속 생선, 입가엔 침
      len: 4, loop: true,
      pose(p, k, at) { p.curl = true; p.eyes = 'closed'; p.mouth = Math.floor(at * 3) % 2 ? 'chew' : 'smile'; p.blush = true; },
      front(g, a, k, at, c) { this.ellipse(a.hx + 11, a.top - 7, 6, 4, '#fffaf3', c.K); this.pattern(['.KKKK.K', 'KOHOOKO', '.KKKK.K'], a.hx + 8, a.top - 8, c); this.ellipse(a.hx + 5, a.top - 2, 1, 1, '#fffaf3', c.K); },
      step(r, k, at, dt, a) { if (every(r, 'd', at, 1.2)) r.emit({ type: 'drop', x: r.scr(a.hx - 1), y: a.my, vy: 5, life: 0.6, c: '#bfe6ff' }); } },
    slowblink: {
      // 고양이 키스 (천천히 깜빡) — 눈을 아주 천천히 감았다 뜬다. 고양이 말로 "사랑해"
      // (2026-10-10 디자인 개선: 2칸짜리 눈만 바뀌어 안 보이던 걸, 머리 옆 말풍선에 큰 눈을 띄워 천천히 감았다 뜨는 게 보이게. 다 뜨면 하트 뿅)
      len: 3,
      pose(p, k) {
        p.eyes = blinkEyes(k); p.mouth = 'smile'; p.tail = 'slow'; p.lookX = 1;
        p.blush = k > 0.2;
        if (k > 0.26 && k < 0.68) p.ear = -1;
      },
      step(r, k, at, dt, a) {
        if (k > 0.94) return;
        const pop = k < 0.04 ? 0.6 : 1; // 처음 한 박자는 작게 떴다가 퐁
        const W = Math.round(19 * pop), H = Math.round(13 * pop);
        const x0 = r.scr(a.hx + 13) - (W >> 1), y0 = a.top - 6 - H;
        const rows = [];
        for (let j = 0; j < H; j++) {
          let s = '';
          for (let i = 0; i < W; i++) {
            const cx = Math.min(i, W - 1 - i), cy = Math.min(j, H - 1 - j);
            const out = cx + cy < 2; // 둥근 모서리
            const edge = !out && (i === 0 || j === 0 || i === W - 1 || j === H - 1 || cx + cy === 2);
            s += out ? '.' : edge ? 'K' : 'W';
          }
          rows.push(s);
        }
        spr(r, rows, x0, y0, { K: INK, W: '#fffaf3' });
        // 꼬리: 말풍선 왼쪽 아래 → 고양이 머리
        spr(r, ['KWK', 'KK.', 'K..'], x0 + 2, y0 + H - 1, { K: INK, W: '#fffaf3' });
        if (pop < 1) return;
        const e = BIG_EYE[blinkEyes(k)];
        const cx = x0 + (W >> 1);
        spr(r, e, cx - 6, y0 + 3, { K: INK, W: '#ffffff' });
        spr(r, e, cx + 3, y0 + 3, { K: INK, W: '#ffffff' });
        // 코 · 입 · 볼
        spr(r, ['.P.', 'K.K', '.K.'], cx - 1, y0 + 7, { P: '#ff8fa3', K: INK });
        if (k > 0.2) for (const dx of [-8, 6]) spr(r, ['PP'], cx + dx, y0 + 9, { P: '#ff8fa3' });
        if (once(r, 'h', k > 0.82)) {
          r.emit({ type: 'heart', big: true, x: x0 + W - 6, y: y0 - 2, vx: 3, vy: -8, life: 1.1 });
          r.emit({ type: 'spark', x: x0 + 2, y: y0, life: 0.5 });
        }
      },
    },
    shinyfur: {
      // 털 윤기 반짝 — 쓰다듬을수록 털에서 광이 난다. 샴푸 광고 고양이
      // (2026-10-10 디자인 개선: 흐리던 빛띠를 굵고 하얗게, 두 번 스윽 지나간 자리마다 큰 반짝이 + "SHINY")
      len: 2.4, reveal: 0.5,
      pose(p, k) {
        if (k < 0.08) { p.eyes = 'open'; p.ear = 1; return; }
        p.eyes = 'closed'; p.mouth = 'smile'; p.tail = 'up'; p.lookY = -1; p.xf = { sy: 1.04 }; p.blush = true; p.ear = 1;
      },
      front(g, a, k) {
        for (const [t0, t1] of [[0.06, 0.38], [0.48, 0.8]]) {
          const s = seg(k, t0, t1);
          if (s <= 0 || s >= 1) continue;
          const x0 = a.left - 12 + Math.round(ease(s) * (a.hw * 2 + 18));
          for (let y = a.earTop - 2; y <= GROUND; y++) {
            const x = x0 + Math.round((y - a.earTop) * 0.6);
            tintArea.call(this, x, y, 4, 1, 'rgba(255,255,255,0.95)');
            tintArea.call(this, x - 2, y, 2, 1, 'rgba(255,255,255,0.5)');
            tintArea.call(this, x + 4, y, 2, 1, 'rgba(255,255,255,0.5)');
          }
        }
      },
      step(r, k, at, dt, a) {
        tintUnder(r, '#ffffff', 0.15 * bump(k, 0.05, 1));
        const L = 2.4;
        // 띠 끝마다 큰 반짝이 둘, 사이사이 작은 것
        for (const [t, dx, dy] of [[0.28, 6, -2], [0.38, -6, 5], [0.7, -6, -1], [0.8, 7, 6], [0.9, 1, -4]]) twinkle(r, r.scr(a.hx + dx), a.top + dy, at - t * L);
        if (once(r, 't', k > 0.38)) txt(r, 'SHINY', r.scr(a.hx) - 9, a.top - 12, '#fff6a0', 0.9, -4);
      },
    },
    donebanner: {
      // "DONE" 현수막 — 두 앞발로 장대 두 개를 번쩍 들면 그 사이로 "DONE!" 현수막이 촤악 펼쳐진다. 폴짝 뛰고 좌우로 흔들흔들
      // (7차: 글자만 귀 위에 겹쳐 있던 걸 진짜 현수막으로)
      len: 2.8,
      pose(p, k) {
        p.armL = p.armR = 'cheer';
        p.eyes = k < 0.12 ? 'open' : 'happy';
        p.mouth = 'open'; p.ear = 1; p.tail = 'up';
        p.dy = -Math.round(bump(k, 0.14, 0.34) * 3);
        if (k > 0.36 && k < 0.92) p.xf = { ox: Math.round(Math.sin((k - 0.36) * Math.PI * 4)) };
      },
      front(g, a, k, at, c) {
        // 현수막이 가운데서부터 양옆으로 촤악
        const half = Math.max(1, Math.round(11 * ease(seg(k, 0.08, 0.3))));
        const top = a.top - 17, h = 8;
        for (const sd of [-1, 1]) {
          // 앞발에서 현수막 모서리까지 장대
          const x0 = a.hx + sd * 6, y0 = a.top - 3, x1 = a.hx + sd * half, y1 = top + h - 1;
          const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
          for (let i = 0; i <= n; i++) this.px(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), '#8a5a32');
          this.pattern(['KK', 'KK'], a.hx + sd * half - (sd < 0 ? 1 : 0), top - 2, c);
        }
        for (let y = top; y < top + h; y++) for (let x = a.hx - half; x <= a.hx + half; x++) {
          const edge = y === top || y === top + h - 1 || x === a.hx - half || x === a.hx + half;
          this.px(x, y, edge ? c.K : y === top + 1 ? '#ffe8a0' : '#fffaf3');
        }
      },
      step(r, k, at, dt, a, p) {
        const ox = p && p.xf ? p.xf.ox || 0 : 0;
        if (k > 0.28) r.emit({ type: 'text', s: 'DONE!', x: r.scr(a.hx) - 8 + ox, y: a.top - 15, perFrame: true, fade: false, c: '#e8534a' });
        if (once(r, 'c', k > 0.3)) for (let i = 0; i < 16; i++) r.emit({ type: 'confetti', x: r.scr(a.hx) + rand(-12, 12), y: a.top - 18, vx: rand(-10, 10), vy: rand(-14, -4), ay: 30, life: rand(1, 1.6), c: CONF[i % 6] });
      },
    },
    bigbutton: {
      // 제출 버튼 꾹 — 커다란 빨간 버튼을 노려보다가 앞발을 높이 치켜들고… 꾹! 버튼이 쑥 들어가고 색종이가 우르르
      // (7차: 앞발이 머리 옆에서 허공을 찌르던 걸, 실제로 버튼 위로 내리찍게)
      len: 2.6,
      pose(p, k, at) {
        p.lookX = 1; p.lookY = 1; p.ear = 1; p.tail = 'up';
        if (k < 0.32) { p.eyes = k < 0.2 ? 'wide' : 'sparkle'; p.mouth = 'o'; }
        else if (k < 0.52) { p.eyes = 'squint'; p.mouth = 'big'; p.xf = { ox: 1 }; p.brow = 'angry'; }
        else { p.eyes = 'happy'; p.mouth = 'open'; p.lookY = 0; if (k > 0.64) { p.armL = p.armR = 'cheer'; p.dy = -Math.round(bump(k, 0.64, 0.84) * 3); } }
      },
      front(g, a, k, at, c) {
        const pressed = k > 0.34 && k < 0.54 ? 1 : 0;
        this.pattern(['..KKKKK..', '.KRRHRRK.', 'KKKKKKKKK', 'KgggggggK', 'KKKKKKKKK'].slice(pressed), a.hx + 7, GROUND - 4 + pressed, c);
        if (k >= 0.64) return;
        // 앞발: 어깨 → 버튼 위 높이 (치켜들기) → 꾹 → 천천히 돌아온다
        const bx = a.hx + 11, press = GROUND - 7 + pressed, high = GROUND - 15;
        let x, y;
        if (k < 0.2) { const e = ease(seg(k, 0.04, 0.2)); x = a.right - 1 + (bx - (a.right - 1)) * e; y = a.cy + (high - a.cy) * e; }
        else if (k < 0.3) { x = bx; y = high + Math.round(Math.sin(at * 30) * 0.6); }
        else if (k < 0.34) { const e = seg(k, 0.3, 0.34); x = bx; y = high + (press - high) * e * e; }
        else if (k < 0.52) { x = bx; y = press; }
        else { const e = ease(seg(k, 0.52, 0.64)); x = bx + (a.right - 1 - bx) * e; y = press + (a.cy - press) * e; }
        limb.call(this, g, a.right - 2, a.cy - 1, x, y);
      },
      step(r, k, at, dt, a) {
        if (once(r, 'c', k > 0.36)) {
          txt(r, 'CLICK', r.scr(a.hx + 4) - 6, a.top - 8, '#fff', 0.7);
          for (let i = 0; i < 26; i++) r.emit({ type: 'confetti', x: r.scr(a.hx + 11), y: GROUND - 6, vx: rand(-26, 26), vy: rand(-36, -12), ay: 45, life: 1.4, c: CONF[i % 6] });
        }
      },
    },
    glowup: {
      // 변신 빛기둥 — 하늘에서 빛기둥이 내려오고 그 안에서 빙글빙글 돌며 반짝 변신
      len: 2.8, reveal: 0.5,
      pose(p, k, at, r) { if (k > 0.2 && k < 0.7) { r.setFacing(Math.floor(at * 10) % 2 ? 1 : -1); p.xf = { oy: -Math.round(bump(k, 0.2, 0.7) * 6) }; p.eyes = 'closed'; } else { p.eyes = 'star'; p.mouth = 'open'; p.armL = p.armR = 'up'; } },
      back(g, a, k) { if (k < 0.75) for (let y = 0; y <= GROUND; y++) for (let x = a.cx - 7; x <= a.cx + 7; x++) this.px(x, y, Math.abs(x - a.cx) < 3 ? 'rgba(255,250,210,0.5)' : 'rgba(255,240,170,0.25)', false); },
      // 번쩍은 캔버스 전체(바탕화면 위 흰 네모)가 아니라 고양이만 (7차)
      step(r, k, at, dt, a) { if (k < 0.75 && every(r, 's', at, 0.12)) r.emit({ type: 'spark', x: r.scr(a.cx + rand(-6, 6)), y: rand(4, 40), life: 0.4 }); if (k > 0.68) flashCat(r, seg(k, 0.68, 0.8)); if (once(r, 'f', k > 0.7)) for (let i = 0; i < 10; i++) { const an = (i / 10) * Math.PI * 2; r.emit({ type: 'star', x: r.scr(a.cx), y: a.cy - 2, vx: Math.cos(an) * 20, vy: Math.sin(an) * 14, life: 0.6 }); } } },
    fireworksbg: {
      // 불꽃놀이 — 양옆에서 폭죽이 꼬리를 끌며 솟아올라 팡! 터질 때마다 불빛이 고양이를 물들이고, 고양이는 넋 놓고 "와아"
      // (7차: 고리만 뿅 생기던 걸, 솟아오르는 꼬리 → 터짐 → 반짝이며 떨어지는 불꽃으로)
      len: 3.2,
      pose(p, k, at, r) {
        p.lookY = -1; p.eyes = 'sparkle'; p.mouth = 'o'; p.ear = 1;
        const since = at - (r.ms.boom || -9);
        if (since < 0.35) { p.mouth = 'open'; p.blush = true; p.dy = since < 0.12 ? -1 : 0; }
        p.lookX = r.ms.lookX || 0;
      },
      step(r, k, at, dt, a) {
        const shells = r.ms.shells || (r.ms.shells = []);
        if (k < 0.8 && every(r, 'f', at, 0.62)) {
          const side = shells.length % 2 ? 1 : -1;
          shells.push({ x: 24 + side * rand(12, 19), yb: rand(5, 14), t0: at, col: CONF[Math.floor(rand(0, 6))], done: false });
        }
        for (const s of shells) {
          const u = (at - s.t0) / 0.45;
          if (u < 1) {
            // 솟아오르는 꼬리
            const y = GROUND - 2 - (GROUND - 2 - s.yb) * (1 - (1 - u) * (1 - u));
            r.emit({ type: 'spray', x: s.x, y, c: '#fff6d0', perFrame: true, fade: false });
            if (every(r, 'tr' + s.t0, at, 0.04)) r.emit({ type: 'ember', x: s.x + rand(-0.5, 0.5), y: y + 1, vy: 4, life: 0.25 });
          } else if (!s.done) {
            s.done = true;
            r.ms.boom = at;
            r.ms.boomCol = s.col;
            r.ms.lookX = s.x < 24 ? -1 : 1;
            for (let i = 0; i < 14; i++) { const an = (i / 14) * Math.PI * 2; r.emit({ type: 'confetti', x: s.x, y: s.yb, vx: Math.cos(an) * 17, vy: Math.sin(an) * 17, ay: 12, life: 1, c: s.col }); }
            r.emit({ type: 'spark', x: s.x, y: s.yb, life: 0.3, c: '#ffffff' });
          }
        }
        // 터진 불빛에 고양이가 잠깐 환해진다
        const since = at - (r.ms.boom || -9);
        if (since < 0.4) tintUnder(r, '#fff6d0', 0.22 * (1 - since / 0.4)); // 색을 입히면 털이 탁해져서 밝게만
      },
    },
    teatime: {
      // 차와 과자 — 따뜻한 차 한 잔에 쿠키 하나. 쿠키를 집어 차에 퐁당퐁당 두 번 찍은 뒤 냠냠, 부스러기가 톡톡
      // (7차: 쿠키가 입으로 순간이동하던 걸, 앞발로 집어 찍고 → 입으로 가져가게)
      len: 4.4, loop: true,
      pose(p, k, at, r) {
        p.tail = 'slow';
        if (k < 0.42) { p.lookX = 1; p.lookY = 1; p.eyes = k < 0.12 ? (r.blinkAt(at) ? 'blink' : 'open') : 'sparkle'; p.mouth = k > 0.3 ? 'o' : 'smile'; }
        else if (k < 0.74) { p.armR = 'hold'; p.eyes = 'happy'; p.blush = true; p.mouth = k > 0.5 ? (Math.floor(at * 6) % 2 ? 'chew' : 'smile') : 'open'; }
        else { p.eyes = 'closed'; p.mouth = 'smile'; p.blush = true; p.tail = 'wag'; }
      },
      front(g, a, k, at, c) {
        const cupX = a.hx + 9, cupY = GROUND - 4;
        // 받침 접시 + 찻잔
        this.pattern(['KKKKKKKK'], a.hx + 3, GROUND, { K: '#c3ccd6' });
        this.pattern(['KWWWK.', 'KWtWKK', 'KWWWK.', '.KKK..'], cupX, cupY, c);
        const soaked = k > 0.3;
        const cookie = (x, y, bite) => this.pattern(bite ? ['KK.', 'KsK', 'KKK'] : ['KKK', soaked ? 'KsK' : 'KOK', 'KKK'], Math.round(x) - 1, Math.round(y) - 1, { K: '#8a5a32', O: '#e8b061', s: '#b07a3e' });
        if (k < 0.12) { cookie(a.hx + 5, GROUND - 1); return; }
        if (k < 0.42) {
          // 앞발이 쿠키를 집어(0.12~0.2) 찻잔 위로(~0.24) → 퐁당 두 번(~0.36) → 들어 올린다
          let x, y;
          if (k < 0.2) { const e = ease(seg(k, 0.12, 0.2)); x = a.right + (a.hx + 5 - a.right) * e; y = a.cy + (GROUND - 3 - a.cy) * e; }
          else if (k < 0.24) { const e = ease(seg(k, 0.2, 0.24)); x = a.hx + 5 + (cupX + 2 - a.hx - 5) * e; y = GROUND - 3 - 5 * e; }
          else if (k < 0.36) { x = cupX + 2; y = GROUND - 8 + Math.round(bump((seg(k, 0.24, 0.36) * 2) % 1, 0, 1) * 3); }
          else { const e = ease(seg(k, 0.36, 0.42)); x = cupX + 2 + (a.right - cupX - 2) * e; y = GROUND - 8 + (a.cy - GROUND + 8) * e; }
          limb.call(this, g, a.right - 2, a.cy - 1, x, y - 2);
          cookie(x, y + 2);
          return;
        }
        if (k < 0.74) cookie(a.fx - 0.5, a.my + 2, k > 0.52);
      },
      step(r, k, at, dt, a) {
        if (every(r, 's', at, 0.25)) steam(r, r.scr(a.hx + 11), GROUND - 5);
        if (k > 0.26 && k < 0.36 && every(r, 'dk', at, 0.26)) r.emit({ type: 'spray', x: r.scr(a.hx + 11), y: GROUND - 5, vx: rand(-6, 6), vy: -8, ay: 30, life: 0.4, c: '#c48b56' });
        if (k > 0.5 && k < 0.74 && every(r, 'cr', at, 0.3)) r.emit({ type: 'spray', x: r.scr(a.fx + rand(-1, 1)), y: a.my + 2, vx: rand(-5, 5), vy: -3, ay: 30, life: 0.5, c: '#e8b061' });
        if (once(r, 'h', k > 0.76)) r.emit({ type: 'heart', x: r.scr(a.hx + 6), y: a.top - 3, vy: -6, life: 1.1 });
      },
    },
    foodsign: {
      // "FOOD" 피켓 시위 — "FOOD" 피켓을 들고 1인 시위. 피켓이 위아래로 흔들린다
      len: 2.4, loop: true,
      pose(p, k) { p.armL = p.armR = 'lift'; p.liftUp = bump(k, 0, 0.5); p.brow = 'angry'; p.mouth = 'big'; },
      front(g, a, k, at, c) { const up = Math.round(bump(k, 0, 0.5) * 4); this.pattern(['KKKKKKKKKKKKKKKKK', 'KWWWWWWWWWWWWWWWK', 'KWWWWWWWWWWWWWWWK', 'KWWWWWWWWWWWWWWWK', 'KWWWWWWWWWWWWWWWK', 'KWWWWWWWWWWWWWWWK', 'KKKKKKKKKKKKKKKKK'], a.hx - 8, a.top - 12 - up, c); },
      step(r, k, at, dt, a) { const up = Math.round(bump(k, 0, 0.5) * 4); r.emit({ type: 'text', s: 'FOOD', x: r.scr(a.hx) - 7, y: a.top - 11 - up, perFrame: true, fade: false, c: '#e8534a' }); } },
    paperplane: {
      // 종이비행기 — 앞발 사이에서 종이를 탁·탁 접어 비행기로 → 힘껏 "SWISH". 파란 자국을 그으며 오른쪽 위 하늘로 작아지다 반짝,
      // 이마에 앞발 얹고 멀리 바라본다 (2026-10-10 디자인 개선: 4칸짜리 흰 비행기가 바탕에 묻히던 걸)
      len: 3.2,
      pose(p, k) {
        if (k < 0.3) { p.armL = p.armR = 'hold'; p.lookY = 1; p.eyes = 'open'; p.mouth = 'blep'; return; }
        if (k < 0.4) { p.armR = 'up'; p.eyes = 'squint'; p.mouth = 'flat'; p.brow = 'angry'; p.xf = { ox: -1, sx: 0.97, sy: 1.03 }; return; }
        if (k < 0.48) { p.armR = 'out'; p.eyes = 'wide'; p.mouth = 'open'; p.xf = { ox: 1 }; return; }
        p.armR = 'out'; p.lookX = 1; p.lookY = -1; p.eyes = k > 0.78 ? 'sparkle' : 'open'; p.mouth = k > 0.78 ? 'open' : 'o'; p.tail = 'wag'; p.ear = 1;
      },
      front(g, a, k, at, c) {
        const m = { K: c.K, W: '#ffffff', w: '#bcd0e6' };
        if (k < 0.1) this.pattern(['KKKKKKK', 'KWWWWWK', 'KWWWWWK', 'KWWWWWK', 'KWWWWWK', 'KKKKKKK'], a.hx - 3, a.my, m);
        else if (k < 0.2) this.pattern(['KKKKKKK', 'KWWwWWK', '.KWwWK.', '..KwK..', '...K...'], a.hx - 3, a.my + 1, m);
        else if (k < 0.3) this.pattern(PLANE_M, a.hx - 2, a.my, m);
        else if (k < 0.4) this.pattern(PLANE_M, a.right - 1, a.top - 3, m);
      },
      step(r, k, at, dt, a) {
        if (once(r, 'f1', k > 0.1)) r.emit({ type: 'spark', x: r.scr(a.hx + 4), y: a.my, life: 0.3 });
        if (once(r, 'f2', k > 0.2)) r.emit({ type: 'spark', x: r.scr(a.hx - 4), y: a.my, life: 0.3 });
        if (once(r, 's', k > 0.4)) txt(r, 'SWISH', r.scr(a.hx) - 12, a.top - 8, '#ffffff', 0.8, -4);
        const t = seg(k, 0.4, 0.76);
        if (t > 0 && t < 1) {
          const x = a.right + 1 + (44 - a.right - 1) * t, y = a.top - 2 - (a.top - 2 - 5) * Math.sin(t * Math.PI * 0.5);
          planeAt(r, t < 0.35 ? PLANE : t < 0.7 ? PLANE_M : PLANE_S, r.scr(x), y, r.facing);
          if (every(r, 'tr', at, 0.025)) r.emit({ type: 'spray', x: r.scr(Math.round(x - 3)), y: Math.round(y) + 1, life: 0.7, c: '#7cc4f2' });
        }
        if (once(r, 'v', k > 0.76)) { r.emit({ type: 'spark', x: r.scr(44), y: 5, life: 0.6 }); r.emit({ type: 'star', x: r.scr(42), y: 7, vx: -3, vy: -3, life: 0.5 }); }
      },
    },
    airpunch: {
      // 허공에 냥펀치 — 아무것도 없는 허공을 노려보다 갑자기 냥냥펀치. 뭐가 보이는 걸까
      len: 2.4,
      pose(p, k, at) { if (k < 0.4) { p.eyes = 'wide'; p.lookY = -1; p.ear = 1; } else { p.armL = Math.floor(at * 10) % 2 ? 'cheer' : 'up'; p.armR = Math.floor(at * 10) % 2 ? 'up' : 'cheer'; p.eyes = 'squint'; p.brow = 'angry'; } },
      step(r, k, at, dt, a) { if (k > 0.4 && every(r, 'l', at, 0.1)) r.emit({ type: 'line', x: r.scr(a.hx + rand(-8, 8)), y: a.top - rand(2, 6), len: 3, life: 0.1 }); } },
    knitting: {
      // 뜨개질 — 두 앞발로 대바늘을 쥐고 딸깍딸깍. 왼쪽 털실 뭉치가 줄어드는 만큼 오른쪽에 개킨 목도리가 쌓이고,
      // 다 뜨면 번쩍 들어 "TA-DA" — 목에 칭칭 두르고 뿌듯 (2026-10-10 디자인 개선: 발밑 몇 줄에 몰려 너무 작던 걸)
      len: 4.8, loop: true,
      pose(p, k, at) {
        p.tail = 'slow'; p.mouth = 'smile';
        if (k < 0.7) {
          p.armL = p.armR = 'hold'; p.lookY = 1;
          p.eyes = Math.floor(at * 0.8) % 4 === 3 ? 'blink' : 'half';
        } else if (k < 0.8) { p.armL = p.armR = 'lift'; p.liftUp = 1; p.eyes = 'star'; p.mouth = 'open'; p.ear = 1; p.dy = -Math.round(bump(k, 0.7, 0.8) * 2); }
        else { p.eyes = 'happy'; p.blush = true; p.tail = 'wag'; p.ear = 1; }
      },
      mid(g, a, k, at, c) {
        if (k >= 0.7) return;
        const prog = seg(k, 0, 0.7);
        // 왼쪽 털실 뭉치
        const bx = a.hx - 13;
        const top = yarnBall.call(this, c, bx, GROUND, prog < 0.35 ? 0 : prog < 0.7 ? 1 : 2, Math.floor(at * 2) % 2);
        thread.call(this, bx + 2, top + 1, a.hx - 3, a.my + 3, 2);
        // 오른쪽: 바늘에서 내려온 목도리가 바닥에 개켜져 쌓인다
        const layers = 1 + Math.floor(prog * 4);
        const x0 = a.hx + 5;
        for (let y = a.my + 3; y <= GROUND; y++) { this.px(a.hx + 2, y, c.K); this.px(a.hx + 3, y, SCARF_STRIPE(c, y)); this.px(a.hx + 4, y, SCARF_STRIPE(c, y + 1)); this.px(a.hx + 5, y, c.K); }
        for (let l = 0; l < layers; l++) {
          const y = GROUND - 1 - l * 2;
          for (let x = x0; x <= x0 + 10; x++) { this.px(x, y - 1, c.K); this.px(x, y, SCARF_STRIPE(c, Math.floor((x - x0) / 2) + l)); }
          this.px(x0 + 11, y, c.K); this.px(x0 + 11, y - 1, c.K);
        }
        for (let x = x0; x <= x0 + 11; x++) this.px(x, GROUND, c.K);
      },
      front(g, a, k, at, c) {
        if (k < 0.7) { needles.call(this, a.hx, a.my, Math.floor(at * 4) % 2, 4); return; }
        if (k < 0.8) {
          // 다 뜬 목도리를 머리 위로 번쩍 (두 앞발 사이에 펼쳐진다)
          const y = a.top - 6;
          for (let x = a.hx - 9; x <= a.hx + 9; x++) { this.px(x, y - 1, c.K); this.px(x, y + 2, c.K); const col = SCARF_STRIPE(c, Math.floor((x + 20) / 2)); this.px(x, y, col); this.px(x, y + 1, col); }
          for (const x of [a.hx - 10, a.hx + 10]) for (let yy = y; yy <= y + 3; yy += 1) if (yy % 2 === 0) this.px(x, yy, c.p);
          return;
        }
        // 목에 칭칭: 목 둘레 두 줄 + 오른쪽으로 늘어진 끝
        const y = a.neck - 2;
        for (let x = a.left; x <= a.right; x++) { this.px(x, y - 1, c.K); this.px(x, y + 2, c.K); const col = SCARF_STRIPE(c, Math.floor((x + 20) / 2)); this.px(x, y, col); this.px(x, y + 1, col); }
        this.px(a.left - 1, y, c.K); this.px(a.left - 1, y + 1, c.K); this.px(a.right + 1, y, c.K); this.px(a.right + 1, y + 1, c.K);
        const sway = Math.floor(at * 3) % 2;
        for (let j = 0; j < 4; j++) { const x = a.right - 4 + (j > 1 ? sway : 0); this.px(x - 1, y + 2 + j, c.K); this.px(x, y + 2 + j, SCARF_STRIPE(c, j)); this.px(x + 1, y + 2 + j, SCARF_STRIPE(c, j + 1)); this.px(x + 2, y + 2 + j, c.K); }
      },
      step(r, k, at, dt, a) {
        if (k < 0.7 && every(r, 'c', at, 0.5)) r.emit({ type: 'spark', x: r.scr(a.hx + (Math.floor(at * 2) % 2 ? 4 : -4)), y: a.my - 1, life: 0.2 });
        if (once(r, 't', k > 0.71)) { txt(r, 'TA-DA', r.scr(a.hx) - 9, a.top - 16, '#ff9bb8', 0.9, -3); for (let i = 0; i < 6; i++) r.emit({ type: 'spark', x: r.scr(a.hx + rand(-10, 10)), y: a.top - 6 + rand(-3, 3), life: 0.5 }); }
        if (once(r, 'h', k > 0.82)) r.emit({ type: 'heart', x: r.scr(a.hx + 7), y: a.top - 3, vy: -6, life: 1.1 });
      },
    },
    blowkiss: {
      // 하트 날리기 — 앞발로 입맞춤, 쪽! 윙크하며 하트를 날린다
      len: 2.8,
      pose(p, k) {
        if (k < 0.35) { p.armR = 'kiss'; p.mouth = 'kiss'; p.eyes = 'wink'; }
        else if (k < 0.6) { p.armR = 'out'; p.mouth = 'kiss'; p.eyes = 'wink'; }
        else { p.eyes = 'happy'; p.blush = true; }
      },
      step(r, k, at, dt, a) {
        if (once(r, 'h', k > 0.35)) r.emit({ type: 'heart', big: true, x: r.scr(a.fx + 3), y: a.my - 2, vx: 13, vy: -9, life: 1.6 });
      },
    },
    fireup: {
      // 불타오름 — 의욕 활활. 등 뒤로 불꽃이 솟고 눈에 별이 뜬다
      len: 3, loop: true,
      pose(p, k, at) {
        p.eyes = 'star';
        p.brow = 'angry';
        p.mouth = 'open';
        p.armL = p.armR = 'up';
        p.ear = 1;
        p.tail = 'up';
        p.dy = Math.floor(at * 6) % 2 ? -1 : 0;
      },
      back(g, a, k, at) {
        for (let x = a.hx - 13; x <= a.hx + 13; x++) {
          const h = Math.max(0, Math.round(23 - Math.abs(x - a.hx) * 1.05 + Math.sin(at * 12 + x * 1.7) * 2.6));
          for (let i = 0; i < h; i++) {
            const f = i / h;
            this.px(x, GROUND - i, f > 0.78 ? '#ffe27a' : f > 0.45 ? '#ff9a3c' : '#e8534a');
          }
        }
      },
      step(r, k, at, dt, a) {
        if (every(r, 'e', at, 0.08)) r.emit({ type: 'ember', x: r.scr(a.hx + rand(-10, 10)), y: GROUND - 10, vy: -14, vx: rand(-3, 3), life: 0.9 });
      },
    },

    codefrenzy: {
      // 폭풍 코딩 — 눈 부릅뜨고 키보드를 두들긴다. 노트북에서 연기, 특수문자가 튄다
      len: 3.2, loop: true,
      pose(p, k, at) {
        p.prop = 'laptop';
        p.armL = p.armR = 'typefast';
        p.eyes = 'wide';
        p.brow = 'angry';
        p.mouth = 'flat';
        p.sweat = true;
        p.dy = -3;
        p.xf = { ox: Math.floor(at * 24) % 2 ? 1 : 0 };
        p.tail = 'flick';
      },
      step(r, k, at, dt, a) {
        if (every(r, 'c', at, 0.3)) { const side = Math.floor(at / 0.3) % 2 ? 1 : -1; r.emit({ type: 'char', s: '!?#;'[Math.floor(rand(0, 4))], x: r.scr(a.hx + side * 12) - 1, y: GROUND - 8, vy: -14, vx: side * 9, life: 0.7 }); }
        // 노트북 연기는 양 끝에서 바깥으로 (얼굴을 덮지 않게)
        if (every(r, 's', at, 0.3)) { const s = Math.floor(at / 0.3) % 2 ? -1 : 1; r.emit({ type: 'puff', x: r.scr(a.hx + s * 9), y: GROUND - 3, vy: -6, vx: r.facing * s * 6, life: 1, c: 'rgba(180,180,180,0.8)' }); }
      },
    },
    hooray: {
      // 임무 완료 — 빛나는 눈으로 두 발 번쩍 들고 점프, 색종이가 쏟아진다
      len: 2.8,
      pose(p, k) {
        p.dy = -Math.round(bump(k, 0.08, 0.4) * 6);
        p.armL = p.armR = 'cheer';
        p.eyes = 'star';
        p.mouth = 'open';
        p.tail = 'up';
        p.ear = 1;
        if (k > 0.4 && k < 0.5) p.xf = { sx: 1.1, sy: 0.9 };
      },
      step(r, k, at, dt, a) {
        if (once(r, 'go', k > 0.08)) {
          for (let i = 0; i < 26; i++) r.emit({ type: 'confetti', x: 24 + rand(-14, 14), y: rand(2, 12), vx: rand(-6, 6), vy: rand(-4, 6), ay: 14, life: rand(1.4, 2.4), c: CONFETTI[i % CONFETTI.length] });
          r.emit({ type: 'text', s: 'FINISHED!', x: 6, y: 3, vy: -1, life: 1.6, c: '#9fe3c8' });
        }
      },
    },

    sneeze: {
      // 재채기 — 에… 에… 에취! 몸이 튕겨 나가고 콧물 한 방울
      len: 2.6,
      pose(p, k, at) {
        if (k < 0.15) { p.eyes = 'half'; p.mouth = 'o'; }
        else if (k < 0.5) {
          const s = seg(k, 0.15, 0.5);
          p.eyes = s > 0.5 ? 'squint' : 'half';
          p.mouth = s > 0.6 ? 'big' : 'o';
          p.dy = -Math.round(s * 2);
          p.ear = -1;
        } else if (k < 0.62) { p.eyes = 'squint'; p.mouth = 'big'; p.xf = { sx: 1.14, sy: 0.86, oy: 1 }; p.ear = 1; }
        else { p.eyes = 'half'; p.mouth = 'flat'; p.xf = { ox: Math.sin(at * 30) * 0.6 * (1 - seg(k, 0.62, 0.8)) }; }
      },
      step(r, k, at, dt, a) {
        if (once(r, 'a', k > 0.5)) {
          r.emit({ type: 'text', s: 'ACHOO!', x: r.scr(a.hx) + 2, y: a.top - 9, vy: -3, life: 1.1, c: '#fff' });
          for (let i = 0; i < 10; i++) r.emit({ type: 'spray', x: r.scr(a.fx), y: a.my + 2, vx: rand(-18, 18), vy: rand(-10, 6), ay: 30, life: 0.7 });
        }
        if (once(r, 'd', k > 0.7)) r.emit({ type: 'drop', x: r.scr(a.fx + 1), y: a.my + 1, vy: 2, life: 1.2, c: '#bfe6ff' });
      },
    },
    hiccup: {
      // 딸꾹질 — 딸꾹! 할 때마다 몸이 움찔 눌렸다 높이 튀어 오르고, 머리 둘레에 충격선 + 노란 "HIC!"
      // (2026-10-10 디자인 개선: 흰 HIC 글자만 잠깐 떠서 흐릿하던 걸)
      len: 3.3, loop: true,
      pose(p, k, at) {
        const ph = at % 1.1;
        if (ph < 0.05) { p.xf = { sy: 0.9, sx: 1.08 }; p.eyes = 'wide'; p.mouth = 'o'; return; }
        if (ph < 0.22) { p.dy = ph < 0.15 ? -5 : -2; p.xf = { sy: 1.08, sx: 0.95 }; p.eyes = 'wide'; p.mouth = 'o'; p.ear = 1; p.tail = 'up'; return; }
        if (ph < 0.3) { p.xf = { sy: 0.92, sx: 1.06 }; p.eyes = 'wide'; p.mouth = 'o'; return; }
        p.eyes = 'half'; p.mouth = 'wavy'; p.brow = 'sad'; p.tail = 'slow';
      },
      step(r, k, at, dt, a) {
        if (every(r, 'h', at, 1.1)) {
          txt(r, 'HIC!', r.scr(a.hx) + 5, a.top - 10, '#ffd65a', 0.8, -7);
          r.emit({ type: 'shock', x: r.scr(a.hx), y: a.ey - 5, r: 7, life: 0.25 });
        }
      },
    },
    snot: {
      // 코풍선 — 자면서 코풍선이 부풀었다 줄었다… 퐁! 터지면 화들짝
      len: 4.6, loop: true,
      pose(p, k) { p.curl = true; p.eyes = k > 0.93 ? 'wide' : 'closed'; p.mouth = 'flat'; p.ear = k > 0.93 ? 1 : -1; },
      front(g, a, k, at) {
        if (k > 0.92) return;
        const rr = 1 + seg(k, 0, 0.9) * 3.3 + Math.sin(at * 3) * 0.35;
        const cx = a.fx + 1.5 + rr;
        const cy = a.my - 0.5;
        this.shape((x, y) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= rr * rr, [cx - rr - 1, cy - rr - 1, cx + rr + 1, cy + rr + 1], () => 'rgba(205,232,250,0.55)', 'rgba(130,190,235,0.95)');
        this.px(Math.round(cx - rr * 0.4), Math.round(cy - rr * 0.4), '#fff', false);
      },
      step(r, k, at, dt, a) {
        if (every(r, 'z', at, 1.4) && k < 0.9) r.emit({ type: 'text', s: 'Z', x: r.scr(a.hx - 7), y: a.top - 5, vy: -4, vx: -2, life: 1.3, c: '#9aa6ff' });
        if (once(r, 'pop', k > 0.92)) {
          r.emit({ type: 'text', s: 'POP', x: r.scr(a.fx + 3), y: a.my - 8, vy: -4, life: 0.8, c: '#bfe6ff' });
          for (let i = 0; i < 6; i++) r.emit({ type: 'spray', x: r.scr(a.fx + 4), y: a.my, vx: rand(-14, 14), vy: rand(-12, 2), ay: 30, life: 0.5 });
        }
      },
    },
    fart: {
      // 뿡 — 끙… 힘주다가 "PUUU!" 초록 연기를 뿜으며 로켓처럼 쑥 떠올랐다 쿵 착지. 그러고는 시치미 떼고 휘파람
      // (2026-10-10 디자인 개선: 연한 초록 연기 세 알이 바탕에 묻히던 걸)
      len: 3,
      pose(p, k, at, r) {
        if (k < 0.16) { p.eyes = r.blinkAt(at) ? 'blink' : 'open'; return; }
        if (k < 0.3) { p.eyes = 'squint'; p.mouth = 'flat'; p.blush = true; p.xf = { sy: 0.92, sx: 1.06, ox: Math.floor(at * 20) % 2 ? 1 : 0 }; p.ear = -1; return; }
        if (k < 0.6) { const h = rocketH(k); p.eyes = 'wide'; p.mouth = 'o'; p.ear = 1; p.tail = 'up'; p.xf = { oy: -Math.round(h), sy: k < 0.42 ? 1.06 : 1, sx: k < 0.42 ? 0.96 : 1 }; return; }
        if (k < 0.66) { p.eyes = 'squint'; p.mouth = 'o'; p.xf = { sx: 1.1, sy: 0.9 }; return; }
        p.eyes = 'side'; p.sideDir = Math.floor(at * 2) % 2 ? 1 : -1; p.mouth = 'o'; p.sweat = true; p.tail = 'slow';
      },
      step(r, k, at, dt, a) {
        const h = rocketH(k);
        if (once(r, 'p', k > 0.3)) {
          txt(r, 'PUUU!', r.scr(a.hx) + 3, GROUND - 22, '#c4dc7a', 1, -2);
          for (let i = 0; i < 6; i++) r.emit({ type: 'puff', x: r.scr(a.hx) + rand(-6, 6), y: GROUND - 1, vx: rand(-14, 14), vy: rand(-3, 0), life: 0.9, c: GREEN_L });
        }
        if (k > 0.3 && k < 0.5 && every(r, 'j', at, 0.04)) r.emit({ type: 'puff', x: r.scr(a.hx) + rand(-3, 3), y: GROUND + 1 - h, vx: rand(-4, 4), vy: 10, life: 0.55, c: Math.random() < 0.5 ? GREEN_L : GREEN });
        if (once(r, 'd', k > 0.6)) for (let i = 0; i < 4; i++) r.emit({ type: 'dust', x: r.scr(a.hx) + rand(-8, 8), y: GROUND, vx: rand(-8, 8), life: 0.4 });
        if (k > 0.68 && every(r, 'n', at, 0.45)) r.emit({ type: 'note', x: r.scr(a.fx + 4), y: a.my - 4, vx: 4, vy: -6, life: 0.8 });
      },
    },
    soul: {
      // 영혼 가출 — 너무 지쳐서 멍… 몸에서 고양이와 똑같이 생긴 반투명 분신이 천사 고리를 달고 둥실 떠오른다.
      // 몸은 잿빛, 분신이 쏙 내려와 합쳐지면 퍼뜩 "!" (2026-10-10 디자인 개선: 5칸짜리 영혼이 작고 금방 흐려지던 걸)
      len: 3.8,
      pose(p, k) { soulPose(p, k); },
      step(r, k, at, dt, a) {
        const up = soulUp(k);
        if (k > 0.14 && k < 0.84) tintUnder(r, '#8f99a6', 0.62 * Math.min(1, seg(k, 0.14, 0.24)));
        if (k > 0.14 && k < 0.84 && up > 0.02) {
          const rise = Math.round(up * 15 + (up > 0.95 ? Math.sin(at * 3) : 0));
          const dx = Math.round(Math.sin(at * 2.4) * 2 * up);
          // 분신 → 몸 사이 영혼 꼬리
          for (let i = 0; i < rise; i++) dot(r, r.scr(a.hx) + Math.round(Math.sin(i * 0.8 + at * 5) * 1 + (dx * i) / Math.max(1, rise)), a.top - 1 - i + 2, 'rgba(190,215,240,0.8)');
          r.emit({ type: 'clone', dx, dy: -rise, a: 0.72, perFrame: true, fade: false });
          // 천사 고리
          if (up > 0.5) spr(r, ['.YYYYY.', 'Y.....Y', '.YYYYY.'], r.scr(a.hx) - 3 + dx, a.earTop - rise - 4, { Y: '#ffd35c' });
        }
        if (once(r, 'w', k > 0.84)) { txt(r, '!', r.scr(a.hx + 6), a.top - 9, '#ffd35c', 0.6, -4); for (let i = 0; i < 4; i++) r.emit({ type: 'spark', x: r.scr(a.hx + rand(-6, 6)), y: a.top + rand(-3, 2), life: 0.3 }); }
        if (once(r, 'h', k > 0.16)) txt(r, 'HUU', r.scr(a.hx) - 5, a.top - 6, '#c9d6e3', 0.8, -3);
      },
    },
    workout: {
      // 헬스 — 아령을 머리 위로 번쩍번쩍. 땀 뻘뻘, 마지막엔 부들부들
      len: 3.6, loop: true,
      pose(p, k, at) {
        const rep = (Math.sin(at * 7) + 1) / 2;
        p.liftUp = rep;
        p.armL = p.armR = 'lift';
        p.eyes = rep > 0.6 ? 'squint' : 'open';
        p.mouth = rep > 0.6 ? 'wavy' : 'flat';
        p.sweat = true;
        p.brow = 'angry';
        if (k > 0.8) p.xf = { ox: Math.sin(at * 40) * 0.6 };
      },
      front(g, a, k, at, c) {
        const y = Math.round(a.top - 1 - ((Math.sin(at * 7) + 1) / 2) * 4) - 1;
        for (let x = a.hx - 7; x <= a.hx + 7; x++) this.px(x, y, '#8a93a3');
        for (const x of [a.hx - 9, a.hx + 8]) { this.rect(x, y - 2, 2, 5, '#3a3f4b'); this.px(x, y - 2, '#6b7280'); }
      },
    },

    // ================= 상점 B급 (2차) =================
    smoke: {
      // 담배 한 대 — 고단한 하루… 앞발로 담배를 들고 깊~게 들이마신 뒤 후우 연기를 내뿜으며 먼 산을 본다
      len: 5.2, loop: true,
      pose(p, k) {
        p.armR = 'kiss';
        if (k < 0.3) { p.eyes = 'closed'; p.mouth = 'none'; p.xf = { sy: 1 + 0.05 * seg(k, 0, 0.3), sx: 1 + 0.03 * seg(k, 0, 0.3) }; p.ear = -1; }
        else if (k < 0.38) { p.eyes = 'closed'; p.mouth = 'none'; p.xf = { sy: 1.05, sx: 1.03 }; }
        else if (k < 0.75) { p.eyes = 'half'; p.mouth = 'o'; p.lookX = 1; p.brow = 'sad'; p.armR = 'rest'; }
        else { p.eyes = 'half'; p.mouth = 'flat'; p.lookX = 1; p.brow = 'sad'; }
        p.tail = 'slow';
      },
      front(g, a, k) {
        if (k >= 0.38 && k < 0.75) return; // 내뿜을 땐 손을 내린다
        const glow = k < 0.3 && Math.floor(k * 40) % 2 ? '#ffe27a' : '#ff6a2c';
        this.pattern(CIG, a.fx + 1, a.my + 1, { W: '#fffaf3', o: glow });
        this.px(a.fx + 1, a.my + 1, '#d9b27a');
      },
      step(r, k, at, dt, a) {
        if (k < 0.3 && every(r, 'wisp', at, 0.35)) r.emit({ type: 'puff', x: r.scr(a.fx + 7), y: a.my - 1, vy: -5, vx: 1, life: 1.2, c: 'rgba(210,210,210,0.6)' });
        if (k > 0.38 && k < 0.7 && every(r, 'out', at, 0.09)) r.emit({ type: 'puff', x: r.scr(a.fx + 2), y: a.my + 1, vx: r.facing * rand(10, 18), vy: rand(-6, -2), life: 1.6, c: 'rgba(225,225,225,0.85)' });
        if (once(r, 'ring', k > 0.55)) r.emit({ type: 'ring', x: r.scr(a.fx + 6), y: a.my - 3, vx: r.facing * 7, vy: -5, r: 2, grow: 3, life: 1.6 });
        if (once(r, 'sigh', k > 0.75)) r.emit({ type: 'text', s: 'HOO...', x: r.scr(a.hx) + 2, y: a.top - 10, vy: -2, life: 1.4, c: '#e9e4dc' });
      },
    },

    dealwithit: {
      // 선글라스 착 — 하늘에서 선글라스가 천천히 내려와 얼굴에 착. 입꼬리 씩 — 쿨함 그 자체
      len: 4, reveal: 0.46, loop: true,
      pose(p, k) {
        p.eyes = k < 0.45 ? 'open' : 'none';
        p.mouth = k > 0.5 ? 'grin' : 'flat';
        p.tail = k > 0.5 ? 'wag' : 'idle';
        if (k > 0.45 && k < 0.52) p.xf = { sy: 0.94, sx: 1.04 };
      },
      front(g, a, k) {
        const y = Math.round(-6 + (a.ey - 1 + 6) * ease(seg(k, 0.05, 0.45)));
        this.pattern(SHADES, a.eyeL - 2, y, { k: '#1f1c1b', H: '#ffffff' });
      },
      step(r, k) {
        if (once(r, 'c', k > 0.5)) r.emit({ type: 'text', s: 'COOL', x: 16, y: 5, vy: -1, life: 1.6, c: '#9fe3c8' });
        if (once(r, 's', k > 0.47)) r.emit({ type: 'spark', x: r.scr(28), y: 36, vy: -4, life: 0.6 });
      },
    },

    karaoke: {
      // 노래방 열창 — 핀 조명 아래 마이크 꽉 쥐고 고음 발사. 눈 질끈, 하트가 날린다
      len: 4, loop: true,
      pose(p, k, at) {
        p.armR = 'kiss';
        p.eyes = 'closed';
        p.mouth = k > 0.55 ? 'big' : Math.floor(at * 3) % 2 ? 'open' : 'o';
        p.brow = k > 0.55 ? 'sad' : null;
        p.dy = k > 0.55 ? -1 : 0;
        p.xf = k > 0.55 ? { ox: Math.sin(at * 30) * 0.5 } : null;
        p.tail = 'wag';
      },
      back(g, a) {
        for (let y = 0; y <= GROUND; y++) {
          const w = Math.round(2 + y * 0.28);
          for (let x = a.hx - w; x <= a.hx + w; x++) this.px(x, y, 'rgba(255,240,170,0.28)', false);
        }
      },
      front(g, a, k, at, c) {
        this.pattern(['.KK.', 'KggK', 'KggK', '.KK.', '.KD.', '.KD.', '.KD.'], a.fx + 1, a.my - 1, c);
      },
      step(r, k, at, dt, a) {
        if (every(r, 'n', at, 0.3)) r.emit({ type: k > 0.55 ? 'heart' : 'note', x: r.scr(a.hx + rand(-10, 10)), y: a.top - 3, vy: -9, vx: rand(-4, 4), life: 1.1 });
      },
    },

    ninja: {
      // 닌자 변신 — 펑! 연기 속에서 복면 닌자로. 수리검 휙휙 던지고 다시 펑 하고 사라짐
      len: 4.4, reveal: 0.12, loop: true,
      pose(p, k) {
        const hidden = (k > 0.08 && k < 0.16) || k > 0.88;
        p.xf = hidden ? { sx: 0.01, sy: 0.01 } : null;
        p.noShadow = hidden;
        if (k > 0.16 && k < 0.88) { p.brow = 'angry'; p.eyes = 'open'; p.mouth = 'none'; p.armR = k > 0.4 && k < 0.7 ? 'out' : 'rest'; p.tail = 'flick'; }
      },
      front(g, a, k, at, c) {
        if (k < 0.16 || k > 0.88) return;
        // 이마 띠 + 복면 (눈만 보인다)
        this.pattern(['KKKKKKKKKKKKK'], a.hx - 6, a.top + 1, { K: '#2a2f3a' });
        this.pattern(['.K', 'KK', 'K.'], a.hx - 8, a.top + 1, { K: '#2a2f3a' });
        this.rect(a.hx - 5, a.my - 1, 11, 4, '#2a2f3a');
      },
      step(r, k, at, dt, a) {
        for (const [tag, t] of [['p1', 0.08], ['p2', 0.88]]) if (once(r, tag, k > t)) { for (let i = 0; i < 9; i++) r.emit({ type: 'puff', x: 24 + rand(-9, 9), y: 38 + rand(-6, 4), vy: -5, vx: rand(-3, 3), life: 0.8, c: '#e9e4dc' }); r.emit({ type: 'text', s: 'NIN!', x: 17, y: 12, vy: -3, life: 0.8, c: '#fff' }); }
        if (k > 0.4 && k < 0.7 && every(r, 's', at, 0.35)) r.emit({ type: 'shuriken', x: r.scr(a.hx + 9), y: a.ey, vx: r.facing * 40, life: 0.8, fade: false });
      },
    },

    rocket: {
      // 로켓 발사 — 3, 2, 1… 엉덩이에서 불을 뿜으며 하늘로 슝! 잠시 뒤 낙하산 없이 쿵 착지
      len: 5, reveal: 0.58, loop: true,
      pose(p, k, at) {
        let oy = 0;
        if (k < 0.36) { p.eyes = 'wide'; p.xf = { ox: k > 0.26 ? Math.sin(at * 50) * 0.7 : 0 }; p.sweat = true; }
        else if (k < 0.55) { oy = -60 * ease(seg(k, 0.36, 0.55)); p.eyes = 'squint'; p.mouth = 'big'; p.ear = -1; p.armL = p.armR = 'up'; }
        else if (k < 0.8) { oy = -60 * (1 - ease(seg(k, 0.62, 0.8))) ; if (k < 0.62) oy = -60; p.eyes = 'wide'; p.mouth = 'o'; p.armL = p.armR = 'cheer'; }
        else { p.xf = { sy: 1 - 0.2 * (1 - seg(k, 0.8, 0.9)), sx: 1 + 0.15 * (1 - seg(k, 0.8, 0.9)) }; p.eyes = 'x'; p.mouth = 'wavy'; }
        if (oy) p.xf = { oy: Math.round(oy) };
        p.noShadow = oy < -20;
      },
      back(g, a, k, at) {
        if (k < 0.36 || k > 0.58) return;
        for (let y = 0; y < 9; y++) {
          const w = Math.max(0, 3 - Math.floor(y / 3)) + (Math.floor(at * 20 + y) % 2);
          for (let x = a.hx - w; x <= a.hx + w; x++) this.px(x, GROUND + 1 + y, y < 2 ? '#fff4b0' : y < 5 ? '#ffb23c' : '#e8534a');
        }
      },
      step(r, k, at, dt, a) {
        for (const [i, t] of [[3, 0.02], [2, 0.12], [1, 0.22]]) if (once(r, 'c' + i, k > t)) r.emit({ type: 'text', s: String(i), x: 22, y: 8, vy: -2, life: 0.4, c: '#fff' });
        if (k > 0.36 && k < 0.5 && every(r, 'sm', at, 0.05)) r.emit({ type: 'puff', x: 24 + rand(-6, 6), y: GROUND - 1, vx: rand(-14, 14), vy: -3, life: 0.9, c: '#e9e4dc' });
        if (once(r, 'land', k > 0.8)) { r.emit({ type: 'text', s: 'THUD', x: 15, y: 20, vy: -2, life: 0.8, c: '#fff' }); for (let i = 0; i < 6; i++) r.emit({ type: 'dust', x: 24 + rand(-10, 10), y: GROUND, vx: rand(-10, 10), life: 0.5 }); }
      },
    },

    gum: {
      // 풍선껌 비행 — 풍선껌을 부풀리다 너무 커져서 풍선처럼 머리 위로 떠올라 고양이를 둥실 들어 올림… 퐁! 터지고 얼굴에 껌 범벅으로 추락
      // (7차: 풍선이 얼굴을 통째로 가려 표정이 안 보이던 걸, 커질수록 머리 위로 올라가 껌 줄로 입에 매달리게)
      len: 5, loop: true,
      pose(p, k) {
        let oy = 0;
        p.mouth = 'kiss';
        if (k < 0.22) p.eyes = 'closed';
        else if (k < 0.35) { p.eyes = 'wide'; p.ear = 1; } // 어? 풍선이 머리 위로…
        else if (k < 0.62) { oy = -18 * ease(seg(k, 0.35, 0.62)); p.eyes = k < 0.45 ? 'wide' : 'happy'; p.armL = p.armR = 'float'; p.tail = 'wag'; p.noShadow = oy < -8; }
        else if (k < 0.74) { oy = -18 * (1 - seg(k, 0.62, 0.74) ** 2); p.eyes = 'x'; p.mouth = 'o'; p.armL = p.armR = 'up'; p.ear = -1; }
        else if (k < 0.9) { p.eyes = 'x'; p.mouth = 'wavy'; p.ear = -1; p.tail = 'slow'; if (k < 0.8) p.xf = { sx: 1.15, sy: 0.86 }; }
        else { p.eyes = 'half'; p.mouth = 'flat'; p.xf = { ox: Math.round(Math.sin(k * 180) * (1 - seg(k, 0.9, 0.96))) }; } // 도리도리 털어 내고 다시 처음처럼
        if (oy) p.xf = { oy: Math.round(oy) };
      },
      front(g, a, k) {
        if (k < 0.62) {
          const rr = 1 + 6.5 * ease(seg(k, 0, 0.35));
          const rise = ease(seg(k, 0.12, 0.35)); // 입 앞 → 머리 위로
          const cx = a.fx + 0.5;
          const cy = (a.my + 0.5) + (a.top - rr - (a.my + 0.5)) * rise;
          // 입에서 풍선까지 늘어난 껌 줄
          if (rise > 0) for (let y = Math.round(cy + rr); y <= a.my; y++) this.px(a.fx, y, '#ff9bb8');
          this.shape((x, y) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= rr * rr, [cx - rr - 1, cy - rr - 1, cx + rr + 1, cy + rr + 1], () => '#ff9bb8', '#d9668b');
          this.px(Math.round(cx - rr * 0.45), Math.round(cy - rr * 0.45), '#fff', false);
        } else if (k > 0.66 && k < 0.9) {
          // 얼굴에 껌 범벅
          for (const [dx, dy] of [[-4, 0], [-3, 1], [3, -1], [4, 1], [0, 2], [1, 3], [-1, 3], [5, 0], [-2, -2], [2, -3]]) this.px(a.fx + dx, a.ey + dy, '#ff9bb8');
        }
      },
      step(r, k, at, dt, a) {
        if (once(r, 'p', k > 0.62)) { r.emit({ type: 'text', s: 'POP!', x: r.scr(a.hx) - 6, y: a.top - 14, vy: -3, life: 0.8, c: '#ff9bb8' }); for (let i = 0; i < 10; i++) r.emit({ type: 'spray', x: r.scr(a.fx), y: a.top - 6, vx: rand(-20, 20), vy: rand(-18, 4), ay: 40, life: 0.6, c: '#ff9bb8' }); }
        if (once(r, 'l', k > 0.74)) for (let i = 0; i < 5; i++) r.emit({ type: 'dust', x: 24 + rand(-10, 10), y: GROUND, vx: rand(-8, 8), life: 0.5 });
      },
    },



    explode: {
      // 스트레스 폭발 — 점점 빨개지고 귀에서 김이 푸슉… 펑! 새까맣게 탄 채 멍. 머리털이 삐죽
      len: 4.6, reveal: 0.47, loop: true,
      pose(p, k, at) {
        if (k < 0.45) { p.brow = 'angry'; p.eyes = 'squint'; p.mouth = 'wavy'; p.xf = { ox: Math.sin(at * 40) * seg(k, 0.1, 0.45), sx: 1 + 0.08 * seg(k, 0, 0.45), sy: 1 + 0.08 * seg(k, 0, 0.45) }; }
        else if (k < 0.5) { p.xf = { sx: 1.25, sy: 1.25 }; p.eyes = 'wide'; p.mouth = 'big'; }
        else { p.eyes = 'dot'; p.mouth = 'o'; p.tail = 'slow'; }
      },
      front(g, a, k) {
        if (k < 0.5) return;
        // 삐죽 선 머리털
        for (const dx of [-3, -1, 1, 3]) { this.px(a.hx + dx, a.top - 1, '#2b1a10'); this.px(a.hx + dx + (dx > 0 ? 1 : -1), a.top - 2, '#2b1a10'); }
      },
      step(r, k, at, dt, a) {
        if (k < 0.45) {
          tintUnder(r, '#ff3b3b', 0.5 * seg(k, 0, 0.45)); // 김(흰 연기)은 물들이지 않게 고양이에만
          if (k > 0.15 && every(r, 's', at, 0.15)) for (const s of [-1, 1]) r.emit({ type: 'puff', x: r.scr(a.hx + s * 5), y: a.top - 3, vy: -12, vx: s * 5, life: 0.6, c: '#ffffff' });
        } else if (k < 0.5) {
          flashCat(r, seg(k, 0.45, 0.5));
          if (once(r, 'b', true)) { r.emit({ type: 'text', s: 'BOOM', x: 15, y: 6, vy: -2, life: 1, c: '#ffd35c' }); for (let i = 0; i < 20; i++) r.emit({ type: 'confetti', x: 24, y: 36, vx: rand(-30, 30), vy: rand(-30, 0), ay: 40, life: rand(0.8, 1.4), c: CONFETTI[i % 6] }); }
        } else {
          tintUnder(r, '#2b2420', 0.55 * (1 - seg(k, 0.85, 1)));
          if (every(r, 'sm', at, 0.4)) r.emit({ type: 'puff', x: r.scr(a.hx + rand(-4, 4)), y: a.top - 3, vy: -5, life: 1, c: 'rgba(90,90,90,0.7)' });
        }
      },
    },

    ghost: {
      // 유령 코스프레 — 하얀 이불 뒤집어쓰고 둥실 떠서 BOO! 반투명하게 스르르
      len: 4, loop: true,
      pose(p, k, at) {
        p.xf = { oy: Math.round(-3 + Math.sin(at * 3) * 2) };
        p.noTail = true;
        p.eyes = 'none';
        p.mouth = 'none';
      },
      front(g, a, k, at, c) {
        const T = a.earTop - 2;
        for (let y = T; y <= GROUND; y++) {
          const w = y < T + 3 ? 5 + (y - T) * 1 : 8;
          for (let x = a.hx - w; x <= a.hx + w; x++) {
            const hem = y === GROUND && (x + Math.floor(at * 6)) % 3 === 0;
            if (hem) continue;
            const edge = x === a.hx - w || x === a.hx + w || y === T;
            this.px(x, y, edge ? '#9fb3c4' : '#fbfdff');
          }
        }
        this.rect(a.eyeL, a.ey, 2, 2, '#2b1a10');
        this.rect(a.eyeR, a.ey, 2, 2, '#2b1a10');
        if (k > 0.4 && k < 0.7) this.rect(a.fx - 1, a.my + 1, 3, 3, '#2b1a10');
      },
      step(r, k, at) {
        tintUnder(r, '#000', 0.25 + 0.15 * Math.sin(at * 3), 'destination-out'); // BOO! 글자는 또렷하게, 유령만 반투명
        if (once(r, 'b', k > 0.4)) r.emit({ type: 'text', s: 'BOO!', x: 16, y: 6, vy: -2, life: 1, c: '#fff' });
      },
    },


    // ================= 상점 B급 (3차) =================
    soju: {
      // 소주 한 잔 — 초록 병 옆에 두고 소주 한 잔 원샷, 크으~! 얼굴 발그레해져서 비틀비틀 딸꾹
      len: 5.4, loop: true,
      pose(p, k, at) {
        if (k < 0.22) { p.armR = 'hold'; p.eyes = 'open'; p.lookX = 1; }
        else if (k < 0.4) { p.armR = 'kiss'; p.eyes = 'closed'; p.mouth = 'none'; p.lookY = -1; p.xf = { rot: -0.07 * ease(seg(k, 0.22, 0.28)), py: GROUND }; } // 고개를 젖혀 원샷 (크게 돌리면 도트가 깨져서 살짝만)
        else if (k < 0.55) { p.eyes = 'squint'; p.mouth = 'big'; p.xf = { ox: Math.sin(at * 40) * 0.6 }; p.ear = -1; }
        else { p.eyes = Math.floor(at * 1.5) % 2 ? 'half' : 'happy'; p.mouth = 'wavy'; p.blush = true; p.xf = { ox: Math.round(Math.sin(at * 2.2) * 1.5), rot: Math.sin(at * 2.2) * 0.05, py: GROUND }; p.tail = 'slow'; } // 비틀비틀: 옆으로 흔들리며 살짝 기운다
      },
      front(g, a, k, at, c) {
        this.pattern(BOTTLE, a.hx + 9, GROUND - 6, c);
        if (k < 0.22) this.pattern(SHOT, a.fx + 3, a.my + 1, c);
        else if (k < 0.4) this.pattern(SHOT, a.fx + 1, a.my - 1, c);
      },
      step(r, k, at, dt, a) {
        if (once(r, 'k', k > 0.4)) r.emit({ type: 'text', s: 'KHAA!', x: r.scr(a.hx) - 7, y: a.top - 10, vy: -2, life: 1, c: '#fff' });
        if (k > 0.55) {
          tintUnder(r, '#ff5a5a', 0.14);
          if (every(r, 'h', at, 1.1)) { r.emit({ type: 'text', s: 'HIC', x: r.scr(a.hx) + 4, y: a.top - 7, vy: -5, life: 0.8, c: '#fff' }); r.emit({ type: 'bubble', x: r.scr(a.fx + 3), y: a.my - 2, vy: -8, r: 1.4, life: 1 }); }
        }
      },
    },

    skullsmoke: {
      // 해골 연기 — 담배를 깊게 빨고… 후우 내뿜은 연기가 해골 모양이 되어 둥실. 본인은 씩 웃는다
      len: 5.6, loop: true,
      pose(p, k) {
        p.armR = k < 0.35 ? 'kiss' : 'rest';
        if (k < 0.35) { p.eyes = 'closed'; p.mouth = 'none'; p.xf = { sy: 1 + 0.05 * seg(k, 0, 0.35), sx: 1 + 0.03 * seg(k, 0, 0.35) }; }
        else if (k < 0.55) { p.eyes = 'half'; p.mouth = 'o'; }
        else { p.eyes = 'half'; p.brow = 'angry'; p.mouth = 'grin'; p.tail = 'flick'; }
      },
      front(g, a, k) {
        if (k >= 0.35) return;
        const glow = Math.floor(k * 40) % 2 ? '#ffe27a' : '#ff6a2c';
        this.pattern(CIG, a.fx + 1, a.my + 1, { W: '#fffaf3', o: glow });
      },
      step(r, k, at, dt, a) {
        if (k > 0.35 && k < 0.5 && every(r, 'p', at, 0.08)) r.emit({ type: 'puff', x: r.scr(a.fx + 2), y: a.my, vx: r.facing * rand(4, 9), vy: -8, life: 0.9, c: 'rgba(225,225,225,0.8)' });
        if (once(r, 's', k > 0.45)) r.emit({ type: 'skull', x: r.scr(a.hx + 6), y: a.top - 8, vx: r.facing * 2, vy: -3, life: 2.6 });
        if (once(r, 'h', k > 0.6)) r.emit({ type: 'text', s: 'HEH', x: r.scr(a.hx) - 14, y: a.top - 4, vy: -2, life: 1.2, c: '#fff' });
      },
    },

    codeflame: {
      // 코딩 불꽃 — Claude가 일하는 동안 등 뒤로 불꽃이 활활. 눈엔 별, 앞발은 초고속 타자. 일할 때 자리에 딱
      len: 3, loop: true,
      pose(p, k, at) {
        p.prop = 'laptop';
        p.armL = p.armR = 'typefast';
        p.eyes = 'star';
        p.brow = 'angry';
        p.mouth = 'grin';
        p.dy = -3;
        p.tail = 'flick';
      },
      back(g, a, k, at) {
        for (let x = a.hx - 14; x <= a.hx + 14; x++) {
          const h = Math.max(0, Math.round(21 - Math.abs(x - a.hx) * 0.8 + Math.sin(at * 13 + x * 1.9) * 3));
          for (let i = 0; i < h; i++) {
            const f = i / h;
            this.px(x, GROUND - i, f > 0.8 ? '#fff1a8' : f > 0.5 ? '#ffb23c' : f > 0.25 ? '#ff7a2c' : '#e8434a');
          }
        }
      },
      step(r, k, at, dt, a) {
        if (every(r, 'e', at, 0.06)) r.emit({ type: 'ember', x: r.scr(a.hx + rand(-13, 13)), y: GROUND - 14, vy: -18, vx: rand(-4, 4), life: 0.9 });
        if (every(r, 'c', at, 0.4)) r.emit({ type: 'char', s: '#;:+%'[Math.floor(rand(0, 5))], x: r.scr(a.hx + rand(-12, 10)), y: 12, vy: -8, life: 0.8, c: '#ffe9a8' });
      },
    },

    spider: {
      // 스파이더냥 — 빨간 복면 쓰고 천장에 거미줄 쭉! 화면을 이리저리 그네 타듯 날아다니다 착지 포즈
      len: 6, loop: true,
      pose(p, k, at, r) {
        const swing = k > 0.15 && k < 0.85;
        const ang = swing ? Math.sin(seg(k, 0.15, 0.85) * Math.PI * 3) * 0.75 : 0;
        r.ms.ang = ang;
        r.ms.lift = swing ? 10 : k < 0.15 ? 0 : 10 * (1 - seg(k, 0.85, 0.92));
        p.xf = { px: 24, py: 2, rot: ang, oy: -Math.round(r.ms.lift) };
        p.noShadow = swing;
        p.eyes = 'none';
        p.armR = k < 0.15 || swing ? 'point' : 'rest';
        p.armL = swing ? 'up' : 'rest';
        p.tail = 'up';
        if (k > 0.9) { p.armL = p.armR = 'cheer'; }
      },
      front(g, a, k, at, c) {
        // 빨간 복면 + 흰 눈 + 거미줄 무늬
        for (let y = a.top + 1; y <= a.my + 2; y++) for (let x = a.hx - 5; x <= a.hx + 5; x++) this.px(x, y, (x + y) % 4 === 0 ? '#8a1e18' : '#e8342a');
        this.pattern(['KWWK', 'KWWK', '.KK.'], a.eyeL - 1, a.ey - 1, { K: c.K, W: '#fff' });
        this.pattern(['KWWK', 'KWWK', '.KK.'], a.eyeR - 1, a.ey - 1, { K: c.K, W: '#fff' });
      },
      step(r, k, at, dt, a) {
        // 거미줄: 천장 한 점 → 머리 위 (몸이 돈 만큼 같이 돌린다)
        const ang = r.ms.ang || 0;
        const hx = r.scr(a.hx + 5) - 24;
        const hy = a.top - 2 - 2 - (r.ms.lift || 0);
        const x2 = 24 + hx * Math.cos(ang) - hy * Math.sin(ang);
        const y2 = 2 + hx * Math.sin(ang) + hy * Math.cos(ang);
        if (k < 0.15) {
          const t = seg(k, 0.03, 0.12);
          if (t > 0) r.emit({ type: 'seg', x: x2, y: y2, x2: x2 + (24 - x2) * t, y2: y2 + (-2 - y2) * t, perFrame: true, fade: false });
        } else if (k < 0.88) r.emit({ type: 'seg', x: 24, y: -2, x2, y2, perFrame: true, fade: false });
        if (once(r, 'tw', k > 0.04)) r.emit({ type: 'text', s: 'THWIP', x: 14, y: 4, vy: -2, life: 0.8, c: '#fff' });
        if (k > 0.2 && k < 0.8 && every(r, 'w', at, 0.18)) r.emit({ type: 'line', x: x2 - 8, y: y2 + 12 + rand(-4, 4), len: 4, life: 0.2 });
        if (once(r, 'l', k > 0.9)) for (let i = 0; i < 5; i++) r.emit({ type: 'dust', x: 24 + rand(-10, 10), y: GROUND, vx: rand(-8, 8), life: 0.5 });
      },
    },



    lightning: {
      // 번개 맞음 — 머리 위 먹구름에서 번쩍! 번개에 맞아 뼈가 보였다가, 새까맣게 탄 뽀글머리로 멍
      len: 4.6, reveal: 0.4, loop: true,
      pose(p, k) {
        if (k < 0.3) { p.eyes = 'side'; p.sideDir = Math.floor(k * 20) % 2 ? 1 : -1; p.sweat = true; p.lookY = -1; }
        else if (k < 0.45) { p.eyes = 'wide'; p.mouth = 'big'; p.armL = p.armR = 'up'; p.xf = { ox: Math.floor(k * 200) % 2 ? 1 : -1 }; }
        else { p.eyes = 'dot'; p.mouth = 'o'; p.ear = -1; p.tail = 'slow'; }
      },
      front(g, a, k, at, c) {
        if (k < 0.45) this.pattern(['...KKK.KKK...', '..KDDDKDDDK..', '.KDgDDDDDgDK.', 'KDDDDDgDDDDDK', '.KKKKKKKKKKK.'], a.hx - 6, a.top - 13, c);
        if (k > 0.45) for (const [dx, dy] of [[-4, -1], [-2, -2], [0, -3], [2, -2], [4, -1], [-3, -3], [3, -3], [-1, -4], [1, -4], [-5, 0], [5, 0]]) this.px(a.hx + dx, a.top + dy, '#2b1a10');
      },
      step(r, k, at, dt, a) {
        // 번개는 먹구름 밑에서 정수리까지만 (7차: 캔버스 꼭대기부터 내려오며 구름을 뚫고, 까만 tint 에 번개·글자까지 물들던 걸 고쳤다)
        if (k > 0.3 && k < 0.45) {
          if (k < 0.34) flashCat(r, seg(k, 0.3, 0.34));
          else { tintUnder(r, '#1a1210', 0.85); r.emit({ type: 'skel', x: r.scr(a.hx), y: a.top + 1, perFrame: true, fade: false }); }
          const zig = Math.floor(at * 20) % 2;
          r.emit({ type: 'sprite', rows: zig ? ['.WY.', 'WY..', '.WY.', '..WY', '.WY.', 'WY..', '.WY.', '..W.'] : ['..WY', '.WY.', 'WY..', '.WY.', '..WY', '.WY.', 'WY..', '.W..'], map: { W: '#fffbd0', Y: '#ffd35c' }, x: r.scr(a.hx) - 2, y: a.top - 8, perFrame: true, fade: false });
        }
        if (once(r, 'z', k > 0.3)) r.emit({ type: 'text', s: 'ZZAP', x: 15, y: 20, vy: -2, life: 0.8, c: '#ffd35c' });
        if (k > 0.45) {
          tintUnder(r, '#2b2420', 0.5 * (1 - seg(k, 0.85, 1)));
          if (every(r, 's', at, 0.35)) r.emit({ type: 'puff', x: r.scr(a.hx + rand(-4, 4)), y: a.top - 5, vy: -5, life: 1, c: 'rgba(90,90,90,0.7)' });
        }
      },
    },

    bubbleplay: {
      // 비눗방울 놀이 — 비눗방울 막대를 후~ 불면 방울이 둥실둥실. 앞발로 톡톡 터뜨리며 신남
      len: 4.4, loop: true,
      pose(p, k, at) {
        if (k < 0.45) { p.armR = 'kiss'; p.eyes = 'closed'; p.mouth = 'o'; }
        else { p.armL = p.armR = Math.floor(at * 4) % 2 ? 'up' : 'cheer'; p.eyes = 'happy'; p.mouth = 'open'; p.dy = Math.floor(at * 4) % 2 ? -1 : 0; p.tail = 'wag'; }
      },
      front(g, a, k) {
        if (k < 0.45) this.pattern(['.KK.', 'K..K', '.KK.', '..K.', '..K.'], a.fx + 2, a.my - 3, { K: '#b784f5' });
      },
      step(r, k, at, dt, a) {
        if (k < 0.45 && every(r, 'b', at, 0.18)) r.emit({ type: 'bubble', x: r.scr(a.fx + 5), y: a.my - 3, vx: r.facing * rand(6, 14), vy: rand(-8, -2), r: rand(1.2, 2.4), life: 2.2 });
        if (k > 0.5 && every(r, 'p', at, 0.5)) r.emit({ type: 'text', s: 'POP', x: r.scr(a.hx + rand(-10, 6)), y: a.top - 8, vy: -4, life: 0.4, c: '#bfe6ff' });
      },
    },

    ufo: {
      // UFO 납치 — 하늘에서 UFO가 내려와 초록 빛을 쏜다. 고양이가 빙글빙글 빨려 올라갔다가… 퉤 뱉어짐
      len: 5.4, loop: true,
      pose(p, k, at) {
        let oy = 0;
        let rot = 0;
        if (k < 0.25) { p.eyes = 'wide'; p.lookY = -1; p.sweat = k > 0.12; }
        else if (k < 0.55) { const s = ease(seg(k, 0.3, 0.55)); oy = -26 * s; rot = at * 4 * s; p.eyes = 'x'; p.mouth = 'o'; p.armL = p.armR = 'up'; }
        else if (k < 0.72) { oy = -60; }
        else if (k < 0.82) { oy = -60 + 60 * ease(seg(k, 0.72, 0.82)); p.eyes = 'x'; p.mouth = 'big'; }
        else { p.eyes = 'dot'; p.mouth = 'flat'; p.xf = { sy: 0.9 + 0.1 * seg(k, 0.82, 0.9), sx: 1.08 - 0.08 * seg(k, 0.82, 0.9) }; }
        if (oy) { p.xf = { oy: Math.round(oy), rot, px: 24, py: 38 }; p.noShadow = true; }
      },
      step(r, k, at, dt, a) {
        const uy = k < 0.15 ? -8 + 12 * seg(k, 0, 0.15) : k < 0.62 ? 4 : 4 - 20 * seg(k, 0.62, 0.72);
        if (k < 0.72) r.emit({ type: 'ufo', x: 24, y: uy, perFrame: true, fade: false });
        if (k > 0.15 && k < 0.58) r.emit({ type: 'beam', x: 24, y: uy + 6, perFrame: true, fade: false });
        if (once(r, 'p', k > 0.82)) { r.emit({ type: 'text', s: 'PTOO', x: 15, y: 10, vy: -2, life: 0.8, c: '#b7e3a8' }); for (let i = 0; i < 5; i++) r.emit({ type: 'dust', x: 24 + rand(-10, 10), y: GROUND, vx: rand(-8, 8), life: 0.5 }); }
      },
    },
  };

  Object.assign(root.PetSprite.MOTIONS, M);
})(window);

;if (window.PetSprite !== undefined) PetSprite = window.PetSprite; if (window.PetSound !== undefined) PetSound = window.PetSound; if (window.I18N !== undefined) I18N = window.I18N;
/* kit/reactions.js */
// 사람 손길에 대한 반응 모션. 설정·상점에는 안 나오고, 상황에 따라 pet.js · main.js 가 튼다.
//  stir        : 자다가 건드리면 뒤척 (안 깬다)
//  wakeGrumpy  : 자꾸 건드려서 결국 깼다. 부스스 일어나 하품하고 째려본다
//  purr        : 문질러 쓰다듬으면 골골. 자고 있었으면 웅크린 채로
//  land        : 높은 데서 떨어져 쿵 착지. 납작해졌다가 먼지 폴폴, 한 번 째려본다
//  huntCrouch  : 커서를 노리고 몸을 낮춰 살금살금 (걸으면서 쓰는 자세)
//  backflip · levitate : 아주 가끔만 나오는 진짜 드문 모션 (깜짝 이벤트 rare)
(function (root) {
  const { rand, GROUND } = root.PetSprite.util;
  const every = (r, tag, at, period) => {
    const n = Math.floor(at / period);
    if (r.ms[tag] !== n) {
      r.ms[tag] = n;
      return true;
    }
    return false;
  };
  const once = (r, tag, cond) => {
    if (cond && !r.ms[tag]) {
      r.ms[tag] = true;
      return true;
    }
    return false;
  };
  const CONF = ['#ff6f91', '#ffd35c', '#6fb0ea', '#78c46a', '#b784f5'];

  const M = {
    stir: {
      len: 1.3,
      pose(p, k, at) {
        p.curl = true;
        p.eyes = 'closed';
        p.mouth = 'flat';
        p.ear = -1;
        // 몸을 한 번 꿈틀, 귀 한쪽 씰룩
        if (k > 0.15 && k < 0.45) {
          p.xf = { sx: 1.05, sy: 0.95 };
          p.dy = -1;
        }
        if (k > 0.5 && k < 0.65) p.ear = 1;
        void at;
      },
      step(r, k, at, dt, a) {
        if (once(r, 'dots', k > 0.3)) r.emit({ type: 'text', s: '...', x: r.scr(a.hx + 4), y: a.top - 4, vy: -2, life: 1, c: '#8b6f60' });
      },
    },
    wakeGrumpy: {
      len: 2.6,
      pose(p, k) {
        p.tail = 'slow';
        if (k < 0.25) {
          p.curl = true;
          p.eyes = 'half';
          p.mouth = 'flat';
          p.ear = -1;
        } else if (k < 0.55) {
          // 일어나서 크게 하품 (몸을 쭉 늘였다가 제자리로)
          const s = Math.sin(Math.PI * (k - 0.25) / 0.3);
          p.eyes = 'closed';
          p.mouth = s > 0.5 ? 'big' : 'o';
          p.xf = { sx: 1 - 0.05 * s, sy: 1 + 0.08 * s };
          p.ear = -1;
        } else {
          // 반쯤 뜬 눈으로 째려본다. 꼬리를 탁 치고 귀는 옆으로 눕힌 채
          p.eyes = 'half';
          p.mouth = 'flat';
          p.brow = 'angry';
          p.ear = -1;
          p.tail = k > 0.7 && k < 0.8 ? 'flick' : 'slow';
        }
      },
      step(r, k, at, dt, a) {
        if (once(r, 'hm', k > 0.6)) r.emit({ type: 'text', s: 'HMPH', x: r.scr(a.hx + 6), y: a.top - 5, vy: -2, life: 1.2, c: '#f0ddd0' });
      },
    },
    purr: {
      len: 2.2,
      pose(p, k, at, r) {
        // 자고 있었으면 웅크린 채로, 아니면 앉은 채로 눈을 감고 골골
        p.curl = r.mood === 'sleeping';
        p.eyes = p.curl ? 'closed' : 'happy';
        p.mouth = 'smile';
        p.blush = true;
        p.tail = 'wag';
        p.ear = 0;
        // 골골 떨림: 아주 살짝 들썩
        p.dy = Math.floor(at * 18) % 2 ? -1 : 0;
      },
      step(r, k, at, dt, a) {
        if (every(r, 'h', at, 0.45)) r.emit({ type: 'heart', x: r.scr(a.hx + rand(-6, 6)), y: a.top - 2, vy: -6, life: 1.1 });
        if (once(r, 'prr', k > 0.1)) r.emit({ type: 'text', s: 'prr', x: r.scr(a.hx + 7), y: a.top - 6, vy: -2, life: 1.3, c: '#d97757' });
      },
    },
    land: {
      len: 1.9,
      pose(p, k) {
        p.tail = 'up';
        if (k < 0.12) {
          // 쿵! 납작
          p.xf = { sx: 1.25, sy: 0.72 };
          p.eyes = 'closed';
          p.mouth = 'o';
          p.ear = -1;
        } else if (k < 0.35) {
          p.xf = { sx: 0.95, sy: 1.06 };
          p.eyes = 'wide';
          p.mouth = 'o';
          p.ear = 1;
        } else {
          // 째려본다
          p.eyes = 'half';
          p.mouth = 'flat';
          p.ear = -1;
          p.tail = 'flick';
        }
      },
      step(r, k, at, dt) {
        if (once(r, 'dust', true)) {
          for (let i = 0; i < 6; i++) {
            const side = i % 2 ? 1 : -1;
            r.emit({ type: 'dust', x: 24 + side * rand(6, 12), y: GROUND, vx: side * rand(8, 18), vy: -rand(2, 6), life: 0.6 });
          }
        }
        void dt;
      },
    },
    swat: {
      // 쓰다듬기 싫은 날: 귀를 뒤로 젖히고 앞발로 탁! (살살)
      len: 1.1,
      pose(p, k) {
        p.ear = -1;
        p.tail = 'flick';
        p.brow = 'angry';
        if (k < 0.3) {
          // 앞발을 번쩍 치켜들고
          p.armL = 'up';
          p.eyes = 'squint';
          p.mouth = 'flat';
          p.xf = { sx: 0.97, sy: 1.04 };
        } else if (k < 0.55) {
          // 앞으로 탁! 내리친다
          p.armL = 'front';
          p.eyes = 'squint';
          p.mouth = 'open';
          p.dy = 1;
          p.xf = { sx: 1.06, sy: 0.94 };
        } else {
          p.eyes = 'half';
          p.mouth = 'flat';
        }
      },
      step(r, k, at, dt, a) {
        if (once(r, 'tak', k > 0.32)) r.emit({ type: 'text', s: '!', x: r.scr(a.hx - 1), y: a.top - 9, vy: -4, life: 0.8, c: '#e8534a' });
      },
    },
    huntCrouch: {
      len: 1, loop: true,
      pose(p, k, at) {
        // 엉덩이 씰룩씰룩 (덮치기 직전 고양이) — 몸 아래쪽만 좌우로 살짝
        const wig = Math.floor(at * 8) % 4;
        p.xf = { sx: 1.1, sy: 0.84, rot: wig === 1 ? 0.03 : wig === 3 ? -0.03 : 0, px: 24, py: 30 };
        p.dy = 1;
        p.eyes = 'wide';
        p.mouth = 'flat';
        p.ear = 1;
        p.tail = Math.floor(at * 3) % 2 ? 'flick' : 'idle';
      },
    },
    backflip: {
      len: 1.7,
      pose(p, k) {
        p.tail = 'up';
        p.ear = 1;
        if (k < 0.2) {
          p.xf = { sx: 1.12, sy: 0.84 };
          p.dy = 1;
          p.eyes = 'squint';
        } else if (k < 0.75) {
          const j = (k - 0.2) / 0.55;
          p.dy = -Math.sin(j * Math.PI) * 13;
          p.xf = { rot: -j * Math.PI * 2, px: 24, py: 34 };
          p.eyes = 'closed';
          p.armL = p.armR = 'up';
        } else {
          p.eyes = 'happy';
          p.mouth = 'open';
          p.armL = p.armR = 'up';
        }
      },
      step(r, k) {
        if (once(r, 'ta', k > 0.78)) for (let i = 0; i < 12; i++) r.emit({ type: 'confetti', x: 24 + rand(-10, 10), y: 30, vx: rand(-20, 20), vy: rand(-26, -8), ay: 40, life: 1, c: CONF[i % CONF.length] });
      },
    },
    levitate: {
      len: 3.4,
      pose(p, k, at) {
        // 식빵 자세 그대로 스르르 떠올라 명상. 반짝이가 맴돈다
        p.curl = true;
        p.eyes = 'closed';
        p.mouth = 'smile';
        const up = Math.sin(Math.min(1, k / 0.3) * Math.PI * 0.5) * (k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1);
        p.dy = -Math.round(up * 7 + Math.sin(at * 3) * up);
        p.noShadow = up > 0.3;
      },
      step(r, k, at) {
        if (every(r, 's', at, 0.18)) r.emit({ type: 'confetti', x: 24 + Math.cos(at * 4) * 12, y: 32 + Math.sin(at * 4) * 4, vx: 0, vy: -4, ay: 0, life: 0.6, c: '#ffd35c' });
      },
    },
  };

  Object.assign(root.PetSprite.MOTIONS, M);
})(window);

;if (window.PetSprite !== undefined) PetSprite = window.PetSprite; if (window.PetSound !== undefined) PetSound = window.PetSound; if (window.I18N !== undefined) I18N = window.I18N;
/* kit/tutor-motions.js */
// 수업용 모션. Vault Pet 의 motions.js 와 같은 꼴이다:
//  len / loop               : 한 바퀴 길이(초), 반복 여부
//  pose(p, k, at, r)        : 자세. p.prop ('laptop') · p.armL/armR ('rest' 'up' 'wave' 'front' 'hold' 'type' 'typefast')
//                             · p.eyes (open blink closed happy half dot wide squint sparkle) · p.mouth (smile open flat o big none)
//                             · p.ear(-1·0·1) · p.tail (idle up slow flick) · p.dy · p.xf {sx sy ox rot} · p.lookX/lookY · p.sweat · p.blush
//  back/mid/front(g, a, k, at, c) : 소품을 도트로 그린다. this = 렌더러 (this.pattern(rows, x, y, c) · this.px(x, y, color)).
//                             a = 기준점 (hx 머리 가운데 열 · top 정수리 줄 · my 입 줄 · left/right 머리 양끝 · neck · ground)
//                             c = 색 표 (K 외곽선, W 흰색, Y 노랑, B 파랑, T 갈색 … sprite.js 의 PAL)
//  step(r, k, at, dt, a)    : 효과 (r.emit). 좌표는 화면 기준이라 뒤집힐 때 r.scr(x) 로
// 걸으면서 유지하는 자세(물고 가기 · 가리키기 · 돋보기 · 모래시계)는 pet.js 가 sprite.setToyPose(키) 로 걸어 둔다.
(function (root) {
  const { rand, GROUND } = root.PetSprite.util;
  const once = (r, tag, cond) => {
    if (cond && !r.ms[tag]) {
      r.ms[tag] = true;
      return true;
    }
    return false;
  };
  const every = (r, tag, at, period) => {
    const n = Math.floor(at / period);
    if (r.ms[tag] !== n) {
      r.ms[tag] = n;
      return true;
    }
    return false;
  };
  const txt = (r, s, x, y, c, life = 0.9, vy = -3) => r.emit({ type: 'text', s, x, y, vy, life, c });
  const CONFETTI = ['#ff6f91', '#ffd35c', '#6fb0ea', '#78c46a', '#b784f5', '#ff9a3c'];
  // 노트북 앞 타자 자세
  const desk = (p, fast) => {
    p.prop = 'laptop';
    p.armL = p.armR = fast ? 'typefast' : 'type';
    p.dy = -3;
    p.mouth = 'flat';
  };

  // ---------- 소품 도트 ----------
  // 종이 한 장 (세로) · 책 (옆에서 본 등) · 폴더 · 돋보기 · 모래시계 · 메모 · 가방 · 사각모 · 분필
  const PAPER = ['KKKKK', 'KWWWK', 'KWgWK', 'KWWWK', 'KWgWK', 'KWWWK', 'KKKKK'];
  const BOOKS = [
    ['KKKKKKKKKK', 'KRRRRRRRRK', 'KKKKKKKKKK'],
    ['KKKKKKKKKK', 'KBBBBBBBBK', 'KBBBBBBBBK', 'KKKKKKKKKK'],
    ['KKKKKKKKKK', 'KNNNNNNNNK', 'KKKKKKKKKK'],
    ['KKKKKKKKKK', 'KYYYYYYYYK', 'KYYYYYYYYK', 'KKKKKKKKKK'],
    ['KKKKKKKKKK', 'KVVVVVVVVK', 'KKKKKKKKKK'],
    ['KKKKKKKKKK', 'KOOOOOOOOK', 'KOOOOOOOOK', 'KKKKKKKKKK'],
  ];
  const FOLDER = ['KKK.....', 'KYYKKKKK', 'KYYYYYYK', 'KYYYYYYK', 'KKKKKKKK'];
  const TAB = ['KK', 'KK', 'KK']; // 책갈피 끈
  const GLASS = ['..KKK..', '.KUUUK.', 'KUUWUUK', 'KUUUUUK', '.KUUUK.', '..KKK..', '...KT..', '....KT.', '.....KT'];
  const HOURGLASS = ['KKKKKKK', '.KYYYK.', '.KYYYK.', '..KYK..', '...K...', '..K.K..', '.K...K.', 'KKKKKKK'];
  const NOTE = ['KKKKKKK', 'KYYYYYK', 'KYgYgYK', 'KYYYYYK', 'KYgYgYK', 'KYYYYYK', 'KKKKKKK'];
  const BAG = ['..KKK..', '.K...K.', 'KKKKKKK', 'KTTTTTK', 'KTtTTTK', 'KTTTTTK', 'KKKKKKK'];
  // 사각모: 윗판(16칸)은 머리보다 조금 넓게, 띠는 머리 폭 안에
  const CAP = ['...KKKKKKKKKK...', 'KKKDDDDDDDDDDKKK', 'KDDDDDDDDDDDDDDK', 'KKKKKDDDDDDKKKKK', '....KDDDDDDK....', '....KKKKKKKK....'];
  const BULB = ['..KKK..', '.KYYYK.', 'KYYWYYK', 'KYYYYYK', '.KYYYK.', '..KgK..', '..KKK..'];
  const CLOUD = ['..KKKKKKKK..', '.K........K.', 'K..........K', 'K..........K', '.K........K.', '..KKKKKKKK..'];
  const CHALK = ['KWK', 'KWK', 'KwK'];

  // 종이 더미: x 자리에 n 장이 비스듬히
  function papers(self, x, y, n, c) {
    for (let i = 0; i < n; i++) self.pattern(PAPER, x + i * 3 - (i % 2), y - (i % 3), c);
  }

  const M = {
    // ---------- 1단계에서 만든 것 ----------
    ttype: {
      len: 1,
      loop: true,
      pose(p, k, at) {
        desk(p, true);
        p.eyes = Math.floor(at * 2) % 5 === 4 ? 'half' : 'open';
        p.lookY = 1;
      },
    },
    tpoint: {
      len: 1.2,
      loop: true,
      pose(p, k) {
        p.armR = 'up';
        p.lookY = -1;
        p.eyes = 'open';
        p.mouth = 'open';
        p.ear = 1;
        p.tail = 'up';
        p.dy = k < 0.25 ? -Math.round(Math.sin((k / 0.25) * Math.PI) * 3) : 0;
      },
    },
    tcarry: {
      len: 0.8,
      loop: true,
      pose(p) {
        p.mouth = 'flat';
        p.eyes = 'open';
        p.ear = 1;
        p.tail = 'up';
      },
    },
    twait: {
      len: 2.4,
      loop: true,
      pose(p, k) {
        p.mouth = 'smile';
        p.tail = k < 0.5 ? 'slow' : 'idle';
      },
    },
    ttilt: {
      len: 1.6,
      pose(p, k) {
        p.xf = { rot: (k < 0.2 ? k / 0.2 : k > 0.8 ? (1 - k) / 0.2 : 1) * 0.18 };
        p.ear = -1;
        p.eyes = 'open';
        p.mouth = 'o';
        p.lookX = 1;
      },
      step(r, k, at, dt, a) {
        if (once(r, 'q', k > 0.3)) txt(r, '?', r.scr(a.hx + 9), a.top - 5, '#fff', 0.9, -3);
      },
    },
    tcheer: {
      len: 1.6,
      pose(p, k) {
        const j = (k * 2) % 1;
        p.dy = -Math.sin(j * Math.PI) * 7;
        if (j > 0.88) {
          p.sy = 0.86;
          p.sx = 1.12;
        }
        p.eyes = 'happy';
        p.mouth = 'open';
        p.armL = p.armR = 'up';
        p.ear = 1;
        p.tail = 'up';
      },
      step(r, k, at, dt, a) {
        if (once(r, 'c', k < 0.1)) for (let i = 0; i < 16; i++) r.emit({ type: 'confetti', x: 24 + rand(-14, 14), y: a.top - 2, vx: rand(-14, 14), vy: rand(-22, -8), ay: 30, life: 1.4, c: CONFETTI[i % CONFETTI.length] });
      },
    },

    // ---------- A1 다섯 장면 ----------
    // ① 저장했는데 없다 — 북마크·종이 더미를 뒤지다 "?" (3.2초)
    tbookmarkdig: {
      len: 3.2,
      pose(p, k, at) {
        p.lookY = 1;
        p.armR = Math.floor(at * 6) % 2 ? 'front' : 'rest';
        p.eyes = k < 0.7 ? 'open' : 'dot';
        p.mouth = k < 0.7 ? 'flat' : 'o';
        p.ear = k < 0.7 ? 0 : -1;
        p.tail = 'flick';
        p.sweat = k > 0.5;
      },
      back(g, a, k, at, c) {
        papers(this, a.left - 12, GROUND - 7, 4, c);
        papers(this, a.right + 2, GROUND - 7, 3, c);
        this.pattern(TAB, a.left - 6, GROUND - 10, { K: c.R });
        this.pattern(TAB, a.right + 9, GROUND - 9, { K: c.B });
      },
      step(r, k, at, dt, a) {
        if (k < 0.7 && every(r, 'd', at, 0.22)) r.emit({ type: 'dust', x: r.scr(a.hx + rand(-4, 10)), y: GROUND, vx: rand(-6, 6), vy: -3, life: 0.5 });
        if (every(r, 'f', at, 0.55) && k < 0.7) r.emit({ type: 'sprite', rows: ['WWW', 'www'], map: { W: '#fffaf3', w: '#d6cfc4' }, x: r.scr(a.hx + 8), y: GROUND - 8, vx: rand(4, 10) * r.facing, vy: -12, ay: 10, life: 1.1 });
        if (once(r, 'q', k > 0.72)) txt(r, '?', r.scr(a.hx + 9), a.top - 5, '#fff', 1, -3);
      },
    },
    // ② 모으는 게 아는 게 아니다 — 책이 양옆에 쌓이고 뿌듯 → 들켜서 식은땀 (3.6초)
    tbookpile: {
      len: 3.6,
      pose(p, k) {
        p.tail = 'up';
        if (k < 0.65) {
          p.eyes = 'happy';
          p.mouth = 'smile';
          p.ear = 1;
          p.blush = true;
        } else {
          p.eyes = 'dot';
          p.mouth = 'flat';
          p.ear = -1;
          p.sweat = true;
          p.lookX = -1;
        }
      },
      back(g, a, k, at, c) {
        const n = Math.min(6, 1 + Math.floor(k * 9));
        let y = GROUND;
        for (let i = 0; i < n; i++) {
          const b = BOOKS[i % BOOKS.length];
          y -= b.length - 1;
          this.pattern(b, a.left - 13 + (i % 2), y, c);
        }
        let y2 = GROUND;
        for (let i = 0; i < Math.max(0, n - 2); i++) {
          const b = BOOKS[(i + 3) % BOOKS.length];
          y2 -= b.length - 1;
          this.pattern(b, a.right + 3 - (i % 2), y2, c);
        }
      },
      step(r, k, at, dt, a) {
        if (k < 0.65 && every(r, 's', at, 0.5)) r.emit({ type: 'spark', x: r.scr(a.hx + rand(-10, 10)), y: a.top + rand(-4, 6), life: 0.5 });
        if (once(r, 'x', k > 0.7)) txt(r, '...', r.scr(a.hx + 8), a.top - 4, '#fff', 1.2, -2);
      },
    },
    // ③ 하루면 반이 사라진다 — 머리 위 생각 풍선 속 전구가 흐려지다 사라진다 (3.4초)
    tfadethought: {
      len: 3.4,
      pose(p, k) {
        p.lookY = -1;
        p.eyes = k < 0.35 ? 'open' : k < 0.7 ? 'half' : 'dot';
        p.mouth = k < 0.7 ? 'smile' : 'flat';
        p.ear = k < 0.7 ? 1 : -1;
        p.tail = k < 0.7 ? 'idle' : 'slow';
      },
      front(g, a, k, at, c) {
        // 흐려짐: 전구는 k 에 따라 도트를 띄엄띄엄 빼고, 풍선은 마지막에 작아진다
        const x = a.hx + 2;
        const y = a.top - 15;
        if (k < 0.9) {
          this.pattern(CLOUD, x - 2, y - 1, c);
          const keep = 1 - Math.max(0, (k - 0.2) / 0.65); // 1 → 0
          BULB.forEach((row, j) =>
            [...row].forEach((ch, i) => {
              if (ch === '.') return;
              const h = ((i * 7 + j * 13) % 11) / 11; // 고정된 흩뿌림
              if (h < keep) this.px(x + 1 + i, y + j, c[ch] || c.K);
            }),
          );
        }
        // 꼬리 점 두 개
        if (k < 0.95) {
          this.px(a.hx + 3, a.top - 7, c.K);
          this.px(a.hx + 4, a.top - 9, c.K);
        }
      },
    },
    // ④ 정리하다 포기한다 — 폴더가 양옆에 쌓이는데 식은땀 타자 → 뻗음 (3.8초)
    tfoldering: {
      len: 3.8,
      pose(p, k, at) {
        if (k < 0.74) {
          desk(p, true);
          p.sweat = true;
          p.eyes = 'dot';
        } else {
          p.eyes = 'closed';
          p.mouth = 'flat';
          p.ear = -1;
          p.dy = 1;
          p.xf = { sy: 0.92, sx: 1.06 };
          p.tail = 'slow';
        }
      },
      back(g, a, k, at, c) {
        const n = 1 + Math.floor(Math.min(k, 0.74) * 8);
        for (let i = 0; i < n; i++) {
          const side = i % 2 ? 1 : -1;
          const h = Math.floor(i / 2);
          this.pattern(FOLDER, side < 0 ? a.left - 12 - h : a.right + 4 + h, GROUND - 4 - h * 4, c);
        }
      },
      step(r, k, at, dt, a) {
        if (once(r, 'z', k > 0.78)) txt(r, 'UGH', r.scr(a.hx + 7), a.top - 5, '#fff', 1.2, -2);
      },
    },
    // ⑤ 그래서 지금 이게 유행 — 눈 반짝, 폴짝, 별 (2.6초)
    tsparkle: {
      len: 2.6,
      pose(p, k) {
        p.eyes = 'sparkle';
        p.mouth = k < 0.5 ? 'o' : 'open';
        p.ear = 1;
        p.tail = 'up';
        p.dy = k > 0.5 ? -Math.sin(((k - 0.5) / 0.5) * Math.PI) * 5 : 0;
        if (k > 0.5) p.armL = p.armR = 'up';
      },
      step(r, k, at, dt, a) {
        if (every(r, 's', at, 0.25)) r.emit({ type: 'star', x: r.scr(a.hx + rand(-12, 12)), y: a.top + rand(-8, 4), vy: -4, life: 0.7 });
        if (once(r, 'b', k > 0.5)) txt(r, '!', r.scr(a.hx + 9), a.top - 6, '#fff', 0.9, -3);
      },
    },
    // A1 60초 도전 — 앉아서 사용자를 보고, 머리 옆에 모래시계가 흐른다 (걸어 둔 자세)
    thourglass: {
      len: 2,
      loop: true,
      pose(p, k) {
        p.lookY = -1;
        p.eyes = 'open';
        p.mouth = 'smile';
        p.ear = 1;
        p.tail = k < 0.5 ? 'idle' : 'flick';
      },
      front(g, a, k, at, c) {
        const x = a.right + 3;
        const y = a.top - 4;
        this.pattern(HOURGLASS, x, y, c);
        // 아래 칸에 모래가 쌓인다 (k 에 따라)
        const fill = Math.floor(k * 3);
        for (let i = 0; i < fill; i++) this.px(x + 3 + (i === 2 ? -1 : i), y + 6, c.Y);
        if (k > 0.2) this.px(x + 3, y + 4, c.Y);
      },
    },

    // ---------- B5 · B6 · B7 ----------
    // 저장: 카드를 접어 옆 가방에 넣는다 (2.4초)
    tbagin: {
      len: 2.4,
      pose(p, k) {
        p.armR = k < 0.7 ? 'front' : 'rest';
        p.lookY = 1;
        p.eyes = k > 0.8 ? 'happy' : 'open';
        p.mouth = k > 0.8 ? 'smile' : 'flat';
        p.tail = 'up';
      },
      front(g, a, k, at, c) {
        const bx = a.right + 4;
        this.pattern(BAG, bx, GROUND - 6, c);
        if (k < 0.8) {
          // 카드: 세로로 접히며(높이 줄며) 가방 쪽으로 내려간다
          const h = Math.max(2, Math.round(7 * (1 - Math.min(k, 0.4) / 0.4 * 0.6)));
          const t = Math.max(0, (k - 0.4) / 0.4);
          const x = Math.round(a.hx + 6 + (bx + 1 - (a.hx + 6)) * t);
          const y = Math.round(a.my - 2 + (GROUND - 4 - (a.my - 2)) * t);
          const rows = ['KKKKK', ...Array(Math.max(0, h - 2)).fill('KWWWK'), 'KKKKK'];
          this.pattern(rows, x, y, c);
        }
      },
      step(r, k, at, dt, a) {
        if (once(r, 'p', k > 0.82)) r.emit({ type: 'spark', x: r.scr(a.right + 7), y: GROUND - 8, life: 0.5 });
      },
    },
    // 돋보기로 바닥을 훑는다 (걸어 둔 자세, 1.6초 한 바퀴)
    tmagnify: {
      len: 1.6,
      loop: true,
      pose(p, k) {
        p.lookY = 1;
        p.lookX = Math.sin(k * Math.PI * 2) > 0 ? 1 : -1;
        p.armR = 'front';
        p.eyes = 'squint';
        p.mouth = 'flat';
        p.ear = 1;
        p.tail = 'flick';
      },
      front(g, a, k, at, c) {
        const sway = Math.round(Math.sin(k * Math.PI * 2) * 5);
        this.pattern(GLASS, a.hx + 2 + sway, a.my + 2, c);
      },
    },
    // 모순 비교: 양손에 종이 두 장을 번갈아 본다 (2.6초)
    tcompare: {
      len: 2.6,
      pose(p, k) {
        p.armL = p.armR = 'up';
        p.lookX = Math.floor(k * 4) % 2 ? 1 : -1;
        p.eyes = k > 0.75 ? 'wide' : 'squint';
        p.mouth = k > 0.75 ? 'o' : 'flat';
        p.ear = k > 0.75 ? 1 : 0;
      },
      front(g, a, k, at, c) {
        this.pattern(PAPER, a.left - 7, a.top - 2, c);
        this.pattern(PAPER, a.right + 3, a.top - 2, c);
      },
      step(r, k, at, dt, a) {
        if (once(r, 'x', k > 0.78)) txt(r, '!', r.scr(a.hx + 9), a.top - 6, '#fff', 0.9, -3);
      },
    },
    // 냉장고 메모: 메모를 들고 위로 붙인다 (2.6초)
    tsticknote: {
      len: 2.6,
      pose(p, k) {
        p.armR = k < 0.75 ? 'up' : 'front';
        p.lookY = -1;
        p.eyes = 'open';
        p.mouth = k > 0.75 ? 'smile' : 'flat';
        p.ear = 1;
        p.tail = 'up';
        p.dy = k > 0.3 && k < 0.75 ? -2 : 0;
      },
      front(g, a, k, at, c) {
        // 손에서 (머리 오른쪽 위) 벽 자리로 (더 위)
        const t = Math.min(1, Math.max(0, (k - 0.3) / 0.45));
        const x = a.right + 1;
        const y = Math.round(a.top - 4 - 7 * t);
        this.pattern(NOTE, x, y, c);
      },
      step(r, k, at, dt, a) {
        if (once(r, 'p', k > 0.76)) r.emit({ type: 'spark', x: r.scr(a.right + 4), y: a.top - 10, life: 0.5 });
      },
    },
    // 졸업: 사각모를 쓰고 폴짝 + 색종이 (2.2초)
    tgradcap: {
      len: 2.2,
      pose(p, k) {
        const j = (k * 2) % 1;
        p.dy = -Math.sin(j * Math.PI) * 6;
        p.eyes = 'happy';
        p.mouth = 'open';
        p.armL = p.armR = 'up';
        p.ear = 1;
        p.tail = 'up';
      },
      front(g, a, k, at, c) {
        this.pattern(CAP, a.hx - 8, a.top - 5, c);
        // 술 (윗판 오른쪽 끝에서 늘어진다)
        for (let j = 0; j < 4; j++) this.px(a.hx + 8, a.top - 3 + j, j === 3 ? c.y : c.Y);
      },
      step(r, k, at, dt, a) {
        if (once(r, 'c', k < 0.1)) for (let i = 0; i < 18; i++) r.emit({ type: 'confetti', x: 24 + rand(-16, 16), y: a.top - 4, vx: rand(-16, 16), vy: rand(-24, -8), ay: 30, life: 1.5, c: CONFETTI[i % CONFETTI.length] });
      },
    },
    // 분필: 바닥에 네모 둘을 그린다 (3초)
    tchalk: {
      len: 3,
      pose(p, k) {
        p.lookY = 1;
        p.lookX = k < 0.5 ? -1 : 1;
        p.armR = 'front';
        p.eyes = 'open';
        p.mouth = 'flat';
        p.tail = 'flick';
      },
      back(g, a, k, at, c) {
        // 왼쪽 네모(0~0.5) → 오른쪽 네모(0.5~1), 점선으로 조금씩
        const box = (x0, prog) => {
          const w = 11;
          const h = 5;
          const pts = [];
          for (let i = 0; i < w; i++) pts.push([x0 + i, GROUND - h]);
          for (let j = 1; j < h; j++) pts.push([x0 + w - 1, GROUND - h + j]);
          for (let i = w - 1; i >= 0; i--) pts.push([x0 + i, GROUND]);
          for (let j = h - 1; j > 0; j--) pts.push([x0, GROUND - h + j]);
          const n = Math.floor(pts.length * Math.min(1, prog));
          // 바탕이 밝은 테마가 많아서 흰 분필 대신 회색으로 (어두운 테마에서도 보인다)
          for (let i = 0; i < n; i++) if (i % 2 === 0) this.px(pts[i][0], pts[i][1], c.g);
        };
        box(a.left - 15, k / 0.5);
        box(a.right + 4, (k - 0.5) / 0.5);
      },
      front(g, a, k, at, c) {
        const side = k < 0.5 ? a.left - 4 : a.right + 2;
        this.pattern(CHALK, side, a.my + 2, c);
      },
    },
  };

  Object.assign(root.PetSprite.MOTIONS, M);
})(window);

;if (window.PetSprite !== undefined) PetSprite = window.PetSprite; if (window.PetSound !== undefined) PetSound = window.PetSound; if (window.I18N !== undefined) I18N = window.I18N;
/* kit/sound.js */
// 8비트 효과음. 파일 없이 WebAudio 사각파로 만든다.
(function (global) {
  let ctx = null;

  const NOTES = { C4: 261.63, E4: 329.63, G4: 392, A4: 440, C5: 523.25, F5: 698.46, B5: 987.77, D6: 1174.66, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G6: 1567.98 };

  const SONGS = {
    levelup: [['C5', 0.08], ['E5', 0.08], ['G5', 0.08], ['C6', 0.18]],
    achieve: [['G5', 0.07], ['C6', 0.07], ['E6', 0.07], ['G6', 0.22]],
    quest: [['E5', 0.07], ['A5', 0.14]],
    evolve: [['C5', 0.06], ['D5', 0.06], ['E5', 0.06], ['G5', 0.06], ['A5', 0.06], ['C6', 0.06], ['E6', 0.06], ['G6', 0.3]],
    pop: [['A5', 0.04]],
    jingle: [['E6', 0.03], ['G6', 0.05]], // 방울공이 구를 때
    bubble: [['G6', 0.025]], // 비눗방울이 톡
    squeak: [['G6', 0.03], ['E6', 0.04]], // 쥐돌이가 찍
    // 2차 장난감
    tick: [['E6', 0.015]], // 수류탄 타이머·줄넘기·타자
    boom: [['G4', 0.05], ['C4', 0.08], ['E4', 0.06], ['C4', 0.22]], // 수류탄 펑
    bonk: [['C6', 0.03], ['G4', 0.07]], // 뿅망치·눈덩이 퍽
    splash: [['D6', 0.02], ['B5', 0.02], ['G5', 0.03]], // 물총
    spin: [['C5', 0.025], ['E5', 0.025], ['G5', 0.025], ['C6', 0.03]], // 레버·부스터·빔
    win: [['C5', 0.06], ['E5', 0.06], ['G5', 0.06], ['C6', 0.06], ['G5', 0.06], ['C6', 0.06], ['E6', 0.24]], // 잭팟
    lose: [['G5', 0.1], ['F5', 0.1], ['E5', 0.1], ['C5', 0.26]], // 꽝
  };

  // 소리가 끝나고 잠시 조용하면 오디오 장치를 쉬게 한다 (켜 두면 CPU·배터리를 계속 쓴다)
  const IDLE_MS = 2000;
  let idleTimer = null;
  let endsAt = 0; // 마지막 소리가 끝나는 시각 (performance.now 기준)
  function sleepLater() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!ctx || ctx.state !== 'running') return;
      if (performance.now() < endsAt) return sleepLater();
      ctx.suspend().catch(() => {});
    }, Math.max(IDLE_MS, endsAt - performance.now() + IDLE_MS));
  }

  function play(name, volume = 0.05) {
    const song = SONGS[name];
    if (!song) return;
    ctx = ctx || new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const total = song.reduce((s, [, len]) => s + len * 0.9, 0) + 0.1;
    endsAt = Math.max(endsAt, performance.now() + total * 1000);
    sleepLater();
    let t = ctx.currentTime + 0.02;
    for (const [note, len] of song) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = NOTES[note];
      gain.gain.setValueAtTime(volume, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + len + 0.02);
      t += len * 0.9;
    }
  }

  global.PetSound = { play };
})(window);

;if (window.PetSprite !== undefined) PetSprite = window.PetSprite; if (window.PetSound !== undefined) PetSound = window.PetSound; if (window.I18N !== undefined) I18N = window.I18N;
/* kit/pet.js */
// 펫 판: 고양이 그리기 · 말풍선(학습 패널) · 카드 · 가리키기 · 물고 가기 · 마우스.
// 고양이는 강사라 제멋대로 돌아다니지 않는다. 수업(goto · carry)이 시키거나 사용자가 들어 옮길 때만 움직인다.
const canvas = document.getElementById('pet');
const bubbleEl = document.getElementById('bubble');
const cardEl = document.getElementById('card');
const pointEl = document.getElementById('point');
const replayEl = document.getElementById('replay');
const fieldEl = document.getElementById('field');
const fctx = fieldEl.getContext('2d');
const sprite = new PetSprite.PetRenderer(canvas);
const T = new I18N.Strings();

let scale = 5;
let soundOn = true;
let mood = 'idle'; // idle · wait(사용자 차례) · busy(요리 중) · sleep
let idlePool = ['stretch', 'loaf', 'lick', 'slowblink'];
let idleTurn = 0;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (v) => String(v).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const rand = (a, b) => a + Math.random() * (b - a);
// **굵게** · `코드` 만 받는 작은 마크다운
const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
const plain = (s) => String(s).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');

// ---------- 설정 ----------

function applyScale() {
  const px = Math.round(PetSprite.GRID * scale);
  canvas.style.width = `${px}px`;
  canvas.style.height = `${px}px`;
  placeCat();
  placeOverlays();
}

pet.onConfig((c) => {
  scale = c.scale || 5;
  soundOn = c.sound !== false;
  T.set(c.language);
  document.documentElement.lang = T.locale;
  sprite.setFur(c.fur || 'cheese');
  sprite.setEars(c.ears || 'perk');
  sprite.setAccessory('none');
  applyScale();
  if (catX == null) {
    catX = c.startX != null ? c.startX : homeX();
    placeCat();
  }
});

pet.onReset(() => {
  catX = homeX();
  catLift = 0;
  catVy = 0;
  sprite.setMove(0);
  placeCat();
});

pet.onAction((a) => {
  if (dragging || lifted) return;
  sprite.play(a);
});
pet.onSound((s) => soundOn && PetSound.play(s));

// ---------- 기분 ----------

function applyMood() {
  if (mood === 'sleep') {
    sprite.setMood('sleeping');
    sprite.setToyPose(null);
  } else if (mood === 'busy') {
    sprite.setMood('idle');
    if (!prop) sprite.setToyPose('ttype');
  } else {
    sprite.setMood('idle');
    if (!prop) sprite.setToyPose(null);
  }
  sprite.setMove(0);
}
pet.onMood((m) => {
  mood = m || 'idle';
  if (mood === 'sleep' && sprite.action) sprite.cancel();
  applyMood();
});

let prop = null;
pet.onProp(({ key, on }) => {
  // '*' 끄기: 걸어 둔 자세를 전부 내린다 (수업이 중간에 멈출 때)
  if (key === '*') {
    prop = null;
    sprite.setToyPose(mood === 'busy' ? 'ttype' : null);
    return;
  }
  const k = 't' + key;
  if (on && PetSprite.MOTIONS[k]) {
    prop = k;
    sprite.setToyPose(k);
  } else if (!on && prop === k) {
    prop = null;
    sprite.setToyPose(mood === 'busy' ? 'ttype' : null);
  }
});

// ---------- 인포그래픽 ----------
// 호스트가 { kind, labels: [...] } 로 보낸다. 글은 전부 labels 에서 (언어는 호스트가 고른다)

function figureHtml(f) {
  if (!f || !f.kind) return '';
  const L = (i) => esc((f.labels || [])[i] || '');
  switch (f.kind) {
    // 방 세 개: raw(나) → wiki(AI) + 규칙
    case 'rooms':
      return `<div class="fig-row">
        <div class="fig-box me"><span class="ico">📥</span><span class="name">raw/</span><span class="sub">${L(0)}</span></div>
        <div class="fig-arrow">→</div>
        <div class="fig-box ai"><span class="ico">📚</span><span class="name">wiki/</span><span class="sub">${L(1)}</span></div>
        <div class="fig-box"><span class="ico">📋</span><span class="name">AGENTS.md</span><span class="sub">${L(2)}</span></div>
      </div><div class="fig-note">${L(3)}</div>`;
    // ingest: 재료 하나 → 쪽 여럿
    case 'ingest':
      return `<div class="fig-row">
        <div class="fig-box me"><span class="ico">📄</span><span class="name">${L(0)}</span><span class="sub">raw/</span></div>
        <div class="fig-arrow">→</div>
        <div class="fig-box ai"><span class="ico">📝</span><span class="name">${L(1)}</span></div>
        <div class="fig-box ai"><span class="ico">💡</span><span class="name">${L(2)}</span></div>
        <div class="fig-box ai"><span class="ico">📋</span><span class="name">${L(3)}</span></div>
        <div class="fig-box ai"><span class="ico">🧾</span><span class="name">${L(4)}</span></div>
      </div><div class="fig-note">${L(5)}</div>`;
    // 동작 셋
    case 'ops':
      return `<div class="fig-row">
        <div class="fig-box ai"><span class="ico">🍳</span><span class="name">ingest</span><span class="sub">${L(0)}</span></div>
        <div class="fig-box ai"><span class="ico">❓</span><span class="name">query</span><span class="sub">${L(1)}</span></div>
        <div class="fig-box ai"><span class="ico">🧹</span><span class="name">lint</span><span class="sub">${L(2)}</span></div>
      </div>`;
    // 마크다운 입력 → 결과
    case 'markdown':
      return `<div class="fig-md">
        <code># ${L(0)}</code><span class="arrow">→</span><span class="out h">${L(0)}</span>
        <code>- ${L(1)}</code><span class="arrow">→</span><span class="out li">${L(1)}</span>
        <code>**${L(2)}**</code><span class="arrow">→</span><span class="out b"><b>${L(2)}</b></span>
        <code>[[${L(3)}]]</code><span class="arrow">→</span><span class="out" style="color:var(--accent2);text-decoration:underline">${L(3)}</span>
      </div>`;
    // 종이 두 장 사이 실
    case 'links':
      return `<div class="fig-link"><span class="sheet">${L(0)}</span><span class="thread"></span><span class="sheet">${L(1)}</span></div><div class="fig-note">${L(2)}</div>`;
    // 매일 순환
    case 'loop':
      return `<div class="fig-loop"><span class="step">${L(0)}</span><span>→</span><span class="step ai">${L(1)}</span><span>→</span><span class="step">${L(2)}</span><span>↺</span></div><div class="fig-note">${L(3)}</div>`;
    // 나 / AI 역할
    case 'roles':
      return `<div class="fig-row">
        <div class="fig-box me"><span class="ico">🙂</span><span class="name">${L(0)}</span><span class="sub">${L(1)}</span></div>
        <div class="fig-box ai"><span class="ico">🤖</span><span class="name">${L(2)}</span><span class="sub">${L(3)}</span></div>
      </div>`;
    default:
      return '';
  }
}

// ---------- 말풍선 ----------
// 수업 말은 사용자가 넘길 때까지 그대로 있다 (충분히 읽게).
// 넘기기: 말풍선 아무 데나 한 번 클릭(우측 하단 "다음 →" 포함). 되돌아보기: 좌측 하단 "← 이전" 만.
// 'status'(쓰는 중… 같은 진행 표시)만 ms 뒤에 저절로 사라진다.

const queue = [];
let current = null; // 엔진이 끝나기를 기다리는 말
let hideTimer = null;
let typeTimer = null;
const past = []; // 보여 준 수업 말 (이전 · 다시 보기). current 도 같은 객체로 들어 있다
let viewAt = null; // 지난 말을 보는 중이면 past 의 번호
let lastNav = 0;
const navEl = bubbleEl.querySelector('.nav');
const prevEl = bubbleEl.querySelector('.prev');
const nextEl = bubbleEl.querySelector('.next');

pet.onBubble((b) => {
  if (b.kind === 'notify') queue.unshift(b);
  else queue.push(b);
  if (!current) nextBubble();
});
pet.onBubbleClear(() => {
  queue.length = 0;
  if (viewAt != null) applyPoint(livePoint);
  viewAt = null;
  if (current) {
    current = null;
    nextBubble();
  } else if (!bubbleEl.hidden) hideBubble();
});

function endBubble(reason) {
  if (!current) return;
  const c = current;
  current = null;
  if (c.id) pet.bubbleEnd(c.id, reason);
}

function hideBubble() {
  clearTimeout(hideTimer);
  clearInterval(typeTimer);
  typeTimer = null;
  bubbleEl.classList.remove('show');
  setTimeout(() => !current && viewAt == null && (bubbleEl.hidden = true), 150);
}

function nextBubble() {
  clearTimeout(hideTimer);
  clearInterval(typeTimer);
  typeTimer = null;
  viewAt = null;
  current = queue.shift() || null;
  if (!current) return hideBubble();
  if (current.kind === 'lesson' || current.kind === 'cheer') {
    current.point = livePoint;
    past.push(current);
    if (past.length > 80) past.shift();
  }
  if (current.kind === 'notify' && !sprite.action) sprite.play('perk');
  show(current, true);
  if (soundOn) PetSound.play('pop', 0.015);
  if (current.kind === 'status') {
    hideTimer = setTimeout(() => {
      endBubble('auto');
      bubbleEl.classList.remove('show');
      hideTimer = setTimeout(nextBubble, 220);
    }, current.ms > 0 ? current.ms : 1500);
  }
}

// b 를 그린다. type: 한 글자씩 쳐 가며 (처음 보여 줄 때만)
function show(b, type) {
  clearInterval(typeTimer);
  typeTimer = null;
  const live = b === current;
  const textEl = bubbleEl.querySelector('.text');
  bubbleEl.className = 'bubble show' + (b.kind === 'cheer' ? ' cheer' : '') + (live ? '' : ' past');
  if (type) bubbleEl.classList.remove('show');
  bubbleEl.querySelector('.title').textContent = b.title || '';
  bubbleEl.querySelector('.figure').innerHTML = figureHtml(b.figure);
  const choices = bubbleEl.querySelector('.choices');
  choices.innerHTML = '';
  if (live && b.ask && Array.isArray(b.choices)) {
    b.choices.slice(0, 2).forEach((label, i) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!current || !current.ask) return;
        pet.bubbleReply(current.ask, i);
        current = null;
        nextBubble();
      });
      choices.appendChild(btn);
    });
  }
  const at = past.lastIndexOf(b);
  const status = b.kind === 'status';
  prevEl.textContent = !status && (at > 0 || (at < 0 && past.length)) ? T.t('pet.prev') : '';
  nextEl.textContent = status || (live && b.ask) ? '' : T.t('pet.next');
  nextEl.title = T.t('pet.nextTip');
  navEl.hidden = !prevEl.textContent && !nextEl.textContent;
  bubbleEl.hidden = false;
  replayEl.hidden = true;
  applyPoint(live || !past.includes(b) ? livePoint : b.point || null);

  const full = String(b.text || '');
  const chars = [...plain(full)];
  let i = 0;
  if (!type) {
    textEl.innerHTML = inline(full);
    placeOverlays();
    return;
  }
  textEl.textContent = '';
  placeOverlays();
  requestAnimationFrame(() => bubbleEl.classList.add('show'));
  typeTimer = setInterval(() => {
    textEl.textContent = chars.slice(0, ++i).join('');
    if (i >= chars.length) {
      clearInterval(typeTimer);
      typeTimer = null;
      textEl.innerHTML = inline(full);
    }
    placeOverlays();
  }, 24);
}

// 빨리 두 번 눌러(더블클릭 포함) 두 칸 넘어가지 않게 잠깐 막는다
function navOk() {
  const now = performance.now();
  if (now - lastNav < 400) return false;
  lastNav = now;
  return true;
}

function goPrev() {
  let at = viewAt != null ? viewAt : current ? past.lastIndexOf(current) : past.length;
  if (at < 0) at = past.length;
  if (at <= 0) return;
  viewAt = at - 1;
  show(past[viewAt], false);
}

function goNext() {
  if (viewAt != null) {
    const n = viewAt + 1;
    if (n < past.length && past[n] !== current) {
      viewAt = n;
      show(past[n], false);
      return;
    }
    viewAt = null;
    if (current) show(current, false);
    else {
      applyPoint(livePoint);
      hideBubble();
    }
    return;
  }
  if (!current || current.ask) return;
  endBubble('click');
  nextBubble();
}

prevEl.addEventListener('click', (e) => {
  e.stopPropagation();
  if (navOk()) goPrev();
});
nextEl.addEventListener('click', (e) => {
  e.stopPropagation();
  if (navOk()) goNext();
});
// 본문 아무 데나 한 번 누르면 넘어간다 (치는 중이어도). 질문 말풍선은 선택지를 눌러야 넘어간다
bubbleEl.addEventListener('click', (e) => {
  if (e.target.closest('button')) return;
  if (navOk()) goNext();
});

// 직전 말 다시 보기: 고양이 위에 마우스가 오면 1.5초만 뜬다. 다시 보려면 고양이 밖으로 나갔다 와야 한다
replayEl.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!past.length || current) return;
  clearTimeout(replayTimer);
  viewAt = past.length - 1;
  show(past[viewAt], false);
});
let replayTimer = null;
let replayArmed = true;
function replayTick() {
  replayTimer = null;
  if (replayEl.matches(':hover')) {
    replayTimer = setTimeout(replayTick, 300);
    return;
  }
  replayEl.hidden = true;
}
function updateReplay() {
  if (!overPetNow && !replayEl.matches(':hover')) replayArmed = true;
  const want = overPetNow && past.length > 0 && !current && viewAt == null && bubbleEl.hidden && cardEl.hidden;
  if (!want || !replayArmed || !replayEl.hidden) return;
  replayArmed = false;
  replayEl.textContent = T.t('pet.replay');
  replayEl.hidden = false;
  placeOverlays();
  clearTimeout(replayTimer);
  replayTimer = setTimeout(replayTick, 1500);
}

// ---------- 카드 ----------

let card = null;
pet.onCard((c) => {
  card = c;
  cardEl.querySelector('.card-title').textContent = c.title || '';
  cardEl.querySelector('.card-title').hidden = !c.title;
  const body = cardEl.querySelector('.card-body');
  body.innerHTML = String(c.body || '')
    .split(/\n{2,}|\n/)
    .filter((s) => s.trim())
    .map((s) => `<p>${inline(s)}</p>`)
    .join('');
  cardEl.querySelector('.figure').innerHTML = figureHtml(c.figure);
  const btns = cardEl.querySelector('.card-buttons');
  btns.innerHTML = '';
  (c.buttons || []).forEach((label, i) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (i === 0) b.className = 'primary';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      closeCard(i);
    });
    btns.appendChild(b);
  });
  cardEl.querySelector('.hint').textContent = (c.buttons || []).length ? '' : T.t('pet.clickNext');
  cardEl.hidden = false;
  replayEl.hidden = true;
  placeOverlays();
  requestAnimationFrame(() => cardEl.classList.add('show'));
});
function closeCard(i) {
  if (!card) return;
  const c = card;
  card = null;
  cardEl.classList.remove('show');
  setTimeout(() => !card && (cardEl.hidden = true), 150);
  pet.cardReply(c.id, i);
}
cardEl.addEventListener('click', () => {
  if (card && !(card.buttons || []).length) closeCard(-1);
});

// ---------- 가리키기 ----------
// 라벨은 DOM, 화살표(곡선 + 촉)와 과녁(맥박 고리)은 #field 캔버스에 매 프레임 그린다

// 수업 말풍선은 처음 뜰 때 그때 가리키던 자리를 기억해 둔다(b.point). "← 이전"으로 지난 말을 보면 그 자리를 다시 가리키고,
// 지금 말로 돌아오면 호스트가 지금 가리키라는 자리(livePoint)로 돌아간다.
let livePoint = null; // 호스트가 지금 가리키라는 자리 { x, y, dir, box?, label, since }
let pointState = null; // 지금 그리는 자리. dir 'box' 는 넓은 자리를 깜빡이는 테두리로 감싼다
pet.onPoint((p) => {
  if (!p || !p.on) livePoint = null;
  else {
    livePoint = { x: p.x, y: p.y, dir: p.dir || 'up', box: p.box || null, label: p.label || '', since: p.keep && livePoint ? livePoint.since : performance.now() };
    // 지금 말풍선이 뜬 뒤에 자리만 옮겨진 거면(창 크기 등) 그 말풍선의 기억도 새 자리로
    if (p.keep && current && current.point) current.point = livePoint;
  }
  if (viewAt == null) applyPoint(livePoint);
});

function applyPoint(p) {
  pointState = p ? { ...p } : null;
  pointEl.textContent = p ? p.label : '';
  pointEl.hidden = !p || !p.label;
  placePointLabel();
}

// 라벨 자리: 과녁에서 조금 떨어진 곳 (왼쪽을 가리키면 오른쪽에, 위를 가리키면 아래에)
function placePointLabel() {
  const p = pointState;
  if (!p || pointEl.hidden) return;
  const w = pointEl.offsetWidth;
  const h = pointEl.offsetHeight;
  let left;
  let top;
  if (p.box) {
    // 상자 안 왼쪽 위. 상자가 좁으면(아이콘 줄) 상자 오른쪽 바깥
    const b = p.box;
    left = b.w < w + 24 ? b.x + b.w + 8 : b.x + 10;
    top = b.y + 10;
  } else if (p.dir === 'left') {
    left = p.x + 46;
    top = p.y + 14;
  } else if (p.dir === 'down') {
    left = p.x - w / 2;
    top = p.y - 60 - h;
  } else {
    left = p.x - w / 2 + 40;
    top = p.y + 48;
  }
  left = clamp(left, 4, window.innerWidth - w - 4);
  top = clamp(top, 4, window.innerHeight - h - 4);
  pointEl.style.left = `${Math.round(left)}px`;
  pointEl.style.top = `${Math.round(top)}px`;
  p.lx = left;
  p.ly = top;
  p.lw = w;
  p.lh = h;
}

function drawPointer(now) {
  fctx.clearRect(0, 0, fieldEl.width, fieldEl.height);
  const p = pointState;
  if (!p) return;
  const t = (now - p.since) / 1000;
  const ACC = '#d97757';
  if (p.box) {
    // 깜빡이는 테두리 상자 (안쪽으로 3px, 둥근 모서리)
    const b = p.box;
    const on = 0.5 + 0.5 * Math.cos((t * Math.PI * 2) / 1.1);
    const x = b.x + 3;
    const y = b.y + 3;
    const w = Math.max(0, b.w - 6);
    const h = Math.max(0, b.h - 6);
    const rr = Math.min(10, w / 2, h / 2);
    fctx.beginPath();
    fctx.moveTo(x + rr, y);
    fctx.arcTo(x + w, y, x + w, y + h, rr);
    fctx.arcTo(x + w, y + h, x, y + h, rr);
    fctx.arcTo(x, y + h, x, y, rr);
    fctx.arcTo(x, y, x + w, y, rr);
    fctx.closePath();
    fctx.fillStyle = `rgba(217,119,87,${0.04 + on * 0.06})`;
    fctx.fill();
    fctx.lineWidth = 3;
    fctx.strokeStyle = `rgba(217,119,87,${0.25 + on * 0.75})`;
    fctx.stroke();
    return;
  }
  // 미니멀: 가는 선 하나 · 열린 촉 · 작은 점 · 얇은 맥박 고리 하나
  const k = (t % 1.4) / 1.4;
  fctx.beginPath();
  fctx.arc(p.x, p.y, 5 + k * 16, 0, Math.PI * 2);
  fctx.lineWidth = 2;
  fctx.strokeStyle = `rgba(217,119,87,${(1 - k) * 0.55})`;
  fctx.stroke();
  fctx.beginPath();
  fctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
  fctx.fillStyle = ACC;
  fctx.fill();
  if (pointEl.hidden || p.lx == null) return;
  // 라벨 가장자리에서 점까지 직선 + 열린 촉
  const sx = p.dir === 'left' ? p.lx : p.lx + p.lw / 2;
  const sy = p.dir === 'left' ? p.ly + p.lh / 2 : p.dir === 'down' ? p.ly + p.lh : p.ly;
  const ex = p.x + (p.dir === 'left' ? 10 : 0);
  const ey = p.y + (p.dir === 'up' ? 10 : p.dir === 'down' ? -10 : 0);
  fctx.lineWidth = 2.5;
  fctx.lineCap = 'round';
  fctx.lineJoin = 'round';
  fctx.strokeStyle = ACC;
  fctx.beginPath();
  fctx.moveTo(sx, sy);
  fctx.lineTo(ex, ey);
  fctx.stroke();
  const ang = Math.atan2(ey - sy, ex - sx);
  fctx.beginPath();
  fctx.moveTo(ex - Math.cos(ang - 0.6) * 11, ey - Math.sin(ang - 0.6) * 11);
  fctx.lineTo(ex, ey);
  fctx.lineTo(ex - Math.cos(ang + 0.6) * 11, ey - Math.sin(ang + 0.6) * 11);
  fctx.stroke();
}

// ---------- 서 있기 · 걷기 ----------

let catX = null;
let catLift = 0;
let catVy = 0;
let catVx = 0;
let lifted = false;
let nextIdleMotion = performance.now() + 30000;

const petPx = () => Math.round(PetSprite.GRID * scale);
const cellPx = () => petPx() / PetSprite.GRID;

function lane() {
  const half = petPx() / 2;
  return [half, Math.max(half, window.innerWidth - half)];
}
const homeX = () => Math.max(petPx() / 2, window.innerWidth - petPx() / 2 - 90);

const shadowEl = document.createElement('canvas');
shadowEl.id = 'floor-shadow';
document.body.appendChild(shadowEl);
function updateFloorShadow() {
  const cell = cellPx();
  const air = catX != null && catLift > cell * 1.5;
  sprite.floorShadow = air;
  shadowEl.hidden = !air;
  if (!air) return;
  const G = PetSprite.GRID;
  const GROUND = PetSprite.util.GROUND;
  const h = catLift / cell;
  const rx = (sprite._shadow && sprite._shadow[1]) || 8;
  const w = Math.max(2, rx * (0.95 - Math.min(h, 12) * 0.045));
  if (shadowEl.width !== G) {
    shadowEl.width = G;
    shadowEl.height = 2;
  }
  const ctx = shadowEl.getContext('2d');
  ctx.clearRect(0, 0, G, 2);
  ctx.fillStyle = 'rgba(30,15,8,0.22)';
  const cx = G / 2;
  for (let x = Math.round(cx - w); x <= Math.round(cx + w); x++) {
    ctx.fillRect(x, 0, 1, 1);
    if (Math.abs(x - cx) < w - 2) ctx.fillRect(x, 1, 1, 1);
  }
  shadowEl.style.opacity = String(Math.max(0.35, 1 - catLift / (window.innerHeight * 0.9)));
  shadowEl.style.width = `${petPx()}px`;
  shadowEl.style.height = `${2 * cell}px`;
  shadowEl.style.left = `${Math.round(catX - petPx() / 2)}px`;
  shadowEl.style.bottom = `${Math.round((G - GROUND - 3) * cell)}px`;
}

function placeCat() {
  if (catX == null) return;
  const [min, max] = lane();
  catX = Math.max(min, Math.min(max, catX));
  canvas.style.left = `${Math.round(catX - petPx() / 2)}px`;
  canvas.style.bottom = `${Math.round(catLift)}px`;
}

function walkTo(goal, dt, fast = 1, stop = 0) {
  const [min, max] = lane();
  goal = clamp(goal, min, max);
  const dx = goal - catX;
  const dist = Math.abs(dx);
  const speed = dist <= stop ? 0 : (dist > 500 ? 300 : dist > 140 ? 190 : 110) * fast;
  if (speed) {
    catX = clamp(catX + Math.sign(dx) * Math.min(speed * dt, dist), min, max);
    sprite.setMove(Math.sign(dx) * speed);
  } else sprite.setMove(0);
  placeCat();
  return Math.abs(goal - catX);
}

function face(x) {
  if (Math.abs(x - catX) > 2) sprite.setFacing(Math.sign(x - catX));
}

window.addEventListener('resize', () => {
  placeCat();
  fieldEl.width = window.innerWidth;
  fieldEl.height = window.innerHeight;
  placePointLabel();
  placeOverlays();
});

// ---------- 어디로 가기 · 물고 가기 ----------

let goto = null;
let carry = null;
let paperEl = null;

pet.onGoto((g) => {
  if (sprite.action && PetSprite.PetRenderer.isMotion(sprite.action)) sprite.cancel();
  goto = { id: g.id, x: g.x, run: !!g.run };
});

pet.onCarry((c) => {
  goto = null;
  carry = { id: c.id, from: c.from, to: c.to, phase: 'go', until: 0 };
});

function makePaper() {
  const el = document.createElement('div');
  el.className = 'paper';
  document.body.appendChild(el);
  return el;
}

function placePaper() {
  if (!paperEl || catX == null) return;
  const P = petPx();
  paperEl.style.left = `${Math.round(catX + sprite.facing * P * 0.28 - 9)}px`;
  paperEl.style.bottom = `${Math.round(catLift + P * 0.3)}px`;
}

function stepGoto(dt) {
  const d = walkTo(goto.x, dt, goto.run ? 1.5 : 1, 2);
  if (d <= 2) {
    sprite.setMove(0);
    sprite.setFacing(1);
    const g = goto;
    goto = null;
    pet.arrived(g.id);
  }
}

function stepCarry(dt, now) {
  const c = carry;
  if (c.phase === 'go') {
    if (walkTo(c.from, dt, 1.3, 4) <= 4) {
      sprite.setMove(0);
      face(c.from);
      sprite.play('pounce');
      c.phase = 'pick';
      c.until = now + 500;
    }
    return;
  }
  if (c.phase === 'pick') {
    if (now < c.until) return;
    paperEl = paperEl || makePaper();
    paperEl.hidden = false;
    sprite.setToyPose('tcarry');
    c.phase = 'carry';
    return;
  }
  if (c.phase === 'carry') {
    placePaper();
    if (walkTo(c.to, dt, 0.9, 4) <= 4) {
      sprite.setMove(0);
      face(c.to);
      sprite.setToyPose(prop || (mood === 'busy' ? 'ttype' : null));
      if (paperEl) {
        const r = paperEl.getBoundingClientRect();
        flyPaper(r.left, r.top, catX + sprite.facing * petPx() * 0.4 - 9, window.innerHeight - 24, 450, true);
        paperEl.remove();
        paperEl = null;
      }
      sprite.play('happy');
      c.phase = 'drop';
      c.until = now + 700;
    }
    return;
  }
  if (c.phase === 'drop' && now >= c.until) {
    carry = null;
    sprite.setFacing(1);
    pet.arrived(c.id);
  }
}

// ---------- 효과 ----------

const flights = [];
function flyPaper(x0, y0, x1, y1, dur = 900, fade = false) {
  const el = makePaper();
  el.style.left = `${Math.round(x0)}px`;
  el.style.top = `${Math.round(y0)}px`;
  el.style.bottom = '';
  flights.push({ el, x0, y0, x1, y1, t0: performance.now(), dur, fade });
}
function stepFlights(now) {
  for (let i = flights.length - 1; i >= 0; i--) {
    const f = flights[i];
    const k = clamp((now - f.t0) / f.dur, 0, 1);
    const e = 1 - (1 - k) * (1 - k);
    const arc = -Math.sin(k * Math.PI) * 60;
    f.el.style.left = `${Math.round(f.x0 + (f.x1 - f.x0) * e)}px`;
    f.el.style.top = `${Math.round(f.y0 + (f.y1 - f.y0) * e + arc)}px`;
    if (f.fade) f.el.style.opacity = String(1 - k);
    if (k >= 1) {
      f.el.remove();
      flights.splice(i, 1);
    }
  }
}

pet.onFx((f) => {
  if (!f) return;
  if (f.type === 'paper') {
    const P = petPx();
    const from = f.from || { x: catX, y: window.innerHeight - catLift - P * 0.5 };
    flyPaper(from.x - 9, from.y - 11, (f.to ? f.to.x : catX) - 9, (f.to ? f.to.y : 0) - 11, f.ms || 900, true);
  } else if (f.type === 'confetti') {
    if (!dragging && !lifted) sprite.play('tcheer');
    if (soundOn) PetSound.play('achieve');
  }
});

// ---------- 심심할 때 (그 자리에서 잔동작만. 돌아다니지 않는다) ----------

function stepIdle(now) {
  if (catX == null) return;
  sprite.setMove(0);
  if (now < nextIdleMotion) return;
  const pick = idlePool[idleTurn++ % idlePool.length];
  const M = PetSprite.MOTIONS[pick];
  nextIdleMotion = now + 60000 + Math.random() * 90000;
  if (M && !sprite.busy() && !current && !card && mood === 'idle') sprite.play(pick, { times: M.loop ? 2 : 1 });
}

// ---------- 말풍선 · 카드 · 다시 보기 자리 ----------
// 머리 높이는 자세와 상관없이 고정이라, 폴짝 뛰거나 소품을 들어도 말풍선이 흔들리지 않는다.
// 고양이는 48칸 격자의 아래쪽 1/3 에 서 있다(바닥 46행, 앉은 자세 귀 끝 32행 = 칸의 33%). 소품을 들어도 가리지 않게 42%

function headFixed() {
  return catLift + petPx() * 0.42;
}

function placeOverlays() {
  if (catX == null) return;
  const keepInX = (el) => {
    const half = el.offsetWidth / 2 + 6;
    return Math.round(Math.max(half, Math.min(window.innerWidth - half, catX)));
  };
  const headPx = headFixed();
  let stack = 0;
  if (!bubbleEl.hidden) {
    const h = bubbleEl.offsetHeight;
    const top = window.innerHeight - 4;
    let bottom = headPx + 8;
    let below = false;
    if (bottom + h + 10 > top) {
      const under = catLift - h - 12;
      if (under >= 4) {
        bottom = under;
        below = true;
      } else bottom = Math.max(4, top - h - 10);
    }
    bubbleEl.classList.toggle('below', below);
    bubbleEl.style.bottom = `${Math.round(bottom)}px`;
    const x = keepInX(bubbleEl);
    bubbleEl.style.left = `${x}px`;
    const room = Math.max(0, bubbleEl.offsetWidth / 2 - 16);
    bubbleEl.style.setProperty('--tail-x', `${Math.round(clamp(catX - x, -room, room))}px`);
    stack = h + 18;
  }
  if (!cardEl.hidden) {
    const h = cardEl.offsetHeight;
    const bottom = Math.max(8, Math.min(window.innerHeight - h - 8, headPx + 10 + stack));
    cardEl.style.bottom = `${Math.round(bottom)}px`;
    cardEl.style.left = `${keepInX(cardEl)}px`;
  }
  if (!replayEl.hidden) {
    replayEl.style.left = `${Math.round(clamp(catX + petPx() * 0.2, 4, window.innerWidth - replayEl.offsetWidth - 4))}px`;
    replayEl.style.bottom = `${Math.round(headPx + 2)}px`;
  }
}

// ---------- 들어 올리기 ----------

const GRAVITY = 1500;
const swing = { a: 0, va: 0, l: 0, vl: 0, x: 0, v: 0, px: 24, py: 38 };
const HELD_ESCAPE_MS = 10000;
let liftAt = 0;
let fallFrom = 0;

function grabSwing(pressInfo) {
  const cell = cellPx();
  swing.a = swing.va = swing.l = swing.vl = swing.v = 0;
  swing.x = catX;
  swing.px = clamp(24 + pressInfo.dx / cell, 18, 30);
  swing.py = clamp(PetSprite.GRID - pressInfo.dy / cell, 34, 40);
}

function stepSwing(dt) {
  if (!lifted) return;
  const P = petPx();
  const L = P * 0.55;
  const v = (catX - swing.x) / Math.max(dt, 0.001);
  swing.x = catX;
  const dv = clamp(v - swing.v, -2500, 2500);
  swing.v = v;
  swing.va += (dv / L) * Math.cos(swing.a) * 0.4;
  swing.va += (-(GRAVITY / L) * Math.sin(swing.a) - 6 * swing.va) * dt;
  swing.a = clamp(swing.a + swing.va * dt, -0.4, 0.4);
  swing.vl += ((swing.a - swing.l) * 320 - swing.vl * 24) * dt;
  swing.l += swing.vl * dt;
  const heldFor = dragging ? performance.now() - liftAt : 0;
  const struggle = heldFor > 4000 && catLift > 6;
  if (dragging && heldFor > HELD_ESCAPE_MS && catLift > 6) return escapeHold();
  sprite.setHeld(catLift > 6 ? { rot: swing.a, legs: clamp((swing.a - swing.l) * 9, -2, 2), px: swing.px, py: swing.py, struggle } : null);
}

function escapeHold() {
  dragging = false;
  press = null;
  document.body.classList.remove('dragging');
  pet.drag('end', { x: catX });
  resyncHover();
  fallFrom = catLift;
  catVy = -220;
  catVx = (Math.random() < 0.5 ? -1 : 1) * 120;
  sprite.setHeld(null);
}

function stepFall(dt) {
  if (dragging || catLift <= 0) return;
  catVy += GRAVITY * dt;
  catLift = Math.max(0, catLift - catVy * dt);
  if (catVx) {
    const [min, max] = lane();
    catX = clamp(catX + catVx * dt, min, max);
    if (catX <= min || catX >= max) catVx = -catVx * 0.4;
  }
  if (!catLift) {
    catVy = 0;
    catVx = 0;
    if (lifted) {
      lifted = false;
      sprite.setHeld(null);
      const P = petPx();
      if (fallFrom > P * 1.6) sprite.play('land');
      else if (fallFrom > P * 0.4 && !sprite.action) sprite.play('perk');
      fallFrom = 0;
    }
  }
  placeCat();
}

// ---------- 그리기 루프 ----------

const offscreen = () => document.hidden || !!(window.frameElement && !window.frameElement.getClientRects().length);
let lastLoop = performance.now();
let loopTimer = null;
let lastHoverCheck = 0;
function loop() {
  loopTimer = null;
  const now = performance.now();
  const dt = Math.min(0.2, (now - lastLoop) / 1000);
  lastLoop = now;
  if (document.hidden) return;
  if (offscreen()) {
    loopTimer = setTimeout(loop, 160);
    return;
  }
  stepFall(dt);
  stepSwing(dt);
  stepFlights(now);
  if (dragging || lifted) sprite.setMove(0);
  else if (goto) stepGoto(dt);
  else if (carry) stepCarry(dt, now);
  else {
    stepIdle(now);
    if (mood === 'wait' && mouseX != null && Math.abs(mouseX - catX) < 400 && !sprite.action) face(mouseX);
  }
  updateFloorShadow();
  sprite.frame();
  drawPointer(now);
  if (dragging || lifted || catLift > 0) placeOverlays();
  if (over && now - lastHoverCheck > 120) {
    lastHoverCheck = now;
    recheckHover();
  }
  loopTimer = setTimeout(loop, loopDelay(now));
}

function loopDelay(now) {
  const moving = dragging || press || goto || carry || flights.length || sprite.move || sprite.busy() || catLift > 0 || pointState;
  if (moving) return 33;
  if (mood === 'sleep') return 160;
  if (now - lastMouseMove < 1500 || current || card) return 55;
  return 100;
}

function wakeLoop() {
  if (loopTimer || document.hidden) return;
  lastLoop = performance.now();
  loop();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(loopTimer);
    loopTimer = null;
  } else wakeLoop();
});

// ---------- 마우스 ----------

let over = false;
let overPetNow = false;
let press = null;
let dragging = false;
let mouseX = null;
let mouseY = null;
let lastMouseMove = performance.now();

function isOverPet(e) {
  const r = canvas.getBoundingClientRect();
  return sprite.hit(((e.clientX - r.left) / r.width) * PetSprite.GRID, ((e.clientY - r.top) / r.height) * PetSprite.GRID);
}
function isOverEl(el, e, pad = 0) {
  if (el.hidden) return false;
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + 8 + pad;
}
function setOver(v) {
  if (v === over) return;
  over = v;
  pet.hover(v);
}
function hoverTest(e) {
  overPetNow = isOverPet(e);
  const r = overPetNow || isOverEl(bubbleEl, e) || isOverEl(cardEl, e) || isOverEl(replayEl, e, 6);
  updateReplay();
  return r;
}
function recheckHover() {
  if (dragging || press || mouseX == null) return;
  setOver(hoverTest({ clientX: mouseX, clientY: mouseY }));
}
function resyncHover() {
  over = false;
  recheckHover();
}

const GAZE_RANGE = 340;
function updateGaze() {
  if (mouseX == null || catX == null) return (sprite.gaze = null);
  const P = petPx();
  const dx = mouseX - catX;
  const dy = mouseY - (window.innerHeight - catLift - P * 0.5);
  if (Math.hypot(dx, dy) > GAZE_RANGE) return (sprite.gaze = null);
  const step = (v) => (Math.abs(v) < P * 0.18 ? 0 : Math.sign(v));
  sprite.gaze = { x: step(dx), y: step(dy) };
}

const RUB_MS = 2500;
const RUB_GAP = 900;
const rub = { x: null, dir: 0, since: 0, last: 0, flips: 0, until: 0 };
function nearBody(e) {
  const r = canvas.getBoundingClientRect();
  return Math.abs(e.clientX - (r.left + r.width / 2)) < r.width * 0.35 && e.clientY > r.top + r.height * 0.4 && e.clientY < r.bottom;
}
function trackRub(e) {
  const now = performance.now();
  if (press || dragging || now < rub.until || !nearBody(e)) {
    rub.x = null;
    rub.since = 0;
    return;
  }
  if (rub.x != null) {
    const dx = e.clientX - rub.x;
    if (Math.abs(dx) >= 2) {
      const dir = Math.sign(dx);
      if (rub.dir && dir !== rub.dir) {
        if (!rub.since || now - rub.last > RUB_GAP) {
          rub.since = now;
          rub.flips = 0;
        }
        rub.flips++;
        rub.last = now;
      }
      rub.dir = dir;
    }
  }
  rub.x = e.clientX;
  if (rub.since && now - rub.last > RUB_GAP) rub.since = 0;
  if (rub.since && now - rub.since >= RUB_MS && rub.flips >= 4) {
    rub.since = 0;
    rub.until = now + 3500;
    sprite.play('purr');
    pet.rub();
  }
}

window.addEventListener('mousemove', (e) => {
  if (e.clientX !== mouseX || e.clientY !== mouseY) lastMouseMove = performance.now();
  if (e.buttons === 0 && dragging) onMouseUp(e);
  else if (e.buttons === 0 && press) press = null;
  mouseX = e.clientX;
  mouseY = e.clientY;
  updateGaze();
  trackRub(e);
  if (press && !press.noDrag && !dragging && Math.hypot(e.screenX - press.x, e.screenY - press.y) > 4) {
    dragging = true;
    lifted = true;
    liftAt = performance.now();
    if (sprite.action) sprite.cancel();
    grabSwing(press);
    document.body.classList.add('dragging');
    replayEl.hidden = true;
    pet.drag('start');
  }
  if (dragging) {
    catX = e.clientX - press.dx;
    catLift = Math.max(0, window.innerHeight - e.clientY - press.dy);
    catVy = 0;
    placeCat();
    placePaper();
    placeOverlays();
    return;
  }
  setOver(hoverTest(e));
});

window.addEventListener('mouseleave', (e) => {
  sprite.gaze = null;
  if (e.buttons === 0 && dragging) onMouseUp(e);
  if (!dragging) {
    overPetNow = false;
    updateReplay();
    setOver(false);
  }
});

window.addEventListener('blur', () => {
  if (dragging) onMouseUp({ button: 0, buttons: 0, clientX: mouseX != null ? mouseX : 0, clientY: mouseY != null ? mouseY : 0 });
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !isOverPet(e)) return;
  press = { x: e.screenX, y: e.screenY, dx: e.clientX - catX, dy: window.innerHeight - e.clientY - catLift, noDrag: catLift > 0 || !!carry };
});

window.addEventListener('mouseup', (e) => onMouseUp(e));
let pokeTimer = null;
function onMouseUp(e) {
  if (e.button !== 0 || !press) return;
  if (dragging) {
    dragging = false;
    fallFrom = catLift;
    document.body.classList.remove('dragging');
    pet.drag('end', { x: catX });
    press = null;
    resyncHover();
    if (catLift <= 0) {
      lifted = false;
      sprite.setHeld(null);
    }
    placeOverlays();
  } else if (isOverPet(e)) {
    if (pokeTimer) {
      clearTimeout(pokeTimer);
      pokeTimer = null;
    } else
      pokeTimer = setTimeout(() => {
        pokeTimer = null;
        if (!sprite.action) sprite.play('happy');
        pet.poke();
      }, 260);
  }
  press = null;
}

canvas.addEventListener('dblclick', (e) => {
  if (isOverPet(e)) pet.open();
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (isOverPet(e) || isOverEl(bubbleEl, e)) pet.context();
});

applyScale();
fieldEl.width = window.innerWidth;
fieldEl.height = window.innerHeight;
loop();
pet.ready();

;if (window.PetSprite !== undefined) PetSprite = window.PetSprite; if (window.PetSound !== undefined) PetSound = window.PetSound; if (window.I18N !== undefined) I18N = window.I18N;
};
};

module.exports = __require('plugin/main')('./main');
