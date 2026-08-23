/**
 * The material catalog.
 *
 * Over a thousand entries cannot be hand-written, and a thousand invented
 * datasheets would be worse than none. Real catalogs are combinatorial —
 * a powder-core family ships in a dozen permeabilities, a steel grade in six
 * thicknesses, a magnet grade in seven temperature classes — so this catalog
 * is generated the same way: a family carries the measured anchor values, and
 * variants are derived from it by documented physical relationships.
 *
 * Every entry records the family and the derivation it came from in
 * `provenance`, so a number can always be traced back to what produced it.
 */

export type CatalogKind =
  | "core"
  | "conductor"
  | "wire"
  | "magnet"
  | "insulation"
  | "structural"
  | "coolant"
  | "corepart";

export const KIND_LABELS: Record<CatalogKind, string> = {
  core: "자성 코어",
  conductor: "도체",
  wire: "권선 (마그넷와이어)",
  magnet: "영구자석",
  insulation: "절연물",
  structural: "구조재 · 보빈",
  coolant: "냉각 · 방열",
  corepart: "표준 코어 규격",
};

export interface CatalogItem {
  id: string;
  kind: CatalogKind;
  /** Display name, e.g. "페라이트 N87". */
  name: string;
  /** Family this variant belongs to, e.g. "MnZn 페라이트". */
  family: string;
  /** Free-text search tags: applications, aliases, vendors, properties. */
  tags: string[];
  /** How this entry's numbers were arrived at. */
  provenance: string;
  note: string;
}
