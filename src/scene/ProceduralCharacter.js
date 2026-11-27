import * as THREE from 'three';
import {
  LEG_Y_BOTTOM,
  LEG_Y_TOP,
  evaluateLegPoint,
} from './LegAnatomy.js';
import { createSkinMaterial } from '../shaders/skinShader.js';

/**
 * Builds one anatomical leg skin mesh whose grid matches the stocking's (cols, rows)
 * parameterization so tear openings can smoothly push the underlying skin outward
 * (and fade that raised effect as the torn fabric lifts away from the thigh).
 */
export function createLegSkinMesh(side, skinMaterial, cols = 48, rows = 76) {
  const numVerts = (cols + 1) * (rows + 1);
  const positions = new Float32Array(numVerts * 3);
  const restPositions = new Float32Array(numVerts * 3);
  const restNormals = new Float32Array(numVerts * 3);
  const uvs = new Float32Array(numVerts * 2);
  const bulgeAttr = new Float32Array(numVerts);
  const rimAOAttr = new Float32Array(numVerts);

  const p = new THREE.Vector3();
  let vIdx = 0;

  for (let r = 0; r <= rows; r++) {
    const v = r / rows; // 0 = bottom, 1 = top
    const y = LEG_Y_BOTTOM + v * (LEG_Y_TOP - LEG_Y_BOTTOM);

    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const theta = u * Math.PI * 2;
      evaluateLegPoint(side, y, theta, 0.0, p);

      positions[vIdx * 3] = p.x;
      positions[vIdx * 3 + 1] = p.y;
      positions[vIdx * 3 + 2] = p.z;

      restPositions[vIdx * 3] = p.x;
      restPositions[vIdx * 3 + 1] = p.y;
      restPositions[vIdx * 3 + 2] = p.z;

      uvs[vIdx * 2] = u;
      uvs[vIdx * 2 + 1] = v;

      vIdx++;
    }
  }

  const indices = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + 1;
      const d = (r + 1) * (cols + 1) + c;
      const e = d + 1;
      indices.push(a, d, b);
      indices.push(b, d, e);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('aBulge', new THREE.BufferAttribute(bulgeAttr, 1));
  geometry.setAttribute('aRimAO', new THREE.BufferAttribute(rimAOAttr, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  // Save clean rest normals so bulge displacement always pushes cleanly along skin normal
  const normArr = geometry.attributes.normal.array;
  restNormals.set(normArr);

  // Weld seam normals (c = 0 and c = cols) for seamless shading
  for (let r = 0; r <= rows; r++) {
    const i0 = r * (cols + 1) * 3;
    const i1 = (r * (cols + 1) + cols) * 3;
    const nx = restNormals[i0] + restNormals[i1];
    const ny = restNormals[i0 + 1] + restNormals[i1 + 1];
    const nz = restNormals[i0 + 2] + restNormals[i1 + 2];
    const len = Math.hypot(nx, ny, nz) || 1;
    restNormals[i0] = restNormals[i1] = nx / len;
    restNormals[i0 + 1] = restNormals[i1 + 1] = ny / len;
    restNormals[i0 + 2] = restNormals[i1 + 2] = nz / len;
    normArr[i0] = normArr[i1] = nx / len;
    normArr[i0 + 1] = normArr[i1 + 1] = ny / len;
    normArr[i0 + 2] = normArr[i1 + 2] = nz / len;
  }

  const mesh = new THREE.Mesh(geometry, skinMaterial);
  mesh.renderOrder = 1;

  return {
    mesh,
    geometry,
    cols,
    rows,
    restPositions,
    restNormals,
    bulge: bulgeAttr,
    rimAO: rimAOAttr,
  };
}

/**
 * Generates a woven dark charcoal-grey pleated skirt texture with double white hem stripes,
 * matching the aesthetic of the reference showcase.
 */
function createSkirtTexture() {
  const w = 512;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // Charcoal-slate serge wool base
  ctx.fillStyle = '#363a40';
  ctx.fillRect(0, 0, w, h);

  // Subtle woven fabric twill noise
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const twill = ((x + y) % 4 === 0 ? 7 : -3);
      const grain = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      const delta = twill + (grain - 0.5) * 14;
      data[idx] = Math.max(0, Math.min(255, data[idx] + delta));
      data[idx + 1] = Math.max(0, Math.min(255, data[idx + 1] + delta));
      data[idx + 2] = Math.max(0, Math.min(255, data[idx + 2] + delta + 2));
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // Two crisp off-white sailor stripes near the bottom hem (v near 0 -> bottom of canvas y near h)
  ctx.fillStyle = '#d8dde3';
  ctx.fillRect(0, h - 74, w, 14);
  ctx.fillRect(0, h - 42, w, 14);

  // Subtle dark stitching shadow above/below stripes
  ctx.fillStyle = 'rgba(12, 16, 22, 0.25)';
  ctx.fillRect(0, h - 76, w, 2);
  ctx.fillRect(0, h - 28, w, 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Creates a stylized knife-pleated skirt wrapping the upper thighs / hips.
 */
export function createPleatedSkirt() {
  const numPleats = 18;
  const segsPerPleat = 8;
  const radialSegs = numPleats * segsPerPleat;
  const heightSegs = 24;

  const yTop = 1.06;
  const yBottom = 0.41;

  const numVerts = (radialSegs + 1) * (heightSegs + 1);
  const positions = new Float32Array(numVerts * 3);
  const uvs = new Float32Array(numVerts * 2);

  let idx = 0;
  for (let h = 0; h <= heightSegs; h++) {
    const v = h / heightSegs; // 0 = bottom hem, 1 = waist
    const y = yBottom + v * (yTop - yBottom);
    const flare = 1.0 - v; // 0 at waist, 1 at hem

    // Elliptical hip-to-hem silhouette wider in X than Z (cleanly clears upper thighs)
    const rxBase = 0.435 + 0.155 * Math.pow(flare, 1.15);
    const rzBase = 0.295 + 0.125 * Math.pow(flare, 1.15);

    for (let s = 0; s <= radialSegs; s++) {
      const u = s / radialSegs;
      const theta = u * Math.PI * 2;

      // Crisp asymmetric knife-pleat sawtooth profile
      const pleatPhase = (u * numPleats) % 1.0;
      const pleatWave =
        pleatPhase < 0.72
          ? (pleatPhase / 0.72) * 2.0 - 1.0
          : 1.0 - ((pleatPhase - 0.72) / 0.28) * 2.0;

      // Pleat depth grows toward the hem
      const pleatDepth = (0.012 + 0.036 * Math.pow(flare, 0.85)) * pleatWave;

      // Gentle hem waviness for natural cloth drape
      const hemWave = Math.sin(theta * 3.0 + 0.6) * 0.014 * flare;

      const x = (rxBase + pleatDepth) * Math.cos(theta) + 0.004;
      const z = (rzBase + pleatDepth * 0.85) * Math.sin(theta) + 0.01;
      const yFinal = y + hemWave;

      positions[idx * 3] = x;
      positions[idx * 3 + 1] = yFinal;
      positions[idx * 3 + 2] = z;

      uvs[idx * 2] = u * 4.0;
      uvs[idx * 2 + 1] = v;
      idx++;
    }
  }

  const indices = [];
  for (let h = 0; h < heightSegs; h++) {
    for (let s = 0; s < radialSegs; s++) {
      const a = h * (radialSegs + 1) + s;
      const b = a + 1;
      const d = (h + 1) * (radialSegs + 1) + s;
      const e = d + 1;
      indices.push(a, d, b);
      indices.push(b, d, e);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  const texture = createSkirtTexture();
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.86,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.renderOrder = 3;

  // Inner dark shadow cap under the skirt so camera angles never see hollow sky
  const capGeom = new THREE.CylinderGeometry(0.32, 0.42, 0.14, 32);
  const capMat = new THREE.MeshBasicMaterial({ color: '#0c1015', side: THREE.DoubleSide });
  const capMesh = new THREE.Mesh(capGeom, capMat);
  capMesh.position.set(0, 0.72, 0);
  mesh.add(capMesh);

  return mesh;
}

/**
 * Creates the full procedural character group (left leg, right leg, pleated skirt).
 */
export function createProceduralCharacter() {
  const group = new THREE.Group();
  const skinMaterial = createSkinMaterial();

  const leftLeg = createLegSkinMesh(-1, skinMaterial);
  const rightLeg = createLegSkinMesh(1, skinMaterial);
  const skirt = createPleatedSkirt();

  group.add(leftLeg.mesh);
  group.add(rightLeg.mesh);
  group.add(skirt);

  return {
    group,
    skinMaterial,
    leftLeg,
    rightLeg,
    skirt,
  };
}
