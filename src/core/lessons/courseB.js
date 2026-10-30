// 코스 B — LLM Wiki 만들기. 단계 형식과 말투 · 표기 규칙은 courseA.js 머리말 참고.
// 10차에서 한국어판을 새로 썼고 11차에서 다듬었다. en · zh 는 이 한국어판을 기준으로 나중에 한꺼번에 다시 옮긴다.
//
// 말 정하기 (레슨에서 처음 나올 때 "앞으로 ~라고 부를게" 하고 정해 둔다):
//  재료 = raw 폴더 속 파일 (A1) · 연결고리 = 링크 (A4) · 요리 = ingest (B2) · 위키 청소 = lint (B6)
//  그 밖에는 제 이름을 쓴다: raw 폴더 · wiki 폴더 · AGENTS.md(규칙 파일) · README.md(raw 폴더 안내) · index.md(목차) · log.md(작업 기록) · 노트
//  wiki 안 폴더: 요약 폴더(sources) · 개념 폴더(concepts) · 답변 폴더(answers)
// 누가 무엇을 고치나: raw 폴더는 사용자 것 (AI 는 읽기만 하고 절대 고치지 않는다). wiki 폴더는 AI 만 고친다.
// B 코스는 A 코스를 다 듣거나 건너뛰어야 열린다 (건너뛰어도 A 에서 만들 노트는 만들어 둔다 — core/engine.js skipCourse).
// A 에서 만든 것(고양이 · 츄르 노트, "오늘 알게 된 것")을 말할 때는 "옵시디언 사용법 기초 과정에서 만든" 노트라고 밝힌다.
'use strict';
const T = require('../templates');
const { GRAPH_RIBBON } = require('./courseA');

const C_SB = { ko: 'practice:wiki/concepts/개인 위키.md', en: 'practice:wiki/concepts/Personal wiki.md', zh: 'practice:wiki/concepts/个人维基.md' };
const RAW_README = { ko: 'practice:raw/README.md', en: 'practice:raw/README.md', zh: 'practice:raw/README.md' };
const FIRST_RAW = { ko: 'practice:raw/내 첫 재료.md', en: 'practice:raw/My first ingredient.md', zh: 'practice:raw/我的第一份食材.md' };
const GRAPH_HINT = { ko: '맨 왼쪽 아이콘 줄에서 동그라미들이 선으로 이어진 아이콘을 눌러 봐.' };

const ROOMS = {
  kind: 'rooms',
  labels: { ko: ['사용자가 재료를 넣는 곳', 'AI 만 고치는 노트', 'AI 에게 주는 규칙', '이 세 가지가 LLM Wiki 의 전부'] },
};

