import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MAX_SDF_TEARS } from '../shaders/stockingShader.js';

const FLOOR_Y = 0.0;
const STOCKING_TOP_Y = 0.72;

/**
 * Loads the posed seated female legs & delicate 5-toe feet (./models/seated_legs.glb)
 * and builds:
 *   1. Sculpted Seated Skin Mesh (with dynamic SDF raised-skin bulge & warm rim AO)
 *   2. Surface-Hugging Interactive Sheer Stocking Mesh (real-time elastic pinch/pull
 *      spring physics, per-pixel analytical almond SDF tears & vertical ladders,
 *      and independent left/right Roll-Down cuff bunching!)
 *   3. Tailored DarkShorts mesh covering the seated hips/pelvis cleanly
 */
export async function loadSculptedLegsAndStockings(skinMaterial, stockingMaterial) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync('./models/seated_legs.glb');

  let sourceGeom = null;
  let briefGeom = null;
  let sweaterGeom = null;
  gltf.scene.traverse((obj) => {
    if (obj.isMesh) {
      if (obj.name.includes('SeatedLegsSkin') || obj.name.includes('morphed_female.001')) {
        sourceGeom = obj.geometry;
      } else if (obj.name.includes('DarkBrief') || obj.name.includes('morphed_female.002')) {
        briefGeom = obj.geometry;
      } else if (obj.name.includes('CreamSweater') || obj.name.includes('morphed_female.003')) {
        sweaterGeom = obj.geometry;
      }
    }
  });
  // Fallback if exporter renamed meshes
  if (!sourceGeom) {
    gltf.scene.traverse((obj) => {
      if (obj.isMesh && !sourceGeom) sourceGeom = obj.geometry;
    });
  }

  if (!sourceGeom) {
    throw new Error('No mesh found in seated_legs.glb');
  }

  // Ensure smooth vertex normals
  sourceGeom.computeVertexNormals();
  sourceGeom.computeBoundingBox();

  const bbox = sourceGeom.boundingBox;
  const posAttr = sourceGeom.attributes.position;
  const normAttr = sourceGeom.attributes.normal;
  const uvAttr = sourceGeom.attributes.uv;
  const vertCount = posAttr.count;

  // Compute foot contact centers for studio floor shadows & leg centers
  let lxSum = 0, lzSum = 0, lCnt = 0;
  let rxSum = 0, rzSum = 0, rCnt = 0;
  for (let i = 0; i < vertCount; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    if (y < FLOOR_Y + 0.08) {
      if (x < 0) { lxSum += x; lzSum += z; lCnt++; }
      else { rxSum += x; rzSum += z; rCnt++; }
    }
  }
  const leftFootCenter = new THREE.Vector2(lCnt ? lxSum / lCnt : -0.36, lCnt ? lzSum / lCnt : 0.14);
  const rightFootCenter = new THREE.Vector2(rCnt ? rxSum / rCnt : 0.36, rCnt ? rzSum / rCnt : 0.14);

  // -------------------------------------------------------------------------
  // 1. Sculpted Bare Skin Mesh
  // -------------------------------------------------------------------------
  const skinGeom = sourceGeom.clone();
  const skinRestPos = new Float32Array(skinGeom.attributes.position.array);
  const skinRestNorm = new Float32Array(skinGeom.attributes.normal.array);
  const skinBulge = new Float32Array(vertCount);
  const skinRimAO = new Float32Array(vertCount);

  skinGeom.setAttribute('aBulge', new THREE.BufferAttribute(skinBulge, 1));
  skinGeom.setAttribute('aRimAO', new THREE.BufferAttribute(skinRimAO, 1));

  const skinMesh = new THREE.Mesh(skinGeom, skinMaterial);
  skinMesh.renderOrder = 1;

  // -------------------------------------------------------------------------
  // 2. Surface-Hugging Interactive Sheer Stocking Mesh
  // -------------------------------------------------------------------------
  const clothGeom = sourceGeom.clone();
  const cPos = clothGeom.attributes.position.array;
  const cNorm = clothGeom.attributes.normal.array;
  const restPos = new Float32Array(vertCount * 3);
  const restNorm = new Float32Array(vertCount * 3);
  const vel = new Float32Array(vertCount * 3);
  const sideArr = new Int8Array(vertCount); // -1 left leg, +1 right leg

  const strainArr = new Float32Array(vertCount);
  const liftArr = new Float32Array(vertCount);
  const tearEdgeArr = new Float32Array(vertCount);
  const tearOpenArr = new Float32Array(vertCount);
  const ladderArr = new Float32Array(vertCount);
  const bunchArr = new Float32Array(vertCount);

  // Inflate stocking cleanly along sculpted skin normals (+2.2mm) so it hugs every contour
  for (let i = 0; i < vertCount; i++) {
    const i3 = i * 3;
    const nx = cNorm[i3];
    const ny = cNorm[i3 + 1];
    const nz = cNorm[i3 + 2];
    const y = cPos[i3 + 1];

    // Slightly tighter clearance on the delicate toes (+1.2mm) so 5 toes read crisply!
    const clearance = y < 0.14 ? 0.0012 : 0.0020;
    const rx = cPos[i3] + nx * clearance;
    const ry = cPos[i3 + 1] + ny * clearance;
    const rz = cPos[i3 + 2] + nz * clearance;

    cPos[i3] = restPos[i3] = rx;
    cPos[i3 + 1] = restPos[i3 + 1] = ry;
    cPos[i3 + 2] = restPos[i3 + 2] = rz;

    restNorm[i3] = nx;
    restNorm[i3 + 1] = ny;
    restNorm[i3 + 2] = nz;
    sideArr[i] = rx < 0 ? -1 : 1;
  }

  clothGeom.setAttribute('aStrain', new THREE.BufferAttribute(strainArr, 1));
  clothGeom.setAttribute('aLift', new THREE.BufferAttribute(liftArr, 1));
  clothGeom.setAttribute('aTearEdge', new THREE.BufferAttribute(tearEdgeArr, 1));
  clothGeom.setAttribute('aTearOpen', new THREE.BufferAttribute(tearOpenArr, 1));
  clothGeom.setAttribute('aLadder', new THREE.BufferAttribute(ladderArr, 1));
  clothGeom.setAttribute('aBunch', new THREE.BufferAttribute(bunchArr, 1));

  const clothMesh = new THREE.Mesh(clothGeom, stockingMaterial);
  clothMesh.renderOrder = 2;

  let briefMesh = null;
  if (briefGeom) {
    briefGeom.computeVertexNormals();
    const briefMat = new THREE.MeshStandardMaterial({
      color: '#14161a',
      roughness: 0.62,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });
    briefMesh = new THREE.Mesh(briefGeom, briefMat);
    briefMesh.renderOrder = 3;
  }

  let sweaterMesh = null;
  if (sweaterGeom) {
    sweaterGeom.computeVertexNormals();
    const sweaterMat = new THREE.MeshStandardMaterial({
      color: '#e8dac6', // Cozy cream knit sweater matching reference video
      roughness: 0.86,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    sweaterMesh = new THREE.Mesh(sweaterGeom, sweaterMat);
    sweaterMesh.renderOrder = 3;
  }

  // Interactive controller wrapping both legs on the sculpted mesh
  const controller = new SculptedStockingController({
    skinMesh,
    skinGeom,
    skinRestPos,
    skinRestNorm,
    skinBulge,
    skinRimAO,
    clothMesh,
    clothGeom,
    briefMesh,
    sweaterMesh,
    restPos,
    restNorm,
    vel,
    sideArr,
    uvArr: uvAttr.array,
    strainArr,
    liftArr,
    bunchArr,
    material: stockingMaterial,
    leftFootCenter,
    rightFootCenter,
    bbox,
  });

  clothMesh.userData.sculptedController = controller;
  return controller;
}

/**
 * Automatically extracts the leg region (above shoes, below skirt/shorts, excluding arms)
 * from ANY imported .glb / .vrm character model and wraps a real-time tearable sheer
 * stocking overlay seamlessly around her exact legs!
 */
export function buildStockingForImportedModel(root, stockingMaterial) {
  root.updateMatrixWorld(true);

  const positions = [];
  const normals = [];
  const uvs = [];
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const nA = new THREE.Vector3();
  const nB = new THREE.Vector3();
  const nC = new THREE.Vector3();
  const normalMat = new THREE.Matrix3();

  // Normalized model height is ~1.68m (feet on y = 0.0):
  // Legs live cleanly in y ∈ [0.065, 0.86] and |x| < 0.25 (excludes hanging arms/hands!)
  const Y_MIN = 0.065;
  const Y_MAX = 0.86;
  const X_MAX = 0.25;

  const isLegVert = (v) => v.y >= Y_MIN && v.y <= Y_MAX && Math.abs(v.x) <= X_MAX;

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    // Skip obvious shoes/skirt/accessories by name if present
    const lname = (obj.name || '').toLowerCase();
    if (lname.includes('shoe') || lname.includes('skirt') || lname.includes('hair') || lname.includes('face')) {
      return;
    }

    const geom = obj.geometry;
    const pos = geom.attributes.position;
    if (!pos) return;
    if (!geom.attributes.normal) geom.computeVertexNormals();
    const norm = geom.attributes.normal;
    const idx = geom.index;

    normalMat.getNormalMatrix(obj.matrixWorld);

    const triCount = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

      vA.fromBufferAttribute(pos, i0).applyMatrix4(obj.matrixWorld);
      vB.fromBufferAttribute(pos, i1).applyMatrix4(obj.matrixWorld);
      vC.fromBufferAttribute(pos, i2).applyMatrix4(obj.matrixWorld);

      if (!isLegVert(vA) || !isLegVert(vB) || !isLegVert(vC)) continue;

      nA.fromBufferAttribute(norm, i0).applyMatrix3(normalMat).normalize();
      nB.fromBufferAttribute(norm, i1).applyMatrix3(normalMat).normalize();
      nC.fromBufferAttribute(norm, i2).applyMatrix3(normalMat).normalize();

      const triVerts = [
        [vA, nA],
        [vB, nB],
        [vC, nC],
      ];
      const cx = (vA.x + vB.x + vC.x) / 3 < 0 ? -0.105 : 0.105;

      for (const [v, n] of triVerts) {
        // Inflate +2.4mm outward along skin normal so stocking hugs seamlessly over imported legs
        positions.push(v.x + n.x * 0.0024, v.y + n.y * 0.0024, v.z + n.z * 0.0024);
        normals.push(n.x, n.y, n.z);

        const theta = Math.atan2(v.z, v.x - cx);
        const u = ((theta / (Math.PI * 2)) % 1 + 1) % 1;
        const vCoord = Math.max(0, Math.min(1, (v.y - Y_MIN) / (Y_MAX - Y_MIN)));
        uvs.push(u, vCoord);
      }
    }
  });

  if (positions.length === 0) return null;

  const vertCount = positions.length / 3;
  const clothGeom = new THREE.BufferGeometry();
  const posArr = new Float32Array(positions);
  const normArr = new Float32Array(normals);
  const uvArr = new Float32Array(uvs);

  const restPos = new Float32Array(posArr);
  const restNorm = new Float32Array(normArr);
  const vel = new Float32Array(vertCount * 3);
  const sideArr = new Int8Array(vertCount);
  for (let i = 0; i < vertCount; i++) {
    sideArr[i] = posArr[i * 3] < 0 ? -1 : 1;
  }

  const strainArr = new Float32Array(vertCount);
  const liftArr = new Float32Array(vertCount);
  const bunchArr = new Float32Array(vertCount);

  clothGeom.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  clothGeom.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
  clothGeom.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  clothGeom.setAttribute('aStrain', new THREE.BufferAttribute(strainArr, 1));
  clothGeom.setAttribute('aLift', new THREE.BufferAttribute(liftArr, 1));
  clothGeom.setAttribute('aTearEdge', new THREE.BufferAttribute(new Float32Array(vertCount), 1));
  clothGeom.setAttribute('aTearOpen', new THREE.BufferAttribute(new Float32Array(vertCount), 1));
  clothGeom.setAttribute('aLadder', new THREE.BufferAttribute(new Float32Array(vertCount), 1));
  clothGeom.setAttribute('aBunch', new THREE.BufferAttribute(bunchArr, 1));

  const clothMesh = new THREE.Mesh(clothGeom, stockingMaterial);
  clothMesh.renderOrder = 5;

  // Dummy skin arrays (imported model already renders its own skin underneath!)
  const controller = new SculptedStockingController({
    skinMesh: null,
    skinGeom: null,
    skinRestPos: null,
    skinRestNorm: null,
    skinBulge: null,
    skinRimAO: null,
    clothMesh,
    clothGeom,
    restPos,
    restNorm,
    vel,
    sideArr,
    uvArr,
    strainArr,
    liftArr,
    bunchArr,
    material: stockingMaterial,
    leftFootCenter: new THREE.Vector2(-0.10, 0),
    rightFootCenter: new THREE.Vector2(0.10, 0),
    bbox: null,
  });

  clothMesh.userData.sculptedController = controller;
  return controller;
}

