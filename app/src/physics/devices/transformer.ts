/** 변압기 모델 (EI 적층 / 토로이드). */

import { coreLossDensity, coreMaterial, conductorMaterial } from "../materials";
import { coreMetrics, inductanceAtZero, mmfFor } from "../magnetics";
import {
  areaProduct,
  currentDensity,
  meaningful,
  recommendAwg,
  turnsForVoltage,
  wireReason,
  type Recommendation,
} from "../recommend";
import { solveThermal } from "../thermal";
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

export const transformer: DeviceDefinition = {
  id: "transformer",
  name: "변압기",
  tagline: "1차 권선의 자속으로 2차 권선에 전압을 유도합니다",
  icon: "⧉",
  params: [
    coreMaterialParam("coreMaterial", "steel-m19-035"),
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
    { kind: "number", key: "windowWidth", label: "창 폭 / 내경", unit: "mm", min: 3, max: 150, step: 1, default: 16, group: "치수", advanced: true },
    { kind: "number", key: "windowHeight", label: "창 높이", unit: "mm", min: 5, max: 200, step: 1, default: 48, group: "치수", advanced: true },
    { kind: "number", key: "np", label: "1차 턴수", unit: "T", min: 1, max: 5000, step: 1, default: 480, group: "권선" },
    { kind: "number", key: "ns", label: "2차 턴수", unit: "T", min: 1, max: 5000, step: 1, default: 52, group: "권선" },
    { kind: "number", key: "awgP", label: "1차 전선", unit: "AWG", min: 8, max: 40, step: 1, default: 24, group: "권선" },
    { kind: "number", key: "awgS", label: "2차 전선", unit: "AWG", min: 8, max: 40, step: 1, default: 18, group: "권선" },
    { kind: "number", key: "vin", label: "입력 전압 (rms)", unit: "V", min: 1, max: 40000, step: 1, default: 220, group: "운전", log: true },
    { kind: "number", key: "voutTarget", label: "목표 출력 전압", unit: "V", min: 1, max: 40000, step: 1, default: 24, group: "운전", log: true, hint: "여기에 원하는 출력 전압을 넣고 추천값을 적용하면 2차 턴수를 맞춰 줍니다." },
    { kind: "number", key: "freq", label: "주파수", unit: "Hz", min: 16, max: 1e6, step: 1, default: 60, group: "운전", log: true },
    { kind: "number", key: "kva", label: "용량", unit: "kVA", min: 0.001, max: 2000, step: 0.001, default: 0.1, group: "운전", log: true, hint: "피상 전력. 실제 유효 전력은 여기에 역률을 곱한 값입니다." },
    { kind: "number", key: "pf", label: "부하 역률", unit: "", min: 0.3, max: 1, step: 0.01, default: 1, group: "운전", hint: "1이면 순저항 부하. 낮을수록 같은 유효 전력에 더 큰 전류가 흐릅니다.", advanced: true },
    {
      kind: "choice",
      key: "phases",
      label: "상 · 결선",
      group: "운전",
      default: "single",
      options: [
        { value: "single", label: "단상", note: "입력 전압이 곧 권선 전압입니다." },
        { value: "wye", label: "3상 Y (성형)", note: "권선 전압은 선간 전압의 1/√3. 중성점을 쓸 수 있습니다." },
        { value: "delta", label: "3상 Δ (삼각)", note: "권선 전압이 선간 전압과 같아 턴수가 √3배 필요합니다." },
      ],
      hint: "3상은 같은 철심으로 훨씬 큰 용량을 냅니다. 다리가 3개인 코어를 씁니다.",
    },
    {
      kind: "choice",
      key: "waveform",
      label: "파형",
      group: "운전",
      default: "sine",
      advanced: true,
      options: [
        { value: "sine", label: "정현파", note: "상용 전원" },
        { value: "square", label: "구형파", note: "SMPS 브리지 구동" },
      ],
    },
    insulationClassParam(),
    ...environmentParams(),
  ],
  simulate,
  recommend,
};

/**
 * Work the transformer design equations backwards from what the user knows:
 * the voltages, the frequency and the load.
 */
