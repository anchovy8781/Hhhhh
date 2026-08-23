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
import {
  CATALOG_BY_KIND,
  searchCatalog,
  type CatalogKind,
  type IndexedItem,
} from "../physics/catalog/index";
import { applicationValues } from "../physics/applications";
import { readEnvironment } from "../physics/environment";
import { formatTime, runDevice, type RunResult } from "../physics/run";
import { buildDevice, type BuiltDevice } from "../view3d/builders";
import { Timelapse } from "../view3d/timelapse";
import { clearGroup, createViewer, type Viewer } from "../view3d/scene";
import { drawCurve } from "./chart";
import { PRESETS } from "./presets";

const GROUPS: ParamGroup[] = ["재료", "치수", "권선", "운전", "환경"];

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
  /**
   * Beginner mode hides the second-order settings and leans on the
   * recommendations. It starts on: the people who need it most are exactly the
   * ones who will not go looking for a switch.
   */
  let beginner = true;
  /** Rebuilding geometry costs more than recomputing numbers; throttle it. */
  let pendingBuild = 0;
  let built: BuiltDevice | null = null;
  let timelapse: Timelapse | null = null;

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

  const beginnerButton = el<HTMLButtonElement>("beginner");
  beginnerButton.addEventListener("click", () => {
    beginner = !beginner;
    beginnerButton.setAttribute("aria-pressed", String(beginner));
    beginnerButton.textContent = beginner ? "초보자 모드" : "전문가 모드";
    renderGuide();
    renderControls();
    update(false);
  });

  el<HTMLButtonElement>("picker-close").addEventListener("click", closePicker);
  el("picker").addEventListener("click", (event) => {
    if (event.target === el("picker")) closePicker();
  });

  el<HTMLButtonElement>("energise").addEventListener("click", energise);

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
    renderGuide();
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
      if (beginner && param.advanced) continue;
      host.append(
        param.kind === "number"
          ? numberControl(param)
          : param.kind === "choice"
            ? choiceControl(param)
            : catalogControl(param),
      );
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

    // Tapping the readout swaps it for a text field: sliders are for
    // exploring, typing is for the value you already decided on.
    readout.title = "정확한 값을 입력하려면 누르세요";
    readout.addEventListener("click", () => {
      const field = document.createElement("input");
      field.type = "number";
      field.className = "readout-input";
      field.value = String(values[param.key]);
      field.min = String(param.min);
      field.max = String(param.max);
      field.step = String(param.step);
      const commit = () => {
        const typed = Number(field.value);
        if (Number.isFinite(typed)) {
          const clamped = Math.min(Math.max(typed, param.min), param.max);
          values[param.key] = clamped;
          input.value = String(toSlider(clamped));
          show(clamped);
          update(true);
        }
        field.replaceWith(readout);
      };
      field.addEventListener("blur", commit);
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter") field.blur();
        if (event.key === "Escape") field.replaceWith(readout);
      });
      readout.replaceWith(field);
      field.focus();
      field.select();
    });

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
      // Choosing an application is choosing where the device runs, so it
      // carries its own ambient, cooling and enclosure with it.
      if (param.key === "app.profile") {
        Object.assign(values, applicationValues(select.value));
        renderControls();
      }
      showNote();
      update(true);
    });

    wrap.append(row, select, hint);
    return wrap;
  }

  function catalogControl(param: Extract<Param, { kind: "catalog" }>): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "control";
    const row = document.createElement("div");
    row.className = "row";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = param.label;
    row.append(name);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "catalog-pick";
    const current = findItem(param.catalog as CatalogKind, String(values[param.key]));
    button.innerHTML = `${current?.name ?? String(values[param.key])}<span class="cp-summary">${current?.summary ?? ""}</span>`;
    button.addEventListener("click", () => openPicker(param));

    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = current?.note ?? param.hint ?? "";

    wrap.append(row, button, hint);
    return wrap;
  }

  function findItem(kind: CatalogKind, id: string): IndexedItem | undefined {
    return (CATALOG_BY_KIND[kind] ?? []).find((item) => item.id === id);
  }

  /**
   * The searchable material picker.
   *
   * With over a thousand entries the only workable control is search, so the
   * sheet opens focused on the box and narrows as you type. Suggested tags are
   * the shortcuts for the searches this particular parameter usually wants.
   */
  function openPicker(param: Extract<Param, { kind: "catalog" }>) {
    const sheet = el("picker");
    const search = el<HTMLInputElement>("picker-search");
    const list = el("picker-list");
    const tags = el("picker-tags");
    const count = el("picker-count");
    const kind = param.catalog as CatalogKind;
    const selected = String(values[param.key]);

    const render = () => {
      const found = searchCatalog(search.value, { kind, limit: 80 });
      const total = (CATALOG_BY_KIND[kind] ?? []).length;
      count.textContent = search.value.trim()
        ? `${total}개 중 ${found.length}개 (상위 80개까지 표시)`
        : `${total}개 · 이름·등급·용도로 검색하세요`;
      list.replaceChildren();
      for (const item of found) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "picker-item";
        if (item.id === selected) button.setAttribute("aria-current", "true");
        button.innerHTML =
          `<div class="pi-name">${item.name}</div>` +
          `<div class="pi-summary">${item.summary}</div>` +
          `<div class="pi-note">${item.note}</div>` +
          `<span class="pi-src">${item.family} · 근거: ${item.provenance}</span>`;
        button.addEventListener("click", () => {
          values[param.key] = item.id;
          closePicker();
          renderControls();
          update(true);
        });
        list.append(button);
      }
    };

    tags.replaceChildren();
    const suggestions = param.suggestedTags ?? defaultTags(kind);
    for (const tag of suggestions) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "picker-tag";
      chip.textContent = tag;
      chip.addEventListener("click", () => {
        search.value = tag;
        render();
      });
      tags.append(chip);
    }

    search.value = "";
    search.oninput = render;
    render();
    sheet.hidden = false;
    search.focus();
  }

  function closePicker() {
    el("picker").hidden = true;
  }

  function defaultTags(kind: CatalogKind): string[] {
    switch (kind) {
      case "core":
        return ["페라이트", "규소강", "분말코어", "나노결정", "고주파", "저손실", "고포화"];
      case "conductor":
        return ["구리", "알루미늄", "리츠", "포일", "저가", "고주파"];
      case "magnet":
        return ["네오디뮴", "페라이트자석", "smco", "고온", "저가"];
      case "coolant":
        return ["자연", "강제", "수냉", "유입", "밀폐", "고방열"];
      default:
        return [];
    }
  }

  /** Three sentences telling a newcomer what this screen is for. */
  function renderGuide() {
    const host = el("guide");
    host.replaceChildren();
    if (!beginner) return;
    const steps: [string, string][] = [
      ["1. 고르기", "만들 기기와 재료를 고릅니다"],
      ["2. 목표 넣기", "전압·용량 같은 원하는 값을 넣고 추천을 적용합니다"],
      ["3. 돌려보기", "전원을 인가해 30분을 버티는지 봅니다"],
    ];
    for (const [title, body] of steps) {
      const box = document.createElement("div");
      box.className = "guide-step";
      box.innerHTML = `<b>${title}</b>${body}`;
      host.append(box);
    }
  }

  /**
   * The recommendation card.
   *
   * This is the answer to the blank-sheet problem: it turns "what turns count
   * do I need?" into a button, and says which equation produced each number so
   * the answer can be checked rather than trusted.
   */
  function renderAdvice() {
    const host = el("advice");
    host.replaceChildren();
    if (!current.recommend) {
      host.hidden = true;
      return;
    }
    let suggestions: ReturnType<NonNullable<typeof current.recommend>>;
    try {
      suggestions = current.recommend(values);
    } catch {
      host.hidden = true;
      return;
    }
    if (suggestions.length === 0) {
      host.hidden = true;
      return;
    }
    host.hidden = false;

    const head = document.createElement("div");
    head.className = "advice-head";
    const title = document.createElement("span");
    title.className = "advice-title";
    title.textContent = `추천값 ${suggestions.length}건`;
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "advice-apply";
    apply.textContent = "모두 적용";
    apply.addEventListener("click", () => {
      for (const item of suggestions) values[item.key] = item.value;
      renderControls();
      update(true);
    });
    head.append(title, apply);
    host.append(head);

    for (const item of suggestions) {
      const box = document.createElement("div");
      box.className = "advice-item";
      box.innerHTML = `<div>${item.label}</div><div class="ai-why">${item.reason}</div>`;
      host.append(box);
    }
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
    const button = el<HTMLButtonElement>("energise");
    if (button.dataset.state) {
      // The design moved, so the previous run no longer describes it.
      delete button.dataset.state;
      button.textContent = "⚡ 전원 인가하고 돌려보기";
      el("run-report").hidden = true;
    }
    renderHeadline(result);
    renderAdvice();
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
    stopTimelapse();
    clearGroup(viewer.stage);
    built = buildDevice(result.build);
    viewer.stage.add(built.group);
    viewer.frame(built.radius);
    renderBadges(result, built.turnsAbbreviated);
  }

  function stopTimelapse() {
    timelapse?.dispose();
    timelapse = null;
    clearGroup(viewer.effects);
    el("timelapse").hidden = true;
  }

  /** Play the run back on the model itself. */
  function startTimelapse(run: RunResult, result: DeviceResult) {
    stopTimelapse();
    if (!built || !result.runtime) return;
    const player = new Timelapse(
      viewer.stage,
      viewer.effects,
      run,
      result.runtime.parts,
      built.radius,
    );
    timelapse = player;
    const bar = el("timelapse");
    const fill = el("tl-fill");
    const readout = el("tl-readout");
    bar.hidden = false;
    player.onUpdate((state) => {
      fill.style.width = `${(state.fraction * 100).toFixed(1)}%`;
      const winding = state.temperatures.winding ?? state.temperatures.core ?? 0;
      const failures = state.fired.filter((event) => event.level === "error");
      fill.classList.toggle("hot", failures.length > 0);
      const speed = state.rpm > 0 ? ` · ${state.rpm.toFixed(0)} rpm` : "";
      const latest = failures.at(-1);
      readout.textContent = latest
        ? `${formatTime(state.time)} · ${winding.toFixed(0)}°C — ${latest.title}`
        : `${formatTime(state.time)} · 권선 ${winding.toFixed(0)}°C · ${state.current.toFixed(2)} A${speed}`;
    });
    player.play();
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
    const build = result.build as { saturation?: number; windings?: { label: string; turns: number; wireDiameter: number }[] };
    const saturation = build.saturation ?? 0;
    if (saturation > 0.999) add("포화", true);
    else if (saturation > 0.85) add(`자속 ${Math.round(saturation * 100)}%`, true);
    else if (saturation > 0) add(`자속 ${Math.round(saturation * 100)}%`);
    for (const winding of build.windings ?? []) {
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

  const PART_LABELS: Record<string, string> = {
    winding: "권선",
    core: "코어",
    magnet: "영구자석",
    insulation: "절연물",
    bobbin: "보빈",
    housing: "하우징",
    supply: "전원",
  };

  /**
   * Apply power and report what happened.
   *
   * The static panel answers "what does this settle at"; this answers "does it
   * get there", which is a different question whenever an inrush, a
   * temperature limit or a magnet's grade is involved.
   */
  function energise() {
    const button = el<HTMLButtonElement>("energise");
    const report = el("run-report");
    let result: DeviceResult;
    try {
      result = current.simulate(values);
    } catch (error) {
      showFailure(error);
      return;
    }
    if (!result.runtime) {
      report.hidden = false;
      report.textContent = "이 장치는 아직 전원 인가 시뮬레이션을 지원하지 않습니다.";
      return;
    }

    const duration = Number(el<HTMLSelectElement>("run-duration").value) || 1800;
    const run = runDevice(result.runtime, readEnvironment(values), { duration });
    renderRun(run, result);
    startTimelapse(run, result);
    button.dataset.state = run.verdict;
    button.textContent =
      run.verdict === "ok"
        ? `⚡ ${formatTime(run.duration)} 연속 운전 통과 — 다시 돌려보기`
        : run.verdict === "warn"
          ? "⚠ 한계에 근접했습니다 — 아래 확인"
          : "⛔ 운전 중 고장 — 아래 확인";
  }

  function renderRun(run: RunResult, result: DeviceResult) {
    const report = el("run-report");
    report.hidden = false;
    report.replaceChildren();

    const verdict = document.createElement("div");
    verdict.className = `run-verdict ${run.verdict}`;
    const span = formatTime(run.duration);
    verdict.textContent =
      run.verdict === "fail"
        ? `${formatTime(run.failedAt ?? 0)} 만에 ${PART_LABELS[run.failedPart ?? ""] ?? "부품"}이(가) 고장났습니다`
        : run.verdict === "warn"
          ? `${span} 운전은 버텼지만 여유가 없습니다`
          : `${span} 연속 운전, 이상 없음`;
    report.append(verdict);

    const stats = document.createElement("div");
    stats.className = "run-stats";
    const addStat = (label: string, value: string) => {
      const k = document.createElement("div");
      k.className = "k";
      k.textContent = label;
      const v = document.createElement("div");
      v.className = "v";
      v.textContent = value;
      stats.append(k, v);
    };
    addStat("돌입 최대 전류", `${run.peakCurrent.toFixed(2)} A`);
    addStat("정상 전류", `${run.steadyCurrent.toFixed(2)} A`);
    addStat("전류 상승 시간", formatTime(run.currentRise));
    for (const part of result.runtime!.parts) {
      const temp = run.finalTemperatures[part.id];
      if (temp === undefined) continue;
      addStat(`${part.label} 최종 온도`, `${temp.toFixed(0)} °C / 한계 ${part.limit}°C`);
    }
    report.append(stats);

    for (const event of run.events) {
      const box = document.createElement("div");
      box.className = `run-event ${event.level}`;
      box.innerHTML =
        `<div class="re-title">${event.title}` +
        `<span class="re-part">${PART_LABELS[event.partId] ?? event.partId}</span></div>` +
        `<div>${event.text}</div>` +
        `<div class="re-advice">→ ${event.advice}</div>`;
      report.append(box);
    }

    const currentCurve = {
      key: "run-current",
      title: "전원 인가 직후 전류",
      xLabel: "시간 [ms]",
      yLabel: "전류 [A]",
      points: run.electrical.map((sample) => ({ x: sample.t * 1e3, y: sample.current })),
    };
    const tempCurve = {
      key: "run-temp",
      title: "운전 시간에 따른 권선 온도",
      xLabel: "시간 [분]",
      yLabel: "온도 [°C]",
      points: run.thermal.map((sample) => ({
        x: sample.t / 60,
        y: sample.temperatures.winding ?? sample.temperatures.core ?? 0,
      })),
    };
    for (const curve of [currentCurve, tempCurve]) {
      const title = document.createElement("div");
      title.className = "chart-title";
      title.textContent = curve.title;
      const canvas = document.createElement("canvas");
      canvas.className = "chart";
      report.append(title, canvas);
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
    energise: () => {
      const built = current.simulate(values);
      return built.runtime
        ? runDevice(built.runtime, readEnvironment(values), { duration: 1800 })
        : null;
    },
    advice: () => (current.recommend ? current.recommend(values) : []),
    setBeginner: (on: boolean) => {
      beginner = on;
      beginnerButton.setAttribute("aria-pressed", String(on));
      renderControls();
    },
    controlCount: () => document.querySelectorAll(".control").length,
    search: (query: string, kind: string) =>
      searchCatalog(query, { kind: kind as CatalogKind, limit: 20 }).map((i) => i.id),
    timelapseState: () => {
      let captured: unknown = null;
      timelapse?.onUpdate((state) => {
        captured = state;
      });
      return captured;
    },
    effectCount: () => viewer.effects.children.length,
    openPickerFor: (key: string) => {
      const param = current.params.find((p) => p.key === key);
      if (param && param.kind === "catalog") openPicker(param);
    },
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
