// 펫 판: 고양이 그리기 · 말풍선(학습 패널) · 카드 · 가리키기 · 물고 가기 · 마우스.
// 고양이는 강사라 제멋대로 돌아다니지 않는다. 수업(goto · carry)이 시키거나 사용자가 들어 옮길 때만 움직인다.
const canvas = document.getElementById('pet');
const bubbleEl = document.getElementById('bubble');
const cardEl = document.getElementById('card');
const pointEl = document.getElementById('point');
const replayEl = document.getElementById('replay');
const fieldEl = document.getElementById('field');
const fctx = fieldEl.getContext('2d');
const sprite = new PetSprite.PetRenderer(canvas);
const T = new I18N.Strings();

let scale = 5;
let soundOn = true;
let mood = 'idle'; // idle · wait(사용자 차례) · busy(요리 중) · sleep
let idlePool = ['stretch', 'loaf', 'lick', 'slowblink'];
let idleTurn = 0;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (v) => String(v).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const rand = (a, b) => a + Math.random() * (b - a);
// **굵게** · `코드` 만 받는 작은 마크다운
const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
const plain = (s) => String(s).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');

// ---------- 설정 ----------

function applyScale() {
  const px = Math.round(PetSprite.GRID * scale);
  canvas.style.width = `${px}px`;
  canvas.style.height = `${px}px`;
  placeCat();
  placeOverlays();
}

pet.onConfig((c) => {
  scale = c.scale || 5;
  soundOn = c.sound !== false;
  T.set(c.language);
  document.documentElement.lang = T.locale;
  sprite.setFur(c.fur || 'cheese');
  sprite.setEars(c.ears || 'perk');
  sprite.setAccessory('none');
  applyScale();
  if (catX == null) {
    catX = c.startX != null ? c.startX : homeX();
    placeCat();
  }
});

pet.onReset(() => {
  catX = homeX();
  catLift = 0;
  catVy = 0;
  sprite.setMove(0);
  placeCat();
});

pet.onAction((a) => {
  if (dragging || lifted) return;
  sprite.play(a);
});
pet.onSound((s) => soundOn && PetSound.play(s));

// ---------- 기분 ----------

function applyMood() {
  if (mood === 'sleep') {
    sprite.setMood('sleeping');
    sprite.setToyPose(null);
  } else if (mood === 'busy') {
    sprite.setMood('idle');
    if (!prop) sprite.setToyPose('ttype');
  } else {
    sprite.setMood('idle');
    if (!prop) sprite.setToyPose(null);
  }
  sprite.setMove(0);
}
pet.onMood((m) => {
  mood = m || 'idle';
  if (mood === 'sleep' && sprite.action) sprite.cancel();
  applyMood();
});

let prop = null;
pet.onProp(({ key, on }) => {
  // '*' 끄기: 걸어 둔 자세를 전부 내린다 (수업이 중간에 멈출 때)
  if (key === '*') {
    prop = null;
    sprite.setToyPose(mood === 'busy' ? 'ttype' : null);
    return;
  }
  const k = 't' + key;
  if (on && PetSprite.MOTIONS[k]) {
    prop = k;
    sprite.setToyPose(k);
  } else if (!on && prop === k) {
    prop = null;
    sprite.setToyPose(mood === 'busy' ? 'ttype' : null);
  }
});

// ---------- 인포그래픽 ----------
// 호스트가 { kind, labels: [...] } 로 보낸다. 글은 전부 labels 에서 (언어는 호스트가 고른다)

function figureHtml(f) {
  if (!f || !f.kind) return '';
  const L = (i) => esc((f.labels || [])[i] || '');
  switch (f.kind) {
    // 방 세 개: raw(나) → wiki(AI) + 규칙
    case 'rooms':
      return `<div class="fig-row">
        <div class="fig-box me"><span class="ico">📥</span><span class="name">raw/</span><span class="sub">${L(0)}</span></div>
        <div class="fig-arrow">→</div>
        <div class="fig-box ai"><span class="ico">📚</span><span class="name">wiki/</span><span class="sub">${L(1)}</span></div>
        <div class="fig-box"><span class="ico">📋</span><span class="name">AGENTS.md</span><span class="sub">${L(2)}</span></div>
      </div><div class="fig-note">${L(3)}</div>`;
    // ingest: 재료 하나 → 쪽 여럿
    case 'ingest':
      return `<div class="fig-row">
        <div class="fig-box me"><span class="ico">📄</span><span class="name">${L(0)}</span><span class="sub">raw/</span></div>
        <div class="fig-arrow">→</div>
        <div class="fig-box ai"><span class="ico">📝</span><span class="name">${L(1)}</span></div>
        <div class="fig-box ai"><span class="ico">💡</span><span class="name">${L(2)}</span></div>
        <div class="fig-box ai"><span class="ico">📋</span><span class="name">${L(3)}</span></div>
        <div class="fig-box ai"><span class="ico">🧾</span><span class="name">${L(4)}</span></div>
      </div><div class="fig-note">${L(5)}</div>`;
    // 동작 셋
    case 'ops':
      return `<div class="fig-row">
        <div class="fig-box ai"><span class="ico">🍳</span><span class="name">ingest</span><span class="sub">${L(0)}</span></div>
        <div class="fig-box ai"><span class="ico">❓</span><span class="name">query</span><span class="sub">${L(1)}</span></div>
        <div class="fig-box ai"><span class="ico">🧹</span><span class="name">lint</span><span class="sub">${L(2)}</span></div>
      </div>`;
    // 마크다운 입력 → 결과
    case 'markdown':
      return `<div class="fig-md">
        <code># ${L(0)}</code><span class="arrow">→</span><span class="out h">${L(0)}</span>
        <code>- ${L(1)}</code><span class="arrow">→</span><span class="out li">${L(1)}</span>
        <code>**${L(2)}**</code><span class="arrow">→</span><span class="out b"><b>${L(2)}</b></span>
        <code>[[${L(3)}]]</code><span class="arrow">→</span><span class="out" style="color:var(--accent2);text-decoration:underline">${L(3)}</span>
      </div>`;
    // 종이 두 장 사이 실
    case 'links':
      return `<div class="fig-link"><span class="sheet">${L(0)}</span><span class="thread"></span><span class="sheet">${L(1)}</span></div><div class="fig-note">${L(2)}</div>`;
    // 매일 순환
    case 'loop':
      return `<div class="fig-loop"><span class="step">${L(0)}</span><span>→</span><span class="step ai">${L(1)}</span><span>→</span><span class="step">${L(2)}</span><span>↺</span></div><div class="fig-note">${L(3)}</div>`;
    // 나 / AI 역할
    case 'roles':
      return `<div class="fig-row">
        <div class="fig-box me"><span class="ico">🙂</span><span class="name">${L(0)}</span><span class="sub">${L(1)}</span></div>
        <div class="fig-box ai"><span class="ico">🤖</span><span class="name">${L(2)}</span><span class="sub">${L(3)}</span></div>
      </div>`;
    default:
      return '';
  }
}

