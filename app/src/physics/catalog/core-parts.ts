/**
 * Standard core sizes.
 *
 * A designer does not pick "a ferrite toroid", they pick "a T38 in 3C95". Each
 * series here carries its nominal sizes and the proportions that series is
 * built on, so choosing a part fills the geometry in for you.
 *
 * Dimensions are the series' nominal proportions, not one vendor's drawing:
 * an ETD39 is 39 mm across in every catalogue, but the millimetre of the
 * centre-leg radius differs between makers. Good enough to start a design,
 * not a substitute for the drawing you will build to.
 */

import type { CatalogItem } from "./types";

export type PartShape = "toroid" | "ei";

export interface CorePart extends CatalogItem {
  kind: "corepart";
  shape: PartShape;
  /** Toroid dimensions [mm]. */
  outerDiameter?: number;
  innerDiameter?: number;
  height?: number;
  /** EI-family dimensions [mm]. */
  tongue?: number;
  stack?: number;
  windowWidth?: number;
  windowHeight?: number;
  /** Effective magnetic values quoted by the series [mm² / mm]. */
  ae: number;
  le: number;
  materialHint: string;
}

const toroid = (
  id: string,
  name: string,
  od: number,
  idmm: number,
  height: number,
  family: string,
  hint: string,
  tags: string[],
): CorePart => {
  const ae = ((od - idmm) / 2) * height;
  const le = (Math.PI * (od + idmm)) / 2;
  return {
    id,
    kind: "corepart",
    name,
    family,
    shape: "toroid",
    outerDiameter: od,
    innerDiameter: idmm,
    height,
    ae,
    le,
    materialHint: hint,
    tags: ["코어규격", "토로이드", "toroid", ...tags],
    provenance: "시리즈 공칭 치수 (외경/내경/높이)",
    note: `Ae ${ae.toFixed(1)} mm² · le ${le.toFixed(1)} mm. ${hint}`,
  };
};

/** Ferrite and powder toroids are named by outer diameter in mm or in tenths of an inch. */
const TOROID_OD = [
  10, 12, 13, 16, 18, 20, 22, 25, 26, 28, 30, 32, 35, 36, 38, 40, 42, 44, 47,
  50, 55, 58, 61, 63, 70, 74, 80, 88, 95, 102, 110, 120, 130, 140,
];

function toroidSeries(): CorePart[] {
  const out: CorePart[] = [];
  for (const od of TOROID_OD) {
    // Standard toroid proportions: bore about 55 % of the outer diameter,
    // height about 30 %.
    out.push(
      toroid(
        `core-t${od}`,
        `토로이드 T${od}`,
        od,
        Math.round(od * 0.55 * 10) / 10,
        Math.round(od * 0.3 * 10) / 10,
        "토로이드 코어",
        "페라이트·분말·나노결정 공용 규격",
        ["범용", `t${od}`],
      ),
    );
  }
  // Tall toroids for common-mode chokes need much more window.
  for (const od of [16, 20, 25, 30, 36, 42, 50, 63, 80]) {
    out.push(
      toroid(
        `core-cmt${od}`,
        `CM 초크용 토로이드 ${od}`,
        od,
        Math.round(od * 0.62 * 10) / 10,
        Math.round(od * 0.45 * 10) / 10,
        "커먼모드 초크 코어",
        "나노결정·고투자율 페라이트용",
        ["커먼모드", "cm초크", "emi", "노이즈"],
      ),
    );
  }
  return out;
}

interface EiSeries {
  prefix: string;
  label: string;
  family: string;
  sizes: number[];
  /** Proportions of the nominal size that give each dimension. */
  tongue: number;
  stack: number;
  windowWidth: number;
  windowHeight: number;
  hint: string;
  tags: string[];
}

