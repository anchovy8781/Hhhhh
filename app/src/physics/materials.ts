/**
 * Material database.
 *
 * Core losses use the Steinmetz form `Pv = k · f^alpha · B^beta` [W/m³].
 * Rather than storing `k` (whose magnitude is meaningless on its own) each
 * material stores a datasheet reference point — "this much loss at this
 * frequency and flux density" — and `k` is derived from it. That keeps the
 * numbers auditable against a real datasheet.
 */

export type SaturationModel = "sharp" | "soft";

/**
 * B-H knee sharpness exponent `n` in
 * `H(B) = B / (mu0*mur) / (1 - (B/Bsat)^n)`.
 *
 * A large `n` keeps permeability flat until B is nearly at saturation and then
 * collapses (ferrite, laminated steel). A small `n` bleeds permeability away
 * from low flux onward but never falls off a cliff -- the distributed gap of a
 * powder core. This one number is what separates "잘 버티다 갑자기 무너짐"
 * from "일찍부터 서서히 줄어듦", and both behaviours matter when choosing a core.
 */
export const KNEE_SHARP = 8;
export const KNEE_SOFT = 2;

export interface CoreMaterial {
  id: string;
  name: string;
  /** 초기 비투자율 (relative permeability). */
  mur: number;
  /** 포화 자속밀도 [T]. */
  bsat: number;
  density: number; // [kg/m³]
  /** Steinmetz exponents and the datasheet point they were taken from. */
  alpha: number;
  beta: number;
  refFreq: number; // [Hz]
  refB: number; // [T]
  refLoss: number; // [W/m³] at (refFreq, refB)
  /** B-H knee exponent; see `KNEE_SHARP` / `KNEE_SOFT`. */
  knee: number;
  /** Practical upper frequency before the model stops being meaningful [Hz]. */
  maxFreq: number;
  maxTemp: number; // [°C]
  /** Relative material cost per kg (copper = 1.0). */
  cost: number;
  color: number; // 3D 뷰 색상
  note: string;
}

export interface ConductorMaterial {
  id: string;
  name: string;
  /** 20°C 비저항 [Ω·m]. */
  rho20: number;
  /** 저항 온도계수 [1/K]. */
  alphaT: number;
  density: number; // [kg/m³]
  cost: number; // relative per kg, copper = 1.0
  /** Litz bundles trade window space for a much smaller AC penalty. */
  acFactorCap: number;
  fillPenalty: number;
  color: number;
  note: string;
}

