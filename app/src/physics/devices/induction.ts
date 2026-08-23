/** 3상 농형 유도전동기 (등가회로 기반). */

import { MU0 } from "../constants";
import { coreLossDensity, coreMaterial, conductorMaterial, resistivityAt } from "../materials";
import { environmentParams, readEnvironment } from "../environment";
import { solveThermal } from "../thermal";
import { analyzeWinding } from "../wire";
import { part, type RuntimeSpec } from "../run";
import {
  currentDensity,
  meaningful,
  recommendAwg,
  wireReason,
  type Recommendation,
} from "../recommend";
import {
  metric,
  num,
  si,
  str,
  type Curve,
  type DeviceDefinition,
  type DeviceResult,
  type Metric,
  type ParamValues,
  type Warning,
} from "../types";
import {
  applicationWarnings,
  conductorParam,
  coreMaterialParam,
  corePart,
  insulationClassParam,
  insulationWarnings,
  windingPart,
} from "./shared";

export const inductionMotor: DeviceDefinition = {
  id: "induction",
  name: "유도전동기",
  tagline: "회전 자계가 회전자에 전류를 유도해 돌립니다. 자석도 브러시도 없습니다",
  icon: "◉",
  params: [
    coreMaterialParam("coreMaterial", "steel-m19-035"),
    conductorParam("conductor", "고정자 권선 재료"),
    conductorParam("rotorConductor", "회전자 바 재료"),
    { kind: "number", key: "boreDiameter", label: "고정자 내경 (보어)", unit: "mm", min: 20, max: 500, step: 1, default: 90, group: "치수" },
    { kind: "number", key: "stackLength", label: "적층 길이", unit: "mm", min: 15, max: 600, step: 1, default: 100, group: "치수" },
    { kind: "number", key: "airGap", label: "공극", unit: "mm", min: 0.15, max: 3, step: 0.05, default: 0.4, group: "치수", hint: "유도기는 공극이 곧 여자 전류입니다. 작을수록 역률이 좋아집니다." },
    { kind: "number", key: "yokeThickness", label: "고정자 요크 두께", unit: "mm", min: 3, max: 80, step: 1, default: 18, group: "치수", advanced: true },
    { kind: "number", key: "poles", label: "극수", unit: "극", min: 2, max: 12, step: 2, default: 4, group: "치수" },
    { kind: "number", key: "turnsPerPhase", label: "상당 직렬 턴수", unit: "T", min: 10, max: 3000, step: 1, default: 240, group: "권선", log: true },
    { kind: "number", key: "awg", label: "고정자 전선", unit: "AWG", min: 8, max: 40, step: 1, default: 15, group: "권선" },
    { kind: "number", key: "windingFactor", label: "권선 계수", unit: "", min: 0.7, max: 1, step: 0.01, default: 0.93, group: "권선", advanced: true, hint: "분포·단절권으로 인한 감소. 보통 0.9~0.96입니다." },
    { kind: "number", key: "rotorBars", label: "회전자 바 수", unit: "개", min: 10, max: 96, step: 1, default: 34, group: "권선", advanced: true },
    { kind: "number", key: "barArea", label: "회전자 바 단면적", unit: "mm²", min: 3, max: 400, step: 1, default: 45, group: "권선", advanced: true, hint: "굵을수록 효율이 오르지만 기동 토크는 떨어집니다." },
    { kind: "number", key: "leakage", label: "누설 리액턴스 비율", unit: "", min: 0.02, max: 0.25, step: 0.005, default: 0.05, group: "권선", advanced: true, hint: "Xm 대비 고정자·회전자 각각의 누설. 이 값이 정동 토크와 기동 토크를 함께 좌우합니다." },
    { kind: "number", key: "barAspect", label: "회전자 바 깊이 비", unit: ":1", min: 1, max: 16, step: 0.5, default: 8, group: "권선", advanced: true, hint: "깊고 좁은 바일수록 기동 시 심구효과가 커져 기동 토크가 늘어납니다." },
    insulationClassParam(),
    { kind: "number", key: "voltage", label: "선간 전압", unit: "V", min: 24, max: 15000, step: 1, default: 380, group: "운전", log: true },
    { kind: "number", key: "freq", label: "전원 주파수", unit: "Hz", min: 10, max: 400, step: 1, default: 60, group: "운전" },
    { kind: "number", key: "loadTorque", label: "부하 토크", unit: "N·m", min: 0, max: 2000, step: 0.1, default: 8, group: "운전", log: true },
    ...environmentParams(),
  ],
  simulate,
  recommend,
};

