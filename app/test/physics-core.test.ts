import { describe, expect, it } from "vitest";
import { MU0 } from "../src/physics/constants";
import {
  CORE_MATERIALS,
  coreLossDensity,
  coreMaterial,
  conductorMaterial,
  resistivityAt,
} from "../src/physics/materials";
import {
  awgArea,
  awgDiameter,
  acResistanceFactor,
  analyzeWinding,
  skinDepth,
} from "../src/physics/wire";
import {
  coreFieldStrength,
  coreMetrics,
  effectivePermeability,
  fluxDensity,
  inductanceAtZero,
  currentForFluxDensity,
  inductanceCurve,
  operatingPoint,
  permeabilityRatio,
  saturationCurrent,
  type ToroidDims,
} from "../src/physics/magnetics";

const TOROID: ToroidDims = {
  shape: "toroid",
  od: 40e-3,
  id: 20e-3,
  height: 10e-3,
};

describe("wire tables", () => {
  it("matches the AWG standard", () => {
    // AWG 36 is the definition point; 10 and 20 are common reference sizes.
    expect(awgDiameter(36) * 1e3).toBeCloseTo(0.127, 4);
    expect(awgDiameter(10) * 1e3).toBeCloseTo(2.588, 2);
    expect(awgDiameter(20) * 1e3).toBeCloseTo(0.812, 2);
  });

  it("gives the textbook resistance per metre for AWG20 copper", () => {
    const copper = conductorMaterial("copper");
    const ohmsPerMetre = copper.rho20 / awgArea(20);
    expect(ohmsPerMetre * 1e3).toBeCloseTo(33.3, 0); // 33.3 mOhm/m
  });

  it("reproduces the 0.21 mm copper skin depth at 100 kHz", () => {
    const copper = conductorMaterial("copper");
    expect(skinDepth(copper, 100e3, 20) * 1e3).toBeCloseTo(0.206, 2);
  });

  it("has no AC penalty at DC and a real one at high frequency", () => {
    const copper = conductorMaterial("copper");
    expect(acResistanceFactor(copper, 20, 0, 3, 20)).toBe(1);
    const factor = acResistanceFactor(copper, 16, 500e3, 4, 20);
    expect(factor).toBeGreaterThan(2);
  });

  it("caps the AC penalty for litz wire", () => {
    const litz = conductorMaterial("litz");
    expect(acResistanceFactor(litz, 16, 500e3, 4, 20)).toBeLessThanOrEqual(1.15);
  });

  it("raises resistance with temperature", () => {
    const copper = conductorMaterial("copper");
    // Copper gains ~0.393 %/K, so 100 K of rise is about +39 %.
    expect(resistivityAt(copper, 120) / copper.rho20).toBeCloseTo(1.393, 2);
  });

  it("counts layers from the window height", () => {
    const copper = conductorMaterial("copper");
    const winding = analyzeWinding({
      material: copper,
      turns: 100,
      awg: 20,
      meanTurnLength: 0.05,
      windowHeight: 20e-3,
      freq: 0,
      tempC: 25,
    });
    expect(winding.length).toBeCloseTo(5, 6);
    expect(winding.layers).toBeGreaterThan(1);
    expect(winding.rdc).toBeCloseTo(
      (0.05 * 100 * resistivityAt(copper, 25)) / awgArea(20),
      9,
    );
  });
});

describe("core geometry", () => {
  it("computes toroid area and path length from the dimensions", () => {
    const metrics = coreMetrics(TOROID, coreMaterial("ferrite-n87"));
    expect(metrics.ae).toBeCloseTo(10e-3 * 10e-3, 9); // radial 10 mm x height 10 mm
    expect(metrics.le).toBeCloseTo(Math.PI * 30e-3, 6);
    expect(metrics.aw).toBeCloseTo(Math.PI * 10e-3 * 10e-3, 9);
    expect(metrics.mass).toBeCloseTo(metrics.ve * 4850, 9);
  });
});