export const CORE_MATERIALS: CoreMaterial[] = [
  {
    id: "air",
    name: "공심 (Air)",
    mur: 1,
    bsat: Infinity,
    density: 0,
    alpha: 1,
    beta: 2,
    refFreq: 1,
    refB: 1,
    refLoss: 0,
    knee: KNEE_SOFT,
    maxFreq: 1e9,
    maxTemp: 1000,
    cost: 0,
    color: 0x5a6472,
    note: "코어 없음. 포화가 없지만 인덕턴스가 매우 작습니다.",
  },
  {
    id: "ferrite-n87",
    name: "페라이트 N87 (MnZn)",
    mur: 2200,
    bsat: 0.39,
    density: 4850,
    alpha: 1.45,
    beta: 2.75,
    refFreq: 100e3,
    refB: 0.2,
    refLoss: 375e3,
    knee: KNEE_SHARP,
    maxFreq: 500e3,
    maxTemp: 120,
    cost: 0.6,
    color: 0x2f3338,
    note: "SMPS 표준 코어. 20k~300kHz에서 손실이 낮습니다.",
  },
  {
    id: "ferrite-n49",
    name: "페라이트 N49 (고주파)",
    mur: 1500,
    bsat: 0.44,
    density: 4750,
    alpha: 1.6,
    beta: 2.6,
    refFreq: 500e3,
    refB: 0.05,
    refLoss: 60e3,
    knee: KNEE_SHARP,
    maxFreq: 3e6,
    maxTemp: 130,
    cost: 1.1,
    color: 0x3a3f45,
    note: "500kHz 이상 고주파 전용. 저주파에서는 N87이 유리합니다.",
  },
  {
    id: "silicon-steel-m19",
    name: "규소강판 M-19 (0.35mm)",
    mur: 4000,
    bsat: 1.8,
    density: 7650,
    alpha: 1.6,
    beta: 2.0,
    refFreq: 60,
    refB: 1.5,
    refLoss: 13005,
    knee: KNEE_SHARP,
    maxFreq: 1000,
    maxTemp: 155,
    cost: 0.25,
    color: 0x8a9099,
    note: "상용 주파수 변압기·리액터의 기본 재료. 고주파에서는 와전류 손실이 급증합니다.",
  },
  {
    id: "grain-oriented-m4",
    name: "방향성 규소강 M4",
    mur: 20000,
    bsat: 1.95,
    density: 7650,
    alpha: 1.6,
    beta: 2.0,
    refFreq: 60,
    refB: 1.7,
    refLoss: 7650,
    knee: KNEE_SHARP,
    maxFreq: 1000,
    maxTemp: 155,
    cost: 0.5,
    color: 0x9aa3ad,
    note: "압연 방향으로 자화하면 손실이 절반. 대형 전력용 변압기 재료입니다.",
  },
  {
    id: "amorphous-2605sa1",
    name: "아몰퍼스 2605SA1",
    mur: 15000,
    bsat: 1.56,
    density: 7180,
    alpha: 1.5,
    beta: 1.8,
    refFreq: 60,
    refB: 1.4,
    refLoss: 1651,
    knee: KNEE_SHARP,
    maxFreq: 20e3,
    maxTemp: 150,
    cost: 2.0,
    color: 0x6f7a86,
    note: "규소강 대비 철손 1/5 수준. 배전용 저손실 변압기에 사용합니다.",
  },
  {
    id: "nanocrystalline",
    name: "나노결정 (Finemet)",
    mur: 30000,
    bsat: 1.23,
    density: 7300,
    alpha: 1.6,
    beta: 2.0,
    refFreq: 20e3,
    refB: 0.2,
    refLoss: 21900,
    knee: KNEE_SHARP,
    maxFreq: 200e3,
    maxTemp: 150,
    cost: 4.0,
    color: 0x7d8894,
    note: "높은 투자율과 낮은 손실. 고주파 대전력·노이즈 필터용.",
  },
  {
    id: "sendust-60",
    name: "센더스트 분말 60μ",
    mur: 60,
    bsat: 1.05,
    density: 5900,
    alpha: 1.46,
    beta: 2.0,
    refFreq: 100e3,
    refB: 0.1,
    refLoss: 65e3,
    knee: KNEE_SOFT,
    maxFreq: 500e3,
    maxTemp: 200,
    cost: 1.3,
    color: 0x6b6560,
    note: "분산 공극 구조라 포화가 완만합니다. DC 바이어스가 큰 인덕터에 유리합니다.",
  },
  {
    id: "mpp-125",
    name: "MPP 분말 125μ",
    mur: 125,
    bsat: 0.75,
    density: 8300,
    alpha: 1.4,
    beta: 2.0,
    refFreq: 100e3,
    refB: 0.1,
    refLoss: 25e3,
    knee: KNEE_SOFT,
    maxFreq: 1e6,
    maxTemp: 200,
    cost: 6.0,
    color: 0x5e6a72,
    note: "분말 코어 중 손실이 가장 낮지만 비쌉니다.",
  },
  {
    id: "iron-powder-26",
    name: "철분말 -26",
    mur: 75,
    bsat: 1.38,
    density: 6800,
    alpha: 1.5,
    beta: 2.2,
    refFreq: 100e3,
    refB: 0.1,
    refLoss: 700e3,
    knee: 2.5,
    maxFreq: 500e3,
    maxTemp: 100,
    cost: 0.15,
    color: 0x7a5347,
    note: "가장 싸지만 고주파 손실이 매우 큽니다. 저주파 초크용.",
  },
  {
    id: "soft-iron",
    name: "연철 (Solid)",
    mur: 5000,
    bsat: 2.15,
    density: 7870,
    alpha: 2.0,
    beta: 2.0,
    refFreq: 60,
    refB: 1.5,
    refLoss: 236000,
    knee: KNEE_SHARP,
    maxFreq: 200,
    maxTemp: 200,
    cost: 0.1,
    color: 0x6e6a66,
    note: "적층이 아니라 통쇠라 AC 와전류 손실이 큽니다. DC 솔레노이드·계전기용.",
  },
];

export const CONDUCTOR_MATERIALS: ConductorMaterial[] = [
  {
    id: "copper",
    name: "구리 (Cu)",
    rho20: 1.724e-8,
    alphaT: 0.00393,
    density: 8960,
    cost: 1.0,
    acFactorCap: Infinity,
    fillPenalty: 1.0,
    color: 0xc27a3a,
    note: "기준 재료. 도전율과 가공성의 균형이 가장 좋습니다.",
  },
  {
    id: "aluminum",
    name: "알루미늄 (Al)",
    rho20: 2.65e-8,
    alphaT: 0.00429,
    density: 2700,
    cost: 0.3,
    acFactorCap: Infinity,
    fillPenalty: 1.0,
    color: 0xb9c0c7,
    note: "저항이 54% 크지만 무게는 1/3, 가격은 1/3. 대형 변압기에 씁니다.",
  },
  {
    id: "silver",
    name: "은 (Ag)",
    rho20: 1.59e-8,
    alphaT: 0.0038,
    density: 10490,
    cost: 80,
    acFactorCap: Infinity,
    fillPenalty: 1.0,
    color: 0xd8dde2,
    note: "구리보다 8% 낮은 저항. 가격 때문에 특수 용도에만 씁니다.",
  },
  {
    id: "litz",
    name: "리츠선 (Litz Cu)",
    rho20: 1.724e-8,
    alphaT: 0.00393,
    density: 8960,
    cost: 6.0,
    acFactorCap: 1.15,
    fillPenalty: 0.7,
    color: 0xd79a5b,
    note: "가는 소선 다발로 표피효과를 억제합니다. 대신 창 면적을 30% 더 씁니다.",
  },
];

