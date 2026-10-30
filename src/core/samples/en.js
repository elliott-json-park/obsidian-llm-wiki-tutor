// 체험 모드 샘플 (영어). 재료 글 3편과, 그걸 AGENTS.md 규칙대로 요리(ingest)한 결과를 미리 기록해 둔 것. ko.js 와 같은 모양.
// 단계(STAGES[n])마다 '그때까지 ingest 한 결과'를 통째로 둔다 (put = 만들거나 덮어씀, append = 덧붙임).
// B6 lint 용으로 1편(하루 세 줄)과 3편(하루 한 줄)의 말이 일부러 어긋나고, 3편에서 아무도 링크하지 않는 노트(Graph view)가 생긴다.
// wiki 노트는 AGENTS.md 규칙대로 "## In one line" · "## Ingredients" · "## Content" 칸으로 쓴다. B7 에서 규칙이 바뀌면 개념 노트에 "## Example" 칸이 붙는다.
'use strict';

const RAW = [
  {
    name: '01-What a personal wiki is.md',
    content: `# What a personal wiki is

A second brain that keeps what your head can't hold. You write it down outside, and get it back when you need it. That's a personal wiki.

The point is not "saving". The point is "getting it back". Saving alone is like stuffing receipts into a drawer. If you can't find it later, it doesn't exist.

So a personal wiki does two jobs.
1. Write down what comes in — what you learned today, what you felt, what you were given.
2. Link what you wrote — similar things, opposite things, things that follow on.

Three lines a day is enough. What you did, what you learned, a memo. Any format is fine.

If a person does the linking, they get tired fast. So these days we hand it to an AI.
`,
  },
  {
    name: '02-Why everyone fails.md',
    content: `# Why everyone fails

Most people who start a personal wiki quit within a month. There are three reasons.

First, they mistake collecting for knowing. 500 bookmarks, 2,000 screenshots. "Knowing about something" is not the same as "knowing it". This is called the collector's fallacy.

Second, they build the system first. Twelve folders, thirty tags, color rules. The bigger the system, the more you hesitate each time you add something. And the more you hesitate, the less you add.

Third, a person does the maintenance. Sorting, linking and summarizing pile up every day. You can keep it up for a week, but not for a month. What fails is not the format. It's the maintenance.

So do it the other way around. Keep the system tiny, add things any old way, and let something that isn't a person do the tidying.
`,
  },
  {
    name: '03-How to make the AI do it.md',
    content: `# How to make the AI do it

In spring 2026, AI researcher Andrej Karpathy posted an "LLM-maintained wiki" pattern, and many people copied it. The pattern is simple.

Split things into two folders. In raw, a person puts ingredients. In wiki, the AI writes organized notes. The AI only reads raw, and the person only reads wiki.

There are three operations. ingest reads new ingredients and updates the wiki. query reads the wiki and answers with sources. lint looks for contradictions and gaps.

The rules are written down in one file. The AI reads that file first, every time. To change the rules, you edit only that file.

Obsidian works for this because everything is just files. Open the Graph view and you can see the links the AI planted.

A person's job is one line a day. That's enough. The AI does everything else.
`,
  },
];

// 노트 경로는 Karpathy LLM Wiki 플러그인과 겹치게 wiki/sources · wiki/concepts 를 쓴다
const SUM1 = 'wiki/sources/01-What a personal wiki is.md';
const SUM2 = 'wiki/sources/02-Why everyone fails.md';
const SUM3 = 'wiki/sources/03-How to make the AI do it.md';
const C_SB = 'wiki/concepts/Personal wiki.md';
const C_RET = 'wiki/concepts/Getting it back.md';
const C_DAILY = 'wiki/concepts/Daily log.md';
const C_COLL = "wiki/concepts/Collector's fallacy.md";
const C_MAINT = 'wiki/concepts/Maintenance.md';
const C_LLMW = 'wiki/concepts/LLM wiki.md';
const C_GRAPH = 'wiki/concepts/Graph view.md';
const C_INGEST = 'wiki/concepts/ingest.md';
const INDEX = 'wiki/index.md';
const LOG = 'wiki/log.md';
const R1 = 'raw/01-What a personal wiki is.md';
const R2 = 'raw/02-Why everyone fails.md';
const R3 = 'raw/03-How to make the AI do it.md';

const put = (path, content) => ({ op: 'put', path: 'practice:' + path, content });
const append = (path, content) => ({ op: 'append', path: 'practice:' + path, content });

// AGENTS.md 의 노트 형식: 제목 · 한 줄 · 재료 · 내용 (· 예시)
function page(title, line, raws, body, example) {
  let s = `# ${title}\n\n## In one line\n${line}\n\n## Ingredients\n${raws.map((r) => `- ${r}`).join('\n')}\n\n## Content\n${body.trim()}\n`;
  if (example) s += `\n## Example\n${example.trim()}\n`;
  return s;
}

