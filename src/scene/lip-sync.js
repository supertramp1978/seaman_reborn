import { chatStore } from '../chat/store.js';
import { ttsQueue } from '../audio/tts.js';

let _targetOpenness = 0;

export function initLipSync() {
  ttsQueue.on('boundary', ({ charIndex, charLength } = {}) => {
    _targetOpenness = 0.3 + Math.random() * 0.5;
    console.debug(`[lip-sync] boundary charIndex=${charIndex} charLength=${charLength} → openness=${_targetOpenness.toFixed(2)}`);
  });

  ttsQueue.on('end', () => {
    _targetOpenness = 0;
    console.debug('[lip-sync] tts end → close mouth');
  });

  chatStore.on('voiceState', (state) => {
    if (state !== 'speaking') _targetOpenness = 0;
    console.debug(`[lip-sync] voiceState=${state} → targetOpenness=${_targetOpenness.toFixed(2)}`);
  });
}

export function updateLipSync(mouthMorph, dt) {
  if (!mouthMorph) return;
  const { influences, idx } = mouthMorph;
  influences[idx] += (_targetOpenness - influences[idx]) * Math.min(dt * 15, 1);
}