export class SculptedStockingController {
  constructor(data) {
    Object.assign(this, data);
    this.vertCount = this.restPos.length / 3;

    // Interactive pinch/pull state
    this.isGrabbing = false;
    this.grabSide = 1;
    this.grabRestPos = new THREE.Vector3();
    this.grabTarget = new THREE.Vector3();
    this.grabCurrent = new THREE.Vector3();
    this.grabUV = new THREE.Vector2();
    this.lastTearDist = 0;

    // Analytical SDF Tears (per-pixel crisp almond openings + vertical ladders)
    this.sdfTears = [];
    this.tearSensitivity = 1.0;
    this.bulgeStrength = 1.0;
    this.onTear = null;

    // Instinctive startled flinch & knee-tuck recoil state (per leg!)
    this.flinchTimer = { '-1': 10, '1': 10 };
    this.flinchIntensity = { '-1': 0, '1': 0 };
    this.flinchDir = { '-1': 1, '1': -1 }; // inward reflexive tuck toward centerline

    // Independent Roll-Down state for Left (-1) & Right (+1) legs
    this.cuffY = { '-1': STOCKING_TOP_Y, '1': STOCKING_TOP_Y };
    this.targetCuffY = { '-1': STOCKING_TOP_Y, '1': STOCKING_TOP_Y };
    this.rollSide = 0;
  }

