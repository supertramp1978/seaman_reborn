import * as THREE from 'three';

THREE.ColorManagement.enabled = true;

// 水槽内部空間の寸法（ユニット）
const TANK_W = 5;
const TANK_H = 3;
const TANK_D = 3;

let _scene, _camera, _renderer, _causticsMaterial;

export function initAquarium(canvas) {
  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  _renderer.outputColorSpace = THREE.SRGBColorSpace;
  _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  _renderer.setSize(canvas.clientWidth || canvas.offsetWidth, canvas.clientHeight || canvas.offsetHeight, false);

  _scene = new THREE.Scene();
  _scene.background = new THREE.Color(0x050b14);
  _scene.fog = new THREE.FogExp2(0x0a1a2e, 0.06);

  const aspect = (_renderer.domElement.width / _renderer.getPixelRatio()) /
                 (_renderer.domElement.height / _renderer.getPixelRatio());
  _camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 100);
  _camera.position.set(0, 0.5, 5);
  _camera.lookAt(0, 0, 0);

  _buildTank(_scene);
  _buildLighting(_scene);

  window.addEventListener('resize', _onResize);

  return { scene: _scene, camera: _camera, renderer: _renderer };
}

function _buildTank(scene) {
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x0a1525,
    emissive: new THREE.Color(0x0a1525),
    emissiveIntensity: 0.1,
    side: THREE.BackSide,
  });

  // 背面
  const back = new THREE.Mesh(new THREE.PlaneGeometry(TANK_W, TANK_H), wallMat);
  back.position.set(0, 0, -TANK_D / 2);
  scene.add(back);

  // 左壁
  const left = new THREE.Mesh(new THREE.PlaneGeometry(TANK_D, TANK_H), wallMat.clone());
  left.rotation.y = Math.PI / 2;
  left.position.set(-TANK_W / 2, 0, 0);
  scene.add(left);

  // 右壁
  const right = new THREE.Mesh(new THREE.PlaneGeometry(TANK_D, TANK_H), wallMat.clone());
  right.rotation.y = -Math.PI / 2;
  right.position.set(TANK_W / 2, 0, 0);
  scene.add(right);

  // 天井（薄暗い）
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(TANK_W, TANK_D), wallMat.clone());
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, TANK_H / 2, 0);
  scene.add(ceiling);

  // Caustics 底面（インライン GLSL、外部テクスチャ不要）
  _causticsMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float c1 = sin(vUv.x * 10.0 + uTime * 0.7) * sin(vUv.y * 8.0 + uTime * 0.5);
        float c2 = sin((vUv.x + vUv.y) * 7.0 + uTime * 1.1) * 0.5;
        float c = pow(max(0.0, (c1 + c2) * 0.5 + 0.5 - 0.4), 2.0) * 1.5;
        gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * c + vec4(0.02, 0.05, 0.12, 1.0);
      }
    `,
  });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(TANK_W, TANK_D, 1, 1), _causticsMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -TANK_H / 2 + 0.01, 0);
  scene.add(floor);
}

function _buildLighting(scene) {
  scene.add(new THREE.AmbientLight(0x6699cc, 0.35));

  const top = new THREE.PointLight(0xc8e0ff, 1.2);
  top.position.set(0, 1.4, 0.5);
  scene.add(top);

  const back = new THREE.PointLight(0x3366aa, 0.5);
  back.position.set(0, 0, -1.4);
  scene.add(back);
}

function _onResize() {
  if (!_renderer) return;
  const canvas = _renderer.domElement;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  _renderer.setSize(w, h, false);
  _camera.aspect = w / h;
  _camera.updateProjectionMatrix();
}

export function startRenderLoop(callback) {
  const frameTimes = [];
  let lastPerfLog = 0;

  function loop(now) {
    requestAnimationFrame(loop);
    if (document.hidden) return;
    if (_causticsMaterial) _causticsMaterial.uniforms.uTime.value = now / 1000;
    callback(now);
    _renderer.render(_scene, _camera);

    // パフォーマンス計測: 直近 60 フレーム平均 FPS を 5 秒ごとに出力
    frameTimes.push(now);
    if (frameTimes.length > 60) frameTimes.shift();
    if (now - lastPerfLog > 5000 && frameTimes.length >= 2) {
      const elapsed = frameTimes[frameTimes.length - 1] - frameTimes[0];
      const fps = ((frameTimes.length - 1) / elapsed * 1000).toFixed(1);
      const frameMs = (elapsed / (frameTimes.length - 1)).toFixed(1);
      console.debug(`[perf-3d] fps=${fps} frameMs=${frameMs}ms`);
      lastPerfLog = now;
    }
  }
  requestAnimationFrame(loop);
}

export function getScene()    { return _scene; }
export function getCamera()   { return _camera; }
export function getRenderer() { return _renderer; }
