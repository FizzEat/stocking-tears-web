import * as THREE from 'three';
import { evaluateLegPoint } from '../scene/LegAnatomy.js';

const SOCK_Y_BOTTOM = -1.46;
const SOCK_Y_TOP = -0.64; // Mid-calf ribbed knit sock
const SOCK_CLEARANCE = 0.0115; // Sits cleanly outside the sheer stocking

/**
 * Generates a ribbed cotton-knit sock texture with subtle double-stripe cuff.
 */
function createSockTexture() {
  const w = 256;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#eceef2';
  ctx.fillRect(0, 0, w, h);

  // Vertical ribbed knit ridges
  for (let x = 0; x < w; x += 4) {
    ctx.fillStyle = x % 8 === 0 ? 'rgba(20, 28, 38, 0.09)' : 'rgba(255, 255, 255, 0.14)';
    ctx.fillRect(x, 0, 2, h);
  }

  // Two classic navy/charcoal collegiate stripes near the top cuff
  ctx.fillStyle = '#2d3744';
  ctx.fillRect(0, 22, w, 10);
  ctx.fillRect(0, 40, w, 10);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

let _sharedSockMat = null;
function getSockMaterial() {
  if (!_sharedSockMat) {
    _sharedSockMat = new THREE.MeshStandardMaterial({
      map: createSockTexture(),
      roughness: 0.88,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
  }
  return _sharedSockMat;
}

/**
 * Interactive outer ribbed knit sock for Stage 1 (Peel / Roll-Down).
 * Pulling downward bunches the cuff toward the ankle; past 88% it smoothly slips off!
 */
export class OuterSock {
  constructor(side, cols = 36, rows = 32) {
    this.side = side;
    this.cols = cols;
    this.rows = rows;

    this.cuffY = SOCK_Y_TOP;
    this.targetCuffY = SOCK_Y_TOP;
    this.gripAngle = Math.PI * 0.5;
    this.gripActive = false;
    this.removed = false;
    this.dropOffset = 0;

    this._tmpP = new THREE.Vector3();
    this._buildMesh();
    this._updateVertices();
  }

  _buildMesh() {
    const numVerts = (this.cols + 1) * (this.rows + 1);
    const positions = new Float32Array(numVerts * 3);
    const uvs = new Float32Array(numVerts * 2);

    let ptr = 0;
    for (let r = 0; r <= this.rows; r++) {
      const v = r / this.rows;
      for (let c = 0; c <= this.cols; c++) {
        const u = c / this.cols;
        uvs[ptr * 2] = u * 2.0;
        uvs[ptr * 2 + 1] = v; // v=1 top maps to top stripes with default CanvasTexture flipY
        ptr++;
      }
    }

    const indices = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const a = r * (this.cols + 1) + c;
        const b = a + 1;
        const d = (r + 1) * (this.cols + 1) + c;
        const e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setIndex(indices);

    this.mesh = new THREE.Mesh(this.geometry, getSockMaterial());
    this.mesh.renderOrder = 3.2;
    this.mesh.userData.outerSock = this;
  }

  getProgress() {
    if (this.removed) return 1.0;
    const total = SOCK_Y_TOP - (SOCK_Y_BOTTOM + 0.14);
    return Math.max(0, Math.min(1, (SOCK_Y_TOP - this.cuffY) / total));
  }

  pullTo(worldY, gripPoint = null) {
    if (this.removed) return;
    const minY = SOCK_Y_BOTTOM + 0.10;
    this.targetCuffY = Math.max(minY, Math.min(SOCK_Y_TOP, worldY));
    if (gripPoint) {
      const legCenterX = this.side * 0.22;
      this.gripAngle = Math.atan2(gripPoint.z, gripPoint.x - legCenterX);
      this.gripActive = true;
    }
  }

  releaseGrip() {
    this.gripActive = false;
  }

  getHandlePoint(out = new THREE.Vector3()) {
    const rolled = Math.max(0, SOCK_Y_TOP - this.cuffY);
    const puff = SOCK_CLEARANCE + Math.min(0.024, rolled * 0.04);
    return evaluateLegPoint(this.side, this.cuffY - this.dropOffset, this.gripAngle, puff, out);
  }

  reset() {
    this.cuffY = SOCK_Y_TOP;
    this.targetCuffY = SOCK_Y_TOP;
    this.gripActive = false;
    this.removed = false;
    this.dropOffset = 0;
    this.mesh.visible = true;
    this._updateVertices();
  }

  step(dt = 1 / 60) {
    if (this.removed) {
      if (this.dropOffset < 0.75) {
        this.dropOffset += dt * 1.45;
        this._updateVertices();
      } else {
        this.mesh.visible = false;
      }
      return;
    }

    this.cuffY += (this.targetCuffY - this.cuffY) * 0.24;

    if (this.getProgress() >= 0.88) {
      this.removed = true;
      this.gripActive = false;
    }

    this._updateVertices();
  }

  _updateVertices() {
    const posArr = this.geometry.attributes.position.array;
    const rolled = Math.max(0, SOCK_Y_TOP - this.cuffY);
    const bandHeight = Math.min(0.14, 0.04 + rolled * 0.18);
    const maxPuff = Math.min(0.026, 0.005 + rolled * 0.032);
    const p = this._tmpP;

    let ptr = 0;
    for (let r = 0; r <= this.rows; r++) {
      const v = r / this.rows;
      const restY = SOCK_Y_BOTTOM + v * (SOCK_Y_TOP - SOCK_Y_BOTTOM);

      for (let c = 0; c <= this.cols; c++) {
        const theta = ((c % this.cols) / this.cols) * Math.PI * 2;
        const rib = Math.sin(theta * 24.0) * 0.0014;
        const gripDip = this.gripActive
          ? -0.022 * Math.pow(Math.max(0, Math.cos(theta - this.gripAngle)), 2.0) * Math.min(1, rolled * 4.5)
          : 0.0;

        const localCuffY = Math.max(SOCK_Y_BOTTOM + 0.08, this.cuffY + gripDip);

        let finalY = restY;
        let radial = SOCK_CLEARANCE + rib;

        // Slight rolled elastic hem thickness at very top even before pulling
        if (v > 0.92) {
          radial += 0.003 * Math.sin(((v - 0.92) / 0.08) * Math.PI);
        }

        if (rolled > 0.002 && restY > localCuffY - bandHeight) {
          const excess = Math.max(0, restY - (localCuffY - bandHeight));
          const maxExcess = Math.max(0.01, SOCK_Y_TOP - (localCuffY - bandHeight));
          const uBand = Math.min(1.0, excess / maxExcess);
          finalY = localCuffY - bandHeight + uBand * bandHeight;
          const folds = Math.sin(uBand * Math.PI * 4.0 + Math.sin(theta * 3.0) * 0.7) * 0.35 + 0.65;
          radial += maxPuff * Math.sin(uBand * Math.PI) * folds;
        }

        evaluateLegPoint(this.side, finalY - this.dropOffset, theta, radial, p);
        posArr[ptr * 3] = p.x;
        posArr[ptr * 3 + 1] = p.y;
        posArr[ptr * 3 + 2] = p.z;
        ptr++;
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}