const B0 = {
  id: 'B0',
  course: 'B',
  minutes: 7,
  title: { ko: '위키를 이루는 세 가지' },
  intro: {
    ko: 'LLM Wiki 코스 첫 시간이야. 위키를 이루는 세 가지(raw 폴더 · wiki 폴더 · AGENTS.md)가 각각 뭘 하는지 알아보고, 연습 폴더 안에 직접 만들어 볼 거야.',
  },
  steps: [
    { do: 'mood', mood: 'idle' },
    { say: { ko: '이제 진짜 위키를 만들어 보자.||생각보다 간단해. 폴더 두 개랑 파일 하나면 돼.' } },
    {
      card: {
        title: { ko: 'raw · wiki · AGENTS.md' },
        body: {
          ko: '1. **raw 폴더**: 사용자가 재료(raw 폴더 속 파일)를 넣는 곳. 메모, 저장한 기사, 회의 기록 같은 걸 여기 넣어. raw 는 "가공하기 전"이라는 뜻이야. 그러니까 **AI 는 raw 폴더 속 파일은 절대 건드리지 않아.** 읽기만 해.\n\n2. **wiki 폴더**: wiki 폴더는 **AI 만 수정할 수 있어.** raw 폴더에 사용자가 넣어 둔 재료(raw 폴더 속 파일)에서 여러 인사이트를 뽑아 AI 가 wiki 폴더에 정리하는 거야. 요약, 개념 정리, 목차가 여기 생겨.\n\n3. **AGENTS.md**: AI 에게 주는 규칙 파일. "재료(raw 폴더 속 파일)를 이렇게 정리해 줘"라는 설명서야. AI 는 일을 시작하기 전에 이 파일부터 읽어.\n\nLLM Wiki 는 이 세 가지가 전부야.',
        },
        figure: ROOMS,
        buttons: [{ ko: '만들어 보자' }],
      },
    },
    {
      faq: {
        title: { ko: '만들기 전에 궁금한 거 있어?' },
        items: [
          {
            q: { ko: 'AI 는 왜 raw 폴더를 안 고쳐?' },
            a: {
              ko: 'AI 가 재료(raw 폴더 속 파일)를 고치면, 나중에 wiki 노트의 내용이 원래 어디서 왔는지 확인할 수 없게 돼.\n\nraw 폴더 속 파일은 원본 기록이야. 재료에 틀린 내용이 있어도 AI 는 그대로 두고, "이 글은 틀렸다"는 판단은 wiki 노트 쪽에 기록해.\n\n재료(raw 폴더 속 파일)는 사용자 것이니까, 사용자가 직접 고치거나 지우는 건 괜찮아. 고치지 않는 건 AI 의 규칙이야.',
            },
          },
          {
            q: { ko: 'AGENTS.md 는 꼭 이 이름이어야 해?' },
            a: {
              ko: '꼭 그렇진 않아. 요즘 AI 도구들이 폴더에서 이 이름의 파일을 먼저 찾아 읽는 경우가 많아서 이 이름을 쓰는 거야. 클로드 코드는 CLAUDE.md 라는 이름을 찾기도 해.\n\n이름보다 중요한 건 AI 에게 일을 시킬 때 "이 파일부터 읽어"라고 말해 주는 거야. 수업 끝나고 혼자 할 때도 매번 그렇게 하게 될 거야.',
            },
          },
          {
            q: { ko: '원래 있던 노트는 괜찮아?' },
            a: {
              ko: '응, 안 건드려. 이번에 만드는 건 전부 연습 폴더 안에 생겨.\n\n나중에 실제로 쓸 땐 이 연습 폴더를 그대로 키워도 되고, 다른 폴더에 같은 구조를 새로 만들어도 돼.',
            },
          },
        ],
      },
    },
    {
      say: {
        ko: '이제 만들게. 세 가지에 더해서 몇 개를 같이 만들 거야.||raw 폴더 안엔 **README.md**, wiki 폴더 안엔 **index.md** 와 **log.md** 를 넣을 거야.||**README.md** 는 "이 폴더가 뭐 하는 곳인지" 알려 주는 안내 파일이야. raw 폴더를 열면 AI 가 가장 처음 읽게 되는 파일이라서, 관례대로 README(읽어 주세요)라는 이름을 붙여.||index.md 와 log.md 는 조금 뒤에 설명할게.',
      },
    },
    {
      say: {
        ko: '만들기 전에 뭘 만들지 보여 주는 창이 뜰 거야.||"raw > README.md" 는 raw 폴더 안에 README.md 파일이 생긴다는 뜻이야. 목록을 확인하고 괜찮으면 "만들기" 버튼을 눌러 줘.',
      },
    },
    {
      writes: [
        { op: 'folder', path: 'practice:raw' },
        { op: 'note', path: RAW_README, content: T.RAW_README },
        { op: 'folder', path: 'practice:wiki' },
        { op: 'note', path: 'practice:AGENTS.md', content: T.AGENTS },
        { op: 'note', path: 'practice:wiki/index.md', content: T.INDEX },
        { op: 'note', path: 'practice:wiki/log.md', content: T.LOG },
      ],
    },
    { waitFor: 'folderExists', args: { path: 'practice:wiki' }, hint: { say: { ko: '창에서 "만들기"를 눌러야 폴더가 생겨.' } } },
    { do: 'point', anchor: 'folder:practice:raw', label: { ko: 'raw 폴더' } },
    { say: { ko: '여기가 **raw 폴더**야. 사용자가 AI 에게 줄 글은 전부 여기에 넣어. 이 파일들이 재료(raw 폴더 속 파일)야.||지금은 안내 파일 README.md 하나만 들어 있어.' } },
    { do: 'point', anchor: 'folder:practice:wiki', label: { ko: 'wiki 폴더' } },
    { say: { ko: '여기가 **wiki 폴더**. AI 가 정리한 노트가 여기 쌓이고, AI 만 고쳐.||폴더 이름 왼쪽 화살표를 눌러 펼쳐 보면 지금은 index.md 랑 log.md 두 개만 있을 거야.' } },
    {
      say: {
        ko: '**index.md** 는 wiki 에 어떤 노트가 있는지 한 줄씩 기록해 둔 **목차**야.||**log.md** 는 AI 가 언제 무슨 작업을 했는지 한 줄씩 남기는 **작업 기록**이야. 둘 다 AI 가 알아서 고쳐.',
      },
    },
    { do: 'point', anchor: 'file:practice:AGENTS.md', label: { ko: 'AGENTS.md' } },
    { say: { ko: '그리고 이게 **AGENTS.md**, 규칙 파일이야.||파일 탐색기에서 AGENTS.md 를 클릭해서 열어 봐. AI 가 할 일이 다 기록돼 있어.' } },
    { do: 'unpoint' },
    { do: 'mood', mood: 'wait' },
    {
      waitFor: 'fileOpened',
      args: { path: 'practice:AGENTS.md' },
      hint: { anchor: 'file:practice:AGENTS.md', say: { ko: '왼쪽 파일 탐색기의 연습 폴더 안에서 AGENTS.md 를 클릭해 봐.' } },
      fallback: { open: 'practice:AGENTS.md' },
    },
    { do: 'mood', mood: 'idle' },
    {
      say: {
        ko: '천천히 읽어 봐. 어려운 말은 없을 거야.||ingest, query, lint 같은 영어 단어가 나오는데, 다음 레슨부터 하나씩 직접 해 볼 거라 지금은 몰라도 돼.||나중에 AI 가 일하는 방식을 바꾸고 싶으면 이 파일만 고치면 돼. 그것도 뒤에서 해 볼 거야.',
      },
    },
    {
      quiz: {
        q: { ko: 'wiki 폴더의 노트는 누가 쓸까?' },
        choices: [{ ko: 'AI 가 쓰고 사용자는 읽는다' }, { ko: '사용자가 직접 쓴다' }],
        answer: 0,
        fb: { ko: '맞아. 사용자는 재료(raw 폴더 속 파일)를 넣고, 정리는 AI 가 해.' },
        wrong: { ko: 'wiki 폴더는 AI 만 고치는 곳이야. 사람이 정리까지 하면 금방 지쳐. 다시 골라 봐.' },
      },
    },
    { done: true },
  ],
};

