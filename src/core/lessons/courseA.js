// 코스 A — 옵시디언 사용법 기초. 레슨은 단계(step) 배열이고 글은 { ko, en, zh } 이다.
// 10차에서 한국어판을 새로 썼다. en · zh 는 이 한국어판을 기준으로 나중에 한꺼번에 다시 옮긴다 (그 전까지는 한국어로 나온다).
// 옛 en · zh 글은 ../백업_10차전/ 에 있다.
//
// 레슨: { id, course, minutes, title, intro, steps }  intro 는 레슨을 시작할 때 "이번 시간엔 뭘 배우나" (엔진이 제목과 함께 말한다)
// 단계 종류 (core/engine.js 가 돈다):
//  { say, choices?, as?, title?, figure? }   고양이 말. 사용자가 넘길 때까지 그대로 있다. choices 가 있으면 고른 번호를 vars[as] 에. '앞말||뒷말' 은 말풍선 둘로
//  { card: { title, body, buttons, figure }, as? } 긴 설명 카드
//  { faq: { title, intro?, items: [{ q, a, figure? }] } }  궁금한 점 코너: 질문 버튼들 + 넘어가기. 하나 보면 다시 목록으로
//  { do: 'goto'|'point'|'unpoint'|'carry'|'prop'|'act'|'fx'|'mood'|'wait', ... }  연출. anchor 는 'folder:practice:raw' 처럼 practice: 를 쓸 수 있다
//  { write / writes, preview? }  볼트 쓰기 (core/practice.js). preview 는 기본 true
//  { waitFor, args, hint: { anchor?, say }, fallback? }  사용자가 할 때까지 기다린다. 30초 막히면 hint, 또 30초면 "대신 해 줄까?" → fallback
//  { quiz: { q, choices, answer, fb, wrong } }  1문항. 엔진이 질문 앞에 "Q." 를 붙인다
//  { if: 'var', eq, then: [steps], else: [steps] }
//  { command, via?, viaLabel?, viaSay?, ms? }  옵시디언 명령 실행. via 가 있으면 그 자리를 먼저 가리키고(혼자 쓸 때 알 수 있게) 실행
//  { showInFolder: path } · { open: path } · { stop: true } · { done: true }
// figure: { kind: 'rooms'|'ingest'|'ops'|'markdown'|'links'|'loop'|'roles', labels: { ko: [...], en: [...], zh: [...] } }  — kit/pet.js 의 figureHtml
//
// 말투: 고양이가 처음 옵시디언을 켠 친구에게 옆에서 알려 주는 반말. 비유는 개념을 먼저 제 이름으로 설명한 뒤
// "앞으로 ~라고 부를게" 하고 정해 둔 것만 쓴다 (재료 · 요리 · 위키 청소 · 연결고리).
// 11차 표기 규칙:
//  - 사용자를 가리킬 땐 1인칭(나 · 내가)을 쓰지 않고 "사용자"라고 쓴다 (고양이의 "나"와 헷갈리지 않게). 사용자에게 직접 말할 땐 "너 · 네".
//  - 재료는 "재료(raw 폴더 속 파일)", 요리는 "요리(ingest)"로, 말풍선마다 처음 나올 때 괄호를 붙인다.
//  - wiki 안 폴더는 "개념 폴더(concepts)"처럼 실제 폴더 이름을 괄호로 같이 쓴다.
//  - 차례로 나오는 개념은 1. 2. 3. 으로 번호를 붙인다. "적어 두다"는 "기록해 두다"로.
'use strict';

const NOTE_TODAY = { ko: 'practice:오늘 알게 된 것.md', en: 'practice:What I learned today.md', zh: 'practice:今天学到的.md' };
const NOTE_TODAY_ROW = { ko: 'file:practice:오늘 알게 된 것.md', en: 'file:practice:What I learned today.md', zh: 'file:practice:今天学到的.md' };
const NOTE_PAD = { ko: 'practice:연습장.md', en: 'practice:Scratchpad.md', zh: 'practice:练习本.md' };
const NOTE_A = { ko: 'practice:고양이.md', en: 'practice:Cat.md', zh: 'practice:猫.md' };
const NOTE_B = { ko: 'practice:츄르.md', en: 'practice:Churu.md', zh: 'practice:猫条.md' };
const GRAPH_RIBBON = { ko: 'ribbon:그래프 뷰 열기', en: 'ribbon:Open graph view', zh: 'ribbon:查看关系图谱' };
// 옵시디언 화면 둘러보기에서 가리키는 자리
// 넓은 칸은 host.markerFor 가 깜빡이는 테두리 상자로 감싼다
const EXPLORER = 'sel:.workspace-leaf-content[data-type="file-explorer"]';
// 맨 왼쪽 아이콘 줄: 1.14 는 mod-primary, 그 전엔 mod-left
const ICON_STRIP = 'sel:.workspace-ribbon.side-dock-ribbon.mod-primary, .workspace-ribbon.side-dock-ribbon.mod-left';
const MAIN_AREA = 'sel:.workspace-split.mod-root';

