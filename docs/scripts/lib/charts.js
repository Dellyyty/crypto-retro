/**
 * Canvas renderers. All drawing is DPR-aware and theme-consistent with the
 * CRT look: hard 2px keylines, no anti-aliased gradients on data marks.
 */

const PALETTE = {
  yellow: "#ffff6f",
  up: "#7dff8a",
  down: "#ff8f8f",
  cyan: "#8fd0ff",
  ink: "#0b0a12",
  grid: "rgba(255,255,255,0.13)",
  faint: "rgba(255,255,255,0.42)",
  surface: "rgba(0,0,0,0.18)",
};

/**
 * Size the backing store to the CSS box at device pixel ratio.
 * Returns null for a degenerate box: a canvas measured before layout settles is
 * 0×0 or 1×N, and resizing to that would blow away the good bitmap and any
 * later draw would stretch the 1-px stub. Callers bail out instead.
 */
function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  return { ctx, w: rect.width, h: rect.height };
}

/** Daily candlesticks with a volume histogram floor. */
export function drawCandles(canvas, candles) {
  if (!canvas) return;
  const box = fitCanvas(canvas);
  if (!box) return;
  const { ctx, w, h } = box;
  if (!Array.isArray(candles) || candles.length < 2) {
    ctx.fillStyle = PALETTE.faint;
    ctx.font = "600 13px 'Martian Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("NO SIGNAL", w / 2, h / 2);
    return;
  }

  const padTop = 12;
  const padBottom = 26;
  const padLeft = 54;
  const padRight = 10;
  const volH = Math.max(18, h * 0.16);
  const plotH = h - padTop - padBottom - volH;
  const plotW = w - padLeft - padRight;

  const highs = candles.map((c) => c.h);
  const lows = candles.map((c) => c.l);
  let max = Math.max(...highs);
  let min = Math.min(...lows);
  const span = max - min || 1;
  max += span * 0.08;
  min -= span * 0.08;

  const x = (i) => padLeft + (i / (candles.length - 1)) * (plotW - plotW / candles.length) + plotW / candles.length / 2;
  const y = (v) => padTop + ((max - v) / (max - min)) * plotH;

  // Volume shares the plot's x axis but owns a strip above the baseline; it
  // must never intrude on the date ticks below it.
  const maxVol = Math.max(...candles.map((c) => c.v || 0), 1);
  const volBase = h - padBottom;
  const vy = (v) => volBase - (v / maxVol) * volH * 0.85;

  // grid
  ctx.strokeStyle = PALETTE.grid;
  ctx.lineWidth = 1;
  ctx.font = "500 9px 'Martian Mono', monospace";
  ctx.fillStyle = PALETTE.faint;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    const yy = Math.round(y(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(padLeft, yy);
    ctx.lineTo(w - padRight, yy);
    ctx.stroke();
    ctx.fillText(priceTick(v), padLeft - 7, yy);
  }

  const bodyW = Math.max(2.5, (plotW / candles.length) * 0.72);
  candles.forEach((c, i) => {
    const rise = c.c >= c.o;
    const color = rise ? PALETTE.up : PALETTE.down;
    const cx = x(i);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    // wick
    ctx.beginPath();
    ctx.moveTo(Math.round(cx) + 0.5, y(c.h));
    ctx.lineTo(Math.round(cx) + 0.5, y(c.l));
    ctx.stroke();
    // body
    const top = y(Math.max(c.o, c.c));
    const bottom = y(Math.min(c.o, c.c));
    const bh = Math.max(1.5, bottom - top);
    ctx.fillRect(cx - bodyW / 2, top, bodyW, bh);
    // volume
    if (c.v) {
      const top = vy(c.v);
      ctx.globalAlpha = 0.42;
      ctx.fillRect(cx - bodyW / 2, top, bodyW, Math.max(1, volBase - top));
      ctx.globalAlpha = 1;
    }
  });

  // baseline
  ctx.strokeStyle = PALETTE.faint;
  ctx.beginPath();
  ctx.moveTo(padLeft, volBase + 0.5);
  ctx.lineTo(w - padRight, volBase + 0.5);
  ctx.stroke();

  // date ticks
  ctx.fillStyle = PALETTE.faint;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const tickIdx = [0, Math.floor(candles.length / 3), Math.floor((candles.length * 2) / 3), candles.length - 1];
  for (const i of tickIdx) {
    const d = new Date(candles[i].t);
    ctx.fillText(`${d.getUTCMonth() + 1}/${String(d.getUTCDate()).padStart(2, "0")}`, x(i), volBase + 5);
  }
}

/** 7-day sparkline, single stroke, no axes. */
export function drawSparkline(canvas, values, direction = "up") {
  if (!canvas) return;
  const box = fitCanvas(canvas);
  if (!box) return;
  const { ctx, w, h } = box;
  if (!Array.isArray(values) || values.length < 2) return;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const px = (i) => (i / (values.length - 1)) * (w - 2) + 1;
  const py = (v) => h - 2 - ((v - min) / span) * (h - 4);
  ctx.strokeStyle = direction === "down" ? PALETTE.down : PALETTE.up;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.beginPath();
  values.forEach((v, i) => {
    if (i === 0) ctx.moveTo(px(i), py(v));
    else ctx.lineTo(px(i), py(v));
  });
  ctx.stroke();
}

/** Semicircular fear/greed gauge, 0..100. */
export function drawGauge(canvas, value) {
  if (!canvas) return;
  const box = fitCanvas(canvas);
  if (!box) return;
  const { ctx, w, h } = box;
  const cx = w / 2;
  const cy = h * 0.92;
  const r = Math.min(w * 0.44, h * 0.82);
  const bands = [
    [0, 25, "#ff8f8f"],
    [25, 45, "#e28144"],
    [45, 55, "#ffd766"],
    [55, 75, "#9fe8a8"],
    [75, 100, "#7dff8a"],
  ];
  const start = Math.PI;
  for (const [a, b, color] of bands) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = r * 0.19;
    ctx.arc(cx, cy, r, start + (a / 100) * Math.PI, start + (b / 100) * Math.PI);
    ctx.stroke();
  }
  // ticks
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI + (i / 10) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r - r * 0.11), cy + Math.sin(a) * (r - r * 0.11));
    ctx.lineTo(cx + Math.cos(a) * (r + r * 0.11), cy + Math.sin(a) * (r + r * 0.11));
    ctx.stroke();
  }
  if (!Number.isFinite(value)) return;
  const a = Math.PI + (Math.max(0, Math.min(100, value)) / 100) * Math.PI;
  ctx.strokeStyle = PALETTE.yellow;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(a) * r * 0.24, cy + Math.sin(a) * r * 0.24);
  ctx.lineTo(cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92);
  ctx.stroke();
  ctx.fillStyle = PALETTE.ink;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.09, 0, Math.PI * 2);
  ctx.fill();
}

function priceTick(v) {
  if (v >= 1000) return `${Math.round(v / 100) / 10}k`;
  if (v >= 1) return v.toFixed(0);
  return v.toFixed(3);
}
