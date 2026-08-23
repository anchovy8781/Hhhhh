/** Shared vocabulary between the physics models, the UI and the 3D view. */

export type ParamGroup = "재료" | "치수" | "권선" | "운전";

export interface NumberParam {
  kind: "number";
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
  group: ParamGroup;
  hint?: string;
  /** Slider position is logarithmic when the range spans decades. */
  log?: boolean;
}

export interface ChoiceParam {
  kind: "choice";
  key: string;
  label: string;
  options: { value: string; label: string; note?: string }[];
  default: string;
  group: ParamGroup;
  hint?: string;
}

export type Param = NumberParam | ChoiceParam;
export type ParamValues = Record<string, number | string>;

export type MetricTone = "good" | "warn" | "bad" | "plain";

export interface Metric {
  key: string;
  label: string;
  /** Already formatted for display, e.g. "3.28 mH". */
  text: string;
  raw: number;
  tone: MetricTone;
  hint?: string;
  /** Headline metrics are pinned to the top of the results panel. */
  headline?: boolean;
}

export interface Warning {
  level: "error" | "warn" | "info";
  text: string;
}

export interface Curve {
  key: string;
  title: string;
  xLabel: string;
  yLabel: string;
  points: { x: number; y: number }[];
  /** Optional vertical marker, e.g. the operating current. */
  marker?: { x: number; label: string };
}

/** Everything the 3D view needs to draw the device. Dimensions in mm. */
export type BuildSpec =
  | {
      kind: "toroid";
      od: number;
      id: number;
      height: number;
      coreColor: number;
      windings: WindingVisual[];
      saturation: number;
    }
  | {
      kind: "ei";
      tongue: number;
      stack: number;
      windowWidth: number;
      windowHeight: number;
      gap: number;
      coreColor: number;
      windings: WindingVisual[];
      saturation: number;
    }
  | {
      kind: "solenoid";
      bobbinOd: number;
      bobbinId: number;
      coilLength: number;
      plungerDiameter: number;
      plungerLength: number;
      gap: number;
      shellThickness: number;
      coreColor: number;
      windings: WindingVisual[];
      saturation: number;
    }
  | {
      kind: "motor";
      statorOd: number;
      rotorOd: number;
      stackLength: number;
      airGap: number;
      magnetThickness: number;
      poles: number;
      slots: number;
      shaftDiameter: number;
      coreColor: number;
      magnetColor: number;
      windings: WindingVisual[];
      saturation: number;
    };

export interface WindingVisual {
  label: string;
  turns: number;
  wireDiameter: number; // mm, insulated
  color: number;
  /** Fraction of the window this winding occupies, for stacking layers. */
  share: number;
}

export interface DeviceResult {
  metrics: Metric[];
  warnings: Warning[];
  curves: Curve[];
  build: BuildSpec;
}

export interface DeviceDefinition {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  params: Param[];
  simulate(values: ParamValues): DeviceResult;
}

// -- value helpers ---------------------------------------------------------

export function num(values: ParamValues, key: string): number {
  const value = values[key];
  if (typeof value !== "number") throw new Error(`${key} 값이 숫자가 아닙니다`);
  return value;
}

export function str(values: ParamValues, key: string): string {
  const value = values[key];
  if (typeof value !== "string") throw new Error(`${key} 값이 문자열이 아닙니다`);
  return value;
}

const PREFIXES: [number, string][] = [
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
  [1, ""],
  [1e-3, "m"],
  [1e-6, "µ"],
  [1e-9, "n"],
  [1e-12, "p"],
];

/** SI-prefix formatting: 0.00328 H -> "3.28 mH". */
export function si(value: number, unit: string, digits = 3): string {
  if (!isFinite(value)) return `∞ ${unit}`;
  if (value === 0) return `0 ${unit}`;
  const magnitude = Math.abs(value);
  for (const [scale, prefix] of PREFIXES) {
    if (magnitude >= scale * 0.999) {
      const scaled = value / scale;
      const decimals = Math.max(0, digits - Math.floor(Math.log10(Math.abs(scaled))) - 1);
      return `${scaled.toFixed(Math.min(decimals, 3))} ${prefix}${unit}`;
    }
  }
  return `${value.toExponential(2)} ${unit}`;
}

export function metric(
  key: string,
  label: string,
  raw: number,
  text: string,
  tone: MetricTone = "plain",
  extra: { hint?: string; headline?: boolean } = {},
): Metric {
  return { key, label, raw, text, tone, ...extra };
}
