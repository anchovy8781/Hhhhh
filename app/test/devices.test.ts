import { describe, expect, it } from "vitest";
import { DEVICES, defaultValues, device } from "../src/physics";
import { CATALOG_BY_KIND, type CatalogKind } from "../src/physics/catalog/index";
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

describe("device registry", () => {
  it("exposes every device under a unique id", () => {
    expect(DEVICES.length).toBeGreaterThanOrEqual(5);
    expect(new Set(DEVICES.map((d) => d.id)).size).toBe(DEVICES.length);
  });

  it("simulates every device at its defaults without throwing", () => {
    for (const definition of DEVICES) {
      const result = definition.simulate(defaultValues(definition));
      expect(result.metrics.length).toBeGreaterThan(5);
      expect(result.build.kind).toBeTruthy();
      for (const m of result.metrics) expect(Number.isFinite(m.raw)).toBe(true);
    }
  });

  it("gives every parameter a default inside its own range", () => {
    for (const definition of DEVICES) {
      for (const param of definition.params) {
        if (param.kind === "number") {
          expect(param.default).toBeGreaterThanOrEqual(param.min);
          expect(param.default).toBeLessThanOrEqual(param.max);
        } else if (param.kind === "choice") {
          expect(param.options.map((o) => o.value)).toContain(param.default);
        } else {
          const pool = CATALOG_BY_KIND[param.catalog as CatalogKind] ?? [];
          expect(pool.map((item) => item.id)).toContain(param.default);
        }
      }
    }
  });
});

describe("인덕터", () => {
  it("quadruples inductance when turns double", () => {
    const a = run("inductor", { turns: 40, idc: 0.01 });
    const b = run("inductor", { turns: 80, idc: 0.01 });
    expect(get(b.metrics, "L0") / get(a.metrics, "L0")).toBeCloseTo(4, 1);
  });

  it("trades inductance for saturation current when a gap is added", () => {
    const solid = run("inductor", { gap: 0 });
    const gapped = run("inductor", { gap: 1 });
    expect(get(gapped.metrics, "L0")).toBeLessThan(get(solid.metrics, "L0"));
    expect(get(gapped.metrics, "isat")).toBeGreaterThan(get(solid.metrics, "isat"));
  });

  it("flags an operating point past saturation", () => {
    const result = run("inductor", { idc: 60, gap: 0 });
    expect(result.warnings.some((w) => w.level === "error")).toBe(true);
  });

  it("lowers resistance with thicker wire", () => {
    const thin = run("inductor", { awg: 26 });
    const thick = run("inductor", { awg: 16 });
    expect(get(thick.metrics, "rdc")).toBeLessThan(get(thin.metrics, "rdc"));
  });

  it("charges more window area for the same turns of thicker wire", () => {
    const thin = run("inductor", { awg: 26 });
    const thick = run("inductor", { awg: 16 });
    expect(get(thick.metrics, "fill")).toBeGreaterThan(get(thin.metrics, "fill"));
  });

  it("refuses a winding that cannot physically fit", () => {
    const result = run("inductor", { turns: 900, awg: 12 });
    expect(get(result.metrics, "fill")).toBeGreaterThan(1);
    expect(result.warnings.some((w) => w.level === "error")).toBe(true);
  });

  it("charges aluminium more resistance than copper", () => {
    const cu = run("inductor", { conductor: "copper" });
    const al = run("inductor", { conductor: "aluminum" });
    const ratio = get(al.metrics, "rdc") / get(cu.metrics, "rdc");
    // The cold ratio is 2.65/1.724 = 1.54. Aluminium runs hotter and has the
    // larger temperature coefficient, so at the operating point the penalty is
    // worse than the datasheet ratio suggests.
    expect(ratio).toBeGreaterThan(1.54);
    expect(ratio).toBeLessThan(1.9);
    expect(get(al.metrics, "mass")).toBeLessThan(get(cu.metrics, "mass"));
  });

  it("raises core loss with frequency", () => {
    const slow = run("inductor", { freq: 50e3 });
    const fast = run("inductor", { freq: 200e3 });
    expect(get(fast.metrics, "pfe")).toBeGreaterThan(get(slow.metrics, "pfe"));
  });

  it("reports zero core loss for an air core", () => {
    const result = run("inductor", { coreMaterial: "air" });
    expect(get(result.metrics, "pfe")).toBe(0);
  });

  it("produces a falling L-I curve with an operating marker", () => {
    const result = run("inductor");
    const curve = result.curves[0]!;
    expect(curve.points.length).toBeGreaterThan(20);
    expect(curve.marker).toBeTruthy();
    expect(curve.points.at(-1)!.y).toBeLessThan(curve.points[0]!.y);
  });
});