const B1 = {
  id: 'B1',
  course: 'B',
  minutes: 4,
  title: { ko: '첫 재료 넣기' },
  intro: {
    ko: '이번 시간엔 raw 폴더에 첫 재료(raw 폴더 속 파일)를 넣어 볼 거야. AI 가 raw 폴더를 어떻게 다루는지도 알아볼게.',
  },
  steps: [
    { say: { ko: 'raw 폴더엔 아직 안내 파일 README.md 뿐이니까 재료(raw 폴더 속 파일)부터 넣자.||연습용으로 내가 글 하나를 준비해 왔어. "개인 위키가 뭔가"에 대한 짧은 글이야.' } },
    {
      say: {
        ko: 'AI 가 raw 폴더를 다루는 규칙이 하나 있어. **AI 는 raw 폴더 속 파일을 읽기만 하고 절대 고치지 않아.**||그래서 파일 이름이 중요해. AI 가 이름을 바꿔 주지 않으니까, 처음 넣을 때 "문서1" 같은 이름 말고 내용을 알 수 있는 이름으로 넣어 줘.',
      },
    },
    { say: { ko: '이번에도 넣기 전에 확인 창이 뜰 거야. "만들기"를 눌러 줘.' } },
    { replay: 'raw', n: 1 },
    { waitFor: 'fileCountIn', args: { path: 'practice:raw', min: 2 }, hint: { say: { ko: '확인 창에서 "만들기"를 누르면 재료(raw 폴더 속 파일)가 들어가.' } } },
    { do: 'point', anchor: 'folder:practice:raw', label: { ko: '재료 1' } },
    {
      say: {
        ko: '들어갔다. raw 폴더를 펼쳐 보면 "01-개인 위키가 뭔가"가 있을 거야. 클릭해서 읽어 봐도 돼.||혼자 할 땐 메모 파일을 파일 탐색기에서 raw 폴더 위로 끌어다 놓거나, raw 폴더를 오른쪽 클릭해서 새 노트를 만들어 쓰면 돼.||웹에서 본 기사는 **Web Clipper** 라는 옵시디언 공식 브라우저 확장 프로그램으로 바로 저장할 수도 있어. 그건 필요할 때 찾아봐.',
      },
    },
    { do: 'unpoint' },
    {
      quiz: {
        q: { ko: 'AI 는 raw 폴더 속 파일을 어떻게 다룰까?' },
        choices: [{ ko: '읽기만 하고 절대 고치지 않는다' }, { ko: '읽고 나서 알아서 고쳐 둔다' }],
        answer: 0,
        fb: { ko: '맞아. 재료(raw 폴더 속 파일)는 원본 그대로 두고, 정리한 내용은 wiki 폴더에 기록해.' },
        wrong: { ko: 'AI 가 재료(raw 폴더 속 파일)를 고치면 나중에 wiki 내용이 어디서 왔는지 확인할 수 없어. 다시 골라 봐.' },
      },
    },
    { done: true },
  ],
};

const INGEST_FIG = {
  kind: 'ingest',
  labels: { ko: ['재료 1편', '요약 1', '개념 3', '목차', '작업 기록', '재료 하나로 노트 여러 개가 바뀐다'] },
};