function recommend(values: ParamValues): Recommendation[] {
  const core = coreMaterial(str(values, "coreMaterial"));
  const shape = str(values, "shape");
  const vin = num(values, "vin");
  const voutTarget = num(values, "voutTarget");
  const freq = num(values, "freq");
  const apparent = num(values, "kva") * 1000;
  const square = str(values, "waveform") === "square";
  const formFactor = square ? 4 : 4.44;
  const np = Math.round(num(values, "np"));
  const density = currentDensity(apparent);

  const dims =
    shape === "ei"
      ? eiDims(
          num(values, "tongue"),
          num(values, "stack"),
          num(values, "windowWidth"),
          num(values, "windowHeight"),
        )
      : toroidDims(num(values, "tongue"), Math.max(3, num(values, "windowWidth")), num(values, "stack"));
  const metrics = coreMetrics(dims, core);

  // Leave a fifth of the saturation flux as headroom for supply overvoltage
  // and for the flux doubling that energising causes.
  const targetB = core.bsat * 0.8;
  const out: Recommendation[] = [];

  const connection = str(values, "phases");
  const legVoltage = vin * (connection === "wye" ? 1 / Math.sqrt(3) : 1);
  const suggestedNp = turnsForVoltage(legVoltage, freq, metrics.ae, targetB, formFactor);
  if (meaningful(np, suggestedNp)) {
    out.push({
      key: "np",
      value: suggestedNp,
      label: `1차 턴수 ${np} → ${suggestedNp}`,
      reason: `${connection === "wye" ? `선간 ${vin}V의 상전압 ${legVoltage.toFixed(0)}V` : `${vin}V`}·${freq}Hz에서 이 코어(Ae ${(metrics.ae * 1e6).toFixed(0)}mm²)를 ${targetB.toFixed(2)}T로 쓰려면 N = V/(${formFactor}·f·Ae·B) 입니다.`,
    });
  }

  const base = out.length ? suggestedNp : np;
  const suggestedNs = Math.max(1, Math.round((base * voutTarget) / Math.max(vin, 1e-9) * 1.03));
  if (meaningful(Math.round(num(values, "ns")), suggestedNs, 0.02)) {
    out.push({
      key: "ns",
      value: suggestedNs,
      label: `2차 턴수 ${Math.round(num(values, "ns"))} → ${suggestedNs}`,
      reason: `${vin}V에서 ${voutTarget}V를 뽑는 권수비에 부하 강하 3%를 더한 값입니다.`,
    });
  }

  const legs = connection === "single" ? 1 : 3;
  const iPri = apparent / legs / Math.max(legVoltage, 1e-9);
  const iSec =
    apparent / legs / Math.max(voutTarget * (connection === "wye" ? 1 / Math.sqrt(3) : 1), 1e-9);
  for (const [key, current, label] of [
    ["awgP", iPri, "1차 전선"],
    ["awgS", iSec, "2차 전선"],
  ] as [string, number, string][]) {
    const awg = recommendAwg(current, density);
    if (Math.abs(awg - Math.round(num(values, key))) >= 1) {
      out.push({
        key,
        value: awg,
        label: `${label} AWG${Math.round(num(values, key))} → AWG${awg}`,
        reason: wireReason(awg, current, density),
      });
    }
  }

  // Does the core have room for the copper this job needs?
  const needed = areaProduct(apparent, freq, targetB, density, 0.35, formFactor);
  const available = metrics.ae * metrics.aw;
  if (needed > available * 1.15 && shape === "ei") {
    const scale = Math.pow(needed / available, 0.25);
    out.push({
      key: "tongue",
      value: Math.round(num(values, "tongue") * scale),
      label: `중앙 다리 폭 ${num(values, "tongue")} → ${Math.round(num(values, "tongue") * scale)} mm`,
      reason: `${(apparent / 1000).toFixed(3)}kVA에는 면적곱 Ap ${(needed * 1e12).toFixed(0)}mm⁴가 필요한데 지금 코어는 ${(available * 1e12).toFixed(0)}mm⁴뿐입니다. 모든 치수를 ${scale.toFixed(2)}배로 키우세요.`,
    });
    for (const key of ["stack", "windowWidth", "windowHeight"]) {
      out.push({
        key,
        value: Math.round(num(values, key) * scale),
        label: `${key === "stack" ? "적층 두께" : key === "windowWidth" ? "창 폭" : "창 높이"} ${num(values, key)} → ${Math.round(num(values, key) * scale)} mm`,
        reason: "코어 전체를 같은 비율로 키워야 자로와 창이 균형을 유지합니다.",
      });
    }
  }

  return out;
}

