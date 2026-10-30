// 복붙 길. 플러그인은 LLM 을 부르지 않는다. 대신
//  build()  : 규칙 파일 + 목차 + 아직 요리(ingest) 안 한 재료를 프롬프트 한 덩어리로 묶는다 (사용자가 복사해서 자기 AI 에 붙여넣는다)
//  parse()  : AI 의 답에서 `=== FILE: wiki/… ===` ~ `=== END ===` 블록을 꺼내 쓰기 목록으로 만든다
// 경로는 wiki/ 아래만 받는다. 하나도 못 찾으면 null — 부르는 쪽이 통째로 한 쪽에 저장한다.
'use strict';

const FILE_RE = /===\s*FILE:\s*(.+?)\s*===\r?\n([\s\S]*?)\r?\n?===\s*END\s*===/g;

const SPEC = {
  ko: `출력 규격 — 만들거나 고칠 노트마다 아래 형식으로만 쓰고, 형식 밖의 말은 쓰지 마.
=== FILE: wiki/<폴더>/<노트 이름>.md ===
(노트 내용 전체)
=== END ===
- 요약은 wiki/sources/, 개념은 wiki/concepts/ 아래.
- wiki/index.md 는 통째로 다시 써서 같은 형식으로 포함해.
- wiki/log.md 는 기존 내용 뒤에 "- ingest · <재료 이름> → <무엇을 썼는지>" 한 줄을 덧붙인 전체를 포함해.`,
  en: `Output format — for every page you create or update, write only in this form and nothing outside it.
=== FILE: wiki/<folder>/<page name>.md ===
(full page content)
=== END ===
- Summaries go under wiki/sources/, concepts under wiki/concepts/.
- Rewrite wiki/index.md in full and include it in the same form.
- Include wiki/log.md in full with one new line appended: "- ingest · <ingredient> → <what you wrote>".`,
  zh: `输出格式 — 每篇要新建或修改的笔记，只按下面的格式写，格式之外什么都不要写。
=== FILE: wiki/<文件夹>/<笔记名>.md ===
（笔记全文）
=== END ===
- 摘要放在 wiki/sources/ 下，概念放在 wiki/concepts/ 下。
- wiki/index.md 整篇重写，用同样的格式一起给出。
- wiki/log.md 在原有内容后面加一行 "- ingest · <食材名> → <写了什么>"，给出加完后的全文。`,
};

const QUERY_SPEC = {
  ko: `답은 평소 말로 쓰되, 어느 노트를 보고 답했는지 [[노트 이름]]으로 출처를 달아. 위키에 없는 내용이면 "위키에 없다"고 말해.
답을 위키에 저장할 수 있게 마지막에 아래 형식으로 한 번 더 써 줘.
=== FILE: wiki/answers/<질문을 짧게>.md ===
(답 + 출처)
=== END ===`,
  en: `Answer in plain words and cite the pages you used as [[page name]]. If the wiki has nothing, say so.
So the answer can be saved, repeat it once at the end in this form:
=== FILE: wiki/answers/<short question>.md ===
(answer + sources)
=== END ===`,
  zh: `用平常的话回答，并用 [[笔记名]] 注明你参考了哪些笔记。维基里没有的内容，就说"维基里没有"。
为了能把回答存进维基，最后再按下面的格式写一遍：
=== FILE: wiki/answers/<简短的问题>.md ===
（回答 + 出处）
=== END ===`,
};

// 프롬프트 머리 · 칸 이름
const WORDS = {
  ko: {
    head: '너는 아래 규칙 파일(AGENTS.md)대로 일하는 위키 관리자야. 규칙을 먼저 읽고 그대로 따라.',
    raws: '[새 재료 — raw/ 에 들어온 것. 읽기만 하고 고치지 마]',
    task: '할 일: 위 재료를 ingest 해.',
    question: '질문',
  },
  en: {
    head: 'You are the wiki keeper who works by the rules file (AGENTS.md) below. Read the rules first and follow them exactly.',
    raws: '[New ingredients in raw/ — read only, never edit]',
    task: 'Task: ingest the ingredients above.',
    question: 'Question',
  },
  zh: {
    head: '你是按下面的规则文件（AGENTS.md）工作的维基管理员。先读规则，再严格照做。',
    raws: '[新食材 — 放进 raw/ 的文件。只读，不要修改]',
    task: '任务：ingest 上面的食材。',
    question: '问题',
  },
};

function section(title, body) {
  return `[${title}]\n${String(body || '').trim()}\n`;
}

// kind: 'ingest' | 'query'. ctx = { lang, agents, index, raws: [{ name, content }], question }
function build(kind, ctx) {
  const lang = WORDS[ctx.lang] ? ctx.lang : 'ko';
  const W = WORDS[lang];
  const parts = [W.head, '', section('AGENTS.md', ctx.agents), section('wiki/index.md', ctx.index)];
  if (kind === 'ingest') {
    parts.push(W.raws);
    for (const r of ctx.raws) parts.push(`=== RAW: raw/${r.name} ===\n${String(r.content).trim()}\n=== END ===`);
    parts.push('', W.task, SPEC[lang]);
  } else {
    parts.push(section(W.question, ctx.question), QUERY_SPEC[lang]);
  }
  return parts.join('\n');
}

// 경로를 wiki/… 로 정리한다. 못 쓰는 경로면 null
function cleanPath(p, root) {
  let s = String(p).trim().replace(/\\/g, '/').replace(/^["'`]|["'`]$/g, '');
  if (root && s.startsWith(root + '/')) s = s.slice(root.length + 1);
  s = s.replace(/^\.?\//, '');
  if (!s.startsWith('wiki/')) return null;
  if (s.includes('..') || s.includes(':') || !s.endsWith('.md')) return null;
  return s;
}

// AI 답 → { files: [{ path, content }], skipped: [원래 경로] } 또는 null (블록이 하나도 없음)
function parse(text, root) {
  const files = [];
  const skipped = [];
  let m;
  FILE_RE.lastIndex = 0;
  while ((m = FILE_RE.exec(String(text || '')))) {
    const path = cleanPath(m[1], root);
    if (!path) {
      skipped.push(m[1].trim());
      continue;
    }
    files.push({ path, content: m[2].replace(/\s+$/, '') + '\n' });
  }
  if (!files.length && !skipped.length) return null;
  return { files, skipped };
}

module.exports = { build, parse, cleanPath, SPEC, QUERY_SPEC };