interface Machine {
  synchronousSpeed: number; // [rad/s]
  phaseVoltage: number;
  r1: number;
  /** Rotor resistance at running slip, where skin effect is negligible. */
  r2: number;
  x1: number;
  x2: number;
  xm: number;
  bGap: number;
  ironLoss: number;
  frequency: number;
  /** Bar depth and skin depth at 1 Hz, for the deep-bar correction. */
  barDepth: number;
  barSkinAt1Hz: number;
}

/**
 * Deep-bar effect.
 *
 * At standstill the rotor sees the full supply frequency, so current crowds
 * into the top of the bar: the cage's resistance rises and its leakage
 * reactance falls. That is what lets a squirrel cage start at all -- a motor
 * modelled with a fixed rotor resistance has high efficiency running and not
 * enough torque to move.
 */
function deepBarFactors(machine: Machine, slip: number): { kr: number; kx: number } {
  const rotorFrequency = Math.abs(slip) * machine.frequency;
  if (rotorFrequency <= 0.01) return { kr: 1, kx: 1 };
  const skin = machine.barSkinAt1Hz / Math.sqrt(rotorFrequency);
  const xi = machine.barDepth / Math.max(skin, 1e-9);
  if (xi < 0.05) return { kr: 1, kx: 1 };
  const sinh2 = Math.sinh(2 * xi);
  const sin2 = Math.sin(2 * xi);
  const cosh2 = Math.cosh(2 * xi);
  const cos2 = Math.cos(2 * xi);
  const denominator = cosh2 - cos2;
  return {
    kr: Math.max(1, (xi * (sinh2 + sin2)) / denominator),
    kx: Math.min(1, ((3 / (2 * xi)) * (sinh2 - sin2)) / denominator),
  };
}

/**
 * Per-phase equivalent circuit.
 *
 * The magnetising reactance comes from the air-gap permeance, the rotor
 * resistance from the cage referred to the stator. Everything the machine does
 * -- speed, torque, current, power factor -- falls out of those five elements.
 */
