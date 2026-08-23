/** Pieces the wound-component models (inductor, transformer) share. */

import type { CoreMaterial } from "../materials";
import type { CatalogParam, ChoiceParam, Metric, ParamValues, Warning } from "../types";
import { application, checkApplication, snapshotFrom } from "../applications";
import type { CoreDims, CoreMetrics } from "../magnetics";

export const coreMaterialParam = (
  key = "coreMaterial",
  defaultId = "ferrite-n87",
  suggestedTags?: string[],
): CatalogParam => ({
  kind: "catalog",
  key,
  label: "코어 재료",
  catalog: "core",
  group: "재료",
  default: defaultId,
  suggestedTags,
  hint: "투자율이 높으면 적은 턴수로 큰 인덕턴스를 얻지만, 포화 자속밀도와 손실이 함께 따라옵니다.",
});

export const conductorParam = (
  key = "conductor",
  label = "권선 재료",
): CatalogParam => ({
  kind: "catalog",
  key,
  label,
  catalog: "conductor",
  group: "재료",
  default: "copper",
  hint: "고주파에서는 리츠선이, 대전류·저가에서는 알루미늄이나 평각선이 유리합니다.",
});

export const magnetParam = (key = "magnet"): CatalogParam => ({
  kind: "catalog",
  key,
  label: "자석 재료",
  catalog: "magnet",
  group: "재료",
  default: "ndfeb-n42",
  hint: "잔류 자속밀도(Br)가 클수록 토크가 커지지만, 온도 등급을 넘기면 영구 감자됩니다.",
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

export function potDims(
  outerDiameter: number,
  height: number,
  legDiameter: number,
): CoreDims {
  return {
    shape: "pot",
    outerDiameter: outerDiameter * 1e-3,
    height: height * 1e-3,
    legDiameter: Math.min(legDiameter, outerDiameter * 0.6) * 1e-3,
  };
}

export function etdDims(
  legDiameter: number,
  depth: number,
  windowWidth: number,
  windowHeight: number,
): CoreDims {
  return {
    shape: "etd",
    legDiameter: legDiameter * 1e-3,
    depth: depth * 1e-3,
    windowWidth: windowWidth * 1e-3,
    windowHeight: windowHeight * 1e-3,
  };
}

export function rodDims(diameter: number, length: number): CoreDims {
  return { shape: "rod", diameter: diameter * 1e-3, length: length * 1e-3 };
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


/**
 * Winding insulation class.
 *
 * The wire's enamel, not the copper, is usually what decides how hot a design
 * is allowed to run -- and it is the cheapest thing to upgrade.
 */
export const insulationClassParam = (): ChoiceParam => ({
  kind: "choice",
  key: "insulationClass",
  label: "권선 절연 등급",
  group: "권선",
  default: "155",
  options: [
    { value: "130", label: "130°C (Class B)", note: "폴리우레탄. 납땜이 쉽고 가장 쌉니다." },
    { value: "155", label: "155°C (Class F)", note: "폴리에스터. 산업 표준입니다." },
    { value: "180", label: "180°C (Class H)", note: "폴리에스터이미드. 모터·변압기 표준입니다." },
    { value: "200", label: "200°C (Class N)", note: "폴리아미드이미드. 인버터 구동·고온용입니다." },
    { value: "220", label: "220°C (Class R)", note: "폴리이미드. 항공·특수 고온용입니다." },
  ],
});

/** Judge the finished design against the selected application profile. */
export function applicationWarnings(
  values: ParamValues,
  metrics: Metric[],
  saturation: number,
): Warning[] {
  const profile = values["app.profile"];
  if (typeof profile !== "string") return [];
  const insulation = Number(values["insulationClass"]);
  const snapshot = snapshotFrom(
    metrics,
    saturation,
    Number.isFinite(insulation) ? insulation : undefined,
  );
  return checkApplication(application(profile), snapshot);
}

/** The winding insulation cannot be hotter than its own class. */
export function insulationWarnings(
  values: ParamValues,
  temperature: number,
): Warning[] {
  const cls = Number(values["insulationClass"]);
  if (!Number.isFinite(cls)) return [];
  if (temperature > cls) {
    return [
      {
        level: "error",
        text: `권선 온도 ${temperature.toFixed(0)}°C가 선택한 절연 등급 ${cls}°C를 넘습니다. 절연이 탄화되면 층간 단락으로 이어집니다.`,
      },
    ];
  }
  if (temperature > cls - 20) {
    return [
      {
        level: "warn",
        text: `권선 온도가 절연 등급 ${cls}°C까지 ${(cls - temperature).toFixed(0)}°C 남았습니다. 한 등급 올리는 편이 쌉니다.`,
      },
    ];
  }
  return [];
}


// -- runtime parts ----------------------------------------------------------

import { HEAT_CAPACITY, part, type PartSpec } from "../run";
import type { ConductorMaterial, MagnetMaterial } from "../materials";

/** Specific heat of a core, chosen by what the family is made of [J/kgK]. */
export function coreSpecificHeat(material: CoreMaterial): number {
  if (material.family.includes("페라이트")) return HEAT_CAPACITY.ferrite;
  if (material.family.includes("분말") || material.family.includes("SMC")) return 600;
  return HEAT_CAPACITY.iron;
}

/** The winding: the heat source, so it sits above the average rise. */
export function windingPart(
  mass: number,
  insulationClass: number,
  conductor: ConductorMaterial,
): PartSpec {
  return part(
    "winding",
    "권선",
    mass,
    HEAT_CAPACITY.copper,
    1.15,
    insulationClass,
    `절연 열등급 ${insulationClass}°C`,
    `에나멜 피막이 탄화되어 층간 단락으로 이어집니다. 도체 자체는 ${conductor.melting}°C까지 견딥니다.`,
    "전선을 굵게 하거나, 절연 등급을 올리거나, 냉각을 강화하세요.",
  );
}

/** The core: limited by its own continuous rating, and by the Curie point. */
export function corePart(material: CoreMaterial, mass: number): PartSpec {
  return part(
    "core",
    "코어",
    mass,
    coreSpecificHeat(material),
    1.0,
    Math.min(material.maxTemp, material.curie - 20),
    `${material.name} 연속 사용 상한 ${material.maxTemp}°C`,
    `투자율과 포화 자속밀도가 떨어지고, 큐리 온도 ${material.curie}°C에서는 자성을 완전히 잃습니다.`,
    "손실이 적은 재료로 바꾸거나 코어를 키워 자속밀도를 낮추세요.",
  );
}

export function bobbinPart(mass: number, maxTemp = 155): PartSpec {
  return part(
    "bobbin",
    "보빈 · 절연물",
    mass,
    HEAT_CAPACITY.plastic,
    1.05,
    maxTemp,
    `보빈 재료 내열 ${maxTemp}°C`,
    "보빈이 변형되면 권선이 풀리고 절연 거리가 무너집니다.",
    "PPS·LCP 같은 고온 등급 보빈으로 바꾸세요.",
  );
}

export function magnetPart(magnet: MagnetMaterial, mass: number): PartSpec {
  return part(
    "magnet",
    "영구자석",
    mass,
    HEAT_CAPACITY.magnet,
    0.9,
    magnet.maxTemp,
    `${magnet.name} 사용 상한 ${magnet.maxTemp}°C`,
    "되돌릴 수 없는 감자가 일어나 식어도 토크가 돌아오지 않습니다.",
    "온도 등급이 높은 자석(H·SH·UH)이나 SmCo로 바꾸세요.",
  );
}