// ---------- 말풍선 ----------
// 수업 말은 사용자가 넘길 때까지 그대로 있다 (충분히 읽게).
// 넘기기: 말풍선 아무 데나 한 번 클릭(우측 하단 "다음 →" 포함). 되돌아보기: 좌측 하단 "← 이전" 만.
// 'status'(쓰는 중… 같은 진행 표시)만 ms 뒤에 저절로 사라진다.

const queue = [];
let current = null; // 엔진이 끝나기를 기다리는 말
let hideTimer = null;
let typeTimer = null;
const past = []; // 보여 준 수업 말 (이전 · 다시 보기). current 도 같은 객체로 들어 있다
let viewAt = null; // 지난 말을 보는 중이면 past 의 번호
let lastNav = 0;
const navEl = bubbleEl.querySelector('.nav');
const prevEl = bubbleEl.querySelector('.prev');
const nextEl = bubbleEl.querySelector('.next');

pet.onBubble((b) => {
  if (b.kind === 'notify') queue.unshift(b);
  else queue.push(b);
  if (!current) nextBubble();
});
pet.onBubbleClear(() => {
  queue.length = 0;
  if (viewAt != null) applyPoint(livePoint);
  viewAt = null;
  if (current) {
    current = null;
    nextBubble();
  } else if (!bubbleEl.hidden) hideBubble();
});

function endBubble(reason) {
  if (!current) return;
  const c = current;
  current = null;
  if (c.id) pet.bubbleEnd(c.id, reason);
}

function hideBubble() {
  clearTimeout(hideTimer);
  clearInterval(typeTimer);
  typeTimer = null;
  bubbleEl.classList.remove('show');
  setTimeout(() => !current && viewAt == null && (bubbleEl.hidden = true), 150);
}

function nextBubble() {
  clearTimeout(hideTimer);
  clearInterval(typeTimer);
  typeTimer = null;
  viewAt = null;
  current = queue.shift() || null;
  if (!current) return hideBubble();
  if (current.kind === 'lesson' || current.kind === 'cheer') {
    current.point = livePoint;
    past.push(current);
    if (past.length > 80) past.shift();
  }
  if (current.kind === 'notify' && !sprite.action) sprite.play('perk');
  show(current, true);
  if (soundOn) PetSound.play('pop', 0.015);
  if (current.kind === 'status') {
    hideTimer = setTimeout(() => {
      endBubble('auto');
      bubbleEl.classList.remove('show');
      hideTimer = setTimeout(nextBubble, 220);
    }, current.ms > 0 ? current.ms : 1500);
  }
}