  /**
   * Triggers a brief, natural startled flinch & instinctive knee-tuck reflex on the snagged leg.
   */
  triggerFlinch(side = 1, intensity = 1.0) {
    const key = String(side < 0 ? -1 : 1);
    this.flinchTimer[key] = 0.0;
    this.flinchIntensity[key] = Math.min(1.4, intensity);
    this.flinchDir[key] = side < 0 ? 1 : -1; // tuck slightly inward & back
  }

  grabAtHit(hit) {
    this.isGrabbing = true;
    this.grabSide = hit.point.x < 0 ? -1 : 1;
    this.grabRestPos.copy(hit.point);
    this.grabTarget.copy(hit.point);
    this.grabCurrent.copy(hit.point);
    if (hit.uv) {
      this.grabUV.copy(hit.uv);
    }
    this.lastTearDist = 0;
    return true;
  }

  setGrabTarget(worldPos) {
    this.grabTarget.copy(worldPos);
  }

  getGrabPosition(out = new THREE.Vector3()) {
    return out.copy(this.grabCurrent);
  }

  releaseGrab() {
    this.isGrabbing = false;
  }

  pullCuff(side, worldY) {
    const key = String(side);
    this.rollSide = side;
    this.targetCuffY[key] = Math.max(0.06, Math.min(STOCKING_TOP_Y, worldY));
  }

