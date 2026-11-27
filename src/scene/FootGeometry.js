import * as THREE from 'three';
import { LEG_Y_BOTTOM, FLOOR_Y, getLegCenter } from './LegAnatomy.js';

/**
 * Procedurally sculpts a photorealistic 3D foot + 5 individual toes seamlessly
 * joined to the ankle at y = LEG_Y_BOTTOM (-1.56) and resting flat on FLOOR_Y (-1.685).
 *
 * Key realism detail (matching Sakura Rabbit's VIEW 02):
 *  - Bare skin underneath has 5 sculpted individual toes with subtle inter-toe shadows.
 *  - The sheer nylon stocking over the foot is ONE UNIFIED TAUT SOCK MESH that stretches
 *    smoothly across the instep and softly over all 5 toes (gentle 5-toe undulations without
 *    cartoon dark gaps between toes!).
 */
export function createSculptedFoot(side, skinMaterial, stockingMaterial) {
  const ankleCenter = getLegCenter(side, LEG_Y_BOTTOM);

  const footGroup = new THREE.Group();
  footGroup.position.set(ankleCenter.x, LEG_Y_BOTTOM, ankleCenter.z);

  const skinSubGroup = new THREE.Group();
  const stockingSubGroup = new THREE.Group();
  footGroup.add(skinSubGroup, stockingSubGroup);

  const floorLocalY = FLOOR_Y - LEG_Y_BOTTOM; // -0.125

  // Smooth foot-length envelope:
  //   Skin foot body ends at forefoot (z = +0.185) where 5 individual skin toes emerge.
  //   Unified taut stocking sock extends all the way to the toe tips (z = +0.262)
  //   with subtle 5-toe undulations sculpted smoothly into the front cap!
  const buildFootMeshGeom = (isStocking) => {
    const segLen = 52;
    const segRad = 52;
    const inflate = isStocking ? 0.0030 : 0.0;
    const zStart = -0.088;
    const zEnd = isStocking ? 0.258 : 0.190;

    const positions = [];
    const uvs = [];
    const bulgeAttr = [];
    const rimAOAttr = [];
    const strainAttr = [];
    const liftAttr = [];
    const edgeAttr = [];
    const openAttr = [];
    const ladderAttr = [];
    const bunchAttr = [];

    for (let i = 0; i <= segLen; i++) {
      const t = i / segLen;
      const z = zStart + t * (zEnd - zStart);
      // Normalized anatomical coordinate along full foot length (0 = heel, 1 = big-toe tip)
      const f = (z - zStart) / (0.258 - zStart);

      let halfW;
      let topY;
      let botY;
      let centerX = 0;

      if (f < 0.14) {
        const k = f / 0.14;
        const round = Math.sqrt(Math.max(0.03, 1.0 - (1.0 - k) * (1.0 - k)));
        halfW = 0.062 * round;
        topY = -0.024 + 0.026 * k;
        botY = floorLocalY + 0.020 * (1.0 - round);
      } else if (f < 0.36) {
        // Flush ankle-to-instep curve
        const k = (f - 0.14) / 0.22;
        halfW = 0.068 + 0.006 * k;
        topY = 0.002 * (1.0 - k) + (-0.032) * k;
        botY = floorLocalY + 0.005 * Math.sin(k * Math.PI);
      } else if (f < 0.78) {
        // Instep sloping smoothly down to forefoot ball
        const k = (f - 0.36) / 0.42;
        halfW = 0.074 + 0.015 * Math.sin(k * Math.PI * 0.85);
        topY = -0.032 * (1.0 - k) + (-0.084) * k;
        botY = floorLocalY;
        centerX = side * 0.008 * k;
      } else {
        // Unified toe-box curve (big toe side stays longer, pinky side curves back gracefully!)
        const k = (f - 0.78) / 0.22;
        const toeCurve = Math.sqrt(Math.max(0.0004, 1.0 - k * k));
        halfW = 0.084 * toeCurve;
        topY = -0.084 * (1.0 - k * 0.65) + (floorLocalY + 0.012) * (k * 0.65);
        botY = floorLocalY;
        // Shift toe apex gently toward inner big-toe side (-side)
        centerX = side * (0.008 - 0.026 * k * k);
      }

      // Close bare skin forefoot cleanly at t=1
      let capScale = 1.0;
      if (!isStocking && t > 0.86) {
        capScale = Math.cos(((t - 0.86) / 0.14) * Math.PI * 0.5);
      }
      if (isStocking && t > 0.96) {
        capScale = Math.cos(((t - 0.96) / 0.04) * Math.PI * 0.5);
      }

      halfW *= capScale;
      const midY = (topY + botY) * 0.5;
      const halfH = Math.max(0.0015, (topY - botY) * 0.5 * capScale);

      for (let j = 0; j <= segRad; j++) {
        const u = j / segRad;
        const phi = u * Math.PI * 2;
        const cosP = Math.cos(phi);
        const sinP = Math.sin(phi);

        let yOff = sinP * halfH;
        if (sinP < 0) {
          yOff = -Math.pow(Math.abs(sinP), 0.52) * halfH;
        }

        // Gentle 5-toe undulations sculpted across the upper toe box of the unified stocking!
        let toeWave = 0;
        let toeZOffset = 0;
        if (isStocking && f > 0.66 && sinP > -0.15) {
          // Map lateral coordinate across forefoot: -1 (inner big toe) to +1 (outer pinky)
          const lat = cosP * side; // -1 = big toe, +1 = pinky
          const toeBlend = Math.sin(((f - 0.66) / 0.34) * Math.PI);
          // 5 smooth lobes across [-0.95, +0.95] (wider lobe for big toe)
          const toePhase = (lat + 0.85) * Math.PI * 2.55;
          const lobe = Math.cos(toePhase) * 0.5 + 0.5;
          toeWave = lobe * 0.0038 * toeBlend * Math.max(0, sinP + 0.15);
          // Anatomical diagonal toe-line: big toe extends further forward than pinky toe
          toeZOffset = -lat * 0.016 * Math.max(0, (f - 0.68) / 0.32);
        }

        const xOff = cosP * (halfW + inflate);
        let yFinal = midY + yOff + toeWave + (sinP > 0 ? inflate : -inflate * 0.25);
        yFinal = Math.max(floorLocalY - inflate * 0.1, yFinal);

        positions.push(centerX + xOff, yFinal, z + toeZOffset);
        uvs.push(u, f * 0.14);
        bulgeAttr.push(0);
        rimAOAttr.push(0);
        strainAttr.push(isStocking ? (f > 0.7 ? 0.14 : 0.05) : 0);
        liftAttr.push(0);
        edgeAttr.push(0);
        openAttr.push(0);
        ladderAttr.push(0);
        // Very subtle reinforced-toe density on the front tip
        bunchAttr.push(isStocking && f > 0.78 ? ((f - 0.78) / 0.22) * 0.14 : 0);
      }
    }

    const indices = [];
    for (let i = 0; i < segLen; i++) {
      for (let j = 0; j < segRad; j++) {
        const a = i * (segRad + 1) + j;
        const b = a + 1;
        const d = (i + 1) * (segRad + 1) + j;
        const e = d + 1;
        indices.push(a, b, d, b, e, d);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (!isStocking) {
      geom.setAttribute('aBulge', new THREE.Float32BufferAttribute(bulgeAttr, 1));
      geom.setAttribute('aRimAO', new THREE.Float32BufferAttribute(rimAOAttr, 1));
    } else {
      geom.setAttribute('aStrain', new THREE.Float32BufferAttribute(strainAttr, 1));
      geom.setAttribute('aLift', new THREE.Float32BufferAttribute(liftAttr, 1));
      geom.setAttribute('aTearEdge', new THREE.Float32BufferAttribute(edgeAttr, 1));
      geom.setAttribute('aTearOpen', new THREE.Float32BufferAttribute(openAttr, 1));
      geom.setAttribute('aLadder', new THREE.Float32BufferAttribute(ladderAttr, 1));
      geom.setAttribute('aBunch', new THREE.Float32BufferAttribute(bunchAttr, 1));
    }
    geom.setIndex(indices);
    geom.computeVertexNormals();
    return geom;
  };

  // Bare foot skin body + 5 individual sculpted skin toes underneath the unified sheer sock
  const bodySkin = new THREE.Mesh(buildFootMeshGeom(false), skinMaterial);
  bodySkin.renderOrder = 1;
  skinSubGroup.add(bodySkin);

  const toeSpecs = [
    { x: -0.048, z: 0.172, len: 0.056, rx: 0.0215, ry: 0.0165, yaw: -0.04 }, // Big toe
    { x: -0.014, z: 0.178, len: 0.052, rx: 0.0138, ry: 0.0140, yaw: 0.01 },  // 2nd toe
    { x: 0.014, z: 0.170, len: 0.046, rx: 0.0128, ry: 0.0132, yaw: 0.04 },   // 3rd toe
    { x: 0.038, z: 0.158, len: 0.039, rx: 0.0118, ry: 0.0122, yaw: 0.08 },   // 4th toe
    { x: 0.058, z: 0.144, len: 0.032, rx: 0.0108, ry: 0.0112, yaw: 0.14 },   // Pinky toe
  ];

  for (const spec of toeSpecs) {
    const geom = new THREE.CapsuleGeometry(spec.rx, spec.len, 10, 18);
    geom.rotateX(Math.PI * 0.5);
    geom.scale(1.0, spec.ry / spec.rx, 1.0);
    const n = geom.attributes.position.count;
    geom.setAttribute('aBulge', new THREE.BufferAttribute(new Float32Array(n), 1));
    const ao = new Float32Array(n);
    const pos = geom.attributes.position.array;
    for (let i = 0; i < n; i++) {
      const lx = Math.abs(pos[i * 3]);
      ao[i] = Math.min(0.60, (lx / (spec.rx + 0.001)) * 0.52);
    }
    geom.setAttribute('aRimAO', new THREE.BufferAttribute(ao, 1));

    const toeMesh = new THREE.Mesh(geom, skinMaterial);
    toeMesh.position.set(
      side * spec.x + side * 0.007,
      floorLocalY + spec.ry + 0.001,
      spec.z + spec.len * 0.42
    );
    toeMesh.rotation.y = side * spec.yaw;
    toeMesh.renderOrder = 1;
    skinSubGroup.add(toeMesh);
  }

  // Single unified taut sheer nylon sock enveloping the entire foot & toes cleanly!
  const unifiedSock = new THREE.Mesh(buildFootMeshGeom(true), stockingMaterial);
  unifiedSock.renderOrder = 2;
  stockingSubGroup.add(unifiedSock);

  return {
    group: footGroup,
    skinSubGroup,
    stockingSubGroup,
  };
}

/**
 * Seamless matte studio sweep floor at FLOOR_Y with soft warm/cool bounce
 * and grounded elliptical contact shadows right underneath both soles & toes.
 */
export function createStudioFloor() {
  const geom = new THREE.PlaneGeometry(18, 18);
  geom.rotateX(-Math.PI * 0.5);

  const leftFootC = getLegCenter(-1, LEG_Y_BOTTOM);
  const rightFootC = getLegCenter(1, LEG_Y_BOTTOM);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uLeftFoot: { value: new THREE.Vector2(leftFootC.x, leftFootC.z + 0.09) },
      uRightFoot: { value: new THREE.Vector2(rightFootC.x, rightFootC.z + 0.09) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec2 uLeftFoot;
      uniform vec2 uRightFoot;
      varying vec3 vWorldPos;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }

      void main() {
        vec2 p = vWorldPos.xz;
        float grain = noise(p * 6.5) * 0.55 + noise(p * 18.0) * 0.25 + noise(p * 42.0) * 0.20;

        vec3 baseCol = vec3(0.32, 0.35, 0.40) * (0.90 + 0.18 * grain);
        float warmLeft = exp(-dot(p - vec2(-0.52, 0.32), p - vec2(-0.52, 0.32)) * 1.4);
        float coolRight = exp(-dot(p - vec2(0.55, 0.15), p - vec2(0.55, 0.15)) * 1.1);
        baseCol += vec3(0.28, 0.17, 0.17) * warmLeft * 0.50;
        baseCol += vec3(0.09, 0.16, 0.22) * coolRight * 0.42;

        vec2 dL = (p - uLeftFoot) / vec2(0.105, 0.205);
        vec2 dR = (p - uRightFoot) / vec2(0.105, 0.205);
        float shadowL = exp(-dot(dL, dL) * 2.2);
        float shadowR = exp(-dot(dR, dR) * 2.2);
        float contactShadow = clamp(max(shadowL, shadowR) * 0.78, 0.0, 0.82);
        baseCol *= (1.0 - contactShadow);

        // Soft seamless fade into studio backdrop (eliminates harsh horizon line!)
        float dist = length(p);
        float alpha = smoothstep(3.4, 0.65, dist);

        gl_FragColor = vec4(baseCol, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.y = FLOOR_Y;
  mesh.renderOrder = 0;
  return mesh;
}