function machineFor(values: ParamValues, tempC: number): Machine {
  const core = coreMaterial(str(values, "coreMaterial"));
  const stator = conductorMaterial(str(values, "conductor"));
  const rotor = conductorMaterial(str(values, "rotorConductor"));
  const bore = num(values, "boreDiameter") * 1e-3;
  const stack = num(values, "stackLength") * 1e-3;
  const gap = num(values, "airGap") * 1e-3;
  const poles = Math.max(2, Math.round(num(values, "poles") / 2) * 2);
  const turns = Math.round(num(values, "turnsPerPhase"));
  const kw = num(values, "windingFactor");
  const bars = Math.round(num(values, "rotorBars"));
  const barArea = num(values, "barArea") * 1e-6;
  const leakage = num(values, "leakage");
  const voltage = num(values, "voltage");
  const freq = num(values, "freq");
  const omega = 2 * Math.PI * freq;

  // Carter's factor lumps slot opening effects into a slightly larger gap.
  const effectiveGap = gap * 1.2;

  // Lm = (3/2)(4/pi) mu0 (kw*N)^2 / (p/2)^2 * (D/2)*L / g
  const lm =
    (3 / 2) *
    (4 / Math.PI) *
    MU0 *
    Math.pow(kw * turns, 2) /
    Math.pow(poles / 2, 2) *
    ((bore / 2) * stack) /
    effectiveGap;
  const xm = omega * lm;

  const phaseVoltage = voltage / Math.SQRT2 / Math.SQRT2 * Math.SQRT2; // 선간 -> 상 (Y결선)
  const vPhase = voltage / Math.sqrt(3);

  const meanTurn = 2 * (stack + (Math.PI * bore) / poles);
  const winding = analyzeWinding({
    material: stator,
    turns,
    awg: Math.round(num(values, "awg")),
    meanTurnLength: meanTurn,
    windowHeight: bore * 0.15,
    freq: 0,
    tempC,
  });
  const r1 = winding.rdc;

  // Cage referred to the stator: bar plus its share of the end rings.
  const barResistance = (resistivityAt(rotor, tempC) * stack) / barArea;
  const ringArea = barArea * 2.5;
  const ringSegment = (Math.PI * bore) / bars;
  const ringResistance = (resistivityAt(rotor, tempC) * ringSegment) / ringArea;
  const skew = Math.pow(Math.sin((Math.PI * poles) / (2 * bars)), 2);
  const barTotal = barResistance + ringResistance / (2 * Math.max(skew, 1e-4));
  const r2 = ((4 * 3 * Math.pow(kw * turns, 2)) / bars) * barTotal;

  const x1 = xm * leakage;
  const x2 = xm * leakage;

  // A cage bar is deep and narrow, and how narrow is a design choice: it is
  // the knob that trades running efficiency against starting torque.
  const barDepth = Math.sqrt(num(values, "barAspect") * barArea);
  const barSkinAt1Hz = Math.sqrt(resistivityAt(rotor, tempC) / (Math.PI * MU0));

  // Air-gap flux density from the volts per turn.
  const poleArea = ((Math.PI * bore) / poles) * stack;
  const flux = vPhase / (4.44 * freq * kw * turns);
  const bGap = flux / (poleArea * (2 / Math.PI));

  const yoke = num(values, "yokeThickness") * 1e-3;
  const ironVolume =
    Math.PI * (bore + yoke) * yoke * stack + Math.PI * bore * bore * 0.08 * stack;
  const ironLoss = coreLossDensity(core, freq, bGap) * ironVolume;

  return {
    synchronousSpeed: (2 * omega) / poles,
    phaseVoltage: vPhase || phaseVoltage,
    r1,
    r2,
    x1,
    x2,
    xm,
    bGap,
    ironLoss,
    frequency: freq,
    barDepth,
    barSkinAt1Hz,
  };
}

/** Rotor branch at a slip, with the deep-bar correction applied. */
function rotorBranch(machine: Machine, slip: number): { r2: number; x2: number } {
  const { kr, kx } = deepBarFactors(machine, slip);
  return { r2: machine.r2 * kr, x2: machine.x2 * kx };
}

/** Torque at a given slip, from the equivalent circuit [N·m]. */
export function torqueAt(machine: Machine, slip: number): number {
  if (slip <= 0) return 0;
  const { phaseVoltage: v, r1, x1, synchronousSpeed: ws } = machine;
  const { r2, x2 } = rotorBranch(machine, slip);
  const denominator = Math.pow(r1 + r2 / slip, 2) + Math.pow(x1 + x2, 2);
  return (3 * v * v * (r2 / slip)) / (ws * denominator);
}

export interface Operating {
  /** Line (stator) current, magnetising branch included [A]. */
  line: number;
  /** Rotor branch current, which is what makes torque [A]. */
  rotor: number;
  powerFactor: number;
  /** Real power drawn from the supply [W]. */
  input: number;
}

/**
 * Stator current, as the phasor sum of the rotor branch and the magnetising
 * branch.
 *
 * Leaving the magnetising current out is what makes a paper induction motor
 * look like it runs at unity power factor. It is a purely reactive current
 * that never does work and never goes away, and dragging the power factor down
 * to the mid-eighties is exactly its job.
 */
