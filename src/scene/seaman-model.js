import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let _wrapper = null; // 遊泳 AI が動かすコンテナ
let _model   = null; // 実モデルまたはプレースホルダー（startle の対象）
let _mouthMorph = null; // { influences, idx } | null

export async function loadModel(scene, { onProgress } = {}) {
  _model = null;
  _mouthMorph = null;

  try {
    const resp = await fetch('assets/models/seaman.glb');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const ct = resp.headers.get('Content-Type') ?? '';
    if (!ct.includes('gltf-binary') && !ct.includes('octet-stream')) {
      throw new Error(`Not a GLB (Content-Type: ${ct})`);
    }

    const arrayBuffer = await _fetchWithProgress(resp, onProgress);
    const gltf = await _parseGLTF(arrayBuffer);
    _model = gltf.scene;
    _normalizeModel(_model);
    _mouthMorph = _findMouthMorph(_model);
  } catch (e) {
    console.warn('[scene] seaman.glb not available, using placeholder:', e.message);
    _model = _buildPlaceholder();
  }

  // ラッパーグループ: 遊泳 AI はこれを動かす
  _wrapper = new THREE.Group();
  _wrapper.add(_model);
  scene.add(_wrapper);

  return _model;
}

// スケール微調整定数 — モデルが大きすぎ/小さすぎる場合にここだけ変える
const MODEL_SCALE = 1.0;

function _normalizeModel(model) {
  const box  = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());

  console.debug('[scene] GLB raw size (before normalize):', {
    x: size.x.toFixed(3), y: size.y.toFixed(3), z: size.z.toFixed(3),
  });

  // Blender の GLTF エクスポートは Y-up に変換済みのはずだが、
  // 念のため「Y が最も小さい軸」なら Z-up エクスポートと判断して X 軸補正
  const minAxis = size.y <= size.x && size.y <= size.z ? 'y'
    : size.x <= size.y && size.x <= size.z ? 'x' : 'z';
  if (minAxis !== 'y') {
    console.warn('[scene] GLB may be Z-up. Rotating to Y-up. Check orientation.');
    model.rotation.x = -Math.PI / 2;
  }

  // 正規化: バウンディングボックスを更新してから原点中心・高さ 1.0 に
  const box2  = new THREE.Box3().setFromObject(model);
  const size2 = box2.getSize(new THREE.Vector3());
  const center2 = box2.getCenter(new THREE.Vector3());
  model.position.sub(center2);
  const longest = Math.max(size2.x, size2.y, size2.z);
  if (longest > 0) model.scale.multiplyScalar(MODEL_SCALE / longest);

  console.debug('[scene] GLB normalized. MODEL_SCALE =', MODEL_SCALE);
}

function _findMouthMorph(model) {
  const candidates = ['mouth_open', 'mouthOpen', 'mouth-open', 'Mouth_Open'];
  let result = null;
  model.traverse((node) => {
    if (result || !node.isMesh || !node.morphTargetDictionary) return;
    for (const name of candidates) {
      const idx = node.morphTargetDictionary[name];
      if (idx !== undefined) {
        result = { influences: node.morphTargetInfluences, idx };
        return;
      }
    }
  });
  if (!result) console.warn('[scene] mouth_open MorphTarget not found — lip-sync disabled');
  return result;
}

function _buildPlaceholder() {
  const group = new THREE.Group();

  const skinMat  = new THREE.MeshStandardMaterial({ color: 0xc8a87a, roughness: 0.7, metalness: 0.05 });
  const scaleMat = new THREE.MeshStandardMaterial({ color: 0xa08060, roughness: 0.8 });

  // 胴体（楕円球）
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), skinMat);
  body.scale.set(1, 0.75, 1.5);
  group.add(body);

  // 背ビレ
  const dorsalFin = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 6), scaleMat);
  dorsalFin.position.set(0, 0.52, -0.08);
  dorsalFin.rotation.z = Math.PI;
  group.add(dorsalFin);

  // 尾ビレ
  const tailFin = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.42, 6), scaleMat);
  tailFin.position.set(0, 0, -0.68);
  tailFin.rotation.x = Math.PI / 2;
  group.add(tailFin);

  // 側ビレ
  [-0.5, 0.5].forEach((x) => {
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 5), scaleMat);
    fin.position.set(x, -0.08, 0.1);
    fin.rotation.z = x < 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(fin);
  });

  // 顔テクスチャ（Canvas 2D API で描画）
  const faceCanvas = document.createElement('canvas');
  faceCanvas.width = 128; faceCanvas.height = 128;
  const ctx = faceCanvas.getContext('2d');
  ctx.fillStyle = '#c8a87a'; ctx.fillRect(0, 0, 128, 128);
  // 目
  ctx.fillStyle = '#2a1a0a';
  [[38, 50], [90, 50]].forEach(([x, y]) => {
    ctx.beginPath(); ctx.ellipse(x, y, 10, 12, 0, 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = '#fff';
  [[42, 47], [94, 47]].forEach(([x, y]) => {
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
  });
  // 鼻
  ctx.fillStyle = '#a08060';
  [[55, 68], [73, 68]].forEach(([x, y]) => {
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
  });
  // 口（への字）
  ctx.strokeStyle = '#5a3020'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(42, 85); ctx.quadraticCurveTo(64, 95, 86, 85); ctx.stroke();

  const faceMat = new THREE.MeshStandardMaterial({
    map: new THREE.CanvasTexture(faceCanvas),
    roughness: 0.6,
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.55), faceMat);
  face.position.set(0, 0.02, 0.54);
  group.add(face);

  return group;
}

async function _fetchWithProgress(response, onProgress) {
  const total = Number(response.headers.get('Content-Length') ?? 0);
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) onProgress?.(received / total);
  }
  const merged = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.length; }
  return merged.buffer;
}

function _parseGLTF(arrayBuffer) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(arrayBuffer, '', resolve, reject);
  });
}

// 遊泳 AI が動かすコンテナ
export function getModel()      { return _wrapper; }
// startle（クリック反応）が動かす内側モデル
export function getInnerModel() { return _model; }
// 口パク情報
export function getMouthMorph() { return _mouthMorph; }
