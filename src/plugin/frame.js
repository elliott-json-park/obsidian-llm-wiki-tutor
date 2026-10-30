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