const A0 = {
  id: 'A0',
  course: 'A',
  minutes: 5,
  title: { ko: '만남, 그리고 화면 둘러보기' },
  intro: {
    ko: '첫 시간이야. 인사하고, 옵시디언 화면이 어떻게 생겼는지 같이 둘러본 다음 연습용 폴더를 하나 만들 거야.',
  },
  steps: [
    { do: 'mood', mood: 'idle' },
    { say: { ko: '안녕! 나는 이 수업을 맡은 고양이야.||이름은 아직 없어. 같이 하다가 좋은 이름이 떠오르면 지어 줘.' } },
    {
      say: { ko: '"AI 가 알아서 정리해 주는 위키" 얘기 듣고 왔지?' },
      choices: [{ ko: '응, SNS 에서 봤어' }, { ko: '그냥 궁금해서' }],
      as: 'sawSB',
    },
    {
      if: 'sawSB',
      eq: 0,
      then: [{ say: { ko: '나도 그거 보고 해 보고 싶었는데, 막상 어디서부터 해야 할지 모르겠더라.||그래서 처음부터 하나씩 같이 해 보려고.' } }],
      else: [{ say: { ko: '궁금해서 왔으면 충분해.||처음부터 하나씩 같이 해 보자.' } }],
    },
    { say: { ko: '수업은 두 부분이야.||앞부분(A)은 옵시디언 기본 사용법이고, 뒷부분(B)은 AI 가 정리해 주는 위키를 실제로 만들어 보는 거야. 레슨 하나는 5분 안팎이야.' } },
    {
      say: {
        ko: '말풍선 보는 법부터 알려 줄게.||내 말은 네가 넘기기 전까지 그대로 있어. 다 읽었으면 말풍선을 한 번 누르면 다음 말로 넘어가.||지나간 말을 다시 보고 싶으면 왼쪽 아래 "← 이전"을 누르면 돼. 지금 한번 눌러 봐도 좋아.',
      },
    },
    { say: { ko: '이제 옵시디언 화면을 같이 둘러보자. 처음엔 세 군데만 알면 돼. 하나씩 깜빡이는 테두리로 짚어 줄게.' } },
    { command: 'file-explorer:open', ms: 600 },
    { do: 'point', anchor: EXPLORER, label: { ko: '파일 탐색기' } },
    {
      say: {
        ko: '1. 왼쪽 칸은 **파일 탐색기**야.||지금 옵시디언이 열고 있는 폴더 안의 폴더와 노트가 여기 목록으로 다 나와. 노트를 열 때도 여기서 이름을 클릭하면 돼.',
      },
    },
    { do: 'unpoint' },
    { do: 'point', anchor: ICON_STRIP, label: { ko: '아이콘 줄' } },
    {
      say: {
        ko: '2. 화면 맨 왼쪽 끝에 작은 아이콘이 세로로 늘어서 있지? 테두리로 감싼 곳이야.||자주 쓰는 기능을 바로 여는 버튼들이야. 아이콘에 마우스를 올리면 이름이 떠. 나중에 여기서 "그래프 뷰"라는 화면을 열 거야.',
      },
    },
    { do: 'unpoint' },
    { do: 'point', anchor: MAIN_AREA },
    {
      say: {
        ko: '3. 가운데 넓은 곳은 노트를 열어서 읽고 쓰는 화면이야.||노트를 여러 개 열면 위쪽에 탭으로 쌓여. 웹 브라우저 탭이랑 똑같아.',
      },
    },
    { do: 'unpoint' },
    {
      say: {
        ko: '하나만 더. 옵시디언이 열고 있는 이 폴더 전체를 **볼트(vault)**라고 불러. 한국어 화면에선 "보관함"이라고 나와.||볼트가 정확히 뭔지는 A2 에서 직접 확인해 볼 거야.',
      },
    },
    { say: { ko: '이제 연습할 폴더를 만들자.||볼트 안에 폴더를 하나 새로 만들고, 수업에서 하는 건 전부 그 안에서만 해. 네가 원래 갖고 있던 노트는 건드리지 않아.' } },
    {
      say: { ko: '"{root}" 라는 폴더를 만들어도 될까?' },
      choices: [{ ko: '응, 만들어' }, { ko: '잠깐만' }],
      as: 'okFolder',
    },
    {
      if: 'okFolder',
      eq: 1,
      then: [{ say: { ko: '알았어. 준비되면 맨 왼쪽 아이콘 줄에서 고양이 아이콘을 눌러 줘. 거기서부터 이어서 할게.' } }, { stop: true }],
      else: [],
    },
    { write: { op: 'folder', path: 'practice:' }, preview: false },
    {
      waitFor: 'folderExists',
      args: { path: 'practice:' },
      hint: { say: { ko: '파일 탐색기에 폴더가 안 보이면 목록을 위아래로 스크롤해 봐. 폴더는 이름 순서대로 놓여 있어.' } },
    },
    { do: 'point', anchor: 'folder:practice:', label: { ko: '연습 폴더' } },
    { say: { ko: '파일 탐색기에 "{root}" 폴더가 생겼지?||앞으로 수업에서 만드는 노트는 전부 이 폴더 안에 들어가.' } },
    { say: { ko: '폴더 이름 왼쪽의 작은 화살표를 클릭하면 폴더가 펼쳐지고, 한 번 더 클릭하면 접혀.||지금은 비어 있어서 펼쳐도 아무것도 없을 거야.' } },
    { do: 'unpoint' },
    { done: true },
  ],
};

