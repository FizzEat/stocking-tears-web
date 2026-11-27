import * as THREE from 'three';

/**
 * Interactive 3D Satin Ribbon Bow mounted at the front waist of the pleated skirt (Stage 3).
 * Pulling either dangling ribbon tail outward/downward physically shrinks the bow loops
 * and unties the central knot! Once untied (progress >= 1.0), the ribbon gracefully drops loose.
 */
export class RibbonBow {
  constructor() {
    this.group = new THREE.Group();
    this.anchorPos = new THREE.Vector3(0.01, 0.64, 0.365);
    this.group.position.copy(this.anchorPos);

    this.untieProgress = 0.0; // 0 = neatly tied bow, 1 = completely untied
    this.untied = false;
    this.dropY = 0;
    this.dropVel = 0;

    this.activeTail = 0; // -1 left tail, +1 right tail, 0 none
    this.pullStartPos = new THREE.Vector3();
    this.pullStartProgress = 0;
    this.pullWorldPos = new THREE.Vector3();

    this.satinMat = new THREE.MeshStandardMaterial({
      color: '#a82644', // Deep crimson-burgundy satin sailor ribbon
      roughness: 0.34,
      metalness: 0.12,
      side: THREE.DoubleSide,
    });

    this._buildBow();
    this.updateVisuals(0);
  }

  _buildBow() {
    // 0. Satin waist sash band wrapping around the skirt so the bow sits naturally
    const sashGeom = new THREE.TorusGeometry(0.425, 0.018, 12, 48);
    sashGeom.rotateX(Math.PI * 0.5);
    sashGeom.scale(1.06, 1.0, 0.72);
    this.waistSash = new THREE.Mesh(sashGeom, this.satinMat);
    this.waistSash.position.set(-0.006, 0.02, -0.355);
    this.waistSash.renderOrder = 3.8;
    this.group.add(this.waistSash);

    // 1. Central knot
    const knotGeom = new THREE.SphereGeometry(0.036, 18, 14);
    knotGeom.scale(1.18, 0.94, 0.78);
    this.knot = new THREE.Mesh(knotGeom, this.satinMat);
    this.knot.renderOrder = 4;
    this.group.add(this.knot);

    // 2. Left & Right Bow Loops (curved ribbon torus arcs)
    this.leftLoop = this._createLoopMesh(-1);
    this.rightLoop = this._createLoopMesh(1);
    this.group.add(this.leftLoop, this.rightLoop);

    // 3. Left & Right Interactive Dangling Tails (with dovetail V-notch tips!)
    this.leftTail = this._createTailMesh(-1);
    this.rightTail = this._createTailMesh(1);
    this.group.add(this.leftTail, this.rightTail);

    // 4. Invisible larger hit targets on both tails so grabbing feels effortless
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitGeom = new THREE.SphereGeometry(0.095, 10, 10);

    this.leftHit = new THREE.Mesh(hitGeom, hitMat);
    this.leftHit.position.set(-0.08, -0.14, 0.03);
    this.leftHit.userData.ribbonTail = -1;
    this.group.add(this.leftHit);

    this.rightHit = new THREE.Mesh(hitGeom, hitMat);
    this.rightHit.position.set(0.08, -0.14, 0.03);
    this.rightHit.userData.ribbonTail = 1;
    this.group.add(this.rightHit);
  }

