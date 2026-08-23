/** Public surface of the physics engine. */

export * from "./constants";
export * from "./materials";
export * from "./wire";
export * from "./magnetics";
export * from "./thermal";
export * from "./types";
export * from "./environment";
export * from "./applications";
export * from "./run";
export * from "./catalog/index";

import { inductor } from "./devices/inductor";
import { transformer } from "./devices/transformer";
import { solenoid } from "./devices/solenoid";
import { motor } from "./devices/motor";
import { busbar } from "./devices/busbar";
import { cmChoke } from "./devices/cmchoke";
import { bldc } from "./devices/bldc";
import type { DeviceDefinition, ParamValues } from "./types";

export const DEVICES: DeviceDefinition[] = [
  inductor,
  transformer,
  cmChoke,
  solenoid,
  motor,
  bldc,
  busbar,
];

export function device(id: string): DeviceDefinition {
  const found = DEVICES.find((d) => d.id === id);
  if (!found) throw new Error(`알 수 없는 장치: ${id}`);
  return found;
}

/** Default parameter values for a device, as the UI first shows it. */
export function defaultValues(definition: DeviceDefinition): ParamValues {
  const values: ParamValues = {};
  for (const param of definition.params) values[param.key] = param.default;
  return values;
}
