import * as THREE from 'three';

/**
 * Advanced GLSL Sheer Stocking Shader (inspired by Sakura Rabbit's Unity Inspector):
 *  1. Weave & Normal: procedural knit tiling, normal perturbation & contrast
 *  2. Tension & Wrinkles: dynamic radial stretch folds & normal boost
 *  3. Pearl & Glint: pearlescent sheen, edge pearl rim, and twinkling view-dependent micro-glints
 *  4. Frost & Sheerness: matte frost coverage that clears into sheer nylon under stretch
 *  5. Vertical Runs / Ladders (aLadder): horizontal weft rungs + vertical sheer streaks connecting tears
 *  6. Roll-Down Cuff Bunching (aBunch): stacked accordion fold opacity & shading
 */
export function createStockingMaterial() {
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
      uWeaveContrast: { value: 0.05 },

      // Group 2: Tension & Wrinkles
      uWrinkleStrength: { value: 1.2 },
      uTensionNormalBoost: { value: 1.5 },

      // Group 3: Pearl & Glint
      uPearlStrength: { value: 0.42 },
      uPearlGrainScale: { value: 540.0 },
      uPearlSpecularStrength: { value: 0.64 },
      uPearlEdgeStrength: { value: 0.16 },
      uPearlGlintStrength: { value: 0.85 },
      uPearlGlintDensity: { value: 0.12 },

      // Group 4: Frost & Sheerness
      uFrostCoverage: { value: 0.78 },
      uFrostClearAtStretch: { value: 1.0 },
      uFrostMatteSmoothness: { value: 0.82 },

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

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      vec2 hash22(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.xx + p3.yz) * p3.zy);
      }

      float noise2D(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      void main() {
        // 0. Smooth organic tear cutout (curved oval openings with micro-fray border)
        float tearRimMask = 0.0;
        float tearFeather = 1.0;

        if (vTearOpen > 0.001) {
          float n1 = noise2D(vec2(vUv.x * 38.0, vUv.y * 22.0));
          float n2 = noise2D(vec2(vUv.x * 96.0, vUv.y * 140.0));
          float organic = (n1 - 0.5) * 0.22 + (n2 - 0.5) * 0.08;
          float cutVal = vTearOpen + organic;

          if (cutVal > 0.46) {
            discard;
          }
          tearRimMask = smoothstep(0.28, 0.44, cutVal);
          tearFeather = 1.0 - smoothstep(0.42, 0.46, cutVal);
        }

        vec3 N = normalize(vNormalW);
        if (!gl_FrontFacing) {
          N = -N;
        }
        vec3 V = normalize(cameraPosition - vWorldPos);

        // Build simple tangent basis around leg cylinder for weave & wrinkle normal perturbation
        vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N) + vec3(0.0001, 0.0, 0.0));
        vec3 B = normalize(cross(N, T));

        // 1. Weave & Micro-Normal (Group 1)
        float tileU = uWeaveTiling * 34.0;
        float tileV = uWeaveTiling * 46.0;
        float phaseU = vUv.x * tileU;
        float phaseV = vUv.y * tileV;
        float weaveH = sin(phaseU) * 0.5 + 0.5;
        float weaveV = sin(phaseV) * 0.5 + 0.5;
        float microKnit = mix(weaveH, weaveV, 0.52);

        float dWeaveU = cos(phaseU) * 0.06 * uWeaveNormalStrength;
        float dWeaveV = cos(phaseV) * 0.06 * uWeaveNormalStrength;

        // 2. Tension & Wrinkles (Group 2)
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

        float strainAmount = clamp(vStrain, 0.0, 1.5);
        float strainLines = sin(vUv.y * 230.0 + vUv.x * 28.0) * 0.5 + 0.5;
        wrinkle = clamp((wrinkle + strainLines * smoothstep(0.15, 0.75, strainAmount) * 0.42) * uWrinkleStrength, 0.0, 1.25);

        // Bunched / rolled-down cuff accordion folds
        float bunchFold = 0.0;
        if (vBunch > 0.01) {
          float bWave = sin(vUv.y * 145.0 + sin(vUv.x * 22.0) * 1.4);
          bunchFold = (bWave * 0.5 + 0.5) * vBunch;
          dWrinkle += cos(vUv.y * 145.0) * vBunch * 0.28;
        }

        // Apply perturbed normal
        vec3 Np = normalize(N + T * (dWeaveU + dWrinkle * 0.6) + B * (dWeaveV + dWrinkle));
        float ndv = abs(dot(Np, V));
        float fresnel = pow(1.0 - ndv, 1.85);
        float grazing = pow(1.0 - ndv, 3.3);

        // 3. Pearl & Glint Sparkles (Group 3 — fine pearlescent nylon micro-sparkles!)
        vec2 grainCell = floor(vUv * vec2(uPearlGrainScale * 0.75, uPearlGrainScale));
        vec2 grainRnd = hash22(grainCell);
        // Micro-facet normal jitter for each sparkle grain
        vec3 microN = normalize(Np + T * (grainRnd.x - 0.5) * 0.55 + B * (grainRnd.y - 0.5) * 0.55);
        vec3 Hkey = normalize(uKeyLightDir + V);
        vec3 Hrim = normalize(uRimLightDir + V);
        float glintSpec = max(
          pow(max(dot(microN, Hkey), 0.0), 48.0),
          pow(max(dot(microN, Hrim), 0.0), 36.0) * 0.85
        );
        // Density gate so only a crisp sparse constellation of glints twinkle
        float glintGate = step(1.0 - uPearlGlintDensity, grainRnd.x * 0.6 + grainRnd.y * 0.4);
        float pearlGlint = glintGate * glintSpec * uPearlGlintStrength * (0.45 + 0.55 * fresnel);

        // Soft silky pearl body sheen + edge pearl rim
        float pearlSpec = pow(max(dot(Np, Hkey), 0.0), mix(14.0, 42.0, uFrostMatteSmoothness)) * uPearlSpecularStrength;
        float pearlEdge = pow(1.0 - ndv, 2.2) * uPearlEdgeStrength;

        // 4. Vertical Stocking Ladder / Run (勾丝竖条抽丝效果)
        float ladderMask = clamp(vLadder, 0.0, 1.0);
        // Fine horizontal weft rungs across the dropped vertical stitch
        float ladderRungs = sin(vUv.y * 620.0) * 0.5 + 0.5;
        // Subtle brighter vertical border lines along edges of the run
        float ladderBorder = smoothstep(0.06, 0.28, ladderMask) * (1.0 - smoothstep(0.45, 0.85, ladderMask));

        // 5. Linear-space fabric color (Black vs White)
        vec3 blackBase = vec3(0.012, 0.014, 0.018);
        vec3 blackSheen = vec3(0.14, 0.15, 0.18);

        vec3 whiteBase = vec3(0.46, 0.48, 0.52);
        vec3 whiteSheen = vec3(0.86, 0.88, 0.92);

        vec3 fabricBase = mix(blackBase, whiteBase, uColorMode);
        vec3 fabricSheen = mix(blackSheen, whiteSheen, uColorMode);

        float ndl = dot(Np, uKeyLightDir) * 0.5 + 0.5;
        vec3 litColor = fabricBase * (0.28 + 0.80 * ndl);

        // Weave contrast modulation
        litColor += fabricSheen * (microKnit - 0.5) * uWeaveContrast * 2.2;

        // Pearl sheen, specular & twinkling star-glints
        vec3 pearlTint = mix(vec3(0.56, 0.60, 0.68), vec3(1.0, 0.99, 0.98), uColorMode);
        litColor += pearlTint * (pearlSpec * 0.24 * uPearlStrength + pearlEdge * uPearlStrength);
        litColor += mix(vec3(0.82, 0.88, 0.96), vec3(1.0), uColorMode) * pearlGlint * 0.55;

        // Tension wrinkle highlights
        vec3 wrinkleColor = mix(vec3(0.46, 0.50, 0.56), vec3(1.0, 1.0, 1.0), uColorMode);
        litColor = mix(litColor, wrinkleColor, clamp(wrinkle * 0.34, 0.0, 0.65));

        // Bunched cuff fold shading (darker troughs, highlighted crests)
        if (vBunch > 0.01) {
          litColor *= mix(0.68, 1.18, bunchFold);
        }

        // Ladder / run subtle pale weft threads
        litColor = mix(litColor, mix(vec3(0.28, 0.30, 0.34), vec3(0.92, 0.93, 0.96), uColorMode), ladderBorder * 0.35 + ladderMask * ladderRungs * 0.14);

        // Rolled torn edge hem effect
        float edgeMask = max(tearRimMask, smoothstep(0.25, 0.9, vTearEdge) * 0.35);
        vec3 rimEdgeColor = mix(vec3(0.005, 0.007, 0.010), vec3(0.92, 0.94, 0.97), uColorMode);
        litColor = mix(litColor, rimEdgeColor, edgeMask * 0.58);

        // Studio cyan rim light on outer right silhouette
        float rimDir = smoothstep(0.18, 0.88, dot(Np, uRimLightDir));
        litColor += uRimColor * grazing * (0.04 + 0.50 * rimDir);

        // Skirt top shadow
        float skirtShadow = smoothstep(0.66, 0.34, vWorldPos.y);
        litColor *= mix(0.45, 1.0, skirtShadow);

        // 6. Frost & Sheerness Opacity (Group 4)
        //    Frost coverage sets matte opacity; stretching clears the frost into sheer nylon!
        float stretchClear = smoothstep(0.06, 0.95, strainAmount) * 0.34 * uFrostClearAtStretch;
        float baseAlpha = mix(0.14, 0.62, uFrostCoverage) + uColorMode * 0.06;
        float alpha = baseAlpha + fresnel * (0.66 - uFrostCoverage * 0.14) - stretchClear;

        // Ladder runs thin out the stocking vertically while showing delicate horizontal rungs
        alpha -= ladderMask * (0.36 - ladderRungs * 0.12);

        // Wrinkles, rolled tear edges, and bunched roll-down cuffs increase fabric density
        alpha += wrinkle * 0.16;
        alpha += edgeMask * 0.28;
        alpha += vBunch * 0.42;

        if (!gl_FrontFacing) {
          alpha *= 0.82;
        }

        alpha = clamp(alpha, 0.08, 0.97) * tearFeather;

        gl_FragColor = vec4(litColor, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
