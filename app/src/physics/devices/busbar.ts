/** 부스바 · 대전류 도체. */

import { MU0 } from "../constants";
import { conductorMaterial, resistivityAt } from "../materials";
import { environmentParams, readEnvironment } from "../environment";
import { solveThermal } from "../thermal";
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
import type { RuntimeSpec } from "../run";
import { part } from "../run";
import { applicationWarnings, conductorParam } from "./shared";
import { type Recommendation } from "../recommend";

export const busbar: DeviceDefinition = {
  id: "busbar",
  name: "부스바",
  tagline: "대전류를 나르는 도체. 굵기와 방열이 곧 통전 용량입니다",
  icon: "▤",
  params: [
    conductorParam("conductor", "도체 재료"),
    {
      kind: "choice",
      key: "finish",
      label: "표면 처리",
      group: "재료",
      default: "tin",
      advanced: true,
      options: [
        { value: "bare", label: "무처리 (광택)", note: "방사율이 낮아 복사 방열이 거의 없습니다." },
        { value: "tin", label: "주석 도금", note: "접촉 저항이 안정적이고 부식에 강합니다." },
        { value: "black", label: "흑색 도장", note: "방사율 0.95. 같은 단면으로 더 큰 전류를 흘립니다." },
        { value: "silver", label: "은 도금", note: "접촉 저항이 가장 낮지만 표면 방열은 나쁩니다." },
      ],
    },
    { kind: "number", key: "width", label: "폭", unit: "mm", min: 3, max: 250, step: 1, default: 40, group: "치수" },
    { kind: "number", key: "thickness", label: "두께", unit: "mm", min: 0.5, max: 40, step: 0.5, default: 5, group: "치수" },
    { kind: "number", key: "length", label: "길이", unit: "mm", min: 20, max: 5000, step: 10, default: 500, group: "치수" },
    { kind: "number", key: "bars", label: "병렬 매수", unit: "매", min: 1, max: 6, step: 1, default: 1, group: "치수", hint: "여러 매를 겹치면 안쪽 면이 막혀 방열 효율이 떨어집니다.", advanced: true },
    { kind: "number", key: "current", label: "통전 전류 (rms)", unit: "A", min: 1, max: 8000, step: 1, default: 400, group: "운전" },
    { kind: "number", key: "freq", label: "주파수", unit: "Hz", min: 0, max: 2000, step: 1, default: 60, group: "운전", hint: "0이면 DC. 주파수가 오르면 표피효과로 유효 단면이 줄어듭니다." },
    { kind: "number", key: "voltage", label: "계통 전압", unit: "V", min: 12, max: 40000, step: 1, default: 400, group: "운전", advanced: true },
    ...environmentParams(),
  ],
  simulate,
  recommend,
};

/** Cross-section for the current, scaled straight from the computed ampacity. */
function recommend(values: ParamValues): Recommendation[] {
  const result = simulate(values);
  const ampacity = result.metrics.find((m) => m.key === "ampacity")?.raw ?? 0;
  const current = num(values, "current");
  const width = num(values, "width");
  const thickness = num(values, "thickness");
  const out: Recommendation[] = [];
  if (ampacity <= 0) return out;

  // Ampacity is close to linear in cross-section over a modest range, so a
  // 15 % margin on the ratio is a sound first cut.
  const scale = (current * 1.15) / ampacity;
  if (scale > 1.05 || scale < 0.7) {
    const suggested = Math.max(1, Math.round(width * scale));
    out.push({
      key: "width",
      value: suggested,
      label: `폭 ${width} → ${suggested} mm`,
      reason: `${current}A에 15% 여유를 두려면 지금 단면의 ${scale.toFixed(2)}배가 필요합니다 (현재 용량 ${ampacity.toFixed(0)}A).`,
    });
  }

  const freq = num(values, "freq");
  if (freq > 0) {
    const conductor = conductorMaterial(str(values, "conductor"));
    const delta =
      Math.sqrt(resistivityAt(conductor, 70) / (Math.PI * freq * MU0)) * 1e3;
    if (thickness > delta * 2.2) {
      out.push({
        key: "thickness",
        value: Math.max(0.5, Math.round(delta * 2 * 2) / 2),
        label: `두께 ${thickness} → ${Math.max(0.5, Math.round(delta * 2 * 2) / 2)} mm`,
        reason: `${freq}Hz의 표피 깊이는 ${delta.toFixed(2)}mm입니다. 이보다 두꺼운 부분은 전류가 거의 흐르지 않으니, 얇은 바 여러 매로 나누는 편이 낫습니다.`,
      });
    }
  }
  if (str(values, "finish") !== "black") {
    out.push({
      key: "finish",
      value: "black",
      label: "표면 처리 → 흑색 도장",
      reason: "방사율이 0.25에서 0.95로 오르면 같은 단면으로 통전 용량이 눈에 띄게 커집니다. 가장 싼 개선입니다.",
    });
  }
  return out;
}