const B2 = {
  id: 'B2',
  course: 'B',
  minutes: 6,
  title: { ko: '첫 요리 — ingest' },
  intro: {
    ko: '이번 시간엔 AI 가 재료(raw 폴더 속 파일)를 읽고 wiki 에 노트를 쓰는 작업, ingest 를 처음으로 볼 거야. 재료 한 편에서 노트가 몇 개 생기는지 직접 확인해 봐.',
  },
  steps: [
    {
      say: {
        ko: 'AI 가 raw 폴더 속 파일, 곧 재료를 읽고 wiki 폴더에 노트를 쓰는 작업을 **ingest** 라고 해. 원래 "받아들여서 소화한다"는 뜻이야.||재료(raw 폴더 속 파일)를 받아서 먹기 좋게 만드는 일이니까, 앞으로 이 작업을 **요리(ingest)**라고도 부를게. "요리한다"고 하면 ingest 한다는 뜻이야.',
      },
    },
    {
      say: {
        ko: '재료(raw 폴더 속 파일) 한 편을 요리(ingest)하면 wiki 에 이런 게 생기거나 바뀌어.||1. 그 글을 요약한 노트 1개. wiki 안 **요약 폴더(sources)**에 들어가.||2. 글에 나온 중요한 개념마다 노트 1개씩. wiki 안 **개념 폴더(concepts)**에 들어가.||3. 목차(index.md)에 새 노트 이름이 추가되고, 작업 기록(log.md)에 한 줄이 붙어.',
      },
      figure: INGEST_FIG,
    },
    { say: { ko: '이번엔 실제 AI 대신 내가 AI 가 ingest 명령어를 수행하는 과정을 재현해 볼게. 실제 AI 로 하는 건 마지막 레슨(B8)에서 해.||확인 창이 뜨면 "만들기"를 눌러 줘.' } },
    { replay: 'ingest', stage: 1 },
    { waitFor: 'fileCountIn', args: { path: 'practice:wiki/concepts', min: 3 }, hint: { say: { ko: '확인 창에서 "만들기"를 눌러야 요리(ingest)가 시작돼.' } } },
    { do: 'point', anchor: 'folder:practice:wiki/sources', label: { ko: '요약 폴더(sources)' } },
    { say: { ko: 'wiki 폴더 안에 요약 폴더(sources)가 생겼지? 여기엔 재료(raw 폴더 속 파일)를 요약한 노트가 들어 있어. 재료 하나에 요약 하나야.' } },
    { do: 'point', anchor: 'folder:practice:wiki/concepts', label: { ko: '개념 폴더(concepts)' } },
    { say: { ko: '그 아래 개념 폴더(concepts)엔 개념 노트가 3개 생겼어. "개인 위키", "꺼내 쓰기", "매일 기록".||raw 폴더에 있는 글 재료들에서 중요한 개념들을 유목화해 정리해 둔 거야.' } },
    { do: 'unpoint' },
    {
      say: {
        ko: '목차(index.md)랑 작업 기록(log.md)도 바뀌었어. 궁금하면 열어 봐.||이렇게 재료(raw 폴더 속 파일) 하나를 요리(ingest)하면 wiki 노트 여러 개가 한꺼번에 바뀌어. 사람이 하면 귀찮아서 안 하게 되는 일(기록 유목화, 태그 붙이기, 인사이트 추출 등)을 AI 가 훨씬 정교하게 대신 하는 거야.',
      },
    },
    {
      faq: {
        title: { ko: '요리(ingest) 보고 궁금한 거 있어?' },
        items: [
          {
            q: { ko: '방금 건 진짜 AI 가 한 거야?' },
            a: {
              ko: '아니. AI 가 하는 과정을 내가 재현해서 보여 준 거야. 그래서 빠르고 돈도 안 들어.\n\n마지막 레슨(B8)에선 네가 쓰는 실제 AI 로 네 재료(raw 폴더 속 파일)를 요리(ingest)해 볼 거야. 그 전까지는 결과가 어떻게 생기는지 익히는 거야.',
            },
          },
          {
            q: { ko: '요약 폴더(sources)랑 개념 폴더(concepts)는 뭐가 달라?' },
            a: {
              ko: '**요약 폴더(sources)** 엔 재료(raw 폴더 속 파일) 하나를 요약한 노트가 들어가. 재료 하나에 요약 하나.\n\n**개념 폴더(concepts)** 엔 개념 하나를 정리한 노트가 들어가. 여러 재료(raw 폴더 속 파일)에서 같은 개념이 나오면 같은 개념 노트에 내용이 계속 더해져. 그래서 재료가 쌓일수록 개념 노트가 점점 풍부해져.',
            },
          },
          {
            q: { ko: '직접 쓴 메모도 재료(raw 폴더 속 파일)가 돼?' },
            a: {
              ko: '그럼. 오히려 제일 좋은 재료(raw 폴더 속 파일)야. 남이 쓴 글보다 "그때 무슨 생각을 했지"가 나중에 훨씬 쓸모 있어.\n\n옵시디언 사용법 기초 과정(A1)에서 만든 "오늘 알게 된 것" 노트도 raw 폴더에 넣으면 재료(raw 폴더 속 파일)가 돼. 마지막 레슨에서 그걸 요리(ingest)할 수도 있어.',
            },
          },
        ],
      },
    },
    { done: true },
  ],
};

const B3 = {
  id: 'B3',
  course: 'B',
  minutes: 4,
  title: { ko: 'AI 가 쓴 노트 읽기' },
  intro: {
    ko: '이번 시간엔 AI 가 쓴 노트를 하나 열어서 어떻게 생겼는지 보고, wiki 노트는 왜 사용자가 직접 고치지 않는지 알아볼 거야.',
  },
  steps: [
    { say: { ko: 'AI 가 쓴 노트를 하나 열어 보자.||wiki 폴더 안 개념 폴더(concepts)에서 "개인 위키" 노트를 클릭해 봐.' } },
    { do: 'point', anchor: 'folder:practice:wiki/concepts', label: { ko: '개념 폴더(concepts) 안에' } },
    { do: 'mood', mood: 'wait' },
    {
      waitFor: 'fileOpened',
      args: { path: C_SB },
      hint: { anchor: 'folder:practice:wiki/concepts', say: { ko: 'wiki 폴더와 그 안의 개념 폴더(concepts)를 펼치고 "개인 위키"를 클릭해 봐.' } },
      fallback: { open: C_SB },
    },
    { do: 'unpoint' },
    { do: 'mood', mood: 'idle' },
    { do: 'act', motion: 'ttilt' },
    {
      say: {
        ko: '네가 쓴 노트는 아니지만, 네 raw 폴더의 재료로 AI 가 만든 노트야. 위에서부터 같이 보자.||**한 줄** 칸엔 이 개념을 한 문장으로 요약해 뒀어.||**재료** 칸엔 이 내용이 raw 폴더의 어느 파일에서 왔는지 기록돼 있어. 원본을 확인하고 싶을 때 보면 돼.||**내용** 칸 중간에 색이 다른 글자들은 다른 wiki 노트로 가는 링크(연결고리)야. 노트끼리 잇는 연결고리를 AI 가 걸어 둔 거야.',
      },
    },
    {
      card: {
        title: { ko: 'wiki 는 읽고, raw 에 쓴다' },
        body: {
          ko: 'wiki 노트를 사용자가 직접 고치면, 다음에 AI 가 요리(ingest)할 때 같은 노트를 다시 쓰면서 사용자가 고친 부분이 사라질 수 있어. 그래서 wiki 폴더는 AI 만 고쳐.\n\n고칠 게 보이면 파일을 직접 고치지 말고 **AI 에게 말해.** 예를 들어 "개인 위키 노트에서 ○○ 부분 고쳐 줘" 하고.\n\n사용자의 생각을 덧붙이고 싶으면 raw 폴더에 새 재료(raw 폴더 속 파일)로 기록해 넣으면 돼. 그러면 다음에 요리(ingest)할 때 AI 가 반영해.',
        },
        buttons: [{ ko: '알았어' }],
      },
    },
    {
      quiz: {
        q: { ko: 'wiki 노트에서 틀린 내용을 발견하면?' },
        choices: [{ ko: 'AI 에게 고쳐 달라고 한다' }, { ko: '사용자가 바로 고친다' }],
        answer: 0,
        fb: { ko: '맞아. 그래야 다음에 요리(ingest)할 때도 고친 내용이 남아.' },
        wrong: { ko: '직접 고치면 다음 요리(ingest) 때 AI 가 덮어쓸 수 있어. 다시 골라 봐.' },
      },
    },
    { done: true },
  ],
};