  _createLoopMesh(side) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(side * 0.09, 0.055, 0.035),
      new THREE.Vector3(side * 0.155, 0.015, 0.018),
      new THREE.Vector3(side * 0.105, -0.048, 0.025),
      new THREE.Vector3(0, -0.008, 0),
    ]);
    const geom = new THREE.TubeGeometry(curve, 24, 0.022, 10, false);
    geom.scale(1.0, 1.0, 0.42);
    const mesh = new THREE.Mesh(geom, this.satinMat);
    mesh.renderOrder = 4;
    mesh.userData.ribbonTail = side;
    return mesh;
  }

  _createTailMesh(side) {
    // Ribbon strip with subtle dovetail V-notch at the bottom tip
    const geom = new THREE.PlaneGeometry(0.050, 0.25, 4, 14);
    geom.translate(0, -0.125, 0);
    const pos = geom.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i];
      const y = pos[i + 1];
      // Taper slightly wider near tip and carve a crisp V-notch at the very bottom
      const t = Math.min(1, Math.abs(y) / 0.25);
      pos[i] = x * (0.82 + 0.28 * t);
      if (t > 0.88) {
        const centerFactor = 1.0 - Math.min(1.0, Math.abs(x) / 0.025);
        pos[i + 1] += centerFactor * 0.026 * ((t - 0.88) / 0.12);
      }
    }
    geom.computeVertexNormals();

    const mesh = new THREE.Mesh(geom, this.satinMat);
    mesh.position.set(side * 0.018, -0.01, 0.014);
    mesh.rotation.z = side * 0.28;
    mesh.renderOrder = 4;
    mesh.userData.ribbonTail = side;
    mesh.userData.restPositions = new Float32Array(geom.attributes.position.array);
    return mesh;
  }

  getInteractiveMeshes() {
    return [this.leftHit, this.rightHit, this.leftTail, this.rightTail, this.leftLoop, this.rightLoop];
  }

  startPull(tailSide, worldPoint) {
    if (this.untied) return false;
    this.activeTail = tailSide;
    this.pullStartPos.copy(worldPoint);
    this.pullWorldPos.copy(worldPoint);
    this.pullStartProgress = this.untieProgress;
    return true;
  }

  dragPull(worldPoint) {
    if (this.activeTail === 0 || this.untied) return;
    this.pullWorldPos.copy(worldPoint);

    // Compute how far outward + downward the player pulled the ribbon tail
    const dx = (worldPoint.x - this.pullStartPos.x) * this.activeTail;
    const dy = this.pullStartPos.y - worldPoint.y; // downward is positive
    const pullDist = Math.max(0, dx * 0.72 + dy * 0.85);

    this.untieProgress = Math.max(
      this.pullStartProgress,
      Math.min(1.0, this.pullStartProgress + pullDist * 2.35)
    );

    if (this.untieProgress >= 0.99) {
      this.untieProgress = 1.0;
      this.untied = true;
      this.activeTail = 0;
    }
  }

  releasePull() {
    this.activeTail = 0;
  }

  getHandleWorldPos(out = new THREE.Vector3()) {
    if (this.activeTail !== 0) {
      return out.copy(this.pullWorldPos);
    }
    return out.copy(this.anchorPos).add(new THREE.Vector3(0.08, -0.14, 0.04));
  }

  reset() {
    this.untieProgress = 0.0;
    this.untied = false;
    this.dropY = 0;
    this.dropVel = 0;
    this.activeTail = 0;
    this.group.position.copy(this.anchorPos);
    this.group.visible = true;
    this.updateVisuals(0);
  }

  updateVisuals(time, dt = 1 / 60) {
    if (this.untied) {
      this.dropVel += 2.6 * dt;
      this.dropY += this.dropVel * dt;
      this.group.position.y = this.anchorPos.y - this.dropY;
      this.group.position.z = this.anchorPos.z + Math.min(0.18, this.dropY * 0.25);
      if (this.dropY > 2.2) {
        this.group.visible = false;
      }
    }

    const p = this.untieProgress;

    // Loops smoothly shrink as the bow unties!
    const loopScale = Math.max(0.08, 1.0 - p * 0.92);
    this.leftLoop.scale.set(loopScale, loopScale, 1.0);
    this.rightLoop.scale.set(loopScale, loopScale, 1.0);

    // Knot loosens and flattens
    this.knot.scale.set(1.15 - p * 0.45, 0.92 - p * 0.35, 0.78 - p * 0.3);

    // Ribbon tails lengthen as loops pull through the knot + gentle satin flutter
    this._animateTail(this.leftTail, -1, p, time);
    this._animateTail(this.rightTail, 1, p, time);

    // Keep hit spheres aligned with current tail tips
    this.leftHit.position.set(-0.08 - p * 0.05, -0.14 - p * 0.08, 0.03);
    this.rightHit.position.set(0.08 + p * 0.05, -0.14 - p * 0.08, 0.03);
  }

  _animateTail(tailMesh, side, progress, time) {
    const geom = tailMesh.geometry;
    const pos = geom.attributes.position.array;
    const rest = tailMesh.userData.restPositions;
    const lengthScale = 1.0 + progress * 0.65;
    const isPulled = this.activeTail === side;

    tailMesh.rotation.z = side * (0.28 + (isPulled ? 0.22 : 0) - progress * 0.14);

    for (let i = 0; i < pos.length; i += 3) {
      const rx = rest[i];
      const ry = rest[i + 1]; // 0 at top -> -0.24 at tip
      const t = Math.min(1.0, Math.abs(ry) / 0.24);
      const sway = Math.sin(time * 2.6 + side * 1.4 + t * 3.5) * 0.012 * t;
      const pullOut = isPulled ? 0.035 * t : 0.0;

      pos[i] = rx + sway + side * pullOut;
      pos[i + 1] = ry * lengthScale;
      pos[i + 2] = Math.sin(t * Math.PI) * 0.018 + (isPulled ? 0.03 * t : 0);
    }

    geom.attributes.position.needsUpdate = true;
    geom.computeVertexNormals();
  }
}