  releaseCuff() {
    this.rollSide = 0;
  }

  getCuffHandlePoint(side, out = new THREE.Vector3()) {
    const key = String(side);
    const cx = side < 0 ? this.leftFootCenter.x * 0.88 : this.rightFootCenter.x * 0.88;
    return out.set(cx, this.cuffY[key], 0.16);
  }

  repair() {
    this.isGrabbing = false;
    this.sdfTears = [];
    this.cuffY['-1'] = this.targetCuffY['-1'] = STOCKING_TOP_Y;
    this.cuffY['1'] = this.targetCuffY['1'] = STOCKING_TOP_Y;
    this.vel.fill(0);
    this.strainArr.fill(0);
    this.liftArr.fill(0);
    this.bunchArr.fill(0);
    this.clothGeom.attributes.position.array.set(this.restPos);
    this.clothGeom.attributes.position.needsUpdate = true;
    this.clothGeom.computeVertexNormals();

    if (this.skinGeom && this.skinBulge) {
      this.skinBulge.fill(0);
      this.skinRimAO.fill(0);
      this.skinGeom.attributes.position.array.set(this.skinRestPos);
      this.skinGeom.attributes.position.needsUpdate = true;
      this.skinGeom.attributes.aBulge.needsUpdate = true;
      this.skinGeom.attributes.aRimAO.needsUpdate = true;
      this.skinGeom.computeVertexNormals();
    }

    this._syncTearUniforms();
  }