// b 를 그린다. type: 한 글자씩 쳐 가며 (처음 보여 줄 때만)
function show(b, type) {
  clearInterval(typeTimer);
  typeTimer = null;
  const live = b === current;
  const textEl = bubbleEl.querySelector('.text');
  bubbleEl.className = 'bubble show' + (b.kind === 'cheer' ? ' cheer' : '') + (live ? '' : ' past');
  if (type) bubbleEl.classList.remove('show');
  bubbleEl.querySelector('.title').textContent = b.title || '';
  bubbleEl.querySelector('.figure').innerHTML = figureHtml(b.figure);
  const choices = bubbleEl.querySelector('.choices');
  choices.innerHTML = '';
  if (live && b.ask && Array.isArray(b.choices)) {
    b.choices.slice(0, 2).forEach((label, i) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!current || !current.ask) return;
        pet.bubbleReply(current.ask, i);
        current = null;
        nextBubble();
      });
      choices.appendChild(btn);
    });
  }
  const at = past.lastIndexOf(b);
  const status = b.kind === 'status';
  prevEl.textContent = !status && (at > 0 || (at < 0 && past.length)) ? T.t('pet.prev') : '';
  nextEl.textContent = status || (live && b.ask) ? '' : T.t('pet.next');
  nextEl.title = T.t('pet.nextTip');
  navEl.hidden = !prevEl.textContent && !nextEl.textContent;
  bubbleEl.hidden = false;
  replayEl.hidden = true;
  applyPoint(live || !past.includes(b) ? livePoint : b.point || null);

  const full = String(b.text || '');
  const chars = [...plain(full)];
  let i = 0;
  if (!type) {
    textEl.innerHTML = inline(full);
    placeOverlays();
    return;
  }
  textEl.textContent = '';
  placeOverlays();
  requestAnimationFrame(() => bubbleEl.classList.add('show'));
  typeTimer = setInterval(() => {
    textEl.textContent = chars.slice(0, ++i).join('');
    if (i >= chars.length) {
      clearInterval(typeTimer);
      typeTimer = null;
      textEl.innerHTML = inline(full);
    }
    placeOverlays();
  }, 24);
}

// 빨리 두 번 눌러(더블클릭 포함) 두 칸 넘어가지 않게 잠깐 막는다
function navOk() {
  const now = performance.now();
  if (now - lastNav < 400) return false;
  lastNav = now;
  return true;
}

function goPrev() {
  let at = viewAt != null ? viewAt : current ? past.lastIndexOf(current) : past.length;
  if (at < 0) at = past.length;
  if (at <= 0) return;
  viewAt = at - 1;
  show(past[viewAt], false);
}

function goNext() {
  if (viewAt != null) {
    const n = viewAt + 1;
    if (n < past.length && past[n] !== current) {
      viewAt = n;
      show(past[n], false);
      return;
    }
    viewAt = null;
    if (current) show(current, false);
    else {
      applyPoint(livePoint);
      hideBubble();
    }
    return;
  }
  if (!current || current.ask) return;
  endBubble('click');
  nextBubble();
}

prevEl.addEventListener('click', (e) => {
  e.stopPropagation();
  if (navOk()) goPrev();
});
nextEl.addEventListener('click', (e) => {
  e.stopPropagation();
  if (navOk()) goNext();
});
// 본문 아무 데나 한 번 누르면 넘어간다 (치는 중이어도). 질문 말풍선은 선택지를 눌러야 넘어간다
bubbleEl.addEventListener('click', (e) => {
  if (e.target.closest('button')) return;
  if (navOk()) goNext();
});

// 직전 말 다시 보기: 고양이 위에 마우스가 오면 1.5초만 뜬다. 다시 보려면 고양이 밖으로 나갔다 와야 한다
replayEl.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!past.length || current) return;
  clearTimeout(replayTimer);
  viewAt = past.length - 1;
  show(past[viewAt], false);
});
let replayTimer = null;
let replayArmed = true;
function replayTick() {
  replayTimer = null;
  if (replayEl.matches(':hover')) {
    replayTimer = setTimeout(replayTick, 300);
    return;
  }
  replayEl.hidden = true;
}
function updateReplay() {
  if (!overPetNow && !replayEl.matches(':hover')) replayArmed = true;
  const want = overPetNow && past.length > 0 && !current && viewAt == null && bubbleEl.hidden && cardEl.hidden;
  if (!want || !replayArmed || !replayEl.hidden) return;
  replayArmed = false;
  replayEl.textContent = T.t('pet.replay');
  replayEl.hidden = false;
  placeOverlays();
  clearTimeout(replayTimer);
  replayTimer = setTimeout(replayTick, 1500);
}

// ---------- 카드 ----------

let card = null;
pet.onCard((c) => {
  card = c;
  cardEl.querySelector('.card-title').textContent = c.title || '';
  cardEl.querySelector('.card-title').hidden = !c.title;
  const body = cardEl.querySelector('.card-body');
  body.innerHTML = String(c.body || '')
    .split(/\n{2,}|\n/)
    .filter((s) => s.trim())
    .map((s) => `<p>${inline(s)}</p>`)
    .join('');
  cardEl.querySelector('.figure').innerHTML = figureHtml(c.figure);
  const btns = cardEl.querySelector('.card-buttons');
  btns.innerHTML = '';
  (c.buttons || []).forEach((label, i) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (i === 0) b.className = 'primary';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      closeCard(i);
    });
    btns.appendChild(b);
  });
  cardEl.querySelector('.hint').textContent = (c.buttons || []).length ? '' : T.t('pet.clickNext');
  cardEl.hidden = false;
  replayEl.hidden = true;
  placeOverlays();
  requestAnimationFrame(() => cardEl.classList.add('show'));
});
function closeCard(i) {
  if (!card) return;
  const c = card;
  card = null;
  cardEl.classList.remove('show');
  setTimeout(() => !card && (cardEl.hidden = true), 150);
  pet.cardReply(c.id, i);
}
cardEl.addEventListener('click', () => {
  if (card && !(card.buttons || []).length) closeCard(-1);
});

// ---------- 가리키기 ----------
// 라벨은 DOM, 화살표(곡선 + 촉)와 과녁(맥박 고리)은 #field 캔버스에 매 프레임 그린다

