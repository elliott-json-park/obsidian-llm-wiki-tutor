'use strict';
/*
 * main.js 를 만든다.   node scripts/build.js
 *
 * Vault Pet 의 scripts/build.js 와 같은 방식이다:
 * - src/core, src/plugin 모듈(CommonJS)을 작은 require 표로 묶는다 (옵시디언은 main.js 한 파일만 읽는다)
 * - src/kit 의 화면 코드(고양이 렌더러·펫 판)는 글자로 넣어 두었다가 iframe 안에서 돌린다 (plugin/frame.js)
 * - styles.css 는 src/plugin/styles.css 를 그대로 복사한다
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');
const read = (rel) => fs.readFileSync(path.join(src, rel), 'utf8');

// 펫 판이 읽는 스크립트 (순서대로)
const PET = ['kit/i18n.js', 'kit/sprite.js', 'kit/motions.js', 'kit/reactions.js', 'kit/tutor-motions.js', 'kit/sound.js', 'kit/pet.js'];

const PET_BODY = `
    <div id="bubble" class="bubble" hidden>
      <span class="title"></span>
      <span class="text"></span>
      <div class="figure"></div>
      <div class="choices"></div>
      <div class="nav"><button class="prev" type="button"></button><button class="next" type="button"></button></div>
    </div>
    <div id="card" class="card" hidden>
      <div class="card-title"></div>
      <div class="card-body"></div>
      <div class="figure"></div>
      <div class="card-buttons"></div>
      <span class="hint"></span>
    </div>
    <div id="point" class="point" hidden></div>
    <button id="replay" class="replay" type="button" hidden></button>
    <canvas id="pet"></canvas>
    <canvas id="field"></canvas>`;

const assets = {
  petBody: PET_BODY,
  petCss: read('kit/pet.css') + '\n' + read('plugin/frame.css'),
};

// ---------- 모듈 묶기 ----------
const modules = {};
const add = (id, code) => (modules[id] = code);
// 하위 폴더(core/lessons)까지 묶는다. 'core/lessons/index' 는 require('./lessons') 로도 찾아진다 (__require 참고)
const walk = (dir) => {
  if (!fs.existsSync(path.join(src, dir))) return;
  for (const f of fs.readdirSync(path.join(src, dir))) {
    const rel = `${dir}/${f}`;
    if (fs.statSync(path.join(src, rel)).isDirectory()) walk(rel);
    else if (f.endsWith('.js')) add(rel.slice(0, -3), read(rel));
  }
};
walk('core');
walk('plugin');
// 호스트(플러그인) 쪽에서도 쓰는 글
add('kit/i18n', read('kit/i18n.js'));

// 화면 코드는 글자로 넣었다가 iframe 에 스크립트로 꽂지 않고, 보통 함수로 묶어 둔다 (옵시디언 자동 리뷰가 런타임 스크립트 주입을 막는다).
// run(window, document, pet) 를 부르면 iframe 의 window·document 를 쥐고 펫 판 코드가 그대로 돈다
const EXPORTS = ['PetSprite', 'PetSound', 'I18N'];
const sync = EXPORTS.map((n) => `if (window.${n} !== undefined) ${n} = window.${n};`).join(' ');
const wrap = (list) => list.map((f) => `/* ${f} */\n${read(f)}\n;${sync}`).join('\n');
const RUN = `function run(window, document, pet) {
  var module, exports, require;
  var globalThis = window, self = window;
  var setTimeout = window.setTimeout.bind(window), clearTimeout = window.clearTimeout.bind(window);
  var setInterval = window.setInterval.bind(window), clearInterval = window.clearInterval.bind(window);
  var requestAnimationFrame = window.requestAnimationFrame.bind(window), cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  var getComputedStyle = window.getComputedStyle.bind(window);
  var performance = window.performance;
  var AudioContext = window.AudioContext;
  var ${EXPORTS.join(', ')};
${wrap(PET)}
}`;
add('plugin/kit-assets', `module.exports = ${JSON.stringify(assets)};\nmodule.exports.run = ${RUN};`);

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
let out = `/*
 * LLM Wiki Tutor ${manifest.version} — Obsidian plugin (built ${new Date().toISOString().slice(0, 10)})
 * 소스: src/ (node scripts/build.js 로 이 파일을 만든다)
 * 고양이 렌더러는 Vault Pet (MIT) 에서 가져왔다.
 */
const __ext = require;
const __defs = {};
const __cache = {};
function __resolve(from, req) {
  if (!req.startsWith('.')) return null;
  const parts = from.split('/').slice(0, -1);
  for (const p of req.replace(/\\.js$/, '').split('/')) {
    if (p === '.') continue;
    if (p === '..') parts.pop();
    else parts.push(p);
  }
  return parts.join('/');
}
function __require(from) {
  return (req) => {
    let id = __resolve(from, req);
    if (id === null) return __ext(req);
    if (!__defs[id] && __defs[id + '/index']) id += '/index';
    if (!__defs[id]) throw new Error('LLM Wiki Tutor: module not found ' + req + ' from ' + from);
    if (__cache[id]) return __cache[id].exports;
    const m = { exports: {} };
    __cache[id] = m;
    __defs[id].call(m.exports, m, m.exports, __require(id));
    return m.exports;
  };
}
`;
for (const [id, code] of Object.entries(modules)) out += `\n__defs[${JSON.stringify(id)}] = function (module, exports, require) {\n${code}\n};\n`;
out += `\nmodule.exports = __require('plugin/main')('./main');\n`;

fs.writeFileSync(path.join(root, 'main.js'), out);
fs.writeFileSync(path.join(root, 'styles.css'), read('plugin/styles.css'));
console.log(`main.js ${(out.length / 1024).toFixed(0)} KB`);
