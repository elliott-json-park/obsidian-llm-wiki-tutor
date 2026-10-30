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
