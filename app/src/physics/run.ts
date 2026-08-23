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

/**
 * How a part actually fails.
 *
 * "Too hot" is not one failure. Enamel and plastic burn; ferrite and ceramic
 * are brittle and crack, and crack violently if the heat arrives fast enough;
 * copper melts and opens the circuit; a magnet quietly stops being a magnet.
 * They look different, they need different fixes, and only some of them leave
 * a device that still works at all.
 */
export type FailureMode =
  | "burn"
  | "crack"
  | "shatter"
  | "melt"
  | "demagnetise"
  | "arc"
  | "seize";

export const FAILURE_LABELS: Record<FailureMode, string> = {
  burn: "연소",
  crack: "균열",
  shatter: "파쇄",
  melt: "용단",
  demagnetise: "감자",
  arc: "절연 파괴 · 아크",
  seize: "작동 불능",
};

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
  /** Default way this part gives up. */
  mode: FailureMode;
  /**
   * Brittle parts crack rather than burn, and shatter when the heat arrives
   * faster than the material can expand evenly.
   */
  brittle?: boolean;
  /** Temperature at which the part is destroyed outright [°C]. */
  destruction?: number;
  /** True when losing this part stops the device working at all. */
  vital?: boolean;
}

/**
 * What an AC-excited magnetic device needs to simulate its own energisation.
 *
 * A transformer never reaches the DC steady state of its winding resistance:
 * the current is set by the magnetising reactance, and the first half cycle
 * can drive the core to twice its normal flux plus whatever remanence was left
 * behind. That is the inrush, and it is invisible to an R-L step model.
 */
export interface AcMagnetics {
  turns: number;
  /** Effective core area [m²]. */
  area: number;
  /** Inverse B-H curve: magnetomotive force needed for a flux density [A·T]. */
  mmfFor: (b: number) => number;
  bsat: number;
  /** Flux left in the core from last time, as a fraction of Bsat. */
  remanence: number;
  /** Peak of the load current reflected into this winding [A]. */
  loadPeak: number;
}

export interface RuntimeSpec {
  /** `rl` covers inductors and solenoids; `motor` adds inertia; `ac` excites. */
  kind: "rl" | "motor" | "ac";
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
  /** Line frequency, for AC devices [Hz]. */
  frequency?: number;
  ac?: AcMagnetics;
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
  mode?: FailureMode;
}

export interface RunResult {
  electrical: ElectricalSample[];
  thermal: ThermalSample[];
  events: RunEvent[];
  /** `dead` means the device can no longer do its job at all. */
  verdict: "ok" | "warn" | "fail" | "dead";
  /** Modes that actually happened, in the order they happened. */
  modes: FailureMode[];
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
  extra: Partial<Pick<PartSpec, "mode" | "brittle" | "destruction" | "vital">> = {},
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
    mode: extra.mode ?? "burn",
    ...extra,
  };
}

/** Kelvin per second above which a brittle part shatters instead of cracking. */
const THERMAL_SHOCK_RATE = 3;

/**
 * Which way this part is going, given how hot it is and how fast it got there.
 *
 * A ferrite core that drifts past its rating develops cracks; one that is
 * slammed with heat comes apart. Copper does not burn at all until it melts,
 * and then the circuit simply opens.
 */
