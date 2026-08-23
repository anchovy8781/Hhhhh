/** 파워 인덕터 / 리액터 모델. */

import { coreLossDensity, coreMaterial, conductorMaterial } from "../materials";
import {
  coreMetrics,
  effectivePermeability,
  inductanceCurve,
  operatingPoint,
  saturationCurrent,
} from "../magnetics";
import { solveThermal } from "../thermal";
import { analyzeWinding } from "../wire";
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
  frequencyWarnings,
  saturationWarnings,
  thermalWarnings,
  toroidDims,
  windowWarnings,
} from "./shared";

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
        { value: "toroid", label: "토로이드", note: "누설 자속이 적고 효율이 좋습니다" },
        { value: "ei", label: "EI 코어", note: "감기 쉽고 공극을 넣기 편합니다" },
      ],
    },
    { kind: "number", key: "od", label: "외경 / 전체 폭", unit: "mm", min: 10, max: 200, step: 1, default: 27, group: "치수" },
    { kind: "number", key: "id", label: "내경 / 창 폭", unit: "mm", min: 3, max: 150, step: 1, default: 14, group: "치수" },
    { kind: "number", key: "height", label: "높이 / 적층", unit: "mm", min: 2, max: 120, step: 1, default: 11, group: "치수" },
    { kind: "number", key: "gap", label: "공극", unit: "mm", min: 0, max: 5, step: 0.05, default: 0, group: "치수", hint: "공극은 인덕턴스를 낮추는 대신 포화 전류를 크게 올립니다." },
    { kind: "number", key: "turns", label: "턴수", unit: "T", min: 1, max: 2000, step: 1, default: 26, group: "권선" },
    { kind: "number", key: "awg", label: "전선 굵기", unit: "AWG", min: 8, max: 40, step: 1, default: 18, group: "권선", hint: "숫자가 작을수록 굵습니다." },
    { kind: "number", key: "idc", label: "DC 전류", unit: "A", min: 0, max: 200, step: 0.1, default: 3, group: "운전" },
    { kind: "number", key: "ripple", label: "리플 (peak-peak)", unit: "%", min: 0, max: 200, step: 1, default: 30, group: "운전" },
    { kind: "number", key: "freq", label: "스위칭 주파수", unit: "Hz", min: 50, max: 2e6, step: 1, default: 100e3, group: "운전", log: true },
  ],
  simulate,
};

function simulate(values: ParamValues): DeviceResult {
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

  const dims =
    shape === "toroid"
      ? toroidDims(od, Math.min(id, od - 2), height)
      : eiDims(od / 3, height, Math.max(2, id / 2), od / 2);
  const metrics = coreMetrics(dims, core);

  const iRipple = (idc * ripplePct) / 100;
  const iPeak = idc + iRipple / 2;

  const op = operatingPoint(core, metrics, gap, turns, Math.max(iPeak, 1e-9));
  const opDc = operatingPoint(core, metrics, gap, turns, Math.max(idc, 1e-9));
  const l0 = operatingPoint(core, metrics, gap, turns, 0).inductance;
  const isat = saturationCurrent(core, metrics, gap, turns);

  // Only the AC swing drives core loss; the DC bias just eats saturation margin.
  const bAc =
    iRipple > 0
      ? Math.max(
          0,
          (op.b - operatingPoint(core, metrics, gap, turns, Math.max(idc - iRipple / 2, 0)).b) / 2,
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

  const thermal = solveThermal(lossAt, metrics.surface);
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
  const mue = effectivePermeability(core, metrics, gap);

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
      hint: gap > 0 ? "공극 때문에 재료 투자율보다 크게 낮아집니다." : undefined,
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

  const curveMax = Math.max(isat * 1.8, iPeak * 1.4, 0.1);
  const curves: Curve[] = [
    {
      key: "l-i",
      title: "전류에 따른 인덕턴스",
      xLabel: "전류 [A]",
      yLabel: "인덕턴스 [H]",
      points: inductanceCurve(core, metrics, gap, turns, curveMax, 48).map((p) => ({
        x: p.current,
        y: p.inductance,
      })),
      marker: { x: iPeak, label: "동작 피크" },
    },
  ];

  const wireDia = winding.insulatedDiameter * 1e3;
  const build =
    shape === "toroid"
      ? ({
          kind: "toroid" as const,
          od,
          id: Math.min(id, od - 2),
          height,
          coreColor: core.color,
          saturation: op.saturationRatio,
          windings: [
            { label: "권선", turns, wireDiameter: wireDia, color: conductor.color, share: 1 },
          ],
        })
      : ({
          kind: "ei" as const,
          tongue: od / 3,
          stack: height,
          windowWidth: Math.max(2, id / 2),
          windowHeight: od / 2,
          gap: num(values, "gap"),
          coreColor: core.color,
          saturation: op.saturationRatio,
          windings: [
            { label: "권선", turns, wireDiameter: wireDia, color: conductor.color, share: 1 },
          ],
        });

  return { metrics: out, warnings, curves, build };
}
