/**
 * Energise the device and watch what happens.
 *
 * Steady-state numbers tell you what a design settles at; they say nothing
 * about the first 20 ms, when a transformer draws twenty times its rated
 * current, or about minute nine, when the winding finally reaches the enamel's
 * limit. This runs the design and reports *which part* gave up and when.
 *
 * The two phases are integrated separately on purpose. Electrical time
 * constants are microseconds to milliseconds and thermal ones are minutes;
 * stepping a single stiff system fine enough for the first would need billions
 * of steps to reach the second. So the inrush is integrated at its own scale,
 * and the thermal run then uses the settled electrical solution.
 */

import { temperatureRise } from "./thermal";
import type { Environment } from "./environment";

export type PartId = "winding" | "core" | "magnet" | "insulation" | "bobbin" | "housing";

export interface PartSpec {
  id: PartId;
  label: string;
  /** Thermal capacity [J/K] = mass x specific heat. */
  capacity: number;
  /**
   * How hot this part runs relative to the average temperature rise.
   *
   * The winding is the heat source and sits above the average; a magnet bolted
   * to the housing sits below it.
   */
  riseFactor: number;
  /** Hard limit [°C]; crossing it is a failure of this part. */
  limit: number;
  limitLabel: string;
  /** What actually goes wrong when the limit is passed. */
  failure: string;
  advice: string;
}

export interface RuntimeSpec {
  /** `rl` covers inductors, transformers and solenoids; `motor` adds inertia. */
  kind: "rl" | "motor";
  /**
   * How the device is fed.
   *
   * A solenoid across a battery is voltage-driven: as it heats, its resistance
   * rises and the current sags. An inductor inside a converter is
   * current-driven: the control loop holds the current and the extra
   * resistance simply turns into more heat. Modelling both the same way gets
   * one of them backwards.
   */
  drive: "voltage" | "current";
  supply: number; // [V]
  /** Current the loop holds, for current-driven parts [A]. */
  ratedCurrent?: number;
  /** Winding resistance at 20 °C [Ω]. */
  resistance20: number;
  /** Copper temperature coefficient [1/K]. */
  alphaT: number;
  inductance: number; // [H]
  /** Loss that does not follow I², e.g. core loss [W]. */
  fixedLoss: number;
  /** Surface the cooling acts on [m²]. */
  surface: number;
  parts: PartSpec[];
  /** Current at which the core saturates, if it can [A]. */
  saturationCurrent?: number;
  /** Motor terms. */
  ke?: number;
  kt?: number;
  inertia?: number;
  loadTorque?: number;
  /** Series voltage drop that does not scale with current (brushes). */
  seriesDrop?: number;
}

export interface ElectricalSample {
  t: number; // [s]
  current: number; // [A]
  speed?: number; // [rad/s]
  torque?: number; // [N·m]
}

export interface ThermalSample {
  t: number; // [s]
  current: number;
  loss: number;
  temperatures: Record<string, number>;
}

export interface RunEvent {
  t: number;
  partId: PartId | "supply";
  level: "warn" | "error";
  title: string;
  text: string;
  advice: string;
}

export interface RunResult {
  electrical: ElectricalSample[];
  thermal: ThermalSample[];
  events: RunEvent[];
  verdict: "ok" | "warn" | "fail";
  peakCurrent: number;
  steadyCurrent: number;
  /** Time to reach 95 % of the final current [s]. */
  currentRise: number;
  /** Time the first failure happened, if any [s]. */
  failedAt?: number;
  failedPart?: PartId;
  finalTemperatures: Record<string, number>;
  duration: number;
}

export interface RunOptions {
  /** How long to run the thermal phase [s]. */
  duration?: number;
  samples?: number;
}

const SPECIFIC_HEAT = {
  copper: 385,
  iron: 450,
  ferrite: 750,
  magnet: 440,
  plastic: 1500,
} as const;

export const HEAT_CAPACITY = SPECIFIC_HEAT;

