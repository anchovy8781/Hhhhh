/** Conductors, magnet wire and litz constructions. */

import type { ConductorMaterial, WireItem } from "../material-types";

type BaseRow = [
  id: string,
  name: string,
  rho20: number,
  alphaT: number,
  density: number,
  cost: number,
  melting: number,
  color: number,
  tags: string,
  note: string,
];

const BASES: BaseRow[] = [
  ["copper", "구리 (Cu-ETP)", 1.724e-8, 0.00393, 8960, 1.0, 1085, 0xc27a3a, "표준 범용", "기준 재료. 도전율과 가공성의 균형이 가장 좋습니다."],
  ["copper-ofhc", "무산소동 (OFHC)", 1.71e-8, 0.00393, 8940, 1.25, 1085, 0xc98244, "고순도 진공", "수소 취성이 없어 진공·고온 접합에 씁니다."],
  ["copper-silver", "은함유동 (CuAg0.1)", 1.75e-8, 0.0038, 8950, 2.2, 1085, 0xcb8a52, "고온 크리프 모터", "연화 온도가 높아 고온에서 형상을 유지합니다."],
  ["copper-zr", "지르코늄동", 1.9e-8, 0.0037, 8900, 3.5, 1080, 0xc0803f, "고강도 로터", "강도가 높아 고속 회전자 권선에 씁니다."],
  ["aluminum-1350", "알루미늄 1350", 2.65e-8, 0.00429, 2700, 0.3, 660, 0xb9c0c7, "대형변압기 경량 저가", "저항이 54% 크지만 무게는 1/3, 가격은 1/3. 대형 변압기에 씁니다."],
  ["aluminum-6101", "알루미늄 6101", 3.0e-8, 0.0042, 2700, 0.32, 655, 0xb4bcc4, "버스바 구조", "강도가 높아 버스바 같은 구조 겸용 도체에 씁니다."],
  ["silver", "은 (Ag)", 1.59e-8, 0.0038, 10490, 80, 962, 0xd8dde2, "최고도전율 특수", "구리보다 8% 낮은 저항. 가격 때문에 특수 용도에만 씁니다."],
  ["cca", "구리피복알루미늄 (CCA)", 2.55e-8, 0.0042, 3630, 0.5, 660, 0xbc9a72, "저가 경량 가전", "알루미늄 심에 구리를 입혀 납땜성을 살린 저가 도체입니다."],
  ["ccs", "구리피복강 (CCS)", 4.5e-8, 0.0042, 6600, 0.4, 1400, 0xa08a70, "고인장 가공선", "인장 강도가 필요한 가공 선로용입니다."],
  ["brass", "황동", 6.4e-8, 0.0015, 8500, 0.8, 930, 0xb99a58, "단자 구조", "도체보다는 단자·구조 부품용입니다."],
];

const BASE_BY_ID = new Map(BASES.map((row) => [row[0], row]));

function baseConductor(row: BaseRow): ConductorMaterial {
  const [id, name, rho20, alphaT, density, cost, melting, color, tags, note] = row;
  return {
    id,
    name,
    family: "단선 도체",
    rho20,
    alphaT,
    density,
    cost,
    acFactorCap: Infinity,
    fillPenalty: 1.0,
    melting,
    color,
    tags: ["도체", "conductor", ...tags.split(" ")],
    provenance: "금속 물성 공개 자료 (20°C 비저항, 온도계수)",
    note,
  };
}

/** Litz: fine strands twisted so no strand is thicker than the skin depth. */
const LITZ_STRAND_AWG = [32, 36, 38, 40, 42, 44, 46];
const LITZ_COUNTS = [20, 40, 60, 100, 150, 200, 400, 800, 1600];