const B4 = {
  id: 'B4',
  course: 'B',
  minutes: 7,
  title: { ko: '재료가 늘면 연결고리도 는다' },
  intro: {
    ko: '이번 시간엔 그래프 뷰로 지금 위키를 보고, 재료(raw 폴더 속 파일)를 하나 더 요리(ingest)한 다음 연결고리가 어떻게 늘어나는지 비교해 볼 거야. 목차(index.md)가 왜 중요한지도 알아볼게.',
  },
  steps: [
    {
      say: {
        ko: '먼저 지금 위키가 어떻게 이어져 있는지 그래프 뷰로 보자.||그래프 뷰에선 점 하나가 노트 하나, 선 하나가 링크(연결고리) 하나야.||그래프 뷰는 맨 왼쪽 아이콘 줄에 있는 이 아이콘으로 열어.',
      },
    },
    {
      command: 'graph:open',
      ms: 1200,
      via: GRAPH_RIBBON,
      viaLabel: { ko: '그래프 뷰' },
      viaSay: { ko: '여기. 동그라미 몇 개가 선으로 이어진 아이콘이야. 이번엔 내가 눌러 줄게.' },
    },
    {
      waitFor: 'graphOpened',
      args: {},
      hint: { anchor: GRAPH_RIBBON, say: GRAPH_HINT },
      fallback: { command: 'graph:open' },
    },
    { do: 'point', anchor: 'graph' },
    {
      say: {
        ko: '점이 몇 개 있고 선도 몇 개 있지? 아직은 단출해.||그래프 뷰는 볼트 전체를 보여 줘서, raw · wiki 말고 다른 노트도 같이 보여. 옵시디언 사용법 기초 과정(A4)에서 만든 고양이, 츄르 노트가 선으로 이어져 있는 것도 보일 거야.||이제 재료(raw 폴더 속 파일)를 하나 더 넣고 요리(ingest)한 다음, 어떻게 바뀌는지 보자.',
      },
    },
    { do: 'unpoint' },
    { say: { ko: '이번 재료(raw 폴더 속 파일)는 "왜 다들 실패하나"라는 글이야.||확인 창이 두 번 뜰 거야. 한 번은 재료(raw 폴더 속 파일) 넣기, 한 번은 요리(ingest). 둘 다 "만들기"를 눌러 줘.' } },
    { replay: 'raw', n: 2, carry: false },
    { replay: 'ingest', stage: 2 },
    { waitFor: 'fileCountIn', args: { path: 'practice:wiki/concepts', min: 5 }, hint: { say: { ko: '확인 창에서 "만들기"를 눌러 줘.' } } },
    { command: 'graph:open', ms: 1200 },
    { do: 'point', anchor: 'graph' },
    {
      say: {
        ko: '점도 선도 늘었지?||새 재료(raw 폴더 속 파일)에서 개념 노트가 2개 더 생겼고, 원래 있던 "개인 위키" 노트에도 새 내용과 링크가 더해졌어. 새 재료가 옛 노트까지 고쳐 준 거야.||재료(raw 폴더 속 파일)가 쌓일수록 노트끼리 더 촘촘하게 이어지고, 그래서 나중에 물어봤을 때 답도 좋아져.',
      },
      figure: { kind: 'loop', labels: { ko: ['재료 넣기', '요리(ingest)', '연결고리가 늘어남', '다음 답이 좋아짐'] } },
    },
    { do: 'unpoint' },
    {
      card: {
        title: { ko: '채팅에 파일 올리기와 뭐가 달라?' },
        body: {
          ko: 'AI 채팅에 파일을 올려서 물어보면, AI 는 질문할 때마다 원래 글을 처음부터 다시 읽고 답을 만들어. 대화가 끝나면 AI 가 정리한 건 아무 데도 남지 않아.\n\nLLM Wiki 에선 AI 가 정리한 결과를 wiki 폴더에 노트로 남겨 둬. 새 재료(raw 폴더 속 파일)가 들어오면 그 노트에 더하고 고쳐. 방금 본 것처럼 재료가 쌓일수록 위키가 점점 좋아지는 거야.\n\n카파시가 이 방법을 제안한 핵심 이유가 이거야. **정리한 결과가 쌓인다.**',
        },
        buttons: [{ ko: '알았어' }],
      },
    },
    {
      card: {
        title: { ko: '목차 (index.md)' },
        body: {
          ko: 'wiki 에 어떤 노트가 있는지 한 줄씩 기록해 둔 목록이야. AI 가 요리(ingest)할 때마다 새 노트를 여기에 추가해.\n\n나중에 AI 에게 뭘 물어보면, AI 는 **이 목차부터 읽고** 관련 있는 노트만 골라서 열어 봐. 그래서 노트가 수백 개가 돼도 전부 읽지 않고 답을 찾을 수 있어.\n\nwiki 폴더의 index.md 를 열어 보면 지금까지 생긴 노트가 정리돼 있을 거야.',
        },
        buttons: [{ ko: '알았어' }],
      },
    },
    { done: true },
  ],
};

