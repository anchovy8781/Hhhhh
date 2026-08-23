/**
 * Steady-state thermal model.
 *
 * Heat leaves through whatever cooling the environment provides, plus
 * radiation when the surface is bare. Losses and temperature are coupled --
 * copper resistance climbs about 0.4 %/K, which raises losses, which raises
 * temperature -- so the operating point is found by iteration rather than by
 * evaluating the losses once at ambient and calling it a day.
 */

import { coolingFor, DEFAULT_ENVIRONMENT, type Environment } from "./environment";

/** Stefan-Boltzmann constant [W/m²K⁴]. */
const SIGMA = 5.670374e-8;

export interface ThermalState {
  temperature: number; // [°C]
  rise: number; // [K]
  /** Average dissipation the cooling has to remove [W]. */
  totalLoss: number;
  /** Combined coefficient at the solved operating point [W/m²K]. */
  coefficient: number;
  coolingLabel: string;
}

/**
 * Combined surface coefficient at a given rise [W/m²K].
 *
 * Natural convection grows as the fourth root of the temperature difference
 * and radiation as T⁴, so a fixed coefficient is fine near 100 K of rise and
 * badly wrong past it -- it predicts hundreds of degrees where the real part
 * settles far cooler while still being destroyed.
 */
export function heatTransferCoefficient(
  rise: number,
  environment: Environment = DEFAULT_ENVIRONMENT,
): number {
  const cooling = coolingFor(environment);
  const dT = Math.max(rise, 0.1);
  // Forced and liquid cooling are set by the flow, not by how hot the part is.
  const convection =
    cooling.medium === "air" && environment.coolingId.startsWith("natural")
      ? cooling.h * Math.pow(dT / 100, 0.25)
      : cooling.h;
  if (!cooling.radiates) return convection * cooling.enclosureFactor;
  const ts = environment.ambient + dT + 273.15;
  const ta = environment.ambient + 273.15;
  const radiation = environment.emissivity * SIGMA * (ts * ts + ta * ta) * (ts + ta);
  return (convection + radiation) * cooling.enclosureFactor;
}

/**
 * Steady-state temperature rise for a given dissipation [K].
 *
 * Because the coefficient itself depends on the rise, this inverts
 * `P = h(dT)·A·dT` by bisection instead of dividing once.
 */
export function temperatureRise(
  power: number,
  surface: number,
  environment: Environment = DEFAULT_ENVIRONMENT,
): number {
  if (surface <= 0) return Infinity;
  if (power <= 0) return 0;
  const dissipated = (dT: number) =>
    heatTransferCoefficient(dT, environment) * surface * dT;
  let lo = 0;
  let hi = 10;
  while (dissipated(hi) < power && hi < 1e5) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (dissipated(mid) < power) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Iterate losses and temperature to a fixed point.
 *
 * `lossAt(temperature)` returns the instantaneous loss at that temperature;
 * the duty cycle decides how much of it the cooling actually has to carry.
 */
export function solveThermal(
  lossAt: (tempC: number) => number,
  surface: number,
  environment: Environment = DEFAULT_ENVIRONMENT,
): ThermalState {
  const ambient = environment.ambient;
  let temperature = ambient;
  let loss = 0;
  for (let i = 0; i < 24; i++) {
    loss = lossAt(temperature) * environment.dutyCycle;
    const next = ambient + temperatureRise(loss, surface, environment);
    if (!isFinite(next)) break;
    // Damped update: the loop is a positive feedback path and can oscillate.
    const damped = temperature + 0.5 * (next - temperature);
    if (Math.abs(damped - temperature) < 0.01) {
      temperature = damped;
      break;
    }
    temperature = damped;
  }
  const cooling = coolingFor(environment);
  return {
    temperature,
    rise: temperature - ambient,
    totalLoss: loss,
    coefficient: heatTransferCoefficient(temperature - ambient, environment),
    coolingLabel: cooling.label,
  };
}