  _syncTearUniforms() {
    const u = this.material.uniforms;
    const count = Math.min(this.sdfTears.length, MAX_SDF_TEARS);
    u.uTearCount.value = count;
    for (let i = 0; i < MAX_SDF_TEARS; i++) {
      if (i < count) {
        const t = this.sdfTears[i];
        u.uTearData.value[i].set(t.u, t.v, t.rx, t.ry);
        u.uTearLadder.value[i].set(t.ladderUp, t.ladderDown, t.side, 1);
      } else {
        u.uTearData.value[i].set(-10, -10, 0.01, 0.01);
        u.uTearLadder.value[i].set(0, 0, 0, 0);
      }
    }
  }

  _spawnOrGrowTear(u, v, side) {
    // Check if an existing tear on the same leg is nearby
    for (let i = 0; i < this.sdfTears.length; i++) {
      const t = this.sdfTears[i];
      if (t.side !== side) continue;
      let du = Math.abs(u - t.u);
      if (du > 0.5) du = 1.0 - du;
      const dv = Math.abs(v - t.v);
      if (du < 0.06 && dv < 0.07) {
        t.rx = Math.min(0.028, t.rx + 0.0032);
        t.ry = Math.min(0.044, t.ry + 0.0052);
        t.ladderUp = Math.min(0.16, t.ladderUp + 0.015);
        t.ladderDown = Math.min(0.16, t.ladderDown + 0.015);

        // Pop open a chained secondary almond tear along the vertical ladder!
        if (t.ry > 0.032 && !t.chained && this.sdfTears.length < MAX_SDF_TEARS) {
          t.chained = true;
          const dir = Math.random() < 0.5 ? 1 : -1;
          const v2 = Math.max(0.08, Math.min(0.90, t.v + dir * (t.ry * 2.1 + 0.028)));
          this.sdfTears.push({
            side,
            u: t.u + (Math.random() - 0.5) * 0.005,
            v: v2,
            rx: t.rx * (0.55 + Math.random() * 0.16),
            ry: t.ry * (0.58 + Math.random() * 0.16),
            ladderUp: 0.045 + Math.random() * 0.04,
            ladderDown: 0.045 + Math.random() * 0.04,
            chained: false,
          });
        }
        this._syncTearUniforms();
        if (this.onTear) this.onTear();
        return;
      }
    }

    if (this.sdfTears.length < MAX_SDF_TEARS) {
      this.sdfTears.push({
        side,
        u,
        v,
        rx: 0.013 + Math.random() * 0.005,
        ry: 0.022 + Math.random() * 0.008,
        ladderUp: 0.055 + Math.random() * 0.045,
        ladderDown: 0.055 + Math.random() * 0.045,
        chained: false,
      });
      this._syncTearUniforms();
      if (this.onTear) this.onTear();
    }
  }