const B5 = {
  id: 'B5',
  course: 'B',
  minutes: 5,
  title: { ko: '물어보기 — query' },
  intro: {
    ko: '이번 시간엔 위키에 쌓인 내용을 꺼내 쓰는 법을 배워. 질문을 골라서 출처가 달린 답을 받아 보고, 좋은 답은 위키에 저장해 볼 거야.',
  },
  steps: [
    { say: { ko: '위키에서 뭔가를 꺼내 쓰는 걸 **query** 라고 해. 우리말로는 그냥 **물어보기**야.||특별한 명령어는 없어. AI 채팅창에 평소처럼 말로 물어보면 돼.' } },
    {
      say: {
        ko: '물어보면 AI 는 이 순서로 답해.||1. 먼저 목차(index.md)를 보고,||2. 질문과 관련된 노트를 열어 읽은 다음,||3. 답 끝에 **어느 노트를 보고 답했는지(출처)**를 달아.||출처가 있으니까, 답이 맞는지 원래 노트를 열어서 확인할 수 있어.',
      },
    },
    { say: { ko: '지금은 연습이라 질문 세 개에 대한 답을 raw 폴더의 재료를 바탕으로 미리 기록해 뒀어. 하나씩 눌러 보고, 다 봤으면 "넘어가기" 버튼을 눌러 줘.||마음에 드는 답이 있으면 "위키에 저장"도 눌러 봐.' } },
    { replay: 'query' },
    {
      say: {
        ko: '저장한 답은 wiki 폴더 안 답변 폴더(answers)에 들어가.||좋은 답을 이렇게 위키에 다시 넣어 두면, 다음에 물어볼 때 AI 가 그 답까지 같이 읽어. 쓸수록 위키가 좋아지는 이유야.||실제로 할 땐 AI 한테 "이 답 위키에 저장해 줘"라고 말하면 돼.',
      },
    },
    {
      card: {
        title: { ko: '잘 물어보는 요령' },
        body: {
          ko: '1. **어디를 보라고 말해 줘.** 예: "raw 폴더에 있는 지난주 기록을 읽고"\n2. **답의 모양을 정해 줘.** 예: "표로 정리해 줘", "체크리스트로 만들어 줘"\n3. **"기록에 없으면 없다고 말해 줘"를 붙여.** 이 한 줄이 있으면 AI 가 없는 내용을 지어내는 걸 막을 수 있어.',
        },
        buttons: [{ ko: '알았어' }],
      },
    },
    { done: true },
  ],
};

const OPS_FIG = {
  kind: 'ops',
  labels: { ko: ['ingest · 요리', 'query · 물어보기', 'lint · 위키 청소'] },
};

const B6 = {
  id: 'B6',
  course: 'B',
  minutes: 6,
  title: { ko: '위키 청소 — lint' },
  intro: {
    ko: '이번 시간엔 재료(raw 폴더 속 파일)를 하나 더 요리(ingest)한 다음, 노트가 쌓이면 생기는 문제를 AI 가 찾아서 고치는 작업(lint)을 볼 거야.',
  },
  steps: [
    { say: { ko: '재료(raw 폴더 속 파일)를 하나 더 넣고 요리(ingest)해 보자. 이번 건 "AI 한테 시키는 법"에 대한 글이야.||이번에도 확인 창이 두 번 뜰 거야. 재료(raw 폴더 속 파일) 넣기 한 번, 요리(ingest) 한 번. 둘 다 "만들기"를 눌러 줘.' } },
    { replay: 'raw', n: 3, carry: false },
    { replay: 'ingest', stage: 3 },
    { waitFor: 'fileCountIn', args: { path: 'practice:wiki/concepts', min: 7 }, hint: { say: { ko: '확인 창에서 "만들기"를 눌러 줘.' } } },
    {
      say: {
        ko: '재료(raw 폴더 속 파일)가 쌓이면 꼭 생기는 문제가 세 가지 있어.||1. 글마다 말이 달라. 한 글은 "하루 세 줄", 다른 글은 "하루 한 줄" 하는 식으로. 새 재료(raw 폴더 속 파일)와 안 맞게 낡아 버린 내용도 생겨.||2. 다른 노트 어디에서도 링크되지 않은 노트가 생겨. 이런 노트를 **고아 노트**라고 해.||3. 여러 노트에서 말은 나오는데, 정작 그 개념을 설명하는 노트는 없어.',
      },
    },
    {
      say: {
        ko: '이런 걸 찾아서 고치는 작업을 **lint** 라고 해. 원래는 프로그램 코드에서 실수를 찾아 주는 도구 이름이야.||앞으로 이 작업을 **위키 청소(lint)**라고 부를게.||이걸로 AI 가 하는 일 세 가지가 다 나왔어. 1. 요리(ingest) 2. 물어보기(query) 3. 위키 청소(lint).',
      },
      figure: OPS_FIG,
    },
    { say: { ko: '지금 위키를 청소해 볼게. 결과가 뜨면 읽어 보고 "고쳐 줘"를 눌러 줘.' } },
    { replay: 'lint' },
    { say: { ko: '청소는 매일 할 필요 없어. 노트가 꽤 쌓였다 싶을 때 한 번씩 하면 돼.||청소할 때 AI 가 "이런 재료(raw 폴더 속 파일)를 더 넣어 보면 좋겠다", "이런 걸 물어보면 좋겠다" 하고 추천해 주기도 해.' } },
    {
      quiz: {
        q: { ko: '위키 청소(lint)가 찾는 건?' },
        choices: [{ ko: '어긋난 말 · 고아 노트 · 빠진 개념 노트' }, { ko: '맞춤법 틀린 곳' }],
        answer: 0,
        fb: { ko: '맞아. 노트끼리 말이 맞고 잘 이어지게 하는 거야.' },
        wrong: { ko: '맞춤법은 상관없어. 노트끼리 내용이 맞는지, 잘 이어져 있는지를 봐. 다시 골라 봐.' },
      },
    },
    { done: true },
  ],
};

