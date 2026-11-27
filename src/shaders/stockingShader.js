import * as THREE from 'three';

export const MAX_SDF_TEARS = 20;

/**
 * Photorealistic GLSL Sheer Stocking Shader (inspired by Sakura Rabbit's Unity 6 Inspector):
 *  - Per-Pixel Analytical Almond SDF Tears + Vertical Needle-Tapered Sheer Ladder Strips
 *    (infinite resolution crisp oval openings, rolled elastic rim, zero jagged mesh steps!)
 *  - Weave & Micro-Normal, Tension & Wrinkles, Pearl & Micro-Glints, Frost & Sheerness
 *  - Horizontal ankle compression creases near the ankle bend (v < 0.075)
 */
export function createStockingMaterial() {
  const tearDataArr = [];
  const tearLadderArr = [];
  for (let i = 0; i < MAX_SDF_TEARS; i++) {
    tearDataArr.push(new THREE.Vector4(-10, -10, 0.01, 0.01));
    tearLadderArr.push(new THREE.Vector4(0, 0, 0, 0));
  }

  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uKeyLightDir: { value: new THREE.Vector3(-0.48, 0.52, 0.78).normalize() },
      uRimLightDir: { value: new THREE.Vector3(0.82, 0.25, -0.52).normalize() },
      uRimColor: { value: new THREE.Color('#7be0f5') },
      uColorMode: { value: 0.0 }, // 0.0 = Black, 1.0 = White

      // Group 1: Weave & Normal
      uWeaveTiling: { value: 12.0 },
      uWeaveNormalStrength: { value: 0.85 },
      uWeaveContrast: { value: 0.035 },

      // Group 2: Tension & Wrinkles
      uWrinkleStrength: { value: 1.2 },
      uTensionNormalBoost: { value: 1.5 },

      // Group 3: Pearl & Glint
      uPearlStrength: { value: 0.42 },
      uPearlGrainScale: { value: 570.0 },
      uPearlSpecularStrength: { value: 0.64 },
      uPearlEdgeStrength: { value: 0.14 },
      uPearlGlintStrength: { value: 0.85 },
      uPearlGlintDensity: { value: 0.115 },

      // Group 4: Frost & Sheerness
      uFrostCoverage: { value: 0.83 },
      uFrostClearAtStretch: { value: 1.0 },
      uFrostMatteSmoothness: { value: 0.84 },

      // Analytical Per-Pixel SDF Tears & Vertical Ladders
      uTearCount: { value: 0 },
      uTearData: { value: tearDataArr }, // vec4(u, v, rx, ry)
      uTearLadder: { value: tearLadderArr }, // vec4(ladderUp, ladderDown, lift, active)

      // Interactive pinch world pos
      uPinchWorldPos: { value: new THREE.Vector3(0, -100, 0) },
      uPinchActive: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      attribute float aStrain;
      attribute float aLift;
      attribute float aTearEdge;
      attribute float aTearOpen;
      attribute float aLadder;
      attribute float aBunch;

      varying vec3 vNormalW;
      varying vec3 vWorldPos;
      varying vec2 vUv;
      varying float vStrain;
      varying float vLift;
      varying float vTearEdge;
      varying float vTearOpen;
      varying float vLadder;
      varying float vBunch;

      void main() {
        vUv = uv;
        vStrain = aStrain;
        vLift = aLift;
        vTearEdge = aTearEdge;
        vTearOpen = aTearOpen;
        vLadder = aLadder;
        vBunch = aBunch;

        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);

        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      #define MAX_TEARS 20

      uniform vec3 uKeyLightDir;
      uniform vec3 uRimLightDir;
      uniform vec3 uRimColor;
      uniform float uColorMode;

      uniform float uWeaveTiling;
      uniform float uWeaveNormalStrength;
      uniform float uWeaveContrast;

      uniform float uWrinkleStrength;
      uniform float uTensionNormalBoost;

      uniform float uPearlStrength;
      uniform float uPearlGrainScale;
      uniform float uPearlSpecularStrength;
      uniform float uPearlEdgeStrength;
      uniform float uPearlGlintStrength;
      uniform float uPearlGlintDensity;

      uniform float uFrostCoverage;
      uniform float uFrostClearAtStretch;
      uniform float uFrostMatteSmoothness;

      uniform int uTearCount;
      uniform vec4 uTearData[MAX_TEARS];
      uniform vec4 uTearLadder[MAX_TEARS];

      uniform vec3 uPinchWorldPos;
      uniform float uPinchActive;

      varying vec3 vNormalW;
      varying vec3 vWorldPos;
      varying vec2 vUv;
      varying float vStrain;
      varying float vLift;
      varying float vTearEdge;
      varying float vTearOpen;
      varying float vLadder;
      varying float vBunch;

      vec2 hash22(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.xx + p3.yz) * p3.zy);
      }

      void main() {
        // 0. Per-Pixel Analytical Almond SDF Tears & Vertical Sheer Ladder Strips
        float tearRimMask = 0.0;
        float tearFeather = 1.0;
        float sdfLadderMask = 0.0;
        float sdfLadderEdge = 0.0;

        for (int i = 0; i < MAX_TEARS; i++) {
          if (i >= uTearCount) break;
          vec4 td = uTearData[i];
          vec4 tl = uTearLadder[i];
          if (tl.w < 0.5) continue;

          // Wrap horizontal UV delta cleanly across cylinder seam
          float du = vUv.x - td.x;
          if (du > 0.5) du -= 1.0;
          if (du < -0.5) du += 1.0;
          float dv = vUv.y - td.y;

          float rx = max(td.z, 0.004);
          float ry = max(td.w, 0.006);

          // Subtle almond pinch at top/bottom tips of the oval tear
          float ny = dv / ry;
          float almondWidth = rx * mix(1.0, 0.72, clamp(ny * ny, 0.0, 1.0));
          float nx = du / max(almondWidth, 0.002);
          float dist = length(vec2(nx, ny));

          if (dist < 0.985) {
            discard;
          }

          // Crisp sub-pixel anti-aliased edge + rolled elastic hem right along 0.985..1.16
          tearFeather = min(tearFeather, smoothstep(0.985, 1.025, dist));
          float rim = 1.0 - smoothstep(1.01, 1.18, dist);
          tearRimMask = max(tearRimMask, rim);

          // Vertical needle-tapered sheer ladder strip above (tl.x) & below (tl.y) the almond
          float ladderUp = tl.x;
          float ladderDown = tl.y;
          if ((dv > 0.0 && dv < ladderUp) || (dv < 0.0 && -dv < ladderDown)) {
            float runLen = dv > 0.0 ? ladderUp : ladderDown;
            float tRun = clamp(abs(dv) / max(runLen, 0.001), 0.0, 1.0);
            // Smoothly taper width from ~82% of almond width down to a sharp needle tip
            float halfW = rx * 0.84 * pow(1.0 - tRun, 0.72);
            float adx = abs(du);
            if (adx < halfW * 1.25) {
              float inStrip = 1.0 - smoothstep(halfW * 0.72, halfW, adx);
              float fadeTip = 1.0 - smoothstep(0.65, 1.0, tRun);
              sdfLadderMask = max(sdfLadderMask, inStrip * fadeTip * 0.92);
              // Crisp parallel vertical border streaks flanking the ladder
              float border = smoothstep(halfW * 0.65, halfW * 0.92, adx) * (1.0 - smoothstep(halfW * 0.95, halfW * 1.22, adx));
              sdfLadderEdge = max(sdfLadderEdge, border * fadeTip);
            }
          }
        }

        vec3 N = normalize(vNormalW);
        if (!gl_FrontFacing) {
          N = -N;
        }
        vec3 V = normalize(cameraPosition - vWorldPos);

        vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N) + vec3(0.0001, 0.0, 0.0));
        vec3 B = normalize(cross(N, T));

        // 1. Weave & Micro-Normal (Group 1)
        float tileU = uWeaveTiling * 36.0;
        float tileV = uWeaveTiling * 50.0;
        float phaseU = vUv.x * tileU;
        float phaseV = vUv.y * tileV;
        float weaveH = sin(phaseU) * 0.5 + 0.5;
        float weaveV = sin(phaseV) * 0.5 + 0.5;
        float microKnit = mix(weaveH, weaveV, 0.52);

        float dWeaveU = cos(phaseU) * 0.055 * uWeaveNormalStrength;
        float dWeaveV = cos(phaseV) * 0.055 * uWeaveNormalStrength;

        // 2. Tension & Wrinkles + Front Ankle Horizontal Creases (Group 2)
        float wrinkle = 0.0;
        float dWrinkle = 0.0;
        if (uPinchActive > 0.01) {
          vec3 toPinch = uPinchWorldPos - vWorldPos;
          float distP = length(toPinch);
          float pinchInf = smoothstep(0.44, 0.02, distP) * uPinchActive;
          vec3 dirP = toPinch / max(distP, 0.0001);
          float wArg = atan(dirP.y, dirP.x + dirP.z * 0.6) * 26.0 + distP * 30.0;
          float angleWave = sin(wArg) * 0.5 + 0.5;
          float foldWave = sin(vUv.y * 190.0 + distP * 44.0) * 0.5 + 0.5;
          wrinkle = (angleWave * 0.65 + foldWave * 0.35) * pinchInf * smoothstep(0.0, 0.07, vLift + vStrain * 0.12);
          dWrinkle = cos(wArg) * pinchInf * 0.16 * uTensionNormalBoost;
        }

        // Realistic horizontal compression wrinkles right at the front bend of the ankle!
        float ankleZone = exp(-pow((vWorldPos.y + 1.505) / 0.048, 2.0)) * smoothstep(0.15, 0.85, N.z);
        float ankleCrease = sin(vWorldPos.y * 420.0 + sin(vWorldPos.x * 38.0) * 1.2) * 0.5 + 0.5;
        wrinkle += ankleZone * ankleCrease * 0.32;
        dWrinkle += ankleZone * cos(vWorldPos.y * 420.0) * 0.14;

        float strainAmount = clamp(vStrain, 0.0, 1.5);
        float strainLines = sin(vUv.y * 230.0 + vUv.x * 28.0) * 0.5 + 0.5;
        wrinkle = clamp((wrinkle + strainLines * smoothstep(0.15, 0.75, strainAmount) * 0.40) * uWrinkleStrength, 0.0, 1.25);

        float bunchFold = 0.0;
        if (vBunch > 0.01) {
          float bWave = sin(vUv.y * 135.0 + sin(vUv.x * 18.0) * 1.1);
          bunchFold = (bWave * 0.5 + 0.5) * vBunch;
          dWrinkle += cos(vUv.y * 135.0) * vBunch * 0.24;
        }

        vec3 Np = normalize(N + T * (dWeaveU + dWrinkle * 0.55) + B * (dWeaveV + dWrinkle));
        float ndv = abs(dot(Np, V));
        float fresnel = pow(1.0 - ndv, 1.85);
        float grazing = pow(1.0 - ndv, 3.3);

        // 3. Isotropic Pinpoint Pearl & Glint Sparkles (Group 3 — crisp circular star-points!)
        vec2 glintUv = vec2(vUv.x * uPearlGrainScale * 0.42, vUv.y * uPearlGrainScale * 1.38);
        vec2 grainCell = floor(glintUv);
        vec2 grainFrac = fract(glintUv);
        vec2 grainRnd = hash22(grainCell);
        // Pinpoint circular dot inside cell so sparkles are never stretched dashes
        vec2 dotCenter = 0.25 + 0.50 * grainRnd;
        float dotShape = smoothstep(0.24, 0.04, length(grainFrac - dotCenter));

        vec3 microN = normalize(Np + T * (grainRnd.x - 0.5) * 0.52 + B * (grainRnd.y - 0.5) * 0.52);
        vec3 Hkey = normalize(uKeyLightDir + V);
        vec3 Hrim = normalize(uRimLightDir + V);
        float glintSpec = max(
          pow(max(dot(microN, Hkey), 0.0), 46.0),
          pow(max(dot(microN, Hrim), 0.0), 34.0) * 0.85
        );
        float glintGate = step(1.0 - uPearlGlintDensity, grainRnd.x * 0.58 + grainRnd.y * 0.42);
        float pearlGlint = dotShape * glintGate * glintSpec * uPearlGlintStrength * (0.45 + 0.55 * fresnel);

        float pearlSpec = pow(max(dot(Np, Hkey), 0.0), mix(14.0, 42.0, uFrostMatteSmoothness)) * uPearlSpecularStrength;
        float pearlEdge = pow(1.0 - ndv, 2.2) * uPearlEdgeStrength;

        // 4. Combine SDF Ladder + Fine Horizontal Weft Rungs
        float ladderMask = clamp(max(sdfLadderMask, vLadder * 0.4), 0.0, 1.0);
        float ladderRungs = sin(vUv.y * 740.0) * 0.5 + 0.5;

        // 5. Linear-space fabric color
        vec3 blackBase = vec3(0.012, 0.014, 0.018);
        vec3 blackSheen = vec3(0.14, 0.15, 0.18);

        vec3 whiteBase = vec3(0.46, 0.48, 0.52);
        vec3 whiteSheen = vec3(0.86, 0.88, 0.92);

        vec3 fabricBase = mix(blackBase, whiteBase, uColorMode);
        vec3 fabricSheen = mix(blackSheen, whiteSheen, uColorMode);

        float ndl = dot(Np, uKeyLightDir) * 0.5 + 0.5;
        vec3 litColor = fabricBase * (0.28 + 0.80 * ndl);

        litColor += fabricSheen * (microKnit - 0.5) * uWeaveContrast * 2.0;

        vec3 pearlTint = mix(vec3(0.56, 0.60, 0.68), vec3(1.0, 0.99, 0.98), uColorMode);
        litColor += pearlTint * (pearlSpec * 0.24 * uPearlStrength + pearlEdge * uPearlStrength);
        litColor += mix(vec3(0.85, 0.90, 0.98), vec3(1.0), uColorMode) * pearlGlint * 0.52;

        vec3 wrinkleColor = mix(vec3(0.42, 0.46, 0.52), vec3(1.0, 1.0, 1.0), uColorMode);
        litColor = mix(litColor, wrinkleColor, clamp(wrinkle * 0.30, 0.0, 0.58));

        if (vBunch > 0.01) {
          litColor *= mix(0.74, 1.14, bunchFold);
        }

        // Subtle pale border & horizontal rungs on vertical ladder strips
        vec3 ladderTint = mix(vec3(0.32, 0.34, 0.38), vec3(0.94, 0.95, 0.98), uColorMode);
        litColor = mix(litColor, ladderTint, sdfLadderEdge * 0.48 + ladderMask * ladderRungs * 0.12);

        // Crisp rolled elastic hem right around the almond tear opening
        vec3 rimEdgeColor = mix(vec3(0.004, 0.005, 0.008), vec3(0.95, 0.96, 0.99), uColorMode);
        litColor = mix(litColor, rimEdgeColor, tearRimMask * 0.72);

        // Studio cyan rim light on outer right silhouette
        float rimDir = smoothstep(0.18, 0.88, dot(Np, uRimLightDir));
        litColor += uRimColor * grazing * (0.04 + 0.48 * rimDir);

        // Skirt top shadow
        float skirtShadow = smoothstep(0.66, 0.34, vWorldPos.y);
        litColor *= mix(0.45, 1.0, skirtShadow);

        // 6. Frost & Sheerness Opacity
        float stretchClear = smoothstep(0.06, 0.95, strainAmount) * 0.34 * uFrostClearAtStretch;
        float baseAlpha = mix(0.14, 0.62, uFrostCoverage) + uColorMode * 0.06;
        float alpha = baseAlpha + fresnel * (0.66 - uFrostCoverage * 0.14) - stretchClear;

        // Vertical ladder thins the fabric cleanly so skin shows softly through the sheer vertical run!
        alpha -= ladderMask * (0.44 - ladderRungs * 0.10);
        alpha += sdfLadderEdge * 0.14;

        alpha += wrinkle * 0.14;
        alpha += tearRimMask * 0.36;
        alpha += vBunch * 0.38;

        if (!gl_FrontFacing) {
          alpha *= 0.82;
        }

        alpha = clamp(alpha, 0.06, 0.97) * tearFeather;

        gl_FragColor = vec4(litColor, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
