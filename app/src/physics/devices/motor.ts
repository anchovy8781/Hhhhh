/** 브러시 DC 모터 (영구자석 계자) 모델. */

import {
  conductorMaterial,
  coreLossDensity,
  coreMaterial,
  magnetMaterial,
} from "../materials";
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
import { MU0 } from "../constants";
import type { RuntimeSpec } from "../run";
import {
  applicationWarnings,
  corePart,
  magnetPart,
  windingPart,
  conductorParam,
  coreMaterialParam,
  insulationClassParam,
  insulationWarnings,
  magnetParam,
} from "./shared";

const RPM_PER_RAD = 60 / (2 * Math.PI);

export const motor: DeviceDefinition = {
  id: "motor",
  name: "DC 모터",
  tagline: "자석의 자속과 전기자 전류가 만나 토크가 됩니다",
  icon: "⊛",
  params: [
    magnetParam(),
    coreMaterialParam("coreMaterial", "steel-m19-035"),
    conductorParam(),
    { kind: "number", key: "rotorOd", label: "회전자 외경", unit: "mm", min: 8, max: 200, step: 1, default: 40, group: "치수" },
    { kind: "number", key: "stackLength", label: "적층 길이", unit: "mm", min: 5, max: 200, step: 1, default: 40, group: "치수" },
    { kind: "number", key: "airGap", label: "공극", unit: "mm", min: 0.15, max: 3, step: 0.05, default: 0.5, group: "치수", hint: "공극이 커지면 자속이 급격히 줄어듭니다." },
    { kind: "number", key: "magnetThickness", label: "자석 두께", unit: "mm", min: 1, max: 25, step: 0.5, default: 5, group: "치수" },
    { kind: "number", key: "yokeThickness", label: "고정자 요크 두께", unit: "mm", min: 0.5, max: 30, step: 0.5, default: 10, group: "치수", hint: "자속의 귀환 경로. 얇으면 포화해서 자석을 키워도 토크가 늘지 않습니다.", advanced: true },
    { kind: "number", key: "poles", label: "극수", unit: "극", min: 2, max: 12, step: 2, default: 4, group: "치수", advanced: true },
    { kind: "number", key: "slots", label: "슬롯 수", unit: "개", min: 3, max: 36, step: 1, default: 12, group: "권선", advanced: true },
    { kind: "number", key: "turnsPerCoil", label: "코일당 턴수", unit: "T", min: 1, max: 500, step: 1, default: 30, group: "권선" },
    { kind: "number", key: "awg", label: "전선 굵기", unit: "AWG", min: 8, max: 40, step: 1, default: 22, group: "권선" },
    { kind: "number", key: "voltage", label: "인가 전압", unit: "V", min: 1, max: 800, step: 1, default: 24, group: "운전" },
    { kind: "number", key: "loadTorque", label: "부하 토크", unit: "N·m", min: 0, max: 50, step: 0.01, default: 0.15, group: "운전" },
    { kind: "number", key: "targetRpm", label: "목표 무부하 회전수", unit: "rpm", min: 60, max: 60000, step: 10, default: 1800, group: "운전", log: true, hint: "인가 전압에서 이 회전수가 나오도록 턴수를 추천합니다." },
    { kind: "number", key: "brushDrop", label: "브러시 전압강하", unit: "V", min: 0, max: 5, step: 0.1, default: 1.5, group: "운전", hint: "탄소 브러시 2개 합계. 저전압 모터에서는 효율을 크게 갉아먹습니다.", advanced: true },
    insulationClassParam(),
    ...environmentParams(),
  ],
  simulate,
  recommend,
};

/**
 * Turns for the speed you asked for.
 *
 * Speed is set by the back-EMF constant, and Ke is set by flux times turns.
 * So once the magnet and the geometry are chosen, the turns count is simply
 * whatever makes `V / Ke` land on the target -- and the wire has to carry the
 * current that the load torque then demands.
 */
