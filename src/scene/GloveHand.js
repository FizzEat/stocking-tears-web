import * as THREE from 'three';

/**
 * Petite Anime Chibi Kitty Paw cursor (二次元萌系小猫爪):
 *  - Compact, cute stylized white plush paw with sakura-pink toe beans & golden bell collar
 *  - Tiny translucent pearl-pink claws gently extend when pinching/snagging the stocking
 *  - Supports Pin mode (key '1') with a soft lavender-pink aura ring
 */
export class GloveHand {
  constructor() {
    this.group = new THREE.Group();
    this.group.renderOrder = 10;

    const furMat = new THREE.MeshStandardMaterial({
      color: '#fff8f5',
      roughness: 0.55,
      metalness: 0.0,
    });
    const pinkPadMat = new THREE.MeshStandardMaterial({
      color: '#ffa3be',
      roughness: 0.35,
      metalness: 0.04,
    });
    const clawMat = new THREE.MeshStandardMaterial({
      color: '#ffeef4',
      roughness: 0.18,
      metalness: 0.12,
    });
    const ribbonMat = new THREE.MeshStandardMaterial({
      color: '#b478e6',
      roughness: 0.42,
      metalness: 0.08,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: '#f7d27a',
      roughness: 0.22,
      metalness: 0.82,
    });

    // Origin (0,0,0) = exact fingertip/claw snag contact point; +X extends back toward wrist
    this.handRig = new THREE.Group();
    this.group.add(this.handRig);

    // 1. Chibi rounded paw body (compact & petite!)
    const pawGeom = new THREE.SphereGeometry(0.032, 20, 16);
    pawGeom.scale(1.18, 0.88, 0.72);
    const paw = new THREE.Mesh(pawGeom, furMat);
    paw.position.set(0.046, 0, 0);
    this.handRig.add(paw);

    // 2. Cute short plush arm/wrist taper
    const wristGeom = new THREE.CylinderGeometry(0.022, 0.027, 0.046, 18);
    wristGeom.rotateZ(Math.PI * 0.5);
    const wrist = new THREE.Mesh(wristGeom, furMat);
    wrist.position.set(0.082, 0, 0);
    this.handRig.add(wrist);

    // 3. Pastel lilac collar band + tiny golden bell
    const collarGeom = new THREE.TorusGeometry(0.024, 0.0055, 10, 22);
    collarGeom.rotateY(Math.PI * 0.5);
    const collar = new THREE.Mesh(collarGeom, ribbonMat);
    collar.position.set(0.092, 0, 0);
    this.handRig.add(collar);

    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 14, 12), goldMat);
    bell.position.set(0.092, -0.026, 0.012);
    this.handRig.add(bell);

    // 4. Center pink palm pad
    const mainPadGeom = new THREE.SphereGeometry(0.013, 14, 12);
    mainPadGeom.scale(0.9, 0.95, 0.45);
    const mainPad = new THREE.Mesh(mainPadGeom, pinkPadMat);
    mainPad.position.set(0.044, -0.002, 0.020);
    this.handRig.add(mainPad);

    // 5. Three cute front paw toes + sakura pink toe-beans + retractable tiny claws
    this.claws = [];
    const toeOffsets = [
      { y: 0.016, z: 0.004, rot: 0.22 },
      { y: 0.0, z: 0.008, rot: 0.0 },
      { y: -0.016, z: 0.004, rot: -0.22 },
    ];

    for (const off of toeOffsets) {
      const toe = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 14, 12), furMat);
      toe.position.set(0.016, off.y, off.z * 0.6);
      this.handRig.add(toe);

      const bean = new THREE.Mesh(new THREE.SphereGeometry(0.0062, 10, 10), pinkPadMat);
      bean.scale.set(0.85, 0.95, 0.5);
      bean.position.set(0.014, off.y, off.z * 0.6 + 0.0095);
      this.handRig.add(bean);

      // Tiny curved retractable anime claw
      const clawGeom = new THREE.ConeGeometry(0.0032, 0.015, 8);
      clawGeom.rotateZ(Math.PI * 0.5);
      const claw = new THREE.Mesh(clawGeom, clawMat);
      claw.position.set(0.006, off.y, off.z * 0.5);
      claw.rotation.z = off.rot;
      this.handRig.add(claw);
      this.claws.push({ mesh: claw, baseX: 0.008, extX: -0.003 });
    }

    // 6. Pin indicator ring (key '1')
    const pinRingGeom = new THREE.TorusGeometry(0.032, 0.0028, 8, 28);
    pinRingGeom.rotateY(Math.PI * 0.5);
    this.pinRing = new THREE.Mesh(
      pinRingGeom,
      new THREE.MeshBasicMaterial({ color: '#d49eff', transparent: true, opacity: 0.9 })
    );
    this.pinRing.position.set(0.092, 0, 0);
    this.pinRing.visible = false;
    this.handRig.add(this.pinRing);

    this.pinchAmount = 0;
    this.targetPinch = 0;
    this.visible = false;
    this.group.visible = false;
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

  updatePose(worldPos, outNormal, isPinching, dt = 0.016) {
    this.targetPinch = isPinching ? 1.0 : 0.0;
    this.pinchAmount += (this.targetPinch - this.pinchAmount) * Math.min(1, dt * 18);

    this.group.position.lerp(worldPos, Math.min(1, dt * 28));

    this._dirVec.copy(outNormal);
    this._dirVec.y -= 0.16;
    this._dirVec.z += 0.22;
    if (this._dirVec.lengthSq() < 1e-5) {
      this._dirVec.set(-1, -0.1, 0.3);
    }
    this._dirVec.normalize();

    this._quat.setFromUnitVectors(this._xAxis, this._dirVec);
    this.group.quaternion.slerp(this._quat, Math.min(1, dt * 14));

    // Gently extend tiny claws & squeeze paw slightly when snagging/tearing!
    for (const c of this.claws) {
      c.mesh.position.x = c.baseX + (c.extX - c.baseX) * this.pinchAmount;
    }
    const squeeze = 1.0 - this.pinchAmount * 0.08;
    this.handRig.scale.set(1.0 + this.pinchAmount * 0.06, squeeze, squeeze);
  }
}
