/**
 * Magnetic circuit solver.
 *
 * The core is modelled with a saturating B-H curve in series with an air gap.
 * Because the gap is linear and the core is not, flux density is found by
 * bisection on Ampere's law rather than by assuming constant permeability --
 * that is what produces a realistic L-versus-current roll-off instead of a
 * flat inductance that silently lies to you above saturation.
 */

import { MU0, bisect, clamp } from "./constants";
import type { CoreMaterial } from "./materials";

export type CoreShape = "toroid" | "ei";

export interface ToroidDims {
  shape: "toroid";
  od: number; // 외경 [m]
  id: number; // 내경 [m]
  height: number; // 높이 [m]
}

export interface EiDims {
  shape: "ei";
  tongue: number; // 중앙 다리 폭 a [m]
  stack: number; // 적층 두께 b [m]
  windowWidth: number; // 창 폭 c [m]
  windowHeight: number; // 창 높이 d [m]
}

export type CoreDims = ToroidDims | EiDims;

export interface CoreMetrics {
  ae: number; // 실효 단면적 [m²]
  le: number; // 평균 자로 길이 [m]
  aw: number; // 권선 창 면적 [m²]
  mlt: number; // 1턴 평균 길이 [m]
  ve: number; // 자성체 체적 [m³]
  mass: number; // [kg]
  surface: number; // 방열 표면적 [m²]
  windowHeight: number; // 층당 권선 높이 [m]
}

/** Geometry of a core, reduced to the handful of numbers the physics needs. */
export function coreMetrics(dims: CoreDims, material: CoreMaterial): CoreMetrics {
  if (dims.shape === "toroid") {
    const { od, id, height } = dims;
    const radial = Math.max(1e-6, (od - id) / 2);
    const ae = radial * height;
    const le = (Math.PI * (od + id)) / 2;
    const aw = Math.PI * (id / 2) * (id / 2);
    const mlt = 2 * (radial + height) * 1.15;
    const ve = ae * le;
    const surface =
      Math.PI * od * height + (Math.PI / 2) * (od * od - id * id) * 0.5 +
      Math.PI * id * height;
    return {
      ae,
      le,
      aw,
      mlt,
      ve,
      mass: ve * material.density,
      surface: Math.max(surface, 1e-6),
      windowHeight: Math.max(1e-4, id * 0.9),
    };
  }
  const { tongue, stack, windowWidth, windowHeight } = dims;
  const ae = tongue * stack;
  // Mean path around one window: up the centre leg, across the yoke, down the
  // outer leg and back. Standard EI approximation.
  const le = 2 * (windowHeight + windowWidth + tongue);
  const aw = windowWidth * windowHeight;
  const mlt = 2 * (tongue + stack) + Math.PI * (windowWidth / 2);
  const ve = ae * le;
  const outer = tongue * 2 + windowWidth * 2;
  const tall = windowHeight + tongue;
  const surface = 2 * (outer * tall + outer * stack + tall * stack);
  return {
    ae,
    le,
    aw,
    mlt,
    ve,
    mass: ve * material.density,
    surface: Math.max(surface, 1e-6),
    windowHeight: Math.max(1e-4, windowHeight),
  };
}

/**
 * Magnetic field strength in the core for a given flux density [A/m].
 *
 * `H(B) = B / (mu0*mur) / (1 - (B/Bsat)^n)`, so the incremental permeability
 * falls off as `1 - (B/Bsat)^n`. The exponent `n` is the material's knee
 * sharpness: laminated steel and ferrite hold their permeability almost to
 * saturation and then collapse, powder cores give it up gradually.
 */
export function coreFieldStrength(material: CoreMaterial, b: number): number {
  if (!isFinite(material.bsat)) return b / MU0; // 공심
  const sign = b < 0 ? -1 : 1;
  const ratio = clamp(Math.abs(b) / material.bsat, 0, 0.999999);
  const linear = Math.abs(b) / (MU0 * material.mur);
  return sign * (linear / (1 - Math.pow(ratio, material.knee)));
}

/** Relative incremental permeability `mu_inc / mu_i` at a flux density. */
export function permeabilityRatio(material: CoreMaterial, b: number): number {
  if (!isFinite(material.bsat)) return 1;
  const ratio = clamp(Math.abs(b) / material.bsat, 0, 1);
  return Math.max(0, 1 - Math.pow(ratio, material.knee));
}

/** Total magnetomotive force needed to push `b` through core plus gap [A]. */
export function mmfFor(
  material: CoreMaterial,
  b: number,
  metrics: CoreMetrics,
  gap: number,
): number {
  return coreFieldStrength(material, b) * metrics.le + (b / MU0) * gap;
}

