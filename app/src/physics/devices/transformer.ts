/** 변압기 모델 (EI 적층 / 토로이드). */

import { coreLossDensity, coreMaterial, conductorMaterial } from "../materials";
import { coreMetrics, inductanceAtZero } from "../magnetics";
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

export const transformer: DeviceDefinition = {
  id: "transformer",
  name: "변압기",
  tagline: "1차 권선의 자속으로 2차 권선에 전압을 유도합니다",
  icon: "⧉",
  params: [
    coreMaterialParam("coreMaterial", "silicon-steel-m19"),
    conductorParam(),
    {
      kind: "choice",
      key: "shape",
      label: "코어 형상",
      group: "치수",
      default: "ei",
      options: [
        { value: "ei", label: "EI 적층", note: "상용 주파수 변압기의 표준 형상" },
        { value: "toroid", label: "토로이드", note: "누설과 소음이 적습니다" },
      ],
    },
    { kind: "number", key: "tongue", label: "중앙 다리 폭 / 외경", unit: "mm", min: 5, max: 200, step: 1, default: 32, group: "치수" },
    { kind: "number", key: "stack", label: "적층 두께 / 높이", unit: "mm", min: 5, max: 200, step: 1, default: 38, group: "치수" },
    { kind: "number", key: "windowWidth", label: "창 폭 / 내경", unit: "mm", min: 3, max: 150, step: 1, default: 16, group: "치수" },
    { kind: "number", key: "windowHeight", label: "창 높이", unit: "mm", min: 5, max: 200, step: 1, default: 48, group: "치수" },
    { kind: "number", key: "np", label: "1차 턴수", unit: "T", min: 1, max: 5000, step: 1, default: 480, group: "권선" },
    { kind: "number", key: "ns", label: "2차 턴수", unit: "T", min: 1, max: 5000, step: 1, default: 52, group: "권선" },
    { kind: "number", key: "awgP", label: "1차 전선", unit: "AWG", min: 8, max: 40, step: 1, default: 24, group: "권선" },
    { kind: "number", key: "awgS", label: "2차 전선", unit: "AWG", min: 8, max: 40, step: 1, default: 18, group: "권선" },
    { kind: "number", key: "vin", label: "입력 전압 (rms)", unit: "V", min: 1, max: 1000, step: 1, default: 220, group: "운전" },
    { kind: "number", key: "freq", label: "주파수", unit: "Hz", min: 16, max: 1e6, step: 1, default: 60, group: "운전", log: true },
    { kind: "number", key: "pout", label: "출력 전력", unit: "W", min: 0, max: 5000, step: 1, default: 100, group: "운전" },
    {
      kind: "choice",
      key: "waveform",
      label: "파형",
      group: "운전",
      default: "sine",
      options: [
        { value: "sine", label: "정현파", note: "상용 전원" },
        { value: "square", label: "구형파", note: "SMPS 브리지 구동" },
      ],
    },
  ],
  simulate,
};

