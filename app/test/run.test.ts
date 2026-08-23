import { describe, expect, it } from "vitest";
import { DEVICES, defaultValues, device } from "../src/physics/index";
import { DEFAULT_ENVIRONMENT, readEnvironment } from "../src/physics/environment";
import { formatTime, runDevice } from "../src/physics/run";
import type { ParamValues } from "../src/physics/types";

const energise = (id: string, overrides: ParamValues = {}, duration = 1800) => {
  const definition = device(id);
  const values = { ...defaultValues(definition), ...overrides };
  const result = definition.simulate(values);
  if (!result.runtime) throw new Error(`${id}에 runtime 명세가 없습니다`);
  return runDevice(result.runtime, readEnvironment(values), { duration });
};

describe("every device can be energised", () => {
  it("gives each device a runtime specification", () => {
    for (const definition of DEVICES) {
      const result = definition.simulate(defaultValues(definition));
      expect(result.runtime, definition.name).toBeTruthy();
      expect(result.runtime!.parts.length).toBeGreaterThan(1);
      for (const part of result.runtime!.parts) {
        expect(part.capacity).toBeGreaterThan(0);
        expect(part.limit).toBeGreaterThan(40);
        expect(part.advice.length).toBeGreaterThan(5);
      }
    }
  });

  it("produces both a current trace and a temperature trace", () => {
    for (const definition of DEVICES) {
      const values = defaultValues(definition);
      const run = runDevice(
        definition.simulate(values).runtime!,
        readEnvironment(values),
      );
      expect(run.electrical.length).toBeGreaterThan(50);
      expect(run.thermal.length).toBeGreaterThan(50);
      expect(run.thermal.at(-1)!.t).toBeCloseTo(run.duration, 0);
      for (const sample of run.thermal) {
        for (const temp of Object.values(sample.temperatures)) {
          expect(Number.isFinite(temp)).toBe(true);
        }
      }
    }
  });
});

describe("the electrical transient", () => {
  it("ramps a solenoid up its own L/R time constant", () => {
    const run = energise("solenoid");
    const first = run.electrical[0]!.current;
    const last = run.electrical.at(-1)!.current;
    expect(first).toBeLessThan(last * 0.05);
    expect(last).toBeCloseTo(run.steadyCurrent, 1);
    expect(run.currentRise).toBeGreaterThan(0);
  });

  it("shows a motor's start-up current spike above its running current", () => {
    const run = energise("motor");
    expect(run.peakCurrent).toBeGreaterThan(run.steadyCurrent * 2);
  });

  it("spins a motor up to speed", () => {
    const run = energise("motor");
    const speeds = run.electrical.map((s) => s.speed ?? 0);
    expect(Math.max(...speeds)).toBeGreaterThan(0);
    expect(speeds.at(-1)!).toBeGreaterThan(speeds[0]!);
  });

  it("ramps a current-driven inductor to its rated current and stops", () => {
    const run = energise("inductor");
    expect(run.electrical.at(-1)!.current).toBeCloseTo(run.steadyCurrent, 6);
    expect(Math.max(...run.electrical.map((s) => s.current))).toBeCloseTo(
      run.steadyCurrent,
      6,
    );
  });
});

describe("the thermal run", () => {
  it("starts at ambient and warms up", () => {
    const run = energise("solenoid");
    const first = run.thermal[0]!;
    expect(first.temperatures.winding).toBeCloseTo(DEFAULT_ENVIRONMENT.ambient, 0);
    expect(run.thermal.at(-1)!.temperatures.winding!).toBeGreaterThan(
      first.temperatures.winding!,
    );
  });

  it("settles where the steady-state analysis said it would", () => {
    const definition = device("solenoid");
    const values = defaultValues(definition);
    const result = definition.simulate(values);
    const run = runDevice(result.runtime!, readEnvironment(values), { duration: 7200 });
    const staticTemp = result.metrics.find((m) => m.key === "temp")!.raw;
    // The winding is the hot spot, so it lands above the average the static
    // model reports -- but the two must agree on the same design.
    expect(run.finalTemperatures.winding!).toBeGreaterThan(staticTemp);
    expect(run.finalTemperatures.winding!).toBeLessThan(staticTemp * 1.25);
  });

  it("runs the winding hotter than the core", () => {
    const run = energise("solenoid");
    const last = run.thermal.at(-1)!;
    expect(last.temperatures.winding!).toBeGreaterThan(last.temperatures.core!);
  });

  it("sags a voltage-driven current as the coil heats", () => {
    const run = energise("solenoid");
    expect(run.thermal.at(-1)!.current).toBeLessThan(run.thermal[0]!.current);
  });

  it("holds a current-driven inductor at its rated current", () => {
    const run = energise("inductor");
    expect(run.thermal.at(-1)!.current).toBeCloseTo(run.thermal[0]!.current, 6);
    // The loss still climbs, because the resistance does.
    expect(run.thermal.at(-1)!.loss).toBeGreaterThan(run.thermal[0]!.loss);
  });

  it("stays cool and quiet on a design that is fine", () => {
    const run = energise("inductor");
    expect(run.verdict).toBe("ok");
    expect(run.events).toEqual([]);
    expect(run.failedAt).toBeUndefined();
  });
});

