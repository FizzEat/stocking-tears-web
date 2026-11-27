import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createProceduralCharacter } from './scene/ProceduralCharacter.js';
import { createStockingMaterial } from './shaders/stockingShader.js';
import { TearableStocking } from './physics/TearableStocking.js';
import { OuterSock } from './physics/OuterSock.js';
import { RibbonBow } from './physics/RibbonBow.js';
import { GloveHand } from './scene/GloveHand.js';
import { loadCustomGLB } from './scene/ModelLoader.js';
import { FoleyAudio } from './audio/FoleyAudio.js';

// ---------------------------------------------------------------------------
// 1. Renderer, Scene & Studio Lighting
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

const ambientLight = new THREE.AmbientLight('#8aa3b8', 0.55);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight('#fff2e8', 2.05);
keyLight.position.set(-2.2, 2.4, 3.0);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight('#7be0f5', 1.85);
rimLight.position.set(2.8, 0.9, -1.8);
scene.add(rimLight);

const fillLight = new THREE.DirectionalLight('#b7c9d9', 0.65);
fillLight.position.set(0.8, -1.5, 2.6);
scene.add(fillLight);

// ---------------------------------------------------------------------------
// 2. Camera & OrbitControls (VIEW 01 / VIEW 02)
// ---------------------------------------------------------------------------
const camera = new THREE.PerspectiveCamera(
  34,
  window.innerWidth / window.innerHeight,
  0.05,
  50
);

const VIEWS = {
  view01: {
    pos: new THREE.Vector3(0.05, 0.02, 2.58),
    target: new THREE.Vector3(0.01, -0.04, 0.0),
  },
  view02: {
    pos: new THREE.Vector3(1.16, -0.10, 1.52),
    target: new THREE.Vector3(0.14, -0.18, 0.02),
  },
  stage1Socks: {
    pos: new THREE.Vector3(0.05, -0.78, 2.22),
    target: new THREE.Vector3(0.01, -0.96, 0.0),
  },
  stage3Ribbon: {
    pos: new THREE.Vector3(0.04, 0.56, 1.62),
    target: new THREE.Vector3(0.01, 0.52, 0.25),
  },
};

camera.position.copy(VIEWS.view01.pos);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.target.copy(VIEWS.view01.target);
controls.minDistance = 0.85;
controls.maxDistance = 4.5;
controls.maxPolarAngle = Math.PI * 0.82;
controls.minPolarAngle = Math.PI * 0.18;

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
// 3. Procedural Character + Tearable Stockings + Gloved Hand
// ---------------------------------------------------------------------------
const character = createProceduralCharacter();
scene.add(character.group);

const stockingMaterial = createStockingMaterial();
const leftStocking = new TearableStocking(-1, stockingMaterial);
const rightStocking = new TearableStocking(1, stockingMaterial);

const foley = new FoleyAudio();
leftStocking.onTear = () => foley.playTearSnap(1.0);
rightStocking.onTear = () => foley.playTearSnap(1.0);

const stockingGroup = new THREE.Group();
stockingGroup.add(leftStocking.mesh, leftStocking.frayMesh);
stockingGroup.add(rightStocking.mesh, rightStocking.frayMesh);
scene.add(stockingGroup);

// Stage 1: Outer Ribbed Knit Socks (visible in Challenge Mode)
const leftOuterSock = new OuterSock(-1);
const rightOuterSock = new OuterSock(1);
const outerSockGroup = new THREE.Group();
outerSockGroup.add(leftOuterSock.mesh, rightOuterSock.mesh);
outerSockGroup.visible = false;
scene.add(outerSockGroup);

// Stage 3: Interactive Satin Ribbon Bow on pleated skirt waist
const ribbonBow = new RibbonBow();
ribbonBow.group.visible = false;
scene.add(ribbonBow.group);

const gloveHand = new GloveHand();
scene.add(gloveHand.group);

// Subtle pulsing 3D guide ring for Challenge Mode interactive targets
const guideRingGeom = new THREE.RingGeometry(0.032, 0.044, 32);
const guideRingMat = new THREE.MeshBasicMaterial({
  color: '#7be0f5',
  transparent: true,
  opacity: 0.72,
  side: THREE.DoubleSide,
  depthTest: false,
});
const guideRing = new THREE.Mesh(guideRingGeom, guideRingMat);
guideRing.renderOrder = 9;
guideRing.visible = false;
scene.add(guideRing);