function simulate(values: ParamValues): DeviceResult {
  const core = coreMaterial(str(values, "coreMaterial"));
  const conductor = conductorMaterial(str(values, "conductor"));
  const shape = str(values, "shape");
  const tongue = num(values, "tongue");
  const stack = num(values, "stack");
  const windowWidth = num(values, "windowWidth");
  const windowHeight = num(values, "windowHeight");
  const np = Math.round(num(values, "np"));
  const ns = Math.round(num(values, "ns"));
  const awgP = Math.round(num(values, "awgP"));
  const awgS = Math.round(num(values, "awgS"));
  const vin = num(values, "vin");
  const freq = num(values, "freq");
  const pout = num(values, "pout");
  const square = str(values, "waveform") === "square";

  const dims =
    shape === "ei"
      ? eiDims(tongue, stack, windowWidth, windowHeight)
      : toroidDims(tongue, Math.max(3, windowWidth), stack);
  const metrics = coreMetrics(dims, core);

  // Faraday's law: the core flux is set by volts per turn, not by the load.
  // Sine: V = 4.44*f*N*Ae*B. Square wave at 50 % duty: V = 4*f*N*Ae*B.
  const formFactor = square ? 4 : 4.44;
  const bPeak = vin / (formFactor * freq * np * metrics.ae);
  const ratio = np / ns;
  const voutIdeal = vin / ratio;

  const primary = (tempC: number) =>
    analyzeWinding({
      material: conductor,
      turns: np,
      awg: awgP,
      meanTurnLength: metrics.mlt,
      windowHeight: metrics.windowHeight,
      freq,
      tempC,
    });
  const secondary = (tempC: number) =>
    analyzeWinding({
      material: conductor,
      turns: ns,
      awg: awgS,
      meanTurnLength: metrics.mlt * 1.15, // 바깥쪽 권선이라 한 턴이 더 깁니다
      windowHeight: metrics.windowHeight,
      freq,
      tempC,
    });

  const ironLoss = coreLossDensity(core, freq, bPeak) * metrics.ve;

  const lossAt = (tempC: number) => {
    const p = primary(tempC);
    const s = secondary(tempC);
    // Refer the secondary resistance to the primary and solve for the current
    // the load actually demands, including the copper drop it causes.
    const rTotal = p.rac + s.rac * ratio * ratio;
    const iSec = pout > 0 ? pout / Math.max(voutIdeal, 1e-6) : 0;
    const iPri = iSec / ratio;
    return iPri * iPri * rTotal + ironLoss;
  };

  const thermal = solveThermal(lossAt, metrics.surface);
  const p = primary(thermal.temperature);
  const s = secondary(thermal.temperature);
  const iSec = pout > 0 ? pout / Math.max(voutIdeal, 1e-6) : 0;
  const iPri = iSec / ratio;
  const copperLoss = iPri * iPri * (p.rac + s.rac * ratio * ratio);
  const totalLoss = copperLoss + ironLoss;
  const vdrop = iSec * s.rac + iPri * p.rac / ratio;
  const voutLoaded = Math.max(0, voutIdeal - vdrop);
  const regulation = voutIdeal > 0 ? (voutIdeal - voutLoaded) / voutIdeal : 0;
  const efficiency = pout > 0 ? pout / (pout + totalLoss) : 0;

  const lm = inductanceAtZero(core, metrics, 0, np);
  const imag = vin / (2 * Math.PI * freq * Math.max(lm, 1e-12));
  const saturationRatio = isFinite(core.bsat) ? bPeak / core.bsat : 0;
  const occupied = p.occupiedArea + s.occupiedArea;
  const fill = occupied / metrics.aw;

  const out: Metric[] = [
    metric("ratio", "권수비", ratio, `${ratio.toFixed(2)} : 1`, "plain", { headline: true }),
    metric("vout", "출력 전압 (부하시)", voutLoaded, `${voutLoaded.toFixed(1)} V`, "plain", {
      headline: true,
      hint: `무부하 ${voutIdeal.toFixed(1)} V`,
    }),
    metric("eff", "효율", efficiency, `${(efficiency * 100).toFixed(1)} %`,
      efficiency > 0.95 ? "good" : efficiency > 0.85 ? "warn" : "bad", { headline: true }),
    metric("bpeak", "최대 자속밀도", bPeak, `${bPeak.toFixed(3)} T`,
      saturationRatio > 0.95 ? "bad" : saturationRatio > 0.8 ? "warn" : "good", {
        headline: true,
        hint: "부하가 아니라 입력 전압·주파수·턴수가 결정합니다.",
      }),
    metric("temp", "예상 온도", thermal.temperature, `${thermal.temperature.toFixed(0)} °C`,
      thermal.temperature > core.maxTemp ? "bad" : thermal.temperature > core.maxTemp * 0.8 ? "warn" : "good"),
    metric("reg", "전압 변동률", regulation, `${(regulation * 100).toFixed(1)} %`,
      regulation < 0.05 ? "good" : regulation < 0.15 ? "warn" : "bad"),
    metric("pcu", "구리손", copperLoss, si(copperLoss, "W")),
    metric("pfe", "철손", ironLoss, si(ironLoss, "W"), "plain", {
      hint: "무부하에서도 계속 소비됩니다.",
    }),
    metric("ipri", "1차 전류", iPri, si(iPri, "A")),
    metric("isec", "2차 전류", iSec, si(iSec, "A")),
    metric("imag", "여자 전류", imag, si(imag, "A"), imag > iPri * 0.5 && pout > 0 ? "warn" : "plain", {
      hint: "1차 전류 대비 크면 코어가 너무 작거나 턴수가 부족합니다.",
    }),
    metric("lm", "자화 인덕턴스", lm, si(lm, "H")),
    metric("vpt", "턴당 전압", vin / np, si(vin / np, "V")),
    metric("rp", "1차 저항", p.rac, si(p.rac, "Ω")),
    metric("rs", "2차 저항", s.rac, si(s.rac, "Ω")),
    metric("fill", "창 점적률", fill, `${(fill * 100).toFixed(0)} %`,
      fill > 1 ? "bad" : fill > 0.4 ? "warn" : "good"),
    metric("mass", "총 중량", metrics.mass + p.mass + s.mass, si(metrics.mass + p.mass + s.mass, "kg")),
    metric("cost", "재료비 지수", metrics.mass * core.cost + (p.mass + s.mass) * conductor.cost,
      (metrics.mass * core.cost + (p.mass + s.mass) * conductor.cost).toFixed(3)),
  ];

  const warnings: Warning[] = [
    ...saturationWarnings(saturationRatio, "변압기 코어"),
    ...windowWarnings(occupied, metrics, "1·2차 권선"),
    ...frequencyWarnings(core, freq),
    ...thermalWarnings(thermal.temperature, core),
  ];
  if (saturationRatio > 1) {
    const minTurns = Math.ceil(vin / (formFactor * freq * metrics.ae * core.bsat));
    warnings.push({
      level: "error",
      text: `이 전압·주파수에서는 1차 턴수가 최소 ${minTurns}턴 필요합니다. 지금은 ${np}턴입니다.`,
    });
  }
  if (efficiency > 0 && efficiency < 0.8 && pout > 0) {
    warnings.push({
      level: "warn",
      text: `효율 ${(efficiency * 100).toFixed(0)}%. 구리손 ${copperLoss.toFixed(1)}W vs 철손 ${ironLoss.toFixed(1)}W — 큰 쪽을 먼저 줄이세요.`,
    });
  }

  const curves: Curve[] = [];
  if (pout > 0) {
    const points: { x: number; y: number }[] = [];
    for (let i = 1; i <= 40; i++) {
      const load = (pout * 2 * i) / 40;
      const is = load / Math.max(voutIdeal, 1e-6);
      const ip = is / ratio;
      const cu = ip * ip * (p.rac + s.rac * ratio * ratio);
      points.push({ x: load, y: load / (load + cu + ironLoss) });
    }
    curves.push({
      key: "eff",
      title: "부하에 따른 효율",
      xLabel: "출력 [W]",
      yLabel: "효율",
      points,
      marker: { x: pout, label: "설계점" },
    });
  }

  const shareP = p.occupiedArea / Math.max(occupied, 1e-12);
  const windings = [
    { label: "1차", turns: np, wireDiameter: p.insulatedDiameter * 1e3, color: conductor.color, share: shareP },
    { label: "2차", turns: ns, wireDiameter: s.insulatedDiameter * 1e3, color: 0xd0c060, share: 1 - shareP },
  ];

  const build =
    shape === "ei"
      ? ({
          kind: "ei" as const,
          tongue,
          stack,
          windowWidth,
          windowHeight,
          gap: 0,
          coreColor: core.color,
          saturation: saturationRatio,
          windings,
        })
      : ({
          kind: "toroid" as const,
          od: tongue,
          id: Math.max(3, windowWidth),
          height: stack,
          coreColor: core.color,
          saturation: saturationRatio,
          windings,
        });

  return { metrics: out, warnings, curves, build };
}