  step(dt = 1 / 60) {
    // Advance startled flinch & knee-tuck timers
    this.flinchTimer['-1'] += dt;
    this.flinchTimer['1'] += dt;

    // Evaluate smooth knee-tuck & micro-shudder curve per leg:
    // Fast attack (~0.06s) + subtle damped reflex shudder + smooth settle (~0.45s)
    const evalFlinch = (key) => {
      const t = this.flinchTimer[key];
      if (t > 0.65) return { tuck: 0, shiver: 0 };
      const amp = this.flinchIntensity[key];
      const env = (1.0 - Math.exp(-t * 28.0)) * Math.exp(-t * 6.2) * amp;
      const shiver = Math.sin(t * 42.0) * Math.exp(-t * 9.5) * 0.35 * amp;
      return { tuck: env, shiver };
    };
    const flinchL = evalFlinch('-1');
    const flinchR = evalFlinch('1');
    const hasFlinch = flinchL.tuck > 0.001 || flinchR.tuck > 0.001;

    // Smooth roll-down cuffs
    this.cuffY['-1'] += (this.targetCuffY['-1'] - this.cuffY['-1']) * 0.22;
    this.cuffY['1'] += (this.targetCuffY['1'] - this.cuffY['1']) * 0.22;

    const cPos = this.clothGeom.attributes.position.array;
    const pullVec = new THREE.Vector3();

    if (this.isGrabbing) {
      this.grabCurrent.lerp(this.grabTarget, Math.min(1, dt * 18));
      pullVec.subVectors(this.grabCurrent, this.grabRestPos);
      const rawDist = pullVec.length();
      // Clamp maximum pull stretch to realistic 12cm so cloth never distorts wildly!
      if (rawDist > 0.12) {
        pullVec.setLength(0.12);
      }

      // Trigger crisp small-to-medium almond tear & vertical ladder when pulled past threshold
      const tearThresh = 0.075 / Math.max(0.35, this.tearSensitivity);
      if (rawDist > tearThresh && rawDist - this.lastTearDist > 0.032) {
        this.lastTearDist = rawDist;
        this._spawnOrGrowTear(this.grabUV.x, this.grabUV.y, this.grabSide);
      }
    } else {
      this.grabCurrent.lerp(this.grabRestPos, Math.min(1, dt * 12));
    }

    // Tight, realistic fingertip pinch radius (8.5cm instead of whole leg!)
    const pullRadius = 0.085;
    const pullMag = this.isGrabbing ? pullVec.length() : 0;
    const gx = this.grabRestPos.x;
    const gy = this.grabRestPos.y;
    const gz = this.grabRestPos.z;

    const springK = 28.0 * dt;
    const damp = 0.82;

    for (let i = 0; i < this.vertCount; i++) {
      const i3 = i * 3;
      const side = this.sideArr[i];
      const rx = this.restPos[i3];
      const ry = this.restPos[i3 + 1];
      const rz = this.restPos[i3 + 2];
      const nx = this.restNorm[i3];
      const ny = this.restNorm[i3 + 1];
      const nz = this.restNorm[i3 + 2];

      let tx = rx;
      let ty = ry;
      let tz = rz;
      let localStrain = 0;
      let localBunch = 0;

      // 0. Instinctive startled flinch & knee-tuck recoil (peaks smoothly around knee/calf, 0 at hip & floor)
      if (hasFlinch) {
        const fl = side < 0 ? flinchL : flinchR;
        if (fl.tuck > 0.001) {
          // Smooth bell curve centered near knee height (y ~ 0.42), anchored at floor (y ~ 0.04) & hip (y ~ 0.78)
          const kneeWeight = Math.exp(-Math.pow((ry - 0.42) / 0.24, 2.0)) * Math.min(1.0, Math.max(0.0, (ry - 0.04) / 0.16));
          const inX = side < 0 ? 1 : -1;
          tx += (inX * fl.tuck * 0.016 + inX * fl.shiver * 0.007) * kneeWeight;
          ty += fl.tuck * 0.012 * kneeWeight;
          tz -= (fl.tuck * 0.014 + fl.shiver * 0.005) * kneeWeight;
        }
      }

      // 1. Roll-down cuff bunching (if this leg's stocking is rolled down)
      const cY = this.cuffY[String(side)];
      const rolledAmt = STOCKING_TOP_Y - cY;
      if (rolledAmt > 0.004 && ry > cY - 0.11) {
        const bandH = Math.min(0.11, 0.045 + rolledAmt * 0.12);
        const excess = Math.max(0, ry - (cY - bandH));
        const maxExc = Math.max(0.01, STOCKING_TOP_Y - (cY - bandH));
        const uBand = Math.min(1.0, excess / maxExc);
        const env = Math.sin(uBand * Math.PI);
        const puff = Math.min(0.018, 0.004 + rolledAmt * 0.015) * env * (0.78 + 0.22 * Math.sin(uBand * Math.PI * 3.0));

        ty = cY - bandH + uBand * bandH;
        tx = rx + nx * puff;
        tz = rz + nz * puff;
        localBunch = env * Math.min(1.0, rolledAmt * 3.5);
      }

      // 2. Real-time tight outward-only fingertip pinch displacement (NEVER clips inside leg!)
      if (this.isGrabbing && side === this.grabSide && pullMag > 0.001) {
        const dx = rx - gx;
        const dy = ry - gy;
        const dz = rz - gz;
        const d = Math.hypot(dx, dy, dz);
        if (d < pullRadius) {
          const w = Math.pow(1.0 - d / pullRadius, 2.0);
          // Decompose pull into outward normal component (strictly >= 0) + subtle tangential glide
          const dotN = pullVec.x * nx + pullVec.y * ny + pullVec.z * nz;
          const outN = Math.max(0.0, dotN);
          const tanX = pullVec.x - dotN * nx;
          const tanY = pullVec.y - dotN * ny;
          const tanZ = pullVec.z - dotN * nz;

          tx += (nx * outN * 0.85 + tanX * 0.18) * w;
          ty += (ny * outN * 0.85 + tanY * 0.18) * w;
          tz += (nz * outN * 0.85 + tanZ * 0.18) * w;
          localStrain = Math.min(1.4, pullMag * 8.5 * w);
        }
      }

      // Smooth damped spring follow
      this.vel[i3] = (this.vel[i3] + (tx - cPos[i3]) * springK) * damp;
      this.vel[i3 + 1] = (this.vel[i3 + 1] + (ty - cPos[i3 + 1]) * springK) * damp;
      this.vel[i3 + 2] = (this.vel[i3 + 2] + (tz - cPos[i3 + 2]) * springK) * damp;

      cPos[i3] += this.vel[i3];
      cPos[i3 + 1] += this.vel[i3 + 1];
      cPos[i3 + 2] += this.vel[i3 + 2];

      const lift = Math.max(
        0,
        (cPos[i3] - rx) * nx + (cPos[i3 + 1] - ry) * ny + (cPos[i3 + 2] - rz) * nz
      );
      this.liftArr[i] = lift;
      this.strainArr[i] = this.strainArr[i] * 0.8 + localStrain * 0.2;
      this.bunchArr[i] = localBunch;
    }

    this.clothGeom.attributes.position.needsUpdate = true;
    this.clothGeom.attributes.aStrain.needsUpdate = true;
    this.clothGeom.attributes.aLift.needsUpdate = true;
    this.clothGeom.attributes.aBunch.needsUpdate = true;
    this.clothGeom.computeVertexNormals();

    this._updateSkinBulge(flinchL, flinchR, hasFlinch);
  }

