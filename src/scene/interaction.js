import * as THREE from 'three';
import { saveState, loadState } from '../state/game.js';

const _raycaster = new THREE.Raycaster();
let _startleActive = false;

export function initInteraction(canvas, camera, model) {
  if (!canvas || !camera || !model) return;

  canvas.addEventListener('click',     (e) => _onClick(e, canvas, camera, model));
  canvas.addEventListener('mousemove', (e) => _onMouseMove(e, canvas, camera, model));
}

function _getNDC(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  return new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width)  *  2 - 1,
    ((e.clientY - rect.top)  / rect.height) * -2 + 1,
  );
}

function _onClick(e, canvas, camera, model) {
  if (_startleActive) return;
  _raycaster.setFromCamera(_getNDC(e, canvas), camera);
  if (_raycaster.intersectObject(model, true).length === 0) return;

  const state = loadState();
  saveState({ stats: { ...state.stats, total_touches: (state.stats.total_touches ?? 0) + 1 } });
  console.debug('[interaction] total_touches:', loadState().stats.total_touches);
  _triggerStartle(model);
}

function _onMouseMove(e, canvas, camera, model) {
  _raycaster.setFromCamera(_getNDC(e, canvas), camera);
  canvas.style.cursor = _raycaster.intersectObject(model, true).length > 0 ? 'pointer' : 'crosshair';
}

function _triggerStartle(model) {
  _startleActive = true;
  const originY = model.position.y;
  const start   = performance.now();
  const DURATION = 300;
  const JUMP_H   = 0.3;

  function frame() {
    const progress = Math.min((performance.now() - start) / DURATION, 1);
    model.position.y = originY + Math.sin(progress * Math.PI) * JUMP_H;
    if (progress < 1) {
      requestAnimationFrame(frame);
    } else {
      model.position.y = originY;
      _startleActive = false;
    }
  }
  requestAnimationFrame(frame);
}
