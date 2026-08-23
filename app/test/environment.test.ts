import { describe, expect, it } from "vitest";
import { defaultValues, device } from "../src/physics/index";
import {
  airDensityRatio,
  coolingFor,
  DEFAULT_ENVIRONMENT,
  readEnvironment,
} from "../src/physics/environment";
import {
  APPLICATIONS,
  application,
  applicationValues,
  checkApplication,
} from "../src/physics/applications";
import { heatTransferCoefficient, temperatureRise } from "../src/physics/thermal";
import type { Metric, ParamValues } from "../src/physics/types";

const get = (metrics: Metric[], key: string): number => {
  const found = metrics.find((m) => m.key === key);
  if (!found) throw new Error(`metric ${key} 없음`);
  return found.raw;
};

const run = (id: string, overrides: ParamValues = {}) => {
  const definition = device(id);
  return definition.simulate({ ...defaultValues(definition), ...overrides });
};

/** A design that dissipates enough for cooling choices to actually matter. */
const HOT_SOLENOID: ParamValues = { voltage: 24, awg: 28, turns: 1800 };

describe("air and altitude", () => {
  it("thins the air with height, following the standard atmosphere", () => {
    expect(airDensityRatio(0)).toBeCloseTo(1, 6);
    // Density halves around 6.7 km, not at the 5.5 km where pressure does.
    expect(airDensityRatio(6700)).toBeCloseTo(0.5, 1);
    expect(airDensityRatio(12000)).toBeLessThan(0.32);
  });

  it("cools worse at altitude", () => {
    const sea = coolingFor({ ...DEFAULT_ENVIRONMENT, altitude: 0 });
    const high = coolingFor({ ...DEFAULT_ENVIRONMENT, altitude: 8000 });
    expect(high.h).toBeLessThan(sea.h * 0.85);
  });

  it("leaves liquid cooling alone at altitude", () => {
    const sea = coolingFor({ ...DEFAULT_ENVIRONMENT, coolingId: "water-jacket" });
    const high = coolingFor({
      ...DEFAULT_ENVIRONMENT,
      coolingId: "water-jacket",
      altitude: 10000,
    });
    expect(high.h).toBeCloseTo(sea.h, 6);
  });
});

describe("cooling method", () => {
  it("ranks the methods the way a designer would expect", () => {
    const h = (coolingId: string) =>
      coolingFor({ ...DEFAULT_ENVIRONMENT, coolingId }).h;
    expect(h("forced-air-3")).toBeGreaterThan(h("natural-air"));
    expect(h("forced-air-12")).toBeGreaterThan(h("forced-air-3"));
    expect(h("water-jacket")).toBeGreaterThan(h("forced-air-12"));
    expect(h("sealed-enclosure")).toBeLessThan(h("natural-air"));
  });

  it("penalises an enclosure", () => {
    const open = temperatureRise(20, 0.01, DEFAULT_ENVIRONMENT);
    const sealed = temperatureRise(20, 0.01, {
      ...DEFAULT_ENVIRONMENT,
      enclosure: "sealed",
    });
    expect(sealed).toBeGreaterThan(open * 1.8);
  });

  it("drops radiation when the surface is potted over", () => {
    const bare = heatTransferCoefficient(60, DEFAULT_ENVIRONMENT);
    const potted = heatTransferCoefficient(60, {
      ...DEFAULT_ENVIRONMENT,
      enclosure: "potted",
    });
    expect(potted).toBeLessThan(bare);
  });

  it("rewards a blackened surface over a polished one", () => {
    const shiny = heatTransferCoefficient(80, { ...DEFAULT_ENVIRONMENT, emissivity: 0.1 });
    const black = heatTransferCoefficient(80, { ...DEFAULT_ENVIRONMENT, emissivity: 0.95 });
    expect(black).toBeGreaterThan(shiny * 1.4);
  });
});

