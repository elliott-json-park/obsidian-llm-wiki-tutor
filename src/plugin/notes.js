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
