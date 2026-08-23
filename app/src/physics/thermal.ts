/**
 * Steady-state thermal model.
 *
 * Natural convection plus radiation off the outer surface, linearised into a
 * single heat-transfer coefficient. Losses and temperature are coupled --
 * copper resistance climbs about 0.4 %/K, which raises losses, which raises
 * temperature -- so the operating point is found by iteration rather than by
 * evaluating the losses once at ambient and calling it a day.
 */

import { CELSIUS_AMBIENT } from "./constants";

/** Stefan-Boltzmann constant [W/m²K⁴]. */
const SIGMA = 5.670374e-8;
/** Emissivity of enamelled wire and painted steel. */
const EMISSIVITY = 0.9;
/**
 * Natural-convection coefficient `h = C · dT^0.25` for a small component.
 * C is chosen so that a 100 K rise gives the familiar ~12 W/m²K.
 */
const CONVECTION_C = 12 / Math.pow(100, 0.25);

/**
 * Combined convection + radiation coefficient at a given rise [W/m²K].
 *
 * A fixed coefficient is fine near 100 K of rise and badly wrong past it:
 * radiation grows as T⁴ and takes over, so a fixed-h model predicts hundreds
 * of degrees where the real part settles far cooler (while still being
 * destroyed -- the warning is not the part that was wrong).
 */
export function heatTransferCoefficient(rise: number, ambient: number): number {
  const dT = Math.max(rise, 0.1);
  const convection = CONVECTION_C * Math.pow(dT, 0.25);
  const ts = ambient + dT + 273.15;
  const ta = ambient + 273.15;
  const radiation =
    EMISSIVITY * SIGMA * (ts * ts + ta * ta) * (ts + ta);
  return convection + radiation;
}

/** Reference coefficient at a 100 K rise, kept for callers that want one. */
export const H_NATURAL = 12;

export interface ThermalState {
  temperature: number; // [°C]
  rise: number; // [K]
  totalLoss: number; // [W]
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
  ambient = CELSIUS_AMBIENT,
): number {
  if (surface <= 0) return Infinity;
  if (power <= 0) return 0;
  const dissipated = (dT: number) => heatTransferCoefficient(dT, ambient) * surface * dT;
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
 * `lossAt(temperature)` must return the total loss at that temperature.
 */
export function solveThermal(
  lossAt: (tempC: number) => number,
  surface: number,
  ambient = CELSIUS_AMBIENT,
): ThermalState {
  let temperature = ambient;
  let loss = 0;
  for (let i = 0; i < 24; i++) {
    loss = lossAt(temperature);
    const next = ambient + temperatureRise(loss, surface, ambient);
    if (!isFinite(next)) break;
    // Damped update: the loop is a positive feedback path and can oscillate.
    const damped = temperature + 0.5 * (next - temperature);
    if (Math.abs(damped - temperature) < 0.01) {
      temperature = damped;
      break;
    }
    temperature = damped;
  }
  return {
    temperature,
    rise: temperature - ambient,
    totalLoss: loss,
  };
}