function litzEntries(): ConductorMaterial[] {
  const copper = BASE_BY_ID.get("copper")!;
  const out: ConductorMaterial[] = [];
  for (const strandAwg of LITZ_STRAND_AWG) {
    for (const count of LITZ_COUNTS) {
      // Finer strands and more of them mean more insulation and air in the
      // bundle, so less of the window is actual copper.
      const fill = Math.max(0.45, 0.78 - (strandAwg - 32) * 0.018 - Math.log10(count) * 0.05);
      const cap = 1.02 + (strandAwg <= 36 ? 0.2 : 0.06);
      out.push({
        id: `litz-${strandAwg}-${count}`,
        name: `리츠선 ${count}가닥 × AWG${strandAwg}`,
        family: "리츠선",
        rho20: copper[2],
        alphaT: copper[3],
        density: copper[4],
        cost: 3 + count / 200 + (strandAwg - 32) * 0.3,
        acFactorCap: cap,
        fillPenalty: fill,
        melting: 1085,
        color: 0xd79a5b,
        tags: ["리츠", "litz", "고주파", "표피효과", `awg${strandAwg}`, `${count}가닥`],
        provenance: `구리 물성 + 가닥수·소선경으로 점적률과 AC 저항 상한 산출`,
        note: `표피효과를 억제합니다. 창 면적의 ${Math.round((1 - fill) * 100)}%를 절연·공극이 차지합니다.`,
      });
    }
  }
  return out;
}

/** Foil and rectangular conductors: high fill, but one turn per layer. */
const FOIL_THICKNESS = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5];

function foilEntries(): ConductorMaterial[] {
  const out: ConductorMaterial[] = [];
  for (const metal of ["copper", "aluminum-1350"] as const) {
    const base = BASE_BY_ID.get(metal)!;
    for (const thickness of FOIL_THICKNESS) {
      out.push({
        id: `foil-${metal}-${String(thickness).replace(".", "")}`,
        name: `${metal === "copper" ? "동박" : "알루미늄박"} ${thickness}mm`,
        family: "포일 권선",
        rho20: base[2],
        alphaT: base[3],
        density: base[4],
        cost: base[5] * 1.4,
        acFactorCap: Infinity,
        fillPenalty: 0.95,
        melting: base[6],
        color: base[7],
        tags: ["포일", "foil", "박판", "대전류", "저누설", `${thickness}mm`],
        provenance: "모재 물성 + 박 두께",
        note: "점적률이 매우 높고 열이 잘 빠지지만, 한 층이 곧 한 턴입니다.",
      });
    }
  }
  return out;
}

export const CONDUCTOR_MATERIALS: ConductorMaterial[] = [
  ...BASES.map(baseConductor),
  ...litzEntries(),
  ...foilEntries(),
];

// -- magnet wire ------------------------------------------------------------

/** Thermal classes of enamel, by IEC 60317 designation. */
const THERMAL_CLASSES: [code: string, temp: number, cost: number, note: string][] = [
  ["폴리우레탄", 130, 1.0, "납땜 시 피막이 녹아 벗길 필요가 없습니다."],
  ["폴리에스터", 155, 1.05, "가장 흔한 범용 등급입니다."],
  ["폴리에스터이미드", 180, 1.15, "일반 산업용 모터·변압기 표준입니다."],
  ["폴리아미드이미드", 200, 1.35, "고온·인버터 구동 모터용입니다."],
  ["폴리이미드", 220, 1.9, "항공·고온 특수 용도입니다."],
  ["세라믹 절연", 450, 6.0, "화재 안전 회로 등 극한 온도용입니다."],
];

const AWG_SIZES = Array.from({ length: 37 }, (_, i) => i + 8); // AWG 8..44
const METRIC_SIZES = [
  0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.12, 0.14, 0.16, 0.18, 0.2, 0.25, 0.3,
  0.35, 0.4, 0.45, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.24,
  2.5, 2.8, 3.15,
];

const awgDiameterM = (awg: number) => 0.127e-3 * Math.pow(92, (36 - awg) / 39);

function wireEntry(
  id: string,
  name: string,
  diameter: number,
  family: string,
  awg: number | null,
  [enamel, temp, costFactor, note]: (typeof THERMAL_CLASSES)[number],
): WireItem {
  return {
    id,
    name,
    family,
    diameter,
    // Heavy-build enamel: thicker film on thicker wire.
    outerDiameter: diameter * 1.06 + 12e-6,
    thermalClass: temp,
    conductorId: "copper",
    awg,
    cost: costFactor,
    tags: [
      "권선",
      "wire",
      "마그넷와이어",
      "구리",
      "에나멜선",
      enamel,
      `${temp}c`,
      ...(awg ? [`awg${awg}`] : []),
    ],
    provenance: "AWG/미터 규격 지름 + IEC 60317 열등급",
    note: `${enamel} 피막, 열등급 ${temp}°C. ${note}`,
  };
}

