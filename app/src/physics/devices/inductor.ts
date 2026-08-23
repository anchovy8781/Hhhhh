/** 파워 인덕터 / 리액터 모델. */

import { coreLossDensity, coreMaterial, conductorMaterial } from "../materials";
import {
  coreMetrics,
  effectivePermeability,
  inductanceAtZero,
  inductanceCurve,
  operatingPoint,
  saturationCurrent,
} from "../magnetics";
import { solveThermal } from "../thermal";
import {
  currentDensity,
  meaningful,
  recommendAwg,
  wireReason,
  type Recommendation,
} from "../recommend";
import { environmentParams, readEnvironment } from "../environment";
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
  conductorParam,
  coreMaterialParam,
  eiDims,
  etdDims,
  potDims,
  rodDims,
  frequencyWarnings,
  saturationWarnings,
  thermalWarnings,
  toroidDims,
  windowWarnings,
  applicationWarnings,
  bobbinPart,
  corePart,
  insulationClassParam,
  insulationWarnings,
  windingPart,
} from "./shared";

/**
 * The three dimension sliders mean different things per shape, so this is the
 * one place that decides what "외경" is for a pot core versus a rod.
 */
function shapeDims(shape: string, od: number, id: number, height: number) {
  switch (shape) {
    case "ei":
      return eiDims(od / 3, height, Math.max(2, id / 2), od / 2);
    case "etd":
      return etdDims(od / 3, height, Math.max(2, id / 2), od / 2);
    case "pot":
      return potDims(od, height, Math.max(3, id));
    case "rod":
      return rodDims(od, height);
    default:
      return toroidDims(od, Math.min(id, od - 2), height);
  }
}

export const inductor: DeviceDefinition = {
  id: "inductor",
  name: "인덕터",
  tagline: "코어에 선을 감아 에너지를 자기장으로 저장합니다",
  icon: "◎",
  params: [
    coreMaterialParam("coreMaterial", "sendust-60"),
    conductorParam(),
    {
      kind: "choice",
      key: "shape",
      label: "코어 형상",
      group: "치수",
      default: "toroid",
      options: [
        { value: "toroid", label: "토로이드", note: "누설 자속이 적고 효율이 좋습니다. 감기가 까다롭습니다." },
        { value: "ei", label: "EI 코어", note: "감기 쉽고 공극을 넣기 편합니다. 상용 주파수의 기본 형상입니다." },
        { value: "etd", label: "ETD (원형 중앙다리)", note: "중앙 다리가 원형이라 한 턴이 가장 짧습니다. 구리손이 줄어듭니다." },
        { value: "pot", label: "포트 코어", note: "완전 차폐. 누설이 거의 없어 정밀 인덕터와 노이즈 민감 회로에 씁니다." },
        { value: "rod", label: "막대 코어 (개자로)", note: "자로가 열려 있어 실효 투자율이 크게 떨어집니다. 대신 포화가 거의 없습니다." },
      ],
    },
    { kind: "number", key: "od", label: "외경 / 전체 폭 / 중앙다리경", unit: "mm", min: 3, max: 200, step: 1, default: 27, group: "치수" },
    { kind: "number", key: "id", label: "내경 / 창 폭", unit: "mm", min: 3, max: 150, step: 1, default: 14, group: "치수" },
    { kind: "number", key: "height", label: "높이 / 적층 / 길이", unit: "mm", min: 2, max: 300, step: 1, default: 11, group: "치수" },
    { kind: "number", key: "gap", label: "공극", unit: "mm", min: 0, max: 5, step: 0.05, default: 0, group: "치수", hint: "공극은 인덕턴스를 낮추는 대신 포화 전류를 크게 올립니다." },
    { kind: "number", key: "turns", label: "턴수", unit: "T", min: 1, max: 2000, step: 1, default: 26, group: "권선" },
    { kind: "number", key: "awg", label: "전선 굵기", unit: "AWG", min: 8, max: 40, step: 1, default: 18, group: "권선", hint: "숫자가 작을수록 굵습니다." },
    { kind: "number", key: "idc", label: "DC 전류", unit: "A", min: 0, max: 200, step: 0.1, default: 3, group: "운전" },
    { kind: "number", key: "ripple", label: "리플 (peak-peak)", unit: "%", min: 0, max: 200, step: 1, default: 30, group: "운전", advanced: true },
    { kind: "number", key: "freq", label: "스위칭 주파수", unit: "Hz", min: 50, max: 2e6, step: 1, default: 100e3, group: "운전", log: true },
    { kind: "number", key: "busVoltage", label: "인가 전압 (버스)", unit: "V", min: 1, max: 1500, step: 1, default: 24, group: "운전", hint: "전원을 인가했을 때 전류가 얼마나 빨리 올라오는지를 정합니다.", advanced: true },
    { kind: "number", key: "targetL", label: "목표 인덕턴스", unit: "H", min: 1e-7, max: 1, step: 1e-7, default: 5e-5, group: "운전", log: true, hint: "여기에 필요한 값을 넣고 추천을 적용하면 턴수와 공극을 맞춰 줍니다." },
    insulationClassParam(),
    ...environmentParams(),
  ],
  simulate,
  recommend,
};

