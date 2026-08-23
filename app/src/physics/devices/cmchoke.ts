/** 커먼모드 초크 (EMI 필터). */

import { coreLossDensity, coreMaterial, conductorMaterial } from "../materials";
import { coreMetrics, inductanceAtZero, operatingPoint, saturationCurrent } from "../magnetics";
import { environmentParams, readEnvironment } from "../environment";
import {
  currentDensity,
  meaningful,
  recommendAwg,
  wireReason,
  type Recommendation,
} from "../recommend";
import { solveThermal } from "../thermal";
import { analyzeWinding } from "../wire";
import type { RuntimeSpec } from "../run";
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
  bobbinPart,
  conductorParam,
  coreMaterialParam,
  corePart,
  insulationClassParam,
  insulationWarnings,
  thermalWarnings,
  toroidDims,
  windingPart,
  windowWarnings,
} from "./shared";

export const cmChoke: DeviceDefinition = {
  id: "cmchoke",
  name: "커먼모드 초크",
  tagline: "차동 전류는 통과시키고 공통모드 노이즈만 막습니다",
  icon: "≋",
  params: [
    coreMaterialParam("coreMaterial", "nanocrystalline-ft3", ["커먼모드", "고투자율"]),
    conductorParam(),
    { kind: "number", key: "od", label: "외경", unit: "mm", min: 8, max: 120, step: 1, default: 42, group: "치수" },
    { kind: "number", key: "id", label: "내경", unit: "mm", min: 4, max: 90, step: 1, default: 26, group: "치수" },
    { kind: "number", key: "height", label: "높이", unit: "mm", min: 3, max: 60, step: 1, default: 18, group: "치수" },
    { kind: "number", key: "turns", label: "권선당 턴수", unit: "T", min: 2, max: 400, step: 1, default: 14, group: "권선" },
    { kind: "number", key: "awg", label: "전선 굵기", unit: "AWG", min: 8, max: 40, step: 1, default: 15, group: "권선" },
    {
      kind: "number",
      key: "leakage",
      label: "누설 결합률",
      unit: "%",
      min: 0.2,
      max: 8,
      step: 0.1,
      default: 1.5,
      group: "권선",
      hint: "두 권선이 떨어질수록 누설(=차동 인덕턴스)이 커집니다. 차동 노이즈에는 도움, 포화에는 해가 됩니다.",
    },
    insulationClassParam(),
    { kind: "number", key: "lineCurrent", label: "선로 전류 (차동)", unit: "A", min: 0.1, max: 200, step: 0.1, default: 10, group: "운전" },
    { kind: "number", key: "voltage", label: "선로 전압", unit: "V", min: 12, max: 1000, step: 1, default: 230, group: "운전", advanced: true },
    { kind: "number", key: "lineFreq", label: "선로 주파수", unit: "Hz", min: 16, max: 400, step: 1, default: 60, group: "운전", hint: "선로 전류가 흐르는 주파수. 코어 손실은 여기서 발생합니다.", advanced: true },
    { kind: "number", key: "freq", label: "노이즈 주파수", unit: "Hz", min: 1e3, max: 30e6, step: 1, default: 1e6, group: "운전", log: true, hint: "임피던스와 감쇠를 평가할 주파수입니다. 이 주파수의 전류는 걸러내는 대상이지 흐르는 전류가 아닙니다." },
    { kind: "number", key: "targetZ", label: "목표 임피던스", unit: "Ω", min: 100, max: 1e6, step: 10, default: 20e3, group: "운전", log: true, hint: "노이즈 주파수에서 이만큼의 임피던스가 나오도록 턴수를 추천합니다." },
    ...environmentParams(),
  ],
  simulate,
  recommend,
};

