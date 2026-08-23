/** Pieces the wound-component models (inductor, transformer) share. */

import {
  CORE_MATERIALS,
  CONDUCTOR_MATERIALS,
  type CoreMaterial,
} from "../materials";
import type { ChoiceParam, Warning } from "../types";
import type { CoreDims, CoreMetrics } from "../magnetics";

export const coreMaterialParam = (
  key = "coreMaterial",
  defaultId = "ferrite-n87",
): ChoiceParam => ({
  kind: "choice",
  key,
  label: "코어 재료",
  group: "재료",
  default: defaultId,
  options: CORE_MATERIALS.map((m) => ({
    value: m.id,
    label: m.name,
    note: m.note,
  })),
  hint: "투자율이 높으면 적은 턴수로 큰 인덕턴스를 얻지만, 포화 자속밀도와 손실이 함께 따라옵니다.",
});

export const conductorParam = (key = "conductor"): ChoiceParam => ({
  kind: "choice",
  key,
  label: "권선 재료",
  group: "재료",
  default: "copper",
  options: CONDUCTOR_MATERIALS.map((m) => ({
    value: m.id,
    label: m.name,
    note: m.note,
  })),
});

/** Practical window utilisation limit for round magnet wire. */
export const KU_LIMIT = 0.4;

export function windowWarnings(
  occupied: number,
  metrics: CoreMetrics,
  label = "권선",
): Warning[] {
  const fill = occupied / metrics.aw;
  if (fill > 1) {
    return [
      {
        level: "error",
        text: `${label}이 창 면적을 ${(fill * 100).toFixed(0)}% 차지합니다. 물리적으로 감을 수 없습니다 — 턴수를 줄이거나 코어를 키우세요.`,
      },
    ];
  }
  if (fill > KU_LIMIT) {
    return [
      {
        level: "warn",
        text: `창 점적률 ${(fill * 100).toFixed(0)}%. 둥근 선으로는 40% 이상 감기 어렵습니다.`,
      },
    ];
  }
  return [];
}

export function frequencyWarnings(
  material: CoreMaterial,
  freq: number,
): Warning[] {
  if (freq > material.maxFreq) {
    return [
      {
        level: "warn",
        text: `${material.name}의 실용 상한(${material.maxFreq >= 1e3 ? `${material.maxFreq / 1e3} kHz` : `${material.maxFreq} Hz`})을 넘었습니다. 실제 손실은 계산값보다 훨씬 커집니다.`,
      },
    ];
  }
  return [];
}

export function thermalWarnings(
  temperature: number,
  material: CoreMaterial,
): Warning[] {
  if (temperature > material.maxTemp) {
    return [
      {
        level: "error",
        text: `코어 온도 ${temperature.toFixed(0)}°C가 ${material.name}의 상한 ${material.maxTemp}°C를 넘습니다. 열폭주 위험.`,
      },
    ];
  }
  if (temperature > material.maxTemp * 0.8) {
    return [
      {
        level: "warn",
        text: `코어 온도 ${temperature.toFixed(0)}°C — 재료 상한 ${material.maxTemp}°C에 근접했습니다.`,
      },
    ];
  }
  return [];
}

export function saturationWarnings(ratio: number, context: string): Warning[] {
  if (ratio >= 1) {
    return [
      {
        level: "error",
        text: `${context} 자속밀도가 포화점에 도달했습니다. 인덕턴스가 무너지고 전류가 폭주합니다.`,
      },
    ];
  }
  if (ratio > 0.8) {
    return [
      {
        level: "warn",
        text: `${context} 자속밀도가 포화의 ${(ratio * 100).toFixed(0)}%입니다. 여유가 거의 없습니다.`,
      },
    ];
  }
  return [];
}

/** Convert the UI's millimetre dimensions into the solver's SI geometry. */
export function toroidDims(od: number, id: number, height: number): CoreDims {
  return {
    shape: "toroid",
    od: od * 1e-3,
    id: Math.min(id, od - 1) * 1e-3,
    height: height * 1e-3,
  };
}

export function eiDims(
  tongue: number,
  stack: number,
  windowWidth: number,
  windowHeight: number,
): CoreDims {
  return {
    shape: "ei",
    tongue: tongue * 1e-3,
    stack: stack * 1e-3,
    windowWidth: windowWidth * 1e-3,
    windowHeight: windowHeight * 1e-3,
  };
}