// 개념 노트들. 단계마다 바뀌는 판을 따로 둔다
const N = {
  sb1: (ex) =>
    page(
      'Personal wiki',
      "A second brain: what your head can't hold, written down outside and taken back out when needed.",
      [R1],
      `It does two jobs.
1. Write down what comes in → [[Daily log]]
2. Link what you wrote → the part that tires people out

Saving is not the goal. [[Getting it back]] is the goal.`,
      ex
    ),
  sb2: (ex) =>
    page(
      'Personal wiki',
      "A second brain: what your head can't hold, written down outside and taken back out when needed.",
      [R1, R2],
      `It does two jobs.
1. Write down what comes in → [[Daily log]]
2. Link what you wrote → the part that tires people out = [[Maintenance]]

Saving is not the goal. [[Getting it back]] is the goal.

Why it fails: [[Collector's fallacy]] · a big system · [[Maintenance]] done by a person.`,
      ex
    ),
  ret: (ex) =>
    page(
      'Getting it back',
      'Finding what you wrote down again, at the moment you need it. The real goal of a personal wiki.',
      [R1],
      `- If you save it but can't find it, it's as good as gone (receipts in a drawer).
- To get things back, what you wrote has to be linked → [[Personal wiki]]`,
      ex
    ),
  daily1: () =>
    page(
      'Daily log',
      'Three lines a day — what you did · what you learned · a memo. Any format is fine.',
      [R1],
      `- The only way ingredients get into the [[Personal wiki]].
- Don't try to write well. Single words are fine.`
    ),
  daily3: () =>
    page(
      'Daily log',
      'The one thing a person does every day. One line a day is enough.',
      [R1, R3],
      `- The only way ingredients get into the [[Personal wiki]].
- Don't try to write well. Single words are fine.
- The AI does everything else → [[LLM wiki]]`
    ),
  dailyFix: (ex) =>
    page(
      'Daily log',
      'The one thing a person does every day. "A little, every day" is the point — three lines (article 1) or one line (article 3).',
      [R1, R3],
      `- The only way ingredients get into the [[Personal wiki]].
- Don't try to write well. Single words are fine.
- How many lines depends on the ingredient: three in article 1, one in article 3. Both agree on "a little, every day".
- The AI does everything else → [[LLM wiki]] · [[ingest]]`,
      ex
    ),
  coll: (ex) =>
    page(
      "Collector's fallacy",
      'Mistaking collecting for knowing. "Knowing about something" ≠ "knowing it".',
      [R2],
      `- Saving is so easy that saving itself feels like the reward.
- The first reason a [[Personal wiki]] fails. The second and third come down to [[Maintenance]].`,
      ex
    ),
  maint: (ex) =>
    page(
      'Maintenance',
      'Work that piles up every day, like sorting, linking and summarizing. A person can do it for a week, but not for a month.',
      [R2],
      `- Where a personal wiki really dies. It's not the format's fault.
- The fix: hand it to something that isn't a person → [[Personal wiki]]
- Named as a reason for failure, along with the [[Collector's fallacy]].`,
      ex
    ),
  llmw3: () =>
    page(
      'LLM wiki',
      'A personal wiki that an AI maintains. raw is for the person, wiki is for the AI, and the rules are one file.',
      [R3],
      `- Three operations: ingest (read ingredients, update the wiki) · query (answer with sources) · lint (find contradictions and gaps).
- The [[Maintenance]] problem of a [[Personal wiki]], handed over to an AI.
- Change the rules file and the results change.`
    ),
  llmwFix: (ex) =>
    page(
      'LLM wiki',
      'A personal wiki that an AI maintains. raw is for the person, wiki is for the AI, and the rules are one file.',
      [R3],
      `- Three operations: [[ingest]] (read ingredients, update the wiki) · query (answer with sources) · lint (find contradictions and gaps).
- The [[Maintenance]] problem of a [[Personal wiki]], handed over to an AI.
- Change the rules file and the results change.
- See how the links pile up in the [[Graph view]].`,
      ex
    ),
  graph: (ex) =>
    page(
      'Graph view',
      'The Obsidian screen that draws the links between notes as dots and lines. You can see the links the AI planted.',
      [R3],
      `- Spot hubs (notes with many links) and orphans (notes nothing links to) at a glance.`,
      ex
    ),
  ingest: (ex) =>
    page(
      'ingest',
      'The operation that reads new ingredients in raw and writes or updates the wiki. It means "to digest".',
      [R3],
      `- One ingredient touches many notes (a summary + several concepts + the contents + the work log).
- The first of the three [[LLM wiki]] operations. The person only keeps the [[Daily log]].`,
      ex
    ),
};