let prevSockLRemoved = false;
let prevSockRRemoved = false;

let customModelRoot = null;

// ---------------------------------------------------------------------------
// 4. Interaction State ('challenge' | 'tear' | 'roll')
// ---------------------------------------------------------------------------
let interactionMode = 'tear'; // 'challenge' | 'tear' | 'roll'
let challengeStage = 1; // 1: Outer Socks, 2: Roll Stockings, 3: Untie Ribbon Bow, 4: Clear!

const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const dragIntersect = new THREE.Vector3();

let activeStocking = null;
let activeOuterSock = null;
let activeRibbonPull = false;
let isDragging = false;
let isHandPinned = false;
let rollDragOffsetY = 0;

let hoverPoint = new THREE.Vector3();
let hoverNormal = new THREE.Vector3(1, 0, 0);
let isHoveringCloth = false;

const _tmpVec = new THREE.Vector3();
const _grabWorldPos = new THREE.Vector3();
const _outNormal = new THREE.Vector3(1, 0, 0);

function updatePointerNDC(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function raycastInteractive() {
  raycaster.setFromCamera(pointerNDC, camera);

  if (interactionMode === 'challenge') {
    if (challengeStage === 1 && outerSockGroup.visible) {
      const targets = [];
      if (!leftOuterSock.removed) targets.push(leftOuterSock.mesh);
      if (!rightOuterSock.removed) targets.push(rightOuterSock.mesh);
      const hits = raycaster.intersectObjects(targets, false);
      return hits.length > 0 ? { kind: 'outerSock', hit: hits[0] } : null;
    }
    if (challengeStage === 2 && stockingGroup.visible) {
      const hits = raycaster.intersectObjects([leftStocking.mesh, rightStocking.mesh], false);
      return hits.length > 0 ? { kind: 'stocking', hit: hits[0] } : null;
    }
    if (challengeStage === 3 && ribbonBow.group.visible && !ribbonBow.untied) {
      const hits = raycaster.intersectObjects(ribbonBow.getInteractiveMeshes(), false);
      return hits.length > 0 ? { kind: 'ribbon', hit: hits[0] } : null;
    }
    return null;
  }

  if (!stockingGroup.visible) return null;
  const hits = raycaster.intersectObjects([leftStocking.mesh, rightStocking.mesh], false);
  return hits.length > 0 ? { kind: 'stocking', hit: hits[0] } : null;
}

function computeOutwardNormal(stocking, worldPos, out = new THREE.Vector3()) {
  const legCenterX = stocking.side * 0.22;
  out.set(worldPos.x - legCenterX, 0.0, worldPos.z);
  if (out.lengthSq() < 1e-5) out.set(stocking.side, 0, 0.5);
  return out.normalize();
}

renderer.domElement.addEventListener('pointermove', (e) => {
  updatePointerNDC(e);

  if (isDragging) {
    raycaster.setFromCamera(pointerNDC, camera);
    if (raycaster.ray.intersectPlane(dragPlane, dragIntersect)) {
      if (activeOuterSock) {
        activeOuterSock.pullTo(dragIntersect.y + rollDragOffsetY, dragIntersect);
        foley.playFabricSlide(0.55);
      } else if (activeRibbonPull) {
        ribbonBow.dragPull(dragIntersect);
        foley.playFabricSlide(0.75);
      } else if (activeStocking) {
        if (interactionMode === 'roll' || (interactionMode === 'challenge' && challengeStage === 2)) {
          activeStocking.pullCuffTo(dragIntersect.y + rollDragOffsetY, dragIntersect);
          foley.playFabricSlide(0.6);
        } else {
          const legCenterX = activeStocking.side * 0.22;
          _tmpVec.set(dragIntersect.x - legCenterX, 0, dragIntersect.z);
          if (_tmpVec.length() > 0.72) {
            _tmpVec.setLength(0.72);
            dragIntersect.x = legCenterX + _tmpVec.x;
            dragIntersect.z = _tmpVec.z;
          }
          dragIntersect.y = Math.max(-1.42, Math.min(0.62, dragIntersect.y));
          activeStocking.setGrabTarget(dragIntersect);
        }
      }
    }
    return;
  }

  const res = raycastInteractive();
  if (res) {
    isHoveringCloth = true;
    hoverPoint.copy(res.hit.point);
    if (res.kind === 'outerSock') {
      computeOutwardNormal(res.hit.object.userData.outerSock, res.hit.point, hoverNormal);
    } else if (res.kind === 'stocking') {
      computeOutwardNormal(res.hit.object.userData.stocking, res.hit.point, hoverNormal);
    } else {
      hoverNormal.set(0.2, 0.0, 1.0).normalize();
    }
    container.classList.add('hover-cloth');
    if (!isHandPinned) {
      gloveHand.setVisible(true);
    }
  } else {
    isHoveringCloth = false;
    container.classList.remove('hover-cloth');
    if (!isHandPinned && !isDragging) {
      gloveHand.setVisible(false);
    }
  }
});

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  updatePointerNDC(e);

  const res = raycastInteractive();
  if (!res) return;

  if (isHandPinned && activeStocking) {
    activeStocking.releaseGrab();
    activeStocking.releaseCuffGrip();
    isHandPinned = false;
    gloveHand.setPinned(false);
  }

  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  dragPlane.setFromNormalAndCoplanarPoint(camDir.negate(), res.hit.point);

  if (res.kind === 'outerSock') {
    const sock = res.hit.object.userData.outerSock;
    activeOuterSock = sock;
    isDragging = true;
    rollDragOffsetY = sock.cuffY - res.hit.point.y;
    sock.pullTo(sock.cuffY, res.hit.point);
    container.classList.add('grabbing');
    gloveHand.setVisible(true);
    return;
  }

  if (res.kind === 'ribbon') {
    const tailSide = res.hit.object.userData.ribbonTail || 1;
    if (ribbonBow.startPull(tailSide, res.hit.point)) {
      activeRibbonPull = true;
      isDragging = true;
      container.classList.add('grabbing');
      gloveHand.setVisible(true);
    }
    return;
  }

  const st = res.hit.object.userData.stocking;
  if (interactionMode === 'roll' || (interactionMode === 'challenge' && challengeStage === 2)) {
    activeStocking = st;
    isDragging = true;
    rollDragOffsetY = st.cuffY - res.hit.point.y;
    st.pullCuffTo(st.cuffY, res.hit.point);
    container.classList.add('grabbing');
    gloveHand.setVisible(true);
  } else if (st.grabAtPoint(res.hit.point)) {
    activeStocking = st;
    isDragging = true;
    container.classList.add('grabbing');
    gloveHand.setVisible(true);
  }
});