// 수업 말풍선은 처음 뜰 때 그때 가리키던 자리를 기억해 둔다(b.point). "← 이전"으로 지난 말을 보면 그 자리를 다시 가리키고,
// 지금 말로 돌아오면 호스트가 지금 가리키라는 자리(livePoint)로 돌아간다.
let livePoint = null; // 호스트가 지금 가리키라는 자리 { x, y, dir, box?, label, since }
let pointState = null; // 지금 그리는 자리. dir 'box' 는 넓은 자리를 깜빡이는 테두리로 감싼다
pet.onPoint((p) => {
  if (!p || !p.on) livePoint = null;
  else {
    livePoint = { x: p.x, y: p.y, dir: p.dir || 'up', box: p.box || null, label: p.label || '', since: p.keep && livePoint ? livePoint.since : performance.now() };
    // 지금 말풍선이 뜬 뒤에 자리만 옮겨진 거면(창 크기 등) 그 말풍선의 기억도 새 자리로
    if (p.keep && current && current.point) current.point = livePoint;
  }
  if (viewAt == null) applyPoint(livePoint);
});

function applyPoint(p) {
  pointState = p ? { ...p } : null;
  pointEl.textContent = p ? p.label : '';
  pointEl.hidden = !p || !p.label;
  placePointLabel();
}

// 라벨 자리: 과녁에서 조금 떨어진 곳 (왼쪽을 가리키면 오른쪽에, 위를 가리키면 아래에)
function placePointLabel() {
  const p = pointState;
  if (!p || pointEl.hidden) return;
  const w = pointEl.offsetWidth;
  const h = pointEl.offsetHeight;
  let left;
  let top;
  if (p.box) {
    // 상자 안 왼쪽 위. 상자가 좁으면(아이콘 줄) 상자 오른쪽 바깥
    const b = p.box;
    left = b.w < w + 24 ? b.x + b.w + 8 : b.x + 10;
    top = b.y + 10;
  } else if (p.dir === 'left') {
    left = p.x + 46;
    top = p.y + 14;
  } else if (p.dir === 'down') {
    left = p.x - w / 2;
    top = p.y - 60 - h;
  } else {
    left = p.x - w / 2 + 40;
    top = p.y + 48;
  }
  left = clamp(left, 4, window.innerWidth - w - 4);
  top = clamp(top, 4, window.innerHeight - h - 4);
  pointEl.style.left = `${Math.round(left)}px`;
  pointEl.style.top = `${Math.round(top)}px`;
  p.lx = left;
  p.ly = top;
  p.lw = w;
  p.lh = h;
}

function drawPointer(now) {
  fctx.clearRect(0, 0, fieldEl.width, fieldEl.height);
  const p = pointState;
  if (!p) return;
  const t = (now - p.since) / 1000;
  const ACC = '#d97757';
  if (p.box) {
    // 깜빡이는 테두리 상자 (안쪽으로 3px, 둥근 모서리)
    const b = p.box;
    const on = 0.5 + 0.5 * Math.cos((t * Math.PI * 2) / 1.1);
    const x = b.x + 3;
    const y = b.y + 3;
    const w = Math.max(0, b.w - 6);
    const h = Math.max(0, b.h - 6);
    const rr = Math.min(10, w / 2, h / 2);
    fctx.beginPath();
    fctx.moveTo(x + rr, y);
    fctx.arcTo(x + w, y, x + w, y + h, rr);
    fctx.arcTo(x + w, y + h, x, y + h, rr);
    fctx.arcTo(x, y + h, x, y, rr);
    fctx.arcTo(x, y, x + w, y, rr);
    fctx.closePath();
    fctx.fillStyle = `rgba(217,119,87,${0.04 + on * 0.06})`;
    fctx.fill();
    fctx.lineWidth = 3;
    fctx.strokeStyle = `rgba(217,119,87,${0.25 + on * 0.75})`;
    fctx.stroke();
    return;
  }
  // 미니멀: 가는 선 하나 · 열린 촉 · 작은 점 · 얇은 맥박 고리 하나
  const k = (t % 1.4) / 1.4;
  fctx.beginPath();
  fctx.arc(p.x, p.y, 5 + k * 16, 0, Math.PI * 2);
  fctx.lineWidth = 2;
  fctx.strokeStyle = `rgba(217,119,87,${(1 - k) * 0.55})`;
  fctx.stroke();
  fctx.beginPath();
  fctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
  fctx.fillStyle = ACC;
  fctx.fill();
  if (pointEl.hidden || p.lx == null) return;
  // 라벨 가장자리에서 점까지 직선 + 열린 촉
  const sx = p.dir === 'left' ? p.lx : p.lx + p.lw / 2;
  const sy = p.dir === 'left' ? p.ly + p.lh / 2 : p.dir === 'down' ? p.ly + p.lh : p.ly;
  const ex = p.x + (p.dir === 'left' ? 10 : 0);
  const ey = p.y + (p.dir === 'up' ? 10 : p.dir === 'down' ? -10 : 0);
  fctx.lineWidth = 2.5;
  fctx.lineCap = 'round';
  fctx.lineJoin = 'round';
  fctx.strokeStyle = ACC;
  fctx.beginPath();
  fctx.moveTo(sx, sy);
  fctx.lineTo(ex, ey);
  fctx.stroke();
  const ang = Math.atan2(ey - sy, ex - sx);
  fctx.beginPath();
  fctx.moveTo(ex - Math.cos(ang - 0.6) * 11, ey - Math.sin(ang - 0.6) * 11);
  fctx.lineTo(ex, ey);
  fctx.lineTo(ex - Math.cos(ang + 0.6) * 11, ey - Math.sin(ang + 0.6) * 11);
  fctx.stroke();
}

