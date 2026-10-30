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