function endDrag() {
  if (!isDragging) return;
  isDragging = false;
  container.classList.remove('grabbing');

  if (activeOuterSock) {
    activeOuterSock.releaseGrip();
    activeOuterSock = null;
  }
  if (activeRibbonPull) {
    ribbonBow.releasePull();
    activeRibbonPull = false;
  }

  if (!isHandPinned && activeStocking) {
    if (interactionMode === 'roll' || interactionMode === 'challenge') {
      activeStocking.releaseCuffGrip();
    } else {
      activeStocking.releaseGrab();
    }
    activeStocking = null;
  }
}

window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

// ---------------------------------------------------------------------------
// 5. Mode Switcher, Inspector Sliders & Presets
// ---------------------------------------------------------------------------
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('status-toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2000);
}

const challengeHud = document.getElementById('challenge-hud');
const challengeGoalEl = document.getElementById('challenge-goal');
const challengeFillEl = document.getElementById('challenge-progress-fill');
const challengeTextEl = document.getElementById('challenge-progress-text');

function updateChallengeHUD(progress01) {
  const pct = Math.round(Math.max(0, Math.min(1, progress01)) * 100);
  challengeFillEl.style.width = `${pct}%`;
  challengeTextEl.textContent = `${pct}%`;

  const s1 = document.getElementById('step-1');
  const s2 = document.getElementById('step-2');
  const s3 = document.getElementById('step-3');

  s1.className = 'stage-pill' + (challengeStage === 1 ? ' active' : challengeStage > 1 ? ' done' : '');
  s2.className = 'stage-pill' + (challengeStage === 2 ? ' active' : challengeStage > 2 ? ' done' : '');
  s3.className = 'stage-pill' + (challengeStage === 3 ? ' active' : challengeStage > 3 ? ' done' : '');

  if (challengeStage === 1) {
    challengeGoalEl.textContent = '第 1 关：向下拖拽褪下左右腿的针织短袜';
  } else if (challengeStage === 2) {
    challengeGoalEl.textContent = '第 2 关：向下拖拽褪下左右腿的丝袜（过膝以下）';
  } else if (challengeStage === 3) {
    challengeGoalEl.textContent = '第 3 关：拉住裙摆蝴蝶结丝带尾端向外下拉解开';
  } else {
    challengeGoalEl.textContent = '🎉 全部 3 关通关！点击「重玩」或切换自由模式';
  }
}