const byId = <T extends { id: string }>(list: T[]) =>
  new Map(list.map((item) => [item.id, item]));

const CORE_BY_ID = byId(CORE_MATERIALS);
const CONDUCTOR_BY_ID = byId(CONDUCTOR_MATERIALS);

export function coreMaterial(id: string): CoreMaterial {
  const material = CORE_BY_ID.get(id);
  if (!material) throw new Error(`알 수 없는 코어 재료: ${id}`);
  return material;
}

export function conductorMaterial(id: string): ConductorMaterial {
  const material = CONDUCTOR_BY_ID.get(id);
  if (!material) throw new Error(`알 수 없는 도체 재료: ${id}`);
  return material;
}

/** Steinmetz `k`, back-calculated from the material's datasheet point. */
export function steinmetzK(material: CoreMaterial): number {
  if (material.refLoss <= 0) return 0;
  return (
    material.refLoss /
    (Math.pow(material.refFreq, material.alpha) *
      Math.pow(material.refB, material.beta))
  );
}

/** Volumetric core loss [W/m³] at a frequency and peak flux density. */
export function coreLossDensity(
  material: CoreMaterial,
  freq: number,
  bPeak: number,
): number {
  if (freq <= 0 || bPeak <= 0 || material.refLoss <= 0) return 0;
  return (
    steinmetzK(material) *
    Math.pow(freq, material.alpha) *
    Math.pow(bPeak, material.beta)
  );
}

/** Conductor resistivity at temperature [Ω·m]. */
/** Label for the knee exponent, for display in the UI. */
export function saturationLabel(material: CoreMaterial): SaturationModel {
  return material.knee >= 5 ? "sharp" : "soft";
}

export function resistivityAt(material: ConductorMaterial, tempC: number): number {
  return material.rho20 * (1 + material.alphaT * (tempC - 20));
}

export interface MagnetMaterial {
  id: string;
  name: string;
  /** 잔류 자속밀도 [T]. */
  br: number;
  /** 보자력 [A/m]. */
  hc: number;
  /** 리코일 비투자율 (거의 1). */
  murec: number;
  density: number;
  cost: number;
  maxTemp: number;
  color: number;
  note: string;
}

export const MAGNET_MATERIALS: MagnetMaterial[] = [
  {
    id: "ferrite-magnet",
    name: "페라이트 자석",
    br: 0.39,
    hc: 265e3,
    murec: 1.05,
    density: 4900,
    cost: 0.4,
    maxTemp: 250,
    color: 0x33383d,
    note: "가장 싸고 온도에 강합니다. 대신 자속이 약해 모터가 커집니다.",
  },
  {
    id: "ndfeb-n42",
    name: "네오디뮴 N42",
    br: 1.3,
    hc: 955e3,
    murec: 1.05,
    density: 7500,
    cost: 12,
    maxTemp: 80,
    color: 0xa8adb4,
    note: "가장 강력합니다. 80°C를 넘기면 감자되므로 냉각이 중요합니다.",
  },
  {
    id: "ndfeb-n42sh",
    name: "네오디뮴 N42SH (고온)",
    br: 1.28,
    hc: 1040e3,
    murec: 1.05,
    density: 7500,
    cost: 20,
    maxTemp: 150,
    color: 0x9aa1a8,
    note: "고온 등급 네오디뮴. 차량용 모터에 씁니다.",
  },
  {
    id: "smco",
    name: "사마륨코발트 SmCo",
    br: 1.05,
    hc: 800e3,
    murec: 1.05,
    density: 8300,
    cost: 35,
    maxTemp: 300,
    color: 0x8e959c,
    note: "300°C까지 견디고 부식에 강합니다. 매우 비쌉니다.",
  },
  {
    id: "alnico",
    name: "알니코 AlNiCo",
    br: 1.25,
    hc: 50e3,
    murec: 4,
    density: 7300,
    cost: 8,
    maxTemp: 500,
    color: 0x7d746a,
    note: "잔류 자속은 크지만 보자력이 낮아 반자계에 쉽게 감자됩니다.",
  },
];

const MAGNET_BY_ID = byId(MAGNET_MATERIALS);

export function magnetMaterial(id: string): MagnetMaterial {
  const material = MAGNET_BY_ID.get(id);
  if (!material) throw new Error(`알 수 없는 자석 재료: ${id}`);
  return material;
}