describe("magnetic circuit", () => {
  it("gives the classic air-core toroid inductance", () => {
    const air = coreMaterial("air");
    const metrics = coreMetrics(TOROID, air);
    const expected = (MU0 * 100 * 100 * metrics.ae) / metrics.le;
    expect(inductanceAtZero(air, metrics, 0, 100)).toBeCloseTo(expected, 12);
    expect(expected * 1e6).toBeCloseTo(13.3, 1); // ~13.3 uH
  });

  it("scales inductance with the square of the turns", () => {
    const material = coreMaterial("ferrite-n87");
    const metrics = coreMetrics(TOROID, material);
    const l100 = inductanceAtZero(material, metrics, 0, 100);
    const l200 = inductanceAtZero(material, metrics, 0, 200);
    expect(l200 / l100).toBeCloseTo(4, 6);
  });

  it("drops the effective permeability when a gap is introduced", () => {
    const material = coreMaterial("ferrite-n87");
    const metrics = coreMetrics(TOROID, material);
    const mue = effectivePermeability(material, metrics, 1e-3);
    // mu_e = mu_r / (1 + mu_r*g/le)
    expect(mue).toBeCloseTo(2200 / (1 + (2200 * 1e-3) / metrics.le), 6);
    expect(mue).toBeLessThan(200);
  });

  it("keeps going past saturation at the slope of air", () => {
    const material = coreMaterial("ferrite-n87");
    const metrics = coreMetrics(TOROID, material);
    const b = fluxDensity(material, metrics, 0, 100 * 50); // absurd drive
    // Every domain is already aligned, so the core is now just vacuum: B keeps
    // climbing, but at mu0 rather than mu0*mur.
    expect(b).toBeGreaterThan(material.bsat);
    const unsaturated = (MU0 * material.mur * 100 * 50) / metrics.le;
    expect(b).toBeLessThan(unsaturated / 100);
  });

  it("adds exactly the free-space slope once fully saturated", () => {
    const material = coreMaterial("ferrite-n87");
    const above = material.bsat * 1.2;
    const higher = material.bsat * 1.3;
    const slope =
      (higher - above) /
      (coreFieldStrength(material, higher) - coreFieldStrength(material, above));
    expect(slope).toBeCloseTo(MU0, 9);
  });

  it("stays linear well below the knee", () => {
    const material = coreMaterial("ferrite-n87");
    const metrics = coreMetrics(TOROID, material);
    const op = operatingPoint(material, metrics, 0, 100, 0.001);
    const linear = (MU0 * material.mur * 100 * 0.001) / metrics.le;
    expect(op.b).toBeCloseTo(linear, 4);
    expect(op.saturationRatio).toBeLessThan(0.1);
  });

  it("collapses inductance past the saturation knee", () => {
    const material = coreMaterial("ferrite-n87");
    const metrics = coreMetrics(TOROID, material);
    const isat = saturationCurrent(material, metrics, 0, 100);
    const before = operatingPoint(material, metrics, 0, 100, isat * 0.3);
    const after = operatingPoint(material, metrics, 0, 100, isat * 3);
    expect(after.incremental).toBeLessThan(before.incremental * 0.2);
  });

  it("lets a gapped core carry far more current", () => {
    const material = coreMaterial("ferrite-n87");
    const metrics = coreMetrics(TOROID, material);
    const solid = saturationCurrent(material, metrics, 0, 100);
    const gap1 = saturationCurrent(material, metrics, 1e-3, 100);
    const gap2 = saturationCurrent(material, metrics, 2e-3, 100);
    expect(gap1).toBeGreaterThan(solid * 10);
    expect(gap2).toBeGreaterThan(gap1 * 1.5);
  });

  it("trades inductance for current headroom when gapping", () => {
    const material = coreMaterial("ferrite-n87");
    const metrics = coreMetrics(TOROID, material);
    const l0 = inductanceAtZero(material, metrics, 0, 100);
    const lGapped = inductanceAtZero(material, metrics, 1e-3, 100);
    // Energy handling is what actually improves: 0.5*L*I^2 goes up even
    // though L itself drops by more than an order of magnitude.
    const energy = (l: number, i: number) => 0.5 * l * i * i;
    expect(lGapped).toBeLessThan(l0 / 10);
    expect(
      energy(lGapped, saturationCurrent(material, metrics, 1e-3, 100)),
    ).toBeGreaterThan(energy(l0, saturationCurrent(material, metrics, 0, 100)));
  });

  it("reaches a requested flux density at the expected current", () => {
    const material = coreMaterial("ferrite-n87");
    const metrics = coreMetrics(TOROID, material);
    const current = currentForFluxDensity(material, metrics, 0, 100, 0.2);
    const op = operatingPoint(material, metrics, 0, 100, current);
    expect(op.b).toBeCloseTo(0.2, 3);
  });

  it("keeps ferrite permeability flat until the knee", () => {
    const ferrite = coreMaterial("ferrite-n87");
    const sendust = coreMaterial("sendust-60");
    // At half of saturation the ferrite has barely moved; the powder core has
    // already given up a quarter of its permeability to the distributed gap.
    expect(permeabilityRatio(ferrite, ferrite.bsat * 0.5)).toBeGreaterThan(0.99);
    expect(permeabilityRatio(sendust, sendust.bsat * 0.5)).toBeLessThan(0.8);
  });

  it("collapses powder cores more gradually than ferrite", () => {
    const span = (id: string) => {
      const material = coreMaterial(id);
      const metrics = coreMetrics(TOROID, material);
      // Current range over which inductance falls from 90 % to 10 % of L0.
      return (
        saturationCurrent(material, metrics, 0, 100, 0.1) /
        saturationCurrent(material, metrics, 0, 100, 0.9)
      );
    };
    expect(span("sendust-60")).toBeGreaterThan(span("ferrite-n87") * 2);
  });

  it("produces a monotonically falling inductance curve", () => {
    const material = coreMaterial("ferrite-n87");
    const metrics = coreMetrics(TOROID, material);
    const isat = saturationCurrent(material, metrics, 0.5e-3, 60);
    const curve = inductanceCurve(material, metrics, 0.5e-3, 60, isat * 2, 20);
    expect(curve).toHaveLength(20);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!.inductance).toBeLessThanOrEqual(curve[i - 1]!.inductance + 1e-9);
    }
  });

  it("treats an air core as unsaturable", () => {
    const air = coreMaterial("air");
    const metrics = coreMetrics(TOROID, air);
    expect(saturationCurrent(air, metrics, 0, 100)).toBe(Infinity);
    const op = operatingPoint(air, metrics, 0, 100, 50);
    expect(op.saturationRatio).toBe(0);
  });
});

