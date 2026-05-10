import { loadState } from '../state/game.js';
import { getStatusSnapshot } from '../state/seaman-status.js';

const MOOD_LABEL = {
  neutral: '普通',
  happy:   '嬉しい',
  grumpy:  '不機嫌',
  sad:     '悲しい',
  sleepy:  '眠い',
};

const STAGE_LABEL = {
  larva:      '幼生',
  juvenile:   '幼魚',
  adult:      '大人',
  new_spices: '新種',
};

export async function showResumeScreen() {
  const screenEl = document.getElementById('resume-screen');

  const state    = loadState();
  const snapshot = getStatusSnapshot();

  const startedAt  = state.seaman.started_at
    ? new Date(state.seaman.started_at)
    : new Date();
  const days = Math.max(1, Math.floor((Date.now() - startedAt) / 86_400_000) + 1);

  document.getElementById('resume-days').textContent = `シーマン飼育開始 ${days} 日目`;

  document.getElementById('rs-mood').textContent  = MOOD_LABEL[snapshot.mood]  ?? snapshot.mood;
  document.getElementById('rs-stage').textContent = STAGE_LABEL[snapshot.stage] ?? snapshot.stage;
  document.getElementById('rs-temp').textContent  = `${snapshot.water_temp.toFixed(1)}°C`;

  _setBar('rs-trust-bar',   snapshot.trust);
  _setBar('rs-stomach-bar', snapshot.stomach);
  _setBar('rs-water-bar',   snapshot.water_quality);

  screenEl.hidden = false;
  await _tick();
  screenEl.classList.add('visible');

  return new Promise(resolve => {
    document.getElementById('resume-proceed').addEventListener('click', () => {
      screenEl.classList.add('fade-out');
      setTimeout(() => {
        screenEl.hidden = true;
        resolve();
      }, 500);
    }, { once: true });
  });
}

function _setBar(id, value) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

function _tick() {
  return new Promise(r => setTimeout(r, 50));
}
