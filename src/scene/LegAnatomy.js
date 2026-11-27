import * as THREE from 'three';

/**
 * Analytical parametric anatomy for the left (-1) and right (+1) legs.
 * Shared identically by:
 *   1. The procedural skin mesh
 *   2. The initial stocking cloth mesh
 *   3. The O(1) per-particle cloth-to-leg collision constraint
 *
 * Coordinate system (meters-like stylized anime/realistic proportions):
 *   y = +0.72 : upper thigh (hidden under pleated skirt)
 *   y = +0.10 : mid thigh
 *   y = -0.36 : knee center
 *   y = -0.82 : upper-mid calf bulge
 *   y = -1.48 : lower calf / above ankle
 */

export const LEG_Y_TOP = 0.72;
export const LEG_Y_BOTTOM = -1.56;
export const STOCKING_Y_TOP = 0.66;
export const STOCKING_Y_BOTTOM = -1.562;
export const FLOOR_Y = -1.685;

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function gaussian(x, mu, sigma) {
  const d = (x - mu) / sigma;
  return Math.exp(-0.5 * d * d);
}

/**
 * Center axis (cx, cz) of a leg at height y.
 * side = -1 (viewer's left leg / character's right leg)
 * side = +1 (viewer's right leg / character's left leg)
 */
export function getLegCenter(side, y, out = { x: 0, z: 0 }) {
  // Natural stance: upper thighs closer to hip axis, slight convergence near knees,
  // subtle graceful taper down the calves.
  const hipSpread = 0.228;
  const kneeConverge = 0.022 * gaussian(y, -0.34, 0.36);
  const calfSpread = 0.012 * smoothstep(-0.45, -1.45, y);
  const slightPoseAsym = side > 0 ? 0.008 : -0.004;

  out.x = side * (hipSpread - kneeConverge + calfSpread) + slightPoseAsym;

  // Front-to-back anatomical S-curve:
  // Upper thigh slightly forward, knee neutral/slightly forward, calf curving back
  const thighCurve = 0.024 * gaussian(y, 0.25, 0.45);
  const kneeCurve = 0.018 * gaussian(y, -0.34, 0.22);
  const calfBack = -0.048 * gaussian(y, -0.84, 0.38);
  const poseZ = side > 0 ? 0.018 : -0.012; // subtle natural stance depth

  out.z = thighCurve + kneeCurve + calfBack + poseZ;
  return out;
}

/**
 * Exact surface radius in local (rx, rz) polar form at height y and angle theta.
 * theta = 0 is +X (right), theta = PI/2 is +Z (front), theta = -PI/2 is -Z (back).
 */