const EMISSIVITY: Record<string, number> = {
  bare: 0.08,
  tin: 0.25,
  black: 0.95,
  silver: 0.05,
};

function simulate(values: ParamValues): DeviceResult {
  const environment = readEnvironment(values);
  const conductor = conductorMaterial(str(values, "conductor"));
  const finish = str(values, "finish");
  const width = num(values, "width") * 1e-3;
  const thickness = num(values, "thickness") * 1e-3;
  const length = num(values, "length") * 1e-3;
  const bars = Math.round(num(values, "bars"));
  const current = num(values, "current");
  const freq = num(values, "freq");
  const voltage = num(values, "voltage");

  // The finish sets the emissivity, which is most of what a bare bar has.
  const surfaceEnvironment = {
    ...environment,
    emissivity: EMISSIVITY[finish] ?? environment.emissivity,
  };

  const area = width * thickness * bars;
  const perimeter = 2 * (width + thickness);
  // Stacked bars shade each other: only the outer faces radiate freely.
  const shading = bars > 1 ? 0.6 + 0.4 / bars : 1;
  const surface = perimeter * length * bars * shading;

  const skinDepthAt = (tempC: number) =>
    freq > 0
      ? Math.sqrt(resistivityAt(conductor, tempC) / (Math.PI * freq * MU0))
      : Infinity;

  /**
   * AC resistance factor for a flat bar.
   *
   * Current crowds into a skin one depth thick around the perimeter, so the
   * conducting area is the full section only while the bar is thinner than
   * two skin depths.
   */
  const acFactor = (tempC: number) => {
    const delta = skinDepthAt(tempC);
    if (!isFinite(delta)) return 1;
    const effective =
      width * thickness -
      Math.max(0, width - 2 * delta) * Math.max(0, thickness - 2 * delta);
    return Math.max(1, (width * thickness) / Math.max(effective, 1e-12));
  };

  const lossAt = (tempC: number) => {
    const resistance =
      (resistivityAt(conductor, tempC) * length * acFactor(tempC)) / area;
    return current * current * resistance;
  };

  const thermal = solveThermal(lossAt, surface, surfaceEnvironment);
  const factor = acFactor(thermal.temperature);
  const resistance =
    (resistivityAt(conductor, thermal.temperature) * length * factor) / area;
  const loss = current * current * resistance;
  const drop = current * resistance;
  const density = current / area / 1e6; // [A/mm²]
  const mass = area * length * conductor.density;
  const delta = skinDepthAt(thermal.temperature);

  /** Continuous current for a 30 K rise, the usual busbar rating basis. */
  const ampacity = (() => {
    let lo = 0;
    let hi = 20000;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      const test = solveThermal(
        (t) => (mid * mid * resistivityAt(conductor, t) * length * acFactor(t)) / area,
        surface,
        surfaceEnvironment,
      );
      if (test.rise < 30) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  })();

  const out: Metric[] = [
    metric("temp", "예상 온도", thermal.temperature, `${thermal.temperature.toFixed(0)} °C`,
      thermal.temperature > 105 ? "bad" : thermal.temperature > 90 ? "warn" : "good",
      { headline: true }),
    metric("ampacity", "통전 용량 (ΔT 30K)", ampacity, si(ampacity, "A"),
      current > ampacity ? "bad" : current > ampacity * 0.85 ? "warn" : "good",
      { headline: true, hint: "이 환경에서 온도 상승 30K로 흘릴 수 있는 연속 전류입니다." }),
    metric("loss", "손실", loss, si(loss, "W"), "plain", { headline: true }),
    metric("drop", "전압 강하", drop, si(drop, "V"), "plain", {
      headline: true,
      hint: `계통 전압의 ${((drop / voltage) * 100).toFixed(3)}%`,
    }),
    metric("res", "저항", resistance, si(resistance, "Ω")),
    metric("acf", "AC 저항 증가율", factor, `${factor.toFixed(3)} 배`,
      factor > 1.3 ? "warn" : "good",
      { hint: freq > 0 ? `표피 깊이 ${(delta * 1e3).toFixed(2)} mm` : "DC이므로 표피효과 없음" }),
    metric("density", "전류 밀도", density, `${density.toFixed(2)} A/mm²`,
      density > 4 ? "bad" : density > 2.5 ? "warn" : "good",
      { hint: "공기 중 자연 냉각 부스바는 보통 1.5~2.5 A/mm²로 잡습니다." }),
    metric("area", "도체 단면적", area * 1e6, `${(area * 1e6).toFixed(0)} mm²`),
    metric("mass", "도체 중량", mass, si(mass, "kg")),
    metric("cost", "재료비 지수", mass * conductor.cost, (mass * conductor.cost).toFixed(3)),
    metric("dissip", "단위면적 발열", loss / surface, `${(loss / surface).toFixed(0)} W/m²`),
  ];

  const warnings: Warning[] = [];
  if (current > ampacity) {
    warnings.push({
      level: "error",
      text: `통전 전류 ${current} A가 이 조건의 용량 ${ampacity.toFixed(0)} A를 넘습니다. 단면을 ${(current / ampacity).toFixed(2)}배로 키우거나 냉각을 강화하세요.`,
    });
  }
  if (factor > 1.3) {
    warnings.push({
      level: "warn",
      text: `표피효과로 저항이 ${factor.toFixed(2)}배가 되었습니다. 두께 ${(thickness * 1e3).toFixed(1)}mm가 표피 깊이 ${(delta * 1e3).toFixed(2)}mm의 두 배를 넘습니다 — 얇고 넓은 바 여러 매로 나누세요.`,
    });
  }
  if (bars > 2) {
    warnings.push({
      level: "info",
      text: `${bars}매를 겹치면 안쪽 면이 방열에 기여하지 못해, 단면 대비 용량이 ${((1 - shading) * 100).toFixed(0)}% 손해입니다. 간격을 띄우세요.`,
    });
  }
  if (finish === "bare" || finish === "silver") {
    warnings.push({
      level: "info",
      text: "광택 표면은 방사율이 0.1 미만입니다. 흑색 도장만 해도 같은 단면으로 통전 용량이 눈에 띄게 올라갑니다.",
    });
  }
  warnings.push(...applicationWarnings(values, out, 0));

  const points: { x: number; y: number }[] = [];
  for (let i = 1; i <= 40; i++) {
    const test = (ampacity * 1.6 * i) / 40;
    const state = solveThermal(
      (t) => (test * test * resistivityAt(conductor, t) * length * acFactor(t)) / area,
      surface,
      surfaceEnvironment,
    );
    points.push({ x: test, y: state.temperature });
  }
  const curves: Curve[] = [
    {
      key: "ampacity",
      title: "전류에 따른 도체 온도",
      xLabel: "전류 [A]",
      yLabel: "온도 [°C]",
      points,
      marker: { x: current, label: "운전점" },
    },
  ];

  const runtime: RuntimeSpec = {
    kind: "rl",
    drive: "current",
    supply: voltage,
    ratedCurrent: current,
    resistance20: (conductor.rho20 * length * factor) / area,
    alphaT: conductor.alphaT,
    inductance: Math.max((MU0 * length) / (2 * Math.PI), 1e-9),
    fixedLoss: 0,
    surface,
    parts: [
      part("winding", "도체", mass, 385, 1.0, 105,
        "부스바 연속 사용 상한 105°C",
        "접속부 산화가 가속되고, 절연 지지물과 케이블 피복이 먼저 손상됩니다.",
        "단면을 키우거나, 표면을 검게 처리하거나, 강제 통풍을 넣으세요.",
        { mode: "melt", destruction: conductor.melting, vital: true }),
      part("housing", "접속부 · 지지 절연물", mass * 0.2, 1500, 1.1, 90,
        "볼트 접속부 허용 온도 90°C",
        "접촉 저항이 커지면서 스스로 더 뜨거워지는 열폭주가 시작됩니다.",
        "접촉 면적을 늘리고 규정 토크로 조이며, 접시 스프링 와셔를 쓰세요.",
        { mode: "arc" }),
    ],
  };

  return {
    metrics: out,
    warnings,
    curves,
    runtime,
    build: {
      kind: "busbar",
      width: num(values, "width"),
      thickness: num(values, "thickness"),
      length: num(values, "length"),
      bars,
      color: conductor.color,
      finish,
      loading: ampacity > 0 ? current / ampacity : 0,
    },
  };
}
