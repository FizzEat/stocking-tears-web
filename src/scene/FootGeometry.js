import * as THREE from 'three';
import { LEG_Y_BOTTOM, FLOOR_Y, getLegCenter } from './LegAnatomy.js';

/**
 * Procedurally sculpts an anatomical 3D foot + 5 individual toes seamlessly
 * joined to the ankle at y = LEG_Y_BOTTOM (-1.56) and resting flat on FLOOR_Y (-1.685).
 * Single clean sheer stocking layer over the sculpted skin toes so all 5 toes show
 * softly through the nylon without dark double-layer overlap.
 */
export function createSculptedFoot(side, skinMaterial, stockingMaterial) {
  const ankleCenter = getLegCenter(side, LEG_Y_BOTTOM);

  const footGroup = new THREE.Group();
  footGroup.position.set(ankleCenter.x, LEG_Y_BOTTOM, ankleCenter.z);

  const skinSubGroup = new THREE.Group();
  const stockingSubGroup = new THREE.Group();
  footGroup.add(skinSubGroup, stockingSubGroup);

  const floorLocalY = FLOOR_Y - LEG_Y_BOTTOM; // -0.125

  const buildFootBodyGeom = (inflate = 0.0) => {
    const segLen = 40;
    const segRad = 44;
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
      const t = i / segLen; // 0 = back heel (-0.088), 1 = forefoot toe-base (+0.196)
      const z = -0.088 + t * 0.284;

      let halfW;
      let topY;
      let botY;
      let centerX = 0;

      if (t < 0.16) {
        const k = t / 0.16;
        const round = Math.sqrt(Math.max(0.03, 1.0 - (1.0 - k) * (1.0 - k)));
        halfW = 0.062 * round;
        topY = -0.025 + 0.055 * k;
        botY = floorLocalY + 0.022 * (1.0 - round);
      } else if (t < 0.44) {
        // Seamless flush ankle-to-instep curve (no dark double-layer overlap!)
        const k = (t - 0.16) / 0.28;
        halfW = 0.068 + 0.006 * k;
        topY = 0.002 * (1.0 - k) + (-0.032) * k;
        botY = floorLocalY + 0.005 * Math.sin(k * Math.PI);
      } else {
        // Graceful instep slope down to forefoot & toe roots
        const k = (t - 0.44) / 0.56;
        halfW = 0.074 + 0.012 * Math.sin(k * Math.PI * 0.78);
        topY = -0.028 * (1.0 - k) + (-0.072) * k;
        botY = floorLocalY;
        centerX = side * 0.007 * k;
      }

      const frontCap = t > 0.86 ? Math.cos(((t - 0.86) / 0.14) * Math.PI * 0.5) : 1.0;
      halfW *= frontCap;

      const midY = (topY + botY) * 0.5;
      const halfH = Math.max(0.002, (topY - botY) * 0.5 * frontCap);

      for (let j = 0; j <= segRad; j++) {
        const u = j / segRad;
        const phi = u * Math.PI * 2;
        const cosP = Math.cos(phi);
        const sinP = Math.sin(phi);

        let yOff = sinP * halfH;
        if (sinP < 0) {
          yOff = -Math.pow(Math.abs(sinP), 0.55) * halfH;
        }
        const xOff = cosP * (halfW + inflate);
        let yFinal = midY + yOff + (sinP > 0 ? inflate : -inflate * 0.3);
        yFinal = Math.max(floorLocalY - inflate * 0.15, yFinal);

        positions.push(centerX + xOff, yFinal, z);
        uvs.push(u, t * 0.12);
        bulgeAttr.push(0);
        rimAOAttr.push(0);
        strainAttr.push(inflate > 0 ? 0.06 : 0);
        liftAttr.push(0);
        edgeAttr.push(0);
        openAttr.push(0);
        ladderAttr.push(0);
        bunchAttr.push(0);
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
    if (inflate === 0) {
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

  const bodySkin = new THREE.Mesh(buildFootBodyGeom(0.0), skinMaterial);
  bodySkin.renderOrder = 1;
  skinSubGroup.add(bodySkin);

  const bodyStocking = new THREE.Mesh(buildFootBodyGeom(0.0028), stockingMaterial);
  bodyStocking.renderOrder = 2;
  stockingSubGroup.add(bodyStocking);

  // Five Individually Sculpted Toes (Hallux -> Pinky)
  // Clean single stocking layer over each toe so the fair skin & toe contours read softly!
  const toeSpecs = [
    { x: -0.050, z: 0.170, len: 0.064, rx: 0.0225, ry: 0.0175, yaw: -0.04 }, // Big toe
    { x: -0.015, z: 0.178, len: 0.060, rx: 0.0145, ry: 0.0145, yaw: 0.01 },  // 2nd toe
    { x: 0.014, z: 0.172, len: 0.053, rx: 0.0135, ry: 0.0138, yaw: 0.04 },   // 3rd toe
    { x: 0.039, z: 0.160, len: 0.045, rx: 0.0125, ry: 0.0128, yaw: 0.08 },   // 4th toe
    { x: 0.060, z: 0.145, len: 0.036, rx: 0.0115, ry: 0.0118, yaw: 0.14 },   // Pinky toe
  ];

  const makeToeMesh = (spec, mat, isStocking) => {
    const inflate = isStocking ? 0.0025 : 0.0;
    const geom = new THREE.CapsuleGeometry(spec.rx + inflate, spec.len, 10, 18);
    geom.rotateX(Math.PI * 0.5);
    geom.scale(1.0, (spec.ry + inflate) / (spec.rx + inflate), 1.0);

    const n = geom.attributes.position.count;
    if (!isStocking) {
      geom.setAttribute('aBulge', new THREE.BufferAttribute(new Float32Array(n), 1));
      const ao = new Float32Array(n);
      const pos = geom.attributes.position.array;
      for (let i = 0; i < n; i++) {
        const lx = Math.abs(pos[i * 3]);
        ao[i] = Math.min(0.45, (lx / (spec.rx + 0.001)) * 0.38);
      }
      geom.setAttribute('aRimAO', new THREE.BufferAttribute(ao, 1));
    } else {
      geom.setAttribute('aStrain', new THREE.BufferAttribute(new Float32Array(n).fill(0.18), 1));
      geom.setAttribute('aLift', new THREE.BufferAttribute(new Float32Array(n), 1));
      geom.setAttribute('aTearEdge', new THREE.BufferAttribute(new Float32Array(n), 1));
      geom.setAttribute('aTearOpen', new THREE.BufferAttribute(new Float32Array(n), 1));
      geom.setAttribute('aLadder', new THREE.BufferAttribute(new Float32Array(n), 1));
      geom.setAttribute('aBunch', new THREE.BufferAttribute(new Float32Array(n), 1));
    }

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(
      side * spec.x + side * 0.007,
      floorLocalY + spec.ry + 0.002,
      spec.z + spec.len * 0.42
    );
    mesh.rotation.y = side * spec.yaw;
    mesh.renderOrder = isStocking ? 2 : 1;
    return mesh;
  };

  for (const spec of toeSpecs) {
    skinSubGroup.add(makeToeMesh(spec, skinMaterial, false));
    stockingSubGroup.add(makeToeMesh(spec, stockingMaterial, true));
  }

  return {
    group: footGroup,
    skinSubGroup,
    stockingSubGroup,
  };
}

/**
 * Matte studio sweep floor at FLOOR_Y with soft warm/cool studio bounce
 * and grounded elliptical contact shadows right underneath both soles & toes.
 */
export function createStudioFloor() {
  const geom = new THREE.PlaneGeometry(14, 14);
  geom.rotateX(-Math.PI * 0.5);

  const leftFootC = getLegCenter(-1, LEG_Y_BOTTOM);
  const rightFootC = getLegCenter(1, LEG_Y_BOTTOM);

  const mat = new THREE.ShaderMaterial({
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

        vec3 baseCol = vec3(0.28, 0.31, 0.35) * (0.90 + 0.18 * grain);
        float warmLeft = exp(-dot(p - vec2(-0.55, 0.35), p - vec2(-0.55, 0.35)) * 1.4);
        float coolRight = exp(-dot(p - vec2(0.55, 0.15), p - vec2(0.55, 0.15)) * 1.1);
        baseCol += vec3(0.24, 0.15, 0.15) * warmLeft * 0.45;
        baseCol += vec3(0.08, 0.14, 0.19) * coolRight * 0.40;

        vec2 dL = (p - uLeftFoot) / vec2(0.105, 0.205);
        vec2 dR = (p - uRightFoot) / vec2(0.105, 0.205);
        float shadowL = exp(-dot(dL, dL) * 2.1);
        float shadowR = exp(-dot(dR, dR) * 2.1);
        float contactShadow = clamp(max(shadowL, shadowR) * 0.72, 0.0, 0.78);
        baseCol *= (1.0 - contactShadow);

        float dist = length(p);
        float vig = smoothstep(3.8, 0.4, dist);
        vec3 bgCol = vec3(0.032, 0.052, 0.068);
        vec3 finalCol = mix(bgCol, baseCol, vig);

        gl_FragColor = vec4(finalCol, 1.0);
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
