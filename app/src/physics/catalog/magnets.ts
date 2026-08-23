/**
 * Permanent magnets.
 *
 * NdFeB is a two-dimensional catalog in real life: an energy-product grade
 * (N35 … N55, which sets Br) crossed with a temperature class (M, H, SH, UH,
 * EH, AH, which sets intrinsic coercivity and therefore the usable
 * temperature). Higher grades cannot be made in the highest temperature
 * classes, so those combinations are skipped rather than invented.
 */

import type { MagnetMaterial } from "../material-types";

/** Energy-product grades: [grade, Br at 20 °C]. */
const NDFEB_GRADES: [name: string, br: number][] = [
  ["N33", 1.15],
  ["N35", 1.19],
  ["N38", 1.24],
  ["N40", 1.27],
  ["N42", 1.3],
  ["N45", 1.34],
  ["N48", 1.38],
  ["N50", 1.41],
  ["N52", 1.44],
  ["N55", 1.48],
];

/** Temperature classes: [suffix, Hcj (kA/m), max service temp, cost factor]. */
const NDFEB_CLASSES: [suffix: string, hcj: number, maxTemp: number, cost: number][] = [
  ["", 955, 80, 1.0],
  ["M", 1114, 100, 1.15],
  ["H", 1353, 120, 1.3],
  ["SH", 1592, 150, 1.55],
  ["UH", 1990, 180, 1.9],
  ["EH", 2388, 200, 2.4],
  ["AH", 2628, 230, 3.1],
];

/** The highest energy grades cannot reach the highest coercivity classes. */
const MAX_CLASS_INDEX: Record<string, number> = {
  N33: 6, N35: 6, N38: 6, N40: 5, N42: 5, N45: 4, N48: 3, N50: 2, N52: 1, N55: 0,
};

function ndfeb(): MagnetMaterial[] {
  const out: MagnetMaterial[] = [];
  for (const [grade, br] of NDFEB_GRADES) {
    const limit = MAX_CLASS_INDEX[grade] ?? 3;
    NDFEB_CLASSES.forEach(([suffix, hcj, maxTemp, cost], index) => {
      if (index > limit) return;
      out.push({
        id: `ndfeb-${grade.toLowerCase()}${suffix.toLowerCase()}`,
        name: `네오디뮴 ${grade}${suffix}`,
        family: "소결 NdFeB",
        br,
        hc: hcj * 1e3,
        murec: 1.05,
        density: 7500,
        cost: (8 + (br - 1.1) * 40) * cost,
        maxTemp,
        brTempCo: -0.12,
        color: 0xa8adb4,
        tags: ["네오디뮴", "ndfeb", "희토류", grade.toLowerCase(), suffix.toLowerCase() || "표준", "고자속"],
        provenance: `NdFeB 등급표 (Br) × 온도등급 (Hcj·사용상한)`,
        note: `사용 상한 ${maxTemp}°C. 넘기면 영구 감자됩니다. Br 온도계수 −0.12%/K.`,
      });
    });
  }
  return out;
}

const OTHERS: MagnetMaterial[] = [
  ...([
    ["sm1co5-16", "SmCo 1:5 (16MGOe)", 0.85, 1200, 250, 30],
    ["sm2co17-24", "SmCo 2:17 (24MGOe)", 1.0, 1600, 300, 35],
    ["sm2co17-26", "SmCo 2:17 (26MGOe)", 1.05, 1600, 300, 38],
    ["sm2co17-28", "SmCo 2:17 (28MGOe)", 1.08, 1750, 350, 42],
    ["sm2co17-30", "SmCo 2:17 (30MGOe)", 1.12, 1750, 350, 46],
  ] as [string, string, number, number, number, number][]).map(
    ([id, name, br, hcj, maxTemp, cost]): MagnetMaterial => ({
      id,
      name,
      family: "SmCo",
      br,
      hc: hcj * 1e3,
      murec: 1.05,
      density: 8300,
      cost,
      maxTemp,
      brTempCo: -0.035,
      color: 0x8e959c,
      tags: ["사마륨코발트", "smco", "고온", "내식", "항공"],
      provenance: "SmCo 등급 공개 데이터",
      note: `${maxTemp}°C까지 견디고 부식에 강합니다. 온도계수가 네오디뮴의 1/3입니다.`,
    }),
  ),
  ...([
    ["y25", "페라이트 Y25", 0.37, 175],
    ["y30", "페라이트 Y30", 0.4, 200],
    ["y30bh", "페라이트 Y30BH", 0.41, 230],
    ["y33", "페라이트 Y33", 0.42, 235],
    ["y35", "페라이트 Y35", 0.43, 240],
    ["y40", "페라이트 Y40", 0.45, 250],
  ] as [string, string, number, number][]).map(
    ([id, name, br, hcj]): MagnetMaterial => ({
      id: `ferrite-magnet-${id}`,
      name,
      family: "페라이트 자석",
      br,
      hc: hcj * 1e3,
      murec: 1.1,
      density: 4900,
      cost: 0.4,
      maxTemp: 250,
      brTempCo: -0.2,
      color: 0x33383d,
      tags: ["페라이트자석", "ferrite", "저가", "내식", "대량생산"],
      provenance: "하드페라이트 Y 등급표",
      note: "가장 싸고 온도에 강합니다. 대신 자속이 약해 기기가 커집니다.",
    }),
  ),
  ...([
    ["alnico5", "알니코 5", 1.25, 50],
    ["alnico5dg", "알니코 5DG", 1.33, 52],
    ["alnico6", "알니코 6", 1.05, 62],
    ["alnico8", "알니코 8", 0.83, 130],
    ["alnico9", "알니코 9", 1.05, 120],
  ] as [string, string, number, number][]).map(
    ([id, name, br, hcj]): MagnetMaterial => ({
      id,
      name,
      family: "AlNiCo",
      br,
      hc: hcj * 1e3,
      murec: 4,
      density: 7300,
      cost: 8,
      maxTemp: 500,
      brTempCo: -0.02,
      color: 0x7d746a,
      tags: ["알니코", "alnico", "고온", "계측", "저온도계수"],
      provenance: "AlNiCo 등급표",
      note: "온도 안정성이 가장 좋지만 보자력이 낮아 반자계에 쉽게 감자됩니다.",
    }),
  ),
  ...([
    ["bonded-ndfeb-8", "본드 NdFeB 8MGOe", 0.6, 700, 120],
    ["bonded-ndfeb-10", "본드 NdFeB 10MGOe", 0.68, 720, 120],
    ["bonded-ferrite", "본드 페라이트", 0.25, 180, 150],
    ["bonded-smco", "본드 SmCo", 0.55, 800, 180],
  ] as [string, string, number, number, number][]).map(
    ([id, name, br, hcj, maxTemp]): MagnetMaterial => ({
      id,
      name,
      family: "본드 자석",
      br,
      hc: hcj * 1e3,
      murec: 1.2,
      density: 6000,
      cost: 5,
      maxTemp,
      brTempCo: -0.1,
      color: 0x6a6f76,
      tags: ["본드자석", "사출", "복잡형상", "다극착자"],
      provenance: "본드 자석 등급 공개 데이터",
      note: "사출·압축 성형이라 복잡한 형상과 다극 착자가 가능합니다. 자속은 소결품보다 약합니다.",
    }),
  ),
];

export const MAGNET_MATERIALS: MagnetMaterial[] = [...ndfeb(), ...OTHERS];