export function operatingPointOf(machine: Machine, slip: number): Operating {
  const { phaseVoltage: v, r1, x1, xm } = machine;
  const magnetising = v / Math.max(xm, 1e-9);
  if (slip <= 0) {
    return { line: magnetising, rotor: 0, powerFactor: 0, input: 0 };
  }
  const { r2, x2 } = rotorBranch(machine, slip);
  const real = r1 + r2 / slip;
  const imaginary = x1 + x2;
  const impedanceSquared = real * real + imaginary * imaginary;
  const rotorCurrent = v / Math.sqrt(impedanceSquared);
  // Rotor branch resolved into components, then the magnetising current added
  // on the reactive axis.
  const active = (v * real) / impedanceSquared;
  const reactive = (v * imaginary) / impedanceSquared + magnetising;
  const line = Math.sqrt(active * active + reactive * reactive);
  return {
    line,
    rotor: rotorCurrent,
    powerFactor: line > 0 ? active / line : 0,
    input: 3 * v * active,
  };
}

function simulate(values: ParamValues): DeviceResult {
  const environment = readEnvironment(values);
  const insulationClass = Number(values["insulationClass"]) || 155;
  const core = coreMaterial(str(values, "coreMaterial"));
  const stator = conductorMaterial(str(values, "conductor"));
  const loadTorque = num(values, "loadTorque");
  const poles = Math.max(2, Math.round(num(values, "poles") / 2) * 2);
  const bore = num(values, "boreDiameter") * 1e-3;
  const stack = num(values, "stackLength") * 1e-3;
  const yoke = num(values, "yokeThickness") * 1e-3;

  const lossAt = (tempC: number) => {
    const m = machineFor(values, tempC);
    const slip = slipFor(m, loadTorque);
    const op = operatingPointOf(m, slip);
    const speedAt = m.synchronousSpeed * (1 - slip);
    const copper =
      3 * op.line * op.line * m.r1 + 3 * op.rotor * op.rotor * rotorBranch(m, slip).r2;
    const windageAt = 0.6 * Math.pow(bore, 4) * stack * Math.pow(speedAt, 3) + 0.02 * speedAt;
    return copper + m.ironLoss + windageAt + 0.012 * (copper + loadTorque * speedAt);
  };

  const outerDiameter = bore + 2 * yoke;
  const surface = Math.PI * outerDiameter * (stack + outerDiameter / 2);
  const thermal = solveThermal(lossAt, surface, environment);
  const machine = machineFor(values, thermal.temperature);
  const slip = slipFor(machine, loadTorque);
  const speed = machine.synchronousSpeed * (1 - slip);
  const op = operatingPointOf(machine, slip);
  const current = op.line;
  const statorLoss = 3 * op.line * op.line * machine.r1;
  const rotorLoss = 3 * op.rotor * op.rotor * rotorBranch(machine, slip).r2;
  const mechanical = loadTorque * speed;
  // Windage follows the fan law and bearing drag is roughly linear in speed;
  // stray load loss is the catch-all the standards assign a flat percentage.
  const windage = 0.6 * Math.pow(bore, 4) * stack * Math.pow(speed, 3) + 0.02 * speed;
  const strayLoss = 0.012 * (mechanical + statorLoss + rotorLoss);
  const inputPower =
    mechanical + statorLoss + rotorLoss + machine.ironLoss + windage + strayLoss;
  const efficiency = inputPower > 0 ? mechanical / inputPower : 0;
  const powerFactor = op.powerFactor;

  const startingTorque = torqueAt(machine, 1);
  const startingCurrent = operatingPointOf(machine, 1).line;
  const { slip: breakdownSlip, torque: breakdownTorque } = breakdownOf(machine);
  const saturationRatio = isFinite(core.bsat) ? machine.bGap / (core.bsat * 0.6) : 0;

  const rpm = (speed * 60) / (2 * Math.PI);
  const out: Metric[] = [
    metric("speed", "회전 속도", rpm, `${rpm.toFixed(0)} rpm`,
      speed > 0 ? "plain" : "bad", { headline: true }),
    metric("slip", "슬립", slip, `${(slip * 100).toFixed(2)} %`,
      slip > 0.1 ? "warn" : "good", { headline: true, hint: "동기 속도와의 차이. 이 차이가 회전자 전류를 만듭니다." }),
    metric("eff", "효율", efficiency, `${(efficiency * 100).toFixed(1)} %`,
      efficiency > 0.85 ? "good" : efficiency > 0.7 ? "warn" : "bad", { headline: true }),
    metric("pf", "역률", powerFactor, powerFactor.toFixed(3),
      powerFactor > 0.82 ? "good" : powerFactor > 0.7 ? "warn" : "bad", { headline: true }),
    metric("current", "선전류", current, si(current, "A"), "plain", {
      hint: `자화 전류 ${si(machine.phaseVoltage / machine.xm, "A")} 포함. 이 성분이 역률을 끌어내립니다.`,
    }),
    metric("imag", "자화 전류", machine.phaseVoltage / machine.xm,
      si(machine.phaseVoltage / machine.xm, "A"), "plain", {
        hint: "부하와 무관하게 늘 흐릅니다. 공극이 클수록 커집니다.",
      }),
    metric("sync", "동기 속도", (machine.synchronousSpeed * 60) / (2 * Math.PI),
      `${((machine.synchronousSpeed * 60) / (2 * Math.PI)).toFixed(0)} rpm`),
    metric("pmech", "기계 출력", mechanical, si(mechanical, "W")),
    metric("startT", "기동 토크", startingTorque, si(startingTorque, "N·m"),
      startingTorque > loadTorque ? "good" : "bad",
      { hint: "부하 토크보다 작으면 기동하지 못합니다." }),
    metric("startI", "기동 전류", startingCurrent, si(startingCurrent, "A"),
      startingCurrent > current * 8 ? "warn" : "plain",
      { hint: `정격의 ${(startingCurrent / Math.max(current, 1e-9)).toFixed(1)}배` }),
    metric("maxT", "정동 토크 (최대)", breakdownTorque, si(breakdownTorque, "N·m"),
      breakdownTorque > loadTorque * 1.6 ? "good" : "warn"),
    metric("bgap", "공극 자속밀도", machine.bGap, `${machine.bGap.toFixed(3)} T`,
      saturationRatio > 1 ? "bad" : saturationRatio > 0.85 ? "warn" : "good"),
    metric("r1", "고정자 저항 (상)", machine.r1, si(machine.r1, "Ω")),
    metric("r2", "회전자 저항 (환산)", machine.r2, si(machine.r2, "Ω"), "plain", {
      hint: `기동 시에는 심구효과로 ${(rotorBranch(machine, 1).r2 / machine.r2).toFixed(2)}배가 됩니다. 그 덕분에 기동 토크가 나옵니다.`,
    }),
    metric("smax", "정동 슬립", breakdownSlip, `${(breakdownSlip * 100).toFixed(1)} %`),
    metric("xm", "자화 리액턴스", machine.xm, si(machine.xm, "Ω")),
    metric("pcu", "고정자 동손", statorLoss, si(statorLoss, "W")),
    metric("prot", "회전자 동손", rotorLoss, si(rotorLoss, "W"), "plain", {
      hint: "슬립에 비례합니다. 슬립이 크면 회전자가 뜨거워집니다.",
    }),
    metric("pfe", "철손", machine.ironLoss, si(machine.ironLoss, "W")),
    metric("pfw", "풍손 · 마찰손", windage, si(windage, "W"), "plain", {
      hint: "속도의 세제곱으로 늘어납니다. 고속기에서는 무시할 수 없습니다.",
    }),
    metric("pstray", "표유부하손", strayLoss, si(strayLoss, "W"), "plain", {
      hint: "고조파·누설로 새는 손실. 규격에서 입력의 1.2%로 잡습니다.",
    }),
    metric("temp", "예상 온도", thermal.temperature, `${thermal.temperature.toFixed(0)} °C`,
      thermal.temperature > insulationClass ? "bad" : "good"),
  ];

  const warnings: Warning[] = [...insulationWarnings(values, thermal.temperature)];
  if (startingTorque < loadTorque) {
    warnings.push({
      level: "error",
      text: `기동 토크 ${startingTorque.toFixed(1)} N·m가 부하 ${loadTorque} N·m보다 작습니다. 기동하지 못하고 구속 전류 ${startingCurrent.toFixed(0)}A가 계속 흐릅니다.`,
    });
  }
  if (breakdownTorque < loadTorque) {
    warnings.push({
      level: "error",
      text: `부하가 정동 토크 ${breakdownTorque.toFixed(1)} N·m를 넘습니다. 운전 중 실속(stall)합니다.`,
    });
  }
  if (slip > 0.12) {
    warnings.push({
      level: "warn",
      text: `슬립 ${(slip * 100).toFixed(1)}%는 과도합니다. 회전자 동손이 입력의 ${(slip * 100).toFixed(0)}%로 나가고, 그 열은 전부 회전자에 쌓입니다.`,
    });
  }
  if (powerFactor < 0.75) {
    warnings.push({
      level: "warn",
      text: `역률 ${powerFactor.toFixed(2)}는 낮습니다. 공극을 줄이거나 턴수를 늘려 자화 전류를 낮추세요.`,
    });
  }
  if (saturationRatio > 1) {
    warnings.push({
      level: "error",
      text: `공극 자속밀도 ${machine.bGap.toFixed(2)}T는 이 강판에 과합니다. 자화 전류가 폭증해 역률과 효율이 함께 무너집니다.`,
    });
  }
  warnings.push(...applicationWarnings(values, out, Math.min(saturationRatio, 1.2)));

  const points: { x: number; y: number }[] = [];
  for (let i = 1; i <= 60; i++) {
    const s = i / 60;
    const rpmAt = ((machine.synchronousSpeed * (1 - s)) * 60) / (2 * Math.PI);
    points.push({ x: rpmAt, y: torqueAt(machine, s) });
  }
  const curves: Curve[] = [
    {
      key: "torque-speed",
      title: "토크-속도 특성 (전 슬립 구간)",
      xLabel: "속도 [rpm]",
      yLabel: "토크 [N·m]",
      points: points.reverse(),
      marker: { x: rpm, label: "운전점" },
    },
  ];

  const winding = analyzeWinding({
    material: stator,
    turns: Math.round(num(values, "turnsPerPhase")),
    awg: Math.round(num(values, "awg")),
    meanTurnLength: 2 * (stack + (Math.PI * bore) / poles),
    windowHeight: bore * 0.15,
    freq: 0,
    tempC: thermal.temperature,
  });
  const ironMass = Math.PI * (bore + yoke) * yoke * stack * core.density;
  const runtime: RuntimeSpec = {
    kind: "motor",
    drive: "voltage",
    supply: machine.phaseVoltage,
    resistance20: machine.r1 / (1 + stator.alphaT * (thermal.temperature - 20)),
    alphaT: stator.alphaT,
    inductance: Math.max((machine.x1 + machine.xm) / (2 * Math.PI * num(values, "freq")), 1e-4),
    fixedLoss: machine.ironLoss + rotorLoss,
    surface,
    ke: machine.phaseVoltage / Math.max(machine.synchronousSpeed, 1e-6),
    kt: loadTorque > 0 ? loadTorque / Math.max(current, 1e-9) : 0.1,
    inertia: Math.max(0.5 * (ironMass * 0.6) * Math.pow(bore / 2, 2), 1e-5),
    loadTorque,
    parts: [
      windingPart(winding.mass * 3, insulationClass, stator),
      corePart(core, ironMass),
      part("housing", "회전자 케이지", ironMass * 0.4, 900, 1.1, 200,
        "회전자 바 허용 온도 200°C",
        "알루미늄 바가 팽창하며 균열이 생기고, 끊어지면 토크를 잃습니다.",
        "슬립을 낮추거나 기동 횟수를 줄이고, 회전자 바를 굵게 하세요.",
        { mode: "crack", vital: true }),
    ],
  };

  return {
    metrics: out,
    warnings,
    curves,
    runtime,
    build: {
      kind: "motor",
      statorOd: outerDiameter * 1e3,
      rotorOd: (bore - 2 * num(values, "airGap") * 1e-3) * 1e3,
      stackLength: stack * 1e3,
      airGap: num(values, "airGap"),
      magnetThickness: yoke * 1e3 * 0.4,
      poles,
      slots: Math.round(num(values, "rotorBars")),
      shaftDiameter: Math.max(6, bore * 1e3 * 0.18),
      coreColor: core.color,
      magnetColor: conductorMaterial(str(values, "rotorConductor")).color,
      saturation: Math.min(saturationRatio, 1.2),
      windings: [
        {
          label: "고정자",
          turns: Math.round(num(values, "turnsPerPhase")),
          wireDiameter: winding.insulatedDiameter * 1e3,
          color: stator.color,
          share: 1,
        },
      ],
    },
  };
}