function simulate(values: ParamValues): DeviceResult {
  const environment = readEnvironment(values);
  const insulationClass = Number(values["insulationClass"]) || 155;
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
  const kva = num(values, "kva");
  const powerFactor = num(values, "pf");
  const apparent = kva * 1000;
  const pout = apparent * powerFactor;
  const square = str(values, "waveform") === "square";
  const phases = str(values, "phases");
  const threePhase = phases !== "single";
  // What the winding itself sees: a wye winding sits across phase voltage,
  // a delta winding across the full line voltage.
  const windingRatio = phases === "wye" ? 1 / Math.sqrt(3) : 1;
  const legs = threePhase ? 3 : 1;

  const dims =
    shape === "ei"
      ? eiDims(tongue, stack, windowWidth, windowHeight)
      : toroidDims(tongue, Math.max(3, windowWidth), stack);
  const metrics = coreMetrics(dims, core);

  // Faraday's law: the core flux is set by volts per turn, not by the load.
  // Sine: V = 4.44*f*N*Ae*B. Square wave at 50 % duty: V = 4*f*N*Ae*B.
  const formFactor = square ? 4 : 4.44;
  const windingVoltage = vin * windingRatio;
  const bPeak = windingVoltage / (formFactor * freq * np * metrics.ae);
  const ratio = np / ns;
  // The secondary is wound the same way as the primary, so the connection
  // factor cancels and the line-to-line ratio is just the turns ratio.
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
    // Winding heat follows the apparent power: reactive current is still current.
    // Three-phase apparent power splits over three legs, and each leg's
    // current follows its own winding voltage.
    const perLeg = apparent / legs;
    const iSec = perLeg > 0 ? perLeg / Math.max(voutIdeal * windingRatio, 1e-6) : 0;
    const iPri = iSec / ratio;
    return legs * (iPri * iPri * rTotal) + ironLoss * legs;
  };

  const thermal = solveThermal(lossAt, metrics.surface, environment);
  const p = primary(thermal.temperature);
  const s = secondary(thermal.temperature);
  const perLeg = apparent / legs;
  const iSec = perLeg > 0 ? perLeg / Math.max(voutIdeal * windingRatio, 1e-6) : 0;
  const iPri = iSec / ratio;
  const copperLoss = legs * iPri * iPri * (p.rac + s.rac * ratio * ratio);
  const ironTotal = ironLoss * legs;
  const totalLoss = copperLoss + ironTotal;
  const vdrop = iSec * s.rac + iPri * p.rac / ratio;
  const voutLoaded = Math.max(0, voutIdeal - vdrop / Math.max(windingRatio, 1e-9));
  const regulation = voutIdeal > 0 ? (voutIdeal - voutLoaded) / voutIdeal : 0;
  const efficiency = pout > 0 ? pout / (pout + totalLoss) : 0;

  const lm = inductanceAtZero(core, metrics, 0, np);
  const imag = vin / (2 * Math.PI * freq * Math.max(lm, 1e-12));
  const saturationRatio = isFinite(core.bsat) ? bPeak / core.bsat : 0;
  const occupied = p.occupiedArea + s.occupiedArea;
  const fill = occupied / metrics.aw;

  const out: Metric[] = [
    metric("ratio", "권수비", ratio, `${ratio.toFixed(2)} : 1`, "plain", { headline: true }),
    metric("kva", "용량", apparent, si(apparent, "VA"), "plain", {
      hint: `유효 전력 ${si(pout, "W")} (역률 ${powerFactor.toFixed(2)})${threePhase ? " · 3상 합계" : ""}`,
    }),
    metric("vwind", "권선 전압", windingVoltage, si(windingVoltage, "V"), "plain", {
      hint: threePhase
        ? phases === "wye"
          ? "Y결선이라 선간 전압의 1/√3이 권선에 걸립니다."
          : "Δ결선이라 선간 전압이 그대로 권선에 걸립니다."
        : "단상이므로 입력 전압이 그대로 권선에 걸립니다.",
    }),
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
    metric("pfe", "철손", ironTotal, si(ironTotal, "W"), "plain", {
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
    const minTurns = Math.ceil(windingVoltage / (formFactor * freq * metrics.ae * core.bsat));
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

  warnings.push(
    ...insulationWarnings(values, thermal.temperature),
    ...applicationWarnings(values, out, saturationRatio),
  );

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

  // Total primary current: magnetising plus the reflected load.
  const primaryRms = Math.sqrt(iPri * iPri + imag * imag);
  const runtime: RuntimeSpec = {
    kind: "ac",
    // Energised straight onto the line. The current that flows is set by the
    // magnetising reactance, not by the winding resistance -- and the first
    // half cycle is what makes the inrush spectacular.
    drive: "voltage",
    supply: vin,
    frequency: freq,
    ratedCurrent: primaryRms,
    ac: {
      turns: np,
      area: metrics.ae,
      mmfFor: (b: number) => mmfFor(core, b, metrics, 0),
      bsat: core.bsat,
      // Switched off at a random point, a laminated core keeps most of its
      // flux; that residue adds to the next energisation.
      remanence: 0.5,
      loadPeak: iPri * Math.SQRT2,
    },
    resistance20: p.rdc / (1 + conductor.alphaT * (thermal.temperature - 20)),
    alphaT: conductor.alphaT,
    inductance: Math.max(lm, 1e-6),
    fixedLoss: ironLoss,
    surface: metrics.surface,
    parts: [
      windingPart(p.mass + s.mass, insulationClass, conductor),
      corePart(core, metrics.mass),
      bobbinPart(metrics.mass * 0.04),
    ],
  };

  return { metrics: out, warnings, curves, build, runtime };
}