/** Imperial Standard Wire Gauge, still used across older British designs. */
const SWG_DIAMETER_MM: Record<number, number> = {
  8: 4.064, 9: 3.658, 10: 3.251, 11: 2.946, 12: 2.642, 13: 2.337, 14: 2.032,
  15: 1.829, 16: 1.626, 17: 1.422, 18: 1.219, 19: 1.016, 20: 0.914, 21: 0.813,
  22: 0.711, 23: 0.610, 24: 0.559, 25: 0.508, 26: 0.457, 27: 0.417, 28: 0.376,
  29: 0.345, 30: 0.315, 31: 0.295, 32: 0.274, 33: 0.254, 34: 0.234, 35: 0.213,
  36: 0.193, 37: 0.173, 38: 0.152, 39: 0.132, 40: 0.122, 41: 0.112, 42: 0.102,
};

/** Rectangular ("flat") magnet wire, sized width x thickness in mm. */
const RECT_SIZES: [width: number, thickness: number][] = [
  [1.0, 0.5], [1.25, 0.5], [1.6, 0.5], [2.0, 0.5], [2.5, 0.5], [3.15, 0.5],
  [1.6, 0.8], [2.0, 0.8], [2.5, 0.8], [3.15, 0.8], [4.0, 0.8], [5.0, 0.8],
  [2.5, 1.0], [3.15, 1.0], [4.0, 1.0], [5.0, 1.0], [6.3, 1.0], [8.0, 1.0],
  [4.0, 1.6], [5.0, 1.6], [6.3, 1.6], [8.0, 1.6], [10.0, 1.6], [12.5, 1.6],
  [6.3, 2.0], [8.0, 2.0], [10.0, 2.0], [12.5, 2.0], [16.0, 2.0], [20.0, 2.0],
];

export const WIRES: WireItem[] = [
  ...AWG_SIZES.flatMap((awg) =>
    THERMAL_CLASSES.map((cls) =>
      wireEntry(
        `wire-awg${awg}-${cls[1]}`,
        `AWG${awg} ${cls[0]} (${cls[1]}°C)`,
        awgDiameterM(awg),
        "AWG 마그넷와이어",
        awg,
        cls,
      ),
    ),
  ),
  ...Object.entries(SWG_DIAMETER_MM).flatMap(([swg, mm]) =>
    THERMAL_CLASSES.slice(1, 4).map((cls) =>
      wireEntry(
        `wire-swg${swg}-${cls[1]}`,
        `SWG${swg} ${cls[0]} (${cls[1]}°C)`,
        mm * 1e-3,
        "SWG 마그넷와이어",
        null,
        cls,
      ),
    ),
  ),
  ...RECT_SIZES.flatMap(([width, thickness]) =>
    THERMAL_CLASSES.slice(1, 5).map((cls) => {
      // A rectangular conductor of the same area as a round one of this
      // diameter, so downstream resistance maths needs no special case.
      const equivalent = Math.sqrt((4 * width * thickness) / Math.PI) * 1e-3;
      const item = wireEntry(
        `wire-rect${String(width).replace(".", "")}x${String(thickness).replace(".", "")}-${cls[1]}`,
        `평각선 ${width}×${thickness}mm ${cls[0]} (${cls[1]}°C)`,
        equivalent,
        "평각 마그넷와이어",
        null,
        cls,
      );
      item.tags = [...item.tags, "평각", "rectangular", "대전류", "고점적률"];
      item.note = `${width}×${thickness}mm 평각. 점적률이 높고 방열이 좋아 대전류 권선에 씁니다. ${item.note}`;
      return item;
    }),
  ),
  ...METRIC_SIZES.flatMap((mm) =>
    THERMAL_CLASSES.slice(0, 4).map((cls) =>
      wireEntry(
        `wire-m${String(mm).replace(".", "")}-${cls[1]}`,
        `⌀${mm.toFixed(2)}mm ${cls[0]} (${cls[1]}°C)`,
        mm * 1e-3,
        "미터 규격 마그넷와이어",
        null,
        cls,
      ),
    ),
  ),
];