const B7 = {
  id: 'B7',
  course: 'B',
  minutes: 5,
  title: { ko: '규칙 바꾸기 — AGENTS.md' },
  intro: {
    ko: '이번 시간엔 규칙 파일(AGENTS.md)에 규칙 한 줄을 더해서 개념 노트의 정리 형식을 바꿔 볼 거야. 그 한 줄 때문에 wiki 노트가 한꺼번에 바뀌는 걸 보게 될 거야. AI 가 일하는 방식을 사용자가 정하는 방법이야.',
  },
  steps: [
    { say: { ko: '마지막으로 배울 건 AI 가 일하는 방식을 바꾸는 방법이야.||방법은 간단해. 규칙 파일 AGENTS.md 에 원하는 규칙을 한 줄 기록하면 돼.' } },
    { do: 'point', anchor: 'file:practice:AGENTS.md', label: { ko: 'AGENTS.md' } },
    {
      say: {
        ko: '이런 상황이라고 해 보자. 개념 폴더(concepts)의 노트를 읽어 보니 한 줄 요약만으로는 감이 잘 안 와. 그래서 개념 노트를 정리하는 형식을 바꾸고 싶어.||그럴 땐 노트를 하나하나 고쳐 달라고 하지 말고, AGENTS.md 에 이 규칙을 더하면 돼. "개념 노트마다 **예시** 칸을 두고, 일상에서 볼 수 있는 예시를 하나 적는다."||확인 창이 두 번 뜰 거야. 규칙 더하기 한 번, 다시 요리(ingest) 한 번. 둘 다 "만들기"를 눌러 줘.',
      },
    },
    { do: 'unpoint' },
    { replay: 'schema' },
    {
      say: {
        ko: 'AGENTS.md 에 한 줄 더했을 뿐인데 개념 노트가 전부 바뀌었지? 개념 폴더(concepts)의 노트를 아무거나 열어서 맨 아래 **예시** 칸을 봐.||노트를 하나하나 고칠 필요 없이, 규칙만 바꾸고 다시 요리(ingest)하면 돼.||AI 가 원하는 대로 안 해 줄 때도 매번 말로 부탁하기보다 규칙 파일에 기록해 두는 게 좋아. 규칙 파일은 쓰면서 조금씩 다듬어 가는 거야.',
      },
      figure: { kind: 'ops', labels: { ko: ['규칙 한 줄 추가', '다시 요리', '노트가 전부 바뀜'] } },
    },
    {
      quiz: {
        q: { ko: 'AI 가 노트 쓰는 방식을 바꾸고 싶으면?' },
        choices: [{ ko: 'AGENTS.md 에 규칙을 적는다' }, { ko: '노트를 하나씩 직접 고친다' }],
        answer: 0,
        fb: { ko: '맞아. 규칙 한 줄이 모든 노트에 적용돼.' },
        wrong: { ko: 'wiki 노트는 AI 만 고치는 거고, 하나씩 고치다 보면 금방 지쳐. 다시 골라 봐.' },
      },
    },
    { done: true },
  ],
};

