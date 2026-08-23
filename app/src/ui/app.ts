/** Wires the parameter controls, the physics engine and the 3D view together. */

import * as THREE from "three";
import { DEVICES, defaultValues, device } from "../physics/index";
import type {
  DeviceDefinition,
  DeviceResult,
  Param,
  ParamGroup,
  ParamValues,
} from "../physics/types";
import { buildDevice } from "../view3d/builders";
import { clearGroup, createViewer, type Viewer } from "../view3d/scene";
import { drawCurve } from "./chart";
import { PRESETS } from "./presets";

const GROUPS: ParamGroup[] = ["재료", "치수", "권선", "운전"];

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} 없음`);
  return found as T;
};

export function startApp(): void {
  const viewer = createViewer(el<HTMLCanvasElement>("canvas"));

  let current: DeviceDefinition = DEVICES[0]!;
  let values: ParamValues = defaultValues(current);
  let activeGroup: ParamGroup = "재료";
  /** Rebuilding geometry costs more than recomputing numbers; throttle it. */
  let pendingBuild = 0;

  const tabs = el("device-tabs");
  for (const definition of DEVICES) {
    const tab = document.createElement("button");
    tab.className = "device-tab";
    tab.type = "button";
    tab.role = "tab";
    tab.innerHTML = `<span class="icon">${definition.icon}</span>${definition.name}`;
    tab.addEventListener("click", () => selectDevice(definition));
    tabs.append(tab);
  }

  const groupTabs = el("group-tabs");
  for (const group of GROUPS) {
    const tab = document.createElement("button");
    tab.className = "group-tab";
    tab.type = "button";
    tab.role = "tab";
    tab.textContent = group;
    tab.addEventListener("click", () => {
      activeGroup = group;
      renderGroupTabs();
      renderControls();
    });
    groupTabs.append(tab);
  }

  const cutawayButton = el<HTMLButtonElement>("cutaway");
  cutawayButton.addEventListener("click", () => {
    const on = cutawayButton.getAttribute("aria-pressed") !== "true";
    cutawayButton.setAttribute("aria-pressed", String(on));
    viewer.setCutaway(on);
  });

  el<HTMLButtonElement>("reset").addEventListener("click", () => {
    values = defaultValues(current);
    renderControls();
    update(true);
  });

  function selectDevice(definition: DeviceDefinition) {
    current = definition;
    values = defaultValues(definition);
    activeGroup = "재료";
    el("tagline").textContent = definition.tagline;
    renderDeviceTabs();
    renderGroupTabs();
    renderControls();
    renderPresets();
    update(true);
  }

  function renderDeviceTabs() {
    [...tabs.children].forEach((child, index) => {
      (child as HTMLElement).setAttribute(
        "aria-selected",
        String(DEVICES[index]!.id === current.id),
      );
    });
  }

  function renderGroupTabs() {
    const used = new Set(current.params.map((p) => p.group));
    [...groupTabs.children].forEach((child, index) => {
      const group = GROUPS[index]!;
      const button = child as HTMLElement;
      button.hidden = !used.has(group);
      button.setAttribute("aria-selected", String(group === activeGroup));
    });
  }

  function renderControls() {
    const host = el("controls");
    host.replaceChildren();
    for (const param of current.params) {
      if (param.group !== activeGroup) continue;
      host.append(param.kind === "number" ? numberControl(param) : choiceControl(param));
    }
  }

  function numberControl(param: Extract<Param, { kind: "number" }>): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "control";
    const readout = document.createElement("span");
    readout.className = "readout";

    const input = document.createElement("input");
    input.type = "range";
    // A logarithmic slider is the only way one control can cover 50 Hz to 2 MHz
    // without the useful range collapsing into the first two pixels.
    const toSlider = (value: number) =>
      param.log ? Math.log10(Math.max(value, param.min)) : value;
    const fromSlider = (raw: number) => (param.log ? Math.pow(10, raw) : raw);
    input.min = String(toSlider(param.min));
    input.max = String(toSlider(param.max));
    input.step = param.log ? "0.005" : String(param.step);
    input.value = String(toSlider(Number(values[param.key])));

    const show = (value: number) => {
      readout.textContent = `${formatValue(value, param.step, param.log)} ${param.unit}`;
    };
    show(Number(values[param.key]));

    input.addEventListener("input", () => {
      const raw = fromSlider(Number(input.value));
      const snapped = param.log
        ? roundSignificant(raw)
        : Math.round(raw / param.step) * param.step;
      const clamped = Math.min(Math.max(snapped, param.min), param.max);
      values[param.key] = clamped;
      show(clamped);
      update(false);
    });
    input.addEventListener("change", () => update(true));

    const row = document.createElement("div");
    row.className = "row";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = param.label;
    row.append(name, readout);
    wrap.append(row, input);
    if (param.hint) {
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = param.hint;
      wrap.append(hint);
    }
    return wrap;
  }

  function choiceControl(param: Extract<Param, { kind: "choice" }>): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "control";
    const row = document.createElement("div");
    row.className = "row";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = param.label;
    row.append(name);

    const select = document.createElement("select");
    for (const option of param.options) {
      const item = document.createElement("option");
      item.value = option.value;
      item.textContent = option.label;
      select.append(item);
    }
    select.value = String(values[param.key]);

    const hint = document.createElement("p");
    hint.className = "hint";
    const showNote = () => {
      const option = param.options.find((o) => o.value === select.value);
      hint.textContent = option?.note ?? param.hint ?? "";
    };
    showNote();

    select.addEventListener("change", () => {
      values[param.key] = select.value;
      showNote();
      update(true);
    });

    wrap.append(row, select, hint);
    return wrap;
  }

  function renderPresets() {
    const host = el("presets");
    host.replaceChildren();
    for (const preset of PRESETS[current.id] ?? []) {
      const button = document.createElement("button");
      button.className = "preset";
      button.type = "button";
      button.innerHTML = `${preset.name}<small>${preset.note}</small>`;
      button.addEventListener("click", () => {
        values = { ...defaultValues(current), ...preset.values };
        renderControls();
        update(true);
      });
      host.append(button);
    }
  }

  function update(rebuildGeometry: boolean) {
    let result: DeviceResult;
    try {
      result = current.simulate(values);
    } catch (error) {
      showFailure(error);
      return;
    }
    renderHeadline(result);
    renderWarnings(result);
    renderAllMetrics(result);
    renderCurves(result);

    if (rebuildGeometry) {
      rebuild(result);
    } else if (!pendingBuild) {
      // Coalesce the flood of events a dragging slider produces.
      pendingBuild = requestAnimationFrame(() => {
        pendingBuild = 0;
        rebuild(result);
      });
    }
  }

  function rebuild(result: DeviceResult) {
    clearGroup(viewer.stage);
    const built = buildDevice(result.build);
    viewer.stage.add(built.group);
    viewer.frame(built.radius);
    renderBadges(result, built.turnsAbbreviated);
  }

  function renderBadges(result: DeviceResult, abbreviated: boolean) {
    const host = el("viewport-badges");
    host.replaceChildren();
    const add = (text: string, hot = false) => {
      const badge = document.createElement("span");
      badge.className = hot ? "badge hot" : "badge";
      badge.textContent = text;
      host.append(badge);
    };
    const saturation = result.build.saturation;
    if (saturation > 0.999) add("포화", true);
    else if (saturation > 0.85) add(`자속 ${Math.round(saturation * 100)}%`, true);
    else if (saturation > 0) add(`자속 ${Math.round(saturation * 100)}%`);
    for (const winding of result.build.windings) {
      add(`${winding.label} ${winding.turns}T · ⌀${winding.wireDiameter.toFixed(2)}mm`);
    }
    if (abbreviated) add("권선은 일부만 표시");
  }

  function renderHeadline(result: DeviceResult) {
    const host = el("headline");
    host.replaceChildren();
    for (const item of result.metrics.filter((m) => m.headline)) {
      const card = document.createElement("div");
      card.className = `stat ${item.tone}`;
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = item.label;
      const value = document.createElement("div");
      value.className = "value";
      value.textContent = item.text;
      card.append(label, value);
      if (item.hint) card.title = item.hint;
      host.append(card);
    }
  }

  function renderWarnings(result: DeviceResult) {
    const host = el("warnings");
    host.replaceChildren();
    for (const warning of result.warnings) {
      const alert = document.createElement("div");
      alert.className = `alert ${warning.level}`;
      alert.textContent = warning.text;
      host.append(alert);
    }
  }

  function renderAllMetrics(result: DeviceResult) {
    const host = el("all-metrics");
    host.replaceChildren();
    for (const item of result.metrics) {
      const key = document.createElement("div");
      key.className = "k";
      key.textContent = item.label;
      const value = document.createElement("div");
      value.className = `v ${item.tone}`;
      value.textContent = item.text;
      if (item.hint) {
        key.title = item.hint;
        value.title = item.hint;
      }
      host.append(key, value);
    }
  }

  function renderCurves(result: DeviceResult) {
    const host = el("curves");
    const box = el<HTMLDetailsElement>("curve-box");
    box.hidden = result.curves.length === 0;
    host.replaceChildren();
    for (const curve of result.curves) {
      const title = document.createElement("div");
      title.className = "chart-title";
      title.textContent = curve.title;
      const canvas = document.createElement("canvas");
      canvas.className = "chart";
      host.append(title, canvas);
      // Lay out before measuring, otherwise clientWidth is still zero.
      requestAnimationFrame(() => drawCurve(canvas, curve));
    }
  }

  function showFailure(error: unknown) {
    const host = el("warnings");
    host.replaceChildren();
    const alert = document.createElement("div");
    alert.className = "alert error";
    alert.textContent = `계산할 수 없습니다: ${error instanceof Error ? error.message : String(error)}`;
    host.append(alert);
  }

  selectDevice(current);

  // Redraw the charts when the panel is resized or a section is opened.
  window.addEventListener("resize", () => update(false));
  el<HTMLDetailsElement>("curve-box").addEventListener("toggle", () => update(false));

  // Expose the pieces a smoke test needs to poke at.
  (window as unknown as Record<string, unknown>).__lab = {
    viewer,
    THREE,
    setDevice: (id: string) => selectDevice(device(id)),
    setValue: (key: string, value: number | string) => {
      values[key] = value;
      renderControls();
      update(true);
    },
    result: () => current.simulate(values),
    /**
     * Render and read the framebuffer in one synchronous task.
     *
     * Without `preserveDrawingBuffer` the buffer is gone by the time a later
     * task calls `readPixels`, so a naive check reads a blank canvas and
     * reports a working renderer as broken.
     */
    sample: () => {
      viewer.renderer.render(viewer.scene, viewer.camera);
      const gl = viewer.renderer.getContext();
      const width = viewer.renderer.domElement.width;
      const height = viewer.renderer.domElement.height;
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const colours = new Set<string>();
      for (let i = 0; i < pixels.length; i += 4 * 53) {
        colours.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      }
      return { width, height, colours: colours.size };
    },
  };
}

function formatValue(value: number, step: number, log?: boolean): string {
  if (log) {
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(value >= 1e4 ? 0 : 1)}k`;
    return value.toFixed(0);
  }
  const decimals = step >= 1 ? 0 : String(step).split(".")[1]?.length ?? 2;
  return value.toFixed(decimals);
}

/** Snap a logarithmic slider to a value a human would type. */
function roundSignificant(value: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  return Math.round(value / (magnitude / 10)) * (magnitude / 10);
}

export type { Viewer };
