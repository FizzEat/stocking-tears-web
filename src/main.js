import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createStudioFloor } from './scene/FootGeometry.js';
import { createRoomProps } from './scene/RoomProps.js';
import { createSkinMaterial } from './shaders/skinShader.js';
import { createStockingMaterial } from './shaders/stockingShader.js';
import { loadSculptedLegsAndStockings } from './physics/SculptedStocking.js';
import { GloveHand } from './scene/GloveHand.js';
import { loadCustomGLB } from './scene/ModelLoader.js';
import { FoleyAudio } from './audio/FoleyAudio.js';

// ---------------------------------------------------------------------------
// 1. Renderer, Scene & Warm Sunlit Indoor Room Lighting
// ---------------------------------------------------------------------------
const container = document.getElementById('canvas-container');

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const ambientLight = new THREE.AmbientLight('#ffeede', 0.78);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight('#fff6eb', 1.95);
keyLight.position.set(-2.0, 2.5, 2.8);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight('#ffe4c8', 1.15);
rimLight.position.set(2.4, 1.2, -1.6);
scene.add(rimLight);

const fillLight = new THREE.DirectionalLight('#f5dfd0', 0.65);
fillLight.position.set(0.6, 0.4, 2.4);
scene.add(fillLight);

// ---------------------------------------------------------------------------
// 2. Camera & OrbitControls
//    VIEW 01 = Exact Side-3/4 Seated Pose matching reference video!
//    VIEW 02 = Close-up on elevated slender leg & petite stockinged foot!
// ---------------------------------------------------------------------------
const camera = new THREE.PerspectiveCamera(
  34,
  window.innerWidth / window.innerHeight,
  0.04,
  40
);

const VIEWS = {
  view01: {
    pos: new THREE.Vector3(-1.35, 0.56, 1.02),
    target: new THREE.Vector3(0.02, 0.42, 0.22),
  },
  view02: {
    pos: new THREE.Vector3(-0.74, 0.46, 0.76),
    target: new THREE.Vector3(-0.04, 0.36, 0.32),
  },
};

camera.position.copy(VIEWS.view01.pos);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.target.copy(VIEWS.view01.target);
controls.minDistance = 0.55;
controls.maxDistance = 3.6;
controls.maxPolarAngle = Math.PI * 0.85;
controls.minPolarAngle = Math.PI * 0.14;

controls.mouseButtons = {
  LEFT: null,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.ROTATE,
};

let cameraTransition = null;

function switchView(viewKey) {
  const preset = VIEWS[viewKey];
  if (!preset) return;
  cameraTransition = {
    startPos: camera.position.clone(),
    startTarget: controls.target.clone(),
    endPos: preset.pos.clone(),
    endTarget: preset.target.clone(),
    t: 0,
  };
  document.getElementById('btn-view-01').classList.toggle('active', viewKey === 'view01');
  document.getElementById('btn-view-02').classList.toggle('active', viewKey === 'view02');
}

// ---------------------------------------------------------------------------
// 3. Seated Sculpted Legs & Delicate Feet + Cozy Room Props + Floor
// ---------------------------------------------------------------------------
const skinMaterial = createSkinMaterial();
const stockingMaterial = createStockingMaterial();
const foley = new FoleyAudio();

const characterGroup = new THREE.Group();
scene.add(characterGroup);

// Warm sunlit oak wood floor grounded at y = 0.0
const studioFloor = createStudioFloor();
studioFloor.position.y = 0.0;
scene.add(studioFloor);

// Brass-frame chair, warm oak desk & glossy nude stiletto pump on floor
const roomProps = createRoomProps();
scene.add(roomProps);

let sculpted = null;
loadSculptedLegsAndStockings(skinMaterial, stockingMaterial)
  .then((ctrl) => {
    sculpted = ctrl;
    sculpted.onTear = () => foley.playTearSnap(1.0);
    characterGroup.add(sculpted.skinMesh, sculpted.clothMesh);
    if (sculpted.shortsMesh) {
      characterGroup.add(sculpted.shortsMesh);
    }

    studioFloor.material.uniforms.uLeftFoot.value.copy(sculpted.leftFootCenter);
    studioFloor.material.uniforms.uRightFoot.value.copy(sculpted.rightFootCenter);
  })
  .catch((err) => {
    console.error('Failed to load seated_legs.glb:', err);
  });

