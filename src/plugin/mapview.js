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