/**
 * Turns and gap for the inductance you asked for, at a current it survives.
 *
 * Turns follow from `L = N²·µ0·µe·Ae/le`, but turns alone will saturate the
 * core; the gap is what buys back the current headroom, so both are solved
 * together rather than one at a time.
 */
function recommend(values: ParamValues): Recommendation[] {
  const core = coreMaterial(str(values, "coreMaterial"));
  const conductor = conductorMaterial(str(values, "conductor"));
  const shape = str(values, "shape");
  const od = num(values, "od");
  const id = num(values, "id");
  const height = num(values, "height");
  const targetL = num(values, "targetL");
  const idc = num(values, "idc");
  const ripplePct = num(values, "ripple");
  const iPeak = idc * (1 + ripplePct / 200);
  const turns = Math.round(num(values, "turns"));
  const gap = num(values, "gap");

  const metrics = coreMetrics(shapeDims(shape, od, id, height), core);
  const out: Recommendation[] = [];

  // Pick the smallest gap that keeps the peak current under saturation, then
  // the turns that reach the target inductance with that gap.
  const bTarget = isFinite(core.bsat) ? core.bsat * 0.8 : 1;
  let bestGap = gap;
  let bestTurns = turns;
  for (const trialGap of [0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1.2, 1.8, 2.5, 3.5, 5]) {
    const trialTurns = Math.max(
      1,
      Math.round(
        Math.sqrt(targetL / Math.max(inductanceAtZero(core, metrics, trialGap * 1e-3, 1), 1e-18)),
      ),
    );
    const op = operatingPoint(core, metrics, trialGap * 1e-3, trialTurns, Math.max(iPeak, 1e-9));
    if (!isFinite(core.bsat) || op.b <= bTarget) {
      bestGap = trialGap;
      bestTurns = trialTurns;
      break;
    }
    bestGap = trialGap;
    bestTurns = trialTurns;
  }

  if (meaningful(turns, bestTurns, 0.03)) {
    out.push({
      key: "turns",
      value: bestTurns,
      label: `턴수 ${turns} → ${bestTurns}`,
      reason: `${si(targetL, "H")}를 이 코어에서 얻으려면 N = √(L/AL) 입니다. 인덕턴스는 턴수의 제곱에 비례합니다.`,
    });
  }
  if (Math.abs(bestGap - gap) > 0.04) {
    out.push({
      key: "gap",
      value: bestGap,
      label: `공극 ${gap} → ${bestGap} mm`,
      reason:
        bestGap > gap
          ? `피크 ${iPeak.toFixed(2)}A에서 자속을 ${bTarget.toFixed(2)}T 아래로 유지하려면 공극이 필요합니다. 인덕턴스는 줄지만 포화 전류가 크게 늘어납니다.`
          : `지금 공극은 필요 이상입니다. 줄이면 같은 인덕턴스를 더 적은 턴수로 얻습니다.`,
    });
  }

  const density = currentDensity(iPeak * num(values, "busVoltage"));
  const awg = recommendAwg(iPeak, density);
  if (Math.abs(awg - Math.round(num(values, "awg"))) >= 1) {
    out.push({
      key: "awg",
      value: awg,
      label: `전선 AWG${Math.round(num(values, "awg"))} → AWG${awg}`,
      reason: wireReason(awg, iPeak, density),
    });
  }
  if (conductor.acFactorCap === Infinity && num(values, "freq") > 300e3) {
    out.push({
      key: "conductor",
      value: "litz-38-100",
      label: "권선 재료 → 리츠선 100가닥 × AWG38",
      reason: `${(num(values, "freq") / 1e3).toFixed(0)}kHz에서는 단선의 표피효과가 커집니다. 리츠선이 AC 저항을 크게 낮춥니다.`,
    });
  }
  return out;
}

