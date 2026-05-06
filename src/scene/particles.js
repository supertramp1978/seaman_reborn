import * as THREE from 'three';

const BUBBLE_COUNT = 60;
let _geometry, _positions, _speeds, _phases;

export function initBubbles(scene) {
  _positions = new Float32Array(BUBBLE_COUNT * 3);
  _speeds    = new Float32Array(BUBBLE_COUNT);
  _phases    = new Float32Array(BUBBLE_COUNT);

  for (let i = 0; i < BUBBLE_COUNT; i++) {
    _resetBubble(i, true);
    _speeds[i]  = 0.3 + Math.random() * 0.4;
    _phases[i]  = Math.random() * Math.PI * 2;
  }

  _geometry = new THREE.BufferGeometry();
  _geometry.setAttribute('position', new THREE.BufferAttribute(_positions, 3));

  const material = new THREE.PointsMaterial({
    size: 0.04,
    color: 0x88bbff,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  scene.add(new THREE.Points(_geometry, material));
}

export function updateBubbles(delta, t) {
  if (!_geometry) return;

  for (let i = 0; i < BUBBLE_COUNT; i++) {
    const b = i * 3;
    _positions[b + 1] += _speeds[i] * delta;
    _positions[b]     += Math.sin(t * 2 + _phases[i]) * 0.001; // 微小スウェー

    if (_positions[b + 1] > 1.5) _resetBubble(i, false);
  }

  _geometry.attributes.position.needsUpdate = true;
}

function _resetBubble(i, randomY) {
  const b = i * 3;
  _positions[b]     = (Math.random() - 0.5) * 4.5;
  _positions[b + 1] = randomY ? -1.5 + Math.random() * 3.0 : -1.5;
  _positions[b + 2] = (Math.random() - 0.5) * 2.5;
}
