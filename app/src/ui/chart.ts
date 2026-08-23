/**
 * Minimal 2-D line chart on a canvas -- no dependency, readable on a phone.
 *
 * The axis captions get their own rows rather than being tucked into the
 * corners of the plot: at phone width a caption sitting beside the topmost
 * tick label simply lands on top of it.
 */

import type { Curve } from "../physics/types";

/** Height reserved for the caption above the plot, and for the one below. */
const CAPTION_ROW = 14;
const TICK_ROW = 13;
const PADDING = { top: 6, right: 14, bottom: 4, left: 8 };

const COLOURS = {
  grid: "#2a323d",
  text: "#8b96a5",
  line: "#38bdf8",
  marker: "#d29922",
};

export function drawCurve(canvas: HTMLCanvasElement, curve: Curve): void {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth || 300;
  const height = canvas.clientHeight || 160;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);
  ctx.font = "10px system-ui, sans-serif";

  const points = curve.points.filter((p) => isFinite(p.x) && isFinite(p.y));
  if (points.length < 2) return;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(...ys);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;

  // Reserve exactly the width the widest y tick label needs, so the numbers
  // never run into the plot and the plot never wastes space on short ones.
  const tickLabels = [0, 1, 2, 3].map((i) => format(yMax - (ySpan * i) / 3));
  const gutter = Math.ceil(Math.max(...tickLabels.map((t) => ctx.measureText(t).width))) + 8;

  const plotLeft = PADDING.left + gutter;
  const plotTop = PADDING.top + CAPTION_ROW;
  const plotW = width - plotLeft - PADDING.right;
  const plotH = height - plotTop - TICK_ROW - CAPTION_ROW - PADDING.bottom;
  if (plotW <= 10 || plotH <= 10) return;

  const toX = (x: number) => plotLeft + ((x - xMin) / xSpan) * plotW;
  const toY = (y: number) => plotTop + plotH - ((y - yMin) / ySpan) * plotH;

  // Captions, each on its own line.
  ctx.fillStyle = COLOURS.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(curve.yLabel, PADDING.left, PADDING.top);
  ctx.textAlign = "center";
  ctx.fillText(curve.xLabel, plotLeft + plotW / 2, height - CAPTION_ROW);

  // Horizontal grid with its tick labels in the gutter.
  ctx.strokeStyle = COLOURS.grid;
  ctx.lineWidth = 1;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  tickLabels.forEach((label, i) => {
    const y = plotTop + (plotH * i) / 3;
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotLeft + plotW, y);
    ctx.stroke();
    ctx.fillText(label, plotLeft - 6, y);
  });

  // X ticks, pulled in at the ends so they cannot overflow the canvas.
  ctx.textBaseline = "top";
  const tickY = plotTop + plotH + 3;
  [0, 0.5, 1].forEach((fraction, index) => {
    const value = xMin + xSpan * fraction;
    ctx.textAlign = index === 0 ? "left" : index === 2 ? "right" : "center";
    ctx.fillText(format(value), toX(value), tickY);
  });

  // Operating-point marker.
  if (curve.marker && curve.marker.x >= xMin && curve.marker.x <= xMax) {
    const x = toX(curve.marker.x);
    ctx.strokeStyle = COLOURS.marker;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotTop + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // The curve itself, clipped so a spike cannot draw over the captions.
  ctx.save();
  ctx.beginPath();
  ctx.rect(plotLeft, plotTop - 1, plotW, plotH + 2);
  ctx.clip();
  ctx.strokeStyle = COLOURS.line;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = toX(point.x);
    const y = toY(point.y);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

function format(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude === 0) return "0";
  if (magnitude >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (magnitude >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  if (magnitude >= 1) return value.toFixed(magnitude >= 100 ? 0 : 2);
  if (magnitude >= 1e-3) return `${(value * 1e3).toFixed(0)}m`;
  if (magnitude >= 1e-6) return `${(value * 1e6).toFixed(0)}µ`;
  return value.toExponential(0);
}