/** Build a part with its thermal capacity from mass. */
export function part(
  id: PartId,
  label: string,
  mass: number,
  specificHeat: number,
  riseFactor: number,
  limit: number,
  limitLabel: string,
  failure: string,
  advice: string,
): PartSpec {
  return {
    id,
    label,
    capacity: Math.max(mass * specificHeat, 0.5),
    riseFactor,
    limit,
    limitLabel,
    failure,
    advice,
  };
}

/**
 * Phase 1: the electrical transient.
 *
 * An RL circuit is integrated explicitly at a hundred steps per time constant,
 * which is far inside the stability limit and cheap because the whole phase is
 * only a handful of time constants long.
 */
function runElectrical(spec: RuntimeSpec): {
  samples: ElectricalSample[];
  peak: number;
  steady: number;
  rise: number;
} {
  const resistance = Math.max(spec.resistance20, 1e-9);
  const drive = Math.max(spec.supply - (spec.seriesDrop ?? 0), 0);
  const inductance = Math.max(spec.inductance, 1e-12);

  if (spec.kind === "motor") {
    const ke = spec.ke ?? 0;
    const kt = spec.kt ?? 0;
    const inertia = Math.max(spec.inertia ?? 1e-6, 1e-9);
    const load = spec.loadTorque ?? 0;
    const electricalTau = inductance / resistance;
    const mechanicalTau = ke > 0 ? (inertia * resistance) / (kt * ke) : 1;
    const span = Math.max(mechanicalTau * 6, electricalTau * 20, 0.02);
    const dt = Math.min(electricalTau / 20, span / 4000, 1e-4);
    const samples: ElectricalSample[] = [];
    let current = 0;
    let speed = 0;
    let peak = 0;
    const every = Math.max(1, Math.floor(span / dt / 400));
    for (let step = 0; step * dt <= span; step++) {
      const t = step * dt;
      const emf = ke * speed;
      current += ((drive - current * resistance - emf) / inductance) * dt;
      const torque = kt * current;
      speed = Math.max(0, speed + ((torque - load) / inertia) * dt);
      peak = Math.max(peak, current);
      if (step % every === 0) samples.push({ t, current, speed, torque });
    }
    const steady = current;
    const rise = samples.find((s) => s.current >= steady * 0.95)?.t ?? span;
    return { samples, peak, steady, rise };
  }

  if (spec.drive === "current") {
    // The converter ramps the current at dI/dt = V/L and then holds it.
    const rated = spec.ratedCurrent ?? drive / resistance;
    const rampTime = (inductance * rated) / Math.max(drive, 1e-9);
    const span = rampTime * 1.6;
    const steps = 400;
    const samples: ElectricalSample[] = [];
    for (let step = 0; step <= steps; step++) {
      const t = (span * step) / steps;
      samples.push({ t, current: Math.min(rated, (drive / inductance) * t) });
    }
    return { samples, peak: rated, steady: rated, rise: rampTime };
  }

  const tau = inductance / resistance;
  const span = tau * 8;
  const steps = 600;
  const dt = span / steps;
  const samples: ElectricalSample[] = [];
  let current = 0;
  for (let step = 0; step <= steps; step++) {
    const t = step * dt;
    samples.push({ t, current });
    current += ((drive - current * resistance) / inductance) * dt;
  }
  const steady = drive / resistance;
  return { samples, peak: steady, steady, rise: tau * 3 };
}

/**
 * Phase 2: the thermal run.
 *
 * Every part is a lumped mass relaxing toward the temperature the steady-state
 * model gives for the present dissipation, so a run that goes the distance
 * ends exactly where the static analysis said it would -- the two views never
 * disagree.
 */