/** Flux density produced by `turns · current` [T]. */
export function fluxDensity(
  material: CoreMaterial,
  metrics: CoreMetrics,
  gap: number,
  mmf: number,
): number {
  if (mmf <= 0) return 0;
  if (!isFinite(material.bsat)) {
    return (MU0 * mmf) / (metrics.le + gap);
  }
  const ceiling = material.bsat * 0.999999;
  const maxMmf = mmfFor(material, ceiling, metrics, gap);
  if (mmf >= maxMmf) return ceiling;
  return bisect((b) => mmfFor(material, b, metrics, gap), mmf, 0, ceiling);
}

/** Effective permeability of a gapped core (still in the linear region). */
export function effectivePermeability(
  material: CoreMaterial,
  metrics: CoreMetrics,
  gap: number,
): number {
  if (gap <= 0) return material.mur;
  return material.mur / (1 + (material.mur * gap) / metrics.le);
}

/**
 * Fringing flux factor for a gapped core (McLyman).
 *
 * A gap lets flux bulge outside the core, which raises inductance above the
 * naive `N²/R` value. Ignoring it overestimates the number of turns needed.
 */
export function fringingFactor(metrics: CoreMetrics, gap: number): number {
  if (gap <= 0) return 1;
  const g = Math.min(gap, Math.sqrt(metrics.ae) / 2);
  return 1 + (g / Math.sqrt(metrics.ae)) * Math.log((2 * metrics.windowHeight) / g);
}

/** Small-signal inductance at zero bias [H]. */
export function inductanceAtZero(
  material: CoreMaterial,
  metrics: CoreMetrics,
  gap: number,
  turns: number,
): number {
  const mue = effectivePermeability(material, metrics, gap);
  const base = (turns * turns * MU0 * mue * metrics.ae) / metrics.le;
  return base * fringingFactor(metrics, gap);
}

export interface OperatingPoint {
  current: number; // [A]
  b: number; // [T]
  flux: number; // [Wb]
  inductance: number; // 할선 인덕턴스 L = N*phi/I [H]
  incremental: number; // 미소신호 인덕턴스 dPhi/dI * N [H]
  saturationRatio: number; // B / Bsat
}

/** Solve the magnetic circuit at one operating current. */
export function operatingPoint(
  material: CoreMaterial,
  metrics: CoreMetrics,
  gap: number,
  turns: number,
  current: number,
): OperatingPoint {
  const fringe = fringingFactor(metrics, gap);
  const solve = (i: number) => fluxDensity(material, metrics, gap, turns * i) * fringe;
  const b = solve(current);
  const flux = b * metrics.ae;
  const l0 = inductanceAtZero(material, metrics, gap, turns);
  const inductance = current > 0 ? (turns * flux) / current : l0;
  const step = Math.max(current * 1e-4, 1e-6);
  const incremental =
    current > 0
      ? (turns * (solve(current + step) - solve(current - step)) * metrics.ae) /
        (2 * step)
      : l0;
  return {
    current,
    b,
    flux,
    inductance,
    incremental: Math.max(0, incremental),
    saturationRatio: isFinite(material.bsat) ? b / material.bsat : 0,
  };
}

/** Current needed to reach a given flux density in the core [A]. */
export function currentForFluxDensity(
  material: CoreMaterial,
  metrics: CoreMetrics,
  gap: number,
  turns: number,
  b: number,
): number {
  if (!isFinite(material.bsat)) {
    return (b * (metrics.le + gap)) / (MU0 * turns);
  }
  const fringe = fringingFactor(metrics, gap);
  const target = Math.min(b / fringe, material.bsat * 0.999999);
  return mmfFor(material, target, metrics, gap) / turns;
}

/**
 * Saturation current, using the datasheet convention: the current at which
 * inductance has fallen to `ratio` of its small-signal value.
 *
 * Defining it as "the current that reaches Bsat exactly" would be worse than
 * useless -- that current is unbounded for any realistic B-H curve, so the
 * answer would depend entirely on where the curve was truncated.
 */
export function saturationCurrent(
  material: CoreMaterial,
  metrics: CoreMetrics,
  gap: number,
  turns: number,
  ratio = 0.7,
): number {
  if (!isFinite(material.bsat)) return Infinity;
  const l0 = inductanceAtZero(material, metrics, gap, turns);
  const target = l0 * ratio;
  const inductanceAt = (i: number) =>
    operatingPoint(material, metrics, gap, turns, i).incremental;
  let hi = currentForFluxDensity(material, metrics, gap, turns, material.bsat * 0.5);
  for (let i = 0; i < 40 && inductanceAt(hi) > target; i++) hi *= 1.6;
  let lo = 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (inductanceAt(mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Inductance-versus-current curve, for plotting the saturation knee. */
export function inductanceCurve(
  material: CoreMaterial,
  metrics: CoreMetrics,
  gap: number,
  turns: number,
  maxCurrent: number,
  points = 40,
): { current: number; inductance: number; b: number }[] {
  const out: { current: number; inductance: number; b: number }[] = [];
  for (let i = 1; i <= points; i++) {
    const current = (maxCurrent * i) / points;
    const op = operatingPoint(material, metrics, gap, turns, current);
    out.push({ current, inductance: op.incremental, b: op.b });
  }
  return out;
}