const A1 = {
  id: 'A1',
  course: 'A',
  minutes: 7,
  title: { ko: '왜 기록해 둬야 할까' },
  intro: {
    ko: '이번 시간엔 기록해 두지 않으면 어떤 일이 생기는지 내 얘기 다섯 개로 보고, 1분 동안 세 줄을 직접 기록해 볼 거야. 궁금한 건 중간에 물어봐도 돼.',
  },
  steps: [
    { say: { ko: '본격적으로 하기 전에 내 얘기 좀 들어 줘. 짧은 거 다섯 개야. 1번부터 차례로 할게.' } },
    { do: 'act', motion: 'tbookmarkdig' },
    { say: { ko: '1. 분명히 저장해 둔 글이 있었는데 못 찾겠어.||북마크, 스크린샷, 나한테 보낸 메시지까지 다 뒤졌는데 없더라.' } },
    {
      card: {
        title: { ko: '1. 저장했는데 못 찾는다' },
        body: {
          ko: '지식관리 앱 사용자를 조사한 연구를 보면, 사람들은 저장하는 데는 시간을 꽤 쓰는데 나중에 **다시 찾아보는 일**은 잘 안 된다고 답했어.\n\n저장만 하고 다시 보지 않은 건 결국 잊혀.',
        },
        buttons: [{ ko: '다음' }],
      },
    },
    { do: 'act', motion: 'tbookpile' },
    { say: { ko: '2. 읽을 책을 잔뜩 사 놓고 뿌듯했어.||근데 사실 한 권도 안 읽었어.' } },
    {
      card: {
        title: { ko: '2. 모은다고 아는 건 아니다' },
        body: {
          ko: '"이런 게 있다는 걸 안다"와 "내용을 안다"는 달라.\n\n저장 버튼 누르기가 너무 쉬워서, 저장만 해도 뭔가 한 기분이 들어. 이걸 **수집가의 오류**라고 해.',
        },
        buttons: [{ ko: '다음' }],
      },
    },
    { do: 'act', motion: 'tfadethought' },
    { say: { ko: '3. 어제 들은 얘기가 오늘 벌써 가물가물해.' } },
    {
      card: {
        title: { ko: '3. 금방 잊힌다' },
        body: {
          ko: '사람은 새로 들은 걸 처음 몇 시간 사이에 가장 많이 잊어버려. 이걸 **망각 곡선**이라고 해.\n\n그래서 그날 기록해 두지 않으면 남는 게 거의 없어.',
        },
        buttons: [{ ko: '다음' }],
      },
    },
    { do: 'act', motion: 'tfoldering' },
    { say: { ko: '4. 그래서 정리를 잘해 보려고 폴더랑 태그를 잔뜩 만들었어.||일주일 만에 지쳐서 그만뒀어.' } },
    {
      card: {
        title: { ko: '4. 정리하다 지친다' },
        body: {
          ko: '메모 정리가 오래 못 가는 건 대부분 **관리하는 일** 때문이야.\n\n새 글이 들어올 때마다 어디에 넣을지 고르고, 관련 있는 글끼리 이어 주고, 오래된 내용을 고치는 일. 이걸 사람이 다 하려고 하면 금방 지쳐.',
        },
        buttons: [{ ko: '다음' }],
      },
    },
    { do: 'act', motion: 'tsparkle' },
    { say: { ko: '5. 그 관리를 AI 한테 맡기면 된다는 걸 알았어.||사용자는 글을 넣고 읽기만 하고, 분류하고 잇고 요약하는 건 AI 가 하는 거야.' } },
    {
      card: {
        title: { ko: '5. LLM Wiki 가 뭐냐면' },
        body: {
          ko: 'AI 가 관리해 주는 개인 위키를 **LLM Wiki** 라고 해. LLM 은 ChatGPT 나 클로드 같은 AI 를 가리키는 말이야. 2026년 4월에 AI 연구자 **안드레 카파시(Andrej Karpathy)**가 이 방법을 글로 소개하면서 널리 알려졌어.\n\n여기서 중요한 건 AI 가 얼마나 똑똑하냐가 아니라 **AI 가 읽을 거리가 있느냐**야. 사용자가 평소에 어떤 식으로 일하는지, 어떤 일을 왜 그렇게 정했는지, 지금 어떤 상황인지. 이런 **사용자의 일과 맥락에 대한 기록**이 있어야 AI 가 사용자에게 맞는 답을 줄 수 있어.\n\n똑같은 질문에도 AI 답이 뻔하게 느껴질 때가 있지? 대개 AI 가 사용자에 대해 읽을 기록이 없어서 그래.',
        },
        figure: { kind: 'roles', labels: { ko: ['사용자', '글을 넣고, 읽는다', 'AI', '분류 · 연결 · 요약'] } },
        buttons: [{ ko: '알았어' }],
      },
    },
    {
      say: {
        ko: '여기서 말 하나를 정해 두자. AI 가 읽고 정리할 원래 글, 그러니까 사용자의 일과 맥락을 기록해 둔 글을 앞으로 **재료**라고 부를게.||재료는 B 코스에서 만들 **raw 폴더**에 모아 둘 거야. 그래서 앞으로 "재료"라고 하면 **raw 폴더 속 파일**을 말하는 거야.||직접 쓴 메모든 회의 기록이든 저장해 둔 기사든, AI 한테 넘겨줄 글이면 다 재료(raw 폴더 속 파일)가 될 수 있어.',
      },
    },
    {
      faq: {
        title: { ko: '궁금한 거 있어?' },
        intro: { ko: '궁금한 걸 누르면 답해 줄게. 다 봤으면 "넘어가기".' },
        items: [
          {
            q: { ko: '그냥 메모 앱이랑 뭐가 달라?' },
            a: {
              ko: '메모 앱은 기록하는 것도 사용자가, 정리하는 것도 사용자가 해. 그래서 쌓일수록 찾기가 어려워져.\n\nLLM Wiki 에선 사용자는 재료(raw 폴더 속 파일)만 넣고, 요약하고 서로 잇고 목차를 고치는 건 AI 가 해. 그래서 쌓일수록 오히려 찾기 쉬워져.',
            },
          },
          {
            q: { ko: 'AI 가 글을 읽어도 안전해?' },
            a: {
              ko: '네가 고른 AI 에게, 네가 고른 폴더만 보여 주는 거야. 이 플러그인은 네 글을 어디로도 보내지 않아.\n\n그래도 고객 개인정보, 비밀번호, 민감한 금액 같은 건 처음부터 재료(raw 폴더 속 파일)로 넣지 마. 꼭 필요하면 "A사 담당자"처럼 바꿔서 적으면 돼.',
            },
          },
          {
            q: { ko: '매일 세 줄이면 정말 돼?' },
            a: {
              ko: '응. 오늘 한 일, 알게 된 것, 그 밖의 메모. 형식도 맞춤법도 신경 안 써도 돼.\n\n며칠 빼먹어도 괜찮아. 출석 체크가 아니라 나중에 꺼내 쓸 재료(raw 폴더 속 파일)를 모으는 거니까. 제일 쓸모 있는 건 "이건 다음에 조심해야겠다" 같은 한 줄이야.',
            },
          },
        ],
      },
    },
    { say: { ko: '그럼 지금 재료가 될 글을 하나 만들어 보자. 1분이면 돼.' } },
    { write: { op: 'note', path: NOTE_TODAY, content: { ko: '- \n' }, open: true }, preview: false },
    {
      say: {
        ko: '방금 연습 폴더 안에 "오늘 알게 된 것"이라는 노트를 만들어서 가운데 화면에 열어 뒀어.||왼쪽 파일 탐색기에서 연습 폴더를 펼쳐 보면 이 노트가 있을 거야.',
      },
    },
    { do: 'mood', mood: 'wait' },
    { do: 'prop', key: 'hourglass', on: true },
    {
      say: {
        ko: '여기에 오늘 알게 된 거나 느낀 걸 세 줄만 기록해 봐. 아무거나 괜찮아.||가운데 노트를 한 번 클릭하면 글자를 쓸 수 있어. 첫 줄 앞의 점(•)은 목록 표시야. 한 줄 쓰고 Enter 를 누르면 다음 줄에도 점이 생겨.||맞춤법이나 문장은 신경 쓰지 마. 단어만 적어도 돼.',
      },
    },
    {
      waitFor: 'linesWritten',
      args: { path: NOTE_TODAY, min: 3 },
      hint: { anchor: 'editor', say: { ko: '가운데 노트를 클릭하고 한 줄에 하나씩 적으면 돼. 세 줄이 되면 내가 알아챌게.' } },
      fallback: {
        write: {
          op: 'append',
          path: NOTE_TODAY,
          content: { ko: '- 위키 정리는 AI 한테 맡기면 된다\n- 저장만 하면 잊는다\n- 매일 세 줄이면 된다\n' },
        },
        preview: false,
      },
    },
    { do: 'prop', key: 'hourglass', on: false },
    { do: 'mood', mood: 'idle' },
    { do: 'fx', fx: { type: 'confetti' } },
    {
      say: {
        ko: '됐다! 하루에 할 일은 이게 다야.||참, 저장 버튼은 따로 없어. 옵시디언은 쓰는 대로 바로 저장돼.||방금 쓴 세 줄을 나중에 raw 폴더에 넣으면, 그게 AI 가 읽을 재료(raw 폴더 속 파일)야.',
      },
      kind: 'cheer',
    },
    {
      quiz: {
        q: { ko: '사용자가 매일 할 일은?' },
        choices: [{ ko: '편하게 세 줄 기록하기' }, { ko: '폴더와 태그 정리하기' }],
        answer: 0,
        fb: { ko: '맞아. 정리는 AI 가 할 일이야.' },
        wrong: { ko: '그건 4번 얘기에서 일주일 만에 지친 방법이야. 다시 골라 봐.' },
      },
    },
    { done: true },
  ],
};