const gloveHand = new GloveHand();
gloveHand.group.scale.setScalar(0.75);
scene.add(gloveHand.group);

let customModelRoot = null;

// ---------------------------------------------------------------------------
// 4. Interaction State ('tear' | 'roll')
// ---------------------------------------------------------------------------
let interactionMode = 'tear';

const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const dragIntersect = new THREE.Vector3();

let isDragging = false;
let isHandPinned = false;
let activeRollSide = 0;
let rollDragOffsetY = 0;

let hoverPoint = new THREE.Vector3();
let hoverNormal = new THREE.Vector3(-1, 0, 0);
let isHoveringCloth = false;

const _grabWorldPos = new THREE.Vector3();
const _outNormal = new THREE.Vector3(-1, 0, 0);

function updatePointerNDC(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function raycastCloth() {
  if (!sculpted || !characterGroup.visible) return null;
  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObject(sculpted.clothMesh, false);
  return hits.length > 0 ? hits[0] : null;
}

function computeOutwardNormal(worldPos, out = new THREE.Vector3()) {
  out.subVectors(camera.position, worldPos);
  out.y *= 0.25;
  if (out.lengthSq() < 1e-5) out.set(-1, 0, 0.5);
  return out.normalize();
}

renderer.domElement.addEventListener('pointermove', (e) => {
  updatePointerNDC(e);

  if (isDragging && sculpted) {
    raycaster.setFromCamera(pointerNDC, camera);
    if (raycaster.ray.intersectPlane(dragPlane, dragIntersect)) {
      if (activeRollSide !== 0) {
        sculpted.pullCuff(activeRollSide, dragIntersect.y + rollDragOffsetY);
        foley.playFabricSlide(0.6);
      } else if (sculpted.isGrabbing) {
        dragIntersect.y = Math.max(0.02, Math.min(0.92, dragIntersect.y));
        sculpted.setGrabTarget(dragIntersect);
      }
    }
    return;
  }

  const hit = raycastCloth();
  if (hit) {
    isHoveringCloth = true;
    hoverPoint.copy(hit.point);
    computeOutwardNormal(hit.point, hoverNormal);
    container.classList.add('hover-cloth');
    if (!isHandPinned) gloveHand.setVisible(true);
  } else {
    isHoveringCloth = false;
    container.classList.remove('hover-cloth');
    if (!isHandPinned && !isDragging) gloveHand.setVisible(false);
  }
});

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  updatePointerNDC(e);

  const hit = raycastCloth();
  if (!hit || !sculpted) return;

  if (isHandPinned) {
    sculpted.releaseGrab();
    isHandPinned = false;
    gloveHand.setPinned(false);
  }

  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  dragPlane.setFromNormalAndCoplanarPoint(camDir.negate(), hit.point);

  if (interactionMode === 'roll') {
    activeRollSide = hit.point.x < 0 ? -1 : 1;
    rollDragOffsetY = sculpted.cuffY[String(activeRollSide)] - hit.point.y;
    sculpted.pullCuff(activeRollSide, sculpted.cuffY[String(activeRollSide)]);
    isDragging = true;
    container.classList.add('grabbing');
    gloveHand.setVisible(true);
  } else if (sculpted.grabAtHit(hit)) {
    isDragging = true;
    container.classList.add('grabbing');
    gloveHand.setVisible(true);
  }
});

function endDrag() {
  if (!isDragging) return;
  isDragging = false;
  container.classList.remove('grabbing');

  if (activeRollSide !== 0 && sculpted) {
    sculpted.releaseCuff();
    activeRollSide = 0;
  }
  if (!isHandPinned && sculpted && sculpted.isGrabbing) {
    sculpted.releaseGrab();
  }
}

window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

// ---------------------------------------------------------------------------
// 5. Mode Switcher, Color Palette, Inspector Sliders & Presets
// ---------------------------------------------------------------------------
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('status-toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2000);
}

