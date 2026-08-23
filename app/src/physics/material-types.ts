/** Shapes shared by every material table. */

export type SaturationModel = "sharp" | "soft";

/**
 * B-H knee sharpness exponent `n` in
 * `H(B) = B / (mu0*mur) / (1 - (B/Bsat)^n)`.
 *
 * A large `n` keeps permeability flat until B is nearly at saturation and then
 * collapses (ferrite, laminated steel). A small `n` bleeds permeability away
 * from low flux onward but never falls off a cliff -- the distributed gap of a
 * powder core.
 */
export const KNEE_SHARP = 8;
export const KNEE_SOFT = 2;

interface CatalogFields {
  /** Family this variant belongs to, e.g. "무방향성 규소강". */
  family: string;
  /** Search terms: applications, aliases, property words. */
  tags: string[];
  /** How this entry's numbers were arrived at. */
  provenance: string;
}

export interface CoreMaterial extends CatalogFields {
  id: string;
  name: string;
  /** 초기 비투자율. */
  mur: number;
  /** 포화 자속밀도 [T]. */
  bsat: number;
  density: number; // [kg/m³]
  alpha: number;
  beta: number;
  refFreq: number; // [Hz]
  refB: number; // [T]
  refLoss: number; // [W/m³] at (refFreq, refB)
  knee: number;
  maxFreq: number; // [Hz]
  maxTemp: number; // [°C] practical continuous limit
  /** 큐리 온도 [°C]: above this the material is not magnetic at all. */
  curie: number;
  cost: number; // relative per kg, copper = 1.0
  color: number;
  note: string;
}

export interface ConductorMaterial extends CatalogFields {
  id: string;
  name: string;
  rho20: number; // [Ω·m]
  alphaT: number; // [1/K]
  density: number; // [kg/m³]
  cost: number;
  /** Litz bundles cap the AC penalty; solid wire does not. */
  acFactorCap: number;
  /** Fraction of the window a strand of this type can actually use. */
  fillPenalty: number;
  /** Melting point [°C] -- what "the wire fused" means. */
  melting: number;
  color: number;
  note: string;
}

export interface MagnetMaterial extends CatalogFields {
  id: string;
  name: string;
  br: number; // 잔류 자속밀도 [T] at 20 °C
  hc: number; // 고유 보자력 Hcj [A/m]
  murec: number;
  density: number;
  cost: number;
  maxTemp: number; // [°C]
  /** Reversible temperature coefficient of Br [%/K], always negative. */
  brTempCo: number;
  color: number;
  note: string;
}

export interface WireItem extends CatalogFields {
  id: string;
  name: string;
  /** Bare conductor diameter [m]. */
  diameter: number;
  /** Outer diameter including enamel [m]. */
  outerDiameter: number;
  /** Thermal class [°C]. */
  thermalClass: number;
  conductorId: string;
  /** AWG number when the size came from that series, else null. */
  awg: number | null;
  cost: number;
  note: string;
}

export interface InsulationMaterial extends CatalogFields {
  id: string;
  name: string;
  thermalClass: number; // [°C]
  /** 절연 파괴 전계 [kV/mm]. */
  dielectricStrength: number;
  thickness: number; // [m] typical
  thermalConductivity: number; // [W/mK]
  cost: number;
  note: string;
}

export interface StructuralMaterial extends CatalogFields {
  id: string;
  name: string;
  maxTemp: number; // [°C]
  density: number;
  thermalConductivity: number; // [W/mK]
  /** 상대 강성 지표 (굽힘 탄성률 GPa). */
  modulus: number;
  cost: number;
  note: string;
}

export type CoolingMedium = "air" | "liquid" | "conduction";

export interface CoolantOption extends CatalogFields {
  id: string;
  name: string;
  /** Air cooling thins out with altitude; liquid and conduction do not. */
  medium: CoolingMedium;
  /** Heat-transfer coefficient at the device surface [W/m²K]. */
  h: number;
  /** Highest useful temperature [°C]. */
  maxTemp: number;
  /** Extra bulk this cooling method adds, as a relative cost index. */
  cost: number;
  note: string;
}