// ---------- 서 있기 · 걷기 ----------

let catX = null;
let catLift = 0;
let catVy = 0;
let catVx = 0;
let lifted = false;
let nextIdleMotion = performance.now() + 30000;

const petPx = () => Math.round(PetSprite.GRID * scale);
const cellPx = () => petPx() / PetSprite.GRID;

function lane() {
  const half = petPx() / 2;
  return [half, Math.max(half, window.innerWidth - half)];
}
const homeX = () => Math.max(petPx() / 2, window.innerWidth - petPx() / 2 - 90);

const shadowEl = document.createElement('canvas');
shadowEl.id = 'floor-shadow';
document.body.appendChild(shadowEl);
function updateFloorShadow() {
  const cell = cellPx();
  const air = catX != null && catLift > cell * 1.5;
  sprite.floorShadow = air;
  shadowEl.hidden = !air;
  if (!air) return;
  const G = PetSprite.GRID;
  const GROUND = PetSprite.util.GROUND;
  const h = catLift / cell;
  const rx = (sprite._shadow && sprite._shadow[1]) || 8;
  const w = Math.max(2, rx * (0.95 - Math.min(h, 12) * 0.045));
  if (shadowEl.width !== G) {
    shadowEl.width = G;
    shadowEl.height = 2;
  }
  const ctx = shadowEl.getContext('2d');
  ctx.clearRect(0, 0, G, 2);
  ctx.fillStyle = 'rgba(30,15,8,0.22)';
  const cx = G / 2;
  for (let x = Math.round(cx - w); x <= Math.round(cx + w); x++) {
    ctx.fillRect(x, 0, 1, 1);
    if (Math.abs(x - cx) < w - 2) ctx.fillRect(x, 1, 1, 1);
  }
  shadowEl.style.opacity = String(Math.max(0.35, 1 - catLift / (window.innerHeight * 0.9)));
  shadowEl.style.width = `${petPx()}px`;
  shadowEl.style.height = `${2 * cell}px`;
  shadowEl.style.left = `${Math.round(catX - petPx() / 2)}px`;
  shadowEl.style.bottom = `${Math.round((G - GROUND - 3) * cell)}px`;
}

function placeCat() {
  if (catX == null) return;
  const [min, max] = lane();
  catX = Math.max(min, Math.min(max, catX));
  canvas.style.left = `${Math.round(catX - petPx() / 2)}px`;
  canvas.style.bottom = `${Math.round(catLift)}px`;
}

function walkTo(goal, dt, fast = 1, stop = 0) {
  const [min, max] = lane();
  goal = clamp(goal, min, max);
  const dx = goal - catX;
  const dist = Math.abs(dx);
  const speed = dist <= stop ? 0 : (dist > 500 ? 300 : dist > 140 ? 190 : 110) * fast;
  if (speed) {
    catX = clamp(catX + Math.sign(dx) * Math.min(speed * dt, dist), min, max);
    sprite.setMove(Math.sign(dx) * speed);
  } else sprite.setMove(0);
  placeCat();
  return Math.abs(goal - catX);
}

function face(x) {
  if (Math.abs(x - catX) > 2) sprite.setFacing(Math.sign(x - catX));
}

window.addEventListener('resize', () => {
  placeCat();
  fieldEl.width = window.innerWidth;
  fieldEl.height = window.innerHeight;
  placePointLabel();
  placeOverlays();
});

// ---------- 어디로 가기 · 물고 가기 ----------

let goto = null;
let carry = null;
let paperEl = null;

pet.onGoto((g) => {
  if (sprite.action && PetSprite.PetRenderer.isMotion(sprite.action)) sprite.cancel();
  goto = { id: g.id, x: g.x, run: !!g.run };
});

pet.onCarry((c) => {
  goto = null;
  carry = { id: c.id, from: c.from, to: c.to, phase: 'go', until: 0 };
});

function makePaper() {
  const el = document.createElement('div');
  el.className = 'paper';
  document.body.appendChild(el);
  return el;
}

function placePaper() {
  if (!paperEl || catX == null) return;
  const P = petPx();
  paperEl.style.left = `${Math.round(catX + sprite.facing * P * 0.28 - 9)}px`;
  paperEl.style.bottom = `${Math.round(catLift + P * 0.3)}px`;
}

function stepGoto(dt) {
  const d = walkTo(goto.x, dt, goto.run ? 1.5 : 1, 2);
  if (d <= 2) {
    sprite.setMove(0);
    sprite.setFacing(1);
    const g = goto;
    goto = null;
    pet.arrived(g.id);
  }
}

