import { getTimeOfDay } from '../state/seaman-status.js';
import { loadState } from '../state/game.js';

const TIME_AMPLITUDE = { night: 0.08, morning: 1.4, day: 1.0, evening: 1.1 };

let _phase = 0;
let _excitementEnd = 0;

export function initSwimming() {
  _phase = Math.random() * Math.PI * 2;
}

export function triggerWaterChangeReaction() {
  _excitementEnd = performance.now() + 3000;
}

export function updateSwimming(wrapper, t, voiceState) {
  if (!wrapper) return;

  // voiceState ベースの振幅
  let baseAmplitude = 1.0;
  if (voiceState === 'speaking')      baseAmplitude = 1.2;
  else if (voiceState === 'thinking') baseAmplitude = 0.8;
  else if (voiceState === 'idle')     baseAmplitude = 0.4;

  // 時刻帯倍率
  const timeAmplitude = TIME_AMPLITUDE[getTimeOfDay()] ?? 1.0;

  // 水質倍率
  const wq = loadState().seaman.water_quality;
  const waterAmplitude = wq < 30 ? 0.5 : wq >= 70 ? 1.05 : 1.0;

  let amplitude = baseAmplitude * timeAmplitude * waterAmplitude;

  // 水換え直後の興奮
  if (performance.now() < _excitementEnd) amplitude *= 2.0;

  // 左右ドリフト + 上下ボビング + 奥行き揺れ
  wrapper.position.x = Math.sin(t * 0.25 + _phase) * 1.8 * amplitude;
  wrapper.position.y = Math.sin(t * 0.6) * 0.18;
  wrapper.position.z = Math.sin(t * 0.15 + _phase * 0.5) * 0.5;

  // 進行方向に向く（ヨー）
  const dxdt = Math.cos(t * 0.25 + _phase) * 0.25 * amplitude;
  const targetRotY = -dxdt * 0.6;
  wrapper.rotation.y += (targetRotY - wrapper.rotation.y) * 0.05;

  // バンキング（旋回時の傾き）
  wrapper.rotation.z += (-wrapper.rotation.y * 0.3 - wrapper.rotation.z) * 0.05;
}