describe("변압기", () => {
  it("follows the turns ratio", () => {
    const result = run("transformer", { np: 480, ns: 48, pout: 0 });
    expect(get(result.metrics, "ratio")).toBeCloseTo(10, 6);
    expect(get(result.metrics, "vout")).toBeCloseTo(22, 0);
  });

  it("sets flux density from volts per turn, not from the load", () => {
    const light = run("transformer", { pout: 10 });
    const heavy = run("transformer", { pout: 400 });
    expect(get(heavy.metrics, "bpeak")).toBeCloseTo(get(light.metrics, "bpeak"), 6);
  });

  it("halves flux density when the turns double", () => {
    const few = run("transformer", { np: 300, ns: 30 });
    const many = run("transformer", { np: 600, ns: 60 });
    expect(get(many.metrics, "bpeak")).toBeCloseTo(get(few.metrics, "bpeak") / 2, 4);
  });

  it("saturates at 60 Hz with too few turns and says how many are needed", () => {
    const result = run("transformer", { np: 40, ns: 4 });
    const error = result.warnings.find((w) => w.level === "error" && w.text.includes("턴"));
    expect(error).toBeTruthy();
  });

  it("droops the output voltage under load", () => {
    const light = run("transformer", { pout: 5 });
    const heavy = run("transformer", { pout: 300 });
    expect(get(heavy.metrics, "vout")).toBeLessThan(get(light.metrics, "vout"));
    expect(get(heavy.metrics, "reg")).toBeGreaterThan(get(light.metrics, "reg"));
  });

  it("keeps iron loss when the load is removed", () => {
    const result = run("transformer", { pout: 0 });
    expect(get(result.metrics, "pfe")).toBeGreaterThan(0);
    expect(get(result.metrics, "pcu")).toBeCloseTo(0, 9);
  });

  it("prefers amorphous over silicon steel for iron loss", () => {
    const steel = run("transformer", { coreMaterial: "silicon-steel-m19" });
    const amorphous = run("transformer", { coreMaterial: "amorphous-2605sa1" });
    expect(get(amorphous.metrics, "pfe")).toBeLessThan(get(steel.metrics, "pfe"));
  });

  it("needs far fewer turns at high frequency", () => {
    const mains = run("transformer", { freq: 60, np: 480, ns: 48 });
    const smps = run("transformer", {
      coreMaterial: "ferrite-n87",
      freq: 100e3,
      np: 480,
      ns: 48,
    });
    expect(get(smps.metrics, "bpeak")).toBeLessThan(get(mains.metrics, "bpeak") / 100);
  });

  it("plots an efficiency curve through the design point", () => {
    const result = run("transformer", { pout: 100 });
    const curve = result.curves.find((c) => c.key === "eff")!;
    expect(curve.marker!.x).toBe(100);
    expect(Math.max(...curve.points.map((p) => p.y))).toBeLessThanOrEqual(1);
  });
});

describe("솔레노이드", () => {
  it("pulls harder as the gap closes", () => {
    const far = run("solenoid", { gap: 6 });
    const near = run("solenoid", { gap: 0.5 });
    expect(get(near.metrics, "force")).toBeGreaterThan(get(far.metrics, "force"));
  });

  it("holds far more force than it pulls at full stroke", () => {
    const result = run("solenoid", { gap: 5 });
    expect(get(result.metrics, "holding")).toBeGreaterThan(get(result.metrics, "force") * 3);
  });

  it("loses force without a return yoke", () => {
    const withYoke = run("solenoid", { shell: 5 });
    const without = run("solenoid", { shell: 0 });
    expect(get(without.metrics, "force")).toBeLessThan(get(withYoke.metrics, "force"));
    expect(without.warnings.some((w) => w.text.includes("요크"))).toBe(true);
  });

  it("derates current below Ohm's law as the coil heats", () => {
    const low = run("solenoid", { voltage: 12 });
    const high = run("solenoid", { voltage: 24 });
    const ratio = get(high.metrics, "current") / get(low.metrics, "current");
    // Doubling the voltage quadruples the dissipation; the coil heats, its
    // resistance climbs and the current lands well short of double.
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(2);
    expect(get(high.metrics, "temp")).toBeGreaterThan(get(low.metrics, "temp"));
  });

  it("warns about coil temperature at 100 % duty on a thin wire", () => {
    const result = run("solenoid", { awg: 32, voltage: 48, duty: 100 });
    expect(result.warnings.some((w) => w.text.includes("온도"))).toBe(true);
  });

  it("does not exceed core saturation in the gap", () => {
    const result = run("solenoid", { turns: 20000, voltage: 100 });
    expect(get(result.metrics, "bgap")).toBeLessThanOrEqual(2.15);
  });

  it("plots force against stroke", () => {
    const result = run("solenoid");
    const curve = result.curves[0]!;
    expect(curve.points[0]!.y).toBeGreaterThan(curve.points.at(-1)!.y);
  });
});

