let _phase = 0;

export function initSwimming() {
  _phase = Math.random() * Math.PI * 2;
}

export function updateSwimming(wrapper, t, voiceState) {
  if (!wrapper) return;

  let amplitude = 1.0;
  if (voiceState === 'speaking')      amplitude = 1.2;
  else if (voiceState === 'thinking') amplitude = 0.8;
  else if (voiceState === 'idle')     amplitude = 0.4;

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
