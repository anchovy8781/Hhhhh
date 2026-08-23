/**
 * The conditions the device actually runs in.
 *
 * A design that passes on a bench at 25 °C in open air can fail in a sealed
 * roadside enclosure at 55 °C, and nothing about the winding changed. These
 * settings are shared by every device and feed straight into the thermal
 * model, so the environment is part of the design rather than an afterthought.
 */

import { coolantOption } from "./materials";
import type { CoolingMedium } from "./material-types";
import { APPLICATIONS } from "./applications";
import type { Param, ParamValues } from "./types";

export type Enclosure = "none" | "vented" | "sealed" | "potted";

export interface Environment {
  ambient: number; // [°C]
  altitude: number; // [m]
  coolingId: string;
  enclosure: Enclosure;
  emissivity: number;
  /** Fraction of the time the device is energised, 0..1. */
  dutyCycle: number;
  humidity: number; // [%RH]
}

export const DEFAULT_ENVIRONMENT: Environment = {
  ambient: 25,
  altitude: 0,
  coolingId: "natural-air",
  enclosure: "none",
  emissivity: 0.9,
  dutyCycle: 1,
  humidity: 50,
};

/**
 * How much thinner the air is at altitude.
 *
 * Standard-atmosphere density ratio. Convection carries heat away in
 * proportion to how much air there is, so a design that runs warm at sea level
 * runs hotter on a mountain even though nothing else changed.
 */
export function airDensityRatio(altitude: number): number {
  return Math.pow(Math.max(0, 1 - 2.25577e-5 * altitude), 4.2559);
}

/** Enclosure multiplier on the surface coefficient. */
const ENCLOSURE_FACTOR: Record<Enclosure, number> = {
  none: 1,
  vented: 0.75,
  sealed: 0.42,
  potted: 0.62,
};

const ENCLOSURE_LABEL: Record<Enclosure, string> = {
  none: "개방 (함체 없음)",
  vented: "통풍 함체",
  sealed: "밀폐 함체",
  potted: "포팅 충전",
};

export interface CoolingResult {
  /** Convective/conductive coefficient at the bare surface [W/m²K]. */
  h: number;
  medium: CoolingMedium;
  /** True when radiation should be added on top (bare surface in air). */
  radiates: boolean;
  /**
   * Multiplier for everything the surface can shed.
   *
   * An enclosure derates radiation as much as convection: the part radiates to
   * a box wall that is itself hot, not to the room. Applying the factor to
   * convection alone made a sealed box look far kinder than it is.
   */
  enclosureFactor: number;
  maxTemp: number;
  label: string;
}

export function coolingFor(environment: Environment): CoolingResult {
  const coolant = coolantOption(environment.coolingId);
  const density = airDensityRatio(environment.altitude);
  // Natural convection goes roughly with the square root of density, forced
  // convection closer to the 0.8 power of mass flow.
  const altitudeFactor =
    coolant.medium === "air"
      ? Math.pow(density, coolant.id.startsWith("forced") ? 0.8 : 0.5)
      : 1;
  return {
    h: coolant.h * altitudeFactor,
    medium: coolant.medium,
    radiates: coolant.medium === "air" && environment.enclosure !== "potted",
    enclosureFactor: ENCLOSURE_FACTOR[environment.enclosure],
    maxTemp: coolant.maxTemp,
    label: `${coolant.name} · ${ENCLOSURE_LABEL[environment.enclosure]}`,
  };
}

