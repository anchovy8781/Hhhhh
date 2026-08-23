/** 솔레노이드 액추에이터 / 전자석 모델. */

import { MU0, bisect } from "../constants";
import { conductorMaterial, coreMaterial } from "../materials";
import { coreFieldStrength } from "../magnetics";
import { solveThermal } from "../thermal";
import { environmentParams, readEnvironment } from "../environment";
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
import type { RuntimeSpec } from "../run";
import {
  applicationWarnings,
  bobbinPart,
  corePart,
  windingPart,
  conductorParam,
  coreMaterialParam,
  insulationClassParam,
  insulationWarnings,
} from "./shared";

export const solenoid: DeviceDefinition = {
  id: "solenoid",
  name: "솔레노이드",
  tagline: "코일이 만든 자속이 플런저를 끌어당깁니다",
  icon: "⌁",
  params: [
    coreMaterialParam("coreMaterial", "soft-iron"),
    conductorParam(),
    { kind: "number", key: "plungerDiameter", label: "플런저 지름", unit: "mm", min: 3, max: 80, step: 1, default: 12, group: "치수" },
    { kind: "number", key: "bobbinOd", label: "코일 외경", unit: "mm", min: 8, max: 150, step: 1, default: 30, group: "치수" },
    { kind: "number", key: "coilLength", label: "코일 길이", unit: "mm", min: 5, max: 200, step: 1, default: 35, group: "치수" },
    { kind: "number", key: "shell", label: "외부 요크 두께", unit: "mm", min: 0, max: 20, step: 0.5, default: 4, group: "치수", hint: "자속의 귀환 경로입니다. 0이면 자속이 공기로 새어 힘이 급감합니다." },
    { kind: "number", key: "gap", label: "작동 공극 (스트로크)", unit: "mm", min: 0.05, max: 30, step: 0.05, default: 3, group: "치수" },
    { kind: "number", key: "turns", label: "턴수", unit: "T", min: 10, max: 20000, step: 10, default: 2200, group: "권선" },
    { kind: "number", key: "awg", label: "전선 굵기", unit: "AWG", min: 8, max: 40, step: 1, default: 30, group: "권선" },
    { kind: "number", key: "voltage", label: "인가 전압 (DC)", unit: "V", min: 1, max: 400, step: 1, default: 24, group: "운전" },
    insulationClassParam(),
    ...environmentParams(),
  ],
  simulate,
};

