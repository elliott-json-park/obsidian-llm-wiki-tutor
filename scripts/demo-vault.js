'use strict';
/*
 * 데모 볼트를 만든다.   node scripts/demo-vault.js [출력 폴더] [--plugin-only]
 *
 * - 노트 몇 개와 연습 폴더(내 위키 연습/raw · wiki · 샘플), .obsidian 설정, 플러그인 파일을 넣는다.
 * - --plugin-only: 노트는 그대로 두고 플러그인 파일만 새로 복사한다 (data.json 은 건드리지 않는다).
 * 기본 출력: ../데모_볼트 (LLM Wiki Tutor/데모_볼트)
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const out = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(root, '..', '데모_볼트'));
const pluginOnly = args.includes('--plugin-only');
const ID = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).id;

const write = (rel, text) => {
  const p = path.join(out, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};

const pdir = path.join(out, '.obsidian', 'plugins', ID);
fs.mkdirSync(pdir, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'styles.css']) fs.writeFileSync(path.join(pdir, f), fs.readFileSync(path.join(root, f)));

if (pluginOnly) {
  console.log(`plugin files copied to ${pdir}`);
  process.exit(0);
}

write('.obsidian/app.json', JSON.stringify({ promptDelete: false, alwaysUpdateLinks: true }, null, 2));
write('.obsidian/appearance.json', JSON.stringify({ theme: 'system', baseFontSize: 16 }, null, 2));
write('.obsidian/community-plugins.json', JSON.stringify([ID], null, 2));
write('.obsidian/core-plugins.json', JSON.stringify({ 'file-explorer': true, 'global-search': true, graph: true, backlink: true, 'page-preview': true, 'command-palette': true }, null, 2));

// 처음 켠 사용자와 같은 상태: 연습 폴더는 없다 (A0 가 만든다). 노트 한 장만
const notes = {
  '홈.md': `# 홈

LLM Wiki Tutor 데모 볼트. 왼쪽 리본의 고양이 아이콘을 누르거나, 명령 팔레트에서 "수업 열기" 를 실행해 보세요.
`,
};
for (const [rel, text] of Object.entries(notes)) write(rel, text);
console.log(`demo vault at ${out}`);