function startChallengeMode() {
  challengeStage = 1;
  prevSockLRemoved = false;
  prevSockRRemoved = false;
  leftOuterSock.reset();
  rightOuterSock.reset();
  leftStocking.repair();
  rightStocking.repair();
  ribbonBow.reset();

  outerSockGroup.visible = true;
  ribbonBow.group.visible = true;
  challengeHud.classList.remove('hidden');

  updateChallengeHUD(0);
  switchView('stage1Socks');
  showToast('闯关开始！第 1 关：先脱掉左右腿针织短袜');
}

function setMode(mode) {
  if (interactionMode === mode && mode !== 'challenge') return;
  interactionMode = mode;
  isDragging = false;
  isHandPinned = false;
  gloveHand.setPinned(false);
  activeOuterSock = null;
  activeRibbonPull = false;

  if (activeStocking) {
    activeStocking.releaseGrab();
    activeStocking.releaseCuffGrip();
    activeStocking = null;
  }

  document.getElementById('btn-mode-challenge').classList.toggle('active', mode === 'challenge');
  document.getElementById('btn-mode-tear').classList.toggle('active', mode === 'tear');
  document.getElementById('btn-mode-roll').classList.toggle('active', mode === 'roll');

  if (mode === 'challenge') {
    startChallengeMode();
  } else {
    challengeHud.classList.add('hidden');
    outerSockGroup.visible = false;
    ribbonBow.group.visible = false;
    switchView('view01');
    showToast(
      mode === 'roll'
        ? '脱袜子模式：左键向下拖拽即可将丝袜卷边褪下（左右腿独立）'
        : '撕裂 / 勾丝模式：左键拉扯即可产生褶皱、撕裂破口与纵向抽丝'
    );
  }
}

document.getElementById('btn-mode-challenge').addEventListener('click', () => setMode('challenge'));
document.getElementById('btn-mode-tear').addEventListener('click', () => setMode('tear'));
document.getElementById('btn-mode-roll').addEventListener('click', () => setMode('roll'));
document.getElementById('btn-challenge-restart').addEventListener('click', () => {
  if (interactionMode === 'challenge') startChallengeMode();
});

function togglePinHand() {
  if (isHandPinned) {
    isHandPinned = false;
    gloveHand.setPinned(false);
    if (!isDragging && activeStocking) {
      activeStocking.releaseGrab();
      activeStocking.releaseCuffGrip();
      activeStocking = null;
    }
    if (!isHoveringCloth) {
      gloveHand.setVisible(false);
    }
    showToast('已松开手部');
  } else if (activeStocking) {
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
  activeStocking = null;
  leftStocking.repair();
  rightStocking.repair();
  showToast('已还原所有破损并穿回丝袜');
}

function setColorMode(mode) {
  const isWhite = mode === 'white';
  stockingMaterial.uniforms.uColorMode.value = isWhite ? 1.0 : 0.0;
  leftStocking.setFrayColorMode(isWhite);
  rightStocking.setFrayColorMode(isWhite);

  document.getElementById('btn-color-black').classList.toggle('active', !isWhite);
  document.getElementById('btn-color-white').classList.toggle('active', isWhite);
}

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === '1') {
    togglePinHand();
  } else if (e.key === '2') {
    repairAllTears();
  }
});