const EI_SERIES: EiSeries[] = [
  {
    prefix: "EE",
    label: "EE 코어",
    family: "페라이트 EE/EI",
    sizes: [13, 16, 19, 22, 25, 30, 33, 35, 40, 42, 50, 55, 65, 70, 80, 85],
    tongue: 0.3, stack: 0.28, windowWidth: 0.2, windowHeight: 0.52,
    hint: "SMPS 변압기의 가장 흔한 형상",
    tags: ["smps", "변압기", "ee", "ei"],
  },
  {
    prefix: "ETD",
    label: "ETD 코어",
    family: "페라이트 ETD",
    sizes: [29, 34, 39, 44, 49, 54, 59],
    tongue: 0.29, stack: 0.29, windowWidth: 0.2, windowHeight: 0.5,
    hint: "중앙 다리가 원형이라 권선이 짧고 손실이 적습니다",
    tags: ["smps", "원형레그", "고효율", "etd"],
  },
  {
    prefix: "EFD",
    label: "EFD 코어",
    family: "페라이트 EFD",
    sizes: [10, 15, 20, 25, 30],
    tongue: 0.34, stack: 0.2, windowWidth: 0.22, windowHeight: 0.34,
    hint: "높이가 낮아 얇은 기기에 씁니다",
    tags: ["저배", "박형", "노트북", "efd"],
  },
  {
    prefix: "EQ",
    label: "EQ 코어",
    family: "페라이트 EQ",
    sizes: [13, 20, 25, 30, 38],
    tongue: 0.36, stack: 0.3, windowWidth: 0.18, windowHeight: 0.36,
    hint: "낮은 높이와 넓은 중앙 다리를 함께 얻습니다",
    tags: ["저배", "고전류", "eq"],
  },
  {
    prefix: "PQ",
    label: "PQ 코어",
    family: "페라이트 PQ",
    sizes: [20, 26, 32, 35, 40, 50],
    tongue: 0.4, stack: 0.34, windowWidth: 0.17, windowHeight: 0.45,
    hint: "체적 대비 권선 공간이 커 전력 밀도가 높습니다",
    tags: ["고전력밀도", "pq", "smps"],
  },
  {
    prefix: "RM",
    label: "RM 코어",
    family: "페라이트 RM",
    sizes: [4, 5, 6, 8, 10, 12, 14],
    tongue: 0.4, stack: 0.4, windowWidth: 0.2, windowHeight: 0.5,
    hint: "차폐가 좋아 노이즈에 민감한 회로에 씁니다",
    tags: ["차폐", "rm", "저노이즈"],
  },
  {
    prefix: "P",
    label: "포트 코어",
    family: "페라이트 포트",
    sizes: [9, 11, 14, 18, 22, 26, 30, 36, 42],
    tongue: 0.42, stack: 0.42, windowWidth: 0.16, windowHeight: 0.38,
    hint: "완전 차폐. 인덕터 정밀도가 필요할 때 씁니다",
    tags: ["완전차폐", "정밀", "포트", "pot"],
  },
  {
    prefix: "UI",
    label: "UI 코어",
    family: "페라이트 U/UI",
    sizes: [20, 25, 30, 40, 50, 60, 75, 93, 100],
    tongue: 0.22, stack: 0.25, windowWidth: 0.3, windowHeight: 0.7,
    hint: "창이 커 고전압 절연 거리를 확보하기 좋습니다",
    tags: ["고전압", "절연거리", "ui"],
  },
  {
    prefix: "EI",
    label: "EI 적층",
    family: "규소강 EI 적층",
    sizes: [28, 35, 41, 48, 54, 57, 66, 76, 85, 96, 105, 114, 133, 150, 170, 192],
    tongue: 0.33, stack: 0.33, windowWidth: 0.17, windowHeight: 0.5,
    hint: "상용 주파수 변압기·리액터의 표준 적층 규격",
    tags: ["상용주파", "60hz", "변압기", "적층", "규소강"],
  },
  {
    prefix: "C",
    label: "컷 C 코어",
    family: "권철심 C 코어",
    sizes: [20, 25, 32, 40, 50, 63, 80, 100, 125],
    tongue: 0.25, stack: 0.3, windowWidth: 0.3, windowHeight: 0.75,
    hint: "권철심을 잘라 만든 코어. 방향성 강판의 성능을 그대로 씁니다",
    tags: ["권철심", "방향성", "저손실", "c코어"],
  },
];

function eiSeries(): CorePart[] {
  const out: CorePart[] = [];
  for (const series of EI_SERIES) {
    for (const size of series.sizes) {
      const tongue = Math.round(size * series.tongue * 10) / 10;
      const stack = Math.round(size * series.stack * 10) / 10;
      const windowWidth = Math.round(size * series.windowWidth * 10) / 10;
      const windowHeight = Math.round(size * series.windowHeight * 10) / 10;
      const ae = tongue * stack;
      const le = 2 * (windowHeight + windowWidth + tongue);
      out.push({
        id: `core-${series.prefix.toLowerCase()}${size}`,
        kind: "corepart",
        name: `${series.label} ${series.prefix}${size}`,
        family: series.family,
        shape: "ei",
        tongue,
        stack,
        windowWidth,
        windowHeight,
        ae,
        le,
        materialHint: series.hint,
        tags: ["코어규격", series.prefix.toLowerCase(), ...series.tags],
        provenance: `${series.label} 시리즈 공칭 비율 (호칭치수 기준)`,
        note: `Ae ${ae.toFixed(0)} mm² · le ${le.toFixed(0)} mm. ${series.hint}`,
      });
    }
  }
  return out;
}

export const CORE_PARTS: CorePart[] = [...toroidSeries(), ...eiSeries()];
