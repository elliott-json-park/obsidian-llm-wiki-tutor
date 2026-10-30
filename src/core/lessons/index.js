'use strict';
const { COURSE_A } = require('./courseA');
const { COURSE_B } = require('./courseB');
const { attach } = require('./notes');
const EN = require('./en');
const ZH = require('./zh');

// 전체 순서. A3~A5 는 코스 A 에 더 붙는다
const ALL = [...COURSE_A, ...COURSE_B];

// 필기 노트(notes.js)를 단계에 붙인다. 못 찾은 것은 tests/run.js 가 실패로 본다
const NOTES_MISSING = attach(ALL);

// 레슨 · 필기는 한국어만 적고, 영어 · 중국어는 한국어 원문을 열쇠로 en.js · zh.js 에서 채운다.
// 이미 en · zh 가 적힌 글(경로 등)은 그대로 둔다. 그림 라벨({ ko: [...] })은 칸이 다 있을 때만 채운다
const TABLES = { en: EN, zh: ZH };
function translate(o) {
  if (Array.isArray(o)) return o.forEach(translate);
  if (!o || typeof o !== 'object') return;
  for (const [lang, T] of Object.entries(TABLES)) {
    if (o[lang] != null) continue;
    if (typeof o.ko === 'string' && T[o.ko] != null) o[lang] = T[o.ko];
    else if (Array.isArray(o.ko) && o.ko.every((s) => T[s] != null)) o[lang] = o.ko.map((s) => T[s]);
  }
  for (const [k, v] of Object.entries(o)) if (k !== 'ko' && k !== 'en' && k !== 'zh') translate(v);
}
translate(ALL);

module.exports = { ALL, COURSE_A, COURSE_B, NOTES_MISSING };
