import * as THREE from 'three';

/**
 * 3D Cartoon White Gloved Hand cursor (inspired by the Sakura Rabbit demo):
 *  - Puffy white glove cuff with dark inner opening
 *  - Rounded palm with 3 classic black back-of-hand stripes
 *  - Articulated thumb + pinching index finger that smoothly closes when grabbing
 *  - Supports "Pin" mode (key 1) with a subtle cyan glow ring so the user knows it's pinned
 */
export class GloveHand {
  constructor() {
    this.group = new THREE.Group();
    this.group.renderOrder = 10;

    // Materials
    const gloveMat = new THREE.MeshStandardMaterial({
      color: '#f2f4f7',
      roughness: 0.42,
      metalness: 0.02,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: '#0d1014',
      roughness: 0.9,
    });
    const stripeMat = new THREE.MeshStandardMaterial({
      color: '#1b1f26',
      roughness: 0.6,
    });

    // Local coordinate convention:
    //   Origin (0, 0, 0) = exact fingertip pinch contact point!
    //   +X points back toward the wrist/cuff so lookAt / orientation aligns cleanly.
    this.handRig = new THREE.Group();
    this.group.add(this.handRig);

    // 1. Palm
    const palmGeom = new THREE.SphereGeometry(0.056, 20, 16);
    palmGeom.scale(1.18, 0.86, 0.62);
    const palm = new THREE.Mesh(palmGeom, gloveMat);
    palm.position.set(0.115, -0.005, 0);
    this.handRig.add(palm);

    // 2. Three classic black stripes on the back of the glove
    for (let i = -1; i <= 1; i++) {
      const stripeGeom = new THREE.CapsuleGeometry(0.0042, 0.052, 4, 8);
      stripeGeom.rotateZ(Math.PI * 0.5);
      const stripe = new THREE.Mesh(stripeGeom, stripeMat);
      stripe.position.set(0.12, i * 0.018 - 0.004, 0.032);
      stripe.rotation.z = i * 0.08;
      this.handRig.add(stripe);
    }

    // 3. Puffy wrist cuff
    const cuffGeom = new THREE.TorusGeometry(0.044, 0.016, 12, 24);
    cuffGeom.rotateY(Math.PI * 0.5);
    const cuff = new THREE.Mesh(cuffGeom, gloveMat);
    cuff.position.set(0.195, -0.015, 0);
    cuff.rotation.z = -0.18;
    this.handRig.add(cuff);

    const wristGeom = new THREE.CylinderGeometry(0.044, 0.038, 0.055, 20);
    wristGeom.rotateZ(Math.PI * 0.5);
    const wrist = new THREE.Mesh(wristGeom, gloveMat);
    wrist.position.set(0.17, -0.012, 0);
    wrist.rotation.z = -0.18;
    this.handRig.add(wrist);

    // Dark hollow inside the cuff
    const holeGeom = new THREE.CircleGeometry(0.038, 20);
    holeGeom.rotateY(Math.PI * 0.5);
    const hole = new THREE.Mesh(holeGeom, darkMat);
    hole.position.set(0.205, -0.017, 0);
    hole.rotation.z = -0.18;
    this.handRig.add(hole);

    // 4. Articulated Index Finger (reaches to origin 0,0,0 when pinching)
    this.indexPivot = new THREE.Group();
    this.indexPivot.position.set(0.072, 0.028, 0.004);
    this.handRig.add(this.indexPivot);

    const idxSeg1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0145, 0.038, 6, 12), gloveMat);
    idxSeg1.rotation.z = Math.PI * 0.5 - 0.25;
    idxSeg1.position.set(-0.024, 0.006, 0);
    this.indexPivot.add(idxSeg1);

    const idxTip = new THREE.Mesh(new THREE.CapsuleGeometry(0.0135, 0.036, 6, 12), gloveMat);
    idxTip.rotation.z = Math.PI * 0.5 + 0.52;
    idxTip.position.set(-0.056, -0.011, 0);
    this.indexPivot.add(idxTip);

    // 5. Articulated Thumb (opposes index finger at origin 0,0,0)
    this.thumbPivot = new THREE.Group();
    this.thumbPivot.position.set(0.076, -0.034, 0.008);
    this.handRig.add(this.thumbPivot);

    const thumbMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.0155, 0.052, 6, 12), gloveMat);
    thumbMesh.rotation.z = Math.PI * 0.5 - 0.42;
    thumbMesh.position.set(-0.038, 0.014, 0);
    this.thumbPivot.add(thumbMesh);

    // 6. Curled middle & ring fingers tucked neatly below
    for (let f = 0; f < 2; f++) {
      const fMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.0135, 0.038, 6, 10), gloveMat);
      fMesh.rotation.z = Math.PI * 0.5 + 0.35;
      fMesh.position.set(0.068 + f * 0.008, -0.014 - f * 0.022, -0.014 - f * 0.006);
      this.handRig.add(fMesh);
    }

    // 7. Subtle pin indicator ring (only visible when pinned with key '1')
    const pinRingGeom = new THREE.TorusGeometry(0.052, 0.0035, 8, 28);
    pinRingGeom.rotateY(Math.PI * 0.5);
    this.pinRingMat = new THREE.MeshBasicMaterial({
      color: '#6ec6f5',
      transparent: true,
      opacity: 0.85,
    });
    this.pinRing = new THREE.Mesh(pinRingGeom, this.pinRingMat);
    this.pinRing.position.set(0.195, -0.015, 0);
    this.pinRing.rotation.z = -0.18;
    this.pinRing.visible = false;
    this.handRig.add(this.pinRing);

    this.pinchAmount = 0;
    this.targetPinch = 0;
    this.visible = false;
    this.group.visible = false;
    this._targetPos = new THREE.Vector3();
    this._dirVec = new THREE.Vector3(1, 0, 0);
    this._quat = new THREE.Quaternion();
    this._xAxis = new THREE.Vector3(1, 0, 0);
  }

  setPinned(pinned) {
    this.pinRing.visible = pinned;
  }

  setVisible(vis) {
    this.visible = vis;
    this.group.visible = vis;
  }

  /**
   * Position the glove fingertip at `worldPos`, oriented away from the leg along `outNormal`.
   */
  updatePose(worldPos, outNormal, isPinching, dt = 0.016) {
    this.targetPinch = isPinching ? 1.0 : 0.0;
    this.pinchAmount += (this.targetPinch - this.pinchAmount) * Math.min(1, dt * 18);

    // Smoothly move fingertip to target
    this.group.position.lerp(worldPos, Math.min(1, dt * 28));

    // Orient +X axis of glove along outNormal (with slight downward tilt like a natural hand)
    this._dirVec.copy(outNormal);
    this._dirVec.y -= 0.22;
    this._dirVec.z += 0.28;
    if (this._dirVec.lengthSq() < 1e-5) {
      this._dirVec.set(1, -0.15, 0.3);
    }
    this._dirVec.normalize();

    this._quat.setFromUnitVectors(this._xAxis, this._dirVec);
    this.group.quaternion.slerp(this._quat, Math.min(1, dt * 14));

    // Animate finger pinch
    const openAngle = (1.0 - this.pinchAmount) * 0.34;
    this.indexPivot.rotation.z = -openAngle;
    this.thumbPivot.rotation.z = openAngle * 1.1;
  }
}