  _updateSkinBulge(flinchL = { tuck: 0, shiver: 0 }, flinchR = { tuck: 0, shiver: 0 }, hasFlinch = false) {
    if (!this.skinGeom || !this.skinBulge) return;
    if (this.sdfTears.length === 0 && !hasFlinch) return;
    const sPos = this.skinGeom.attributes.position.array;
    const maxDisp = 0.004 * this.bulgeStrength;

    for (let i = 0; i < this.vertCount; i++) {
      const side = this.sideArr[i];
      const u = this.uvArr[i * 2];
      const v = this.uvArr[i * 2 + 1];

      let targetBulge = 0;
      let targetRim = 0;
      for (let k = 0; k < this.sdfTears.length; k++) {
        const t = this.sdfTears[k];
        if (t.side !== side) continue;
        let du = u - t.u;
        if (du > 0.5) du -= 1.0;
        if (du < -0.5) du += 1.0;
        const dv = v - t.v;
        const ny = dv / Math.max(t.ry, 0.006);
        if (Math.abs(ny) > 1.35) continue;
        const nx = du / Math.max(t.rx, 0.004);
        const d = Math.hypot(nx, ny);
        if (d < 1.25) {
          const b = Math.max(0, 1.0 - d * d);
          if (b > targetBulge) targetBulge = b;
          const rim = Math.exp(-Math.pow((d - 1.0) / 0.18, 2.0));
          if (rim > targetRim) targetRim = rim;
        }
      }

      const liftFade = Math.exp(-this.liftArr[i] * 24.0);
      this.skinBulge[i] += (targetBulge * liftFade - this.skinBulge[i]) * 0.22;
      this.skinRimAO[i] += (targetRim * liftFade - this.skinRimAO[i]) * 0.22;

      const disp = this.skinBulge[i] * maxDisp;
      const i3 = i * 3;
      let fx = 0, fy = 0, fz = 0;
      if (hasFlinch) {
        const fl = side < 0 ? flinchL : flinchR;
        if (fl.tuck > 0.001) {
          const ry = this.skinRestPos[i3 + 1];
          const kneeWeight = Math.exp(-Math.pow((ry - 0.42) / 0.24, 2.0)) * Math.min(1.0, Math.max(0.0, (ry - 0.04) / 0.16));
          const inX = side < 0 ? 1 : -1;
          fx = (inX * fl.tuck * 0.016 + inX * fl.shiver * 0.007) * kneeWeight;
          fy = fl.tuck * 0.012 * kneeWeight;
          fz = -(fl.tuck * 0.014 + fl.shiver * 0.005) * kneeWeight;
        }
      }

      sPos[i3] = this.skinRestPos[i3] + this.skinRestNorm[i3] * disp + fx;
      sPos[i3 + 1] = this.skinRestPos[i3 + 1] + this.skinRestNorm[i3 + 1] * disp + fy;
      sPos[i3 + 2] = this.skinRestPos[i3 + 2] + this.skinRestNorm[i3 + 2] * disp + fz;
    }

    this.skinGeom.attributes.position.needsUpdate = true;
    this.skinGeom.attributes.aBulge.needsUpdate = true;
    this.skinGeom.attributes.aRimAO.needsUpdate = true;
  }
}
