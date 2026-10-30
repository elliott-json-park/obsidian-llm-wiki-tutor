'use strict';
const ko = require('./ko');
const en = require('./en');
const zh = require('./zh');

const SAMPLES = { ko, en, zh };
const samples = (lang) => SAMPLES[lang] || SAMPLES.ko;

module.exports = { SAMPLES, samples };