function setMode(mode) {
  if (interactionMode === mode) return;
  interactionMode = mode;
  isDragging = false;
  isHandPinned = false;
  gloveHand.setPinned(false);
  activeRollSide = 0;
  if (sculpted) sculpted.releaseGrab();

  document.getElementById('btn-mode-tear').classList.toggle('active', mode === 'tear');
  document.getElementById('btn-mode-roll').classList.toggle('active', mode === 'roll');
  showToast(
    mode === 'roll'
      ? '脱袜子模式：左键向下拖拽即可将丝袜卷边褪下'
      : '撕裂 / 勾丝模式：左键捏住丝袜拉扯即可起皱、撕开破口与抽丝'
  );
}

document.getElementById('btn-mode-tear').addEventListener('click', () => setMode('tear'));
document.getElementById('btn-mode-roll').addEventListener('click', () => setMode('roll'));

function togglePinHand() {
  if (isHandPinned) {
    isHandPinned = false;
    gloveHand.setPinned(false);
    if (!isDragging && sculpted) sculpted.releaseGrab();
    if (!isHoveringCloth) gloveHand.setVisible(false);
    showToast('已松开手部');
  } else if (sculpted && sculpted.isGrabbing) {
    isHandPinned = true;
    gloveHand.setPinned(true);
    showToast('已固定手部（可右键旋转视角观察，按 1 松开）');
  } else {
    showToast('请先用左键拉住丝袜，再按 1 固定手部');
  }
}

function repairAllTears() {
  isHandPinned = false;
  isDragging = false;
  gloveHand.setPinned(false);
  if (sculpted) sculpted.repair();
  showToast('已还原所有破损并穿回丝袜');
}

function setColorMode(mode) {
  const u = stockingMaterial.uniforms;
  if (mode === 'white') {
    u.uColorMode.value = 1.0;
    u.uFabricBaseColor.value.setRGB(0.46, 0.48, 0.52);
    u.uFabricSheenColor.value.setRGB(0.86, 0.88, 0.92);
    u.uFrostCoverage.value = 0.68;
  } else if (mode === 'purple') {
    u.uColorMode.value = 0.72;
    u.uFabricBaseColor.value.setRGB(0.26, 0.07, 0.38);
    u.uFabricSheenColor.value.setRGB(0.76, 0.44, 0.95);
    u.uFrostCoverage.value = 0.54;
  } else if (mode === 'pink') {
    u.uColorMode.value = 0.78;
    u.uFabricBaseColor.value.setRGB(0.62, 0.14, 0.28);
    u.uFabricSheenColor.value.setRGB(0.98, 0.52, 0.68);
    u.uFrostCoverage.value = 0.52;
  } else if (mode === 'green') {
    u.uColorMode.value = 0.76;
    u.uFabricBaseColor.value.setRGB(0.18, 0.44, 0.10);
    u.uFabricSheenColor.value.setRGB(0.62, 0.92, 0.38);
    u.uFrostCoverage.value = 0.52;
  } else {
    u.uColorMode.value = 0.0;
    u.uFabricBaseColor.value.setRGB(0.012, 0.014, 0.018);
    u.uFabricSheenColor.value.setRGB(0.14, 0.15, 0.18);
    u.uFrostCoverage.value = 0.76;
  }
  document.getElementById('btn-color-black').classList.toggle('active', mode === 'black');
  document.getElementById('btn-color-white').classList.toggle('active', mode === 'white');
  document.getElementById('btn-color-purple').classList.toggle('active', mode === 'purple');
  document.getElementById('btn-color-pink').classList.toggle('active', mode === 'pink');
  document.getElementById('btn-color-green').classList.toggle('active', mode === 'green');
}

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === '1') togglePinHand();
  else if (e.key === '2') repairAllTears();
});

