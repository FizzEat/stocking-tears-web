import * as THREE from 'three';

/**
 * Builds the warm sunlit indoor room props matching the user's reference video:
 *  1. Modern brushed-brass tubular frame chair with taupe leather cushion (under seat y ≈ 0.45)
 *  2. Warm oak wood desk & shelf backdrop behind the seated figure
 *  3. Sleek glossy nude-beige pointed stiletto pump resting on the floor beside the supporting foot
 */
export function createRoomProps() {
  const group = new THREE.Group();

  const brassMat = new THREE.MeshStandardMaterial({
    color: '#9c8356',
    roughness: 0.34,
    metalness: 0.72,
  });

  const leatherMat = new THREE.MeshStandardMaterial({
    color: '#8f7d6e',
    roughness: 0.68,
    metalness: 0.04,
  });

  const oakMat = new THREE.MeshStandardMaterial({
    color: '#b88f64',
    roughness: 0.62,
    metalness: 0.02,
  });

  const oakDarkMat = new THREE.MeshStandardMaterial({
    color: '#8e6a45',
    roughness: 0.70,
    metalness: 0.02,
  });

  const heelMat = new THREE.MeshStandardMaterial({
    color: '#e8cfc2', // Glossy nude-beige patent leather pump
    roughness: 0.16,
    metalness: 0.08,
  });

  const heelInnerMat = new THREE.MeshStandardMaterial({
    color: '#2c2420',
    roughness: 0.85,
  });

  // -------------------------------------------------------------------------
  // 1. Modern Brass-Frame Chair (seat top at y = 0.455, floor at y = 0.0)
  // -------------------------------------------------------------------------
  const chair = new THREE.Group();
  // Seat cushion
  const seatGeom = new THREE.BoxGeometry(0.46, 0.055, 0.44);
  const seat = new THREE.Mesh(seatGeom, leatherMat);
  seat.position.set(0, 0.435, -0.02);
  chair.add(seat);

  // Curved backrest bar
  const backGeom = new THREE.BoxGeometry(0.46, 0.24, 0.045);
  const back = new THREE.Mesh(backGeom, leatherMat);
  back.position.set(0, 0.74, -0.23);
  back.rotation.x = -0.10;
  chair.add(back);

  // Brushed brass tubular frame legs & runners
  const addTube = (p1, p2, r = 0.013) => {
    const v1 = new THREE.Vector3(...p1);
    const v2 = new THREE.Vector3(...p2);
    const dir = new THREE.Vector3().subVectors(v2, v1);
    const len = dir.length();
    const geom = new THREE.CylinderGeometry(r, r, len, 12);
    const mesh = new THREE.Mesh(geom, brassMat);
    mesh.position.copy(v1).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    chair.add(mesh);
  };

  for (const sx of [-0.21, 0.21]) {
    // Front leg down to floor
    addTube([sx, 0.43, 0.18], [sx, 0.015, 0.18]);
    // Floor runner back
    addTube([sx, 0.015, 0.18], [sx, 0.015, -0.22]);
    // Back leg up to backrest
    addTube([sx, 0.015, -0.22], [sx, 0.74, -0.22]);
    // Side rail under cushion
    addTube([sx, 0.43, 0.18], [sx, 0.43, -0.22]);
  }
  // Cross brace under seat
  addTube([-0.21, 0.41, 0.14], [0.21, 0.41, 0.14], 0.011);
  addTube([-0.21, 0.015, -0.22], [0.21, 0.015, -0.22], 0.011);

  group.add(chair);

  // -------------------------------------------------------------------------
  // 2. Warm Oak Wood Desk & Wall Shelf Backdrop (to the right/back like video)
  // -------------------------------------------------------------------------
  const desk = new THREE.Group();
  const deskTop = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.045, 0.65), oakMat);
  deskTop.position.set(0.68, 0.74, 0.28);
  desk.add(deskTop);

  const deskPanel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.74, 0.60), oakDarkMat);
  deskPanel.position.set(1.26, 0.37, 0.28);
  desk.add(deskPanel);

  // Warm oak back wall behind desk
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, 0.06), oakDarkMat);
  backWall.position.set(0.55, 1.1, -0.62);
  desk.add(backWall);

  group.add(desk);

  // -------------------------------------------------------------------------
  // 3. Sleek Unified Glossy Nude-Beige Pointed Stiletto Pump on the Wood Floor
  const buildStiletto = () => {
    const shoe = new THREE.Group();

    // Smooth curved sole + pointed toe box
    const vampGeom = new THREE.ConeGeometry(0.036, 0.16, 22);
    vampGeom.rotateX(Math.PI * 0.5);
    vampGeom.scale(1.0, 0.46, 1.0);
    const vamp = new THREE.Mesh(vampGeom, heelMat);
    vamp.position.set(0, 0.017, 0.085);
    shoe.add(vamp);

    // Arched sole bridge connecting toe box to stiletto heel
    const archGeom = new THREE.BoxGeometry(0.052, 0.008, 0.13);
    const arch = new THREE.Mesh(archGeom, heelMat);
    arch.position.set(0, 0.052, -0.015);
    arch.rotation.x = 0.54;
    shoe.add(arch);

    // Sleek sculpted back heel counter
    const cupGeom = new THREE.SphereGeometry(0.032, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
    cupGeom.scale(0.88, 1.35, 1.0);
    const cup = new THREE.Mesh(cupGeom, heelMat);
    cup.position.set(0, 0.095, -0.068);
    cup.rotation.x = -Math.PI * 0.42;
    shoe.add(cup);

    // Slender stiletto spike touching floor cleanly at y = 0
    const spikeGeom = new THREE.CylinderGeometry(0.007, 0.0038, 0.092, 12);
    const spike = new THREE.Mesh(spikeGeom, heelMat);
    spike.position.set(0, 0.046, -0.068);
    shoe.add(spike);

    return shoe;
  };

  // Loose stiletto sitting naturally on the floor in front of supporting foot
  const floorPump = buildStiletto();
  floorPump.position.set(0.08, 0.0, 0.42);
  floorPump.rotation.y = 0.82;
  group.add(floorPump);

  return group;
}