document.getElementById('btn-view-01').addEventListener('click', () => switchView('view01'));
document.getElementById('btn-view-02').addEventListener('click', () => switchView('view02'));
document.getElementById('btn-color-black').addEventListener('click', () => setColorMode('black'));
document.getElementById('btn-color-white').addEventListener('click', () => setColorMode('white'));
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

// Bind all Unity-Inspector style sliders
const sliderBindings = [
  ['sl-weave-tiling', 'val-weave-tiling', (v) => (stockingMaterial.uniforms.uWeaveTiling.value = v), 1],
  ['sl-weave-normal', 'val-weave-normal', (v) => (stockingMaterial.uniforms.uWeaveNormalStrength.value = v), 2],
  ['sl-weave-contrast', 'val-weave-contrast', (v) => (stockingMaterial.uniforms.uWeaveContrast.value = v), 3],
  ['sl-wrinkle', 'val-wrinkle', (v) => (stockingMaterial.uniforms.uWrinkleStrength.value = v), 2],
  ['sl-tension-boost', 'val-tension-boost', (v) => (stockingMaterial.uniforms.uTensionNormalBoost.value = v), 2],
  ['slider-tear', 'val-tear', (v) => { leftStocking.tearSensitivity = rightStocking.tearSensitivity = v; }, 2],
  ['slider-bulge', 'val-bulge', (v) => { leftStocking.bulgeStrength = rightStocking.bulgeStrength = v; }, 2],
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

// 1-click Material Presets
const PRESETS = {
  matteBlack: {
    color: 'black',
    'sl-frost-cov': 0.82,
    'sl-frost-clear': 1.0,
    'sl-frost-smooth': 0.85,
    'sl-pearl-strength': 0.25,
    'sl-pearl-spec': 0.42,
    'sl-glint-strength': 0.55,
    'sl-glint-density': 0.08,
  },
  pearlBlack: {
    color: 'black',
    'sl-frost-cov': 0.68,
    'sl-frost-clear': 1.15,
    'sl-frost-smooth': 0.94,
    'sl-pearl-strength': 0.88,
    'sl-pearl-spec': 1.18,
    'sl-glint-strength': 1.45,
    'sl-glint-density': 0.22,
  },
  sheer20d: {
    color: 'black',
    'sl-frost-cov': 0.36,
    'sl-frost-clear': 1.25,
    'sl-frost-smooth': 0.80,
    'sl-pearl-strength': 0.45,
    'sl-pearl-spec': 0.68,
    'sl-glint-strength': 0.90,
    'sl-glint-density': 0.14,
  },
  milkWhite: {
    color: 'white',
    'sl-frost-cov': 0.76,
    'sl-frost-clear': 0.95,
    'sl-frost-smooth': 0.82,
    'sl-pearl-strength': 0.48,
    'sl-pearl-spec': 0.62,
    'sl-glint-strength': 0.80,
    'sl-glint-density': 0.12,
  },
};

document.querySelectorAll('.preset-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    const preset = PRESETS[btn.dataset.preset];
    if (!preset) return;
    setColorMode(preset.color);
    for (const [k, v] of Object.entries(preset)) {
      if (k !== 'color' && sliderSetters[k]) {
        sliderSetters[k](v);
      }
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
    if (customModelRoot) {
      scene.remove(customModelRoot);
    }
    customModelRoot = model;
    scene.add(customModelRoot);
    character.group.visible = false;
    resetModelBtn.classList.remove('hidden');
    showToast(`已导入 ${file.name}（丝袜交互层保持叠加）`);
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
  character.group.visible = true;
  resetModelBtn.classList.add('hidden');
  showToast('已恢复内置 3D 模型');
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

  leftStocking.step(dt);
  rightStocking.step(dt);

  leftStocking.updateSkinBulge(character.leftLeg);
  rightStocking.updateSkinBulge(character.rightLeg);

  if (outerSockGroup.visible) {
    leftOuterSock.step(dt);
    rightOuterSock.step(dt);
    if (leftOuterSock.removed && !prevSockLRemoved) {
      prevSockLRemoved = true;
      foley.playPop();
    }
    if (rightOuterSock.removed && !prevSockRRemoved) {
      prevSockRRemoved = true;
      foley.playPop();
    }
  }
  if (ribbonBow.group.visible) {
    ribbonBow.updateVisuals(clock.elapsedTime, dt);
  }

  // Stage Challenge Progression Logic & 3D Pulsing Guide Beacon
  if (interactionMode === 'challenge') {
    const pulse = 1.0 + Math.sin(clock.elapsedTime * 5.0) * 0.16;
    guideRing.scale.setScalar(pulse);
    guideRing.quaternion.copy(camera.quaternion);

    if (challengeStage === 1) {
      const p1 = (leftOuterSock.getProgress() + rightOuterSock.getProgress()) * 0.5;
      updateChallengeHUD(p1);
      if (!isDragging) {
        const targetSock = !rightOuterSock.removed ? rightOuterSock : leftOuterSock;
        if (!targetSock.removed) {
          guideRing.visible = true;
          guideRing.position.set(targetSock.side * 0.22, targetSock.cuffY - 0.04, 0.16);
        }
      } else {
        guideRing.visible = false;
      }

      if (leftOuterSock.removed && rightOuterSock.removed) {
        challengeStage = 2;
        activeOuterSock = null;
        isDragging = false;
        updateChallengeHUD(0);
        switchView('view01');
        foley.playStageClear(false);
        showToast('✅ 第 1 关通过！解锁第 2 关：褪下双腿丝袜');
      }
    } else if (challengeStage === 2) {
      const rollRange = 0.66 - (-0.72);
      const pL = Math.max(0, Math.min(1, (0.66 - leftStocking.cuffY) / rollRange));
      const pR = Math.max(0, Math.min(1, (0.66 - rightStocking.cuffY) / rollRange));
      const p2 = (pL + pR) * 0.5;
      updateChallengeHUD(p2);

      if (!isDragging) {
        const side = pR < 0.92 ? 1 : -1;
        const cuffY = side > 0 ? rightStocking.cuffY : leftStocking.cuffY;
        guideRing.visible = true;
        guideRing.position.set(side * 0.22, Math.min(0.28, cuffY - 0.08), 0.21);
      } else {
        guideRing.visible = false;
      }

      if (pL >= 0.92 && pR >= 0.92) {
        challengeStage = 3;
        if (activeStocking) activeStocking.releaseCuffGrip();
        activeStocking = null;
        isDragging = false;
        updateChallengeHUD(0);
        switchView('stage3Ribbon');
        foley.playStageClear(false);
        showToast('✅ 第 2 关通过！解锁第 3 关：解开裙摆蝴蝶结');
      }
    } else if (challengeStage === 3) {
      updateChallengeHUD(ribbonBow.untieProgress);
      if (!isDragging && !ribbonBow.untied) {
        guideRing.visible = true;
        guideRing.position.set(0.09, 0.50, 0.41);
      } else {
        guideRing.visible = false;
      }

      if (ribbonBow.untied) {
        challengeStage = 4;
        activeRibbonPull = false;
        isDragging = false;
        guideRing.visible = false;
        updateChallengeHUD(1);
        switchView('view01');
        foley.playPop();
        foley.playStageClear(true);
        showToast('🎉 恭喜全部 3 关通关！');
      }
    } else {
      guideRing.visible = false;
    }
  } else {
    guideRing.visible = false;
  }

  if (activeOuterSock && isDragging) {
    activeOuterSock.getHandlePoint(_grabWorldPos);
    computeOutwardNormal(activeOuterSock, _grabWorldPos, _outNormal);
    gloveHand.updatePose(_grabWorldPos, _outNormal, true, dt);
  } else if (activeRibbonPull && isDragging) {
    ribbonBow.getHandleWorldPos(_grabWorldPos);
    _outNormal.set(0.2, 0.0, 1.0).normalize();
    gloveHand.updatePose(_grabWorldPos, _outNormal, true, dt);
  } else if (activeStocking && (isDragging || isHandPinned)) {
    if (interactionMode === 'roll' || (interactionMode === 'challenge' && challengeStage === 2)) {
      activeStocking.getCuffHandlePoint(_grabWorldPos);
    } else {
      activeStocking.getGrabPosition(_grabWorldPos);
    }
    computeOutwardNormal(activeStocking, _grabWorldPos, _outNormal);
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