document.getElementById('btn-view-01').addEventListener('click', () => switchView('view01'));
document.getElementById('btn-view-02').addEventListener('click', () => switchView('view02'));
document.getElementById('btn-color-black').addEventListener('click', () => setColorMode('black'));
document.getElementById('btn-color-white').addEventListener('click', () => setColorMode('white'));
document.getElementById('btn-color-purple').addEventListener('click', () => setColorMode('purple'));
document.getElementById('btn-color-pink').addEventListener('click', () => setColorMode('pink'));
document.getElementById('btn-color-green').addEventListener('click', () => setColorMode('green'));
document.getElementById('hint-pin').addEventListener('click', togglePinHand);
document.getElementById('hint-repair').addEventListener('click', repairAllTears);

const audioBtn = document.getElementById('btn-toggle-audio');
audioBtn.addEventListener('click', () => {
  const nextMuted = !foley.muted;
  foley.setMuted(nextMuted);
  audioBtn.querySelector('span').textContent = nextMuted ? '🔇 静音' : '🔊 音效';
});

const settingsPanel = document.getElementById('settings-panel');
document.getElementById('btn-toggle-panel').addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
});

const sliderBindings = [
  ['sl-weave-tiling', 'val-weave-tiling', (v) => (stockingMaterial.uniforms.uWeaveTiling.value = v), 1],
  ['sl-weave-normal', 'val-weave-normal', (v) => (stockingMaterial.uniforms.uWeaveNormalStrength.value = v), 2],
  ['sl-weave-contrast', 'val-weave-contrast', (v) => (stockingMaterial.uniforms.uWeaveContrast.value = v), 3],
  ['sl-wrinkle', 'val-wrinkle', (v) => (stockingMaterial.uniforms.uWrinkleStrength.value = v), 2],
  ['sl-tension-boost', 'val-tension-boost', (v) => (stockingMaterial.uniforms.uTensionNormalBoost.value = v), 2],
  ['slider-tear', 'val-tear', (v) => { if (sculpted) sculpted.tearSensitivity = v; }, 2],
  ['slider-bulge', 'val-bulge', (v) => { if (sculpted) sculpted.bulgeStrength = v; }, 2],
  ['sl-pearl-strength', 'val-pearl-strength', (v) => (stockingMaterial.uniforms.uPearlStrength.value = v), 2],
  ['sl-pearl-scale', 'val-pearl-scale', (v) => (stockingMaterial.uniforms.uPearlGrainScale.value = v), 0],
  ['sl-pearl-spec', 'val-pearl-spec', (v) => (stockingMaterial.uniforms.uPearlSpecularStrength.value = v), 2],
  ['sl-pearl-edge', 'val-pearl-edge', (v) => (stockingMaterial.uniforms.uPearlEdgeStrength.value = v), 2],
  ['sl-glint-strength', 'val-glint-strength', (v) => (stockingMaterial.uniforms.uPearlGlintStrength.value = v), 2],
  ['sl-glint-density', 'val-glint-density', (v) => (stockingMaterial.uniforms.uPearlGlintDensity.value = v), 2],
  ['sl-frost-cov', 'val-frost-cov', (v) => (stockingMaterial.uniforms.uFrostCoverage.value = v), 2],
  ['sl-frost-clear', 'val-frost-clear', (v) => (stockingMaterial.uniforms.uFrostClearAtStretch.value = v), 2],
  ['sl-frost-smooth', 'val-frost-smooth', (v) => (stockingMaterial.uniforms.uFrostMatteSmoothness.value = v), 2],
];

const sliderSetters = {};
for (const [id, valId, apply, decimals] of sliderBindings) {
  const input = document.getElementById(id);
  const label = document.getElementById(valId);
  const update = (val) => {
    input.value = val;
    label.textContent = Number(val).toFixed(decimals);
    apply(Number(val));
  };
  input.addEventListener('input', (e) => update(parseFloat(e.target.value)));
  sliderSetters[id] = update;
}

