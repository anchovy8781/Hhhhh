/**
 * Design recommendations.
 *
 * The hardest part of using a design tool is the blank sheet: you know you
 * want 220 V in and 24 V out at 300 VA, and the tool asks you for a turns
 * count. These functions run the standard design equations backwards, so
 * changing the voltage produces a set of numbers that already work — and
 * says which equation each one came from, so it can be argued with.
 */

import { awgArea, awgDiameter } from "./wire";

export interface Recommendation {
  key: string;
  value: number | string;
  /** What it is, in the form "지금 → 추천". */
  label: string;
  /** Why this number, in one sentence. */
  reason: string;
}

/**
 * Current density a winding can carry, by how big it is.
 *
 * Small windings shed heat easily and are pushed harder; large ones cannot,
 * because volume grows faster than surface. These are the values transformer
 * design tables have used for a century.
 */
export function currentDensity(apparentPower: number): number {
  if (apparentPower < 50) return 4.5e6; // [A/m²]
  if (apparentPower < 500) return 3.2e6;
  if (apparentPower < 5000) return 2.4e6;
  return 1.8e6;
}

/** Smallest AWG (thickest wire is a smaller number) that carries the current. */
export function recommendAwg(current: number, density: number): number {
  const needed = current / density;
  for (let awg = 40; awg >= 8; awg--) {
    if (awgArea(awg) >= needed) return awg;
  }
  return 8;
}

/** Turns for a given rms voltage, from Faraday's law. */
export function turnsForVoltage(
  voltage: number,
  frequency: number,
  area: number,
  targetB: number,
  formFactor: number,
): number {
  return Math.ceil(voltage / (formFactor * frequency * area * targetB));
}

/**
 * Core area product needed for an apparent power [m⁴].
 *
 * `Ap = Ae·Aw = S / (K · f · B · J)` — the classic sizing equation. It is what
 * decides whether the core you picked can hold the copper the job needs.
 */
export function areaProduct(
  apparentPower: number,
  frequency: number,
  targetB: number,
  density: number,
  windowUtilisation = 0.35,
  formFactor = 4.44,
): number {
  return (
    apparentPower /
    (formFactor * windowUtilisation * frequency * targetB * density)
  );
}

/** Only suggest a change worth making. */
export function meaningful(current: number, suggested: number, tolerance = 0.08): boolean {
  if (!isFinite(current) || !isFinite(suggested)) return false;
  return Math.abs(suggested - current) / Math.max(Math.abs(current), 1e-9) > tolerance;
}

export function wireReason(awg: number, current: number, density: number): string {
  return `${current.toFixed(2)} A를 ${(density / 1e6).toFixed(1)} A/mm²로 흘리려면 최소 ${(
    (current / density) * 1e6
  ).toFixed(2)} mm² — AWG${awg}(⌀${(awgDiameter(awg) * 1e3).toFixed(2)}mm)가 가장 가까운 규격입니다.`;
}
