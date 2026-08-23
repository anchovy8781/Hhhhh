/** Minimal 2-D line chart on a canvas -- no dependency, readable on a phone. */

import type { Curve } from "../physics/types";

const PADDING = { top: 10, right: 12, bottom: 26, left: 46 };

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

  const plotW = width - PADDING.left - PADDING.right;
  const plotH = height - PADDING.top - PADDING.bottom;
  const toX = (x: number) => PADDING.left + ((x - xMin) / xSpan) * plotW;
  const toY = (y: number) => PADDING.top + plotH - ((y - yMin) / ySpan) * plotH;

  // Grid and axis labels.
  ctx.strokeStyle = "#2a323d";
  ctx.fillStyle = "#8b96a5";
  ctx.lineWidth = 1;
  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 3; i++) {
    const y = PADDING.top + (plotH * i) / 3;
    ctx.beginPath();
    ctx.moveTo(PADDING.left, y);
    ctx.lineTo(width - PADDING.right, y);
    ctx.stroke();
    ctx.fillText(format(yMax - (ySpan * i) / 3), PADDING.left - 6, y);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i <= 2; i++) {
    const value = xMin + (xSpan * i) / 2;
    ctx.fillText(format(value), toX(value), height - PADDING.bottom + 6);
  }

  // Axis captions.
  ctx.textAlign = "left";
  ctx.fillText(curve.yLabel, 2, 1);
  ctx.textAlign = "right";
  ctx.fillText(curve.xLabel, width - 4, height - 12);

  // Operating-point marker.
  if (curve.marker && curve.marker.x >= xMin && curve.marker.x <= xMax) {
    const x = toX(curve.marker.x);
    ctx.strokeStyle = "#d29922";
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, PADDING.top);
    ctx.lineTo(x, PADDING.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // The curve itself.
  ctx.strokeStyle = "#38bdf8";
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
