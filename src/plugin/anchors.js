// 옵시디언 UI 요소의 자리를 무대 좌표로 돌려준다. 고양이가 걸어갈 x, 가리킬 y 를 여기서 얻는다.
//
// anchor 형식:
//  'folder:<경로>' 'file:<경로>' : 파일 탐색기의 그 줄 (접혀 있으면 부모를 펼친다)
//  'graph'                       : 열린 그래프 뷰
//  'editor'                      : 지금 편집 중인 노트
//  'ribbon:<aria-label>'         : 왼쪽 리본 아이콘
//  'statusbar'                   : 상태 표시줄
//  'sel:<css 선택자>'            : 아무 요소
//  'x:<숫자>' 또는 숫자          : 무대 x 좌표 그대로
//
// 돌려주는 것: { x, y, top, bottom, left, right, width, height } (무대 기준) 또는 null (못 찾음).
// 파일 탐색기의 fileItems 는 공개 API 가 아니라 옵시디언이 바뀌면 깨질 수 있다. 그때는 null 을 돌려주고 수업은 말로 안내한다.
const { MarkdownView } = require('obsidian');

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toStage(rect, r) {
  return {
    x: r.left + r.width / 2 - rect.left,
    y: r.top + r.height / 2 - rect.top,
    top: r.top - rect.top,
    bottom: r.bottom - rect.top,
    left: r.left - rect.left,
    right: r.right - rect.left,
    width: r.width,
    height: r.height,
  };
}

async function explorerItem(app, path, quiet) {
  const leaf = app.workspace.getLeavesOfType('file-explorer')[0];
  if (!leaf) return null;
  const view = leaf.view;
  const items = view && view.fileItems;
  if (!items) return null;
  const item = items[path];
  if (!item) return null;
  if (quiet) return item.innerEl || item.titleInnerEl || item.selfEl || item.el;
  // 접힌 부모 폴더를 펼친다
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    const p = items[parts.slice(0, i).join('/')];
    if (p && p.collapsed && typeof p.setCollapsed === 'function') {
      try {
        await p.setCollapsed(false, false);
      } catch {
        // 옛 옵시디언
      }
    }
  }
  // 사이드바가 접혀 있으면 펼친다
  try {
    await app.workspace.revealLeaf(leaf);
  } catch {
    // 무시
  }
  const row = item.selfEl || item.titleEl || item.el;
  if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  await sleep(80);
  // 줄 전체가 아니라 이름 글자 부분을 가리킨다 (줄은 패널 폭을 다 차지해서 가운데가 엉뚱한 곳이 된다)
  return item.innerEl || item.titleInnerEl || (row && row.querySelector('.tree-item-inner')) || row;
}

// quiet: 이미 가리키는 중에 자리만 다시 잴 때 (펼치기 · 스크롤 같은 부작용 없이)
async function locate(app, stage, anchor, quiet = false) {
  if (anchor == null) return null;
  if (typeof anchor === 'number') return { x: anchor };
  const s = String(anchor);
  const at = s.indexOf(':');
  const kind = at < 0 ? s : s.slice(0, at);
  const arg = at < 0 ? '' : s.slice(at + 1);
  let el = null;
  switch (kind) {
    case 'x':
      return { x: Number(arg) };
    case 'folder':
    case 'file':
      el = await explorerItem(app, arg, quiet);
      break;
    case 'graph': {
      const leaf = app.workspace.getLeavesOfType('graph')[0];
      el = leaf && leaf.view && leaf.view.containerEl;
      break;
    }
    case 'editor': {
      const v = app.workspace.getActiveViewOfType(MarkdownView);
      el = v && v.contentEl;
      break;
    }
    case 'ribbon':
      el = document.querySelector(`.side-dock-ribbon-action[aria-label="${CSS.escape(arg)}"]`);
      break;
    case 'statusbar':
      el = document.querySelector('.status-bar');
      break;
    case 'sel':
      el = document.querySelector(arg);
      break;
    default:
      return null;
  }
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  const rect = stage.rect();
  const o = toStage(rect, r);
  o.x = clamp(o.x, 0, rect.width);
  o.kind = kind;
  return o;
}

module.exports = { locate };