describe("the environment reaches the device", () => {
  it("carries ambient straight through to part temperature", () => {
    const cool = run("solenoid", { ...HOT_SOLENOID, "env.ambient": 25 });
    const hot = run("solenoid", { ...HOT_SOLENOID, "env.ambient": 85 });
    const shift = get(hot.metrics, "temp") - get(cool.metrics, "temp");
    expect(shift).toBeGreaterThan(25);
    // Less than the 60 K of ambient, because radiation grows as T^4 and sheds
    // the same watts over a smaller rise once everything is hotter.
    expect(shift).toBeLessThan(60);
  });

  it("cools the same design with forced air", () => {
    const natural = run("solenoid", { ...HOT_SOLENOID, "env.cooling": "natural-air" });
    const forced = run("solenoid", { ...HOT_SOLENOID, "env.cooling": "forced-air-6" });
    expect(get(forced.metrics, "temp")).toBeLessThan(get(natural.metrics, "temp") - 30);
  });

  it("heats the same design inside a sealed box", () => {
    const open = run("solenoid", { ...HOT_SOLENOID, "env.enclosure": "none" });
    const sealed = run("solenoid", { ...HOT_SOLENOID, "env.enclosure": "sealed" });
    expect(get(sealed.metrics, "temp")).toBeGreaterThan(get(open.metrics, "temp") + 20);
  });

  it("lets a low duty cycle carry far more power", () => {
    const continuous = run("solenoid", { ...HOT_SOLENOID, "env.duty": 100 });
    const pulsed = run("solenoid", { ...HOT_SOLENOID, "env.duty": 10 });
    expect(get(pulsed.metrics, "temp")).toBeLessThan(get(continuous.metrics, "temp") - 40);
    // Pull is barely affected: the cooler coil has slightly lower resistance,
    // but the holding force is limited by iron saturation either way.
    const ratio = get(pulsed.metrics, "holding") / get(continuous.metrics, "holding");
    expect(ratio).toBeGreaterThan(0.99);
    expect(ratio).toBeLessThan(1.02);
  });

  it("makes altitude visible on an air-cooled design", () => {
    const sea = run("solenoid", { ...HOT_SOLENOID, "env.altitude": 0 });
    const alps = run("solenoid", { ...HOT_SOLENOID, "env.altitude": 9000 });
    expect(get(alps.metrics, "temp")).toBeGreaterThan(get(sea.metrics, "temp") + 5);
  });

  it("reads defaults back when nothing is set", () => {
    expect(readEnvironment({})).toEqual(DEFAULT_ENVIRONMENT);
  });
});

describe("application profiles", () => {
  it("gives every profile a complete requirement set", () => {
    for (const app of APPLICATIONS) {
      expect(app.requirements.maxHotspot).toBeGreaterThan(50);
      expect(app.requirements.insulationClass).toBeGreaterThanOrEqual(130);
      expect(app.requirements.saturationMargin).toBeGreaterThan(0.4);
      expect(app.requirements.saturationMargin).toBeLessThanOrEqual(1);
      expect(app.tags.length).toBeGreaterThan(0);
    }
  });

  it("turns a profile into concrete environment settings", () => {
    const values = applicationValues("automotive-engine");
    expect(values["env.ambient"]).toBe(125);
    expect(values["env.enclosure"]).toBe("sealed");
  });

  it("fails a bench-grade design once it is put under a bonnet", () => {
    const bench = run("solenoid", applicationValues("bench"));
    const engine = run("solenoid", applicationValues("automotive-engine"));
    expect(bench.warnings.filter((w) => w.level === "error")).toHaveLength(0);
    expect(engine.warnings.some((w) => w.level === "error")).toBe(true);
  });

  it("demands a higher insulation class for the harsher profiles", () => {
    expect(application("space").requirements.insulationClass).toBeGreaterThan(
      application("consumer").requirements.insulationClass,
    );
  });

  it("reports every requirement a design misses", () => {
    const warnings = checkApplication(application("medical"), {
      hotspot: 140,
      saturation: 0.95,
      efficiency: 0.5,
      insulationClass: 130,
    });
    expect(warnings.some((w) => w.text.includes("온도"))).toBe(true);
    expect(warnings.some((w) => w.text.includes("포화"))).toBe(true);
  });

  it("says nothing when the design meets the profile", () => {
    const warnings = checkApplication(application("bench"), {
      hotspot: 60,
      saturation: 0.5,
      efficiency: 0.98,
      insulationClass: 180,
    });
    expect(warnings).toEqual([]);
  });
});

describe("insulation class", () => {
  it("flags a winding running past the enamel it was given", () => {
    const result = run("solenoid", {
      ...HOT_SOLENOID,
      voltage: 36,
      insulationClass: "130",
    });
    expect(
      result.warnings.some((w) => w.level === "error" && w.text.includes("절연 등급")),
    ).toBe(true);
  });

  it("accepts the same winding with a better enamel", () => {
    // This winding settles around 182 °C: past Class F, inside Class R.
    const design = { ...HOT_SOLENOID, voltage: 28 };
    const cheap = run("solenoid", { ...design, insulationClass: "130" });
    const upgraded = run("solenoid", { ...design, insulationClass: "220" });
    const exceeded = (r: typeof cheap) =>
      r.warnings.some((w) => w.text.includes("선택한 절연 등급"));
    expect(exceeded(cheap)).toBe(true);
    expect(exceeded(upgraded)).toBe(false);
  });
});
