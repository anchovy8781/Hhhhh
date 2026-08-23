import { describe, expect, it } from "vitest";
import { DEVICES, defaultValues } from "../src/physics/index";
import { buildSaturation } from "../src/physics/types";
import { PRESETS } from "../src/ui/presets";

/**
 * The first screen a newcomer sees must be a device that works.
 *
 * A simulator whose defaults are already in fault is how people conclude the
 * tool is broken rather than that the design is.
 */
describe("shipped starting points", () => {
  for (const definition of DEVICES) {
    it(`${definition.name}의 기본값에 오류가 없다`, () => {
      const result = definition.simulate(defaultValues(definition));
      const errors = result.warnings.filter((w) => w.level === "error");
      expect(errors.map((e) => e.text)).toEqual([]);
    });

    it(`${definition.name}의 기본값이 포화하지 않는다`, () => {
      const result = definition.simulate(defaultValues(definition));
      expect(buildSaturation(result.build)).toBeLessThan(0.85);
    });

    for (const preset of PRESETS[definition.id] ?? []) {
      it(`프리셋 "${preset.name}"이 한계 안에 있다`, () => {
        const result = definition.simulate({
          ...defaultValues(definition),
          ...preset.values,
        });
        const errors = result.warnings.filter((w) => w.level === "error");
        expect(errors.map((e) => e.text)).toEqual([]);
        expect(buildSaturation(result.build)).toBeLessThan(1);
      });
    }
  }
});
