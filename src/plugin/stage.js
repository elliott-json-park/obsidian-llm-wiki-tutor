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
