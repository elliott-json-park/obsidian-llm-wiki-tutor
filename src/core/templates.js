// 연습 폴더에 만드는 파일의 원문. Karpathy LLM Wiki 의 3층(raw · wiki · 스키마) · 3동작(ingest · query · lint) · 2파일(index · log)을
// 쉬운 말로 적은 짧은 판이다. 폴더 이름(raw/ · wiki/)과 wiki/index.md 자리는 Karpathy LLM Wiki 플러그인(karpathywiki)이 쓰는 것과 같아서
// 졸업 뒤 그 플러그인으로 넘어가도 그대로 쓸 수 있다 (그쪽은 wiki/ 아래 sources · entities · concepts 를 더 만든다).
'use strict';

const AGENTS = {
  ko: `# 규칙 파일 (AGENTS.md)

이 폴더는 "내 위키" 연습장입니다. AI는 일을 시작하기 전에 이 파일을 먼저 읽고, 아래 규칙대로 일합니다.

## 폴더와 파일

- \`raw/\` — 재료 폴더. 사람이 글·메모·스크랩을 넣는 곳. **AI는 이 폴더의 파일을 읽기만 하고 절대 고치지 않는다.**
- \`raw/README.md\` — raw 폴더 안내. 재료가 아니므로 ingest 하지 않는다.
- \`wiki/\` — AI만 고치는 곳. AI가 재료에서 뽑은 내용을 정리한 노트를 쓴다. 사람은 읽기만 하고, 고칠 게 있으면 AI에게 말한다.
- \`wiki/sources/\` — 요약 폴더. 재료 하나에 요약 노트 하나.
- \`wiki/concepts/\` — 개념 폴더. 개념 하나에 노트 하나.
- \`wiki/answers/\` — 답변 폴더. 물어보기(query)에서 저장할 만한 답.
- \`wiki/index.md\` — 목차. wiki에 어떤 노트가 있는지 한 줄씩 적는다.
- \`wiki/log.md\` — 작업 기록. AI가 언제 무슨 작업을 했는지 한 줄씩 덧붙인다.
- \`AGENTS.md\` — 이 파일. AI가 일하는 규칙.

## 작업 세 가지

- **ingest (요리)** — \`raw/\`에 새로 들어온 재료를 읽고, \`wiki/sources/\`에 요약 노트 하나, \`wiki/concepts/\`에 관련 개념 노트를 쓰거나 고친다. 노트끼리 \`[[링크]]\`로 잇는다. 끝나면 \`wiki/index.md\`와 \`wiki/log.md\`를 갱신한다.
- **query (물어보기)** — 먼저 \`wiki/index.md\`를 보고, 관련 노트를 읽고, 출처(노트 이름)를 달아 답한다. 위키에 없으면 "없다"고 말한다. 사람이 원하면 좋은 답을 \`wiki/answers/\`에 노트로 저장한다.
- **lint (위키 청소)** — 서로 어긋나는 내용, 새 재료와 맞지 않게 낡은 내용, 어디서도 링크되지 않은 노트, 있어야 하는데 없는 개념 노트를 찾아 알려 준다.

## 노트를 쓸 때

- 제목만 봐도 무슨 내용인지 알 수 있게.
- 제목 아래에 소제목 칸을 이 순서로 둔다.
  - \`## 한 줄\` — 한 문장 요약.
  - \`## 재료\` — 어느 재료에서 왔는지 \`raw/파일이름\`으로 한 줄에 하나씩.
  - \`## 내용\` — 정리한 내용.
- 관련 노트는 \`[[노트 이름]]\`으로 잇는다.
`,
  en: `# Rules file (AGENTS.md)

This folder is a "my wiki" practice space. Before starting any work, the AI reads this file first and works by the rules below.

## Folders and files

- \`raw/\` — the ingredients folder. People put writing, memos and clippings here. **The AI only reads files in this folder and never edits them.**
- \`raw/README.md\` — a guide to the raw folder. It is not an ingredient, so don't ingest it.
- \`wiki/\` — only the AI edits here. The AI writes notes that organize what it pulled out of the ingredients. People only read; if something needs fixing, they tell the AI.
- \`wiki/sources/\` — the summaries folder. One summary note per ingredient.
- \`wiki/concepts/\` — the concepts folder. One note per concept.
- \`wiki/answers/\` — the answers folder. Answers from asking (query) that are worth keeping.
- \`wiki/index.md\` — contents. One line for each note in the wiki.
- \`wiki/log.md\` — work log. The AI appends one line for each piece of work it did, and when.
- \`AGENTS.md\` — this file. The rules the AI works by.

## Three jobs

- **ingest (cooking)** — read ingredients newly added to \`raw/\`, then write one summary note in \`wiki/sources/\` and write or update related concept notes in \`wiki/concepts/\`. Link notes to each other with \`[[links]]\`. When done, update \`wiki/index.md\` and \`wiki/log.md\`.
- **query (asking)** — look at \`wiki/index.md\` first, read the related notes, and answer with sources (note names). If the wiki doesn't have it, say so. If the person wants, save a good answer as a note in \`wiki/answers/\`.
- **lint (wiki cleanup)** — find and report contradictions, content gone stale against newer ingredients, notes nothing links to, and concept notes that should exist but don't.

## When writing a note

- A title that tells you what it's about at a glance.
- Under the title, these sections in this order:
  - \`## In one line\` — a one-sentence summary.
  - \`## Ingredients\` — which ingredients it came from, one \`raw/filename\` per line.
  - \`## Content\` — the organized content.
- Link related notes with \`[[note name]]\`.
`,
};

