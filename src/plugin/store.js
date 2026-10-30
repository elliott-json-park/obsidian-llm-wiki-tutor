// 설정 · 진행 · 고양이 자리. 플러그인 data.json 한 파일에 둔다
const DEFAULT_SETTINGS = {
  language: 'ko', // 'ko' | 'en' | 'zh'
  scale: 5, // 3~8. 우클릭 메뉴의 작게 4 · 보통 5 · 크게 6 · 아주 크게 7
  showPet: true,
  sound: true,
  practiceFolder: null, // null 이면 언어에 맞는 기본 이름
  habitCoach: true, // 졸업 뒤 세 줄 · ingest 요일 챙기기 (core/habit.js)
  ingestDay: 'fri', // ingest 요일 (sun~sat)
  yieldVaultPet: true, // Vault Pet 이 같이 켜져 있으면 수업 중엔 그쪽 고양이가 비킨다
};

const DEFAULT_STATE = {
  catX: null, // 마지막으로 둔 자리 (무대 x)
  progress: null, // 레슨 진행 (core/engine.js) — 아직 없음
  notes: null, // 필기 노트 { lessonId, lines } (plugin/notes.js)
};

function load(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) },
    state: { ...DEFAULT_STATE, ...(d.state || {}) },
  };
}

module.exports = { DEFAULT_SETTINGS, DEFAULT_STATE, load };