describe("core loss", () => {
  it("reproduces each datasheet reference point exactly", () => {
    for (const material of CORE_MATERIALS) {
      if (material.refLoss <= 0) continue;
      const loss = coreLossDensity(material, material.refFreq, material.refB);
      expect(loss / material.refLoss).toBeCloseTo(1, 6);
    }
  });

  it("follows the Steinmetz exponents away from the reference point", () => {
    const material = coreMaterial("ferrite-n87");
    const doubled = coreLossDensity(material, material.refFreq * 2, material.refB);
    expect(doubled / material.refLoss).toBeCloseTo(Math.pow(2, material.alpha), 4);
    const halfB = coreLossDensity(material, material.refFreq, material.refB / 2);
    expect(halfB / material.refLoss).toBeCloseTo(Math.pow(0.5, material.beta), 4);
  });

  it("ranks the low-loss materials correctly at 60 Hz", () => {
    const at = (id: string) => coreLossDensity(coreMaterial(id), 60, 1.4);
    expect(at("amorphous-2605sa1")).toBeLessThan(at("grain-oriented-m4"));
    expect(at("grain-oriented-m4")).toBeLessThan(at("silicon-steel-m19"));
    expect(at("silicon-steel-m19")).toBeLessThan(at("soft-iron"));
  });

  it("reports no loss for an air core", () => {
    expect(coreLossDensity(coreMaterial("air"), 100e3, 0.2)).toBe(0);
  });
});