AGENTS.zh = `# 规则文件（AGENTS.md）

这个文件夹是"我的维基"练习场。AI 在开始任何工作之前，先读这个文件，并按下面的规则工作。

## 文件夹和文件

- \`raw/\` — 食材文件夹。人往这里放文章、备忘和剪藏。**AI 只读这个文件夹里的文件，绝不修改。**
- \`raw/README.md\` — raw 文件夹的说明。它不是食材，不要 ingest。
- \`wiki/\` — 只有 AI 修改这里。AI 把从食材中提炼出的内容整理成笔记写在这里。人只负责读，要改什么就告诉 AI。
- \`wiki/sources/\` — 摘要文件夹。一份食材一篇摘要笔记。
- \`wiki/concepts/\` — 概念文件夹。一个概念一篇笔记。
- \`wiki/answers/\` — 回答文件夹。提问（query）中值得保存的回答。
- \`wiki/index.md\` — 目录。wiki 里有哪些笔记，一行一篇。
- \`wiki/log.md\` — 工作记录。AI 什么时候做了什么，一行一条往后加。
- \`AGENTS.md\` — 这个文件。AI 工作的规则。

## 三项工作

- **ingest（烹饪）** — 读 \`raw/\` 里新放进来的食材，在 \`wiki/sources/\` 写一篇摘要笔记，在 \`wiki/concepts/\` 写或更新相关的概念笔记。笔记之间用 \`[[链接]]\` 连起来。做完后更新 \`wiki/index.md\` 和 \`wiki/log.md\`。
- **query（提问）** — 先看 \`wiki/index.md\`，再读相关笔记，附上出处（笔记名）回答。维基里没有就说"没有"。用户需要的话，把好的回答作为笔记保存到 \`wiki/answers/\`。
- **lint（维基清理）** — 找出互相矛盾的内容、和新食材对不上的过时内容、没有任何地方链接到的笔记、应该有却没有的概念笔记，并告诉用户。

## 写笔记时

- 只看标题就能知道写的是什么。
- 标题下面按这个顺序放小标题：
  - \`## 一句话\` — 一句话摘要。
  - \`## 食材\` — 来自哪份食材，用 \`raw/文件名\`，一行一个。
  - \`## 内容\` — 整理好的内容。
- 相关笔记用 \`[[笔记名]]\` 连起来。
`;

const INDEX = {
  zh: `# 目录（index.md）

wiki 里有哪些笔记，一行一篇。AI 每次 ingest 都会更新它，被提问时最先看这里。

（目前为空）
`,
  ko: `# 목차 (index.md)

wiki 에 어떤 노트가 있는지 한 줄씩. AI가 ingest 때마다 갱신하고, 질문을 받으면 제일 먼저 본다.

(아직 비어 있음)
`,
  en: `# Contents (index.md)

One line for each note in the wiki. The AI updates this on every ingest and reads it first when asked a question.

(empty for now)
`,
};

const LOG = {
  zh: `# 工作记录（log.md）

AI 什么时候做了什么，一行一条往后加。不删除。

`,
  ko: `# 작업 기록 (log.md)

AI가 언제 무슨 작업을 했는지 한 줄씩 덧붙인다. 지우지 않는다.

`,
  en: `# Work log (log.md)

The AI appends one line for each piece of work it did, and when. Nothing is deleted.

`,
};

const RAW_README = {
  zh: `# README — raw 文件夹说明

这是食材文件夹。把要让 AI 读取并整理的文章、备忘、剪藏放在这里。

- AI 只读这个文件夹里的文件，绝不修改。
- 文件名请起得能看出内容。（例如："2026-10-29 会议记录"）
- 这个 README 文件是说明，不当作食材使用。
`,
  ko: `# README — raw 폴더 안내

재료 폴더입니다. AI가 읽고 정리할 글·메모·스크랩을 여기 넣으세요.

- AI는 이 폴더의 파일을 읽기만 하고 절대 고치지 않습니다.
- 파일 이름은 내용을 알 수 있게 지어 주세요. (예: "2026-10-29 회의 기록")
- 이 README 파일은 안내문이라 재료로 쓰지 않습니다.
`,
  en: `# README — about the raw folder

This is the ingredients folder. Put writing, memos and clippings here for the AI to read and organize.

- The AI only reads files in this folder and never edits them.
- Give files names that tell you what's inside. (e.g. "2026-10-29 meeting notes")
- This README file is a guide, so it is not used as an ingredient.
`,
};

module.exports = { AGENTS, INDEX, LOG, RAW_README };