/**
 * Peak of the torque-slip curve.
 *
 * The closed-form breakdown slip assumes a fixed rotor resistance, which the
 * deep-bar correction takes away, so the peak is found by scanning the curve
 * the machine actually has.
 */
function breakdownOf(machine: Machine): { slip: number; torque: number } {
  let best = { slip: 0.05, torque: 0 };
  for (let i = 1; i <= 200; i++) {
    const slip = i / 200;
    const torque = torqueAt(machine, slip);
    if (torque > best.torque) best = { slip, torque };
  }
  return best;
}

/** Slip that balances the load, found by bisection on the torque curve. */
function slipFor(machine: Machine, loadTorque: number): number {
  if (loadTorque <= 0) return 1e-5;
  const breakdown = breakdownOf(machine).slip;
  if (torqueAt(machine, breakdown) < loadTorque) return 1; // stalled
  let lo = 1e-6;
  let hi = breakdown;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (torqueAt(machine, mid) < loadTorque) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function recommend(values: ParamValues): Recommendation[] {
  const out: Recommendation[] = [];
  const machine = machineFor(values, 75);
  const core = coreMaterial(str(values, "coreMaterial"));
  const turns = Math.round(num(values, "turnsPerPhase"));
  const target = core.bsat * 0.55; // 유도기는 여자 전류 때문에 여유를 크게 둡니다
  const suggested = Math.max(
    10,
    Math.round((turns * machine.bGap) / target),
  );
  if (meaningful(turns, suggested, 0.05)) {
    out.push({
      key: "turnsPerPhase",
      value: suggested,
      label: `상당 턴수 ${turns} → ${suggested}`,
      reason: `공극 자속밀도를 ${target.toFixed(2)}T로 맞추려면 필요한 턴수입니다. 유도기는 자화 전류가 역률을 좌우해서 변압기보다 여유를 크게 둡니다.`,
    });
  }
  const slip = slipFor(machine, num(values, "loadTorque"));
  const current = operatingPointOf(machine, slip).line;
  const density = currentDensity(3 * machine.phaseVoltage * current);
  const awg = recommendAwg(current, density);
  if (Math.abs(awg - Math.round(num(values, "awg"))) >= 1) {
    out.push({
      key: "awg",
      value: awg,
      label: `고정자 전선 AWG${Math.round(num(values, "awg"))} → AWG${awg}`,
      reason: wireReason(awg, current, density),
    });
  }
  return out;
}