/** Turns for a target common-mode impedance, and wire for the line current. */
function recommend(values: ParamValues): Recommendation[] {
  const core = coreMaterial(str(values, "coreMaterial"));
  const od = num(values, "od");
  const innerDiameter = Math.min(num(values, "id"), od - 2);
  const metrics = coreMetrics(toroidDims(od, innerDiameter, num(values, "height")), core);
  const turns = Math.round(num(values, "turns"));
  const targetZ = num(values, "targetZ");
  const freq = num(values, "freq");
  const lineCurrent = num(values, "lineCurrent");
  const out: Recommendation[] = [];

  const alPerTurn = inductanceAtZero(core, metrics, 0, 1);
  const neededL = targetZ / (2 * Math.PI * freq);
  const suggested = Math.max(2, Math.round(Math.sqrt(neededL / Math.max(alPerTurn, 1e-18))));
  if (meaningful(turns, suggested, 0.05)) {
    out.push({
      key: "turns",
      value: suggested,
      label: `권선당 턴수 ${turns} → ${suggested}`,
      reason: `${(freq / 1e6).toFixed(2)}MHz에서 ${(targetZ / 1e3).toFixed(1)}kΩ을 내려면 L = Z/(2πf) = ${si(neededL, "H")}가 필요하고, 인덕턴스는 턴수의 제곱에 비례합니다.`,
    });
  }

  const density = currentDensity(lineCurrent * num(values, "voltage"));
  const awg = recommendAwg(lineCurrent, density);
  if (Math.abs(awg - Math.round(num(values, "awg"))) >= 1) {
    out.push({
      key: "awg",
      value: awg,
      label: `전선 AWG${Math.round(num(values, "awg"))} → AWG${awg}`,
      reason: wireReason(awg, lineCurrent, density),
    });
  }
  if (core.mur < 10000) {
    out.push({
      key: "coreMaterial",
      value: "nanocrystalline-vitroperm",
      label: "코어 재료 → 나노결정 VITROPERM 500F",
      reason: `커먼모드 초크는 투자율이 곧 임피던스입니다. µr ${core.mur.toLocaleString()} → 60,000으로 바꾸면 같은 턴수로 훨씬 큰 감쇠를 얻습니다.`,
    });
  }
  return out;
}