function stepCarry(dt, now) {
  const c = carry;
  if (c.phase === 'go') {
    if (walkTo(c.from, dt, 1.3, 4) <= 4) {
      sprite.setMove(0);
      face(c.from);
      sprite.play('pounce');
      c.phase = 'pick';
      c.until = now + 500;
    }
    return;
  }
  if (c.phase === 'pick') {
    if (now < c.until) return;
    paperEl = paperEl || makePaper();
    paperEl.hidden = false;
    sprite.setToyPose('tcarry');
    c.phase = 'carry';
    return;
  }
  if (c.phase === 'carry') {
    placePaper();
    if (walkTo(c.to, dt, 0.9, 4) <= 4) {
      sprite.setMove(0);
      face(c.to);
      sprite.setToyPose(prop || (mood === 'busy' ? 'ttype' : null));
      if (paperEl) {
        const r = paperEl.getBoundingClientRect();
        flyPaper(r.left, r.top, catX + sprite.facing * petPx() * 0.4 - 9, window.innerHeight - 24, 450, true);
        paperEl.remove();
        paperEl = null;
      }
      sprite.play('happy');
      c.phase = 'drop';
      c.until = now + 700;
    }
    return;
  }
  if (c.phase === 'drop' && now >= c.until) {
    carry = null;
    sprite.setFacing(1);
    pet.arrived(c.id);
  }
}

// ---------- 효과 ----------

const flights = [];
function flyPaper(x0, y0, x1, y1, dur = 900, fade = false) {
  const el = makePaper();
  el.style.left = `${Math.round(x0)}px`;
  el.style.top = `${Math.round(y0)}px`;
  el.style.bottom = '';
  flights.push({ el, x0, y0, x1, y1, t0: performance.now(), dur, fade });
}
function stepFlights(now) {
  for (let i = flights.length - 1; i >= 0; i--) {
    const f = flights[i];
    const k = clamp((now - f.t0) / f.dur, 0, 1);
    const e = 1 - (1 - k) * (1 - k);
    const arc = -Math.sin(k * Math.PI) * 60;
    f.el.style.left = `${Math.round(f.x0 + (f.x1 - f.x0) * e)}px`;
    f.el.style.top = `${Math.round(f.y0 + (f.y1 - f.y0) * e + arc)}px`;
    if (f.fade) f.el.style.opacity = String(1 - k);
    if (k >= 1) {
      f.el.remove();
      flights.splice(i, 1);
    }
  }
}

pet.onFx((f) => {
  if (!f) return;
  if (f.type === 'paper') {
    const P = petPx();
    const from = f.from || { x: catX, y: window.innerHeight - catLift - P * 0.5 };
    flyPaper(from.x - 9, from.y - 11, (f.to ? f.to.x : catX) - 9, (f.to ? f.to.y : 0) - 11, f.ms || 900, true);
  } else if (f.type === 'confetti') {
    if (!dragging && !lifted) sprite.play('tcheer');
    if (soundOn) PetSound.play('achieve');
  }
});

// ---------- 심심할 때 (그 자리에서 잔동작만. 돌아다니지 않는다) ----------

function stepIdle(now) {
  if (catX == null) return;
  sprite.setMove(0);
  if (now < nextIdleMotion) return;
  const pick = idlePool[idleTurn++ % idlePool.length];
  const M = PetSprite.MOTIONS[pick];
  nextIdleMotion = now + 60000 + Math.random() * 90000;
  if (M && !sprite.busy() && !current && !card && mood === 'idle') sprite.play(pick, { times: M.loop ? 2 : 1 });
}

// ---------- 말풍선 · 카드 · 다시 보기 자리 ----------
// 머리 높이는 자세와 상관없이 고정이라, 폴짝 뛰거나 소품을 들어도 말풍선이 흔들리지 않는다.
// 고양이는 48칸 격자의 아래쪽 1/3 에 서 있다(바닥 46행, 앉은 자세 귀 끝 32행 = 칸의 33%). 소품을 들어도 가리지 않게 42%

function headFixed() {
  return catLift + petPx() * 0.42;
}

function placeOverlays() {
  if (catX == null) return;
  const keepInX = (el) => {
    const half = el.offsetWidth / 2 + 6;
    return Math.round(Math.max(half, Math.min(window.innerWidth - half, catX)));
  };
  const headPx = headFixed();
  let stack = 0;
  if (!bubbleEl.hidden) {
    const h = bubbleEl.offsetHeight;
    const top = window.innerHeight - 4;
    let bottom = headPx + 8;
    let below = false;
    if (bottom + h + 10 > top) {
      const under = catLift - h - 12;
      if (under >= 4) {
        bottom = under;
        below = true;
      } else bottom = Math.max(4, top - h - 10);
    }
    bubbleEl.classList.toggle('below', below);
    bubbleEl.style.bottom = `${Math.round(bottom)}px`;
    const x = keepInX(bubbleEl);
    bubbleEl.style.left = `${x}px`;
    const room = Math.max(0, bubbleEl.offsetWidth / 2 - 16);
    bubbleEl.style.setProperty('--tail-x', `${Math.round(clamp(catX - x, -room, room))}px`);
    stack = h + 18;
  }
  if (!cardEl.hidden) {
    const h = cardEl.offsetHeight;
    const bottom = Math.max(8, Math.min(window.innerHeight - h - 8, headPx + 10 + stack));
    cardEl.style.bottom = `${Math.round(bottom)}px`;
    cardEl.style.left = `${keepInX(cardEl)}px`;
  }
  if (!replayEl.hidden) {
    replayEl.style.left = `${Math.round(clamp(catX + petPx() * 0.2, 4, window.innerWidth - replayEl.offsetWidth - 4))}px`;
    replayEl.style.bottom = `${Math.round(headPx + 2)}px`;
  }
}

