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
