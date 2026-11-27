import * as THREE from 'three';

/**
 * Custom GLSL Skin Shader with proper linear->sRGB color management:
 *  - Bright, natural fair-peach skin tone with warm SSS wrap lighting
 *  - Subtle rosy knee blush & soft satin specular
 *  - Cool cyan studio rim light on silhouette
 *  - Delicate, smooth raised-skin highlight & warm elastic rim shadow at tear openings
 */
export function createSkinMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uKeyLightDir: { value: new THREE.Vector3(-0.48, 0.52, 0.78).normalize() },
      uRimLightDir: { value: new THREE.Vector3(0.82, 0.25, -0.52).normalize() },
      uFillLightDir: { value: new THREE.Vector3(0.25, -0.35, 0.90).normalize() },
      uSkinBase: { value: new THREE.Color('#f4d1bc') },
      uSkinShadow: { value: new THREE.Color('#c28f7c') },
      uSkinSSS: { value: new THREE.Color('#eb937c') },
      uRimColor: { value: new THREE.Color('#7be0f5') },
      uKneeWarmth: { value: new THREE.Color('#e8a38f') },
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

        // Soft anatomical color variation (subtle rosy knee blush)
        float kneeMask = exp(-pow((vWorldPos.y + 0.34) / 0.19, 2.0)) * smoothstep(-0.1, 0.85, N.z);
        vec3 albedo = mix(uSkinBase, uKneeWarmth, kneeMask * 0.22);

        // Very subtle warm flush on raised skin inside tight opening
        albedo = mix(albedo, uKneeWarmth, clamp(vBulge * 0.14, 0.0, 0.16));

        // Wrap diffuse lighting for soft skin SSS (in linear space)
        float ndl = dot(N, uKeyLightDir);
        float wrap = clamp((ndl + 0.62) / 1.62, 0.0, 1.0);
        float sssBand = smoothstep(0.05, 0.48, wrap) * (1.0 - smoothstep(0.48, 0.95, wrap));

        vec3 diffuse = mix(uSkinShadow, albedo, smoothstep(0.04, 0.88, wrap));
        diffuse += uSkinSSS * sssBand * 0.14;

        // Soft studio front fill (balanced so 3D thigh volume stays crisp)
        float fill = clamp(dot(N, uFillLightDir) * 0.5 + 0.5, 0.0, 1.0);
        diffuse += albedo * fill * 0.10;

        // Subtle satin skin specular (slightly brighter on knee and gently raised skin)
        vec3 H = normalize(uKeyLightDir + V);
        float specPow = mix(34.0, 48.0, clamp(vBulge, 0.0, 1.0));
        float spec = pow(max(dot(N, H), 0.0), specPow) * (0.12 + 0.06 * kneeMask + 0.07 * vBulge);

        // Crisp cool cyan-blue studio rim light on outer right silhouette
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.4);
        float rimMask = smoothstep(0.12, 0.82, dot(N, uRimLightDir));
        vec3 rim = uRimColor * fresnel * (0.08 + 0.46 * rimMask);

        // Warm, delicate elastic compression shadow right under the tear rim (never black!)
        vec3 rimTint = mix(vec3(1.0), vec3(0.86, 0.78, 0.75), clamp(vRimAO * 0.65, 0.0, 0.55));

        // Soft shadow from the pleated skirt at the very top of the thigh
        float skirtShadow = smoothstep(0.68, 0.34, vWorldPos.y);
        float topAO = mix(0.58, 1.0, skirtShadow);

        vec3 color = (diffuse + vec3(spec) * vec3(1.0, 0.95, 0.92)) * rimTint * topAO + rim * skirtShadow;

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