export function runDevice(
  spec: RuntimeSpec,
  environment: Environment,
  options: RunOptions = {},
): RunResult {
  const duration = options.duration ?? 1800;
  const sampleCount = options.samples ?? 240;
  const electrical = runElectrical(spec);

  const temperatures: Record<string, number> = {};
  for (const p of spec.parts) temperatures[p.id] = environment.ambient;

  const events: RunEvent[] = [];
  const failed = new Set<string>();
  const warned = new Set<string>();
  let failedAt: number | undefined;
  let failedPart: PartId | undefined;

  if (spec.saturationCurrent !== undefined && electrical.peak > spec.saturationCurrent) {
    events.push({
      t: electrical.samples.find((s) => s.current > spec.saturationCurrent!)?.t ?? 0,
      partId: "core",
      level: "error",
      title: "기동 중 코어 포화",
      text: `돌입 전류 ${electrical.peak.toFixed(2)} A가 포화 전류 ${spec.saturationCurrent.toFixed(2)} A를 넘었습니다. 인덕턴스가 무너지면서 전류가 회로 저항만으로 제한됩니다.`,
      advice: "공극을 넣거나 턴수를 늘리거나, 소프트 스타트로 돌입을 억제하세요.",
    });
  }

  const steps = 4000;
  const dt = duration / steps;
  const every = Math.max(1, Math.floor(steps / sampleCount));
  const samples: ThermalSample[] = [];

  for (let step = 0; step <= steps; step++) {
    const t = step * dt;
    const windingTemp = temperatures.winding ?? environment.ambient;
    const resistance =
      spec.resistance20 * (1 + spec.alphaT * (windingTemp - 20));
    const drive = Math.max(spec.supply - (spec.seriesDrop ?? 0), 0);
    const current =
      spec.drive === "current"
        ? (spec.ratedCurrent ?? electrical.steady)
        : spec.kind === "motor"
          ? Math.max(0, electrical.steady * (spec.resistance20 / resistance))
          : drive / Math.max(resistance, 1e-9);
    const loss = current * current * resistance + spec.fixedLoss;
    const rise = temperatureRise(loss * environment.dutyCycle, spec.surface, environment);

    for (const p of spec.parts) {
      const target = environment.ambient + rise * p.riseFactor;
      // Instantaneous thermal resistance, so the time constant tracks the
      // cooling that is actually happening rather than a fixed guess.
      const resistanceTh = loss > 0 ? (rise * p.riseFactor) / loss : 1;
      const tau = Math.max(p.capacity * resistanceTh, dt * 2);
      temperatures[p.id] += ((target - temperatures[p.id]!) * dt) / tau;
    }

    for (const p of spec.parts) {
      const temp = temperatures[p.id]!;
      if (temp > p.limit && !failed.has(p.id)) {
        failed.add(p.id);
        if (failedAt === undefined) {
          failedAt = t;
          failedPart = p.id;
        }
        events.push({
          t,
          partId: p.id,
          level: "error",
          title: `${p.label} 한계 초과`,
          text: `${formatTime(t)}에 ${p.label}이(가) ${temp.toFixed(0)}°C에 도달해 ${p.limitLabel}을(를) 넘었습니다. ${p.failure}`,
          advice: p.advice,
        });
      } else if (temp > p.limit - 15 && !warned.has(p.id) && !failed.has(p.id)) {
        warned.add(p.id);
        events.push({
          t,
          partId: p.id,
          level: "warn",
          title: `${p.label} 한계 근접`,
          text: `${formatTime(t)}에 ${p.label}이(가) ${temp.toFixed(0)}°C — ${p.limitLabel}까지 ${(p.limit - temp).toFixed(0)}°C 남았습니다.`,
          advice: p.advice,
        });
      }
    }

    if (step % every === 0 || step === steps) {
      samples.push({ t, current, loss, temperatures: { ...temperatures } });
    }
  }

  const verdict = events.some((e) => e.level === "error")
    ? "fail"
    : events.length > 0
      ? "warn"
      : "ok";

  return {
    electrical: electrical.samples,
    thermal: samples,
    events: events.sort((a, b) => a.t - b.t),
    verdict,
    peakCurrent: electrical.peak,
    steadyCurrent: electrical.steady,
    currentRise: electrical.rise,
    failedAt,
    failedPart,
    finalTemperatures: { ...temperatures },
    duration,
  };
}

export function formatTime(seconds: number): string {
  if (seconds < 1e-3) return `${(seconds * 1e6).toFixed(0)}µs`;
  if (seconds < 1) return `${(seconds * 1e3).toFixed(1)}ms`;
  if (seconds < 90) return `${seconds.toFixed(1)}초`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(1)}분`;
  return `${(seconds / 3600).toFixed(1)}시간`;
}
