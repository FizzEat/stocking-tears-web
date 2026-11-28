import * as THREE from 'three';

/**
 * Warm Sunlit Porcelain-Peach Skin Shader (calibrated to natural indoor daylight photography):
 *  - Luminous fair creamy-peach skin albedo with soft rosy-warm subsurface scattering (SSS)
 *  - Smooth silky specular along shin, kneecap, and front thigh
 *  - Warm champagne indoor rim light (no synthetic neon cyan!)
 *  - Subtle raised-skin bulge & delicate warm rim shadow inside stocking tear openings
 */
export function createSkinMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uKeyLightDir: { value: new THREE.Vector3(-0.42, 0.56, 0.72).normalize() },
      uRimLightDir: { value: new THREE.Vector3(0.78, 0.34, -0.52).normalize() },
      uFillLightDir: { value: new THREE.Vector3(0.32, -0.25, 0.91).normalize() },
      uSkinBase: { value: new THREE.Color('#fae4d8') },
      uSkinShadow: { value: new THREE.Color('#d7a999') },
      uSkinSSS: { value: new THREE.Color('#f4a696') },
      uRimColor: { value: new THREE.Color('#ffeedd') },
      uKneeWarmth: { value: new THREE.Color('#f2b9aa') },
    },
    vertexShader: /* glsl */ `
      attribute float aBulge;
      attribute float aRimAO;

      varying vec3 vNormalW;
      varying vec3 vWorldPos;
      varying vec2 vUv;
      varying float vBulge;
      varying float vRimAO;

      void main() {
        vUv = uv;
        vBulge = aBulge;
        vRimAO = aRimAO;

        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);

        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uKeyLightDir;
      uniform vec3 uRimLightDir;
      uniform vec3 uFillLightDir;
      uniform vec3 uSkinBase;
      uniform vec3 uSkinShadow;
      uniform vec3 uSkinSSS;
      uniform vec3 uRimColor;
      uniform vec3 uKneeWarmth;

      varying vec3 vNormalW;
      varying vec3 vWorldPos;
      varying vec2 vUv;
      varying float vBulge;
      varying float vRimAO;

      void main() {
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(cameraPosition - vWorldPos);

        // Delicate rosy-peach blush on kneecap, ankle & toes (natural blood-flow warmth)
        float kneeMask = exp(-pow((vWorldPos.y + 0.42) / 0.18, 2.0)) * smoothstep(-0.1, 0.85, N.z);
        float toeBlush = smoothstep(-1.54, -1.66, vWorldPos.y) * 0.22;
        vec3 albedo = mix(uSkinBase, uKneeWarmth, clamp(kneeMask * 0.20 + toeBlush, 0.0, 0.28));

        // Subtle warm flush on raised skin inside tight tear opening
        albedo = mix(albedo, uKneeWarmth, clamp(vBulge * 0.14, 0.0, 0.16));

        // Ultra-soft wrap diffuse lighting (mimics bounced indoor room daylight)
        float ndl = dot(N, uKeyLightDir);
        float wrap = clamp((ndl + 0.72) / 1.72, 0.0, 1.0);
        float sssBand = smoothstep(0.06, 0.50, wrap) * (1.0 - smoothstep(0.50, 0.96, wrap));

        vec3 diffuse = mix(uSkinShadow, albedo, smoothstep(0.03, 0.90, wrap));
        diffuse += uSkinSSS * sssBand * 0.16;

        // Warm bounced room fill light so shadows stay clean rosy-beige, never grey/muddy
        float fill = clamp(dot(N, uFillLightDir) * 0.5 + 0.5, 0.0, 1.0);
        diffuse += albedo * vec3(1.02, 0.98, 0.94) * fill * 0.16;

        // Silky soft skin sheen along front thigh, shin & instep (matching reference video!)
        vec3 H = normalize(uKeyLightDir + V);
        float specPow = mix(28.0, 44.0, clamp(vBulge, 0.0, 1.0));
        float spec = pow(max(dot(N, H), 0.0), specPow) * (0.14 + 0.07 * kneeMask + 0.06 * vBulge);

        // Warm champagne backlight rim along silhouette
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        float rimMask = smoothstep(-0.1, 0.85, dot(N, uRimLightDir));
        vec3 rim = uRimColor * fresnel * (0.08 + 0.26 * rimMask);

        // Delicate warm compression shadow under elastic tear rim
        vec3 rimTint = mix(vec3(1.0), vec3(0.90, 0.82, 0.79), clamp(vRimAO * 0.55, 0.0, 0.48));

        // Soft warm shadow from the pleated skirt at the very top of the thigh
        float skirtShadow = smoothstep(0.68, 0.34, vWorldPos.y);
        float topAO = mix(0.64, 1.0, skirtShadow);

        vec3 color = (diffuse + vec3(spec) * vec3(1.0, 0.96, 0.92)) * rimTint * topAO + rim * skirtShadow;

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
