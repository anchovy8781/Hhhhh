/** The unified, searchable catalog. */

import type {
  CoolantOption,
  ConductorMaterial,
  CoreMaterial,
  InsulationMaterial,
  MagnetMaterial,
  StructuralMaterial,
  WireItem,
} from "../material-types";
import { CORE_MATERIALS } from "./core-materials";
import { CORE_PARTS, type CorePart } from "./core-parts";
import { CONDUCTOR_MATERIALS, WIRES } from "./conductors";
import { MAGNET_MATERIALS } from "./magnets";
import {
  COOLANT_OPTIONS,
  INSULATION_MATERIALS,
  STRUCTURAL_MATERIALS,
} from "./support";
import { KIND_LABELS, type CatalogItem, type CatalogKind } from "./types";

export { KIND_LABELS };
export type { CatalogItem, CatalogKind };
export { CORE_PARTS };
export type { CorePart };
export {
  CORE_MATERIALS,
  CONDUCTOR_MATERIALS,
  WIRES,
  MAGNET_MATERIALS,
  INSULATION_MATERIALS,
  STRUCTURAL_MATERIALS,
  COOLANT_OPTIONS,
};

export type AnyMaterial =
  | CoreMaterial
  | ConductorMaterial
  | WireItem
  | MagnetMaterial
  | InsulationMaterial
  | StructuralMaterial
  | CoolantOption
  | CorePart;

/** One row of the searchable index: identity plus what it belongs to. */
export interface IndexedItem extends CatalogItem {
  /** A one-line summary of the properties that matter for this kind. */
  summary: string;
  /** Lower-cased haystack, precomputed so search does no work per query. */
  haystack: string;
}

const summaries: Record<CatalogKind, (item: never) => string> = {
  core: (m: CoreMaterial) =>
    `µr ${m.mur.toLocaleString()} · Bsat ${isFinite(m.bsat) ? `${m.bsat} T` : "없음"} · ~${Math.round(m.maxFreq / 1000)} kHz`,
  conductor: (m: ConductorMaterial) =>
    `ρ ${(m.rho20 * 1e8).toFixed(2)}e-8 Ω·m · ${m.density} kg/m³`,
  wire: (m: WireItem) =>
    `⌀ ${(m.diameter * 1e3).toFixed(3)} mm · 열등급 ${m.thermalClass}°C`,
  magnet: (m: MagnetMaterial) => `Br ${m.br} T · ${m.maxTemp}°C 까지`,
  insulation: (m: InsulationMaterial) =>
    `${m.thermalClass}°C · ${m.dielectricStrength} kV/mm`,
  structural: (m: StructuralMaterial) =>
    `${m.maxTemp}°C · 열전도 ${m.thermalConductivity} W/mK`,
  coolant: (m: CoolantOption) => `h ≈ ${m.h} W/m²K · ${m.maxTemp}°C 까지`,
  corepart: (m: CorePart) =>
    m.shape === "toroid"
      ? `⌀${m.outerDiameter}/${m.innerDiameter} × ${m.height} mm · Ae ${m.ae.toFixed(0)} mm²`
      : `중앙다리 ${m.tongue} × 적층 ${m.stack} mm · Ae ${m.ae.toFixed(0)} mm²`,
} as Record<CatalogKind, (item: never) => string>;

function index<T extends AnyMaterial>(kind: CatalogKind, items: T[]): IndexedItem[] {
  const summarise = summaries[kind] as unknown as (item: T) => string;
  return items.map((item) => {
    const summary = summarise(item);
    return {
      id: item.id,
      kind,
      name: item.name,
      family: item.family,
      tags: item.tags,
      provenance: item.provenance,
      note: item.note,
      summary,
      haystack: [item.id, item.name, item.family, summary, item.note, ...item.tags]
        .join(" ")
        .toLowerCase(),
    };
  });
}

export const CATALOG: IndexedItem[] = [
  ...index("core", CORE_MATERIALS),
  ...index("conductor", CONDUCTOR_MATERIALS),
  ...index("wire", WIRES),
  ...index("magnet", MAGNET_MATERIALS),
  ...index("insulation", INSULATION_MATERIALS),
  ...index("structural", STRUCTURAL_MATERIALS),
  ...index("coolant", COOLANT_OPTIONS),
  ...index("corepart", CORE_PARTS),
];

export const CATALOG_BY_KIND: Record<CatalogKind, IndexedItem[]> = CATALOG.reduce(
  (acc, item) => {
    (acc[item.kind] ||= []).push(item);
    return acc;
  },
  {} as Record<CatalogKind, IndexedItem[]>,
);

/**
 * Search the catalog.
 *
 * Every space-separated term must match somewhere, so "페라이트 고주파" narrows
 * instead of widening. An exact id or name match outranks a tag match, which
 * outranks a description match -- typing "N87" should not bury N87 under the
 * dozen grades that merely mention it.
 */
export function searchCatalog(
  query: string,
  options: { kind?: CatalogKind; limit?: number } = {},
): IndexedItem[] {
  const pool = options.kind ? (CATALOG_BY_KIND[options.kind] ?? []) : CATALOG;
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const limit = options.limit ?? 60;
  if (terms.length === 0) return pool.slice(0, limit);

  const scored: { item: IndexedItem; score: number }[] = [];
  for (const item of pool) {
    let score = 0;
    let matchedAll = true;
    for (const term of terms) {
      if (!item.haystack.includes(term)) {
        matchedAll = false;
        break;
      }
      const name = item.name.toLowerCase();
      if (item.id.toLowerCase() === term || name === term) score += 100;
      else if (name.includes(term)) score += 40;
      else if (item.tags.some((tag) => tag.toLowerCase() === term)) score += 25;
      else if (item.family.toLowerCase().includes(term)) score += 15;
      else score += 5;
    }
    if (matchedAll) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return scored.slice(0, limit).map((entry) => entry.item);
}