describe("DC 모터", () => {
  it("raises the torque constant with a stronger magnet", () => {
    const ferrite = run("motor", { magnet: "ferrite-magnet" });
    const neo = run("motor", { magnet: "ndfeb-n42" });
    expect(get(neo.metrics, "kt")).toBeGreaterThan(get(ferrite.metrics, "kt") * 2);
  });

  it("loses flux as the air gap opens", () => {
    const tight = run("motor", { airGap: 0.2 });
    const loose = run("motor", { airGap: 2 });
    expect(get(loose.metrics, "bgap")).toBeLessThan(get(tight.metrics, "bgap"));
  });

  it("speeds up in proportion to voltage once brush drop is removed", () => {
    const low = run("motor", { voltage: 12, brushDrop: 0 });
    const high = run("motor", { voltage: 24, brushDrop: 0 });
    expect(get(high.metrics, "noload") / get(low.metrics, "noload")).toBeCloseTo(2, 2);
  });

  it("makes brush drop hurt low-voltage motors most", () => {
    const lowVolt = run("motor", { voltage: 6, brushDrop: 1.5, loadTorque: 0.05 });
    const highVolt = run("motor", { voltage: 48, brushDrop: 1.5, loadTorque: 0.05 });
    const share = (r: ReturnType<typeof run>) =>
      get(r.metrics, "pbrush") / (get(r.metrics, "pmech") + 1e-9);
    expect(share(lowVolt)).toBeGreaterThan(share(highVolt) * 3);
  });

  it("charges rotor iron loss that grows with speed", () => {
    const slow = run("motor", { voltage: 6, loadTorque: 0.05 });
    const fast = run("motor", { voltage: 48, loadTorque: 0.05 });
    expect(get(fast.metrics, "pfe")).toBeGreaterThan(get(slow.metrics, "pfe"));
  });

  it("caps air-gap flux when the stator yoke saturates", () => {
    const thin = run("motor", { yokeThickness: 1, magnet: "ndfeb-n42" });
    const thick = run("motor", { yokeThickness: 12, magnet: "ndfeb-n42" });
    expect(get(thin.metrics, "bgap")).toBeLessThan(get(thick.metrics, "bgap"));
    expect(get(thin.metrics, "byoke")).toBeLessThanOrEqual(1.81);
    expect(thin.warnings.some((w) => w.text.includes("요크"))).toBe(true);
  });

  it("slows down under load", () => {
    const light = run("motor", { loadTorque: 0.02 });
    const heavy = run("motor", { loadTorque: 0.3 });
    expect(get(heavy.metrics, "speed")).toBeLessThan(get(light.metrics, "speed"));
    expect(get(heavy.metrics, "current")).toBeGreaterThan(get(light.metrics, "current"));
  });

  it("refuses to turn when the load exceeds stall torque", () => {
    const result = run("motor", { loadTorque: 40 });
    expect(get(result.metrics, "speed")).toBeLessThanOrEqual(0);
    expect(result.warnings.some((w) => w.level === "error")).toBe(true);
  });

  it("warns when the winding would cook a neodymium magnet", () => {
    const result = run("motor", { magnet: "ndfeb-n42", awg: 30, loadTorque: 0.4 });
    expect(result.warnings.some((w) => w.text.includes("감자"))).toBe(true);
  });

  it("draws a torque-speed line that falls to zero at stall", () => {
    const result = run("motor");
    const curve = result.curves[0]!;
    expect(curve.points[0]!.y).toBeGreaterThan(0);
    expect(curve.points.at(-1)!.y).toBeCloseTo(0, 0);
  });

  it("keeps Kt and Ke consistent so no-load speed matches V/Ke", () => {
    const result = run("motor", { voltage: 24, loadTorque: 0, brushDrop: 0 });
    const kt = get(result.metrics, "kt");
    const rpm = get(result.metrics, "noload");
    expect(rpm).toBeCloseTo((24 / kt) * (60 / (2 * Math.PI)), 0);
  });
});
