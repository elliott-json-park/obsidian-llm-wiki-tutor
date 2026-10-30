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