const PRESETS = {
  matteBlack: {
    color: 'black',
    'sl-frost-cov': 0.80,
    'sl-frost-clear': 1.0,
    'sl-frost-smooth': 0.85,
    'sl-pearl-strength': 0.32,
    'sl-pearl-spec': 0.52,
    'sl-glint-strength': 0.65,
    'sl-glint-density': 0.09,
  },
  pearlBlack: {
    color: 'black',
    'sl-frost-cov': 0.68,
    'sl-frost-clear': 1.15,
    'sl-frost-smooth': 0.94,
    'sl-pearl-strength': 0.82,
    'sl-pearl-spec': 1.12,
    'sl-glint-strength': 1.25,
    'sl-glint-density': 0.16,
  },
  sheer20d: {
    color: 'purple',
    'sl-frost-cov': 0.48,
    'sl-frost-clear': 1.25,
    'sl-frost-smooth': 0.92,
    'sl-pearl-strength': 0.62,
    'sl-pearl-spec': 0.95,
    'sl-glint-strength': 0.50,
    'sl-glint-density': 0.08,
  },
  milkWhite: {
    color: 'white',
    'sl-frost-cov': 0.72,
    'sl-frost-clear': 0.95,
    'sl-frost-smooth': 0.82,
    'sl-pearl-strength': 0.48,
    'sl-pearl-spec': 0.62,
    'sl-glint-strength': 0.60,
    'sl-glint-density': 0.09,
  },
};

document.querySelectorAll('.preset-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    const preset = PRESETS[btn.dataset.preset];
    if (!preset) return;
    setColorMode(preset.color);
    for (const [k, v] of Object.entries(preset)) {
      if (k !== 'color' && sliderSetters[k]) sliderSetters[k](v);
    }
    showToast(`已切换预设：${btn.textContent}`);
  });
});

// Custom .glb Model Import
const glbInput = document.getElementById('glb-file-input');
const resetModelBtn = document.getElementById('btn-reset-model');

glbInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    showToast(`正在加载 ${file.name} ...`);
    const model = await loadCustomGLB(file);
    if (customModelRoot) scene.remove(customModelRoot);
    customModelRoot = model;
    scene.add(customModelRoot);
    characterGroup.visible = false;
    roomProps.visible = false;
    resetModelBtn.classList.remove('hidden');
    showToast(`已导入 ${file.name}`);
  } catch (err) {
    console.error(err);
    showToast('模型加载失败，请确认是有效的 .glb / .gltf 文件');
  }
  glbInput.value = '';
});

resetModelBtn.addEventListener('click', () => {
  if (customModelRoot) {
    scene.remove(customModelRoot);
    customModelRoot = null;
  }
  characterGroup.visible = true;
  roomProps.visible = true;
  resetModelBtn.classList.add('hidden');
  showToast('已恢复坐姿精雕 3D 场景');
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// 6. Main Animation Loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 1 / 30);

  if (cameraTransition) {
    cameraTransition.t += dt * 3.4;
    const k = Math.min(1, cameraTransition.t);
    const ease = 1 - Math.pow(1 - k, 3);
    camera.position.lerpVectors(cameraTransition.startPos, cameraTransition.endPos, ease);
    controls.target.lerpVectors(cameraTransition.startTarget, cameraTransition.endTarget, ease);
    if (k >= 1) cameraTransition = null;
  }

  controls.update();

  if (sculpted) {
    sculpted.step(dt);
  }

  if (sculpted && activeRollSide !== 0 && isDragging) {
    sculpted.getCuffHandlePoint(activeRollSide, _grabWorldPos);
    computeOutwardNormal(_grabWorldPos, _outNormal);
    gloveHand.updatePose(_grabWorldPos, _outNormal, true, dt);
  } else if (sculpted && sculpted.isGrabbing && (isDragging || isHandPinned)) {
    sculpted.getGrabPosition(_grabWorldPos);
    computeOutwardNormal(_grabWorldPos, _outNormal);
    gloveHand.updatePose(_grabWorldPos, _outNormal, true, dt);

    stockingMaterial.uniforms.uPinchWorldPos.value.copy(_grabWorldPos);
    stockingMaterial.uniforms.uPinchActive.value +=
      (1.0 - stockingMaterial.uniforms.uPinchActive.value) * 0.25;
  } else {
    if (isHoveringCloth) {
      gloveHand.updatePose(hoverPoint, hoverNormal, false, dt);
    }
    stockingMaterial.uniforms.uPinchActive.value *= 0.86;
  }

  renderer.render(scene, camera);
}

animate();
