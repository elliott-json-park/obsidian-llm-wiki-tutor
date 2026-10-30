// 수업용 모션. Vault Pet 의 motions.js 와 같은 꼴이다:
//  len / loop               : 한 바퀴 길이(초), 반복 여부
//  pose(p, k, at, r)        : 자세. p.prop ('laptop') · p.armL/armR ('rest' 'up' 'wave' 'front' 'hold' 'type' 'typefast')
//                             · p.eyes (open blink closed happy half dot wide squint sparkle) · p.mouth (smile open flat o big none)
//                             · p.ear(-1·0·1) · p.tail (idle up slow flick) · p.dy · p.xf {sx sy ox rot} · p.lookX/lookY · p.sweat · p.blush
//  back/mid/front(g, a, k, at, c) : 소품을 도트로 그린다. this = 렌더러 (this.pattern(rows, x, y, c) · this.px(x, y, color)).
//                             a = 기준점 (hx 머리 가운데 열 · top 정수리 줄 · my 입 줄 · left/right 머리 양끝 · neck · ground)
//                             c = 색 표 (K 외곽선, W 흰색, Y 노랑, B 파랑, T 갈색 … sprite.js 의 PAL)
//  step(r, k, at, dt, a)    : 효과 (r.emit). 좌표는 화면 기준이라 뒤집힐 때 r.scr(x) 로
// 걸으면서 유지하는 자세(물고 가기 · 가리키기 · 돋보기 · 모래시계)는 pet.js 가 sprite.setToyPose(키) 로 걸어 둔다.
(function (root) {
  const { rand, GROUND } = root.PetSprite.util;
  const once = (r, tag, cond) => {
    if (cond && !r.ms[tag]) {
      r.ms[tag] = true;
      return true;
    }
    return false;
  };
  const every = (r, tag, at, period) => {
    const n = Math.floor(at / period);
    if (r.ms[tag] !== n) {
      r.ms[tag] = n;
      return true;
    }
    return false;
  };
  const txt = (r, s, x, y, c, life = 0.9, vy = -3) => r.emit({ type: 'text', s, x, y, vy, life, c });
  const CONFETTI = ['#ff6f91', '#ffd35c', '#6fb0ea', '#78c46a', '#b784f5', '#ff9a3c'];
  // 노트북 앞 타자 자세
  const desk = (p, fast) => {
    p.prop = 'laptop';
    p.armL = p.armR = fast ? 'typefast' : 'type';
    p.dy = -3;
    p.mouth = 'flat';
  };

  // ---------- 소품 도트 ----------
  // 종이 한 장 (세로) · 책 (옆에서 본 등) · 폴더 · 돋보기 · 모래시계 · 메모 · 가방 · 사각모 · 분필
  const PAPER = ['KKKKK', 'KWWWK', 'KWgWK', 'KWWWK', 'KWgWK', 'KWWWK', 'KKKKK'];
  const BOOKS = [
    ['KKKKKKKKKK', 'KRRRRRRRRK', 'KKKKKKKKKK'],
    ['KKKKKKKKKK', 'KBBBBBBBBK', 'KBBBBBBBBK', 'KKKKKKKKKK'],
    ['KKKKKKKKKK', 'KNNNNNNNNK', 'KKKKKKKKKK'],
    ['KKKKKKKKKK', 'KYYYYYYYYK', 'KYYYYYYYYK', 'KKKKKKKKKK'],
    ['KKKKKKKKKK', 'KVVVVVVVVK', 'KKKKKKKKKK'],
    ['KKKKKKKKKK', 'KOOOOOOOOK', 'KOOOOOOOOK', 'KKKKKKKKKK'],
  ];
  const FOLDER = ['KKK.....', 'KYYKKKKK', 'KYYYYYYK', 'KYYYYYYK', 'KKKKKKKK'];
  const TAB = ['KK', 'KK', 'KK']; // 책갈피 끈
  const GLASS = ['..KKK..', '.KUUUK.', 'KUUWUUK', 'KUUUUUK', '.KUUUK.', '..KKK..', '...KT..', '....KT.', '.....KT'];
  const HOURGLASS = ['KKKKKKK', '.KYYYK.', '.KYYYK.', '..KYK..', '...K...', '..K.K..', '.K...K.', 'KKKKKKK'];
  const NOTE = ['KKKKKKK', 'KYYYYYK', 'KYgYgYK', 'KYYYYYK', 'KYgYgYK', 'KYYYYYK', 'KKKKKKK'];
  const BAG = ['..KKK..', '.K...K.', 'KKKKKKK', 'KTTTTTK', 'KTtTTTK', 'KTTTTTK', 'KKKKKKK'];
  // 사각모: 윗판(16칸)은 머리보다 조금 넓게, 띠는 머리 폭 안에
  const CAP = ['...KKKKKKKKKK...', 'KKKDDDDDDDDDDKKK', 'KDDDDDDDDDDDDDDK', 'KKKKKDDDDDDKKKKK', '....KDDDDDDK....', '....KKKKKKKK....'];
  const BULB = ['..KKK..', '.KYYYK.', 'KYYWYYK', 'KYYYYYK', '.KYYYK.', '..KgK..', '..KKK..'];
  const CLOUD = ['..KKKKKKKK..', '.K........K.', 'K..........K', 'K..........K', '.K........K.', '..KKKKKKKK..'];
  const CHALK = ['KWK', 'KWK', 'KwK'];

  // 종이 더미: x 자리에 n 장이 비스듬히
  function papers(self, x, y, n, c) {
    for (let i = 0; i < n; i++) self.pattern(PAPER, x + i * 3 - (i % 2), y - (i % 3), c);
  }

  const M = {
    // ---------- 1단계에서 만든 것 ----------
    ttype: {
      len: 1,
      loop: true,
      pose(p, k, at) {
        desk(p, true);
        p.eyes = Math.floor(at * 2) % 5 === 4 ? 'half' : 'open';
        p.lookY = 1;
      },
    },
    tpoint: {
      len: 1.2,
      loop: true,
      pose(p, k) {
        p.armR = 'up';
        p.lookY = -1;
        p.eyes = 'open';
        p.mouth = 'open';
        p.ear = 1;
        p.tail = 'up';
        p.dy = k < 0.25 ? -Math.round(Math.sin((k / 0.25) * Math.PI) * 3) : 0;
      },
    },
    tcarry: {
      len: 0.8,
      loop: true,
      pose(p) {
        p.mouth = 'flat';
        p.eyes = 'open';
        p.ear = 1;
        p.tail = 'up';
      },
    },
    twait: {
      len: 2.4,
      loop: true,
      pose(p, k) {
        p.mouth = 'smile';
        p.tail = k < 0.5 ? 'slow' : 'idle';
      },
    },
    ttilt: {
      len: 1.6,
      pose(p, k) {
        p.xf = { rot: (k < 0.2 ? k / 0.2 : k > 0.8 ? (1 - k) / 0.2 : 1) * 0.18 };
        p.ear = -1;
        p.eyes = 'open';
        p.mouth = 'o';
        p.lookX = 1;
      },
      step(r, k, at, dt, a) {
        if (once(r, 'q', k > 0.3)) txt(r, '?', r.scr(a.hx + 9), a.top - 5, '#fff', 0.9, -3);
      },
    },
    tcheer: {
      len: 1.6,
      pose(p, k) {
        const j = (k * 2) % 1;
        p.dy = -Math.sin(j * Math.PI) * 7;
        if (j > 0.88) {
          p.sy = 0.86;
          p.sx = 1.12;
        }
        p.eyes = 'happy';
        p.mouth = 'open';
        p.armL = p.armR = 'up';
        p.ear = 1;
        p.tail = 'up';
      },
      step(r, k, at, dt, a) {
        if (once(r, 'c', k < 0.1)) for (let i = 0; i < 16; i++) r.emit({ type: 'confetti', x: 24 + rand(-14, 14), y: a.top - 2, vx: rand(-14, 14), vy: rand(-22, -8), ay: 30, life: 1.4, c: CONFETTI[i % CONFETTI.length] });
      },
    },

    // ---------- A1 다섯 장면 ----------
    // ① 저장했는데 없다 — 북마크·종이 더미를 뒤지다 "?" (3.2초)
    tbookmarkdig: {
      len: 3.2,
      pose(p, k, at) {
        p.lookY = 1;
        p.armR = Math.floor(at * 6) % 2 ? 'front' : 'rest';
        p.eyes = k < 0.7 ? 'open' : 'dot';
        p.mouth = k < 0.7 ? 'flat' : 'o';
        p.ear = k < 0.7 ? 0 : -1;
        p.tail = 'flick';
        p.sweat = k > 0.5;
      },
      back(g, a, k, at, c) {
        papers(this, a.left - 12, GROUND - 7, 4, c);
        papers(this, a.right + 2, GROUND - 7, 3, c);
        this.pattern(TAB, a.left - 6, GROUND - 10, { K: c.R });
        this.pattern(TAB, a.right + 9, GROUND - 9, { K: c.B });
      },
      step(r, k, at, dt, a) {
        if (k < 0.7 && every(r, 'd', at, 0.22)) r.emit({ type: 'dust', x: r.scr(a.hx + rand(-4, 10)), y: GROUND, vx: rand(-6, 6), vy: -3, life: 0.5 });
        if (every(r, 'f', at, 0.55) && k < 0.7) r.emit({ type: 'sprite', rows: ['WWW', 'www'], map: { W: '#fffaf3', w: '#d6cfc4' }, x: r.scr(a.hx + 8), y: GROUND - 8, vx: rand(4, 10) * r.facing, vy: -12, ay: 10, life: 1.1 });
        if (once(r, 'q', k > 0.72)) txt(r, '?', r.scr(a.hx + 9), a.top - 5, '#fff', 1, -3);
      },
    },
    // ② 모으는 게 아는 게 아니다 — 책이 양옆에 쌓이고 뿌듯 → 들켜서 식은땀 (3.6초)
    tbookpile: {
      len: 3.6,
      pose(p, k) {
        p.tail = 'up';
        if (k < 0.65) {
          p.eyes = 'happy';
          p.mouth = 'smile';
          p.ear = 1;
          p.blush = true;
        } else {
          p.eyes = 'dot';
          p.mouth = 'flat';
          p.ear = -1;
          p.sweat = true;
          p.lookX = -1;
        }
      },
      back(g, a, k, at, c) {
        const n = Math.min(6, 1 + Math.floor(k * 9));
        let y = GROUND;
        for (let i = 0; i < n; i++) {
          const b = BOOKS[i % BOOKS.length];
          y -= b.length - 1;
          this.pattern(b, a.left - 13 + (i % 2), y, c);
        }
        let y2 = GROUND;
        for (let i = 0; i < Math.max(0, n - 2); i++) {
          const b = BOOKS[(i + 3) % BOOKS.length];
          y2 -= b.length - 1;
          this.pattern(b, a.right + 3 - (i % 2), y2, c);
        }
      },
      step(r, k, at, dt, a) {
        if (k < 0.65 && every(r, 's', at, 0.5)) r.emit({ type: 'spark', x: r.scr(a.hx + rand(-10, 10)), y: a.top + rand(-4, 6), life: 0.5 });
        if (once(r, 'x', k > 0.7)) txt(r, '...', r.scr(a.hx + 8), a.top - 4, '#fff', 1.2, -2);
      },
    },
    // ③ 하루면 반이 사라진다 — 머리 위 생각 풍선 속 전구가 흐려지다 사라진다 (3.4초)
    tfadethought: {
      len: 3.4,
      pose(p, k) {
        p.lookY = -1;
        p.eyes = k < 0.35 ? 'open' : k < 0.7 ? 'half' : 'dot';
        p.mouth = k < 0.7 ? 'smile' : 'flat';
        p.ear = k < 0.7 ? 1 : -1;
        p.tail = k < 0.7 ? 'idle' : 'slow';
      },
      front(g, a, k, at, c) {
        // 흐려짐: 전구는 k 에 따라 도트를 띄엄띄엄 빼고, 풍선은 마지막에 작아진다
        const x = a.hx + 2;
        const y = a.top - 15;
        if (k < 0.9) {
          this.pattern(CLOUD, x - 2, y - 1, c);
          const keep = 1 - Math.max(0, (k - 0.2) / 0.65); // 1 → 0
          BULB.forEach((row, j) =>
            [...row].forEach((ch, i) => {
              if (ch === '.') return;
              const h = ((i * 7 + j * 13) % 11) / 11; // 고정된 흩뿌림
              if (h < keep) this.px(x + 1 + i, y + j, c[ch] || c.K);
            }),
          );
        }
        // 꼬리 점 두 개
        if (k < 0.95) {
          this.px(a.hx + 3, a.top - 7, c.K);
          this.px(a.hx + 4, a.top - 9, c.K);
        }
      },
    },
    // ④ 정리하다 포기한다 — 폴더가 양옆에 쌓이는데 식은땀 타자 → 뻗음 (3.8초)
    tfoldering: {
      len: 3.8,
      pose(p, k, at) {
        if (k < 0.74) {
          desk(p, true);
          p.sweat = true;
          p.eyes = 'dot';
        } else {
          p.eyes = 'closed';
          p.mouth = 'flat';
          p.ear = -1;
          p.dy = 1;
          p.xf = { sy: 0.92, sx: 1.06 };
          p.tail = 'slow';
        }
      },
      back(g, a, k, at, c) {
        const n = 1 + Math.floor(Math.min(k, 0.74) * 8);
        for (let i = 0; i < n; i++) {
          const side = i % 2 ? 1 : -1;
          const h = Math.floor(i / 2);
          this.pattern(FOLDER, side < 0 ? a.left - 12 - h : a.right + 4 + h, GROUND - 4 - h * 4, c);
        }
      },
      step(r, k, at, dt, a) {
        if (once(r, 'z', k > 0.78)) txt(r, 'UGH', r.scr(a.hx + 7), a.top - 5, '#fff', 1.2, -2);
      },
    },
    // ⑤ 그래서 지금 이게 유행 — 눈 반짝, 폴짝, 별 (2.6초)
    tsparkle: {
      len: 2.6,
      pose(p, k) {
        p.eyes = 'sparkle';
        p.mouth = k < 0.5 ? 'o' : 'open';
        p.ear = 1;
        p.tail = 'up';
        p.dy = k > 0.5 ? -Math.sin(((k - 0.5) / 0.5) * Math.PI) * 5 : 0;
        if (k > 0.5) p.armL = p.armR = 'up';
      },
      step(r, k, at, dt, a) {
        if (every(r, 's', at, 0.25)) r.emit({ type: 'star', x: r.scr(a.hx + rand(-12, 12)), y: a.top + rand(-8, 4), vy: -4, life: 0.7 });
        if (once(r, 'b', k > 0.5)) txt(r, '!', r.scr(a.hx + 9), a.top - 6, '#fff', 0.9, -3);
      },
    },
    // A1 60초 도전 — 앉아서 사용자를 보고, 머리 옆에 모래시계가 흐른다 (걸어 둔 자세)
    thourglass: {
      len: 2,
      loop: true,
      pose(p, k) {
        p.lookY = -1;
        p.eyes = 'open';
        p.mouth = 'smile';
        p.ear = 1;
        p.tail = k < 0.5 ? 'idle' : 'flick';
      },
      front(g, a, k, at, c) {
        const x = a.right + 3;
        const y = a.top - 4;
        this.pattern(HOURGLASS, x, y, c);
        // 아래 칸에 모래가 쌓인다 (k 에 따라)
        const fill = Math.floor(k * 3);
        for (let i = 0; i < fill; i++) this.px(x + 3 + (i === 2 ? -1 : i), y + 6, c.Y);
        if (k > 0.2) this.px(x + 3, y + 4, c.Y);
      },
    },

    // ---------- B5 · B6 · B7 ----------
    // 저장: 카드를 접어 옆 가방에 넣는다 (2.4초)
    tbagin: {
      len: 2.4,
      pose(p, k) {
        p.armR = k < 0.7 ? 'front' : 'rest';
        p.lookY = 1;
        p.eyes = k > 0.8 ? 'happy' : 'open';
        p.mouth = k > 0.8 ? 'smile' : 'flat';
        p.tail = 'up';
      },
      front(g, a, k, at, c) {
        const bx = a.right + 4;
        this.pattern(BAG, bx, GROUND - 6, c);
        if (k < 0.8) {
          // 카드: 세로로 접히며(높이 줄며) 가방 쪽으로 내려간다
          const h = Math.max(2, Math.round(7 * (1 - Math.min(k, 0.4) / 0.4 * 0.6)));
          const t = Math.max(0, (k - 0.4) / 0.4);
          const x = Math.round(a.hx + 6 + (bx + 1 - (a.hx + 6)) * t);
          const y = Math.round(a.my - 2 + (GROUND - 4 - (a.my - 2)) * t);
          const rows = ['KKKKK', ...Array(Math.max(0, h - 2)).fill('KWWWK'), 'KKKKK'];
          this.pattern(rows, x, y, c);
        }
      },
      step(r, k, at, dt, a) {
        if (once(r, 'p', k > 0.82)) r.emit({ type: 'spark', x: r.scr(a.right + 7), y: GROUND - 8, life: 0.5 });
      },
    },
    // 돋보기로 바닥을 훑는다 (걸어 둔 자세, 1.6초 한 바퀴)
    tmagnify: {
      len: 1.6,
      loop: true,
      pose(p, k) {
        p.lookY = 1;
        p.lookX = Math.sin(k * Math.PI * 2) > 0 ? 1 : -1;
        p.armR = 'front';
        p.eyes = 'squint';
        p.mouth = 'flat';
        p.ear = 1;
        p.tail = 'flick';
      },
      front(g, a, k, at, c) {
        const sway = Math.round(Math.sin(k * Math.PI * 2) * 5);
        this.pattern(GLASS, a.hx + 2 + sway, a.my + 2, c);
      },
    },
    // 모순 비교: 양손에 종이 두 장을 번갈아 본다 (2.6초)
    tcompare: {
      len: 2.6,
      pose(p, k) {
        p.armL = p.armR = 'up';
        p.lookX = Math.floor(k * 4) % 2 ? 1 : -1;
        p.eyes = k > 0.75 ? 'wide' : 'squint';
        p.mouth = k > 0.75 ? 'o' : 'flat';
        p.ear = k > 0.75 ? 1 : 0;
      },
      front(g, a, k, at, c) {
        this.pattern(PAPER, a.left - 7, a.top - 2, c);
        this.pattern(PAPER, a.right + 3, a.top - 2, c);
      },
      step(r, k, at, dt, a) {
        if (once(r, 'x', k > 0.78)) txt(r, '!', r.scr(a.hx + 9), a.top - 6, '#fff', 0.9, -3);
      },
    },
    // 냉장고 메모: 메모를 들고 위로 붙인다 (2.6초)
    tsticknote: {
      len: 2.6,
      pose(p, k) {
        p.armR = k < 0.75 ? 'up' : 'front';
        p.lookY = -1;
        p.eyes = 'open';
        p.mouth = k > 0.75 ? 'smile' : 'flat';
        p.ear = 1;
        p.tail = 'up';
        p.dy = k > 0.3 && k < 0.75 ? -2 : 0;
      },
      front(g, a, k, at, c) {
        // 손에서 (머리 오른쪽 위) 벽 자리로 (더 위)
        const t = Math.min(1, Math.max(0, (k - 0.3) / 0.45));
        const x = a.right + 1;
        const y = Math.round(a.top - 4 - 7 * t);
        this.pattern(NOTE, x, y, c);
      },
      step(r, k, at, dt, a) {
        if (once(r, 'p', k > 0.76)) r.emit({ type: 'spark', x: r.scr(a.right + 4), y: a.top - 10, life: 0.5 });
      },
    },
    // 졸업: 사각모를 쓰고 폴짝 + 색종이 (2.2초)
    tgradcap: {
      len: 2.2,
      pose(p, k) {
        const j = (k * 2) % 1;
        p.dy = -Math.sin(j * Math.PI) * 6;
        p.eyes = 'happy';
        p.mouth = 'open';
        p.armL = p.armR = 'up';
        p.ear = 1;
        p.tail = 'up';
      },
      front(g, a, k, at, c) {
        this.pattern(CAP, a.hx - 8, a.top - 5, c);
        // 술 (윗판 오른쪽 끝에서 늘어진다)
        for (let j = 0; j < 4; j++) this.px(a.hx + 8, a.top - 3 + j, j === 3 ? c.y : c.Y);
      },
      step(r, k, at, dt, a) {
        if (once(r, 'c', k < 0.1)) for (let i = 0; i < 18; i++) r.emit({ type: 'confetti', x: 24 + rand(-16, 16), y: a.top - 4, vx: rand(-16, 16), vy: rand(-24, -8), ay: 30, life: 1.5, c: CONFETTI[i % CONFETTI.length] });
      },
    },
    // 분필: 바닥에 네모 둘을 그린다 (3초)
    tchalk: {
      len: 3,
      pose(p, k) {
        p.lookY = 1;
        p.lookX = k < 0.5 ? -1 : 1;
        p.armR = 'front';
        p.eyes = 'open';
        p.mouth = 'flat';
        p.tail = 'flick';
      },
      back(g, a, k, at, c) {
        // 왼쪽 네모(0~0.5) → 오른쪽 네모(0.5~1), 점선으로 조금씩
        const box = (x0, prog) => {
          const w = 11;
          const h = 5;
          const pts = [];
          for (let i = 0; i < w; i++) pts.push([x0 + i, GROUND - h]);
          for (let j = 1; j < h; j++) pts.push([x0 + w - 1, GROUND - h + j]);
          for (let i = w - 1; i >= 0; i--) pts.push([x0 + i, GROUND]);
          for (let j = h - 1; j > 0; j--) pts.push([x0, GROUND - h + j]);
          const n = Math.floor(pts.length * Math.min(1, prog));
          // 바탕이 밝은 테마가 많아서 흰 분필 대신 회색으로 (어두운 테마에서도 보인다)
          for (let i = 0; i < n; i++) if (i % 2 === 0) this.px(pts[i][0], pts[i][1], c.g);
        };
        box(a.left - 15, k / 0.5);
        box(a.right + 4, (k - 0.5) / 0.5);
      },
      front(g, a, k, at, c) {
        const side = k < 0.5 ? a.left - 4 : a.right + 2;
        this.pattern(CHALK, side, a.my + 2, c);
      },
    },
  };

  Object.assign(root.PetSprite.MOTIONS, M);
})(window);