describe("fault localisation", () => {
  it("names the part, the time and the fix when a design cooks", () => {
    const run = energise("solenoid", {
      voltage: 40,
      awg: 28,
      turns: 1800,
      insulationClass: "130",
    });
    expect(run.verdict).toBe("fail");
    const winding = run.events.find(
      (e) => e.partId === "winding" && e.level === "error",
    )!;
    expect(winding.text).toContain("절연 열등급 130°C");
    expect(winding.advice).toBeTruthy();
    expect(run.failedAt!).toBeGreaterThan(0);
    expect(run.failedAt!).toBeLessThan(run.duration);
    for (const event of run.events) {
      expect(event.advice.length).toBeGreaterThan(5);
      expect(event.text).toContain("°C");
    }
  });

  it("blames the thinnest part first, because it heats first", () => {
    const run = energise("solenoid", {
      voltage: 40,
      awg: 28,
      turns: 1800,
      insulationClass: "130",
    });
    // The bobbin is a few grams of plastic against a few hundred of copper,
    // so it reaches its limit long before the winding reaches the same
    // temperature -- which is exactly how thin parts fail in an overload.
    expect(run.failedPart).toBe("bobbin");
    const order = run.events
      .filter((e) => e.level === "error")
      .map((e) => e.partId);
    expect(order.indexOf("bobbin")).toBeLessThan(order.indexOf("winding"));
  });

  it("blames the magnet, not the winding, when a motor cooks its neodymium", () => {
    const run = energise("motor", {
      magnet: "ndfeb-n42",
      loadTorque: 0.55,
      awg: 26,
      insulationClass: "220",
      "env.ambient": 60,
    });
    const magnetFault = run.events.find(
      (e) => e.partId === "magnet" && e.level === "error",
    );
    expect(magnetFault).toBeTruthy();
    expect(magnetFault!.text).toContain("영구자석");
    expect(magnetFault!.advice).toContain("SmCo");
  });

  it("reports the earliest failure as the verdict", () => {
    const run = energise("solenoid", { voltage: 45, awg: 28, turns: 1800 });
    const errors = run.events.filter((e) => e.level === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(run.failedAt).toBe(errors[0]!.t);
  });

  it("warns before it fails", () => {
    const run = energise("solenoid", {
      voltage: 26,
      awg: 28,
      turns: 1800,
      insulationClass: "180",
    });
    expect(run.events.some((e) => e.level === "warn")).toBe(true);
  });

  it("catches a transformer saturating on inrush", () => {
    const run = energise("transformer");
    const saturation = run.events.find((e) => e.title.includes("돌입"));
    expect(saturation).toBeTruthy();
    expect(saturation!.partId).toBe("core");
    // The first peak is limited by the winding resistance, not by the
    // magnetising inductance, because the core is briefly just air.
    expect(run.peakCurrent).toBeGreaterThan(run.steadyCurrent * 20);
    expect(saturation!.advice).toContain("소프트 스타트");
  });

  it("settles a transformer back to its rated current after the inrush", () => {
    const run = energise("transformer");
    const settled = run.electrical.slice(-30).map((s) => Math.abs(s.current));
    expect(Math.max(...settled)).toBeLessThan(run.peakCurrent / 10);
    expect(run.verdict).not.toBe("fail");
  });

  it("survives the same run in a better environment", () => {
    const hot = energise("solenoid", {
      voltage: 30,
      awg: 28,
      turns: 1800,
      "env.cooling": "natural-air",
    });
    const cooled = energise("solenoid", {
      voltage: 30,
      awg: 28,
      turns: 1800,
      "env.cooling": "water-jacket",
    });
    expect(hot.verdict).toBe("fail");
    expect(cooled.verdict).not.toBe("fail");
  });
});

describe("time formatting", () => {
  it("scales the unit to the magnitude", () => {
    expect(formatTime(0.00002)).toBe("20µs");
    expect(formatTime(0.05)).toBe("50.0ms");
    expect(formatTime(12)).toBe("12.0초");
    expect(formatTime(300)).toBe("5.0분");
    expect(formatTime(7200)).toBe("2.0시간");
  });
});