const A2 = {
  id: 'A2',
  course: 'A',
  minutes: 5,
  title: { ko: '옵시디언 노트는 그냥 파일이다' },
  intro: {
    ko: '이번 시간엔 옵시디언이 어떤 앱인지 알아보고, 아까 쓴 노트가 네 컴퓨터에 진짜 파일로 저장돼 있는지 윈도우 폴더 창에서 직접 확인해 볼 거야.',
  },
  steps: [
    { say: { ko: '옵시디언이 어떤 앱인지부터 말해 줄게.||옵시디언은 컴퓨터에 있는 폴더 하나를 열어서, 그 안의 글 파일을 보기 좋게 보여 주고 고칠 수 있게 해 주는 앱이야.' } },
    {
      card: {
        title: { ko: '볼트와 노트' },
        body: {
          ko: '**볼트(vault)**: 옵시디언이 여는 폴더 하나. 한국어 화면에선 "보관함"이라고 나와. 왼쪽 파일 탐색기에 보이는 건 전부 이 볼트 안에 있는 거야.\n\n**노트**: 볼트 안의 글 파일 하나. 파일 이름 끝에 `.md` 가 붙어. md 는 마크다운이라는 글 형식인데, 다음 레슨에서 배울 거야.\n\n회원가입이나 서버가 필요 없어. 파일이 사용자 컴퓨터에 있으니까 옵시디언을 지워도 노트는 그대로 남아.',
        },
        buttons: [{ ko: '정말?' }],
      },
    },
    { say: { ko: '직접 확인해 보자. 아까 쓴 "오늘 알게 된 것" 노트를 윈도우 폴더 창에서 열어 볼게.' } },
    { do: 'point', anchor: NOTE_TODAY_ROW, label: { ko: '오늘 알게 된 것' } },
    {
      say: {
        ko: '혼자 할 땐 이렇게 해. 파일 탐색기에서 노트 이름 위에 마우스를 두고 **오른쪽 버튼**을 누르면 메뉴가 떠.||거기서 **"폴더에서 보기"**를 고르면 돼. 맥에선 "Finder에서 보기"라고 나와.||이번엔 내가 대신 열어 줄게.',
      },
    },
    { do: 'unpoint' },
    { showInFolder: NOTE_TODAY },
    { do: 'mood', mood: 'wait' },
    {
      say: {
        ko: '윈도우 폴더 창이 하나 떴지? 그 안에 "오늘 알게 된 것.md" 파일이 있을 거야.||그 파일이 방금 네가 옵시디언에서 쓴 노트야. 확인했으면 옵시디언으로 돌아와서 눌러 줘.',
      },
      choices: [{ ko: '봤어' }, { ko: '창이 안 떴어' }],
      as: 'sawFile',
    },
    {
      if: 'sawFile',
      eq: 1,
      then: [{ say: { ko: '폴더 창이 옵시디언 뒤에 가려져 있을 수도 있어. 화면 아래 작업 표시줄을 한번 봐 줘.||그래도 없으면 나중에 노트 이름을 오른쪽 클릭해서 "폴더에서 보기"로 직접 열어 봐.' } }],
      else: [{ say: { ko: '맞아. 옵시디언은 이 파일을 열어서 보여 주고 있었던 거야.||폴더 창은 이제 닫아도 돼.' } }],
    },
    { do: 'mood', mood: 'idle' },
    { say: { ko: '이게 왜 중요하냐면,||노트가 평범한 파일이니까 **AI 도 이 파일을 직접 읽고 쓸 수 있어.** AI 가 관리하는 위키를 옵시디언에 만드는 이유가 이거야.' } },
    {
      quiz: {
        q: { ko: '옵시디언 노트 하나는 실제로 뭐야?' },
        choices: [{ ko: '컴퓨터 폴더 안의 파일 하나' }, { ko: '옵시디언 서버에 올라간 글' }],
        answer: 0,
        fb: { ko: '맞아. 그래서 사용자 것이고, AI 도 읽을 수 있어.' },
        wrong: { ko: '옵시디언엔 서버가 없어. 방금 윈도우 폴더 창에서 파일을 봤잖아. 다시 골라 봐.' },
      },
    },
    { done: true },
  ],
};