/** Environment controls, shared by every device. */
export function environmentParams(): Param[] {
  return [
    {
      kind: "choice",
      key: "app.profile",
      label: "용도",
      group: "환경",
      default: "bench",
      options: APPLICATIONS.map((app) => ({
        value: app.id,
        label: app.name,
        note: app.note,
      })),
      hint: "용도를 고르면 그 환경이 적용되고, 그 분야의 요구조건으로 설계를 검사합니다.",
    },
    {
      kind: "number",
      key: "env.ambient",
      label: "주위 온도",
      unit: "°C",
      min: -55,
      max: 125,
      step: 1,
      default: DEFAULT_ENVIRONMENT.ambient,
      group: "환경",
      hint: "설계 온도 상승은 여기에 더해집니다. 자동차 엔진룸은 105~125°C를 봅니다.",
    },
    {
      kind: "catalog",
      key: "env.cooling",
      label: "냉각 방식",
      catalog: "coolant",
      group: "환경",
      default: DEFAULT_ENVIRONMENT.coolingId,
      hint: "표면 열전달계수를 정합니다. 자연 공랭 12에서 수냉 900 W/m²K까지 차이가 납니다.",
    },
    {
      kind: "choice",
      key: "env.enclosure",
      label: "함체",
      group: "환경",
      default: DEFAULT_ENVIRONMENT.enclosure,
      options: [
        { value: "none", label: ENCLOSURE_LABEL.none, note: "표면이 그대로 공기에 노출됩니다." },
        { value: "vented", label: ENCLOSURE_LABEL.vented, note: "환기구가 있어도 방열은 25% 줄어듭니다." },
        { value: "sealed", label: ENCLOSURE_LABEL.sealed, note: "방수·방진의 대가로 방열이 절반 이하가 됩니다." },
        { value: "potted", label: ENCLOSURE_LABEL.potted, note: "수지 충전. 전도는 좋아지지만 복사가 막힙니다." },
      ],
    },
    {
      kind: "number",
      key: "env.altitude",
      label: "고도",
      unit: "m",
      min: 0,
      max: 12000,
      step: 100,
      default: DEFAULT_ENVIRONMENT.altitude,
      group: "환경",
      hint: "공기가 얇아지면 대류 냉각이 약해집니다. 3000m에서 약 15% 손해입니다.",
    },
    {
      kind: "number",
      key: "env.duty",
      label: "듀티 (통전율)",
      unit: "%",
      min: 1,
      max: 100,
      step: 1,
      default: DEFAULT_ENVIRONMENT.dutyCycle * 100,
      group: "환경",
      hint: "간헐 운전이면 평균 발열이 줄어 같은 설계로 더 큰 출력을 낼 수 있습니다.",
    },
    {
      kind: "number",
      key: "env.emissivity",
      label: "표면 방사율",
      unit: "",
      min: 0.05,
      max: 0.98,
      step: 0.01,
      default: DEFAULT_ENVIRONMENT.emissivity,
      group: "환경",
      hint: "광택 금속은 0.1, 검게 도장한 면은 0.95. 복사 방열이 몇 배 달라집니다.",
    },
    {
      kind: "number",
      key: "env.humidity",
      label: "상대 습도",
      unit: "%RH",
      min: 5,
      max: 100,
      step: 1,
      default: DEFAULT_ENVIRONMENT.humidity,
      group: "환경",
      hint: "높은 습도는 절연 열화와 부식을 앞당깁니다.",
    },
  ];
}

/** Pull the environment back out of the flat parameter map. */
export function readEnvironment(values: ParamValues): Environment {
  const number = (key: string, fallback: number) => {
    const value = values[key];
    return typeof value === "number" ? value : fallback;
  };
  const text = (key: string, fallback: string) => {
    const value = values[key];
    return typeof value === "string" ? value : fallback;
  };
  return {
    ambient: number("env.ambient", DEFAULT_ENVIRONMENT.ambient),
    altitude: number("env.altitude", DEFAULT_ENVIRONMENT.altitude),
    coolingId: text("env.cooling", DEFAULT_ENVIRONMENT.coolingId),
    enclosure: text("env.enclosure", DEFAULT_ENVIRONMENT.enclosure) as Enclosure,
    emissivity: number("env.emissivity", DEFAULT_ENVIRONMENT.emissivity),
    dutyCycle: number("env.duty", DEFAULT_ENVIRONMENT.dutyCycle * 100) / 100,
    humidity: number("env.humidity", DEFAULT_ENVIRONMENT.humidity),
  };
}