function simulate(values: ParamValues): DeviceResult {
  const environment = readEnvironment(values);
  const insulationClass = Number(values["insulationClass"]) || 155;
  const core = coreMaterial(str(values, "coreMaterial"));
  const conductor = conductorMaterial(str(values, "conductor"));
  const shape = str(values, "shape");
  const od = num(values, "od");
  const id = num(values, "id");
  const height = num(values, "height");
  const gap = num(values, "gap") * 1e-3;
  const turns = Math.round(num(values, "turns"));
  const awg = Math.round(num(values, "awg"));
  const idc = num(values, "idc");
  const ripplePct = num(values, "ripple");
  const freq = num(values, "freq");

  const dims = shapeDims(shape, od, id, height);
  const metrics = coreMetrics(dims, core);
  // An open core carries its own gap; the user's gap adds to it.
  const gapTotal = gap + metrics.intrinsicGap;

  const iRipple = (idc * ripplePct) / 100;
  const iPeak = idc + iRipple / 2;

  const op = operatingPoint(core, metrics, gapTotal, turns, Math.max(iPeak, 1e-9));
  const opDc = operatingPoint(core, metrics, gapTotal, turns, Math.max(idc, 1e-9));
  const l0 = operatingPoint(core, metrics, gapTotal, turns, 0).inductance;
  const isat = saturationCurrent(core, metrics, gapTotal, turns);

  // Only the AC swing drives core loss; the DC bias just eats saturation margin.
  const bAc =
    iRipple > 0
      ? Math.max(
          0,
          (op.b - operatingPoint(core, metrics, gapTotal, turns, Math.max(idc - iRipple / 2, 0)).b) / 2,
        )
      : 0;

  const lossAt = (tempC: number) => {
    const winding = analyzeWinding({
      material: conductor,
      turns,
      awg,
      meanTurnLength: metrics.mlt,
      windowHeight: metrics.windowHeight,
      freq,
      tempC,
    });
    const irms = Math.sqrt(idc * idc + (iRipple * iRipple) / 12);
    const copper = winding.rdc * idc * idc + (winding.rac - winding.rdc) * (irms * irms - idc * idc);
    const iron = coreLossDensity(core, freq, bAc) * metrics.ve;
    return copper + iron;
  };

  const thermal = solveThermal(lossAt, metrics.surface, environment);
  const winding = analyzeWinding({
    material: conductor,
    turns,
    awg,
    meanTurnLength: metrics.mlt,
    windowHeight: metrics.windowHeight,
    freq,
    tempC: thermal.temperature,
  });
  const irms = Math.sqrt(idc * idc + (iRipple * iRipple) / 12);
  const copperLoss =
    winding.rdc * idc * idc + (winding.rac - winding.rdc) * (irms * irms - idc * idc);
  const coreLoss = coreLossDensity(core, freq, bAc) * metrics.ve;
  const totalLoss = copperLoss + coreLoss;
  const energy = 0.5 * op.incremental * iPeak * iPeak;
  const fill = winding.occupiedArea / metrics.aw;
  const mue = effectivePermeability(core, metrics, gapTotal);

  const out: Metric[] = [
    metric("L", "인덕턴스 (동작점)", op.inductance, si(op.inductance, "H"), "plain", { headline: true }),
    metric("L0", "인덕턴스 (무부하)", l0, si(l0, "H"), "plain", {
      hint: "전류가 0일 때의 값. 동작점 값과 차이가 크면 이미 포화가 시작된 것입니다.",
    }),
    metric("isat", "포화 전류 (L −30%)", isat, si(isat, "A"),
      iPeak > isat ? "bad" : iPeak > isat * 0.8 ? "warn" : "good", { headline: true }),
    metric("bpeak", "최대 자속밀도", op.b, `${op.b.toFixed(3)} T`,
      op.saturationRatio > 0.9 ? "bad" : op.saturationRatio > 0.7 ? "warn" : "good", {
        hint: `${core.name}의 포화점은 ${isFinite(core.bsat) ? `${core.bsat} T` : "없음"}입니다.`,
      }),
    metric("loss", "총 손실", totalLoss, si(totalLoss, "W"), "plain", { headline: true }),
    metric("temp", "예상 온도", thermal.temperature, `${thermal.temperature.toFixed(0)} °C`,
      thermal.temperature > core.maxTemp ? "bad" : thermal.temperature > core.maxTemp * 0.8 ? "warn" : "good",
      { headline: true }),
    metric("pcu", "구리손", copperLoss, si(copperLoss, "W")),
    metric("pfe", "철손", coreLoss, si(coreLoss, "W")),
    metric("rdc", "DC 저항", winding.rdc, si(winding.rdc, "Ω")),
    metric("rac", "AC 저항", winding.rac, si(winding.rac, "Ω"), "plain", {
      hint: `표피·근접 효과로 DC 대비 ${winding.acFactor.toFixed(2)}배`,
    }),
    metric("energy", "저장 에너지", energy, si(energy, "J")),
    metric("mue", "실효 투자율", mue, mue.toFixed(0), "plain", {
      hint:
        metrics.intrinsicGap > 0
          ? `자로가 열려 있어 재료 투자율 ${core.mur.toLocaleString()}이 실효 ${mue.toFixed(0)}로 떨어집니다. 반자계가 대부분의 기자력을 가져갑니다.`
          : gap > 0
            ? "공극 때문에 재료 투자율보다 크게 낮아집니다."
            : undefined,
    }),
    metric("fill", "창 점적률", fill, `${(fill * 100).toFixed(0)} %`,
      fill > 1 ? "bad" : fill > 0.4 ? "warn" : "good"),
    metric("layers", "권선 층수", winding.layers, `${winding.layers} 층`),
    metric("wire", "전선 길이", winding.length, si(winding.length, "m")),
    metric("mass", "총 중량", metrics.mass + winding.mass, si(metrics.mass + winding.mass, "kg")),
    metric("cost", "재료비 지수", metrics.mass * core.cost + winding.mass * conductor.cost,
      (metrics.mass * core.cost + winding.mass * conductor.cost).toFixed(3), "plain",
      { hint: "구리 1kg = 1.0 기준의 상대 지수입니다." }),
  ];

  const warnings: Warning[] = [
    ...saturationWarnings(op.saturationRatio, "인덕터"),
    ...windowWarnings(winding.occupiedArea, metrics),
    ...frequencyWarnings(core, freq),
    ...thermalWarnings(thermal.temperature, core),
  ];
  if (iPeak > isat) {
    warnings.push({
      level: "error",
      text: `피크 전류 ${iPeak.toFixed(2)} A가 포화 전류 ${isat.toFixed(2)} A를 넘습니다. 공극을 넣거나 턴수를 줄이세요.`,
    });
  }
  if (gap === 0 && core.knee >= 5 && idc > 0 && opDc.saturationRatio > 0.5) {
    warnings.push({
      level: "info",
      text: "공극 없는 페라이트/강판 코어에 DC를 흘리고 있습니다. 0.2~1mm 공극이 포화 전류를 몇 배로 올립니다.",
    });
  }

  warnings.push(
    ...insulationWarnings(values, thermal.temperature),
    ...applicationWarnings(values, out, op.saturationRatio),
  );

  const curveMax = Math.max(isat * 1.8, iPeak * 1.4, 0.1);
  const curves: Curve[] = [
    {
      key: "l-i",
      title: "전류에 따른 인덕턴스",
      xLabel: "전류 [A]",
      yLabel: "인덕턴스 [H]",
      points: inductanceCurve(core, metrics, gapTotal, turns, curveMax, 48).map((p) => ({
        x: p.current,
        y: p.inductance,
      })),
      marker: { x: iPeak, label: "동작 피크" },
    },
  ];

  const wireDia = winding.insulatedDiameter * 1e3;
  const coil = {
    label: "권선",
    turns,
    wireDiameter: wireDia,
    color: conductor.color,
    share: 1,
  };
  const specialBuild =
    shape === "pot" || shape === "rod"
      ? shape === "pot"
        ? ({
            kind: "pot" as const,
            outerDiameter: od,
            height,
            legDiameter: Math.max(3, Math.min(id, od * 0.6)),
            gap: num(values, "gap"),
            coreColor: core.color,
            saturation: op.saturationRatio,
            windings: [coil],
          })
        : ({
            kind: "rod" as const,
            diameter: od,
            length: height,
            coreColor: core.color,
            saturation: op.saturationRatio,
            windings: [coil],
          })
      : null;

  const closedBuild =
    shape === "toroid"
      ? ({
          kind: "toroid" as const,
          od,
          id: Math.min(id, od - 2),
          height,
          coreColor: core.color,
          saturation: op.saturationRatio,
          windings: [coil],
        })
      : ({
          kind: "ei" as const,
          tongue: od / 3,
          stack: height,
          windowWidth: Math.max(2, id / 2),
          windowHeight: od / 2,
          gap: num(values, "gap"),
          roundLeg: shape === "etd",
          coreColor: core.color,
          saturation: op.saturationRatio,
          windings: [coil],
        });
  const build = specialBuild ?? closedBuild;

  const runtime: RuntimeSpec = {
    kind: "rl",
    // An inductor lives inside a converter that holds the current, so extra
    // resistance from heating becomes heat, not less current.
    drive: "current",
    supply: num(values, "busVoltage"),
    ratedCurrent: iPeak,
    resistance20: winding.rdc / (1 + conductor.alphaT * (thermal.temperature - 20)),
    alphaT: conductor.alphaT,
    inductance: Math.max(op.inductance, 1e-9),
    fixedLoss: coreLoss,
    surface: metrics.surface,
    saturationCurrent: isat,
    parts: [
      windingPart(winding.mass, insulationClass, conductor),
      corePart(core, metrics.mass),
      bobbinPart(metrics.mass * 0.05),
    ],
  };

  return { metrics: out, warnings, curves, build, runtime };
}