const B8 = {
  id: 'B8',
  course: 'B',
  minutes: 8,
  title: { ko: '수료 — 네 재료를 실제 AI 로' },
  intro: {
    ko: '마지막 시간이야. 지금까지는 내가 재현해서 보여 준 결과를 봤는데, 이번엔 네가 평소 쓰는 AI 로 네 재료(raw 폴더 속 파일) 하나를 직접 요리(ingest)해 볼 거야. 끝나면 수료야.',
  },
  steps: [
    {
      say: { ko: '지금까지 본 요리(ingest)는 전부 내가 재현해서 보여 준 거였어.||이번엔 네가 평소에 쓰는 **실제 AI** 로 직접 해 보자.' },
      figure: { kind: 'loop', labels: { ko: ['재료 하나', 'AI 에게 요리(ingest) 부탁', '첫 노트가 생긴다', '매일 세 줄 · 일주일에 한 번 요리'] } },
    },
    { real: 'askMode' },
    { if: 'mode', eq: 'folder', then: [{ real: 'folderGuide' }], else: [] },
    {
      card: {
        title: { ko: '재료 하나 넣기' },
        body: {
          ko: 'raw 폴더에 **네 글 하나**를 넣어 줘. 이게 네 첫 재료(raw 폴더 속 파일)야. 방법은 편한 걸로 골라.\n\n1. 볼트에 있는 네 노트 하나를 파일 탐색기에서 raw 폴더 위로 끌어다 놓기 (원래 있던 자리에선 옮겨져). 옵시디언 사용법 기초 과정(A1)에서 만든 "오늘 알게 된 것" 노트도 좋아.\n2. raw 폴더를 오른쪽 클릭해서 새 노트를 만들고, 오늘 있었던 일 세 줄 기록하기\n3. Web Clipper 로 기사 하나 저장하기\n\n고르기 어려우면 그냥 기다려. 조금 있다가 내가 연습용 재료(raw 폴더 속 파일)를 대신 넣어 줄지 물어볼게.',
        },
        buttons: [{ ko: '알았어' }],
      },
    },
    { do: 'point', anchor: 'folder:practice:raw', label: { ko: 'raw 폴더' } },
    { do: 'mood', mood: 'wait' },
    {
      waitFor: 'fileCountIn',
      args: { path: 'practice:raw', min: 5 },
      hint: { anchor: 'folder:practice:raw', say: { ko: '노트 하나를 파일 탐색기에서 이 raw 폴더 위로 끌어다 놓으면 돼.' } },
      fallback: {
        write: {
          op: 'note',
          path: FIRST_RAW,
          content: { ko: '# 내 첫 재료\n\n- 위키 정리는 AI 한테 맡기면 된다\n- 저장만 하면 잊는다\n- 매일 세 줄이면 된다\n' },
        },
        preview: false,
      },
    },
    { do: 'unpoint' },
    { do: 'mood', mood: 'idle' },
    { real: 'ingest' },
    { do: 'mood', mood: 'wait' },
    {
      waitFor: 'newFileUnder',
      args: { path: 'practice:wiki', since: '$ingestAt' },
      hint: { anchor: 'folder:practice:wiki', say: { ko: 'AI 가 다 쓰면 wiki 폴더에 새 노트가 생겨. 아직이면 AI 창을 한번 확인해 봐.' } },
    },
    { do: 'mood', mood: 'idle' },
    { do: 'act', motion: 'tgradcap', ms: 2300 },
    { say: { ko: '네 재료(raw 폴더 속 파일)로, 네 AI 가 만든 첫 노트가 생겼어. 수료 축하해!' }, kind: 'cheer' },
    {
      card: {
        title: { ko: '앞으로 할 일' },
        body: {
          ko: '1. **매일 세 줄**: raw 폴더에 오늘 한 일, 알게 된 것, 메모. 형식은 상관없어.\n2. **일주일에 한 번 요리(ingest)**: 요일을 정해 둬. "생각날 때 하지" 하면 잘 안 하게 돼.\n3. **처음엔 재료를 하나씩**: 재료(raw 폴더 속 파일)를 한꺼번에 몰아넣지 말고, 하나 요리할 때마다 AI 가 쓴 노트를 훑어봐. 마음에 안 들면 AGENTS.md 에 규칙을 더하면 돼.\n4. **이번 달 안에 한 번 꺼내 쓰기**: 한 주 정리를 부탁하든, "그때 왜 그렇게 했더라"를 물어보든. 한 번 해 보면 왜 기록하는지 실감이 나.',
        },
        buttons: [{ ko: '알았어' }],
      },
    },
    { real: 'promptCards' },
    {
      card: {
        title: { ko: '다음에 쓸 도구' },
        body: {
          ko: '이 연습 폴더를 그대로 계속 써도 되고, 더 본격적인 도구로 옮겨 가도 돼.\n\n1. **Karpathy LLM Wiki 플러그인**: 옵시디언 설정의 커뮤니티 플러그인에서 설치할 수 있어. 위키 폴더를 이 연습 폴더의 `wiki` 로 지정하면 지금까지 만든 노트에 이어서 쓸 수 있어.\n2. **클로드 데스크톱 앱**: 볼트 폴더를 연결해 두면 "ingest 해 줘" 한마디로 요리(ingest)할 수 있어.\n\n나는 화면 아래에 계속 있을게. 가끔 "오늘 세 줄 기록했어?" 하고 물어볼 거야.',
        },
        buttons: [{ ko: '고마워' }],
      },
    },
    {
      say: {
        ko: '마지막으로 하나만. 지금까지는 "매일 세 줄"이라고 했지만, 세 줄은 습관을 만드는 시작일 뿐이야.||매일 기록하는 내용의 질이 높을수록, 그리고 "왜 그렇게 했는지", "그때 무슨 생각이었는지" 같은 맥락이 많이 기록될수록 AI 가 만들어 주는 위키도 훨씬 풍성해져.||세 줄로 시작해서, 익숙해지면 조금씩 더 자세히 기록해 봐. 네 위키는 네가 남긴 기록만큼 자라.',
      },
      kind: 'cheer',
    },
    { done: true },
  ],
};

module.exports = { B0, B1, B2, B3, B4, B5, B6, B7, B8, COURSE_B: [B0, B1, B2, B3, B4, B5, B6, B7, B8] };
