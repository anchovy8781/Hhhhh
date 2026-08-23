/** Magnet-wire geometry, AWG conversion and AC resistance. */

import { MU0 } from "./constants";
import type { ConductorMaterial } from "./materials";
import { resistivityAt } from "./materials";

export const AWG_RANGE = { min: 8, max: 40 };

/** Bare conductor diameter for an AWG number [m]. */
export function awgDiameter(awg: number): number {
  return 0.127e-3 * Math.pow(92, (36 - awg) / 39);
}

/** Bare conductor cross-section [m²]. */
export function awgArea(awg: number): number {
  const d = awgDiameter(awg);
  return (Math.PI * d * d) / 4;
}

/** Outer diameter including enamel insulation (heavy build) [m]. */
export function insulatedDiameter(awg: number): number {
  return awgDiameter(awg) * 1.06 + 12e-6;
}

/** Skin depth at a frequency [m]. */
export function skinDepth(
  material: ConductorMaterial,
  freq: number,
  tempC: number,
): number {
  if (freq <= 0) return Infinity;
  return Math.sqrt(resistivityAt(material, tempC) / (Math.PI * freq * MU0));
}

/**
 * Dowell's AC resistance factor for a round-wire winding.
 *
 * The round conductor is mapped onto an equivalent foil layer (the usual
 * porosity-factor approximation) and then run through Dowell's 1-D solution
 * for `layers` layers. Returns `Rac / Rdc`, never less than 1.
 */
export function acResistanceFactor(
  material: ConductorMaterial,
  awg: number,
  freq: number,
  layers: number,
  tempC: number,
): number {
  if (freq <= 0) return 1;
  const delta = skinDepth(material, freq, tempC);
  const d = awgDiameter(awg);
  // Round wire -> equivalent foil thickness, including a porosity factor.
  const x = (d / delta) * Math.sqrt(Math.PI / 4) * Math.sqrt(0.866);
  if (x < 1e-6) return 1;
  const m = Math.max(1, layers);
  const sinh2 = Math.sinh(2 * x);
  const sin2 = Math.sin(2 * x);
  const cosh2 = Math.cosh(2 * x);
  const cos2 = Math.cos(2 * x);
  const skin = (sinh2 + sin2) / (cosh2 - cos2);
  const proximity =
    ((2 * (m * m - 1)) / 3) *
    ((Math.sinh(x) - Math.sin(x)) / (Math.cosh(x) + Math.cos(x)));
  const factor = x * (skin + proximity);
  const capped = Math.min(factor, material.acFactorCap);
  return Math.max(1, capped);
}

export interface WindingResult {
  turns: number;
  awg: number;
  bareArea: number; // [m²]
  insulatedDiameter: number; // [m]
  length: number; // [m] total wire length
  mass: number; // [kg]
  rdc: number; // [Ω] at tempC
  rac: number; // [Ω]
  acFactor: number;
  layers: number;
  copperArea: number; // [m²] window area occupied by bare conductor
  occupiedArea: number; // [m²] window area occupied including insulation
}

/**
 * Resistance, mass and window usage of one winding.
 *
 * `meanTurnLength` is the mean length of a single turn (MLT) and
 * `windowHeight` sets how many turns fit per layer, which drives the
 * proximity-effect term.
 */
export function analyzeWinding(params: {
  material: ConductorMaterial;
  turns: number;
  awg: number;
  meanTurnLength: number;
  windowHeight: number;
  freq: number;
  tempC: number;
}): WindingResult {
  const { material, turns, awg, meanTurnLength, windowHeight, freq, tempC } =
    params;
  const bareArea = awgArea(awg);
  const dIns = insulatedDiameter(awg) / material.fillPenalty;
  const perLayer = Math.max(1, Math.floor(windowHeight / dIns));
  const layers = Math.max(1, Math.ceil(turns / perLayer));
  const length = turns * meanTurnLength;
  const rdc = (resistivityAt(material, tempC) * length) / bareArea;
  const acFactor = acResistanceFactor(material, awg, freq, layers, tempC);
  return {
    turns,
    awg,
    bareArea,
    insulatedDiameter: dIns,
    length,
    mass: length * bareArea * material.density,
    rdc,
    rac: rdc * acFactor,
    acFactor,
    layers,
    copperArea: turns * bareArea,
    occupiedArea: (turns * Math.PI * dIns * dIns) / 4,
  };
}