export function getLegSurfaceOffset(side, y, theta, out = { dx: 0, dz: 0 }) {
  // Normalized height t: 0 at bottom (-1.48), 1 at top (+0.72)
  const t = Math.max(0, Math.min(1, (y - LEG_Y_BOTTOM) / (LEG_Y_TOP - LEG_Y_BOTTOM)));

  // Base radius profile from slender ankle -> calf -> knee -> mid-thigh -> upper-thigh
  const baseR =
    0.072 +
    0.136 * Math.pow(t, 1.32) +
    0.026 * gaussian(y, 0.38, 0.34) + // soft upper thigh fullness
    0.032 * gaussian(y, -0.84, 0.25) - // calf muscle fullness
    0.015 * gaussian(y, -0.36, 0.16) - // slight slimmer knee waist
    0.008 * gaussian(y, -1.42, 0.12); // graceful slender ankle above malleolus

  // Subtle ankle bone (malleolus) width flare near y = -1.52
  const ankleBone = 0.006 * gaussian(y, -1.52, 0.045) * Math.pow(Math.abs(Math.cos(theta)), 2.0);

  // Elliptical aspect (thighs are slightly deeper front-to-back than side-to-side)
  const rxScale = 0.94 + 0.06 * smoothstep(-0.3, 0.6, y);
  const rzScale = 1.05 + 0.05 * smoothstep(-0.2, 0.65, y);

  let rx = baseR * rxScale;
  let rz = baseR * rzScale;

  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  // Subtle anatomical sculpting harmonics:
  // 1. Kneecap (patella) gentle prominence on the front (+Z, sinT > 0)
  const patella = 0.013 * gaussian(y, -0.34, 0.11) * Math.pow(Math.max(0, sinT), 3.0);

  // 2. Popliteal hollow behind the knee (-Z, sinT < 0)
  const kneeHollow = -0.012 * gaussian(y, -0.36, 0.13) * Math.pow(Math.max(0, -sinT), 2.5);

  // 3. Calf gastrocnemius fullness at the back (-Z)
  const calfBackBulge = 0.024 * gaussian(y, -0.78, 0.24) * Math.pow(Math.max(0, -sinT), 2.0);

  // 4. Outer thigh soft curve (side * cosT > 0)
  const outerThigh = 0.018 * gaussian(y, 0.34, 0.32) * Math.pow(Math.max(0, side * cosT), 2.0);

  // 5. Inner thigh gentle softening so legs don't intersect (side * cosT < 0)
  const innerPress = -0.014 * gaussian(y, 0.45, 0.35) * Math.pow(Math.max(0, -side * cosT), 2.0);

  // 6. Front quadriceps gentle fullness
  const quadFront = 0.012 * gaussian(y, 0.14, 0.30) * Math.pow(Math.max(0, sinT), 2.0);

  // 7. Subtle front shinbone (tibia) contour & tapered Achilles tendon behind lower ankle
  const shinRidge = 0.005 * gaussian(y, -1.05, 0.32) * Math.pow(Math.max(0, sinT), 5.0);
  const achillesHollow =
    -0.009 * gaussian(y, -1.42, 0.14) * Math.pow(Math.max(0, -sinT), 1.6) * (1.0 - Math.pow(Math.max(0, -sinT), 4.0));

  const radialMod =
    patella +
    kneeHollow +
    calfBackBulge +
    outerThigh +
    innerPress +
    quadFront +
    ankleBone +
    shinRidge +
    achillesHollow;

  out.dx = (rx + radialMod) * cosT;
  out.dz = (rz + radialMod) * sinT;
  return out;
}

const _tmpC = { x: 0, z: 0 };
const _tmpO = { dx: 0, dz: 0 };

/**
 * Evaluate a 3D point on the leg surface (plus optional radial offset).
 */
export function evaluateLegPoint(side, y, theta, radialOffset = 0, target = new THREE.Vector3()) {
  getLegCenter(side, y, _tmpC);
  getLegSurfaceOffset(side, y, theta, _tmpO);

  const len = Math.hypot(_tmpO.dx, _tmpO.dz) || 1e-6;
  const scale = (len + radialOffset) / len;
  target.set(_tmpC.x + _tmpO.dx * scale, y, _tmpC.z + _tmpO.dz * scale);
  return target;
}

/**
 * Fast O(1) collision projection for a cloth particle against its leg.
 * Modifies pos (x, y, z) in-place if it penetrates inside the leg + clearance.
 * Returns liftDistance (>= 0): how far the particle currently sits above the leg surface.
 */
export function projectPointOutsideLeg(side, pos, clearance = 0.0038) {
  const yClamped = Math.max(LEG_Y_BOTTOM, Math.min(LEG_Y_TOP, pos.y));
  getLegCenter(side, yClamped, _tmpC);

  const relX = pos.x - _tmpC.x;
  const relZ = pos.z - _tmpC.z;
  const theta = Math.atan2(relZ, relX);

  getLegSurfaceOffset(side, yClamped, theta, _tmpO);
  const surfR = Math.hypot(_tmpO.dx, _tmpO.dz) + clearance;
  const curR = Math.hypot(relX, relZ);

  if (curR < surfR) {
    const inv = curR > 1e-6 ? surfR / curR : 1.0;
    pos.x = _tmpC.x + relX * inv;
    pos.z = _tmpC.z + relZ * inv;
    return 0.0;
  }
  return curR - surfR;
}
