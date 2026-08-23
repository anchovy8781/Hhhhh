/**
 * Design slots.
 *
 * A design is a device id plus a flat map of values, so a slot is small enough
 * to keep in the browser and simple enough to survive the app changing around
 * it: unknown keys are ignored on load, missing ones fall back to the current
 * defaults. That matters because a saved design should still open after a
 * parameter is added or renamed.
 */

import type { ParamValues } from "../physics/types";

const KEY = "jeonryeok-lab.slots.v1";
export const SLOT_COUNT = 8;

export interface Slot {
  index: number;
  name: string;
  deviceId: string;
  values: ParamValues;
  savedAt: number;
}

function readAll(): (Slot | null)[] {
  const empty = Array.from({ length: SLOT_COUNT }, () => null);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return empty;
    return empty.map((_, index) => {
      const entry = parsed[index] as Slot | null | undefined;
      if (!entry || typeof entry !== "object") return null;
      if (typeof entry.deviceId !== "string" || typeof entry.values !== "object") {
        return null;
      }
      return {
        index,
        name: typeof entry.name === "string" ? entry.name : `슬롯 ${index + 1}`,
        deviceId: entry.deviceId,
        values: entry.values as ParamValues,
        savedAt: typeof entry.savedAt === "number" ? entry.savedAt : 0,
      };
    });
  } catch {
    // Private browsing, cleared storage, or a value written by an older build.
    return empty;
  }
}

function writeAll(slots: (Slot | null)[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(slots));
    return true;
  } catch {
    return false;
  }
}

export function listSlots(): (Slot | null)[] {
  return readAll();
}

export function saveSlot(
  index: number,
  name: string,
  deviceId: string,
  values: ParamValues,
): boolean {
  if (index < 0 || index >= SLOT_COUNT) return false;
  const slots = readAll();
  slots[index] = { index, name, deviceId, values: { ...values }, savedAt: Date.now() };
  return writeAll(slots);
}

export function clearSlot(index: number): boolean {
  const slots = readAll();
  if (index < 0 || index >= SLOT_COUNT) return false;
  slots[index] = null;
  return writeAll(slots);
}

/**
 * Merge a saved design onto a fresh set of defaults.
 *
 * Keys the current build no longer has are dropped, and keys it has gained
 * keep their default, so an old slot opens as a working design rather than a
 * broken one.
 */
export function mergeSlot(defaults: ParamValues, saved: ParamValues): ParamValues {
  const out: ParamValues = { ...defaults };
  for (const [key, value] of Object.entries(saved)) {
    if (!(key in defaults)) continue;
    if (typeof value === typeof defaults[key]) out[key] = value as number | string;
  }
  return out;
}

export function describeSlot(slot: Slot): string {
  const when = new Date(slot.savedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${when.getFullYear()}.${pad(when.getMonth() + 1)}.${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
}
