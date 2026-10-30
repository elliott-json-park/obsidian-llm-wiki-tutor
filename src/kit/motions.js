// 모션. sprite.js 의 PetRenderer.play(key) 로 틀거나, 기분마다 계속 반복하게 걸어 둔다.
//  len               : 한 바퀴 길이(초). loop 이면 반복해도 자연스럽게 이어지는 모션
//  pose(p, k, at, r)  : 자세를 정한다. k = 0~1 진행도, at = 시작 후 초
//  back/mid/front(g, a, k, at, c) : 몸 뒤·앞발 밑·맨 앞에 소품을 그린다 (a = 기준점, c = 색)
//  step(r, k, at, dt, a, p)       : 효과를 뿌린다 (화면 좌표. 방향이 뒤집히면 r.scr 로 뒤집는다)
// 어느 상황에 쓰는지·상점 가격은 main/shop.js 의 MOTION_SLOTS / MOTIONS, 이름은 i18n.js 의 'motion.<key>'.
(function (root) {
  const { rand, seg, bump, ease, GROUND } = root.PetSprite.util;
  // 조건이 처음 참이 될 때 한 번만
  const once = (r, tag, cond) => {
    if (cond && !r.ms[tag]) { r.ms[tag] = true; return true; }
    return false;
  };
  // period 초마다 한 번씩
  const every = (r, tag, at, period) => {
    const n = Math.floor(at / period);
    if (r.ms[tag] !== n) { r.ms[tag] = n; return true; }
    return false;
  };
  const CONFETTI = ['#ff6f91', '#ffd35c', '#6fb0ea', '#78c46a', '#b784f5', '#ff9a3c'];
  // 소품 도트
  const SHADES = ['kkkkkkkkkkk', '.kkkk.kkkk.', '.kHkk.kHkk.', '..kk...kk..']; // 선글라스
  const CIG = ['WWWWWo']; // 담배 (끝이 빨갛게 탄다)
  const BOTTLE = ['.KK.', '.KK.', 'KNNK', 'KNWK', 'KNNK', 'KNNK', '.KK.']; // 초록 소주병
  const SHOT = ['KUK', 'KUK', '.K.']; // 소주잔
  const PAD = ['.KKKKK.', 'KDDDDDK', 'KDRDBDK', 'KDDDDDK', 'KK...KK']; // 게임패드
  const FISH = ['.KKKK.K.', 'KkBBBKBK', '.KKKK.K.']; // 모자에서 튀어나오는 생선

  // ---------- 4차 (상황별) 에서 쓰는 것 ----------
  const txt = (r, s, x, y, c, life = 0.8, vy = -4) => r.emit({ type: 'text', s, x, y, vy, life, c });
  // 노트북 앞에 앉아 일하는 기본 자세 (기분 '일하는 중'과 같은 높이)
  const desk = (p, fast) => { p.prop = 'laptop'; p.armL = p.armR = fast ? 'typefast' : 'type'; p.dy = -3; p.mouth = 'flat'; };
  const CROWN = ['.K.K.K.', 'KYKYKYK', 'KYYYYYK', 'KYRYBYK', 'KKKKKKK']; // 대관식 왕관
  const POPPER = ['...KK', '..KYK', '.KYRK', 'KRYK.', 'KKK..']; // 파티 폭죽
  const MONITOR = ['KKKKKKKKK', 'KBBBBBBBK', 'KBWWBBBBK', 'KBBBWWWBK', 'KBBBBBBBK', 'KKKKKKKKK', '....K....', '..KKKKK..'];
  const FISHDREAM = ['..KKKK.K.', '.KOOOOKOK', 'KOHOOOOOK', '.KOOOOKOK', '..KKKK.K.']; // 상상 속 음식들
  const STEAK = ['.KKKKKK.', 'KrRRRRrK', 'KRRWRRRK', 'KrRRRRrK', '.KKKKKK.'];
  const CAKE = ['...Y...', '..KRK..', '.KWWWK.', 'KPPPPPK', 'KWWWWWK', 'KKKKKKK'];

  // ---------- 5차 (2026-09-22) 에서 쓰는 것 ----------
  const MUG = ['KtttK.', 'KWWWKK', 'KWCWKK', 'KWWWK.', '.KKK..'];
  const PHONE = ['KKKK', 'KUUK', 'KUUK', 'KUUK', 'KKKK'];
  const CONF = CONFETTI;

  // ---------- 7차 다듬기 (2026-09-24) 에서 쓰는 것 ----------
  // 고양이에만 색을 덧칠한다. 효과 목록 맨 앞에 끼워서, 먼저 떠 있던 글자·연기·번개는 물들이지 않는다
  const tintUnder = (r, c, a, mode) => {
    const n = r.fx.length;
    r.emit({ type: 'tint', c, a, mode, perFrame: true, fade: false });
    if (r.fx.length > n) r.fx.unshift(r.fx.pop());
  };
  // 번쩍! 캔버스 전체(투명한 바탕화면 위의 흰 네모)가 아니라 고양이만 하얗게 번쩍인다. s = 0(시작)~1(끝)
  const flashCat = (r, s) => { if (s >= 0 && s < 1) tintUnder(r, '#ffffff', 0.9 * (1 - s)); };
  // 가느다란 김 한 가닥 (얼굴을 덮는 뭉게구름 대신 점 몇 개가 하늘하늘 올라간다)
  const steam = (r, x, y, c = 'rgba(255,255,255,0.75)', vx = 0) => r.emit({ type: 'spray', x: x + rand(-0.6, 0.6), y, vx: vx + rand(-1.6, 1.6), vy: -5, life: 1, c });
  // 오프스크린(고양이 그림)에서 이미 칠해진 도트에만 색을 얹는다 — 얼굴만 빨개질 때 (back/mid/front 안에서 this 로 부른다)
  function tintArea(x, y, w, h, c) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    ctx.restore();
  }
  // 몸에서 뻗어 나온 앞다리 하나 (어깨 → 발끝). 2칸 굵기에 외곽선, 끝에 동그란 발. back/mid/front 안에서 this 로 부른다
  function limb(g, x0, y0, x1, y1) {
    const O = g.c.outline, B = g.c.body;
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0)));
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push([Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n)]);
    // 어깨쪽 두 점은 몸 안이라 외곽선을 긋지 않는다 (몸통 외곽선이 열리며 다리가 이어져 나온다)
    pts.forEach(([x, y], i) => { if (i >= 2) for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) this.px(x + dx, y + dy, O); });
    for (const [x, y] of pts) { this.px(x, y, B); this.px(x + 1, y, B); this.px(x, y + 1, B); this.px(x + 1, y + 1, B); }
    this.pattern(['.OO.', 'OBBO', 'OBBO', '.OO.'], Math.round(x1) - 1, Math.round(y1) - 1, { O, B });
  }
  root.PetSprite.motionFx = { tintUnder, flashCat, steam, tintArea, limb }; // 뒤쪽 묶음(세트 전용·6차)도 같이 쓴다

  // ---------- 디자인 개선 (2026-10-10) 에서 쓰는 것 ----------
  const INK = '#2b1a10';
  // 캔버스에 바로 찍는 그림 · 점 (이번 프레임에만)
  const spr = (r, rows, x, y, map) => r.emit({ type: 'sprite', rows, x: Math.round(x), y: Math.round(y), map, perFrame: true, fade: false });
  const dot = (r, x, y, c) => r.emit({ type: 'spray', x: Math.round(x), y: Math.round(y), c, perFrame: true, fade: false });
  const mirror = (rows) => rows.map((s) => s.split('').reverse().join(''));
  // 천천히 깜빡: 눈 감는 박자 (뜸 → 반쯤 → 꼬옥 → 반쯤 → 반짝) · 말풍선 속 큰 눈
  const blinkEyes = (k) => (k < 0.12 ? 'open' : k < 0.26 ? 'half' : k < 0.68 ? 'closed' : k < 0.8 ? 'half' : 'sparkle');
  const BIG_EYE = { open: ['.KK.', 'KWKK', 'KKKK', '.KK.'], half: ['....', 'KKKK', 'KWKK', '.KK.'], closed: ['....', '....', 'K..K', '.KK.'], sparkle: ['.KK.', 'KWKK', 'KKWK', '.KK.'] };
  // 털 윤기 반짝: 반짝이 (작게 → 크게 → 중간 → 사라짐, 0.4초)
  const TW = [
    ['.Y.', 'YHY', '.Y.'],
    ['..Y..', '..Y..', 'YYHYY', '..Y..', '..Y..'],
    ['...Y...', '...Y...', '..YHY..', 'YYHHHYY', '..YHY..', '...Y...', '...Y...'],
  ];
  const TWM = { Y: '#ffd35c', H: '#ffffff' };
  const twinkle = (r, x, y, age) => {
    if (age < 0 || age > 0.4) return;
    const rows = TW[age < 0.07 ? 0 : age < 0.24 ? 2 : age < 0.33 ? 1 : 0];
    spr(r, rows, x - (rows[0].length >> 1), y - (rows.length >> 1), TWM);
  };
  // 뜨개질: 털실 뭉치 (큰·중간·작은) · 대바늘 두 개 (X 자, L = 길이 반쯤) · 처지는 실 · 목도리 줄무늬
  const BALL = [
    ['..KKKKK..', '.KPPpPPK.', 'KPpPPPpPK', 'KPPPpPPPK', 'KpPPPPPpK', 'KPPpPPPPK', 'KPPPPpPPK', '.KPpPPPK.', '..KKKKK..'],
    ['.KKKKK.', 'KPpPPpK', 'KPPpPPK', 'KpPPPpK', 'KPPpPPK', 'KPpPPPK', '.KKKKK.'],
    ['.KKK.', 'KPpPK', 'KpPPK', 'KPPpK', '.KKK.'],
  ];
  const yarnBall = function (c, cx, by, size, roll) {
    const rows = roll ? mirror(BALL[size]) : BALL[size];
    this.pattern(rows, cx - (rows[0].length >> 1), by - rows.length + 1, c);
    return by - rows.length + 1;
  };
  const needles = function (cx, y, click, L = 4) {
    const needle = (x0, y0, x1, y1) => {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let i = 0; i <= n; i++) {
        const x = Math.round(x0 + ((x1 - x0) * i) / n), yy = Math.round(y0 + ((y1 - y0) * i) / n);
        this.px(x, yy, i >= n - 1 ? '#ffd65a' : '#dfe5ec');
        if (i < n - 1) this.px(x, yy + 1, '#8f95a0');
      }
    };
    if (click) { needle(cx + L, y + 5, cx - L, y + 1); needle(cx - L, y + 5, cx + L, y); }
    else { needle(cx - L, y + 5, cx + L, y + 1); needle(cx + L, y + 5, cx - L, y); }
  };
  const thread = function (x0, y0, x1, y1, sag = 3) {
    const n = Math.max(6, Math.round(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 1; i < n; i++) { const t = i / n; this.px(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * sag), '#ff9bb8', false); }
  };
  const SCARF_STRIPE = (c, i) => [c.P, c.P, c.W][i % 3];
  // 종이비행기 (큰·중간·작은). dir = 화면에서 날아가는 쪽 (1 오른쪽)
  const PLANE = ['K........', 'KWKK.....', 'KWWWKK...', 'KWWWWWKKK', 'KwwwKK...', 'KwwKK....', 'KKK......'];
  const PLANE_M = ['K....', 'KWKK.', 'KWWWK', 'KwKK.', 'KK...'];
  const PLANE_S = ['KK.', 'KwK'];
  const PM = { K: INK, W: '#ffffff', w: '#bcd0e6' };
  const planeAt = (r, rows, x, y, dir) => {
    // dir = 화면에서 날아가는 쪽 (1 오른쪽)
    const R = dir < 0 ? mirror(rows) : rows;
    spr(r, R, Math.round(x) - (R[0].length >> 1), Math.round(y) - (R.length >> 1), PM);
  };
  // 영혼 가출: 분신 높이 (0 = 몸, 1 = 꼭대기). 빠져나감 → 둥실 → 쏙 돌아옴
  const soulUp = (k) => (k < 0.14 ? 0 : k < 0.46 ? ease(seg(k, 0.14, 0.46)) : k < 0.78 ? 1 : 1 - ease(seg(k, 0.78, 0.84)));
  const soulPose = (p, k) => {
    if (k < 0.14) { p.eyes = 'half'; p.mouth = 'o'; return; }
    if (k < 0.84) { p.eyes = 'dot'; p.mouth = 'o'; p.ear = -1; p.tail = 'slow'; p.xf = { sy: 0.88, sx: 1.06 }; p.dy = 1; return; }
    p.eyes = 'wide'; p.mouth = 'o'; p.ear = 1; p.dy = k < 0.88 ? -2 : 0;
  };
  // 뿡: 초록 연기 색 · 로켓 높이
  const GREEN = '#8fae4a', GREEN_L = '#c4dc7a';
  const rocketH = (k) => (k < 0.3 || k > 0.6 ? 0 : k < 0.42 ? 11 * (1 - (1 - seg(k, 0.3, 0.42)) ** 2) : 11 * (1 - seg(k, 0.42, 0.6) ** 2));

  const M = {
    stretch: {
      // 기지개 — 앞발을 쭉 내밀며 상체를 낮추고(엉덩이·꼬리는 번쩍) 쩌억 하품, 이번엔 몸을 위로 쭉 늘인 뒤
      // 부르르 털고 개운한 얼굴 (7차: 납작하게 눌리기만 하던 걸 앞으로 → 위로 두 번 늘이는 기지개로)
      len: 3.8,
      pose(p, k, at) {
        const lo = ease(bump(k, 0.06, 0.48)); // 앞으로 쭉 (상체를 낮춘다)
        const hi = ease(bump(k, 0.46, 0.68)); // 위로 쭉
        p.xf = { sx: 1 + 0.2 * lo - 0.06 * hi, sy: 1 - 0.14 * lo + 0.1 * hi };
        if (lo > 0.2) {
          p.armL = p.armR = 'front'; p.tail = 'up'; p.ear = -1; p.lookY = 1;
          p.eyes = lo > 0.75 ? 'closed' : 'squint';
          if (lo > 0.8) p.mouth = 'big'; // 쩌억 하품
          else if (lo > 0.5) p.mouth = 'o';
        }
        if (hi > 0.2) { p.eyes = 'closed'; p.mouth = 'flat'; p.tail = 'up'; p.ear = -1; p.lookY = -1; }
        if (k > 0.7 && k < 0.84) {
          // 부르르 — 머리부터 꼬리까지 털고 귀가 파닥
          const d = 1 - seg(k, 0.7, 0.84);
          p.xf = { ox: Math.round(Math.sin(at * 50) * 1.4 * d) };
          p.eyes = 'closed'; p.ear = Math.floor(at * 16) % 2 ? 1 : -1; p.tail = 'flick';
        }
        if (k >= 0.84) { p.eyes = 'happy'; p.mouth = 'smile'; p.tail = 'wag'; }
      },
      step(r, k, at, dt, a) {
        if (once(r, 'y', k > 0.3)) txt(r, 'YAWN', r.scr(a.hx + 5), a.top - 6, '#fff', 0.9, -3);
        if (once(r, 's', k > 0.86)) r.emit({ type: 'spark', x: r.scr(a.hx + 8), y: a.top - 2, life: 0.6 });
      },
    },
    loaf: {
      // 식빵 굽기 — 앞발을 몸 밑에 넣고 식빵 자세. 등에서 김이 모락모락(구워지는 중)
      len: 4, loop: true,
      pose(p, k, at) {
        p.curl = true;
        p.eyes = Math.floor(at * 0.7) % 2 ? 'half' : 'happy';
        // 바닥에서 뜨지 않고 등만 부풀었다 가라앉는다 (빵이 부푸는 것처럼)
        p.sy = Math.sin(at * 1.6) > 0.3 ? 1.02 : 1;
        p.tail = 'slow';
      },
      step(r, k, at, dt, a) {
        // 갓 구운 빵 김: 등 위에서 가느다랗게 모락모락
        if (every(r, 'steam', at, 0.22)) steam(r, r.scr(a.hx + [-3, 0, 3][Math.floor(at / 0.22) % 3]), a.top - 1, 'rgba(255,255,255,0.8)');
      },
    },
    nodoff: {
      // 꾸벅꾸벅 — 조는 중… 고개가 스르르 떨어지다가 화들짝!
      len: 4.2, loop: true,
      pose(p, k) {
        if (k < 0.6) {
          const s = seg(k, 0, 0.6);
          // 고개가 스르르 — 시선이 먼저 떨어지고, 몸이 조금씩 가라앉는다
          const e = ease(s);
          p.eyes = s < 0.3 ? 'half' : 'closed';
          p.lookY = s > 0.35 ? 1 : 0;
          p.dy = s > 0.55 ? 1 : 0;
          p.xf = { sy: 1 - e * 0.08, sx: 1 + e * 0.03 };
          p.ear = s > 0.2 ? -1 : 0;
          p.mouth = 'flat';
          p.tail = 'slow';
        } else if (k < 0.7) { p.dy = k < 0.64 ? -2 : -1; p.eyes = 'wide'; p.ear = 1; p.mouth = 'o'; p.tail = 'up'; }
        else { p.eyes = k < 0.8 ? 'open' : 'half'; p.mouth = 'flat'; p.lookX = k < 0.8 ? (k < 0.75 ? -1 : 1) : 0; p.tail = 'slow'; }
      },
      step(r, k, at, dt, a) {
        if (k < 0.55 && every(r, 'z', at, 1.1)) r.emit({ type: 'text', s: 'Z', x: r.scr(a.hx + 6), y: a.top - 6, vy: -4, vx: 2, life: 1.2, c: '#9aa6ff' });
        if (once(r, 'jolt', k > 0.6)) r.emit({ type: 'text', s: '!', x: r.scr(a.hx + 6), y: a.top - 8, vy: -4, life: 0.8, c: '#ffd35c' });
      },
    },
    lick: {
      // 발 핥고 세수 — 앞발을 날름날름 핥은 다음 그 발로 얼굴을 쓱쓱
      len: 3.4, loop: true,
      pose(p, k, at, r) {
        if (k < 0.55) { p.armR = 'lick'; p.mouth = Math.floor(at * 8) % 2 ? 'lick' : 'smile'; p.eyes = 'closed'; }
        else { p.armR = 'groom'; p.eyes = Math.floor(at * 2) % 2 ? 'happy' : 'closed'; p.mouth = 'flat'; }
        p.tail = 'slow';
      },
    },
    bath: {
      // 거품 목욕 — 욕조에 몸 담그고 머리엔 거품, 옆엔 고무 오리
      len: 4.4, loop: true,
      pose(p) { p.dy = 3; p.eyes = 'happy'; p.blush = true; p.noTail = true; },
      back(g, a) {
        for (let x = a.hx - 11; x <= a.hx + 11; x++) this.px(x, 41, x === a.hx - 11 || x === a.hx + 11 ? g.c.outline : '#e8f2fa');
      },
      front(g, a, k, at, c) {
        const L = a.hx - 11;
        this.pattern(
          ['KKKKKKKKKKKKKKKKKKKKKKK', 'KWWWWWWWWWWWWWWWWWWWWWK', 'KWWWWWWWWWWWWWWWWWWWWWK', 'KBBBBBBBBBBBBBBBBBBBBBK', 'KWWWWWWWWWWWWWWWWWWWWWK', '.KKKKKKKKKKKKKKKKKKKKK.', '..KK...............KK..'],
          L, 42, c,
        );
        [[-9, 41], [-7, 40], [-4, 41], [5, 41], [8, 40]].forEach(([dx, y]) => this.ellipse(a.hx + dx, y, 1.3, 1.1, '#fff', '#cfe3f2'));
        this.ellipse(a.hx, a.top - 1, 2.6, 1.4, '#fff', '#cfe3f2');
        this.ellipse(a.hx - 2, a.top - 2, 1.4, 1.2, '#fff', '#cfe3f2');
        const bob = Math.round(Math.sin(at * 3));
        this.pattern(['.KK..', 'KYYK.', 'KYYYOK'.slice(0, 5), '.KKK.'], a.hx + 7, 38 + bob, c);
      },
      step(r, k, at, dt, a) {
        if (every(r, 'bb', at, 0.4)) r.emit({ type: 'bubble', x: r.scr(a.hx + rand(-9, 9)), y: 40, vy: -8, r: rand(0.8, 1.6), life: 1.3 });
      },
    },

    zoomies: {
      // 우다다 — 갑자기 미친 듯이 왔다 갔다. 먼지 폴폴, 귀는 뒤로 착
      len: 2.6,
      pose(p, k, at, r) {
        const pass = Math.min(2, Math.floor(k * 3));
        const ph = k * 3 - pass;
        const dir = pass % 2 === 0 ? 1 : -1;
        r.setFacing(k > 0.98 ? 1 : dir);
        p.xf = { ox: dir > 0 ? -14 + ph * 28 : 14 - ph * 28 };
        if (k > 0.98) p.xf.ox = 0;
        p.step = (at * 5) % 1;
        p.eyes = 'wide';
        p.mouth = 'o';
        p.ear = -1;
        p.tail = 'up';
        p.dy = Math.floor(at * 10) % 2 ? -1 : 0;
      },
      step(r, k, at, dt, a, p) {
        const ox = p.xf ? p.xf.ox || 0 : 0;
        if (every(r, 'dust', at, 0.07)) r.emit({ type: 'dust', x: 24 + ox - r.facing * 8, y: GROUND, vx: -r.facing * 6, vy: -3, life: 0.5 });
        if (every(r, 'ln', at, 0.09)) r.emit({ type: 'line', x: 24 + ox - r.facing * 11 - (r.facing > 0 ? 4 : 0), y: 34 + Math.floor(rand(0, 8)), len: 4, life: 0.22 });
      },
    },
    box: {
      // 박스 들어가기 — 상자만 보면 일단 들어간다. 눈만 빼꼼
      len: 4, reveal: 0.4, loop: true,
      pose(p, k, at) {
        if (k < 0.12) { p.eyes = 'wide'; p.ear = 1; }
        else if (k < 0.3) {
          const s = seg(k, 0.12, 0.3);
          p.dy = Math.round(-7 * Math.sin(s * Math.PI) + s * 3);
          p.eyes = 'wide';
          p.armL = p.armR = 'up';
        } else { p.dy = 3; p.eyes = Math.floor(at * 0.8) % 3 === 0 ? 'happy' : 'open'; p.ear = 1; p.noTail = true; }
      },
      back(g, a, k, at, c) {
        for (let y = 40; y <= 42; y++) for (let x = a.hx - 8; x <= a.hx + 8; x++) this.px(x, y, x === a.hx - 8 || x === a.hx + 8 ? c.K : c.t);
        this.pattern(['KKKK...', '.KTTKK.', '..KKTTK'], a.hx - 11, 39, c);
        this.pattern(['...KKKK', '.KKTTK.', 'KTTKK..'], a.hx + 5, 39, c);
      },
      front(g, a, k, at, c) {
        this.pattern(['KKKKKKKKKKKKKKKKK', 'KTTTTTTYYTTTTTTTK', 'KTTTTTTYYTTTTTTTK', 'KTTtTTTTTTTTTtTTK', 'KKKKKKKKKKKKKKKKK'], a.hx - 8, 42, c);
      },
    },
    coffee: {
      // 커피 한 잔 — 두 발로 머그를 쥐고 호로록… 하아, 볼이 발그레
      len: 4.4, loop: true,
      pose(p, k, at, r) {
        p.armL = p.armR = 'hold';
        if (k < 0.4) p.eyes = r.blinkAt(at) ? 'blink' : 'open';
        else if (k < 0.66) { p.eyes = 'closed'; p.mouth = 'none'; }
        else { p.eyes = 'happy'; p.blush = true; }
      },
      mid(g, a, k, at, c) {
        const lift = k >= 0.4 && k < 0.66 ? -3 : 0;
        this.pattern(['KtttK.', 'KWWWKK', 'KWCWKK', 'KWWWK.', '.KKK..'], a.hx - 2, a.my + 1 + lift, c);
      },
      step(r, k, at, dt, a) {
        // 김은 잔에서 가늘게. 마시는 동안(잔이 입에 붙어 있을 때)은 쉰다 — 얼굴을 덮지 않게
        const sip = k >= 0.4 && k < 0.66;
        if (!sip && every(r, 'st', at, 0.16)) steam(r, r.scr(a.hx + 3), a.my + 1, undefined, r.facing * 5); // 볼 옆으로 비껴 올라간다
        if (once(r, 'ha', k > 0.68)) r.emit({ type: 'puff', x: r.scr(a.fx + 5), y: a.my, vx: r.facing * 8, vy: -2, life: 0.9, c: 'rgba(255,255,255,0.7)' });
      },
    },
    cafe: {
      // 커피 한 잔의 여유 — 작은 카페 탁자에 앉아 김 오르는 잔을 들고 호로록… 후우 한숨 쉬고
      // 잔을 내려놓은 뒤 등을 기대 눈을 감는다. 머리 위로 낙엽이 팔랑
      len: 8, loop: true,
      pose(p, k, at, r) {
        p.tail = 'slow';
        if (k < 0.14) {
          p.lookX = 1;
          p.eyes = r.blinkAt(at) ? 'blink' : 'open';
        } else if (k < 0.5) {
          p.armL = p.armR = 'hold';
          const sip = k > 0.2 && k < 0.36;
          p.eyes = sip ? 'closed' : k < 0.2 ? 'half' : 'happy';
          p.mouth = sip ? 'none' : k > 0.36 && k < 0.44 ? 'o' : 'smile';
          p.blush = k >= 0.36;
        } else if (k < 0.58) {
          p.lookX = 1;
          p.eyes = 'happy';
          p.blush = true;
        } else {
          p.xf = { rot: -0.07 * r.facing, py: 44 };
          p.eyes = Math.floor(at * 0.6) % 3 === 0 ? 'half' : 'closed';
          p.blush = true;
          p.ear = -1;
        }
      },
      back(g, a, k, at, c) {
        // 대리석 윗판에 나무 다리 하나짜리 카페 탁자
        const x = a.hx + 9;
        this.pattern(
          ['.KKKKKKKKK.', 'KWWWWWWWwwK', '.KKKKKKKKK.', '....KTK....', '....KTK....', '....KTK....', '....KtK....', '....KtK....', '..KKKtKKK..', '.KtttttttK.'],
          x, 35, c,
        );
        // 탁자 위 크루아상
        this.pattern(['.KKK.', 'KOoOK', '.KKK.'], x + 6, 32, c);
        // 잔을 들고 있지 않을 때는 받침 위에 놓여 있다
        if (k < 0.14 || k >= 0.5) {
          this.pattern(['KtttK.', 'KWWWKK', 'KWCWKK', 'KWWWK.'], x + 1, 30, c);
          this.pattern(['KwwwwwK'], x, 34, c);
        } else this.pattern(['KwwwwwK'], x, 34, c);
      },
      mid(g, a, k, at, c) {
        if (k < 0.14 || k >= 0.5) return;
        const lift = k > 0.2 && k < 0.36 ? -3 : 0;
        this.pattern(['KtttK.', 'KWWWKK', 'KWCWKK', 'KWWWK.', '.KKK..'], a.hx - 2, a.my + 1 + lift, c);
      },
      step(r, k, at, dt, a) {
        const held = k >= 0.14 && k < 0.5;
        const sip = k > 0.2 && k < 0.36;
        // 김은 가늘게. 들고 있을 땐 볼 옆으로 비껴 오르고, 마시는 동안은 쉰다
        if (!sip && every(r, 'st', at, 0.18)) steam(r, r.scr(held ? a.hx + 3 : a.hx + 12), held ? a.my + 1 : 29, undefined, held ? r.facing * 5 : 0);
        // 후우 — 한숨과 함께 작은 하트
        if (once(r, 'sigh', k > 0.37)) {
          r.emit({ type: 'puff', x: r.scr(a.fx + 5), y: a.my - 1, vx: r.facing * 9, vy: -3, life: 1.3, c: 'rgba(255,255,255,0.9)' });
          r.emit({ type: 'heart', x: r.scr(a.fx + 7), y: a.my - 5, vx: r.facing * 5, vy: -7, life: 1.4 });
        }
        if (k > 0.58 && every(r, 'n', at, 1.4)) r.emit({ type: 'note', x: r.scr(a.hx - 10), y: a.top - 2, vy: -4, vx: -2, life: 1.4, c: '#c48b56' });
        if (every(r, 'leaf', at, 1.7)) r.emit({ type: 'confetti', x: r.scr(a.hx + rand(-14, 16)), y: 2, vx: rand(-5, -1), vy: 7, life: 4.5, c: rand(0, 1) < 0.5 ? '#e8923c' : '#d9a21f' });
      },
    },
    monitors: {
      // 모니터 세 대 — 뒤에 모니터 세 대를 띄워 놓고 왼쪽·가운데·오른쪽을 번갈아 보며 타자. 화면마다 글이 올라간다
      len: 3.6, loop: true,
      pose(p, k) {
        desk(p);
        p.lookX = k < 0.33 ? -1 : k < 0.66 ? 0 : 1;
        p.lookY = k >= 0.33 && k < 0.66 ? -1 : 0;
      },
      back(g, a, k, at, c) {
        const scroll = Math.floor(at * 3) % 3;
        for (const [dx, y] of [[-20, 24], [-4, 18], [12, 24]]) {
          const rows = MONITOR.map((r, j) => (j >= 2 && j <= 4 ? MONITOR[2 + ((j - 2 + scroll) % 3)] : r));
          this.pattern(rows, a.hx + dx, y, c);
        }
      },
    },

    papers: {
      // 서류 산더미 — 양옆으로 서류가 점점 쌓여 산더미. 식은땀 흘리며 타자 치는데 맨 위 종이가 팔랑 날아간다
      len: 4.2, loop: true,
      pose(p) { desk(p, true); p.sweat = true; p.eyes = 'dot'; },
      back(g, a, k, at, c) {
        const n = 3 + Math.floor(k * 8);
        for (const [dx, m] of [[-17, 0], [10, 2]]) {
          const h = Math.max(2, n - m);
          for (let i = 0; i < h; i++) this.pattern([i % 2 ? 'KwwwwwK' : 'KWWWWWK'], a.hx + dx + (i % 4 === 1 ? 1 : 0), GROUND - i, c);
        }
      },
      step(r, k, at, dt, a) {
        if (every(r, 'p', at, 1.1)) r.emit({ type: 'sprite', rows: ['WWW', 'www'], map: { W: '#fffaf3', w: '#d6cfc4' }, x: r.scr(a.hx + 12), y: GROUND - 10, vx: rand(4, 12) * r.facing, vy: -10, ay: 8, life: 1.6 });
      },
    },

    aura: {
      // 초사이언 코딩 — 한계를 넘었다. 금빛 오라가 활활, 번개가 튀고, 눈에 불을 켠 채 신의 속도로 타자
      len: 2.6, loop: true,
      pose(p, k, at) { desk(p, true); p.eyes = 'wide'; p.brow = 'angry'; p.ear = 1; p.tail = 'up'; p.dy = -3 + (Math.floor(at * 16) % 2 ? -1 : 0); },
      back(g, a, k, at) {
        for (let x = a.hx - 11; x <= a.hx + 11; x++) {
          const h = Math.max(0, Math.round(26 - Math.abs(x - a.hx) * 1.6 + Math.sin(at * 16 + x * 2.1) * 2.5));
          for (let i = 0; i < h; i++) {
            const f = i / h;
            this.px(x, GROUND - i, f > 0.8 ? '#fffbd0' : f > 0.45 ? '#ffe45c' : '#ffc21a', false);
          }
        }
      },
      step(r, k, at, dt, a) {
        if (every(r, 's', at, 0.1)) r.emit({ type: 'spark', x: r.scr(a.hx + rand(-12, 12)), y: a.top + rand(-8, 10), life: 0.3, c: '#fff6a0' });
        if (every(r, 'b', at, 0.5)) r.emit({ type: 'vline', x: r.scr(a.hx + (Math.random() < 0.5 ? -13 : 13)), y: a.top + rand(0, 8), len: 5, life: 0.15, c: '#fff6a0' });
      },
    },

    tapfoot: {
      // 발 동동 시계 보기 — 머리 위 시계가 째깍째깍. 발을 동동 구르며 곁눈질, 꼬리는 탁탁
      // (7차: 몸 전체가 통통 튀던 걸, 몸은 가만히 있고 발만 톡톡 구르게)
      len: 3, loop: true,
      pose(p, k, at) {
        const b = at % 0.75;
        p.step = b < 0.1 || (b > 0.2 && b < 0.3) ? 0.25 : 0; // 톡-톡, 쉬고 (바깥 두 발을 들었다 내린다)
        p.mouth = 'flat'; p.tail = 'flick';
        if (k < 0.45) { p.eyes = 'side'; p.sideDir = 1; p.lookY = -1; } // 시계를 곁눈질
        else if (k < 0.58) { p.eyes = 'half'; p.mouth = 'wavy'; p.ear = -1; } // 하아…
        else p.brow = 'sad'; // 빨리 좀… (눈은 평소처럼 깜빡)
      },
      front(g, a, k, at, c) {
        const cx = a.hx + 9;
        const cy = a.top - 6;
        this.ellipse(cx, cy, 3.6, 3.6, '#fffaf3', c.K);
        // 초침이 째깍째깍 한 칸씩 뛴다 (0.5초마다 30도). 시침은 3시 방향
        const ang = Math.floor(at * 2) * (Math.PI / 6);
        this.px(cx, cy, c.K);
        this.px(cx + 1, cy, c.K);
        for (const d of [1, 2]) this.px(Math.round(cx + Math.sin(ang) * d), Math.round(cy - Math.cos(ang) * d), '#e8534a');
        this.px(cx, cy - 1, c.K);
        // 시계가 째깍할 때마다 살짝 들썩
        if (Math.floor(at * 2) % 2 === 0 && (at * 2) % 1 < 0.15) { this.px(cx - 4, cy - 3, c.K); this.px(cx + 4, cy - 3, c.K); }
      },
      step(r, k, at, dt, a) {
        // 발이 바닥에 닿을 때마다 먼지 톡
        const b = at % 0.75;
        const n = Math.floor(at / 0.75) * 2 + (b > 0.2 ? 1 : 0);
        if ((b >= 0.1 && b < 0.2) || b >= 0.3) if (once(r, 'd' + n, true)) for (const s of [-1, 1]) r.emit({ type: 'dust', x: r.scr(a.hx + s * 5), y: GROUND, vx: s * 4, life: 0.3 });
      },
    },

    blanket: {
      // 이불 덮고 쿨쿨 — 나무 침대에 베개 베고 알록달록 이불을 턱밑까지 덮고 새근새근. 숨 쉴 때마다 이불이 오르락내리락
      // (7차: 베개가 머리 양옆 날개처럼 보여서, 침대 머리판을 세우고 이불을 침대 폭만큼 넓혔다)
      len: 4, loop: true,
      pose(p, k, at) {
        p.eyes = 'closed'; p.mouth = 'flat'; p.ear = -1; p.dy = 1; p.noTail = true; p.clipY = 46; p.noShadow = true;
        if (k > 0.55 && k < 0.62) p.ear = 0; // 꿈결에 귀 한 번 씰룩
      },
      back(g, a, k, at, c) {
        // 침대 머리판: 둥근 윗변에 나뭇결, 양 끝에 기둥과 동그란 손잡이. 치즈색 털과 섞이지 않게 짙은 호두나무색
        const x0 = a.hx - 12, top = a.earTop - 3, W = 25;
        const WD = '#6b4428', wd = '#553520', wk = '#2b1a10';
        for (let y = top; y <= GROUND; y++) for (let x = x0; x < x0 + W; x++) {
          const i = x - x0, j = y - top;
          if (j === 0 && (i < 2 || i > W - 3)) continue;
          if (j === 1 && (i === 0 || i === W - 1)) continue;
          const edge = j === 0 || i === 0 || i === W - 1 || (j === 1 && (i === 1 || i === W - 2));
          this.px(x, y, edge ? wk : i % 5 === 2 ? wd : WD);
        }
        for (const x of [x0 - 1, x0 + W]) {
          for (let y = top - 1; y <= GROUND + 1; y++) this.px(x, y, y === top - 1 ? wk : wd);
          this.pattern(['KK', 'tt', 'KK'], x - (x < a.hx ? 1 : 0), top - 3, { K: wk, t: '#c48b56' });
        }
        // 베개 (머리판 폭에 가깝게 넓적하게)
        this.pattern(['.KKKKKKKKKKKKKKKKKKKKK.', 'KWWWWWWWWWWWWWWWWWWWWWK', 'KWWWWWWWWWWWWWWWWWWWWwK', 'KwwwwwwwwwwwwwwwwwwwwwK', '.KKKKKKKKKKKKKKKKKKKKK.'], a.hx - 11, a.ey - 2, c);
      },
      front(g, a, k, at, c) {
        // 숨 쉴 때마다 이불 윗단이 한 칸 오르락내리락 (들숨이 짧고 날숨이 길다)
        const b = Math.sin(at * 1.6) > 0.3 ? -1 : 0;
        const y0 = a.my + 2 + b;
        const W = 25;
        for (let y = y0; y <= GROUND + 2; y++) {
          const j = y - y0;
          let row = '';
          for (let i = 0; i < W; i++) {
            if (i === 0 || i === W - 1 || j === 0) row += 'K';
            else if (j === 1) row += i === W - 2 ? 'w' : 'W'; // 접어 내린 흰 홑청
            else row += (Math.floor(i / 2) + j) % 2 ? 'P' : 'Q'; // 체크무늬 이불
          }
          this.pattern([row], a.hx - 12, y, c);
        }
      },
      step(r, k, at, dt, a) {
        if (every(r, 'z', at, 1.3)) txt(r, 'Z', r.scr(a.hx + 8), a.top - 4, '#9aa6ff', 1.3);
      },
    },

    grumpy: {
      // 짜증 팍 — 귀를 뒤로 착 눕히고 털을 부풀린다. 이마에 빠직 마크, "HISS" 하고 앞발로 휙
      len: 2.4,
      pose(p, k, at) {
        p.ear = -1; p.brow = 'angry'; p.eyes = 'squint'; p.mouth = 'frown'; p.tail = 'flick';
        p.xf = { sx: 1.1, sy: 1.05, ox: k < 0.15 ? Math.sin(at * 50) : 0 };
        if (k > 0.5 && k < 0.65) { p.armR = 'out'; p.mouth = 'big'; }
      },
      step(r, k, at, dt, a) {
        const pulse = Math.floor(at * 5) % 2;
        r.emit({ type: 'sprite', rows: pulse ? ['.R.R.', 'RR.RR', '.....', 'RR.RR', '.R.R.'] : ['R...R', '.R.R.', '.....', '.R.R.', 'R...R'], map: { R: '#e8534a' }, x: r.scr(a.hx + 5) - 2, y: a.top - 4, perFrame: true, fade: false });
        if (once(r, 'h', k > 0.5)) { txt(r, 'HISS', r.scr(a.hx + 6), a.top - 9, '#ff9a9a', 0.8); r.emit({ type: 'line', x: r.scr(a.hx + 11), y: a.ey + 1, len: 5, life: 0.2 }); }
      },
    },


    startle: {
      // 화들짝 — 건드리자마자 털이 쭈뼛 서며 공중으로 펄쩍! 착지하고도 눈이 콩알만 해서 두리번
      len: 2.2,
      pose(p, k) {
        if (k < 0.1) { p.eyes = 'open'; return; }
        if (k < 0.45) {
          const s = seg(k, 0.1, 0.45);
          p.dy = Math.round(-11 * Math.sin(s * Math.PI));
          p.eyes = 'wide'; p.mouth = 'o'; p.ear = 1; p.armL = p.armR = 'up'; p.tail = 'up';
          p.xf = { sy: 1.15, sx: 0.92 };
          p.spiky = true;
        } else if (k < 0.55) { p.xf = { sx: 1.15, sy: 0.85 }; p.eyes = 'dot'; }
        else { p.eyes = 'dot'; p.lookX = k < 0.75 ? -1 : 1; p.sweat = true; p.mouth = 'flat'; }
      },
      front(g, a) {
        if (!this._p || !this._p.spiky) return;
        const O = g.c.outline;
        for (let y = a.top + 2; y < a.cy + 5; y += 3) { this.px(a.left - 2, y, O); this.px(a.left - 3, y - 1, O); this.px(a.right + 2, y, O); this.px(a.right + 3, y - 1, O); }
      },
      step(r, k, at, dt, a) {
        if (once(r, '!', k > 0.1)) { txt(r, '!!', r.scr(a.hx + 6), a.top - 12, '#ffd35c', 1); r.emit({ type: 'shock', x: r.scr(a.hx), y: a.cy, r: 8, life: 0.25 }); }
      },
    },

    melt: {
      // 녹아내리기 — 너무 좋아서 녹는다… 몸이 치즈처럼 바닥으로 주르륵 퍼졌다가, 뿅 하고 다시 모인다
      len: 3.4, reveal: 0.7,
      pose(p, k) {
        p.blush = true; p.eyes = 'happy'; p.mouth = 'wavy'; p.tail = 'slow';
        let s;
        if (k < 0.15) s = 0;
        else if (k < 0.55) s = ease(seg(k, 0.15, 0.55));
        else if (k < 0.8) s = 1;
        else { const q = seg(k, 0.8, 1); s = 1 - q; if (q > 0.6) { p.eyes = 'open'; p.mouth = 'smile'; } }
        p.xf = { sy: 1 - 0.55 * s, sx: 1 + 0.55 * s };
        if (s > 0.8) p.ear = -1;
      },
      step(r, k, at, dt, a) {
        if (k > 0.3 && k < 0.8 && every(r, 'd', at, 0.18)) r.emit({ type: 'drop', x: r.scr(24 + (Math.random() < 0.5 ? -12 : 12)), y: GROUND - 1, vy: 2, life: 0.6, c: '#f4a859' });
        if (every(r, 'h', at, 0.6)) r.emit({ type: 'heart', x: r.scr(24 + rand(-8, 8)), y: 30, vy: -5, life: 1 });
        if (once(r, 'b', k > 0.95)) txt(r, 'POP', r.scr(30), 20, '#fff', 0.5);
      },
    },

    popper: {
      // 폭죽 팡 — 파티 폭죽을 하늘로 겨누고… 팡! 색종이가 우르르 쏟아지고 만세 점프
      len: 2.6,
      pose(p, k) {
        if (k < 0.3) { p.armR = 'hold'; p.eyes = 'squint'; p.mouth = 'flat'; p.ear = -1; }
        else { const s = seg(k, 0.3, 0.7); p.dy = Math.round(-6 * Math.sin(s * Math.PI)); p.armL = p.armR = 'cheer'; p.eyes = 'happy'; p.mouth = 'open'; p.ear = 1; p.tail = 'up'; }
      },
      mid(g, a, k, at, c) { if (k < 0.45) this.pattern(POPPER, a.hx + 4, a.my - 3, c); },
      step(r, k, at, dt, a) {
        if (once(r, 'p', k > 0.3)) {
          txt(r, 'PANG!', r.scr(a.hx + 2), a.top - 12, '#ffd35c', 0.9);
          for (let i = 0; i < 40; i++) r.emit({ type: 'confetti', x: r.scr(a.hx + 7), y: a.top - 2, vx: rand(-30, 30), vy: rand(-40, -12), ay: 45, life: rand(1.2, 2), c: CONFETTI[i % 6] });
        }
      },
    },

    coronation: {
      // 대관식 — 하늘에서 왕관이 반짝이며 스르르 내려와 머리 위에 착. 나팔 소리에 맞춰 가슴을 쭉 편다
      len: 3.4, reveal: 0.52,
      pose(p, k) {
        if (k < 0.5) { p.lookY = -1; p.eyes = 'sparkle'; p.mouth = 'o'; p.ear = 1; }
        else { p.eyes = 'closed'; p.mouth = 'smile'; p.xf = { sy: 1.06 }; p.tail = 'up'; p.blush = true; }
      },
      front(g, a, k, at, c) {
        const y = k < 0.5 ? Math.round(-8 + (a.top - 4 + 8) * ease(seg(k, 0, 0.5))) : a.top - 4;
        this.pattern(CROWN, a.hx - 3, y, c);
      },
      step(r, k, at, dt, a) {
        if (k < 0.5 && every(r, 's', at, 0.08)) r.emit({ type: 'spark', x: r.scr(a.hx + rand(-4, 4)), y: Math.round(-8 + (a.top + 4) * seg(k, 0, 0.5)), vy: -4, life: 0.4 });
        if (once(r, 'f', k > 0.5)) for (let i = 0; i < 10; i++) r.emit({ type: 'star', x: r.scr(a.hx), y: a.top - 2, vx: rand(-18, 18), vy: rand(-18, -4), life: 0.8 });
        if (k > 0.5 && every(r, 'n', at, 0.3)) r.emit({ type: 'note', x: r.scr(a.hx + (Math.random() < 0.5 ? -14 : 12)), y: a.top + 2, vy: -8, life: 0.9, c: '#d9a21f' });
      },
    },

    levelbanner: {
      // LEVEL UP! 게임 화면 — 옛날 게임처럼 머리 위에 반짝이는 "LEVEL UP!" 글자, 동전이 분수처럼 솟고 고양이는 두 번 점프
      len: 3,
      pose(p, k) {
        const j = (k * 2) % 1;
        p.dy = Math.round(-6 * Math.sin(j * Math.PI));
        p.armL = p.armR = 'cheer'; p.eyes = 'star'; p.mouth = 'open'; p.ear = 1; p.tail = 'up';
      },
      step(r, k, at, dt, a) {
        const col = ['#ffd35c', '#ff6f91', '#6fb0ea', '#78c46a'][Math.floor(at * 8) % 4];
        r.emit({ type: 'text', s: 'LEVEL UP!', x: 7, y: 6 + (Math.floor(at * 4) % 2), perFrame: true, fade: false, c: col });
        if (every(r, 'c', at, 0.15)) r.emit({ type: 'coin', x: r.scr(a.hx + rand(-3, 3)), y: GROUND - 2, vx: rand(-14, 14), vy: rand(-36, -24), ay: 60, life: 1.2 });
      },
    },

    hammock: {
      // 해먹 흔들흔들 — 기둥 두 개 사이 해먹에 쏙 들어가 흔들흔들. 눈을 감고 낙엽이 팔랑
      len: 4, loop: true,
      pose(p, k, at) { p.curl = true; p.dy = -4; p.eyes = 'happy'; p.xf = { ox: Math.round(Math.sin(at * 1.6) * 2) }; p.noShadow = true; },
      front(g, a, k, at, c) {
        const ox = Math.round(Math.sin(at * 1.6) * 2);
        for (let x = a.hx - 10; x <= a.hx + 10; x++) {
          const sag = Math.round(3 - (x - a.hx) * (x - a.hx) / 40);
          this.px(x, 38 + sag, c.K);
          this.px(x, 39 + sag, (x & 1) ? '#e8534a' : '#fffaf3');
          this.px(x, 40 + sag, c.K);
        }
        // 기둥 꼭대기에서 해먹 끝까지 줄 (몸이 흔들려도 기둥은 제자리)
        for (const s of [-1, 1]) {
          const px = a.hx + s * 15 - ox;
          for (let i = 0; i <= 5; i++) this.px(Math.round(px + (a.hx + s * 10 - px) * (i / 5)), 31 + Math.round((38 - 31) * (i / 5)), '#8a5a32');
        }
      },
      step(r, k, at, dt, a) {
        for (const s of [-1, 1]) r.emit({ type: 'vline', x: r.scr(a.hx + s * 15), y: 30, len: GROUND - 29, perFrame: true, fade: false, c: '#8a5a32' });
        if (every(r, 'l', at, 1.6)) r.emit({ type: 'confetti', x: r.scr(a.hx + rand(-14, 16)), y: 2, vx: rand(-5, -1), vy: 7, life: 4, c: '#e8923c' });
        if (every(r, 'z', at, 1.5)) txt(r, 'Z', r.scr(a.hx + 6), a.top - 4, '#9aa6ff', 1.2);
      },
    },

    fooddream: {
      // 맛있는 상상 — 허공을 보며 멍… 생각 풍선 속에 스테이크 → 생선구이 → 케이크가 차례로 떠오른다. 침이 주르륵
      len: 4.8, loop: true,
      pose(p) { p.eyes = 'sparkle'; p.lookX = 1; p.lookY = -1; p.mouth = 'open'; p.blush = true; p.tail = 'wag'; },
      front(g, a, k, at, c) {
        const cx = a.hx + 13;
        const cy = 11;
        this.ellipse(cx, cy, 9, 6.5, '#fffaf3', c.K);
        this.ellipse(a.hx + 6, a.top - 3, 1.4, 1.2, '#fffaf3', c.K);
        this.ellipse(a.hx + 8, a.top - 7, 2, 1.6, '#fffaf3', c.K);
        const food = [STEAK, FISHDREAM, CAKE][Math.min(2, Math.floor(k * 3))];
        this.pattern(food, cx - (food[0].length >> 1), cy - (food.length >> 1), c);
      },
      step(r, k, at, dt, a) {
        if (every(r, 'd', at, 0.9)) r.emit({ type: 'drop', x: r.scr(a.fx + 1), y: a.my + 1, vy: 6, ay: 20, life: 0.8, c: '#bfe6ff' });
        if (every(r, 's', at, 0.5)) r.emit({ type: 'spark', x: r.scr(a.hx + 13 + rand(-8, 8)), y: 11 + rand(-5, 5), life: 0.4 });
      },
    },

    // ================= 5차 (2026-09-22 확정) =================
    sipcode: {
      // 한 손 코딩 한 모금 — 타닥타닥 치다가 머그를 들어 홀짝, 다시 타닥. 여유 있는 프로의 코딩
      len: 4, loop: true,
      pose(p, k) { desk(p); if (k > 0.6 && k < 0.85) { p.armL = 'hold'; p.eyes = 'closed'; p.mouth = 'none'; } },
      mid(g, a, k, at, c) { if (k > 0.6 && k < 0.85) this.pattern(MUG, a.hx - 5, a.my, c); else this.pattern(MUG, a.hx + 11, GROUND - 5, c); },
      // 김은 책상 위 머그에서만 가늘게 (들어 마시는 동안은 얼굴을 가리지 않게 쉰다)
      step(r, k, at, dt, a) { if (!(k > 0.6 && k < 0.85) && every(r, 's', at, 0.2)) steam(r, r.scr(a.hx + 13), GROUND - 6); } },
    headbang: {
      // 헤드폰 리듬 코딩 — 헤드폰 쓰고 박자에 맞춰 고개를 까딱까딱. 음표가 둥실
      len: 2, loop: true,
      pose(p, k, at) { desk(p, true); p.xf = { rot: Math.sin(at * 8) * 0.08, py: GROUND }; p.eyes = 'closed'; p.mouth = 'smile'; },
      front(g, a, k, at, c) { this.pattern(['...KKKKKKKKK...', '.KKDDDDDDDDDKK.', 'KKK.........KKK', 'KDK.........KDK', 'KDK.........KDK', 'KKK.........KKK'], a.hx - 7, a.earTop - 3, c); },
      step(r, k, at, dt, a) { if (every(r, 'n', at, 0.5)) r.emit({ type: 'note', x: r.scr(a.hx + rand(-10, 10)), y: a.top - 4, vy: -8, life: 1 }); } },
    eureka: {
      // 유레카! — 턱 괴고 흠… 고민하다 머리 위 전구가 번쩍! 신나서 타다다닥
      len: 4, loop: true,
      pose(p, k) { if (k < 0.45) { p.armR = 'hold'; p.eyes = 'half'; p.mouth = 'flat'; p.lookY = -1; p.prop = 'laptop'; p.dy = -3; } else if (k < 0.55) { p.eyes = 'star'; p.mouth = 'open'; p.ear = 1; p.prop = 'laptop'; p.dy = -4; } else { desk(p, true); p.eyes = 'happy'; } },
      front(g, a, k, at, c) {
        if (k <= 0.45 || k >= 0.72) return;
        // 전구가 딸깍 켜지며 번쩍 — 처음 잠깐은 빛살이 사방으로 퍼진다
        const x = a.hx + 6, y = a.top - 10;
        const on = k < 0.5 || Math.floor(at * 6) % 3;
        this.pattern(['.KKKKK.', 'KYYYYYK', 'KYYWWYK', 'KYYYWYK', '.KYYYK.', '..KgK..', '..KgK..', '..KKK..'], x - 1, y, on ? c : { ...c, Y: '#e8d9a0', W: '#e8d9a0' });
        if (k < 0.56) {
          const L = k < 0.5 ? 2 : 3;
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) for (let i = 1; i <= L; i++) this.px(x + 2 + dx * (3 + i), y + 2 + dy * (2 + i), '#fff6a0', false);
        }
      },
      step(r, k, at, dt, a) { if (k < 0.45 && every(r, 'd', at, 0.6)) txt(r, '...', r.scr(a.hx + 5), a.top - 4, '#ffffff', 0.6, -2); } },
    smokingkeys: {
      // 키보드 과열 — 너무 빨리 쳐서 키보드에서 연기가 모락모락. 그래도 멈추지 않는다
      len: 3, loop: true,
      pose(p) { desk(p, true); p.brow = 'angry'; },
      // 연기는 키보드 양 끝에서 피어올라 바깥으로 흩어진다 (얼굴은 가리지 않는다). 가끔 불티가 톡
      step(r, k, at, dt, a) {
        if (every(r, 's', at, 0.15)) { const s = Math.floor(at / 0.15) % 2 ? 1 : -1; r.emit({ type: 'puff', x: r.scr(a.hx + s * rand(8, 11)), y: GROUND - 3, vy: -9, vx: r.facing * s * rand(5, 9), life: 0.9, c: 'rgba(160,160,160,0.8)' }); }
        if (every(r, 'e', at, 0.35)) r.emit({ type: 'ember', x: r.scr(a.hx + rand(-6, 6)), y: GROUND - 2, vx: rand(-8, 8), vy: -12, ay: 30, life: 0.4 });
      } },
    soulcode: {
      // 영혼 가출 코딩 — 몸은 계속 타자 치는데 영혼은 빠져나와 위에서 둥실. 그래도 손은 멈추지 않는다
      len: 4, loop: true,
      pose(p) { desk(p); p.eyes = 'dot'; p.mouth = 'blep'; },
      step(r, k, at, dt, a) { r.emit({ type: 'soul', x: r.scr(a.hx + Math.round(Math.sin(at * 2) * 3)), y: a.top - 8 - Math.round(bump(k, 0, 1) * 4), perFrame: true, fade: false }); } },
    ivcoffee: {
      // 커피 링거 — 옆에 커피 링거를 꽂고 똑똑 수혈받으며 코딩
      len: 3, loop: true,
      pose(p) { desk(p); p.eyes = 'half'; },
      back(g, a, k, at, c) { this.pattern(['KKKKK', 'KtttK', 'KtttK', 'KtttK', '.KKK.', '..K..'], a.hx + 11, 22, c); for (let y = 28; y < GROUND; y++) this.px(a.hx + 13, y, '#8f95a0'); for (let i = 0; i < 6; i++) this.px(a.hx + 13 - i, a.cy - 2 + Math.round(i * 0.2), '#cfd6de'); },
      step(r, k, at, dt, a) { if (every(r, 'd', at, 0.4)) r.emit({ type: 'drop', x: r.scr(a.hx + 13), y: 28, vy: 8, life: 0.4, c: '#6b4226' }); } },
    overheat: {
      // 머리에서 김 폴폴 — 뇌 과부하. 얼굴이 빨개지고 머리에서 김이 폭폭 솟는다
      len: 3, loop: true,
      pose(p) { desk(p, true); p.blush = true; p.eyes = 'squint'; p.brow = 'angry'; },
      // 얼굴(머리)만 벌겋게 달아오른다 — 노트북·김까지 물들던 전체 tint 대신 머리 영역에만 (7차)
      front(g, a, k, at) { tintArea.call(this, a.left - 1, a.earTop - 1, a.hw * 2 + 3, GROUND - 6 - a.earTop, `rgba(255,70,60,${(0.2 + 0.08 * Math.sin(at * 6)).toFixed(2)})`); },
      step(r, k, at, dt, a) { if (every(r, 's', at, 0.12)) r.emit({ type: 'puff', x: r.scr(a.hx + rand(-4, 4)), y: a.top - 2, vy: -14, vx: rand(-4, 4), life: 0.7, c: 'rgba(255,255,255,0.9)' }); } },
    raisehand: {
      // 저요 저요! — 앞발을 번쩍 들고 흔들며 폴짝폴짝. 선생님 저 좀 봐 주세요
      len: 1.6, loop: true,
      pose(p, k, at) { p.armR = 'cheer'; p.dy = Math.round(-3 * Math.abs(Math.sin(at * 6))); p.eyes = 'sparkle'; p.mouth = 'open'; p.ear = 1; },
      step(r, k, at, dt, a) { if (every(r, 'e', at, 0.8)) txt(r, '!', r.scr(a.hx + 9), a.top - 8, '#ffd35c', 0.6); } },
    pray: {
      // 제발요 기도 — 앞발을 모으고 초롱초롱한 눈으로 "PLZ". 반짝반짝 빛까지
      len: 2.4, loop: true,
      pose(p) { p.armL = p.armR = 'cross'; p.eyes = 'sparkle'; p.mouth = 'o'; p.ear = 1; p.blush = true; },
      step(r, k, at, dt, a) { if (every(r, 's', at, 0.35)) r.emit({ type: 'spark', x: r.scr(a.hx + rand(-12, 12)), y: a.top + rand(-4, 8), life: 0.5 }); if (every(r, 'p', at, 1.2)) txt(r, 'PLZ', r.scr(a.hx + 6), a.top - 7, '#ffd3df', 0.9); } },
    fishdream: {
      // 생선 꿈 — 자면서 생선 먹는 꿈을 꾼다. 꿈 풍선 속 생선, 입가엔 침
      len: 4, loop: true,
      pose(p, k, at) { p.curl = true; p.eyes = 'closed'; p.mouth = Math.floor(at * 3) % 2 ? 'chew' : 'smile'; p.blush = true; },
      front(g, a, k, at, c) { this.ellipse(a.hx + 11, a.top - 7, 6, 4, '#fffaf3', c.K); this.pattern(['.KKKK.K', 'KOHOOKO', '.KKKK.K'], a.hx + 8, a.top - 8, c); this.ellipse(a.hx + 5, a.top - 2, 1, 1, '#fffaf3', c.K); },
      step(r, k, at, dt, a) { if (every(r, 'd', at, 1.2)) r.emit({ type: 'drop', x: r.scr(a.hx - 1), y: a.my, vy: 5, life: 0.6, c: '#bfe6ff' }); } },
    slowblink: {
      // 고양이 키스 (천천히 깜빡) — 눈을 아주 천천히 감았다 뜬다. 고양이 말로 "사랑해"
      // (2026-10-10 디자인 개선: 2칸짜리 눈만 바뀌어 안 보이던 걸, 머리 옆 말풍선에 큰 눈을 띄워 천천히 감았다 뜨는 게 보이게. 다 뜨면 하트 뿅)
      len: 3,
      pose(p, k) {
        p.eyes = blinkEyes(k); p.mouth = 'smile'; p.tail = 'slow'; p.lookX = 1;
        p.blush = k > 0.2;
        if (k > 0.26 && k < 0.68) p.ear = -1;
      },
      step(r, k, at, dt, a) {
        if (k > 0.94) return;
        const pop = k < 0.04 ? 0.6 : 1; // 처음 한 박자는 작게 떴다가 퐁
        const W = Math.round(19 * pop), H = Math.round(13 * pop);
        const x0 = r.scr(a.hx + 13) - (W >> 1), y0 = a.top - 6 - H;
        const rows = [];
        for (let j = 0; j < H; j++) {
          let s = '';
          for (let i = 0; i < W; i++) {
            const cx = Math.min(i, W - 1 - i), cy = Math.min(j, H - 1 - j);
            const out = cx + cy < 2; // 둥근 모서리
            const edge = !out && (i === 0 || j === 0 || i === W - 1 || j === H - 1 || cx + cy === 2);
            s += out ? '.' : edge ? 'K' : 'W';
          }
          rows.push(s);
        }
        spr(r, rows, x0, y0, { K: INK, W: '#fffaf3' });
        // 꼬리: 말풍선 왼쪽 아래 → 고양이 머리
        spr(r, ['KWK', 'KK.', 'K..'], x0 + 2, y0 + H - 1, { K: INK, W: '#fffaf3' });
        if (pop < 1) return;
        const e = BIG_EYE[blinkEyes(k)];
        const cx = x0 + (W >> 1);
        spr(r, e, cx - 6, y0 + 3, { K: INK, W: '#ffffff' });
        spr(r, e, cx + 3, y0 + 3, { K: INK, W: '#ffffff' });
        // 코 · 입 · 볼
        spr(r, ['.P.', 'K.K', '.K.'], cx - 1, y0 + 7, { P: '#ff8fa3', K: INK });
        if (k > 0.2) for (const dx of [-8, 6]) spr(r, ['PP'], cx + dx, y0 + 9, { P: '#ff8fa3' });
        if (once(r, 'h', k > 0.82)) {
          r.emit({ type: 'heart', big: true, x: x0 + W - 6, y: y0 - 2, vx: 3, vy: -8, life: 1.1 });
          r.emit({ type: 'spark', x: x0 + 2, y: y0, life: 0.5 });
        }
      },
    },
    shinyfur: {
      // 털 윤기 반짝 — 쓰다듬을수록 털에서 광이 난다. 샴푸 광고 고양이
      // (2026-10-10 디자인 개선: 흐리던 빛띠를 굵고 하얗게, 두 번 스윽 지나간 자리마다 큰 반짝이 + "SHINY")
      len: 2.4, reveal: 0.5,
      pose(p, k) {
        if (k < 0.08) { p.eyes = 'open'; p.ear = 1; return; }
        p.eyes = 'closed'; p.mouth = 'smile'; p.tail = 'up'; p.lookY = -1; p.xf = { sy: 1.04 }; p.blush = true; p.ear = 1;
      },
      front(g, a, k) {
        for (const [t0, t1] of [[0.06, 0.38], [0.48, 0.8]]) {
          const s = seg(k, t0, t1);
          if (s <= 0 || s >= 1) continue;
          const x0 = a.left - 12 + Math.round(ease(s) * (a.hw * 2 + 18));
          for (let y = a.earTop - 2; y <= GROUND; y++) {
            const x = x0 + Math.round((y - a.earTop) * 0.6);
            tintArea.call(this, x, y, 4, 1, 'rgba(255,255,255,0.95)');
            tintArea.call(this, x - 2, y, 2, 1, 'rgba(255,255,255,0.5)');
            tintArea.call(this, x + 4, y, 2, 1, 'rgba(255,255,255,0.5)');
          }
        }
      },
      step(r, k, at, dt, a) {
        tintUnder(r, '#ffffff', 0.15 * bump(k, 0.05, 1));
        const L = 2.4;
        // 띠 끝마다 큰 반짝이 둘, 사이사이 작은 것
        for (const [t, dx, dy] of [[0.28, 6, -2], [0.38, -6, 5], [0.7, -6, -1], [0.8, 7, 6], [0.9, 1, -4]]) twinkle(r, r.scr(a.hx + dx), a.top + dy, at - t * L);
        if (once(r, 't', k > 0.38)) txt(r, 'SHINY', r.scr(a.hx) - 9, a.top - 12, '#fff6a0', 0.9, -4);
      },
    },
    donebanner: {
      // "DONE" 현수막 — 두 앞발로 장대 두 개를 번쩍 들면 그 사이로 "DONE!" 현수막이 촤악 펼쳐진다. 폴짝 뛰고 좌우로 흔들흔들
      // (7차: 글자만 귀 위에 겹쳐 있던 걸 진짜 현수막으로)
      len: 2.8,
      pose(p, k) {
        p.armL = p.armR = 'cheer';
        p.eyes = k < 0.12 ? 'open' : 'happy';
        p.mouth = 'open'; p.ear = 1; p.tail = 'up';
        p.dy = -Math.round(bump(k, 0.14, 0.34) * 3);
        if (k > 0.36 && k < 0.92) p.xf = { ox: Math.round(Math.sin((k - 0.36) * Math.PI * 4)) };
      },
      front(g, a, k, at, c) {
        // 현수막이 가운데서부터 양옆으로 촤악
        const half = Math.max(1, Math.round(11 * ease(seg(k, 0.08, 0.3))));
        const top = a.top - 17, h = 8;
        for (const sd of [-1, 1]) {
          // 앞발에서 현수막 모서리까지 장대
          const x0 = a.hx + sd * 6, y0 = a.top - 3, x1 = a.hx + sd * half, y1 = top + h - 1;
          const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
          for (let i = 0; i <= n; i++) this.px(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), '#8a5a32');
          this.pattern(['KK', 'KK'], a.hx + sd * half - (sd < 0 ? 1 : 0), top - 2, c);
        }
        for (let y = top; y < top + h; y++) for (let x = a.hx - half; x <= a.hx + half; x++) {
          const edge = y === top || y === top + h - 1 || x === a.hx - half || x === a.hx + half;
          this.px(x, y, edge ? c.K : y === top + 1 ? '#ffe8a0' : '#fffaf3');
        }
      },
      step(r, k, at, dt, a, p) {
        const ox = p && p.xf ? p.xf.ox || 0 : 0;
        if (k > 0.28) r.emit({ type: 'text', s: 'DONE!', x: r.scr(a.hx) - 8 + ox, y: a.top - 15, perFrame: true, fade: false, c: '#e8534a' });
        if (once(r, 'c', k > 0.3)) for (let i = 0; i < 16; i++) r.emit({ type: 'confetti', x: r.scr(a.hx) + rand(-12, 12), y: a.top - 18, vx: rand(-10, 10), vy: rand(-14, -4), ay: 30, life: rand(1, 1.6), c: CONF[i % 6] });
      },
    },
    bigbutton: {
      // 제출 버튼 꾹 — 커다란 빨간 버튼을 노려보다가 앞발을 높이 치켜들고… 꾹! 버튼이 쑥 들어가고 색종이가 우르르
      // (7차: 앞발이 머리 옆에서 허공을 찌르던 걸, 실제로 버튼 위로 내리찍게)
      len: 2.6,
      pose(p, k, at) {
        p.lookX = 1; p.lookY = 1; p.ear = 1; p.tail = 'up';
        if (k < 0.32) { p.eyes = k < 0.2 ? 'wide' : 'sparkle'; p.mouth = 'o'; }
        else if (k < 0.52) { p.eyes = 'squint'; p.mouth = 'big'; p.xf = { ox: 1 }; p.brow = 'angry'; }
        else { p.eyes = 'happy'; p.mouth = 'open'; p.lookY = 0; if (k > 0.64) { p.armL = p.armR = 'cheer'; p.dy = -Math.round(bump(k, 0.64, 0.84) * 3); } }
      },
      front(g, a, k, at, c) {
        const pressed = k > 0.34 && k < 0.54 ? 1 : 0;
        this.pattern(['..KKKKK..', '.KRRHRRK.', 'KKKKKKKKK', 'KgggggggK', 'KKKKKKKKK'].slice(pressed), a.hx + 7, GROUND - 4 + pressed, c);
        if (k >= 0.64) return;
        // 앞발: 어깨 → 버튼 위 높이 (치켜들기) → 꾹 → 천천히 돌아온다
        const bx = a.hx + 11, press = GROUND - 7 + pressed, high = GROUND - 15;
        let x, y;
        if (k < 0.2) { const e = ease(seg(k, 0.04, 0.2)); x = a.right - 1 + (bx - (a.right - 1)) * e; y = a.cy + (high - a.cy) * e; }
        else if (k < 0.3) { x = bx; y = high + Math.round(Math.sin(at * 30) * 0.6); }
        else if (k < 0.34) { const e = seg(k, 0.3, 0.34); x = bx; y = high + (press - high) * e * e; }
        else if (k < 0.52) { x = bx; y = press; }
        else { const e = ease(seg(k, 0.52, 0.64)); x = bx + (a.right - 1 - bx) * e; y = press + (a.cy - press) * e; }
        limb.call(this, g, a.right - 2, a.cy - 1, x, y);
      },
      step(r, k, at, dt, a) {
        if (once(r, 'c', k > 0.36)) {
          txt(r, 'CLICK', r.scr(a.hx + 4) - 6, a.top - 8, '#fff', 0.7);
          for (let i = 0; i < 26; i++) r.emit({ type: 'confetti', x: r.scr(a.hx + 11), y: GROUND - 6, vx: rand(-26, 26), vy: rand(-36, -12), ay: 45, life: 1.4, c: CONF[i % 6] });
        }
      },
    },
    glowup: {
      // 변신 빛기둥 — 하늘에서 빛기둥이 내려오고 그 안에서 빙글빙글 돌며 반짝 변신
      len: 2.8, reveal: 0.5,
      pose(p, k, at, r) { if (k > 0.2 && k < 0.7) { r.setFacing(Math.floor(at * 10) % 2 ? 1 : -1); p.xf = { oy: -Math.round(bump(k, 0.2, 0.7) * 6) }; p.eyes = 'closed'; } else { p.eyes = 'star'; p.mouth = 'open'; p.armL = p.armR = 'up'; } },
      back(g, a, k) { if (k < 0.75) for (let y = 0; y <= GROUND; y++) for (let x = a.cx - 7; x <= a.cx + 7; x++) this.px(x, y, Math.abs(x - a.cx) < 3 ? 'rgba(255,250,210,0.5)' : 'rgba(255,240,170,0.25)', false); },
      // 번쩍은 캔버스 전체(바탕화면 위 흰 네모)가 아니라 고양이만 (7차)
      step(r, k, at, dt, a) { if (k < 0.75 && every(r, 's', at, 0.12)) r.emit({ type: 'spark', x: r.scr(a.cx + rand(-6, 6)), y: rand(4, 40), life: 0.4 }); if (k > 0.68) flashCat(r, seg(k, 0.68, 0.8)); if (once(r, 'f', k > 0.7)) for (let i = 0; i < 10; i++) { const an = (i / 10) * Math.PI * 2; r.emit({ type: 'star', x: r.scr(a.cx), y: a.cy - 2, vx: Math.cos(an) * 20, vy: Math.sin(an) * 14, life: 0.6 }); } } },
    fireworksbg: {
      // 불꽃놀이 — 양옆에서 폭죽이 꼬리를 끌며 솟아올라 팡! 터질 때마다 불빛이 고양이를 물들이고, 고양이는 넋 놓고 "와아"
      // (7차: 고리만 뿅 생기던 걸, 솟아오르는 꼬리 → 터짐 → 반짝이며 떨어지는 불꽃으로)
      len: 3.2,
      pose(p, k, at, r) {
        p.lookY = -1; p.eyes = 'sparkle'; p.mouth = 'o'; p.ear = 1;
        const since = at - (r.ms.boom || -9);
        if (since < 0.35) { p.mouth = 'open'; p.blush = true; p.dy = since < 0.12 ? -1 : 0; }
        p.lookX = r.ms.lookX || 0;
      },
      step(r, k, at, dt, a) {
        const shells = r.ms.shells || (r.ms.shells = []);
        if (k < 0.8 && every(r, 'f', at, 0.62)) {
          const side = shells.length % 2 ? 1 : -1;
          shells.push({ x: 24 + side * rand(12, 19), yb: rand(5, 14), t0: at, col: CONF[Math.floor(rand(0, 6))], done: false });
        }
        for (const s of shells) {
          const u = (at - s.t0) / 0.45;
          if (u < 1) {
            // 솟아오르는 꼬리
            const y = GROUND - 2 - (GROUND - 2 - s.yb) * (1 - (1 - u) * (1 - u));
            r.emit({ type: 'spray', x: s.x, y, c: '#fff6d0', perFrame: true, fade: false });
            if (every(r, 'tr' + s.t0, at, 0.04)) r.emit({ type: 'ember', x: s.x + rand(-0.5, 0.5), y: y + 1, vy: 4, life: 0.25 });
          } else if (!s.done) {
            s.done = true;
            r.ms.boom = at;
            r.ms.boomCol = s.col;
            r.ms.lookX = s.x < 24 ? -1 : 1;
            for (let i = 0; i < 14; i++) { const an = (i / 14) * Math.PI * 2; r.emit({ type: 'confetti', x: s.x, y: s.yb, vx: Math.cos(an) * 17, vy: Math.sin(an) * 17, ay: 12, life: 1, c: s.col }); }
            r.emit({ type: 'spark', x: s.x, y: s.yb, life: 0.3, c: '#ffffff' });
          }
        }
        // 터진 불빛에 고양이가 잠깐 환해진다
        const since = at - (r.ms.boom || -9);
        if (since < 0.4) tintUnder(r, '#fff6d0', 0.22 * (1 - since / 0.4)); // 색을 입히면 털이 탁해져서 밝게만
      },
    },
    teatime: {
      // 차와 과자 — 따뜻한 차 한 잔에 쿠키 하나. 쿠키를 집어 차에 퐁당퐁당 두 번 찍은 뒤 냠냠, 부스러기가 톡톡
      // (7차: 쿠키가 입으로 순간이동하던 걸, 앞발로 집어 찍고 → 입으로 가져가게)
      len: 4.4, loop: true,
      pose(p, k, at, r) {
        p.tail = 'slow';
        if (k < 0.42) { p.lookX = 1; p.lookY = 1; p.eyes = k < 0.12 ? (r.blinkAt(at) ? 'blink' : 'open') : 'sparkle'; p.mouth = k > 0.3 ? 'o' : 'smile'; }
        else if (k < 0.74) { p.armR = 'hold'; p.eyes = 'happy'; p.blush = true; p.mouth = k > 0.5 ? (Math.floor(at * 6) % 2 ? 'chew' : 'smile') : 'open'; }
        else { p.eyes = 'closed'; p.mouth = 'smile'; p.blush = true; p.tail = 'wag'; }
      },
      front(g, a, k, at, c) {
        const cupX = a.hx + 9, cupY = GROUND - 4;
        // 받침 접시 + 찻잔
        this.pattern(['KKKKKKKK'], a.hx + 3, GROUND, { K: '#c3ccd6' });
        this.pattern(['KWWWK.', 'KWtWKK', 'KWWWK.', '.KKK..'], cupX, cupY, c);
        const soaked = k > 0.3;
        const cookie = (x, y, bite) => this.pattern(bite ? ['KK.', 'KsK', 'KKK'] : ['KKK', soaked ? 'KsK' : 'KOK', 'KKK'], Math.round(x) - 1, Math.round(y) - 1, { K: '#8a5a32', O: '#e8b061', s: '#b07a3e' });
        if (k < 0.12) { cookie(a.hx + 5, GROUND - 1); return; }
        if (k < 0.42) {
          // 앞발이 쿠키를 집어(0.12~0.2) 찻잔 위로(~0.24) → 퐁당 두 번(~0.36) → 들어 올린다
          let x, y;
          if (k < 0.2) { const e = ease(seg(k, 0.12, 0.2)); x = a.right + (a.hx + 5 - a.right) * e; y = a.cy + (GROUND - 3 - a.cy) * e; }
          else if (k < 0.24) { const e = ease(seg(k, 0.2, 0.24)); x = a.hx + 5 + (cupX + 2 - a.hx - 5) * e; y = GROUND - 3 - 5 * e; }
          else if (k < 0.36) { x = cupX + 2; y = GROUND - 8 + Math.round(bump((seg(k, 0.24, 0.36) * 2) % 1, 0, 1) * 3); }
          else { const e = ease(seg(k, 0.36, 0.42)); x = cupX + 2 + (a.right - cupX - 2) * e; y = GROUND - 8 + (a.cy - GROUND + 8) * e; }
          limb.call(this, g, a.right - 2, a.cy - 1, x, y - 2);
          cookie(x, y + 2);
          return;
        }
        if (k < 0.74) cookie(a.fx - 0.5, a.my + 2, k > 0.52);
      },
      step(r, k, at, dt, a) {
        if (every(r, 's', at, 0.25)) steam(r, r.scr(a.hx + 11), GROUND - 5);
        if (k > 0.26 && k < 0.36 && every(r, 'dk', at, 0.26)) r.emit({ type: 'spray', x: r.scr(a.hx + 11), y: GROUND - 5, vx: rand(-6, 6), vy: -8, ay: 30, life: 0.4, c: '#c48b56' });
        if (k > 0.5 && k < 0.74 && every(r, 'cr', at, 0.3)) r.emit({ type: 'spray', x: r.scr(a.fx + rand(-1, 1)), y: a.my + 2, vx: rand(-5, 5), vy: -3, ay: 30, life: 0.5, c: '#e8b061' });
        if (once(r, 'h', k > 0.76)) r.emit({ type: 'heart', x: r.scr(a.hx + 6), y: a.top - 3, vy: -6, life: 1.1 });
      },
    },
    foodsign: {
      // "FOOD" 피켓 시위 — "FOOD" 피켓을 들고 1인 시위. 피켓이 위아래로 흔들린다
      len: 2.4, loop: true,
      pose(p, k) { p.armL = p.armR = 'lift'; p.liftUp = bump(k, 0, 0.5); p.brow = 'angry'; p.mouth = 'big'; },
      front(g, a, k, at, c) { const up = Math.round(bump(k, 0, 0.5) * 4); this.pattern(['KKKKKKKKKKKKKKKKK', 'KWWWWWWWWWWWWWWWK', 'KWWWWWWWWWWWWWWWK', 'KWWWWWWWWWWWWWWWK', 'KWWWWWWWWWWWWWWWK', 'KWWWWWWWWWWWWWWWK', 'KKKKKKKKKKKKKKKKK'], a.hx - 8, a.top - 12 - up, c); },
      step(r, k, at, dt, a) { const up = Math.round(bump(k, 0, 0.5) * 4); r.emit({ type: 'text', s: 'FOOD', x: r.scr(a.hx) - 7, y: a.top - 11 - up, perFrame: true, fade: false, c: '#e8534a' }); } },
    paperplane: {
      // 종이비행기 — 앞발 사이에서 종이를 탁·탁 접어 비행기로 → 힘껏 "SWISH". 파란 자국을 그으며 오른쪽 위 하늘로 작아지다 반짝,
      // 이마에 앞발 얹고 멀리 바라본다 (2026-10-10 디자인 개선: 4칸짜리 흰 비행기가 바탕에 묻히던 걸)
      len: 3.2,
      pose(p, k) {
        if (k < 0.3) { p.armL = p.armR = 'hold'; p.lookY = 1; p.eyes = 'open'; p.mouth = 'blep'; return; }
        if (k < 0.4) { p.armR = 'up'; p.eyes = 'squint'; p.mouth = 'flat'; p.brow = 'angry'; p.xf = { ox: -1, sx: 0.97, sy: 1.03 }; return; }
        if (k < 0.48) { p.armR = 'out'; p.eyes = 'wide'; p.mouth = 'open'; p.xf = { ox: 1 }; return; }
        p.armR = 'out'; p.lookX = 1; p.lookY = -1; p.eyes = k > 0.78 ? 'sparkle' : 'open'; p.mouth = k > 0.78 ? 'open' : 'o'; p.tail = 'wag'; p.ear = 1;
      },
      front(g, a, k, at, c) {
        const m = { K: c.K, W: '#ffffff', w: '#bcd0e6' };
        if (k < 0.1) this.pattern(['KKKKKKK', 'KWWWWWK', 'KWWWWWK', 'KWWWWWK', 'KWWWWWK', 'KKKKKKK'], a.hx - 3, a.my, m);
        else if (k < 0.2) this.pattern(['KKKKKKK', 'KWWwWWK', '.KWwWK.', '..KwK..', '...K...'], a.hx - 3, a.my + 1, m);
        else if (k < 0.3) this.pattern(PLANE_M, a.hx - 2, a.my, m);
        else if (k < 0.4) this.pattern(PLANE_M, a.right - 1, a.top - 3, m);
      },
      step(r, k, at, dt, a) {
        if (once(r, 'f1', k > 0.1)) r.emit({ type: 'spark', x: r.scr(a.hx + 4), y: a.my, life: 0.3 });
        if (once(r, 'f2', k > 0.2)) r.emit({ type: 'spark', x: r.scr(a.hx - 4), y: a.my, life: 0.3 });
        if (once(r, 's', k > 0.4)) txt(r, 'SWISH', r.scr(a.hx) - 12, a.top - 8, '#ffffff', 0.8, -4);
        const t = seg(k, 0.4, 0.76);
        if (t > 0 && t < 1) {
          const x = a.right + 1 + (44 - a.right - 1) * t, y = a.top - 2 - (a.top - 2 - 5) * Math.sin(t * Math.PI * 0.5);
          planeAt(r, t < 0.35 ? PLANE : t < 0.7 ? PLANE_M : PLANE_S, r.scr(x), y, r.facing);
          if (every(r, 'tr', at, 0.025)) r.emit({ type: 'spray', x: r.scr(Math.round(x - 3)), y: Math.round(y) + 1, life: 0.7, c: '#7cc4f2' });
        }
        if (once(r, 'v', k > 0.76)) { r.emit({ type: 'spark', x: r.scr(44), y: 5, life: 0.6 }); r.emit({ type: 'star', x: r.scr(42), y: 7, vx: -3, vy: -3, life: 0.5 }); }
      },
    },
    airpunch: {
      // 허공에 냥펀치 — 아무것도 없는 허공을 노려보다 갑자기 냥냥펀치. 뭐가 보이는 걸까
      len: 2.4,
      pose(p, k, at) { if (k < 0.4) { p.eyes = 'wide'; p.lookY = -1; p.ear = 1; } else { p.armL = Math.floor(at * 10) % 2 ? 'cheer' : 'up'; p.armR = Math.floor(at * 10) % 2 ? 'up' : 'cheer'; p.eyes = 'squint'; p.brow = 'angry'; } },
      step(r, k, at, dt, a) { if (k > 0.4 && every(r, 'l', at, 0.1)) r.emit({ type: 'line', x: r.scr(a.hx + rand(-8, 8)), y: a.top - rand(2, 6), len: 3, life: 0.1 }); } },
    knitting: {
      // 뜨개질 — 두 앞발로 대바늘을 쥐고 딸깍딸깍. 왼쪽 털실 뭉치가 줄어드는 만큼 오른쪽에 개킨 목도리가 쌓이고,
      // 다 뜨면 번쩍 들어 "TA-DA" — 목에 칭칭 두르고 뿌듯 (2026-10-10 디자인 개선: 발밑 몇 줄에 몰려 너무 작던 걸)
      len: 4.8, loop: true,
      pose(p, k, at) {
        p.tail = 'slow'; p.mouth = 'smile';
        if (k < 0.7) {
          p.armL = p.armR = 'hold'; p.lookY = 1;
          p.eyes = Math.floor(at * 0.8) % 4 === 3 ? 'blink' : 'half';
        } else if (k < 0.8) { p.armL = p.armR = 'lift'; p.liftUp = 1; p.eyes = 'star'; p.mouth = 'open'; p.ear = 1; p.dy = -Math.round(bump(k, 0.7, 0.8) * 2); }
        else { p.eyes = 'happy'; p.blush = true; p.tail = 'wag'; p.ear = 1; }
      },
      mid(g, a, k, at, c) {
        if (k >= 0.7) return;
        const prog = seg(k, 0, 0.7);
        // 왼쪽 털실 뭉치
        const bx = a.hx - 13;
        const top = yarnBall.call(this, c, bx, GROUND, prog < 0.35 ? 0 : prog < 0.7 ? 1 : 2, Math.floor(at * 2) % 2);
        thread.call(this, bx + 2, top + 1, a.hx - 3, a.my + 3, 2);
        // 오른쪽: 바늘에서 내려온 목도리가 바닥에 개켜져 쌓인다
        const layers = 1 + Math.floor(prog * 4);
        const x0 = a.hx + 5;
        for (let y = a.my + 3; y <= GROUND; y++) { this.px(a.hx + 2, y, c.K); this.px(a.hx + 3, y, SCARF_STRIPE(c, y)); this.px(a.hx + 4, y, SCARF_STRIPE(c, y + 1)); this.px(a.hx + 5, y, c.K); }
        for (let l = 0; l < layers; l++) {
          const y = GROUND - 1 - l * 2;
          for (let x = x0; x <= x0 + 10; x++) { this.px(x, y - 1, c.K); this.px(x, y, SCARF_STRIPE(c, Math.floor((x - x0) / 2) + l)); }
          this.px(x0 + 11, y, c.K); this.px(x0 + 11, y - 1, c.K);
        }
        for (let x = x0; x <= x0 + 11; x++) this.px(x, GROUND, c.K);
      },
      front(g, a, k, at, c) {
        if (k < 0.7) { needles.call(this, a.hx, a.my, Math.floor(at * 4) % 2, 4); return; }
        if (k < 0.8) {
          // 다 뜬 목도리를 머리 위로 번쩍 (두 앞발 사이에 펼쳐진다)
          const y = a.top - 6;
          for (let x = a.hx - 9; x <= a.hx + 9; x++) { this.px(x, y - 1, c.K); this.px(x, y + 2, c.K); const col = SCARF_STRIPE(c, Math.floor((x + 20) / 2)); this.px(x, y, col); this.px(x, y + 1, col); }
          for (const x of [a.hx - 10, a.hx + 10]) for (let yy = y; yy <= y + 3; yy += 1) if (yy % 2 === 0) this.px(x, yy, c.p);
          return;
        }
        // 목에 칭칭: 목 둘레 두 줄 + 오른쪽으로 늘어진 끝
        const y = a.neck - 2;
        for (let x = a.left; x <= a.right; x++) { this.px(x, y - 1, c.K); this.px(x, y + 2, c.K); const col = SCARF_STRIPE(c, Math.floor((x + 20) / 2)); this.px(x, y, col); this.px(x, y + 1, col); }
        this.px(a.left - 1, y, c.K); this.px(a.left - 1, y + 1, c.K); this.px(a.right + 1, y, c.K); this.px(a.right + 1, y + 1, c.K);
        const sway = Math.floor(at * 3) % 2;
        for (let j = 0; j < 4; j++) { const x = a.right - 4 + (j > 1 ? sway : 0); this.px(x - 1, y + 2 + j, c.K); this.px(x, y + 2 + j, SCARF_STRIPE(c, j)); this.px(x + 1, y + 2 + j, SCARF_STRIPE(c, j + 1)); this.px(x + 2, y + 2 + j, c.K); }
      },
      step(r, k, at, dt, a) {
        if (k < 0.7 && every(r, 'c', at, 0.5)) r.emit({ type: 'spark', x: r.scr(a.hx + (Math.floor(at * 2) % 2 ? 4 : -4)), y: a.my - 1, life: 0.2 });
        if (once(r, 't', k > 0.71)) { txt(r, 'TA-DA', r.scr(a.hx) - 9, a.top - 16, '#ff9bb8', 0.9, -3); for (let i = 0; i < 6; i++) r.emit({ type: 'spark', x: r.scr(a.hx + rand(-10, 10)), y: a.top - 6 + rand(-3, 3), life: 0.5 }); }
        if (once(r, 'h', k > 0.82)) r.emit({ type: 'heart', x: r.scr(a.hx + 7), y: a.top - 3, vy: -6, life: 1.1 });
      },
    },
    blowkiss: {
      // 하트 날리기 — 앞발로 입맞춤, 쪽! 윙크하며 하트를 날린다
      len: 2.8,
      pose(p, k) {
        if (k < 0.35) { p.armR = 'kiss'; p.mouth = 'kiss'; p.eyes = 'wink'; }
        else if (k < 0.6) { p.armR = 'out'; p.mouth = 'kiss'; p.eyes = 'wink'; }
        else { p.eyes = 'happy'; p.blush = true; }
      },
      step(r, k, at, dt, a) {
        if (once(r, 'h', k > 0.35)) r.emit({ type: 'heart', big: true, x: r.scr(a.fx + 3), y: a.my - 2, vx: 13, vy: -9, life: 1.6 });
      },
    },
    fireup: {
      // 불타오름 — 의욕 활활. 등 뒤로 불꽃이 솟고 눈에 별이 뜬다
      len: 3, loop: true,
      pose(p, k, at) {
        p.eyes = 'star';
        p.brow = 'angry';
        p.mouth = 'open';
        p.armL = p.armR = 'up';
        p.ear = 1;
        p.tail = 'up';
        p.dy = Math.floor(at * 6) % 2 ? -1 : 0;
      },
      back(g, a, k, at) {
        for (let x = a.hx - 13; x <= a.hx + 13; x++) {
          const h = Math.max(0, Math.round(23 - Math.abs(x - a.hx) * 1.05 + Math.sin(at * 12 + x * 1.7) * 2.6));
          for (let i = 0; i < h; i++) {
            const f = i / h;
            this.px(x, GROUND - i, f > 0.78 ? '#ffe27a' : f > 0.45 ? '#ff9a3c' : '#e8534a');
          }
        }
      },
      step(r, k, at, dt, a) {
        if (every(r, 'e', at, 0.08)) r.emit({ type: 'ember', x: r.scr(a.hx + rand(-10, 10)), y: GROUND - 10, vy: -14, vx: rand(-3, 3), life: 0.9 });
      },
    },

    codefrenzy: {
      // 폭풍 코딩 — 눈 부릅뜨고 키보드를 두들긴다. 노트북에서 연기, 특수문자가 튄다
      len: 3.2, loop: true,
      pose(p, k, at) {
        p.prop = 'laptop';
        p.armL = p.armR = 'typefast';
        p.eyes = 'wide';
        p.brow = 'angry';
        p.mouth = 'flat';
        p.sweat = true;
        p.dy = -3;
        p.xf = { ox: Math.floor(at * 24) % 2 ? 1 : 0 };
        p.tail = 'flick';
      },
      step(r, k, at, dt, a) {
        if (every(r, 'c', at, 0.3)) { const side = Math.floor(at / 0.3) % 2 ? 1 : -1; r.emit({ type: 'char', s: '!?#;'[Math.floor(rand(0, 4))], x: r.scr(a.hx + side * 12) - 1, y: GROUND - 8, vy: -14, vx: side * 9, life: 0.7 }); }
        // 노트북 연기는 양 끝에서 바깥으로 (얼굴을 덮지 않게)
        if (every(r, 's', at, 0.3)) { const s = Math.floor(at / 0.3) % 2 ? -1 : 1; r.emit({ type: 'puff', x: r.scr(a.hx + s * 9), y: GROUND - 3, vy: -6, vx: r.facing * s * 6, life: 1, c: 'rgba(180,180,180,0.8)' }); }
      },
    },
    hooray: {
      // 임무 완료 — 빛나는 눈으로 두 발 번쩍 들고 점프, 색종이가 쏟아진다
      len: 2.8,
      pose(p, k) {
        p.dy = -Math.round(bump(k, 0.08, 0.4) * 6);
        p.armL = p.armR = 'cheer';
        p.eyes = 'star';
        p.mouth = 'open';
        p.tail = 'up';
        p.ear = 1;
        if (k > 0.4 && k < 0.5) p.xf = { sx: 1.1, sy: 0.9 };
      },
      step(r, k, at, dt, a) {
        if (once(r, 'go', k > 0.08)) {
          for (let i = 0; i < 26; i++) r.emit({ type: 'confetti', x: 24 + rand(-14, 14), y: rand(2, 12), vx: rand(-6, 6), vy: rand(-4, 6), ay: 14, life: rand(1.4, 2.4), c: CONFETTI[i % CONFETTI.length] });
          r.emit({ type: 'text', s: 'FINISHED!', x: 6, y: 3, vy: -1, life: 1.6, c: '#9fe3c8' });
        }
      },
    },

    sneeze: {
      // 재채기 — 에… 에… 에취! 몸이 튕겨 나가고 콧물 한 방울
      len: 2.6,
      pose(p, k, at) {
        if (k < 0.15) { p.eyes = 'half'; p.mouth = 'o'; }
        else if (k < 0.5) {
          const s = seg(k, 0.15, 0.5);
          p.eyes = s > 0.5 ? 'squint' : 'half';
          p.mouth = s > 0.6 ? 'big' : 'o';
          p.dy = -Math.round(s * 2);
          p.ear = -1;
        } else if (k < 0.62) { p.eyes = 'squint'; p.mouth = 'big'; p.xf = { sx: 1.14, sy: 0.86, oy: 1 }; p.ear = 1; }
        else { p.eyes = 'half'; p.mouth = 'flat'; p.xf = { ox: Math.sin(at * 30) * 0.6 * (1 - seg(k, 0.62, 0.8)) }; }
      },
      step(r, k, at, dt, a) {
        if (once(r, 'a', k > 0.5)) {
          r.emit({ type: 'text', s: 'ACHOO!', x: r.scr(a.hx) + 2, y: a.top - 9, vy: -3, life: 1.1, c: '#fff' });
          for (let i = 0; i < 10; i++) r.emit({ type: 'spray', x: r.scr(a.fx), y: a.my + 2, vx: rand(-18, 18), vy: rand(-10, 6), ay: 30, life: 0.7 });
        }
        if (once(r, 'd', k > 0.7)) r.emit({ type: 'drop', x: r.scr(a.fx + 1), y: a.my + 1, vy: 2, life: 1.2, c: '#bfe6ff' });
      },
    },
    hiccup: {
      // 딸꾹질 — 딸꾹! 할 때마다 몸이 움찔 눌렸다 높이 튀어 오르고, 머리 둘레에 충격선 + 노란 "HIC!"
      // (2026-10-10 디자인 개선: 흰 HIC 글자만 잠깐 떠서 흐릿하던 걸)
      len: 3.3, loop: true,
      pose(p, k, at) {
        const ph = at % 1.1;
        if (ph < 0.05) { p.xf = { sy: 0.9, sx: 1.08 }; p.eyes = 'wide'; p.mouth = 'o'; return; }
        if (ph < 0.22) { p.dy = ph < 0.15 ? -5 : -2; p.xf = { sy: 1.08, sx: 0.95 }; p.eyes = 'wide'; p.mouth = 'o'; p.ear = 1; p.tail = 'up'; return; }
        if (ph < 0.3) { p.xf = { sy: 0.92, sx: 1.06 }; p.eyes = 'wide'; p.mouth = 'o'; return; }
        p.eyes = 'half'; p.mouth = 'wavy'; p.brow = 'sad'; p.tail = 'slow';
      },
      step(r, k, at, dt, a) {
        if (every(r, 'h', at, 1.1)) {
          txt(r, 'HIC!', r.scr(a.hx) + 5, a.top - 10, '#ffd65a', 0.8, -7);
          r.emit({ type: 'shock', x: r.scr(a.hx), y: a.ey - 5, r: 7, life: 0.25 });
        }
      },
    },
    snot: {
      // 코풍선 — 자면서 코풍선이 부풀었다 줄었다… 퐁! 터지면 화들짝
      len: 4.6, loop: true,
      pose(p, k) { p.curl = true; p.eyes = k > 0.93 ? 'wide' : 'closed'; p.mouth = 'flat'; p.ear = k > 0.93 ? 1 : -1; },
      front(g, a, k, at) {
        if (k > 0.92) return;
        const rr = 1 + seg(k, 0, 0.9) * 3.3 + Math.sin(at * 3) * 0.35;
        const cx = a.fx + 1.5 + rr;
        const cy = a.my - 0.5;
        this.shape((x, y) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= rr * rr, [cx - rr - 1, cy - rr - 1, cx + rr + 1, cy + rr + 1], () => 'rgba(205,232,250,0.55)', 'rgba(130,190,235,0.95)');
        this.px(Math.round(cx - rr * 0.4), Math.round(cy - rr * 0.4), '#fff', false);
      },
      step(r, k, at, dt, a) {
        if (every(r, 'z', at, 1.4) && k < 0.9) r.emit({ type: 'text', s: 'Z', x: r.scr(a.hx - 7), y: a.top - 5, vy: -4, vx: -2, life: 1.3, c: '#9aa6ff' });
        if (once(r, 'pop', k > 0.92)) {
          r.emit({ type: 'text', s: 'POP', x: r.scr(a.fx + 3), y: a.my - 8, vy: -4, life: 0.8, c: '#bfe6ff' });
          for (let i = 0; i < 6; i++) r.emit({ type: 'spray', x: r.scr(a.fx + 4), y: a.my, vx: rand(-14, 14), vy: rand(-12, 2), ay: 30, life: 0.5 });
        }
      },
    },
    fart: {
      // 뿡 — 끙… 힘주다가 "PUUU!" 초록 연기를 뿜으며 로켓처럼 쑥 떠올랐다 쿵 착지. 그러고는 시치미 떼고 휘파람
      // (2026-10-10 디자인 개선: 연한 초록 연기 세 알이 바탕에 묻히던 걸)
      len: 3,
      pose(p, k, at, r) {
        if (k < 0.16) { p.eyes = r.blinkAt(at) ? 'blink' : 'open'; return; }
        if (k < 0.3) { p.eyes = 'squint'; p.mouth = 'flat'; p.blush = true; p.xf = { sy: 0.92, sx: 1.06, ox: Math.floor(at * 20) % 2 ? 1 : 0 }; p.ear = -1; return; }
        if (k < 0.6) { const h = rocketH(k); p.eyes = 'wide'; p.mouth = 'o'; p.ear = 1; p.tail = 'up'; p.xf = { oy: -Math.round(h), sy: k < 0.42 ? 1.06 : 1, sx: k < 0.42 ? 0.96 : 1 }; return; }
        if (k < 0.66) { p.eyes = 'squint'; p.mouth = 'o'; p.xf = { sx: 1.1, sy: 0.9 }; return; }
        p.eyes = 'side'; p.sideDir = Math.floor(at * 2) % 2 ? 1 : -1; p.mouth = 'o'; p.sweat = true; p.tail = 'slow';
      },
      step(r, k, at, dt, a) {
        const h = rocketH(k);
        if (once(r, 'p', k > 0.3)) {
          txt(r, 'PUUU!', r.scr(a.hx) + 3, GROUND - 22, '#c4dc7a', 1, -2);
          for (let i = 0; i < 6; i++) r.emit({ type: 'puff', x: r.scr(a.hx) + rand(-6, 6), y: GROUND - 1, vx: rand(-14, 14), vy: rand(-3, 0), life: 0.9, c: GREEN_L });
        }
        if (k > 0.3 && k < 0.5 && every(r, 'j', at, 0.04)) r.emit({ type: 'puff', x: r.scr(a.hx) + rand(-3, 3), y: GROUND + 1 - h, vx: rand(-4, 4), vy: 10, life: 0.55, c: Math.random() < 0.5 ? GREEN_L : GREEN });
        if (once(r, 'd', k > 0.6)) for (let i = 0; i < 4; i++) r.emit({ type: 'dust', x: r.scr(a.hx) + rand(-8, 8), y: GROUND, vx: rand(-8, 8), life: 0.4 });
        if (k > 0.68 && every(r, 'n', at, 0.45)) r.emit({ type: 'note', x: r.scr(a.fx + 4), y: a.my - 4, vx: 4, vy: -6, life: 0.8 });
      },
    },
    soul: {
      // 영혼 가출 — 너무 지쳐서 멍… 몸에서 고양이와 똑같이 생긴 반투명 분신이 천사 고리를 달고 둥실 떠오른다.
      // 몸은 잿빛, 분신이 쏙 내려와 합쳐지면 퍼뜩 "!" (2026-10-10 디자인 개선: 5칸짜리 영혼이 작고 금방 흐려지던 걸)
      len: 3.8,
      pose(p, k) { soulPose(p, k); },
      step(r, k, at, dt, a) {
        const up = soulUp(k);
        if (k > 0.14 && k < 0.84) tintUnder(r, '#8f99a6', 0.62 * Math.min(1, seg(k, 0.14, 0.24)));
        if (k > 0.14 && k < 0.84 && up > 0.02) {
          const rise = Math.round(up * 15 + (up > 0.95 ? Math.sin(at * 3) : 0));
          const dx = Math.round(Math.sin(at * 2.4) * 2 * up);
          // 분신 → 몸 사이 영혼 꼬리
          for (let i = 0; i < rise; i++) dot(r, r.scr(a.hx) + Math.round(Math.sin(i * 0.8 + at * 5) * 1 + (dx * i) / Math.max(1, rise)), a.top - 1 - i + 2, 'rgba(190,215,240,0.8)');
          r.emit({ type: 'clone', dx, dy: -rise, a: 0.72, perFrame: true, fade: false });
          // 천사 고리
          if (up > 0.5) spr(r, ['.YYYYY.', 'Y.....Y', '.YYYYY.'], r.scr(a.hx) - 3 + dx, a.earTop - rise - 4, { Y: '#ffd35c' });
        }
        if (once(r, 'w', k > 0.84)) { txt(r, '!', r.scr(a.hx + 6), a.top - 9, '#ffd35c', 0.6, -4); for (let i = 0; i < 4; i++) r.emit({ type: 'spark', x: r.scr(a.hx + rand(-6, 6)), y: a.top + rand(-3, 2), life: 0.3 }); }
        if (once(r, 'h', k > 0.16)) txt(r, 'HUU', r.scr(a.hx) - 5, a.top - 6, '#c9d6e3', 0.8, -3);
      },
    },
    workout: {
      // 헬스 — 아령을 머리 위로 번쩍번쩍. 땀 뻘뻘, 마지막엔 부들부들
      len: 3.6, loop: true,
      pose(p, k, at) {
        const rep = (Math.sin(at * 7) + 1) / 2;
        p.liftUp = rep;
        p.armL = p.armR = 'lift';
        p.eyes = rep > 0.6 ? 'squint' : 'open';
        p.mouth = rep > 0.6 ? 'wavy' : 'flat';
        p.sweat = true;
        p.brow = 'angry';
        if (k > 0.8) p.xf = { ox: Math.sin(at * 40) * 0.6 };
      },
      front(g, a, k, at, c) {
        const y = Math.round(a.top - 1 - ((Math.sin(at * 7) + 1) / 2) * 4) - 1;
        for (let x = a.hx - 7; x <= a.hx + 7; x++) this.px(x, y, '#8a93a3');
        for (const x of [a.hx - 9, a.hx + 8]) { this.rect(x, y - 2, 2, 5, '#3a3f4b'); this.px(x, y - 2, '#6b7280'); }
      },
    },

    // ================= 상점 B급 (2차) =================
    smoke: {
      // 담배 한 대 — 고단한 하루… 앞발로 담배를 들고 깊~게 들이마신 뒤 후우 연기를 내뿜으며 먼 산을 본다
      len: 5.2, loop: true,
      pose(p, k) {
        p.armR = 'kiss';
        if (k < 0.3) { p.eyes = 'closed'; p.mouth = 'none'; p.xf = { sy: 1 + 0.05 * seg(k, 0, 0.3), sx: 1 + 0.03 * seg(k, 0, 0.3) }; p.ear = -1; }
        else if (k < 0.38) { p.eyes = 'closed'; p.mouth = 'none'; p.xf = { sy: 1.05, sx: 1.03 }; }
        else if (k < 0.75) { p.eyes = 'half'; p.mouth = 'o'; p.lookX = 1; p.brow = 'sad'; p.armR = 'rest'; }
        else { p.eyes = 'half'; p.mouth = 'flat'; p.lookX = 1; p.brow = 'sad'; }
        p.tail = 'slow';
      },
      front(g, a, k) {
        if (k >= 0.38 && k < 0.75) return; // 내뿜을 땐 손을 내린다
        const glow = k < 0.3 && Math.floor(k * 40) % 2 ? '#ffe27a' : '#ff6a2c';
        this.pattern(CIG, a.fx + 1, a.my + 1, { W: '#fffaf3', o: glow });
        this.px(a.fx + 1, a.my + 1, '#d9b27a');
      },
      step(r, k, at, dt, a) {
        if (k < 0.3 && every(r, 'wisp', at, 0.35)) r.emit({ type: 'puff', x: r.scr(a.fx + 7), y: a.my - 1, vy: -5, vx: 1, life: 1.2, c: 'rgba(210,210,210,0.6)' });
        if (k > 0.38 && k < 0.7 && every(r, 'out', at, 0.09)) r.emit({ type: 'puff', x: r.scr(a.fx + 2), y: a.my + 1, vx: r.facing * rand(10, 18), vy: rand(-6, -2), life: 1.6, c: 'rgba(225,225,225,0.85)' });
        if (once(r, 'ring', k > 0.55)) r.emit({ type: 'ring', x: r.scr(a.fx + 6), y: a.my - 3, vx: r.facing * 7, vy: -5, r: 2, grow: 3, life: 1.6 });
        if (once(r, 'sigh', k > 0.75)) r.emit({ type: 'text', s: 'HOO...', x: r.scr(a.hx) + 2, y: a.top - 10, vy: -2, life: 1.4, c: '#e9e4dc' });
      },
    },

    dealwithit: {
      // 선글라스 착 — 하늘에서 선글라스가 천천히 내려와 얼굴에 착. 입꼬리 씩 — 쿨함 그 자체
      len: 4, reveal: 0.46, loop: true,
      pose(p, k) {
        p.eyes = k < 0.45 ? 'open' : 'none';
        p.mouth = k > 0.5 ? 'grin' : 'flat';
        p.tail = k > 0.5 ? 'wag' : 'idle';
        if (k > 0.45 && k < 0.52) p.xf = { sy: 0.94, sx: 1.04 };
      },
      front(g, a, k) {
        const y = Math.round(-6 + (a.ey - 1 + 6) * ease(seg(k, 0.05, 0.45)));
        this.pattern(SHADES, a.eyeL - 2, y, { k: '#1f1c1b', H: '#ffffff' });
      },
      step(r, k) {
        if (once(r, 'c', k > 0.5)) r.emit({ type: 'text', s: 'COOL', x: 16, y: 5, vy: -1, life: 1.6, c: '#9fe3c8' });
        if (once(r, 's', k > 0.47)) r.emit({ type: 'spark', x: r.scr(28), y: 36, vy: -4, life: 0.6 });
      },
    },

    karaoke: {
      // 노래방 열창 — 핀 조명 아래 마이크 꽉 쥐고 고음 발사. 눈 질끈, 하트가 날린다
      len: 4, loop: true,
      pose(p, k, at) {
        p.armR = 'kiss';
        p.eyes = 'closed';
        p.mouth = k > 0.55 ? 'big' : Math.floor(at * 3) % 2 ? 'open' : 'o';
        p.brow = k > 0.55 ? 'sad' : null;
        p.dy = k > 0.55 ? -1 : 0;
        p.xf = k > 0.55 ? { ox: Math.sin(at * 30) * 0.5 } : null;
        p.tail = 'wag';
      },
      back(g, a) {
        for (let y = 0; y <= GROUND; y++) {
          const w = Math.round(2 + y * 0.28);
          for (let x = a.hx - w; x <= a.hx + w; x++) this.px(x, y, 'rgba(255,240,170,0.28)', false);
        }
      },
      front(g, a, k, at, c) {
        this.pattern(['.KK.', 'KggK', 'KggK', '.KK.', '.KD.', '.KD.', '.KD.'], a.fx + 1, a.my - 1, c);
      },
      step(r, k, at, dt, a) {
        if (every(r, 'n', at, 0.3)) r.emit({ type: k > 0.55 ? 'heart' : 'note', x: r.scr(a.hx + rand(-10, 10)), y: a.top - 3, vy: -9, vx: rand(-4, 4), life: 1.1 });
      },
    },

    ninja: {
      // 닌자 변신 — 펑! 연기 속에서 복면 닌자로. 수리검 휙휙 던지고 다시 펑 하고 사라짐
      len: 4.4, reveal: 0.12, loop: true,
      pose(p, k) {
        const hidden = (k > 0.08 && k < 0.16) || k > 0.88;
        p.xf = hidden ? { sx: 0.01, sy: 0.01 } : null;
        p.noShadow = hidden;
        if (k > 0.16 && k < 0.88) { p.brow = 'angry'; p.eyes = 'open'; p.mouth = 'none'; p.armR = k > 0.4 && k < 0.7 ? 'out' : 'rest'; p.tail = 'flick'; }
      },
      front(g, a, k, at, c) {
        if (k < 0.16 || k > 0.88) return;
        // 이마 띠 + 복면 (눈만 보인다)
        this.pattern(['KKKKKKKKKKKKK'], a.hx - 6, a.top + 1, { K: '#2a2f3a' });
        this.pattern(['.K', 'KK', 'K.'], a.hx - 8, a.top + 1, { K: '#2a2f3a' });
        this.rect(a.hx - 5, a.my - 1, 11, 4, '#2a2f3a');
      },
      step(r, k, at, dt, a) {
        for (const [tag, t] of [['p1', 0.08], ['p2', 0.88]]) if (once(r, tag, k > t)) { for (let i = 0; i < 9; i++) r.emit({ type: 'puff', x: 24 + rand(-9, 9), y: 38 + rand(-6, 4), vy: -5, vx: rand(-3, 3), life: 0.8, c: '#e9e4dc' }); r.emit({ type: 'text', s: 'NIN!', x: 17, y: 12, vy: -3, life: 0.8, c: '#fff' }); }
        if (k > 0.4 && k < 0.7 && every(r, 's', at, 0.35)) r.emit({ type: 'shuriken', x: r.scr(a.hx + 9), y: a.ey, vx: r.facing * 40, life: 0.8, fade: false });
      },
    },

    rocket: {
      // 로켓 발사 — 3, 2, 1… 엉덩이에서 불을 뿜으며 하늘로 슝! 잠시 뒤 낙하산 없이 쿵 착지
      len: 5, reveal: 0.58, loop: true,
      pose(p, k, at) {
        let oy = 0;
        if (k < 0.36) { p.eyes = 'wide'; p.xf = { ox: k > 0.26 ? Math.sin(at * 50) * 0.7 : 0 }; p.sweat = true; }
        else if (k < 0.55) { oy = -60 * ease(seg(k, 0.36, 0.55)); p.eyes = 'squint'; p.mouth = 'big'; p.ear = -1; p.armL = p.armR = 'up'; }
        else if (k < 0.8) { oy = -60 * (1 - ease(seg(k, 0.62, 0.8))) ; if (k < 0.62) oy = -60; p.eyes = 'wide'; p.mouth = 'o'; p.armL = p.armR = 'cheer'; }
        else { p.xf = { sy: 1 - 0.2 * (1 - seg(k, 0.8, 0.9)), sx: 1 + 0.15 * (1 - seg(k, 0.8, 0.9)) }; p.eyes = 'x'; p.mouth = 'wavy'; }
        if (oy) p.xf = { oy: Math.round(oy) };
        p.noShadow = oy < -20;
      },
      back(g, a, k, at) {
        if (k < 0.36 || k > 0.58) return;
        for (let y = 0; y < 9; y++) {
          const w = Math.max(0, 3 - Math.floor(y / 3)) + (Math.floor(at * 20 + y) % 2);
          for (let x = a.hx - w; x <= a.hx + w; x++) this.px(x, GROUND + 1 + y, y < 2 ? '#fff4b0' : y < 5 ? '#ffb23c' : '#e8534a');
        }
      },
      step(r, k, at, dt, a) {
        for (const [i, t] of [[3, 0.02], [2, 0.12], [1, 0.22]]) if (once(r, 'c' + i, k > t)) r.emit({ type: 'text', s: String(i), x: 22, y: 8, vy: -2, life: 0.4, c: '#fff' });
        if (k > 0.36 && k < 0.5 && every(r, 'sm', at, 0.05)) r.emit({ type: 'puff', x: 24 + rand(-6, 6), y: GROUND - 1, vx: rand(-14, 14), vy: -3, life: 0.9, c: '#e9e4dc' });
        if (once(r, 'land', k > 0.8)) { r.emit({ type: 'text', s: 'THUD', x: 15, y: 20, vy: -2, life: 0.8, c: '#fff' }); for (let i = 0; i < 6; i++) r.emit({ type: 'dust', x: 24 + rand(-10, 10), y: GROUND, vx: rand(-10, 10), life: 0.5 }); }
      },
    },

    gum: {
      // 풍선껌 비행 — 풍선껌을 부풀리다 너무 커져서 풍선처럼 머리 위로 떠올라 고양이를 둥실 들어 올림… 퐁! 터지고 얼굴에 껌 범벅으로 추락
      // (7차: 풍선이 얼굴을 통째로 가려 표정이 안 보이던 걸, 커질수록 머리 위로 올라가 껌 줄로 입에 매달리게)
      len: 5, loop: true,
      pose(p, k) {
        let oy = 0;
        p.mouth = 'kiss';
        if (k < 0.22) p.eyes = 'closed';
        else if (k < 0.35) { p.eyes = 'wide'; p.ear = 1; } // 어? 풍선이 머리 위로…
        else if (k < 0.62) { oy = -18 * ease(seg(k, 0.35, 0.62)); p.eyes = k < 0.45 ? 'wide' : 'happy'; p.armL = p.armR = 'float'; p.tail = 'wag'; p.noShadow = oy < -8; }
        else if (k < 0.74) { oy = -18 * (1 - seg(k, 0.62, 0.74) ** 2); p.eyes = 'x'; p.mouth = 'o'; p.armL = p.armR = 'up'; p.ear = -1; }
        else if (k < 0.9) { p.eyes = 'x'; p.mouth = 'wavy'; p.ear = -1; p.tail = 'slow'; if (k < 0.8) p.xf = { sx: 1.15, sy: 0.86 }; }
        else { p.eyes = 'half'; p.mouth = 'flat'; p.xf = { ox: Math.round(Math.sin(k * 180) * (1 - seg(k, 0.9, 0.96))) }; } // 도리도리 털어 내고 다시 처음처럼
        if (oy) p.xf = { oy: Math.round(oy) };
      },
      front(g, a, k) {
        if (k < 0.62) {
          const rr = 1 + 6.5 * ease(seg(k, 0, 0.35));
          const rise = ease(seg(k, 0.12, 0.35)); // 입 앞 → 머리 위로
          const cx = a.fx + 0.5;
          const cy = (a.my + 0.5) + (a.top - rr - (a.my + 0.5)) * rise;
          // 입에서 풍선까지 늘어난 껌 줄
          if (rise > 0) for (let y = Math.round(cy + rr); y <= a.my; y++) this.px(a.fx, y, '#ff9bb8');
          this.shape((x, y) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= rr * rr, [cx - rr - 1, cy - rr - 1, cx + rr + 1, cy + rr + 1], () => '#ff9bb8', '#d9668b');
          this.px(Math.round(cx - rr * 0.45), Math.round(cy - rr * 0.45), '#fff', false);
        } else if (k > 0.66 && k < 0.9) {
          // 얼굴에 껌 범벅
          for (const [dx, dy] of [[-4, 0], [-3, 1], [3, -1], [4, 1], [0, 2], [1, 3], [-1, 3], [5, 0], [-2, -2], [2, -3]]) this.px(a.fx + dx, a.ey + dy, '#ff9bb8');
        }
      },
      step(r, k, at, dt, a) {
        if (once(r, 'p', k > 0.62)) { r.emit({ type: 'text', s: 'POP!', x: r.scr(a.hx) - 6, y: a.top - 14, vy: -3, life: 0.8, c: '#ff9bb8' }); for (let i = 0; i < 10; i++) r.emit({ type: 'spray', x: r.scr(a.fx), y: a.top - 6, vx: rand(-20, 20), vy: rand(-18, 4), ay: 40, life: 0.6, c: '#ff9bb8' }); }
        if (once(r, 'l', k > 0.74)) for (let i = 0; i < 5; i++) r.emit({ type: 'dust', x: 24 + rand(-10, 10), y: GROUND, vx: rand(-8, 8), life: 0.5 });
      },
    },



    explode: {
      // 스트레스 폭발 — 점점 빨개지고 귀에서 김이 푸슉… 펑! 새까맣게 탄 채 멍. 머리털이 삐죽
      len: 4.6, reveal: 0.47, loop: true,
      pose(p, k, at) {
        if (k < 0.45) { p.brow = 'angry'; p.eyes = 'squint'; p.mouth = 'wavy'; p.xf = { ox: Math.sin(at * 40) * seg(k, 0.1, 0.45), sx: 1 + 0.08 * seg(k, 0, 0.45), sy: 1 + 0.08 * seg(k, 0, 0.45) }; }
        else if (k < 0.5) { p.xf = { sx: 1.25, sy: 1.25 }; p.eyes = 'wide'; p.mouth = 'big'; }
        else { p.eyes = 'dot'; p.mouth = 'o'; p.tail = 'slow'; }
      },
      front(g, a, k) {
        if (k < 0.5) return;
        // 삐죽 선 머리털
        for (const dx of [-3, -1, 1, 3]) { this.px(a.hx + dx, a.top - 1, '#2b1a10'); this.px(a.hx + dx + (dx > 0 ? 1 : -1), a.top - 2, '#2b1a10'); }
      },
      step(r, k, at, dt, a) {
        if (k < 0.45) {
          tintUnder(r, '#ff3b3b', 0.5 * seg(k, 0, 0.45)); // 김(흰 연기)은 물들이지 않게 고양이에만
          if (k > 0.15 && every(r, 's', at, 0.15)) for (const s of [-1, 1]) r.emit({ type: 'puff', x: r.scr(a.hx + s * 5), y: a.top - 3, vy: -12, vx: s * 5, life: 0.6, c: '#ffffff' });
        } else if (k < 0.5) {
          flashCat(r, seg(k, 0.45, 0.5));
          if (once(r, 'b', true)) { r.emit({ type: 'text', s: 'BOOM', x: 15, y: 6, vy: -2, life: 1, c: '#ffd35c' }); for (let i = 0; i < 20; i++) r.emit({ type: 'confetti', x: 24, y: 36, vx: rand(-30, 30), vy: rand(-30, 0), ay: 40, life: rand(0.8, 1.4), c: CONFETTI[i % 6] }); }
        } else {
          tintUnder(r, '#2b2420', 0.55 * (1 - seg(k, 0.85, 1)));
          if (every(r, 'sm', at, 0.4)) r.emit({ type: 'puff', x: r.scr(a.hx + rand(-4, 4)), y: a.top - 3, vy: -5, life: 1, c: 'rgba(90,90,90,0.7)' });
        }
      },
    },

    ghost: {
      // 유령 코스프레 — 하얀 이불 뒤집어쓰고 둥실 떠서 BOO! 반투명하게 스르르
      len: 4, loop: true,
      pose(p, k, at) {
        p.xf = { oy: Math.round(-3 + Math.sin(at * 3) * 2) };
        p.noTail = true;
        p.eyes = 'none';
        p.mouth = 'none';
      },
      front(g, a, k, at, c) {
        const T = a.earTop - 2;
        for (let y = T; y <= GROUND; y++) {
          const w = y < T + 3 ? 5 + (y - T) * 1 : 8;
          for (let x = a.hx - w; x <= a.hx + w; x++) {
            const hem = y === GROUND && (x + Math.floor(at * 6)) % 3 === 0;
            if (hem) continue;
            const edge = x === a.hx - w || x === a.hx + w || y === T;
            this.px(x, y, edge ? '#9fb3c4' : '#fbfdff');
          }
        }
        this.rect(a.eyeL, a.ey, 2, 2, '#2b1a10');
        this.rect(a.eyeR, a.ey, 2, 2, '#2b1a10');
        if (k > 0.4 && k < 0.7) this.rect(a.fx - 1, a.my + 1, 3, 3, '#2b1a10');
      },
      step(r, k, at) {
        tintUnder(r, '#000', 0.25 + 0.15 * Math.sin(at * 3), 'destination-out'); // BOO! 글자는 또렷하게, 유령만 반투명
        if (once(r, 'b', k > 0.4)) r.emit({ type: 'text', s: 'BOO!', x: 16, y: 6, vy: -2, life: 1, c: '#fff' });
      },
    },


    // ================= 상점 B급 (3차) =================
    soju: {
      // 소주 한 잔 — 초록 병 옆에 두고 소주 한 잔 원샷, 크으~! 얼굴 발그레해져서 비틀비틀 딸꾹
      len: 5.4, loop: true,
      pose(p, k, at) {
        if (k < 0.22) { p.armR = 'hold'; p.eyes = 'open'; p.lookX = 1; }
        else if (k < 0.4) { p.armR = 'kiss'; p.eyes = 'closed'; p.mouth = 'none'; p.lookY = -1; p.xf = { rot: -0.07 * ease(seg(k, 0.22, 0.28)), py: GROUND }; } // 고개를 젖혀 원샷 (크게 돌리면 도트가 깨져서 살짝만)
        else if (k < 0.55) { p.eyes = 'squint'; p.mouth = 'big'; p.xf = { ox: Math.sin(at * 40) * 0.6 }; p.ear = -1; }
        else { p.eyes = Math.floor(at * 1.5) % 2 ? 'half' : 'happy'; p.mouth = 'wavy'; p.blush = true; p.xf = { ox: Math.round(Math.sin(at * 2.2) * 1.5), rot: Math.sin(at * 2.2) * 0.05, py: GROUND }; p.tail = 'slow'; } // 비틀비틀: 옆으로 흔들리며 살짝 기운다
      },
      front(g, a, k, at, c) {
        this.pattern(BOTTLE, a.hx + 9, GROUND - 6, c);
        if (k < 0.22) this.pattern(SHOT, a.fx + 3, a.my + 1, c);
        else if (k < 0.4) this.pattern(SHOT, a.fx + 1, a.my - 1, c);
      },
      step(r, k, at, dt, a) {
        if (once(r, 'k', k > 0.4)) r.emit({ type: 'text', s: 'KHAA!', x: r.scr(a.hx) - 7, y: a.top - 10, vy: -2, life: 1, c: '#fff' });
        if (k > 0.55) {
          tintUnder(r, '#ff5a5a', 0.14);
          if (every(r, 'h', at, 1.1)) { r.emit({ type: 'text', s: 'HIC', x: r.scr(a.hx) + 4, y: a.top - 7, vy: -5, life: 0.8, c: '#fff' }); r.emit({ type: 'bubble', x: r.scr(a.fx + 3), y: a.my - 2, vy: -8, r: 1.4, life: 1 }); }
        }
      },
    },

    skullsmoke: {
      // 해골 연기 — 담배를 깊게 빨고… 후우 내뿜은 연기가 해골 모양이 되어 둥실. 본인은 씩 웃는다
      len: 5.6, loop: true,
      pose(p, k) {
        p.armR = k < 0.35 ? 'kiss' : 'rest';
        if (k < 0.35) { p.eyes = 'closed'; p.mouth = 'none'; p.xf = { sy: 1 + 0.05 * seg(k, 0, 0.35), sx: 1 + 0.03 * seg(k, 0, 0.35) }; }
        else if (k < 0.55) { p.eyes = 'half'; p.mouth = 'o'; }
        else { p.eyes = 'half'; p.brow = 'angry'; p.mouth = 'grin'; p.tail = 'flick'; }
      },
      front(g, a, k) {
        if (k >= 0.35) return;
        const glow = Math.floor(k * 40) % 2 ? '#ffe27a' : '#ff6a2c';
        this.pattern(CIG, a.fx + 1, a.my + 1, { W: '#fffaf3', o: glow });
      },
      step(r, k, at, dt, a) {
        if (k > 0.35 && k < 0.5 && every(r, 'p', at, 0.08)) r.emit({ type: 'puff', x: r.scr(a.fx + 2), y: a.my, vx: r.facing * rand(4, 9), vy: -8, life: 0.9, c: 'rgba(225,225,225,0.8)' });
        if (once(r, 's', k > 0.45)) r.emit({ type: 'skull', x: r.scr(a.hx + 6), y: a.top - 8, vx: r.facing * 2, vy: -3, life: 2.6 });
        if (once(r, 'h', k > 0.6)) r.emit({ type: 'text', s: 'HEH', x: r.scr(a.hx) - 14, y: a.top - 4, vy: -2, life: 1.2, c: '#fff' });
      },
    },

    codeflame: {
      // 코딩 불꽃 — Claude가 일하는 동안 등 뒤로 불꽃이 활활. 눈엔 별, 앞발은 초고속 타자. 일할 때 자리에 딱
      len: 3, loop: true,
      pose(p, k, at) {
        p.prop = 'laptop';
        p.armL = p.armR = 'typefast';
        p.eyes = 'star';
        p.brow = 'angry';
        p.mouth = 'grin';
        p.dy = -3;
        p.tail = 'flick';
      },
      back(g, a, k, at) {
        for (let x = a.hx - 14; x <= a.hx + 14; x++) {
          const h = Math.max(0, Math.round(21 - Math.abs(x - a.hx) * 0.8 + Math.sin(at * 13 + x * 1.9) * 3));
          for (let i = 0; i < h; i++) {
            const f = i / h;
            this.px(x, GROUND - i, f > 0.8 ? '#fff1a8' : f > 0.5 ? '#ffb23c' : f > 0.25 ? '#ff7a2c' : '#e8434a');
          }
        }
      },
      step(r, k, at, dt, a) {
        if (every(r, 'e', at, 0.06)) r.emit({ type: 'ember', x: r.scr(a.hx + rand(-13, 13)), y: GROUND - 14, vy: -18, vx: rand(-4, 4), life: 0.9 });
        if (every(r, 'c', at, 0.4)) r.emit({ type: 'char', s: '#;:+%'[Math.floor(rand(0, 5))], x: r.scr(a.hx + rand(-12, 10)), y: 12, vy: -8, life: 0.8, c: '#ffe9a8' });
      },
    },

    spider: {
      // 스파이더냥 — 빨간 복면 쓰고 천장에 거미줄 쭉! 화면을 이리저리 그네 타듯 날아다니다 착지 포즈
      len: 6, loop: true,
      pose(p, k, at, r) {
        const swing = k > 0.15 && k < 0.85;
        const ang = swing ? Math.sin(seg(k, 0.15, 0.85) * Math.PI * 3) * 0.75 : 0;
        r.ms.ang = ang;
        r.ms.lift = swing ? 10 : k < 0.15 ? 0 : 10 * (1 - seg(k, 0.85, 0.92));
        p.xf = { px: 24, py: 2, rot: ang, oy: -Math.round(r.ms.lift) };
        p.noShadow = swing;
        p.eyes = 'none';
        p.armR = k < 0.15 || swing ? 'point' : 'rest';
        p.armL = swing ? 'up' : 'rest';
        p.tail = 'up';
        if (k > 0.9) { p.armL = p.armR = 'cheer'; }
      },
      front(g, a, k, at, c) {
        // 빨간 복면 + 흰 눈 + 거미줄 무늬
        for (let y = a.top + 1; y <= a.my + 2; y++) for (let x = a.hx - 5; x <= a.hx + 5; x++) this.px(x, y, (x + y) % 4 === 0 ? '#8a1e18' : '#e8342a');
        this.pattern(['KWWK', 'KWWK', '.KK.'], a.eyeL - 1, a.ey - 1, { K: c.K, W: '#fff' });
        this.pattern(['KWWK', 'KWWK', '.KK.'], a.eyeR - 1, a.ey - 1, { K: c.K, W: '#fff' });
      },
      step(r, k, at, dt, a) {
        // 거미줄: 천장 한 점 → 머리 위 (몸이 돈 만큼 같이 돌린다)
        const ang = r.ms.ang || 0;
        const hx = r.scr(a.hx + 5) - 24;
        const hy = a.top - 2 - 2 - (r.ms.lift || 0);
        const x2 = 24 + hx * Math.cos(ang) - hy * Math.sin(ang);
        const y2 = 2 + hx * Math.sin(ang) + hy * Math.cos(ang);
        if (k < 0.15) {
          const t = seg(k, 0.03, 0.12);
          if (t > 0) r.emit({ type: 'seg', x: x2, y: y2, x2: x2 + (24 - x2) * t, y2: y2 + (-2 - y2) * t, perFrame: true, fade: false });
        } else if (k < 0.88) r.emit({ type: 'seg', x: 24, y: -2, x2, y2, perFrame: true, fade: false });
        if (once(r, 'tw', k > 0.04)) r.emit({ type: 'text', s: 'THWIP', x: 14, y: 4, vy: -2, life: 0.8, c: '#fff' });
        if (k > 0.2 && k < 0.8 && every(r, 'w', at, 0.18)) r.emit({ type: 'line', x: x2 - 8, y: y2 + 12 + rand(-4, 4), len: 4, life: 0.2 });
        if (once(r, 'l', k > 0.9)) for (let i = 0; i < 5; i++) r.emit({ type: 'dust', x: 24 + rand(-10, 10), y: GROUND, vx: rand(-8, 8), life: 0.5 });
      },
    },



    lightning: {
      // 번개 맞음 — 머리 위 먹구름에서 번쩍! 번개에 맞아 뼈가 보였다가, 새까맣게 탄 뽀글머리로 멍
      len: 4.6, reveal: 0.4, loop: true,
      pose(p, k) {
        if (k < 0.3) { p.eyes = 'side'; p.sideDir = Math.floor(k * 20) % 2 ? 1 : -1; p.sweat = true; p.lookY = -1; }
        else if (k < 0.45) { p.eyes = 'wide'; p.mouth = 'big'; p.armL = p.armR = 'up'; p.xf = { ox: Math.floor(k * 200) % 2 ? 1 : -1 }; }
        else { p.eyes = 'dot'; p.mouth = 'o'; p.ear = -1; p.tail = 'slow'; }
      },
      front(g, a, k, at, c) {
        if (k < 0.45) this.pattern(['...KKK.KKK...', '..KDDDKDDDK..', '.KDgDDDDDgDK.', 'KDDDDDgDDDDDK', '.KKKKKKKKKKK.'], a.hx - 6, a.top - 13, c);
        if (k > 0.45) for (const [dx, dy] of [[-4, -1], [-2, -2], [0, -3], [2, -2], [4, -1], [-3, -3], [3, -3], [-1, -4], [1, -4], [-5, 0], [5, 0]]) this.px(a.hx + dx, a.top + dy, '#2b1a10');
      },
      step(r, k, at, dt, a) {
        // 번개는 먹구름 밑에서 정수리까지만 (7차: 캔버스 꼭대기부터 내려오며 구름을 뚫고, 까만 tint 에 번개·글자까지 물들던 걸 고쳤다)
        if (k > 0.3 && k < 0.45) {
          if (k < 0.34) flashCat(r, seg(k, 0.3, 0.34));
          else { tintUnder(r, '#1a1210', 0.85); r.emit({ type: 'skel', x: r.scr(a.hx), y: a.top + 1, perFrame: true, fade: false }); }
          const zig = Math.floor(at * 20) % 2;
          r.emit({ type: 'sprite', rows: zig ? ['.WY.', 'WY..', '.WY.', '..WY', '.WY.', 'WY..', '.WY.', '..W.'] : ['..WY', '.WY.', 'WY..', '.WY.', '..WY', '.WY.', 'WY..', '.W..'], map: { W: '#fffbd0', Y: '#ffd35c' }, x: r.scr(a.hx) - 2, y: a.top - 8, perFrame: true, fade: false });
        }
        if (once(r, 'z', k > 0.3)) r.emit({ type: 'text', s: 'ZZAP', x: 15, y: 20, vy: -2, life: 0.8, c: '#ffd35c' });
        if (k > 0.45) {
          tintUnder(r, '#2b2420', 0.5 * (1 - seg(k, 0.85, 1)));
          if (every(r, 's', at, 0.35)) r.emit({ type: 'puff', x: r.scr(a.hx + rand(-4, 4)), y: a.top - 5, vy: -5, life: 1, c: 'rgba(90,90,90,0.7)' });
        }
      },
    },

    bubbleplay: {
      // 비눗방울 놀이 — 비눗방울 막대를 후~ 불면 방울이 둥실둥실. 앞발로 톡톡 터뜨리며 신남
      len: 4.4, loop: true,
      pose(p, k, at) {
        if (k < 0.45) { p.armR = 'kiss'; p.eyes = 'closed'; p.mouth = 'o'; }
        else { p.armL = p.armR = Math.floor(at * 4) % 2 ? 'up' : 'cheer'; p.eyes = 'happy'; p.mouth = 'open'; p.dy = Math.floor(at * 4) % 2 ? -1 : 0; p.tail = 'wag'; }
      },
      front(g, a, k) {
        if (k < 0.45) this.pattern(['.KK.', 'K..K', '.KK.', '..K.', '..K.'], a.fx + 2, a.my - 3, { K: '#b784f5' });
      },
      step(r, k, at, dt, a) {
        if (k < 0.45 && every(r, 'b', at, 0.18)) r.emit({ type: 'bubble', x: r.scr(a.fx + 5), y: a.my - 3, vx: r.facing * rand(6, 14), vy: rand(-8, -2), r: rand(1.2, 2.4), life: 2.2 });
        if (k > 0.5 && every(r, 'p', at, 0.5)) r.emit({ type: 'text', s: 'POP', x: r.scr(a.hx + rand(-10, 6)), y: a.top - 8, vy: -4, life: 0.4, c: '#bfe6ff' });
      },
    },

    ufo: {
      // UFO 납치 — 하늘에서 UFO가 내려와 초록 빛을 쏜다. 고양이가 빙글빙글 빨려 올라갔다가… 퉤 뱉어짐
      len: 5.4, loop: true,
      pose(p, k, at) {
        let oy = 0;
        let rot = 0;
        if (k < 0.25) { p.eyes = 'wide'; p.lookY = -1; p.sweat = k > 0.12; }
        else if (k < 0.55) { const s = ease(seg(k, 0.3, 0.55)); oy = -26 * s; rot = at * 4 * s; p.eyes = 'x'; p.mouth = 'o'; p.armL = p.armR = 'up'; }
        else if (k < 0.72) { oy = -60; }
        else if (k < 0.82) { oy = -60 + 60 * ease(seg(k, 0.72, 0.82)); p.eyes = 'x'; p.mouth = 'big'; }
        else { p.eyes = 'dot'; p.mouth = 'flat'; p.xf = { sy: 0.9 + 0.1 * seg(k, 0.82, 0.9), sx: 1.08 - 0.08 * seg(k, 0.82, 0.9) }; }
        if (oy) { p.xf = { oy: Math.round(oy), rot, px: 24, py: 38 }; p.noShadow = true; }
      },
      step(r, k, at, dt, a) {
        const uy = k < 0.15 ? -8 + 12 * seg(k, 0, 0.15) : k < 0.62 ? 4 : 4 - 20 * seg(k, 0.62, 0.72);
        if (k < 0.72) r.emit({ type: 'ufo', x: 24, y: uy, perFrame: true, fade: false });
        if (k > 0.15 && k < 0.58) r.emit({ type: 'beam', x: 24, y: uy + 6, perFrame: true, fade: false });
        if (once(r, 'p', k > 0.82)) { r.emit({ type: 'text', s: 'PTOO', x: 15, y: 10, vy: -2, life: 0.8, c: '#b7e3a8' }); for (let i = 0; i < 5; i++) r.emit({ type: 'dust', x: 24 + rand(-10, 10), y: GROUND, vx: rand(-8, 8), life: 0.5 }); }
      },
    },
  };

  Object.assign(root.PetSprite.MOTIONS, M);
})(window);