function simulate(values: ParamValues): DeviceResult {
  const environment = readEnvironment(values);
  const insulationClass = Number(values["insulationClass"]) || 155;
  const core = coreMaterial(str(values, "coreMaterial"));
  const conductor = conductorMaterial(str(values, "conductor"));
  const plungerDiameter = num(values, "plungerDiameter") * 1e-3;
  const bobbinOd = num(values, "bobbinOd") * 1e-3;
  const coilLength = num(values, "coilLength") * 1e-3;
  const shell = num(values, "shell") * 1e-3;
  const gap = Math.max(num(values, "gap") * 1e-3, 1e-5);
  const turns = Math.round(num(values, "turns"));
  const awg = Math.round(num(values, "awg"));
  const voltage = num(values, "voltage");
  // Duty lives in the environment: it is a condition of use, not of the part.
  const duty = environment.dutyCycle;

  const plungerArea = (Math.PI * plungerDiameter * plungerDiameter) / 4;
  const bobbinId = plungerDiameter * 1.1;
  const buildup = Math.max(1e-4, (bobbinOd - bobbinId) / 2);
  const meanTurnLength = Math.PI * (bobbinId + buildup);
  const windowArea = buildup * coilLength;

  // Magnetic path: plunger -> working gap -> shell -> back plate. With no
  // shell the return path is air and the reluctance explodes.
  const ironPath = coilLength + plungerDiameter;
  const returnPath = shell > 0 ? coilLength + bobbinOd : 0;
  const airReturn = shell > 0 ? 0 : bobbinOd;

  const lossAt = (tempC: number) => {
    const winding = analyzeWinding({
      material: conductor,
      turns,
      awg,
      meanTurnLength,
      windowHeight: coilLength,
      freq: 0,
      tempC,
    });
    const current = voltage / winding.rdc;
    return current * current * winding.rdc;
  };

  const surface = Math.PI * bobbinOd * coilLength + (Math.PI / 2) * bobbinOd * bobbinOd;
  const thermal = solveThermal(lossAt, surface, environment);
  const winding = analyzeWinding({
    material: conductor,
    turns,
    awg,
    meanTurnLength,
    windowHeight: coilLength,
    freq: 0,
    tempC: thermal.temperature,
  });
  const current = voltage / winding.rdc;
  const mmf = turns * current;
  const power = voltage * current * duty;

  /**
   * Solve the series magnetic circuit for the flux density in the gap.
   *
   * `mmf = H_iron(B)·l_iron + B·l_air/mu0` is monotonic in B, so it inverts
   * cleanly by bisection -- the same treatment the inductor core gets.
   */
  const fluxDensityAt = (workingGap: number): number => {
    const airPath = 2 * workingGap + airReturn;
    const ironLength = ironPath + returnPath;
    const mmfFor = (b: number) =>
      coreFieldStrength(core, b) * ironLength + (b * airPath) / MU0;
    if (mmf <= 0) return 0;
    const ceiling = isFinite(core.bsat) ? core.bsat * 0.999999 : mmf * MU0 / Math.max(airPath, 1e-9);
    if (mmfFor(ceiling) <= mmf) return ceiling;
    return bisect(mmfFor, mmf, 0, ceiling);
  };

  /** Maxwell pulling force across one working gap [N]. */
  const forceAt = (workingGap: number): number => {
    const b = fluxDensityAt(workingGap);
    return (b * b * plungerArea) / (2 * MU0);
  };

  const bGap = fluxDensityAt(gap);
  const force = forceAt(gap);
  const holdingForce = forceAt(1e-5);
  const fill = winding.occupiedArea / windowArea;
  const saturationRatio = isFinite(core.bsat) ? bGap / core.bsat : 0;
  const work = (() => {
    // Integrate force over the stroke: this is the useful mechanical work.
    let total = 0;
    const steps = 40;
    for (let i = 0; i < steps; i++) {
      const g0 = gap * (1 - i / steps);
      const g1 = gap * (1 - (i + 1) / steps);
      total += ((forceAt(Math.max(g0, 1e-5)) + forceAt(Math.max(g1, 1e-5))) / 2) * (g0 - g1);
    }
    return total;
  })();

  const out: Metric[] = [
    metric("force", "흡인력 (현재 공극)", force, si(force, "N"),
      force > 0 ? "plain" : "bad", { headline: true }),
    metric("holding", "흡착 유지력 (공극 0)", holdingForce, si(holdingForce, "N"), "plain", {
      headline: true,
      hint: "공극이 줄면 힘이 제곱으로 커집니다. 솔레노이드의 힘-스트로크 곡선이 가파른 이유입니다.",
    }),
    metric("current", "전류", current, si(current, "A"), "plain", { headline: true }),
    metric("power", "소비 전력", power, si(power, "W"), "plain", { headline: true }),
    metric("temp", "코일 온도", thermal.temperature, `${thermal.temperature.toFixed(0)} °C`,
      thermal.temperature > 155 ? "bad" : thermal.temperature > 120 ? "warn" : "good"),
    metric("mmf", "기자력", mmf, si(mmf, "A·T")),
    metric("bgap", "공극 자속밀도", bGap, `${bGap.toFixed(3)} T`,
      saturationRatio > 0.9 ? "warn" : "good"),
    metric("res", "코일 저항", winding.rdc, si(winding.rdc, "Ω")),
    metric("work", "스트로크 일", work, si(work, "J")),
    metric("fill", "권선 점적률", fill, `${(fill * 100).toFixed(0)} %`,
      fill > 1 ? "bad" : fill > 0.5 ? "warn" : "good"),
    metric("wire", "전선 길이", winding.length, si(winding.length, "m")),
    metric("mass", "권선 중량", winding.mass, si(winding.mass, "kg")),
  ];

  const warnings: Warning[] = [];
  if (fill > 1) {
    warnings.push({
      level: "error",
      text: `권선이 보빈 공간의 ${(fill * 100).toFixed(0)}%를 차지합니다. 감을 수 없습니다.`,
    });
  }
  if (shell === 0) {
    warnings.push({
      level: "warn",
      text: "외부 요크가 없어 자속이 공기로 귀환합니다. 요크를 3~5mm만 넣어도 힘이 몇 배로 늘어납니다.",
    });
  }
  if (thermal.temperature > 155) {
    warnings.push({
      level: "error",
      text: `코일 온도 ${thermal.temperature.toFixed(0)}°C — 절연이 견디지 못합니다. 듀티를 낮추거나 전선을 굵게 하세요.`,
    });
  } else if (thermal.temperature > 120) {
    warnings.push({
      level: "warn",
      text: `코일 온도 ${thermal.temperature.toFixed(0)}°C. Class F(155°C) 절연이 필요합니다.`,
    });
  }
  if (saturationRatio > 0.9) {
    warnings.push({
      level: "warn",
      text: "철심이 포화 중입니다. 전류를 더 흘려도 힘이 거의 늘지 않습니다.",
    });
  }

  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= 40; i++) {
    const g = Math.max((gap * 1.5 * i) / 40, 1e-5);
    points.push({ x: g * 1e3, y: forceAt(g) });
  }
  warnings.push(
    ...insulationWarnings(values, thermal.temperature),
    ...applicationWarnings(values, out, saturationRatio),
  );

  const curves: Curve[] = [
    {
      key: "force-stroke",
      title: "공극에 따른 흡인력",
      xLabel: "공극 [mm]",
      yLabel: "힘 [N]",
      points,
      marker: { x: gap * 1e3, label: "현재 공극" },
    },
  ];

  const runtime: RuntimeSpec = {
    kind: "rl",
    // Straight across a supply: as the coil heats, the current sags.
    drive: "voltage",
    supply: voltage,
    resistance20: winding.rdc / (1 + conductor.alphaT * (thermal.temperature - 20)),
    alphaT: conductor.alphaT,
    inductance: Math.max((turns * turns * MU0 * plungerArea) / (2 * gap + ironPath), 1e-6),
    fixedLoss: 0,
    surface,
    parts: [
      windingPart(winding.mass, insulationClass, conductor),
      corePart(core, plungerArea * (coilLength + gap) * core.density * 2),
      // Bobbin mass from its actual geometry: a 1 mm wall around the former
      // plus two flanges. A guessed mass would make its heating rate fiction.
      bobbinPart(
        (Math.PI * bobbinId * coilLength * 1e-3 +
          2 * Math.PI * ((bobbinOd * bobbinOd - bobbinId * bobbinId) / 4) * 1.5e-3) *
          1400,
      ),
    ],
  };

  return {
    metrics: out,
    warnings,
    curves,
    runtime,
    build: {
      kind: "solenoid",
      bobbinOd: bobbinOd * 1e3,
      bobbinId: bobbinId * 1e3,
      coilLength: coilLength * 1e3,
      plungerDiameter: plungerDiameter * 1e3,
      plungerLength: coilLength * 1e3 * 0.9,
      gap: gap * 1e3,
      shellThickness: shell * 1e3,
      coreColor: core.color,
      saturation: saturationRatio,
      windings: [
        {
          label: "코일",
          turns,
          wireDiameter: winding.insulatedDiameter * 1e3,
          color: conductor.color,
          share: 1,
        },
      ],
    },
  };
}