const A3 = {
  id: 'A3',
  course: 'A',
  minutes: 5,
  title: { ko: '마크다운 기호 세 개' },
  intro: {
    ko: '이번 시간엔 노트에 쓰는 마크다운 기호 세 개를 직접 쳐 보고, AI 가 왜 이 형식을 잘 읽는지 알아볼 거야.',
  },
  steps: [
    {
      say: {
        ko: '옵시디언 노트는 **마크다운**이라는 방식으로 써.||글 앞뒤에 기호 몇 개를 붙여서 "여긴 제목", "여긴 목록" 하고 표시하는 방식이야. 아까 본 `.md` 가 마크다운 파일이라는 뜻이야.',
      },
    },
    {
      say: { ko: '처음엔 기호 세 개만 알면 돼. 이렇게 생겼어.' },
      figure: { kind: 'markdown', labels: { ko: ['안녕', '할 일', '안녕', '다른 노트'] } },
    },
    { write: { op: 'note', path: NOTE_PAD, open: true }, preview: false },
    { say: { ko: '연습하라고 "연습장"이라는 노트를 만들어서 가운데에 열어 뒀어. 여기에 쳐 보자.' } },
    { do: 'mood', mood: 'wait' },
    {
      say: {
        ko: '1. 첫 번째는 **제목**이야.||줄 맨 앞에 `#` 을 치고 한 칸 띄운 다음 글을 쓰면 제목이 돼. `#` 은 Shift 를 누른 채 숫자 3 을 누르면 나와.||예를 들면 `# 오늘`. 치고 나면 글자가 크게 바뀌는 게 보일 거야. 아무 제목이나 하나 써 봐.',
      },
    },
    {
      waitFor: 'fileHasText',
      args: { path: NOTE_PAD, pattern: '^#+ \\S' },
      hint: { anchor: 'editor', say: { ko: '연습장 노트를 클릭하고 맨 앞에 `# 오늘` 처럼 쳐 봐. # 다음에 한 칸 띄우는 걸 잊지 마.' } },
      fallback: { write: { op: 'append', path: NOTE_PAD, content: { ko: '# 오늘\n' } }, preview: false },
    },
    { say: { ko: '잘했어. 커서를 그 줄에 두면 `#` 이 보이고, 다른 줄로 옮기면 숨어.||기호는 그대로 있고, 옵시디언이 보기 좋게 감춰 줄 뿐이야.' } },
    {
      say: {
        ko: '2. 두 번째는 **목록**이야.||Enter 로 새 줄을 만들고, 맨 앞에 `-` (빼기 기호)를 친 다음 한 칸 띄우고 글을 써. 예: `- 할 일`.||A1 에서 본 그 점(•)이 바로 이거야. 한 줄 써 봐.',
      },
    },
    {
      waitFor: 'fileHasText',
      args: { path: NOTE_PAD, pattern: '^- \\S' },
      hint: { anchor: 'editor', say: { ko: '새 줄 맨 앞에 `- 할 일` 처럼 쳐 봐. 빼기 기호 다음에 한 칸.' } },
      fallback: { write: { op: 'append', path: NOTE_PAD, content: { ko: '- 세 줄 적기\n' } }, preview: false },
    },
    {
      say: {
        ko: '3. 세 번째는 **굵게**야.||강조하고 싶은 단어 앞뒤를 별표 두 개로 감싸면 돼. 별표(*)는 Shift 를 누른 채 숫자 8. 예: `**중요**`.||아무 단어나 감싸 봐.',
      },
    },
    {
      waitFor: 'fileHasText',
      args: { path: NOTE_PAD, pattern: '\\*\\*[^*\\n]+\\*\\*' },
      hint: { anchor: 'editor', say: { ko: '`**중요**` 처럼 단어 앞뒤에 별표를 두 개씩 붙이면 돼.' } },
      fallback: { write: { op: 'append', path: NOTE_PAD, content: { ko: '**중요**\n' } }, preview: false },
    },
    { do: 'mood', mood: 'idle' },
    { do: 'fx', fx: { type: 'confetti' } },
    {
      card: {
        title: { ko: '왜 마크다운일까' },
        body: {
          ko: '워드나 한글 같은 프로그램은 "여긴 제목"이라는 걸 글자 크기나 색으로 표시해. 그런 꾸밈은 파일 안에 복잡한 형태로 저장돼서 AI 가 읽기 어려워.\n\n마크다운은 `#`, `-`, `**` 같은 기호가 **글자 그대로** 파일에 들어 있어. 그래서 AI 가 어디가 제목이고 어디가 목록인지 바로 알아.\n\n기호를 몰라도 괜찮아. 그냥 줄글로 적어도 AI 가 알아서 형식을 맞춰 줘.',
        },
        figure: { kind: 'markdown', labels: { ko: ['제목', '목록', '굵게', '링크'] } },
        buttons: [{ ko: '알았어' }],
      },
    },
    {
      quiz: {
        q: { ko: '제목을 만들려면?' },
        choices: [{ ko: '줄 맨 앞에 # 을 치고 한 칸 띄운다' }, { ko: '글자 크기를 키운다' }],
        answer: 0,
        fb: { ko: '맞아. 기호를 글자로 적는 거야.' },
        wrong: { ko: '글자 크기는 파일에 글자로 남지 않아서 AI 가 못 읽어. 다시 골라 봐.' },
      },
    },
    { done: true },
  ],
};