function failureModeFor(
  spec: PartSpec,
  temperature: number,
  rate: number,
): FailureMode {
  if (spec.destruction !== undefined && temperature >= spec.destruction) {
    return spec.brittle ? "shatter" : "melt";
  }
  if (spec.brittle) {
    return rate > THERMAL_SHOCK_RATE ? "shatter" : "crack";
  }
  return spec.mode;
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
  peakFlux?: number;
  peakFluxAt?: number;
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

  if (spec.kind === "ac" && spec.ac) {
    return runAcInrush(spec, spec.ac, drive, resistance, inductance);
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
 * Magnetising inrush.
 *
 * The state variable is flux linkage, integrated straight from Faraday's law:
 * `dλ/dt = v(t) − i·R`. The current comes back out of the saturating B-H curve
 * rather than from a fixed inductance, which is the whole point -- once the
 * core is past its knee the winding is little more than a resistor, and that
 * is what produces the tens-of-amps first peak on a transformer that draws
 * milliamps once it settles.
 *
 * Worst case switching is assumed: the supply is closed at a voltage zero
 * crossing, when the flux excursion is largest.
 */
function runAcInrush(
  spec: RuntimeSpec,
  ac: AcMagnetics,
  peakVoltage: number,
  resistance: number,
  inductance: number,
): {
  samples: ElectricalSample[];
  peak: number;
  steady: number;
  rise: number;
  peakFlux: number;
  peakFluxAt: number;
} {
  const frequency = spec.frequency ?? 60;
  const omega = 2 * Math.PI * frequency;
  // Run long enough for the inrush to decay: three L/R time constants, but at
  // least a dozen cycles and never more than can be integrated quickly.
  const decayTime = inductance / Math.max(resistance, 1e-9);
  const cycles = Math.min(Math.max(Math.ceil(3 * decayTime * frequency), 12), 240);
  const perCycle = 720;
  const dt = 1 / (frequency * perCycle);
  const amplitude = peakVoltage * Math.SQRT2;
  // Residual flux adds to the first excursion, which is why a transformer
  // switched back on quickly draws more than one switched on cold.
  let flux = ac.remanence * ac.bsat * ac.area * ac.turns;
  const samples: ElectricalSample[] = [];
  let peak = 0;
  let peakFlux = 0;
  let peakFluxAt = 0;
  const every = Math.max(1, Math.floor((cycles * perCycle) / 500));
  let lastCycleRms = 0;
  let sumSquares = 0;
  let countInCycle = 0;

  for (let step = 0; step < cycles * perCycle; step++) {
    const t = step * dt;
    const b = flux / (ac.turns * ac.area);
    if (Math.abs(b) > peakFlux) {
      peakFlux = Math.abs(b);
      peakFluxAt = t;
    }
    const magnetising = ac.mmfFor(Math.abs(b)) / ac.turns * Math.sign(b || 1);
    const current = magnetising + ac.loadPeak * Math.sin(omega * t);
    peak = Math.max(peak, Math.abs(current));
    flux += (amplitude * Math.sin(omega * t) - current * resistance) * dt;

    sumSquares += current * current;
    countInCycle++;
    if (countInCycle === perCycle) {
      lastCycleRms = Math.sqrt(sumSquares / countInCycle);
      sumSquares = 0;
      countInCycle = 0;
    }
    if (step % every === 0) samples.push({ t, current });
  }
  // Settled rms, taken from the final complete cycle.
  const steady = lastCycleRms;
  return {
    samples,
    peak,
    steady,
    rise: Math.min(decayTime, cycles / frequency),
    peakFlux,
    peakFluxAt,
  };
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
  const modes: FailureMode[] = [];
  const previous: Record<string, number> = { ...temperatures };
  let failedAt: number | undefined;
  let failedPart: PartId | undefined;
  let inoperable = false;

  if (
    spec.kind === "ac" &&
    spec.ac &&
    electrical.peakFlux !== undefined &&
    electrical.peakFlux > spec.ac.bsat
  ) {
    events.push({
      t: electrical.peakFluxAt ?? 0,
      partId: "core",
      // Inrush is a warning, never a failure: nothing is destroyed by it. It
      // decides breaker and fuse selection, so it has to be said out loud.
      level: "warn",
      title: "투입 돌입 (코어 포화)",
      text: `투입 순간 자속이 ${electrical.peakFlux.toFixed(2)} T까지 올라 포화점 ${spec.ac.bsat} T를 넘었고, 첫 피크 전류가 ${electrical.peak.toFixed(1)} A — 정상 운전 전류의 ${(electrical.peak / Math.max(spec.ratedCurrent ?? 1, 1e-6)).toFixed(0)}배에 달했습니다. 잔류 자속이 남은 상태에서 전압 0점에 투입하는 최악 조건 기준입니다.`,
      advice: "돌입 억제 저항이나 소프트 스타트를 넣고, 차단기는 순시 트립 여유를 두고 고르세요.",
    });
  }

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
      spec.drive === "current" || spec.kind === "ac"
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
      const rate = (temp - (previous[p.id] ?? temp)) / Math.max(dt, 1e-9);
      previous[p.id] = temp;
      if (temp > p.limit && !failed.has(p.id)) {
        failed.add(p.id);
        const mode = failureModeFor(p, temp, rate);
        modes.push(mode);
        if (p.vital || mode === "melt" || mode === "shatter") inoperable = true;
        if (failedAt === undefined) {
          failedAt = t;
          failedPart = p.id;
        }
        events.push({
          t,
          partId: p.id,
          level: "error",
          mode,
          title: `${p.label} ${FAILURE_LABELS[mode]}`,
          text: `${formatTime(t)}에 ${p.label}이(가) ${temp.toFixed(0)}°C에 도달해 ${p.limitLabel}을(를) 넘었습니다. ${describeMode(p, mode, rate)}`,
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

  const verdict: RunResult["verdict"] = inoperable
    ? "dead"
    : events.some((e) => e.level === "error")
      ? "fail"
      : events.length > 0
        ? "warn"
        : "ok";

  return {
    electrical: electrical.samples,
    thermal: samples,
    events: events.sort((a, b) => a.t - b.t),
    verdict,
    modes,
    peakCurrent: electrical.peak,
    steadyCurrent: electrical.steady,
    currentRise: electrical.rise,
    failedAt,
    failedPart,
    finalTemperatures: { ...temperatures },
    duration,
  };
}

/** One sentence on what this particular ending looks like. */
function describeMode(spec: PartSpec, mode: FailureMode, rate: number): string {
  switch (mode) {
    case "crack":
      return `${spec.label}은(는) 취성 재료입니다. 열팽창 차이로 균열이 생기고, 자로가 끊어지면서 인덕턴스가 무너집니다.`;
    case "shatter":
      return `열이 초당 ${rate.toFixed(1)}K씩 올라 재료가 균일하게 팽창하지 못했습니다. 조각으로 깨져 나갑니다.`;
    case "melt":
      return `도체가 녹아 끊어집니다. 회로가 열리면서 기기는 그 자리에서 멈춥니다.`;
    case "demagnetise":
      return `되돌릴 수 없는 감자가 일어납니다. 식어도 자속이 돌아오지 않아 출력이 영구히 줄어듭니다.`;
    case "arc":
      return `절연이 무너져 층간 아크가 발생합니다. 단락 전류가 흐르며 권선이 그 자리에서 탄화됩니다.`;
    case "seize":
      return `${spec.failure}`;
    default:
      return spec.failure;
  }
}

export function formatTime(seconds: number): string {
  if (seconds < 1e-3) return `${(seconds * 1e6).toFixed(0)}µs`;
  if (seconds < 1) return `${(seconds * 1e3).toFixed(1)}ms`;
  if (seconds < 90) return `${seconds.toFixed(1)}초`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(1)}분`;
  return `${(seconds / 3600).toFixed(1)}시간`;
}
