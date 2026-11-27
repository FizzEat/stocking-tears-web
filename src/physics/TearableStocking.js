import * as THREE from 'three';
import {
  STOCKING_Y_BOTTOM,
  STOCKING_Y_TOP,
  LEG_Y_BOTTOM,
  LEG_Y_TOP,
  evaluateLegPoint,
  projectPointOutsideLeg,
} from '../scene/LegAnatomy.js';

const CLEARANCE = 0.0038;
const MAX_FRAY_STRANDS = 320;

/**
 * Real-time Verlet / XPBD Tearable Stocking Cloth Simulation for one leg.
 * Features:
 *  - Seamless cylindrical topology (cols unique particles per ring, cols+1 UV vertices)
 *  - Pre-tensioned elastic mesh that hugs the leg and snaps open realistically when torn
 *  - Stress-concentrated tear propagation when pulling on tear edges
 *  - Delicate bridging frayed nylon strands (LineSegments) that stretch & snap
 *  - Coupled skin-bulge & elastic rim-AO feedback on the underlying skin mesh
 */
export class TearableStocking {
  constructor(side, material, cols = 48, rows = 76) {
    this.side = side;
    this.material = material;
    this.cols = cols;
    this.rows = rows;

    this.numParticles = cols * (rows + 1);
    this.numRenderVerts = (cols + 1) * (rows + 1);
    this.numQuads = cols * rows;

    this.pos = new Float32Array(this.numParticles * 3);
    this.prevPos = new Float32Array(this.numParticles * 3);
    this.restPos = new Float32Array(this.numParticles * 3);
    this.invMass = new Float32Array(this.numParticles);
    this.lift = new Float32Array(this.numParticles);
    this.strain = new Float32Array(this.numParticles);
    this.isTearEdge = new Uint8Array(this.numParticles);
    this.tearOpen = new Float32Array(this.numParticles);
    this.ladder = new Float32Array(this.numParticles);
    this.bunch = new Float32Array(this.numParticles);

    // Roll-down / slouch cuff state
    this.cuffY = STOCKING_Y_TOP;
    this.targetCuffY = STOCKING_Y_TOP;
    this.rollGripAngle = 0;
    this.rollGripActive = false;

    this.quadAlive = new Uint8Array(this.numQuads);
    this.hasAnyTear = false;
    this.indicesDirty = false;

    this.frayStrands = [];

    this.grabIndex = -1;
    this.grabWeights = [];
    this.grabTarget = new THREE.Vector3();

    this.tearSensitivity = 1.0;
    this.bulgeStrength = 1.0;
    this.onTear = null;

    this._tmpP = new THREE.Vector3();

    this._initParticles();
    this._initSprings();
    this._initGeometry();
    this._initFrayLines();
  }

  _pIdx(c, r) {
    const cw = ((c % this.cols) + this.cols) % this.cols;
    return r * this.cols + cw;
  }

  _vIdx(c, r) {
    return r * (this.cols + 1) + c;
  }

  _qIdx(c, r) {
    const cw = ((c % this.cols) + this.cols) % this.cols;
    return r * this.cols + cw;
  }

  _initParticles() {
    const p = new THREE.Vector3();
    for (let r = 0; r <= this.rows; r++) {
      const v = r / this.rows;
      const y = STOCKING_Y_BOTTOM + v * (STOCKING_Y_TOP - STOCKING_Y_BOTTOM);

      for (let c = 0; c < this.cols; c++) {
        const u = c / this.cols;
        const theta = u * Math.PI * 2;
        evaluateLegPoint(this.side, y, theta, CLEARANCE, p);

        const idx = this._pIdx(c, r);
        const i3 = idx * 3;
        this.pos[i3] = this.prevPos[i3] = this.restPos[i3] = p.x;
        this.pos[i3 + 1] = this.prevPos[i3 + 1] = this.restPos[i3 + 1] = p.y;
        this.pos[i3 + 2] = this.prevPos[i3 + 2] = this.restPos[i3 + 2] = p.z;

        const pinned = r <= 1 || r >= this.rows - 1;
        this.invMass[idx] = pinned ? 0.0 : 1.0;
        this.lift[idx] = 0.0;
        this.strain[idx] = 0.0;
        this.isTearEdge[idx] = 0;
        this.tearOpen[idx] = 0.0;
        this.ladder[idx] = 0.0;
        this.bunch[idx] = 0.0;
      }
    }
    this.quadAlive.fill(1);
  }

