import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Loads a user-selected .glb / .gltf file and normalizes its scale & center
 * so it sits cleanly inside the studio camera framing.
 */
export function loadCustomGLB(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const loader = new GLTFLoader();

    loader.load(
      url,
      (gltf) => {
        URL.revokeObjectURL(url);
        const root = gltf.scene;

        // Compute bounding box to normalize height to ~2.2 units
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        const maxDim = Math.max(size.x, size.y, size.z) || 1.0;
        const targetSize = 2.25;
        const scale = targetSize / maxDim;

        root.scale.setScalar(scale);
        root.position.set(
          -center.x * scale,
          -center.y * scale - 0.12,
          -center.z * scale
        );

        root.traverse((obj) => {
          if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });

        resolve(root);
      },
      undefined,
      (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      }
    );
  });
}
