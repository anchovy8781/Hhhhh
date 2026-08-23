import { describe, expect, it } from "vitest";
import {
  CATALOG,
  CATALOG_BY_KIND,
  CORE_PARTS,
  KIND_LABELS,
  searchCatalog,
  type CatalogKind,
} from "../src/physics/catalog/index";
import {
  CONDUCTOR_MATERIALS,
  CORE_MATERIALS,
  MAGNET_MATERIALS,
  WIRES,
  coreLossDensity,
  coreMaterial,
  conductorMaterial,
  magnetMaterial,
  remanenceAt,
  saturationAt,
} from "../src/physics/materials";

describe("catalog coverage", () => {
  it("holds more than a thousand selectable entries", () => {
    expect(CATALOG.length).toBeGreaterThan(1000);
  });

  it("covers every declared kind", () => {
    for (const kind of Object.keys(KIND_LABELS) as CatalogKind[]) {
      expect(CATALOG_BY_KIND[kind]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("has no duplicate ids", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const item of CATALOG) {
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) duplicates.push(key);
      seen.set(key, item.name);
    }
    expect(duplicates).toEqual([]);
  });

  it("says where every entry's numbers came from", () => {
    const missing = CATALOG.filter(
      (item) => !item.provenance || !item.family || item.tags.length === 0,
    );
    expect(missing.map((item) => item.id)).toEqual([]);
  });
});

describe("catalog search", () => {
  it("puts an exact grade first", () => {
    expect(searchCatalog("n87")[0]!.name).toBe("페라이트 N87");
    expect(searchCatalog("etd39")[0]!.name).toContain("ETD39");
  });

  it("narrows as terms are added", () => {
    const broad = searchCatalog("페라이트", { limit: 500 }).length;
    const narrow = searchCatalog("페라이트 고주파", { limit: 500 }).length;
    expect(narrow).toBeGreaterThan(0);
    expect(narrow).toBeLessThan(broad);
  });

  it("requires every term to match", () => {
    expect(searchCatalog("페라이트 존재하지않는단어")).toEqual([]);
  });

  it("filters by kind", () => {
    const wires = searchCatalog("구리", { kind: "wire", limit: 200 });
    expect(wires.length).toBeGreaterThan(0);
    expect(wires.every((item) => item.kind === "wire")).toBe(true);
  });

  it("finds materials by what they are used for, not just their name", () => {
    expect(searchCatalog("커먼모드", { limit: 50 }).length).toBeGreaterThan(0);
    expect(searchCatalog("항공", { limit: 50 }).length).toBeGreaterThan(0);
    expect(searchCatalog("수냉", { limit: 50 }).length).toBeGreaterThan(0);
  });

  it("returns the head of the list for an empty query", () => {
    expect(searchCatalog("", { limit: 5 })).toHaveLength(5);
  });
});

describe("generated material values stay physical", () => {
  it("keeps every core material's numbers in range", () => {
    for (const material of CORE_MATERIALS) {
      expect(material.mur).toBeGreaterThan(0);
      expect(material.bsat).toBeGreaterThan(0);
      expect(material.refLoss).toBeGreaterThanOrEqual(0);
      expect(material.knee).toBeGreaterThan(1);
      // A material cannot be used above the point where it stops being magnetic.
      expect(material.maxTemp).toBeLessThan(material.curie);
    }
  });

  it("reproduces every core material's own datasheet loss point", () => {
    for (const material of CORE_MATERIALS) {
      if (material.refLoss <= 0) continue;
      const loss = coreLossDensity(material, material.refFreq, material.refB);
      expect(loss / material.refLoss).toBeCloseTo(1, 6);
    }
  });

  it("scales lamination loss with the square of thickness", () => {
    const thin = coreMaterial("steel-m19-023");
    const thick = coreMaterial("steel-m19-05");
    expect(thick.refLoss).toBeGreaterThan(thin.refLoss);
    // Only the eddy-current share scales, so the ratio is well under (0.5/0.23)^2.
    expect(thick.refLoss / thin.refLoss).toBeLessThan(Math.pow(0.5 / 0.23, 2));
  });

  it("charges powder cores more loss at higher permeability", () => {
    const low = coreMaterial("sendust-26");
    const high = coreMaterial("sendust-125");
    expect(high.refLoss).toBeGreaterThan(low.refLoss);
    expect(high.mur / low.mur).toBeCloseTo(125 / 26, 6);
  });

  it("keeps every conductor's resistivity in a metal's range", () => {
    for (const material of CONDUCTOR_MATERIALS) {
      expect(material.rho20, material.id).toBeGreaterThan(1e-8);
      // Resistance alloys (nichrome, manganin) sit at the top of this range;
      // anything beyond it is not a conductor this engine can model.
      expect(material.rho20, material.id).toBeLessThan(2e-6);
      expect(material.melting, material.id).toBeGreaterThan(300);
    }
  });

  it("caps the AC penalty only for litz constructions", () => {
    expect(conductorMaterial("copper").acFactorCap).toBe(Infinity);
    expect(conductorMaterial("litz-38-100").acFactorCap).toBeLessThan(1.3);
  });

  it("keeps every wire's insulated diameter above its bare diameter", () => {
    for (const wire of WIRES) {
      expect(wire.outerDiameter).toBeGreaterThan(wire.diameter);
      expect(wire.diameter).toBeGreaterThan(0);
      expect(wire.thermalClass).toBeGreaterThanOrEqual(130);
    }
  });

  it("pairs every magnet grade with a plausible coercivity and limit", () => {
    for (const magnet of MAGNET_MATERIALS) {
      expect(magnet.br).toBeGreaterThan(0.2);
      expect(magnet.br).toBeLessThan(1.6);
      expect(magnet.hc).toBeGreaterThan(1e4);
      expect(magnet.brTempCo).toBeLessThan(0);
    }
  });

  it("refuses the magnet grades that cannot be manufactured", () => {
    const ids = MAGNET_MATERIALS.map((m) => m.id);
    expect(ids).toContain("ndfeb-n52");
    // The strongest grades cannot also carry the highest coercivity classes.
    expect(ids).not.toContain("ndfeb-n52ah");
    expect(ids).not.toContain("ndfeb-n55eh");
  });
});

describe("temperature derating", () => {
  it("shrinks saturation as a core approaches its Curie point", () => {
    const ferrite = coreMaterial("ferrite-n87");
    expect(saturationAt(ferrite, 25)).toBeCloseTo(ferrite.bsat, 2);
    expect(saturationAt(ferrite, 100)).toBeLessThan(ferrite.bsat * 0.9);
    expect(saturationAt(ferrite, ferrite.curie)).toBe(0);
  });

  it("weakens a magnet with temperature at its own coefficient", () => {
    const neo = magnetMaterial("ndfeb-n42");
    const smco = magnetMaterial("sm2co17-26");
    const drop = (m: typeof neo) => 1 - remanenceAt(m, 120) / m.br;
    // SmCo loses about a third as much per kelvin as neodymium.
    expect(drop(neo)).toBeGreaterThan(drop(smco) * 2.5);
  });
});

describe("standard core parts", () => {
  it("gives every part usable geometry", () => {
    for (const part of CORE_PARTS) {
      expect(part.ae).toBeGreaterThan(0);
      expect(part.le).toBeGreaterThan(0);
      if (part.shape === "toroid") {
        expect(part.outerDiameter!).toBeGreaterThan(part.innerDiameter!);
        expect(part.height!).toBeGreaterThan(0);
      } else {
        expect(part.tongue!).toBeGreaterThan(0);
        expect(part.windowWidth!).toBeGreaterThan(0);
      }
    }
  });

  it("grows the effective area with the series size", () => {
    const small = CORE_PARTS.find((p) => p.id === "core-etd29")!;
    const large = CORE_PARTS.find((p) => p.id === "core-etd59")!;
    expect(large.ae).toBeGreaterThan(small.ae * 3);
  });
});

describe("legacy identifiers", () => {
  it("still resolves the ids older designs were saved with", () => {
    expect(coreMaterial("silicon-steel-m19").id).toBe("steel-m19-035");
    expect(conductorMaterial("aluminum").id).toBe("aluminum-1350");
    expect(magnetMaterial("ferrite-magnet").family).toBe("페라이트 자석");
  });

  it("still rejects an id that never existed", () => {
    expect(() => coreMaterial("unobtainium")).toThrow();
  });
});
