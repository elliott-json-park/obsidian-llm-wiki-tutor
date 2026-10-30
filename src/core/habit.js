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