  _distRest(a, b) {
    const a3 = a * 3;
    const b3 = b * 3;
    return Math.hypot(
      this.restPos[b3] - this.restPos[a3],
      this.restPos[b3 + 1] - this.restPos[a3 + 1],
      this.restPos[b3 + 2] - this.restPos[a3 + 2]
    );
  }

  _initSprings() {
    const aList = [];
    const bList = [];
    const restList = [];
    const stiffList = [];
    const typeList = [];
    const q1List = [];
    const q2List = [];

    const addSpring = (a, b, preTension, stiffness, type, q1, q2) => {
      aList.push(a);
      bList.push(b);
      restList.push(this._distRest(a, b) * preTension);
      stiffList.push(stiffness);
      typeList.push(type);
      q1List.push(q1);
      q2List.push(q2);
    };

    for (let r = 0; r <= this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const p0 = this._pIdx(c, r);
        const pRight = this._pIdx(c + 1, r);

        // Horizontal weft spring
        const qBelow = r > 0 ? this._qIdx(c, r - 1) : -1;
        const qAbove = r < this.rows ? this._qIdx(c, r) : -1;
        addSpring(p0, pRight, 0.955, 0.88, 0, qBelow, qAbove);

        // Vertical warp & diagonal shear springs
        if (r < this.rows) {
          const pUp = this._pIdx(c, r + 1);
          const qLeft = this._qIdx(c - 1, r);
          const qRight = this._qIdx(c, r);
          addSpring(p0, pUp, 0.975, 0.86, 1, qLeft, qRight);

          const pUpRight = this._pIdx(c + 1, r + 1);
          const qCur = this._qIdx(c, r);
          addSpring(p0, pUpRight, 0.985, 0.36, 2, qCur, -1);
          addSpring(pRight, pUp, 0.985, 0.36, 2, qCur, -1);
        }
      }
    }

