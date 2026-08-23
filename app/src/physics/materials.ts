/**
 * Material lookup and the property functions built on it.
 *
 * The tables themselves live in `catalog/`; this module is the door the
 * physics code goes through.
 */

import {
  CONDUCTOR_MATERIALS,
  COOLANT_OPTIONS,
  CORE_MATERIALS,
  INSULATION_MATERIALS,
  MAGNET_MATERIALS,
  STRUCTURAL_MATERIALS,
  WIRES,
} from "./catalog/index";
import type {
  ConductorMaterial,
  CoolantOption,
  CoreMaterial,
  InsulationMaterial,
  MagnetMaterial,
  SaturationModel,
  StructuralMaterial,
  WireItem,
} from "./material-types";

export * from "./material-types";
export {
  CORE_MATERIALS,
  CONDUCTOR_MATERIALS,
  MAGNET_MATERIALS,
  WIRES,
  INSULATION_MATERIALS,
  STRUCTURAL_MATERIALS,
  COOLANT_OPTIONS,
};

/**
 * Ids that older saved designs and presets used, before the catalog was
 * generated from families. Keeping them resolvable costs one map and means a
 * stored design never silently loses its material.
 */
const ALIASES: Record<string, string> = {
  "silicon-steel-m19": "steel-m19-035",
  "grain-oriented-m4": "steel-m4-027",
  nanocrystalline: "nanocrystalline-ft3",
  "iron-powder-26": "ironpowder-33",
  aluminum: "aluminum-1350",
  litz: "litz-38-100",
  "ferrite-magnet": "ferrite-magnet-y30",
};

function lookup<T extends { id: string }>(
  list: T[],
  label: string,
): (id: string) => T {
  const byId = new Map(list.map((item) => [item.id, item]));
  return (id: string) => {
    const found = byId.get(id) ?? byId.get(ALIASES[id] ?? "");
    if (!found) throw new Error(`알 수 없는 ${label}: ${id}`);
    return found;
  };
}

export const coreMaterial = lookup<CoreMaterial>(CORE_MATERIALS, "코어 재료");
export const conductorMaterial = lookup<ConductorMaterial>(CONDUCTOR_MATERIALS, "도체 재료");
export const magnetMaterial = lookup<MagnetMaterial>(MAGNET_MATERIALS, "자석 재료");
export const wireItem = lookup<WireItem>(WIRES, "권선");
export const insulationMaterial = lookup<InsulationMaterial>(INSULATION_MATERIALS, "절연물");
export const structuralMaterial = lookup<StructuralMaterial>(STRUCTURAL_MATERIALS, "구조재");
export const coolantOption = lookup<CoolantOption>(COOLANT_OPTIONS, "냉각 방식");

/** Label for the knee exponent, for display in the UI. */
export function saturationLabel(material: CoreMaterial): SaturationModel {
  return material.knee >= 5 ? "sharp" : "soft";
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
export function resistivityAt(material: ConductorMaterial, tempC: number): number {
  return material.rho20 * (1 + material.alphaT * (tempC - 20));
}

/**
 * Saturation flux density at temperature [T].
 *
 * Magnetisation collapses as a material approaches its Curie point; the
 * classical mean-field exponent of 1/2 in `(1 - T/Tc)` captures the shape well
 * enough to tell a designer that a 150 °C ferrite has lost a third of its
 * headroom.
 */
export function saturationAt(material: CoreMaterial, tempC: number): number {
  if (!isFinite(material.bsat)) return material.bsat;
  const curie = material.curie;
  if (tempC >= curie) return 0;
  // Datasheets quote saturation at 25 °C, so normalise there.
  const reference = Math.pow(1 - 298 / (curie + 273), 0.5);
  const now = Math.pow(1 - (tempC + 273) / (curie + 273), 0.5);
  return material.bsat * (now / reference);
}

/** Magnet remanence at temperature [T], from its reversible coefficient. */
export function remanenceAt(material: MagnetMaterial, tempC: number): number {
  return Math.max(0, material.br * (1 + (material.brTempCo / 100) * (tempC - 20)));
}