const A4 = {
  id: 'A4',
  course: 'A',
  minutes: 6,
  title: { ko: '노트를 링크로 잇기' },
  intro: {
    ko: '이번 시간엔 노트 두 개를 링크로 이어 보고, 노트들이 어떻게 이어져 있는지 한눈에 보여 주는 그래프 뷰를 열어 볼 거야.',
  },
  steps: [
    {
      say: {
        ko: '노트는 하나하나 따로 있는 파일이지만, 서로 이어 줄 수 있어.||노트 안에 다른 노트 이름을 대괄호 두 겹으로 감싸서 `[[노트 이름]]` 이라고 쓰면, 그 노트로 가는 **링크**가 생겨.||노트와 노트를 잇는 고리라서, 앞으로 링크를 **연결고리**라고도 부를게.',
      },
      figure: { kind: 'links', labels: { ko: ['고양이', '츄르', '[[츄르]] 라고 쓰면 연결고리가 생긴다'] } },
    },
    {
      writes: [
        { op: 'note', path: NOTE_A, content: { ko: '고양이는 츄르를 좋아한다.\n' } },
        { op: 'note', path: NOTE_B, content: { ko: '고양이가 좋아하는 간식.\n' } },
      ],
      preview: false,
    },
    { open: NOTE_A },
    { say: { ko: '연습 폴더에 "고양이" 노트와 "츄르" 노트를 만들고, "고양이" 노트를 열어 뒀어.||고양이 노트에 츄르 얘기가 나오지? 그러니까 두 노트를 이어 보자.' } },
    { do: 'mood', mood: 'wait' },
    {
      say: {
        ko: '고양이 노트 아래에 새 줄을 만들고 `[[츄르]]` 라고 써 봐.||대괄호 `[` 는 키보드에서 P 오른쪽에 있어. 두 번 누르면 노트 목록이 뜨는데, 거기서 "츄르"를 클릭해도 되고 이름을 끝까지 쳐도 돼.',
      },
    },
    {
      waitFor: 'linkBetween',
      args: { from: NOTE_A, to: NOTE_B },
      hint: { anchor: 'editor', say: { ko: '고양이 노트 아래쪽에 `[[츄르]]`. 이름을 대괄호 두 개로 감싸면 돼.' } },
      fallback: { write: { op: 'append', path: NOTE_A, content: { ko: '관련: [[츄르]]\n' } }, preview: false },
    },
    { do: 'mood', mood: 'idle' },
    { say: { ko: '연결됐다! `[[츄르]]` 가 색이 다른 글자로 바뀌었지?||그 글자를 클릭하면 츄르 노트가 열려. 지금은 안 눌러도 돼.' } },
    { say: { ko: '이렇게 이어진 노트들을 그림 한 장으로 보여 주는 화면이 있어. **그래프 뷰**야.||노트 하나가 점 하나, 링크 하나가 선 하나로 그려져.' } },
    { say: { ko: '그래프 뷰는 맨 왼쪽 세로 아이콘 줄에서 열어. 어떤 아이콘인지 가리켜 줄게.' } },
    {
      command: 'graph:open',
      ms: 1200,
      via: GRAPH_RIBBON,
      viaLabel: { ko: '그래프 뷰' },
      viaSay: { ko: '이 아이콘이야. 동그라미 몇 개가 선으로 이어진 모양이지? 마우스를 올리면 "그래프 뷰 열기"라고 떠.||이번엔 내가 눌러 줄게.' },
    },
    {
      waitFor: 'graphOpened',
      args: {},
      hint: { anchor: GRAPH_RIBBON, say: { ko: '맨 왼쪽 아이콘 줄에서 동그라미들이 선으로 이어진 아이콘을 눌러 봐.' } },
      fallback: { command: 'graph:open' },
    },
    { do: 'point', anchor: 'graph' },
    {
      say: {
        ko: '가운데에 그래프 뷰가 새 탭으로 열렸어.||"고양이"랑 "츄르" 점 사이에 선이 보이지? 방금 만든 링크야. 점이 작아서 이름이 안 보이면 마우스 휠을 굴려서 확대해 봐.||다른 점들은 볼트에 있는 다른 노트들이야. 어디에도 이어지지 않은 노트는 점만 혼자 떠 있어.',
      },
    },
    { say: { ko: '지금은 네가 직접 이었지만, 위키를 만들면 이 링크를 AI 가 대신 걸어 줘.||노트가 쌓일수록 이 그림에 선이 점점 많아질 거야.||그래프 뷰는 다 봤으면 위쪽 탭의 X 를 눌러 닫으면 돼.' } },
    { do: 'unpoint' },
    {
      quiz: {
        q: { ko: '노트 두 개를 이으려면?' },
        choices: [{ ko: '[[이을 노트 이름]] 을 쓴다' }, { ko: '두 노트를 같은 폴더에 넣는다' }],
        answer: 0,
        fb: { ko: '맞아. 링크로 잇는 거야.' },
        wrong: { ko: '같은 폴더에 있어도 서로 이어지진 않아. 그래프 뷰에 선이 생기는 건 [[ ]] 링크뿐이야. 다시 골라 봐.' },
      },
    },
    { done: true },
  ],
};

