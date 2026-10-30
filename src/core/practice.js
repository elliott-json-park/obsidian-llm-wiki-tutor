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