// ---------- 들어 올리기 ----------

const GRAVITY = 1500;
const swing = { a: 0, va: 0, l: 0, vl: 0, x: 0, v: 0, px: 24, py: 38 };
const HELD_ESCAPE_MS = 10000;
let liftAt = 0;
let fallFrom = 0;

function grabSwing(pressInfo) {
  const cell = cellPx();
  swing.a = swing.va = swing.l = swing.vl = swing.v = 0;
  swing.x = catX;
  swing.px = clamp(24 + pressInfo.dx / cell, 18, 30);
  swing.py = clamp(PetSprite.GRID - pressInfo.dy / cell, 34, 40);
}

function stepSwing(dt) {
  if (!lifted) return;
  const P = petPx();
  const L = P * 0.55;
  const v = (catX - swing.x) / Math.max(dt, 0.001);
  swing.x = catX;
  const dv = clamp(v - swing.v, -2500, 2500);
  swing.v = v;
  swing.va += (dv / L) * Math.cos(swing.a) * 0.4;
  swing.va += (-(GRAVITY / L) * Math.sin(swing.a) - 6 * swing.va) * dt;
  swing.a = clamp(swing.a + swing.va * dt, -0.4, 0.4);
  swing.vl += ((swing.a - swing.l) * 320 - swing.vl * 24) * dt;
  swing.l += swing.vl * dt;
  const heldFor = dragging ? performance.now() - liftAt : 0;
  const struggle = heldFor > 4000 && catLift > 6;
  if (dragging && heldFor > HELD_ESCAPE_MS && catLift > 6) return escapeHold();
  sprite.setHeld(catLift > 6 ? { rot: swing.a, legs: clamp((swing.a - swing.l) * 9, -2, 2), px: swing.px, py: swing.py, struggle } : null);
}

function escapeHold() {
  dragging = false;
  press = null;
  document.body.classList.remove('dragging');
  pet.drag('end', { x: catX });
  resyncHover();
  fallFrom = catLift;
  catVy = -220;
  catVx = (Math.random() < 0.5 ? -1 : 1) * 120;
  sprite.setHeld(null);
}

function stepFall(dt) {
  if (dragging || catLift <= 0) return;
  catVy += GRAVITY * dt;
  catLift = Math.max(0, catLift - catVy * dt);
  if (catVx) {
    const [min, max] = lane();
    catX = clamp(catX + catVx * dt, min, max);
    if (catX <= min || catX >= max) catVx = -catVx * 0.4;
  }
  if (!catLift) {
    catVy = 0;
    catVx = 0;
    if (lifted) {
      lifted = false;
      sprite.setHeld(null);
      const P = petPx();
      if (fallFrom > P * 1.6) sprite.play('land');
      else if (fallFrom > P * 0.4 && !sprite.action) sprite.play('perk');
      fallFrom = 0;
    }
  }
  placeCat();
}

// ---------- 그리기 루프 ----------

const offscreen = () => document.hidden || !!(window.frameElement && !window.frameElement.getClientRects().length);
let lastLoop = performance.now();
let loopTimer = null;
let lastHoverCheck = 0;
function loop() {
  loopTimer = null;
  const now = performance.now();
  const dt = Math.min(0.2, (now - lastLoop) / 1000);
  lastLoop = now;
  if (document.hidden) return;
  if (offscreen()) {
    loopTimer = setTimeout(loop, 160);
    return;
  }
  stepFall(dt);
  stepSwing(dt);
  stepFlights(now);
  if (dragging || lifted) sprite.setMove(0);
  else if (goto) stepGoto(dt);
  else if (carry) stepCarry(dt, now);
  else {
    stepIdle(now);
    if (mood === 'wait' && mouseX != null && Math.abs(mouseX - catX) < 400 && !sprite.action) face(mouseX);
  }
  updateFloorShadow();
  sprite.frame();
  drawPointer(now);
  if (dragging || lifted || catLift > 0) placeOverlays();
  if (over && now - lastHoverCheck > 120) {
    lastHoverCheck = now;
    recheckHover();
  }
  loopTimer = setTimeout(loop, loopDelay(now));
}

function loopDelay(now) {
  const moving = dragging || press || goto || carry || flights.length || sprite.move || sprite.busy() || catLift > 0 || pointState;
  if (moving) return 33;
  if (mood === 'sleep') return 160;
  if (now - lastMouseMove < 1500 || current || card) return 55;
  return 100;
}

function wakeLoop() {
  if (loopTimer || document.hidden) return;
  lastLoop = performance.now();
  loop();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(loopTimer);
    loopTimer = null;
  } else wakeLoop();
});

// ---------- 마우스 ----------

let over = false;
let overPetNow = false;
let press = null;
let dragging = false;
let mouseX = null;
let mouseY = null;
let lastMouseMove = performance.now();