function recommend(values: ParamValues): Recommendation[] {
  const result = simulate(values);
  const kt = result.metrics.find((m) => m.key === "kt")?.raw ?? 0;
  const turnsPerCoil = Math.round(num(values, "turnsPerCoil"));
  const voltage = num(values, "voltage");
  const drop = num(values, "brushDrop");
  const targetRpm = num(values, "targetRpm");
  const loadTorque = num(values, "loadTorque");
  const out: Recommendation[] = [];
  if (kt <= 0) return out;

  const targetOmega = (targetRpm * 2 * Math.PI) / 60;
  const neededKe = Math.max(voltage - drop, 1e-6) / targetOmega;
  const suggested = Math.max(1, Math.round((turnsPerCoil * neededKe) / kt));
  if (meaningful(turnsPerCoil, suggested, 0.05)) {
    out.push({
      key: "turnsPerCoil",
      value: suggested,
      label: `코일당 턴수 ${turnsPerCoil} → ${suggested}`,
      reason: `${voltage}V에서 ${targetRpm}rpm을 내려면 Ke = ${neededKe.toFixed(4)} V·s/rad가 필요하고, Ke는 턴수에 비례합니다.`,
    });
  }

  const current = loadTorque / (kt * (suggested / Math.max(turnsPerCoil, 1)));
  const density = currentDensity(voltage * current);
  const awg = recommendAwg(Math.max(current, 1e-3), density);
  if (Math.abs(awg - Math.round(num(values, "awg"))) >= 1) {
    out.push({
      key: "awg",
      value: awg,
      label: `전선 AWG${Math.round(num(values, "awg"))} → AWG${awg}`,
      reason: wireReason(awg, current, density),
    });
  }
  return out;
}

