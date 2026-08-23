import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEVICES, defaultValues } from "../src/physics/index";
import {
  SLOT_COUNT,
  clearSlot,
  listSlots,
  mergeSlot,
  saveSlot,
} from "../src/ui/storage";

/** A minimal localStorage, since these tests run in Node. */
function fakeStorage(failing = false) {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failing) throw new Error("quota");
      map.set(key, value);
    },
    removeItem: (key: string) => map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

describe("design slots", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
  });

  it("starts with every slot empty", () => {
    expect(listSlots()).toHaveLength(SLOT_COUNT);
    expect(listSlots().every((slot) => slot === null)).toBe(true);
  });

  it("round-trips a design", () => {
    const definition = DEVICES[0]!;
    const values = { ...defaultValues(definition), turns: 42 };
    expect(saveSlot(0, "내 인덕터", definition.id, values)).toBe(true);
    const slot = listSlots()[0]!;
    expect(slot.name).toBe("내 인덕터");
    expect(slot.deviceId).toBe(definition.id);
    expect(slot.values.turns).toBe(42);
    expect(slot.savedAt).toBeGreaterThan(0);
  });

  it("keeps slots independent", () => {
    saveSlot(0, "A", "inductor", { turns: 10 });
    saveSlot(3, "B", "transformer", { np: 200 });
    const slots = listSlots();
    expect(slots[0]!.name).toBe("A");
    expect(slots[3]!.name).toBe("B");
    expect(slots[1]).toBeNull();
  });

  it("clears one slot without touching the others", () => {
    saveSlot(0, "A", "inductor", { turns: 10 });
    saveSlot(1, "B", "inductor", { turns: 20 });
    clearSlot(0);
    expect(listSlots()[0]).toBeNull();
    expect(listSlots()[1]!.name).toBe("B");
  });

  it("refuses an index outside the slot range", () => {
    expect(saveSlot(-1, "x", "inductor", {})).toBe(false);
    expect(saveSlot(SLOT_COUNT, "x", "inductor", {})).toBe(false);
  });

  it("survives storage that refuses to write", () => {
    vi.stubGlobal("localStorage", fakeStorage(true));
    expect(saveSlot(0, "x", "inductor", { turns: 1 })).toBe(false);
    expect(listSlots()[0]).toBeNull();
  });

  it("survives a corrupted store", () => {
    localStorage.setItem("jeonryeok-lab.slots.v1", "{not json");
    expect(listSlots().every((slot) => slot === null)).toBe(true);
  });

  it("ignores entries that are not designs", () => {
    localStorage.setItem(
      "jeonryeok-lab.slots.v1",
      JSON.stringify([{ deviceId: 12, values: null }, "nonsense"]),
    );
    expect(listSlots()[0]).toBeNull();
    expect(listSlots()[1]).toBeNull();
  });
});

describe("merging a saved design onto current defaults", () => {
  it("keeps the values it recognises", () => {
    const merged = mergeSlot({ turns: 10, awg: 20 }, { turns: 55 });
    expect(merged).toEqual({ turns: 55, awg: 20 });
  });

  it("drops parameters this build no longer has", () => {
    const merged = mergeSlot({ turns: 10 }, { turns: 55, removedParam: 3 });
    expect(merged).toEqual({ turns: 55 });
  });

  it("defaults parameters the saved design predates", () => {
    const merged = mergeSlot({ turns: 10, newParam: "x" }, { turns: 55 });
    expect(merged.newParam).toBe("x");
  });

  it("refuses a value of the wrong type", () => {
    const merged = mergeSlot({ turns: 10 }, { turns: "many" });
    expect(merged.turns).toBe(10);
  });

  it("reopens every device's saved defaults as a working design", () => {
    for (const definition of DEVICES) {
      const saved = defaultValues(definition);
      const merged = mergeSlot(defaultValues(definition), saved);
      const result = definition.simulate(merged);
      expect(result.metrics.length, definition.id).toBeGreaterThan(3);
    }
  });
});