function isOverPet(e) {
  const r = canvas.getBoundingClientRect();
  return sprite.hit(((e.clientX - r.left) / r.width) * PetSprite.GRID, ((e.clientY - r.top) / r.height) * PetSprite.GRID);
}
function isOverEl(el, e, pad = 0) {
  if (el.hidden) return false;
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + 8 + pad;
}
function setOver(v) {
  if (v === over) return;
  over = v;
  pet.hover(v);
}
function hoverTest(e) {
  overPetNow = isOverPet(e);
  const r = overPetNow || isOverEl(bubbleEl, e) || isOverEl(cardEl, e) || isOverEl(replayEl, e, 6);
  updateReplay();
  return r;
}
function recheckHover() {
  if (dragging || press || mouseX == null) return;
  setOver(hoverTest({ clientX: mouseX, clientY: mouseY }));
}
function resyncHover() {
  over = false;
  recheckHover();
}

const GAZE_RANGE = 340;
function updateGaze() {
  if (mouseX == null || catX == null) return (sprite.gaze = null);
  const P = petPx();
  const dx = mouseX - catX;
  const dy = mouseY - (window.innerHeight - catLift - P * 0.5);
  if (Math.hypot(dx, dy) > GAZE_RANGE) return (sprite.gaze = null);
  const step = (v) => (Math.abs(v) < P * 0.18 ? 0 : Math.sign(v));
  sprite.gaze = { x: step(dx), y: step(dy) };
}

const RUB_MS = 2500;
const RUB_GAP = 900;
const rub = { x: null, dir: 0, since: 0, last: 0, flips: 0, until: 0 };
function nearBody(e) {
  const r = canvas.getBoundingClientRect();
  return Math.abs(e.clientX - (r.left + r.width / 2)) < r.width * 0.35 && e.clientY > r.top + r.height * 0.4 && e.clientY < r.bottom;
}
function trackRub(e) {
  const now = performance.now();
  if (press || dragging || now < rub.until || !nearBody(e)) {
    rub.x = null;
    rub.since = 0;
    return;
  }
  if (rub.x != null) {
    const dx = e.clientX - rub.x;
    if (Math.abs(dx) >= 2) {
      const dir = Math.sign(dx);
      if (rub.dir && dir !== rub.dir) {
        if (!rub.since || now - rub.last > RUB_GAP) {
          rub.since = now;
          rub.flips = 0;
        }
        rub.flips++;
        rub.last = now;
      }
      rub.dir = dir;
    }
  }
  rub.x = e.clientX;
  if (rub.since && now - rub.last > RUB_GAP) rub.since = 0;
  if (rub.since && now - rub.since >= RUB_MS && rub.flips >= 4) {
    rub.since = 0;
    rub.until = now + 3500;
    sprite.play('purr');
    pet.rub();
  }
}

window.addEventListener('mousemove', (e) => {
  if (e.clientX !== mouseX || e.clientY !== mouseY) lastMouseMove = performance.now();
  if (e.buttons === 0 && dragging) onMouseUp(e);
  else if (e.buttons === 0 && press) press = null;
  mouseX = e.clientX;
  mouseY = e.clientY;
  updateGaze();
  trackRub(e);
  if (press && !press.noDrag && !dragging && Math.hypot(e.screenX - press.x, e.screenY - press.y) > 4) {
    dragging = true;
    lifted = true;
    liftAt = performance.now();
    if (sprite.action) sprite.cancel();
    grabSwing(press);
    document.body.classList.add('dragging');
    replayEl.hidden = true;
    pet.drag('start');
  }
  if (dragging) {
    catX = e.clientX - press.dx;
    catLift = Math.max(0, window.innerHeight - e.clientY - press.dy);
    catVy = 0;
    placeCat();
    placePaper();
    placeOverlays();
    return;
  }
  setOver(hoverTest(e));
});

window.addEventListener('mouseleave', (e) => {
  sprite.gaze = null;
  if (e.buttons === 0 && dragging) onMouseUp(e);
  if (!dragging) {
    overPetNow = false;
    updateReplay();
    setOver(false);
  }
});

window.addEventListener('blur', () => {
  if (dragging) onMouseUp({ button: 0, buttons: 0, clientX: mouseX != null ? mouseX : 0, clientY: mouseY != null ? mouseY : 0 });
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !isOverPet(e)) return;
  press = { x: e.screenX, y: e.screenY, dx: e.clientX - catX, dy: window.innerHeight - e.clientY - catLift, noDrag: catLift > 0 || !!carry };
});

window.addEventListener('mouseup', (e) => onMouseUp(e));
let pokeTimer = null;
function onMouseUp(e) {
  if (e.button !== 0 || !press) return;
  if (dragging) {
    dragging = false;
    fallFrom = catLift;
    document.body.classList.remove('dragging');
    pet.drag('end', { x: catX });
    press = null;
    resyncHover();
    if (catLift <= 0) {
      lifted = false;
      sprite.setHeld(null);
    }
    placeOverlays();
  } else if (isOverPet(e)) {
    if (pokeTimer) {
      clearTimeout(pokeTimer);
      pokeTimer = null;
    } else
      pokeTimer = setTimeout(() => {
        pokeTimer = null;
        if (!sprite.action) sprite.play('happy');
        pet.poke();
      }, 260);
  }
  press = null;
}

canvas.addEventListener('dblclick', (e) => {
  if (isOverPet(e)) pet.open();
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (isOverPet(e) || isOverEl(bubbleEl, e)) pet.context();
});

applyScale();
fieldEl.width = window.innerWidth;
fieldEl.height = window.innerHeight;
loop();
pet.ready();