function simulate(values: ParamValues): DeviceResult {
  const environment = readEnvironment(values);
  const insulationClass = Number(values["insulationClass"]) || 155;
  const core = coreMaterial(str(values, "coreMaterial"));
  const conductor = conductorMaterial(str(values, "conductor"));
  const od = num(values, "od");
  const innerDiameter = Math.min(num(values, "id"), od - 2);
  const height = num(values, "height");
  const turns = Math.round(num(values, "turns"));
  const awg = Math.round(num(values, "awg"));
  const leakageFraction = num(values, "leakage") / 100;
  const lineCurrent = num(values, "lineCurrent");
  const voltage = num(values, "voltage");
  const freq = num(values, "freq");
  const lineFreq = num(values, "lineFreq");

  const dims = toroidDims(od, innerDiameter, height);
  const metrics = coreMetrics(dims, core);

  // Common mode sees both windings aiding: the full core permeability.
  const lcm = inductanceAtZero(core, metrics, 0, turns);
  // Differential mode sees only the leakage between them.
  const ldm = lcm * leakageFraction;

  const impedanceCm = 2 * Math.PI * freq * lcm;
  const impedanceDm = 2 * Math.PI * freq * ldm;

  // Line current cancels in common mode, so only the leakage path carries it.
  const dmOperating = operatingPoint(core, metrics, 0, turns, lineCurrent * leakageFraction);
  const isat = saturationCurrent(core, metrics, 0, turns) / Math.max(leakageFraction, 1e-3);

  // Core loss comes from the leakage flux swinging at the *line* frequency.
  // Evaluating it at the noise frequency was wrong twice over: that current is
  // the thing being filtered out, not a current the winding carries, and it
  // extrapolates the Steinmetz fit far past where the material was measured.
  const coreLoss = coreLossDensity(core, lineFreq, dmOperating.b) * metrics.ve;

  const lossAt = (tempC: number) => {
    const winding = analyzeWinding({
      material: conductor,
      turns,
      awg,
      meanTurnLength: metrics.mlt,
      windowHeight: metrics.windowHeight,
      freq: lineFreq,
      tempC,
    });
    // Two windings, each carrying the line current, plus the core.
    return 2 * winding.rac * lineCurrent * lineCurrent + coreLoss;
  };

  const thermal = solveThermal(lossAt, metrics.surface, environment);
  const winding = analyzeWinding({
    material: conductor,
    turns,
    awg,
    meanTurnLength: metrics.mlt,
    windowHeight: metrics.windowHeight,
    freq: lineFreq,
    tempC: thermal.temperature,
  });
  const copperLoss = 2 * winding.rac * lineCurrent * lineCurrent;
  const occupied = winding.occupiedArea * 2;
  const fill = occupied / metrics.aw;
  const drop = lineCurrent * winding.rac;

  /** Insertion loss into a 50 Ω system, the way EMI filters are specified. */
  const insertionLoss = (impedance: number) =>
    20 * Math.log10(1 + impedance / (2 * 50));

  const out: Metric[] = [
    metric("lcm", "커먼모드 인덕턴스", lcm, si(lcm, "H"), "plain", { headline: true }),
    metric("zcm", "커먼모드 임피던스", impedanceCm, si(impedanceCm, "Ω"),
      impedanceCm > 1000 ? "good" : impedanceCm > 200 ? "warn" : "bad",
      { headline: true, hint: `${(freq / 1e6).toFixed(2)} MHz 기준` }),
    metric("atten", "삽입 감쇠", insertionLoss(impedanceCm), `${insertionLoss(impedanceCm).toFixed(1)} dB`,
      insertionLoss(impedanceCm) > 20 ? "good" : "warn", { headline: true }),
    metric("temp", "예상 온도", thermal.temperature, `${thermal.temperature.toFixed(0)} °C`,
      thermal.temperature > insulationClass ? "bad" : "good", { headline: true }),
    metric("ldm", "차동 인덕턴스 (누설)", ldm, si(ldm, "H"), "plain", {
      hint: "차동 노이즈도 조금 막아 주지만, 선로 전류로 포화하는 것도 이쪽입니다.",
    }),
    metric("zdm", "차동 임피던스", impedanceDm, si(impedanceDm, "Ω")),
    metric("isat", "차동 포화 전류", isat, si(isat, "A"),
      lineCurrent > isat ? "bad" : lineCurrent > isat * 0.8 ? "warn" : "good"),
    metric("bdm", "차동 자속밀도", dmOperating.b, `${dmOperating.b.toFixed(4)} T`),
    metric("rdc", "권선 저항 (1개)", winding.rac, si(winding.rac, "Ω")),
    metric("drop", "선로 전압 강하", drop, si(drop, "V")),
    metric("pcu", "구리손", copperLoss, si(copperLoss, "W")),
    metric("pfe", "철손", coreLoss, si(coreLoss, "W")),
    metric("fill", "창 점적률", fill, `${(fill * 100).toFixed(0)} %`,
      fill > 1 ? "bad" : fill > 0.4 ? "warn" : "good"),
    metric("mass", "총 중량", metrics.mass + winding.mass * 2,
      si(metrics.mass + winding.mass * 2, "kg")),
  ];

  const warnings: Warning[] = [
    ...windowWarnings(occupied, metrics, "두 권선"),
    ...thermalWarnings(thermal.temperature, core),
    ...insulationWarnings(values, thermal.temperature),
  ];
  if (lineCurrent > isat) {
    warnings.push({
      level: "error",
      text: `선로 전류 ${lineCurrent} A가 차동 포화 전류 ${isat.toFixed(1)} A를 넘습니다. 누설 자속이 코어를 포화시켜 커먼모드 성능이 무너집니다.`,
    });
  }
  if (impedanceCm < 200) {
    warnings.push({
      level: "warn",
      text: `${(freq / 1e6).toFixed(2)} MHz에서 임피던스가 ${impedanceCm.toFixed(0)} Ω뿐입니다. 턴수를 늘리거나 투자율이 더 높은 코어(나노결정)를 쓰세요.`,
    });
  }
  if (core.mur < 5000) {
    warnings.push({
      level: "info",
      text: `커먼모드 초크는 투자율이 곧 성능입니다. 지금 코어는 µr ${core.mur.toLocaleString()} — 나노결정(µr 30,000+)으로 바꾸면 같은 턴수로 임피던스가 몇 배가 됩니다.`,
    });
  }
  warnings.push(...applicationWarnings(values, out, dmOperating.saturationRatio));

  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= 48; i++) {
    // Sweep 10 kHz to 100 MHz on a log scale, the EMI band that matters.
    const f = 1e4 * Math.pow(10, (4 * i) / 48);
    points.push({ x: f / 1e6, y: insertionLoss(2 * Math.PI * f * lcm) });
  }
  const curves: Curve[] = [
    {
      key: "attenuation",
      title: "주파수에 따른 커먼모드 감쇠",
      xLabel: "주파수 [MHz]",
      yLabel: "감쇠 [dB]",
      points,
      marker: { x: freq / 1e6, label: "설계 주파수" },
    },
  ];

  const runtime: RuntimeSpec = {
    kind: "rl",
    drive: "current",
    supply: voltage,
    ratedCurrent: lineCurrent,
    resistance20: (winding.rdc * 2) / (1 + conductor.alphaT * (thermal.temperature - 20)),
    alphaT: conductor.alphaT,
    inductance: Math.max(ldm, 1e-9),
    fixedLoss: coreLoss,
    surface: metrics.surface,
    saturationCurrent: isat,
    parts: [
      windingPart(winding.mass * 2, insulationClass, conductor),
      corePart(core, metrics.mass),
      bobbinPart(metrics.mass * 0.05),
    ],
  };

  return {
    metrics: out,
    warnings,
    curves,
    runtime,
    build: {
      kind: "toroid",
      od,
      id: innerDiameter,
      height,
      coreColor: core.color,
      saturation: dmOperating.saturationRatio,
      windings: [
        { label: "선로 1", turns, wireDiameter: winding.insulatedDiameter * 1e3, color: conductor.color, share: 0.5 },
        { label: "선로 2", turns, wireDiameter: winding.insulatedDiameter * 1e3, color: 0xd0c060, share: 0.5 },
      ],
    },
  };
}