// ── 1편을 ingest 한 뒤 ──
const STAGE1 = [
  put(
    SUM1,
    page(
      'What a personal wiki is (summary)',
      'A second brain you write down outside your head and take back out. The point is getting it back, not saving.',
      [R1],
      `- A [[Personal wiki]] does two jobs: 1. write down 2. link.
- Saving alone is putting receipts in a drawer. Without [[Getting it back]], it doesn't exist.
- For the [[Daily log]], three lines a day is enough. Any format.
- Linking tires people out, so hand it to an AI.`
    )
  ),
  put(C_SB, N.sb1()),
  put(C_RET, N.ret()),
  put(C_DAILY, N.daily1()),
  put(INDEX, `# Contents (index.md)

One line for each note in the wiki. The AI updates it on every ingest, and reads it first when you ask a question.

## Summaries (sources)
- [[01-What a personal wiki is]] — a second brain you write down outside your head and take back out

## Concepts
- [[Personal wiki]] — write down + link. The goal is getting it back
- [[Getting it back]] — saved but can't find it = gone
- [[Daily log]] — three lines a day
`),
  append(LOG, `- ingest · ${R1} → 1 summary, 3 concepts (Personal wiki · Getting it back · Daily log), contents updated
`),
];

// ── 2편까지 ──
const STAGE2 = [
  put(
    SUM2,
    page(
      'Why everyone fails (summary)',
      'Most people quit within a month. Because they mistake collecting for knowing, build a big system, and do the maintenance by hand.',
      [R2],
      `- [[Collector's fallacy]]: 500 bookmarks is not knowing.
- The bigger the system, the more you hesitate each time you add something. The more you hesitate, the less you add.
- What fails is not the format. It's the [[Maintenance]].
- The other way around: a tiny system, add things any old way, let something that isn't a person tidy up → [[Personal wiki]]`
    )
  ),
  put(C_COLL, N.coll()),
  put(C_MAINT, N.maint()),
  put(C_SB, N.sb2()),
  put(INDEX, `# Contents (index.md)

One line for each note in the wiki. The AI updates it on every ingest, and reads it first when you ask a question.

## Summaries (sources)
- [[01-What a personal wiki is]] — a second brain you write down outside your head and take back out
- [[02-Why everyone fails]] — collecting mistaken for knowing, a big system, maintenance by hand

## Concepts
- [[Personal wiki]] — write down + link. The goal is getting it back
- [[Getting it back]] — saved but can't find it = gone
- [[Daily log]] — three lines a day
- [[Collector's fallacy]] — collecting ≠ knowing
- [[Maintenance]] — where a personal wiki really dies
`),
  append(LOG, `- ingest · ${R2} → 1 summary, 2 new concepts (Collector's fallacy · Maintenance), Personal wiki note updated, contents updated
`),
];

// ── 3편까지 (Daily log 가 1편과 어긋나고, Graph view 노트는 아무도 링크하지 않는다 → B6 lint 거리) ──
const STAGE3 = [
  put(
    SUM3,
    page(
      'How to make the AI do it (summary)',
      'Split into raw (the person adds) and wiki (the AI writes), and have the AI run three operations — ingest · query · lint — by a rules file.',
      [R3],
      `- In spring 2026, Andrej Karpathy's "LLM-maintained wiki" post spread widely → [[LLM wiki]]
- The AI only reads raw. The person only reads wiki.
- The rules go in one file. The AI reads that file first, every time.
- Why Obsidian: everything is just files.
- The person's job is the [[Daily log]], one line a day.`
    )
  ),
  put(C_LLMW, N.llmw3()),
  put(C_GRAPH, N.graph()),
  put(C_DAILY, N.daily3()),
  put(INDEX, `# Contents (index.md)

One line for each note in the wiki. The AI updates it on every ingest, and reads it first when you ask a question.

## Summaries (sources)
- [[01-What a personal wiki is]] — a second brain you write down outside your head and take back out
- [[02-Why everyone fails]] — collecting mistaken for knowing, a big system, maintenance by hand
- [[03-How to make the AI do it]] — split into raw/wiki, then ingest · query · lint

## Concepts
- [[Personal wiki]] — write down + link. The goal is getting it back
- [[Getting it back]] — saved but can't find it = gone
- [[Daily log]] — one line a day
- [[Collector's fallacy]] — collecting ≠ knowing
- [[Maintenance]] — where a personal wiki really dies
- [[LLM wiki]] — a personal wiki that an AI maintains
- [[Graph view]] — links as dots and lines
`),
  append(LOG, `- ingest · ${R3} → 1 summary, 2 new concepts (LLM wiki · Graph view), Daily log note updated, contents updated
`),
];