    this.numSprings = aList.length;
    this.sA = new Int32Array(aList);
    this.sB = new Int32Array(bList);
    this.sRest = new Float32Array(restList);
    this.sStiff = new Float32Array(stiffList);
    this.sType = new Uint8Array(typeList);
    this.sQ1 = new Int32Array(q1List);
    this.sQ2 = new Int32Array(q2List);
    this.sAlive = new Uint8Array(this.numSprings);
    this.sAlive.fill(1);
  }

  _initGeometry() {
    const positions = new Float32Array(this.numRenderVerts * 3);
    const uvs = new Float32Array(this.numRenderVerts * 2);
    const strainAttr = new Float32Array(this.numRenderVerts);
    const liftAttr = new Float32Array(this.numRenderVerts);
    const tearEdgeAttr = new Float32Array(this.numRenderVerts);
    const tearOpenAttr = new Float32Array(this.numRenderVerts);
    const ladderAttr = new Float32Array(this.numRenderVerts);
    const bunchAttr = new Float32Array(this.numRenderVerts);

    for (let r = 0; r <= this.rows; r++) {
      const v = r / this.rows;
      for (let c = 0; c <= this.cols; c++) {
        const u = c / this.cols;
        const vIdx = this._vIdx(c, r);
        uvs[vIdx * 2] = u;
        uvs[vIdx * 2 + 1] = v;
      }
    }

    this.indexArray = new Uint32Array(this.numQuads * 6);
    this._rebuildIndexBuffer();

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setAttribute('aStrain', new THREE.BufferAttribute(strainAttr, 1));
    this.geometry.setAttribute('aLift', new THREE.BufferAttribute(liftAttr, 1));
    this.geometry.setAttribute('aTearEdge', new THREE.BufferAttribute(tearEdgeAttr, 1));
    this.geometry.setAttribute('aTearOpen', new THREE.BufferAttribute(tearOpenAttr, 1));
    this.geometry.setAttribute('aLadder', new THREE.BufferAttribute(ladderAttr, 1));
    this.geometry.setAttribute('aBunch', new THREE.BufferAttribute(bunchAttr, 1));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indexArray, 1));

    this._syncGeometryAttributes();
    this.geometry.computeVertexNormals();

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 2;
    this.mesh.userData.stocking = this;
  }

  _initFrayLines() {
    const frayPositions = new Float32Array(MAX_FRAY_STRANDS * 2 * 3);
    this.frayGeom = new THREE.BufferGeometry();
    this.frayGeom.setAttribute('position', new THREE.BufferAttribute(frayPositions, 3));
    this.frayGeom.setDrawRange(0, 0);

    this.frayMat = new THREE.LineBasicMaterial({
      color: '#1b1e24',
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    this.frayMesh = new THREE.LineSegments(this.frayGeom, this.frayMat);
    this.frayMesh.renderOrder = 2.5;
  }

  setFrayColorMode(isWhite) {
    this.frayMat.color.set(isWhite ? '#eef1f5' : '#1b1e24');
    this.frayMat.opacity = isWhite ? 0.52 : 0.46;
  }

  _rebuildIndexBuffer() {
    let ptr = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        // Keep boundary quads rendered so fragment shader cuts smooth organic curved edges!
        // Only collapse quads whose 4 corners are all completely inside an open tear.
        const o0 = this.tearOpen[this._pIdx(c, r)];
        const o1 = this.tearOpen[this._pIdx(c + 1, r)];
        const o2 = this.tearOpen[this._pIdx(c, r + 1)];
        const o3 = this.tearOpen[this._pIdx(c + 1, r + 1)];
        const fullyHidden = o0 >= 0.99 && o1 >= 0.99 && o2 >= 0.99 && o3 >= 0.99;

        if (!fullyHidden) {
          const a = this._vIdx(c, r);
          const b = this._vIdx(c + 1, r);
          const d = this._vIdx(c, r + 1);
          const e = this._vIdx(c + 1, r + 1);
          this.indexArray[ptr++] = a;
          this.indexArray[ptr++] = d;
          this.indexArray[ptr++] = b;
          this.indexArray[ptr++] = b;
          this.indexArray[ptr++] = d;
          this.indexArray[ptr++] = e;
        } else {
          this.indexArray[ptr++] = 0;
          this.indexArray[ptr++] = 0;
          this.indexArray[ptr++] = 0;
          this.indexArray[ptr++] = 0;
          this.indexArray[ptr++] = 0;
          this.indexArray[ptr++] = 0;
        }
      }
    }
    if (this.geometry && this.geometry.index) {
      this.geometry.index.needsUpdate = true;
    }
    this.indicesDirty = false;
  }

  _updateTearEdgeFlags() {
    this.isTearEdge.fill(0);
    this.tearOpen.fill(0);
    if (!this.hasAnyTear) return;

    // Count how many of each particle's 4 incident quads are torn -> smooth 0..1 field
    for (let r = 0; r <= this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        let torn = 0;
        let total = 0;
        if (r > 0) {
          total += 2;
          if (!this.quadAlive[this._qIdx(c, r - 1)]) torn++;
          if (!this.quadAlive[this._qIdx(c - 1, r - 1)]) torn++;
        }
        if (r < this.rows) {
          total += 2;
          if (!this.quadAlive[this._qIdx(c, r)]) torn++;
          if (!this.quadAlive[this._qIdx(c - 1, r)]) torn++;
        }
        const idx = this._pIdx(c, r);
        const frac = total > 0 ? torn / total : 0;
        this.tearOpen[idx] = frac;
        if (torn > 0 && torn < total) {
          this.isTearEdge[idx] = 1;
        }
      }
    }
  }

  grabAtPoint(worldPoint) {
    let bestIdx = -1;
    let bestScore = Infinity;

    for (let i = 0; i < this.numParticles; i++) {
      if (this.invMass[i] === 0) continue;
      const i3 = i * 3;
      const dist = Math.hypot(
        this.pos[i3] - worldPoint.x,
        this.pos[i3 + 1] - worldPoint.y,
        this.pos[i3 + 2] - worldPoint.z
      );
      const score = this.isTearEdge[i] ? dist * 0.78 : dist;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx === -1 || bestScore > 0.14) return false;

    this.grabIndex = bestIdx;
    const gx = this.pos[bestIdx * 3];
    const gy = this.pos[bestIdx * 3 + 1];
    const gz = this.pos[bestIdx * 3 + 2];
    this.grabTarget.set(gx, gy, gz);

    this.grabWeights = [];
    const pinchRadius = this.isTearEdge[bestIdx] ? 0.055 : 0.072;

    for (let i = 0; i < this.numParticles; i++) {
      if (this.invMass[i] === 0) continue;
      const i3 = i * 3;
      const dx = this.pos[i3] - gx;
      const dy = this.pos[i3 + 1] - gy;
      const dz = this.pos[i3 + 2] - gz;
      const d = Math.hypot(dx, dy, dz);
      if (d < pinchRadius) {
        const w = Math.pow(1.0 - d / pinchRadius, 1.85);
        this.grabWeights.push({
          idx: i,
          weight: w,
          ox: dx * 0.35,
          oy: dy * 0.35,
          oz: dz * 0.35,
        });
      }
    }

    return true;
  }

  setGrabTarget(worldPos) {
    this.grabTarget.copy(worldPos);
  }

  getGrabPosition(out = new THREE.Vector3()) {
    if (this.grabIndex < 0) return out.copy(this.grabTarget);
    const i3 = this.grabIndex * 3;
    return out.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]);
  }

  releaseGrab() {
    this.grabIndex = -1;
    this.grabWeights = [];
  }

  repair() {
    this.releaseGrab();
    this.quadAlive.fill(1);
    this.sAlive.fill(1);
    this.isTearEdge.fill(0);
    this.tearOpen.fill(0);
    this.ladder.fill(0);
    this.bunch.fill(0);
    this.cuffY = STOCKING_Y_TOP;
    this.targetCuffY = STOCKING_Y_TOP;
    this.rollGripActive = false;
    this.frayStrands = [];
    this.hasAnyTear = false;
    this.pos.set(this.restPos);
    this.prevPos.set(this.restPos);
    this.lift.fill(0);
    this.strain.fill(0);
    this._rebuildIndexBuffer();
    this._syncGeometryAttributes();
    this.geometry.computeVertexNormals();
    this.frayGeom.setDrawRange(0, 0);
  }

  /**
   * Roll-Down / Peel-Off Mode: drag stocking cuff downward or upward along the leg.
   */
  pullCuffTo(worldY, gripPoint = null) {
    const minY = STOCKING_Y_BOTTOM + 0.28;
    const maxY = STOCKING_Y_TOP;
    this.targetCuffY = Math.max(minY, Math.min(maxY, worldY));
    if (gripPoint) {
      const legCenterX = this.side * 0.22;
      this.rollGripAngle = Math.atan2(gripPoint.z, gripPoint.x - legCenterX);
      this.rollGripActive = true;
    }
  }

  releaseCuffGrip() {
    this.rollGripActive = false;
  }

  /**
   * Returns a point on the current cuff rim for positioning the glove hand in Roll-Down mode.
   */
  getCuffHandlePoint(out = new THREE.Vector3()) {
    const angle = this.rollGripActive ? this.rollGripAngle : Math.PI * 0.5;
    const rolledDepth = Math.max(0, STOCKING_Y_TOP - this.cuffY);
    const puff = CLEARANCE + Math.min(0.022, rolledDepth * 0.032);
    return evaluateLegPoint(this.side, this.cuffY, angle, puff, out);
  }

  _applyRollDownDeformation() {
    // Smoothly approach targetCuffY with tactile cloth friction
    this.cuffY += (this.targetCuffY - this.cuffY) * 0.22;
    const rolledAmount = STOCKING_Y_TOP - this.cuffY;

    if (rolledAmount < 0.002) {
      this.bunch.fill(0);
      return;
    }

    // Amount of fabric bunched into the rolled cuff band (plush rounded folds, never jagged!)
    const bandHeight = Math.min(0.135, 0.048 + rolledAmount * 0.13);
    const maxPuff = Math.min(0.018, 0.004 + rolledAmount * 0.016);
    const p = this._tmpP;

    for (let r = 0; r <= this.rows; r++) {
      const v = r / this.rows;
      const restY = STOCKING_Y_BOTTOM + v * (STOCKING_Y_TOP - STOCKING_Y_BOTTOM);

      for (let c = 0; c < this.cols; c++) {
        const idx = this._pIdx(c, r);
        const theta = (c / this.cols) * Math.PI * 2;
        const gripDip = this.rollGripActive
          ? -0.022 * Math.pow(Math.max(0, Math.cos(theta - this.rollGripAngle)), 2.0) * Math.min(1, rolledAmount * 4.0)
          : 0.0;

        const localCuffY = Math.max(STOCKING_Y_BOTTOM + 0.16, this.cuffY + gripDip);

        if (restY > localCuffY - bandHeight) {
          const excess = Math.max(0, restY - (localCuffY - bandHeight));
          const maxExcess = Math.max(0.01, STOCKING_Y_TOP - (localCuffY - bandHeight));
          const uBand = Math.min(1.0, excess / maxExcess);

          const packedY = localCuffY - bandHeight + uBand * bandHeight;
          // Smooth plush rounded fold waves (eliminates sharp sawtooth spikes)
          const smoothEnvelope = Math.sin(uBand * Math.PI);
          const plushFolds = 0.78 + 0.22 * Math.sin(uBand * Math.PI * 3.0 + Math.sin(theta * 3.0) * 0.5);
          const radialPuff = CLEARANCE + maxPuff * smoothEnvelope * plushFolds;

          evaluateLegPoint(this.side, packedY, theta, radialPuff, p);
          const i3 = idx * 3;
          this.pos[i3] += (p.x - this.pos[i3]) * 0.52;
          this.pos[i3 + 1] += (p.y - this.pos[i3 + 1]) * 0.52;
          this.pos[i3 + 2] += (p.z - this.pos[i3 + 2]) * 0.52;
          this.prevPos[i3] = this.pos[i3];
          this.prevPos[i3 + 1] = this.pos[i3 + 1];
          this.prevPos[i3 + 2] = this.pos[i3 + 2];

          this.bunch[idx] = Math.min(1.0, smoothEnvelope * 1.05 * Math.min(1.0, rolledAmount * 3.2));
          this.lift[idx] = radialPuff - CLEARANCE;
        } else {
          this.bunch[idx] *= 0.85;
        }
      }
    }
  }

  /**
   * Propagates a realistic vertical stocking run / ladder above & below a newly torn quad.
   */
  _spawnVerticalLadder(qIdx) {
    const r0 = Math.floor(qIdx / this.cols);
    const c0 = qIdx % this.cols;
    const runUp = 6 + Math.floor(Math.random() * 9);
    const runDown = 6 + Math.floor(Math.random() * 9);

    for (let dr = -runDown; dr <= runUp; dr++) {
      const r = r0 + dr;
      if (r <= 1 || r >= this.rows - 1) continue;
      const distFrac = dr >= 0 ? dr / runUp : -dr / runDown;
      const strength = Math.pow(1.0 - distFrac, 1.35) * 0.92;

      const idxCenter = this._pIdx(c0, r);
      const idxRight = this._pIdx(c0 + 1, r);
      const idxLeft = this._pIdx(c0 - 1, r);
      if (strength > this.ladder[idxCenter]) this.ladder[idxCenter] = strength;
      if (strength * 0.65 > this.ladder[idxRight]) this.ladder[idxRight] = strength * 0.65;
      if (strength * 0.45 > this.ladder[idxLeft]) this.ladder[idxLeft] = strength * 0.45;
    }
  }

  step(dt = 1 / 60) {
    // Handle Roll-Down cuff deformation before physics substeps
    this._applyRollDownDeformation();
    const isRolled = STOCKING_Y_TOP - this.cuffY > 0.005;

    const substeps = 4;
    const subDt = Math.min(dt, 1 / 30) / substeps;
    const damping = 0.945;
    const gravityY = -1.6;

    for (let i = 0; i < this.numParticles; i++) {
      this.strain[i] *= 0.82;
    }

    const tearSens = Math.max(0.25, this.tearSensitivity);
    // Stretch ratio thresholds: allow rich elastic pulling & wrinkles before tearing!
    const baseWeftTear = 2.45 / tearSens;
    const baseWarpTear = 2.62 / tearSens;
    // Lower threshold at existing tear edges -> controlled, natural tear spread
    const edgeWeftTear = 1.78 / tearSens;
    const edgeWarpTear = 1.92 / tearSens;
    let tearsThisFrame = 0;
    const maxTearsPerFrame = 2;

    const gx = this.grabTarget.x;
    const gy = this.grabTarget.y;
    const gz = this.grabTarget.z;

    for (let step = 0; step < substeps; step++) {
      for (let i = 0; i < this.numParticles; i++) {
        if (this.invMass[i] === 0 || (isRolled && this.bunch[i] > 0.05)) continue;
        const i3 = i * 3;
        const localDamp = this.lift[i] < 0.0025 ? 0.80 : damping;
        const vx = (this.pos[i3] - this.prevPos[i3]) * localDamp;
        const vy = (this.pos[i3 + 1] - this.prevPos[i3 + 1]) * localDamp;
        const vz = (this.pos[i3 + 2] - this.prevPos[i3 + 2]) * localDamp;

        this.prevPos[i3] = this.pos[i3];
        this.prevPos[i3 + 1] = this.pos[i3 + 1];
        this.prevPos[i3 + 2] = this.pos[i3 + 2];

        this.pos[i3] += vx;
        this.pos[i3 + 1] += vy + gravityY * subDt * subDt;
        this.pos[i3 + 2] += vz;
      }

      if (this.grabIndex >= 0 && this.grabWeights.length > 0) {
        const tx = this.grabTarget.x;
        const ty = this.grabTarget.y;
        const tz = this.grabTarget.z;

        for (let k = 0; k < this.grabWeights.length; k++) {
          const gw = this.grabWeights[k];
          const i3 = gw.idx * 3;
          const pull = gw.weight * 0.55;
          this.pos[i3] += (tx + gw.ox - this.pos[i3]) * pull;
          this.pos[i3 + 1] += (ty + gw.oy - this.pos[i3 + 1]) * pull;
          this.pos[i3 + 2] += (tz + gw.oz - this.pos[i3 + 2]) * pull;
        }
      }

      for (let s = 0; s < this.numSprings; s++) {
        if (!this.sAlive[s]) continue;

        const a = this.sA[s];
        const b = this.sB[s];
        const wA = this.invMass[a];
        const wB = this.invMass[b];
        const wSum = wA + wB;
        if (wSum === 0) continue;

        const a3 = a * 3;
        const b3 = b * 3;
        const dx = this.pos[b3] - this.pos[a3];
        const dy = this.pos[b3 + 1] - this.pos[a3 + 1];
        const dz = this.pos[b3 + 2] - this.pos[a3 + 2];
        const dist = Math.hypot(dx, dy, dz) || 1e-6;
        const rest = this.sRest[s];
        const ratio = dist / rest;

        if (ratio > 1.04) {
          const st = ratio - 1.0;
          if (st > this.strain[a]) this.strain[a] = st;
          if (st > this.strain[b]) this.strain[b] = st;
        }

        const sType = this.sType[s];
        if (sType < 2 && this.grabIndex >= 0 && tearsThisFrame < maxTearsPerFrame) {
          // Only tear in the active pull stress zone near the grabbed point
          const mx = (this.pos[a3] + this.pos[b3]) * 0.5;
          const my = (this.pos[a3 + 1] + this.pos[b3 + 1]) * 0.5;
          const mz = (this.pos[a3 + 2] + this.pos[b3 + 2]) * 0.5;
          const distToGrabSq =
            (mx - gx) * (mx - gx) + (my - gy) * (my - gy) + (mz - gz) * (mz - gz);

          if (distToGrabSq < 0.085) {
            const nearEdge = this.isTearEdge[a] || this.isTearEdge[b];
            const onLadder = this.ladder[a] > 0.35 || this.ladder[b] > 0.35;
            let thresh =
              sType === 0
                ? nearEdge
                  ? edgeWeftTear
                  : baseWeftTear
                : nearEdge
                  ? edgeWarpTear
                  : baseWarpTear;

            // Existing vertical runs/ladders weaken horizontal weft so chained holes pop naturally
            if (onLadder && sType === 0) {
              thresh *= 0.86;
            }

            if (ratio > thresh) {
              this._breakSpring(s, a, b, rest);
              tearsThisFrame++;
              continue;
            }
          }
        }

        const diff = ((dist - rest) / dist) * this.sStiff[s];
        const corrX = dx * diff;
        const corrY = dy * diff;
        const corrZ = dz * diff;

        const fA = wA / wSum;
        const fB = wB / wSum;

        this.pos[a3] += corrX * fA;
        this.pos[a3 + 1] += corrY * fA;
        this.pos[a3 + 2] += corrZ * fA;

        this.pos[b3] -= corrX * fB;
        this.pos[b3 + 1] -= corrY * fB;
        this.pos[b3 + 2] -= corrZ * fB;
      }

      for (let i = 0; i < this.numParticles; i++) {
        if (this.invMass[i] === 0 || (isRolled && this.bunch[i] > 0.05)) continue;
        const i3 = i * 3;
        this._tmpP.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]);
        const liftDist = projectPointOutsideLeg(this.side, this._tmpP, CLEARANCE);
        this.pos[i3] = this._tmpP.x;
        this.pos[i3 + 1] = this._tmpP.y;
        this.pos[i3 + 2] = this._tmpP.z;
        this.lift[i] = liftDist;
      }
    }

    if (this.indicesDirty) {
      this._updateTearEdgeFlags();
      this._rebuildIndexBuffer();
    }

    this._syncGeometryAttributes();
    this._updateFrayLines();
  }

  _breakSpring(sIdx, a, b, restLen) {
    this.sAlive[sIdx] = 0;
    this.hasAnyTear = true;

    const q1 = this.sQ1[sIdx];
    const q2 = this.sQ2[sIdx];

    if (q1 >= 0 && this.quadAlive[q1]) {
      this.quadAlive[q1] = 0;
      this._spawnVerticalLadder(q1);
      this.indicesDirty = true;
    }
    if (q2 >= 0 && this.quadAlive[q2]) {
      this.quadAlive[q2] = 0;
      this._spawnVerticalLadder(q2);
      this.indicesDirty = true;
    }

    if (this.onTear) {
      this.onTear();
    }

    if (this.frayStrands.length < MAX_FRAY_STRANDS && Math.random() < 0.42) {
      this.frayStrands.push({
        a,
        b,
        maxLen: restLen * (2.4 + Math.random() * 1.4),
      });
    }
  }

  _updateFrayLines() {
    if (this.frayStrands.length === 0) {
      this.frayGeom.setDrawRange(0, 0);
      return;
    }

    const posAttr = this.frayGeom.attributes.position.array;
    let writeCount = 0;
    let keepCount = 0;

    for (let i = 0; i < this.frayStrands.length; i++) {
      const st = this.frayStrands[i];
      const a3 = st.a * 3;
      const b3 = st.b * 3;
      const ax = this.pos[a3],
        ay = this.pos[a3 + 1],
        az = this.pos[a3 + 2];
      const bx = this.pos[b3],
        by = this.pos[b3 + 1],
        bz = this.pos[b3 + 2];

      const dist = Math.hypot(bx - ax, by - ay, bz - az);
      if (dist > st.maxLen) continue;

      this.frayStrands[keepCount++] = st;
      const ptr = writeCount * 6;
      posAttr[ptr] = ax;
      posAttr[ptr + 1] = ay;
      posAttr[ptr + 2] = az;
      posAttr[ptr + 3] = bx;
      posAttr[ptr + 4] = by;
      posAttr[ptr + 5] = bz;
      writeCount++;
    }

    this.frayStrands.length = keepCount;
    this.frayGeom.setDrawRange(0, writeCount * 2);
    this.frayGeom.attributes.position.needsUpdate = true;
  }

  _syncGeometryAttributes() {
    const posArr = this.geometry.attributes.position.array;
    const strainArr = this.geometry.attributes.aStrain.array;
    const liftArr = this.geometry.attributes.aLift.array;
    const edgeArr = this.geometry.attributes.aTearEdge.array;
    const openArr = this.geometry.attributes.aTearOpen.array;
    const ladderArr = this.geometry.attributes.aLadder.array;
    const bunchArr = this.geometry.attributes.aBunch.array;

    for (let r = 0; r <= this.rows; r++) {
      for (let c = 0; c <= this.cols; c++) {
        const pIdx = this._pIdx(c, r);
        const vIdx = this._vIdx(c, r);
        const p3 = pIdx * 3;
        const v3 = vIdx * 3;

        posArr[v3] = this.pos[p3];
        posArr[v3 + 1] = this.pos[p3 + 1];
        posArr[v3 + 2] = this.pos[p3 + 2];

        strainArr[vIdx] = this.strain[pIdx];
        liftArr[vIdx] = this.lift[pIdx];
        edgeArr[vIdx] = this.isTearEdge[pIdx];
        openArr[vIdx] = this.tearOpen[pIdx];
        ladderArr[vIdx] = this.ladder[pIdx];
        bunchArr[vIdx] = this.bunch[pIdx];
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aStrain.needsUpdate = true;
    this.geometry.attributes.aLift.needsUpdate = true;
    this.geometry.attributes.aTearEdge.needsUpdate = true;
    this.geometry.attributes.aTearOpen.needsUpdate = true;
    this.geometry.attributes.aLadder.needsUpdate = true;
    this.geometry.attributes.aBunch.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  updateSkinBulge(skinLeg) {
    const cols = skinLeg.cols;
    const rows = skinLeg.rows;
    const posArr = skinLeg.geometry.attributes.position.array;
    const restPos = skinLeg.restPositions;
    const restNorm = skinLeg.restNormals;
    const bulgeArr = skinLeg.bulge;
    const rimAOArr = skinLeg.rimAO;

    if (!this.hasAnyTear) {
      let changed = false;
      for (let i = 0; i < bulgeArr.length; i++) {
        if (bulgeArr[i] > 0.0005 || rimAOArr[i] > 0.0005) {
          bulgeArr[i] *= 0.82;
          rimAOArr[i] *= 0.82;
          if (bulgeArr[i] < 0.0005) bulgeArr[i] = 0;
          if (rimAOArr[i] < 0.0005) rimAOArr[i] = 0;
          const i3 = i * 3;
          const disp = bulgeArr[i] * 0.0085 * this.bulgeStrength;
          posArr[i3] = restPos[i3] + restNorm[i3] * disp;
          posArr[i3 + 1] = restPos[i3 + 1] + restNorm[i3 + 1] * disp;
          posArr[i3 + 2] = restPos[i3 + 2] + restNorm[i3 + 2] * disp;
          changed = true;
        }
      }
      if (changed) {
        skinLeg.geometry.attributes.position.needsUpdate = true;
        skinLeg.geometry.attributes.aBulge.needsUpdate = true;
        skinLeg.geometry.attributes.aRimAO.needsUpdate = true;
        skinLeg.geometry.computeVertexNormals();
      }
      return;
    }

    const maxBulgeDisp = 0.0042 * this.bulgeStrength;
    const stride = cols + 1;
    const totalVerts = stride * (rows + 1);

    if (!this._bulgeRaw || this._bulgeRaw.length !== totalVerts) {
      this._bulgeRaw = new Float32Array(totalVerts);
      this._bulgeBlur = new Float32Array(totalVerts);
      this._rimRaw = new Float32Array(totalVerts);
    }

    this._bulgeRaw.fill(0);
    this._rimRaw.fill(0);

    for (let r = 0; r <= rows; r++) {
      const vSkin = r / rows;
      const y = LEG_Y_BOTTOM + vSkin * (LEG_Y_TOP - LEG_Y_BOTTOM);
      const vCloth = (y - STOCKING_Y_BOTTOM) / (STOCKING_Y_TOP - STOCKING_Y_BOTTOM);
      const cr = Math.round(vCloth * this.rows);

      if (cr < 1 || cr >= this.rows - 1) continue;

      for (let c = 0; c <= cols; c++) {
        const vIdx = r * stride + c;
        const cc = c % this.cols;
        const pCenter = this._pIdx(cc, cr);
        const openVal = this.tearOpen[pCenter];

        if (openVal > 0.01) {
          const pL = this._pIdx(cc - 1, cr);
          const pR = this._pIdx(cc + 1, cr);
          const pU = this._pIdx(cc, cr + 1);
          const pD = this._pIdx(cc, cr - 1);
          const avgLift =
            (this.lift[pCenter] +
              this.lift[pL] +
              this.lift[pR] +
              this.lift[pU] +
              this.lift[pD]) *
            0.2;

          const liftFade = Math.exp(-avgLift * 24.0);
          this._bulgeRaw[vIdx] = openVal * liftFade;
          // Rim shadow peaks right on the 0.25..0.75 border and fades inside the opening
          const rimPeak = Math.sin(Math.min(1, openVal) * Math.PI);
          this._rimRaw[vIdx] = rimPeak * liftFade;
        }
      }
    }

    // 2D spatial smoothing pass so raised skin is a silky pillowy dome (no blocky steps!)
    for (let r = 1; r < rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const vIdx = r * stride + c;
        const cL = c === 0 ? cols - 1 : c - 1;
        const cR = c === cols ? 1 : c + 1;
        this._bulgeBlur[vIdx] =
          this._bulgeRaw[vIdx] * 0.40 +
          (this._bulgeRaw[r * stride + cL] +
            this._bulgeRaw[r * stride + cR] +
            this._bulgeRaw[(r - 1) * stride + c] +
            this._bulgeRaw[(r + 1) * stride + c]) *
            0.15;
      }
    }

    for (let vIdx = 0; vIdx < totalVerts; vIdx++) {
      bulgeArr[vIdx] += (this._bulgeBlur[vIdx] - bulgeArr[vIdx]) * 0.22;
      rimAOArr[vIdx] += (this._rimRaw[vIdx] - rimAOArr[vIdx]) * 0.22;

      const disp = bulgeArr[vIdx] * maxBulgeDisp;
      const i3 = vIdx * 3;
      posArr[i3] = restPos[i3] + restNorm[i3] * disp;
      posArr[i3 + 1] = restPos[i3 + 1] + restNorm[i3 + 1] * disp;
      posArr[i3 + 2] = restPos[i3 + 2] + restNorm[i3 + 2] * disp;
    }

    skinLeg.geometry.attributes.position.needsUpdate = true;
    skinLeg.geometry.attributes.aBulge.needsUpdate = true;
    skinLeg.geometry.attributes.aRimAO.needsUpdate = true;
    skinLeg.geometry.computeVertexNormals();
  }
}
