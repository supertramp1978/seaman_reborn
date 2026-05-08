import * as THREE from 'three';

const GRAVITY    = 3.0;   // units/s²
const FOOD_R     = 0.07;
const SPAWN_Y    = 1.3;
const FLOOR_Y    = -1.38; // 底面より少し上（food半径分）
const X_RANGE    = 3.2;
const Z_SCATTER  = 0.3;

let _scene = null;
const _active = []; // { mesh, vy }

export function initFood(scene) {
  _scene = scene;
}

export function spawnFood() {
  if (!_scene) return;
  const geo  = new THREE.SphereGeometry(FOOD_R, 8, 8);
  const mat  = new THREE.MeshStandardMaterial({ color: 0xd4883a, roughness: 0.7 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(
    (Math.random() - 0.5) * X_RANGE,
    SPAWN_Y,
    (Math.random() - 0.5) * Z_SCATTER,
  );
  _scene.add(mesh);
  _active.push({ mesh, vy: 0 });
}

export function updateFood(dt) {
  for (let i = _active.length - 1; i >= 0; i--) {
    const item = _active[i];
    item.vy += GRAVITY * dt;
    item.mesh.position.y -= item.vy * dt;
    if (item.mesh.position.y <= FLOOR_Y) {
      _scene.remove(item.mesh);
      item.mesh.geometry.dispose();
      item.mesh.material.dispose();
      _active.splice(i, 1);
    }
  }
}