const A5 = {
  id: 'A5',
  course: 'A',
  minutes: 4,
  title: { ko: '왜 옵시디언에 만들까' },
  intro: {
    ko: '기초 코스 마지막 시간이야. AI 위키를 왜 하필 옵시디언에 만드는지 정리하고, 다음 코스에서 만들 폴더 구조를 미리 볼 거야.',
  },
  steps: [
    { say: { ko: '기초는 여기까지야. 지금까지 배운 걸로, AI 위키를 왜 옵시디언에 만드는지 정리해 보자.' } },
    {
      card: {
        title: { ko: '이유 세 가지' },
        body: {
          ko: '1. **노트가 전부 평범한 파일**이라 AI 가 직접 읽고 쓸 수 있어. (A2)\n2. **링크와 그래프 뷰**가 있어서 AI 가 이어 준 연결을 눈으로 확인할 수 있어. (A4)\n3. **파일이 사용자 컴퓨터에 있어서** 어떤 폴더를 AI 에게 보여 줄지 사용자가 정해. 옵시디언이 AI 에 접속하는 게 아니라, 사용자가 허락한 폴더를 **AI 가 읽으러 오는 거야.**',
        },
        buttons: [{ ko: '알았어' }],
      },
    },
    { say: { ko: '다음 코스(B)에선 연습 폴더 안에 위키 구조를 만들어. 어떻게 생겼는지 먼저 보여 줄게.' } },
    { do: 'goto', anchor: 'folder:practice:' },
    { do: 'act', motion: 'tchalk', ms: 3200 },
    {
      say: {
        ko: '연습 폴더 안에 이렇게 세 가지를 만들 거야.||1. raw 폴더: 사용자가 AI 에게 줄 글을 넣는 곳. A1 에서 정한 재료(raw 폴더 속 파일)가 여기 들어가.||2. wiki 폴더: AI 가 재료(raw 폴더 속 파일)를 정리한 노트가 쌓이는 곳.||3. AGENTS.md: AI 에게 어떻게 정리하라고 알려 주는 규칙 파일.||자세한 건 다음 시간에 하나씩 만들면서 볼게.',
      },
      figure: { kind: 'rooms', labels: { ko: ['사용자가 재료를 넣는 곳', 'AI 가 정리한 노트', 'AI 에게 주는 규칙', '다음 코스에서 만든다'] } },
    },
    {
      quiz: {
        q: { ko: '옵시디언과 AI 는 어떻게 연결될까?' },
        choices: [{ ko: '사용자가 허락한 폴더를 AI 가 읽으러 온다' }, { ko: '옵시디언이 AI 에 접속한다' }],
        answer: 0,
        fb: { ko: '맞아. 어느 폴더를 보여 줄지는 사용자가 정해.' },
        wrong: { ko: '옵시디언은 폴더를 열어 보여 주는 앱일 뿐이고, AI 와 따로 연결돼 있지 않아. 다시 골라 봐.' },
      },
    },
    { done: true },
  ],
};

module.exports = { A0, A1, A2, A3, A4, A5, COURSE_A: [A0, A1, A2, A3, A4, A5], GRAPH_RIBBON };