// ── B5 물어보기 ──
const QUERY = [
  {
    q: 'Why do personal wikis fail?',
    a: `There are three reasons.

1. **Mistaking collecting for knowing** — 500 bookmarks is not knowing ([[Collector's fallacy]]).
2. **A big system** — twelve folders, thirty tags. You hesitate every time you add something, and the more you hesitate, the less you add.
3. **Maintenance by hand** — sorting, linking and summarizing pile up every day. You can keep it up for a week, but not for a month ([[Maintenance]]).

So do it the other way around: a tiny system, add things any old way, and let the AI tidy up ([[LLM wiki]]).`,
    sources: [SUM2, C_COLL, C_MAINT],
    save: 'wiki/answers/Why personal wikis fail.md',
  },
  {
    q: 'What do I do every day?',
    a: `Just one thing: the [[Daily log]]. Write down what you did · what you learned · a memo, any way you like.

How many lines depends on the ingredient — article 1 says three lines, article 3 says one line. Both agree on "a little, every day". Everything else (sorting, linking, summarizing) is done by the AI ([[LLM wiki]]).`,
    sources: [C_DAILY, SUM1, SUM3],
    save: 'wiki/answers/What to do every day.md',
  },
  {
    q: 'What exactly do I have the AI do?',
    a: `Three things ([[LLM wiki]]).

1. **ingest** — when a new ingredient lands in raw, read it, write or update wiki notes, and update the contents (index) and the work log (log).
2. **query** — look at the contents first, read the related notes, and answer with sources. If there's nothing, say so.
3. **lint** — find contradictions, notes nothing links to, and notes that should exist but don't.

The rules live in one file, AGENTS.md, and the AI reads it first every time.`,
    sources: [SUM3, C_LLMW],
    save: 'wiki/answers/What the AI does.md',
  },
];

// ── B6 위키 청소 ──
const LINT = {
  findings: [
    { kind: 'contradiction', text: '**Contradiction** — [[Daily log]]: article 1 says "three lines a day", article 3 says "one line a day". Right now the note only records what article 3 says.', pages: [C_DAILY, SUM1, SUM3] },
    { kind: 'orphan', text: '**Orphan note** — apart from the contents, not a single link points to the [[Graph view]] note.', pages: [C_GRAPH] },
    { kind: 'missing', text: '**Missing concept** — three notes talk about ingest, but there is no concept note that explains ingest.', pages: [] },
  ],
  fix: [
    put(C_DAILY, N.dailyFix()),
    put(C_LLMW, N.llmwFix()),
    put(C_INGEST, N.ingest()),
    append(LOG, `- lint → 1 contradiction resolved (Daily log: three lines vs one line), 1 orphan linked (Graph view), 1 missing concept added (ingest)
`),
  ],
};

// ── B7 규칙 바꾸기: 사용자가 개념 노트의 정리 형식을 바꾸고 싶다 → 개념 노트마다 "## Example" 칸 ──
const SCHEMA = {
  rule: `
## Concept note format (added)

- Every concept note (\`wiki/concepts/\`) gets an \`## Example\` section under \`## Content\`. Write one everyday example in two or three sentences.
`,
  after: [
    put(C_SB, N.sb2('You hear an idea in a meeting and leave one line about it in raw that day. Three months later, when you plan something similar, the AI finds that line and brings it back. If it had stayed only in your memory, that idea would be gone.')),
    put(C_RET, N.ret("You want to go back to a place you loved on last year's trip, but you can't remember its name. Instead of digging through your photos for an hour, you ask the wiki \"Where was that place?\" and find it right away.")),
    put(C_DAILY, N.dailyFix('On the way home, you leave just one line: "Today\'s meeting: schedule pushed back two weeks. Reason: design review." You don\'t polish it. The AI tidies it up later.')),
    put(C_COLL, N.coll('You save 300 articles to "Read later" and feel proud. But when someone asks what you learned from them, you can\'t explain a single one.')),
    put(C_MAINT, N.maint('In the first week, you tagged every memo and picked a folder for each. From the third week, put-off memos piled up, and in the end you stopped tidying.')),
    put(C_LLMW, N.llmwFix('On the weekend, you drop this week\'s memos into raw and just say "ingest this". On Monday, you ask the tidy wiki "What did we decide last week?"')),
    put(C_GRAPH, N.graph('You open the Graph view and see lots of lines crowding into the "Daily log" dot. That means it\'s the central concept the wiki links to most often.')),
    put(C_INGEST, N.ingest('You drop one set of meeting notes into raw and run ingest. One summary note appears, and concept notes like "Schedule" and "Design review" get new content too.')),
    append(LOG, `- rules changed (Example section in concept notes) → re-ingest · "## Example" added to 8 concept notes
`),
  ],
};

module.exports = { RAW, STAGES: { 1: STAGE1, 2: STAGE2, 3: STAGE3 }, QUERY, LINT, SCHEMA, PATHS: { SUM1, SUM2, SUM3, C_DAILY, C_GRAPH, INDEX, LOG } };