function simulate(values: ParamValues): DeviceResult {
  const environment = readEnvironment(values);
  const insulationClass = Number(values["insulationClass"]) || 155;
  const magnet = magnetMaterial(str(values, "magnet"));
  const core = coreMaterial(str(values, "coreMaterial"));
  const conductor = conductorMaterial(str(values, "conductor"));
  const rotorOd = num(values, "rotorOd") * 1e-3;
  const stackLength = num(values, "stackLength") * 1e-3;
  const airGap = num(values, "airGap") * 1e-3;
  const magnetThickness = num(values, "magnetThickness") * 1e-3;
  const yokeThickness = num(values, "yokeThickness") * 1e-3;
  const poles = Math.max(2, Math.round(num(values, "poles") / 2) * 2);
  const slots = Math.round(num(values, "slots"));
  const turnsPerCoil = Math.round(num(values, "turnsPerCoil"));
  const awg = Math.round(num(values, "awg"));
  const voltage = num(values, "voltage");
  const loadTorque = num(values, "loadTorque");
  const brushDrop = Math.min(num(values, "brushDrop"), voltage);

  // Air-gap flux density from the magnet's load line: the magnet works
  // against its own internal reluctance plus the gap it has to push through.
  // 90 % of the magnet's flux actually crosses the gap; the rest leaks pole to
  // pole without ever linking the winding.
  const LEAKAGE = 0.9;
  const bGap =
    (magnet.br / (1 + (magnet.murec * airGap) / magnetThickness)) * LEAKAGE;

  // Flux per pole over the pole arc (typically ~80 % of the pitch).
  const poleArc = 0.8;
  const polePitchArea = ((Math.PI * rotorOd) / poles) * stackLength * poleArc;

  // The stator yoke carries half of each pole's flux around to the next pole.
  // Once it saturates it simply cannot pass any more, so it caps the air-gap
  // flux no matter how strong the magnet is -- the single most common reason a
  // "stronger magnet" changes nothing on a real motor.
  const yokeArea = yokeThickness * stackLength;
  const fluxUnlimited = bGap * polePitchArea;
  const fluxCeiling = isFinite(core.bsat) ? 2 * core.bsat * yokeArea : Infinity;
  const yokeLimited = fluxUnlimited > fluxCeiling;
  const fluxPerPole = Math.min(fluxUnlimited, fluxCeiling);
  const bGapEffective = polePitchArea > 0 ? fluxPerPole / polePitchArea : 0;

  // Lap winding: parallel paths a = poles, total conductors z = 2*N*slots.
  const conductors = 2 * turnsPerCoil * slots;
  const kt = (conductors * poles * fluxPerPole) / (2 * Math.PI * poles);
  const ke = kt; // SI 단위에서 토크상수와 역기전력상수는 같습니다

  const meanTurnLength = 2 * (stackLength + (Math.PI * rotorOd) / poles);
  const slotWindowHeight = rotorOd * 0.2;

  const lossAt = (tempC: number) => {
    const winding = analyzeWinding({
      material: conductor,
      turns: turnsPerCoil * slots,
      awg,
      meanTurnLength,
      windowHeight: slotWindowHeight,
      freq: 0,
      tempC,
    });
    const resistance = (winding.rdc * 4) / (poles * poles); // 병렬 경로 보정
    const current = kt > 0 ? loadTorque / kt : 0;
    return current * current * resistance;
  };

  const statorOd = rotorOd + 2 * (airGap + magnetThickness + yokeThickness);
  const thermal = solveThermal(lossAt, Math.PI * statorOd * (stackLength + statorOd / 2), environment);
  const winding = analyzeWinding({
    material: conductor,
    turns: turnsPerCoil * slots,
    awg,
    meanTurnLength,
    windowHeight: slotWindowHeight,
    freq: 0,
    tempC: thermal.temperature,
  });
  const resistance = (winding.rdc * 4) / (poles * poles);

  const armatureVoltage = voltage - brushDrop;
  const noLoadSpeed = ke > 0 ? armatureVoltage / ke : 0; // [rad/s]
  const stallCurrent = armatureVoltage / Math.max(resistance, 1e-9);
  const stallTorque = kt * stallCurrent;

  const rotorVolume =
    (Math.PI / 4) *
    (rotorOd * rotorOd - Math.pow(Math.max(3e-3, rotorOd * 0.15), 2)) *
    stackLength;

  // The rotor iron sees a full flux reversal every pole pair, so its loss
  // depends on speed -- which depends on the extra torque needed to cover that
  // very loss. Solve the loop instead of pretending the motor is lossless.
  let current = kt > 0 ? loadTorque / kt : 0;
  let speed = 0;
  let ironLoss = 0;
  for (let i = 0; i < 30; i++) {
    speed = ke > 0 ? (armatureVoltage - current * resistance) / ke : 0;
    if (speed <= 0) {
      speed = 0;
      ironLoss = 0;
      current = stallCurrent;
      break;
    }
    const electricalFreq = (speed / (2 * Math.PI)) * (poles / 2);
    ironLoss = coreLossDensity(core, electricalFreq, bGapEffective) * rotorVolume;
    const dragTorque = ironLoss / speed;
    const next = kt > 0 ? (loadTorque + dragTorque) / kt : 0;
    if (Math.abs(next - current) < 1e-9) {
      current = next;
      break;
    }
    current = next;
  }

  const mechanical = Math.max(0, loadTorque * speed);
  const electrical = voltage * current;
  const efficiency = electrical > 0 ? mechanical / electrical : 0;
  const copperLoss = current * current * resistance;
  const brushLoss = brushDrop * current;
  const maxPower = (stallTorque * noLoadSpeed) / 4;

  const bYoke = yokeArea > 0 ? fluxPerPole / (2 * yokeArea) : 0;
  const saturationRatio = isFinite(core.bsat) ? bYoke / core.bsat : 0;

  const out: Metric[] = [
    metric("kt", "토크 상수 Kt", kt, si(kt, "N·m/A"), "plain", { headline: true }),
    metric("speed", "동작 속도", speed * RPM_PER_RAD, `${(speed * RPM_PER_RAD).toFixed(0)} rpm`,
      speed > 0 ? "plain" : "bad", { headline: true }),
    metric("eff", "효율", efficiency, `${(efficiency * 100).toFixed(1)} %`,
      efficiency > 0.8 ? "good" : efficiency > 0.6 ? "warn" : "bad", { headline: true }),
    metric("current", "동작 전류", current, si(current, "A"), "plain", { headline: true }),
    metric("noload", "무부하 속도", noLoadSpeed * RPM_PER_RAD, `${(noLoadSpeed * RPM_PER_RAD).toFixed(0)} rpm`),
    metric("stallT", "기동 토크", stallTorque, si(stallTorque, "N·m")),
    metric("stallI", "기동 전류", stallCurrent, si(stallCurrent, "A"),
      stallCurrent > 100 ? "warn" : "plain", { hint: "정지 상태에서 흐르는 전류입니다. 인러시 대책이 필요합니다." }),
    metric("pmax", "최대 기계 출력", maxPower, si(maxPower, "W")),
    metric("pmech", "출력", mechanical, si(mechanical, "W")),
    metric("bgap", "공극 자속밀도", bGapEffective, `${bGapEffective.toFixed(3)} T`,
      bGapEffective > 0.8 ? "good" : bGapEffective > 0.4 ? "warn" : "bad",
      yokeLimited
        ? { hint: `자석 단독으로는 ${bGap.toFixed(2)} T이지만 요크 포화로 제한되었습니다.` }
        : {}),
    metric("flux", "극당 자속", fluxPerPole, si(fluxPerPole, "Wb")),
    metric("byoke", "요크 자속밀도", bYoke, `${bYoke.toFixed(3)} T`,
      saturationRatio > 0.95 ? "bad" : saturationRatio > 0.8 ? "warn" : "good"),
    metric("res", "전기자 저항", resistance, si(resistance, "Ω")),
    metric("pcu", "구리손", copperLoss, si(copperLoss, "W")),
    metric("pfe", "회전자 철손", ironLoss, si(ironLoss, "W"), "plain", {
      hint: "속도가 오를수록 커집니다. 코어 재료를 바꾸면 바로 드러납니다.",
    }),
    metric("pbrush", "브러시 손실", brushLoss, si(brushLoss, "W"),
      brushLoss > mechanical * 0.2 && mechanical > 0 ? "warn" : "plain"),
    metric("temp", "예상 온도", thermal.temperature, `${thermal.temperature.toFixed(0)} °C`,
      thermal.temperature > magnet.maxTemp ? "bad" : thermal.temperature > magnet.maxTemp * 0.8 ? "warn" : "good"),
    metric("mass", "권선 중량", winding.mass, si(winding.mass, "kg")),
  ];

  const warnings: Warning[] = [];
  if (kt <= 0) {
    warnings.push({ level: "error", text: "자속이 0입니다. 자석 두께와 공극을 확인하세요." });
  }
  if (speed <= 0 && loadTorque > 0) {
    warnings.push({
      level: "error",
      text: `부하 토크 ${loadTorque} N·m가 기동 토크 ${stallTorque.toFixed(3)} N·m보다 큽니다. 모터가 돌지 못하고 정지 전류가 계속 흐릅니다.`,
    });
  }
  if (thermal.temperature > magnet.maxTemp) {
    warnings.push({
      level: "error",
      text: `권선 온도 ${thermal.temperature.toFixed(0)}°C가 ${magnet.name}의 사용 상한 ${magnet.maxTemp}°C를 넘습니다. 자석이 영구 감자됩니다.`,
    });
  }
  if (yokeLimited) {
    const needed = (fluxUnlimited / (2 * core.bsat * stackLength)) * 1e3;
    warnings.push({
      level: "warn",
      text: `고정자 요크가 포화해 자속이 ${((1 - fluxPerPole / fluxUnlimited) * 100).toFixed(0)}% 잘렸습니다. 요크를 ${needed.toFixed(1)}mm 이상으로 키우면 자석 성능을 다 씁니다.`,
    });
  }
  if (airGap > 1e-3) {
    warnings.push({
      level: "info",
      text: `공극 ${(airGap * 1e3).toFixed(2)}mm는 큰 편입니다. 공극을 절반으로 줄이면 자속이 크게 늘어납니다.`,
    });
  }
  // Demagnetisation check: the armature MMF pushes back against the magnet.
  const armatureH = (conductors * current) / (2 * poles * Math.PI * rotorOd * 0.5 + 1e-9);
  if (armatureH > magnet.hc * 0.5) {
    warnings.push({
      level: "warn",
      text: `전기자 반작용이 자석 보자력의 ${((armatureH / magnet.hc) * 100).toFixed(0)}%에 달합니다. 감자 위험이 있습니다.`,
    });
  }

  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= 40; i++) {
    const torque = (stallTorque * i) / 40;
    const rpm =
      ((armatureVoltage - (torque / Math.max(kt, 1e-12)) * resistance) /
        Math.max(ke, 1e-12)) *
      RPM_PER_RAD;
    points.push({ x: torque, y: Math.max(0, rpm) });
  }
  warnings.push(
    ...insulationWarnings(values, thermal.temperature),
    ...applicationWarnings(values, out, saturationRatio),
  );

  const curves: Curve[] = [
    {
      key: "torque-speed",
      title: "토크-속도 특성",
      xLabel: "토크 [N·m]",
      yLabel: "속도 [rpm]",
      points,
      marker: { x: loadTorque, label: "부하점" },
    },
  ];

  const rotorMass = rotorVolume * core.density;
  // Arc magnets covering 80 % of the bore, one magnet thickness deep.
  const magnetInner = rotorOd / 2 + airGap;
  const magnetOuter = magnetInner + magnetThickness;
  const magnetMass =
    Math.PI *
    (magnetOuter * magnetOuter - magnetInner * magnetInner) *
    stackLength *
    magnet.density *
    0.8;
  const runtime: RuntimeSpec = {
    kind: "motor",
    drive: "voltage",
    supply: voltage,
    seriesDrop: brushDrop,
    resistance20: resistance / (1 + conductor.alphaT * (thermal.temperature - 20)),
    alphaT: conductor.alphaT,
    // Armature inductance from the slot geometry; enough to shape the inrush.
    inductance: Math.max((conductors * conductors * MU0 * rotorOd * stackLength) / 1e4, 1e-5),
    fixedLoss: ironLoss + brushLoss,
    surface: Math.PI * statorOd * (stackLength + statorOd / 2),
    ke,
    kt,
    inertia: Math.max(0.5 * rotorMass * Math.pow(rotorOd / 2, 2), 1e-7),
    loadTorque,
    parts: [
      windingPart(winding.mass, insulationClass, conductor),
      corePart(core, rotorMass),
      magnetPart(magnet, magnetMass),
    ],
  };

  return {
    metrics: out,
    warnings,
    curves,
    runtime,
    build: {
      kind: "motor",
      statorOd: (rotorOd + 2 * (airGap + magnetThickness + yokeThickness)) * 1e3,
      rotorOd: rotorOd * 1e3,
      stackLength: stackLength * 1e3,
      airGap: airGap * 1e3,
      magnetThickness: magnetThickness * 1e3,
      poles,
      slots,
      shaftDiameter: Math.max(3, rotorOd * 1e3 * 0.15),
      coreColor: core.color,
      magnetColor: magnet.color,
      saturation: saturationRatio,
      windings: [
        {
          label: "전기자",
          turns: turnsPerCoil,
          wireDiameter: winding.insulatedDiameter * 1e3,
          color: conductor.color,
          share: 1,
        },
      ],
    },
  };
}
