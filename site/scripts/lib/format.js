/**
 * Formatting helpers. Pure functions, no DOM.
 * All money is USD; all numbers are finite or null.
 */

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf4 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const nf6 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const compactFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

/** True only for real numbers. Guards every formatter against undefined API fields. */
export function isNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/** Dollar amount with precision scaled to magnitude. */
export function usd(n, { sign = false } = {}) {
  if (!isNum(n)) return "—";
  const abs = Math.abs(n);
  let body;
  if (abs >= 1000) body = nf0.format(n);
  else if (abs >= 1) body = nf2.format(n);
  else if (abs >= 0.01) body = nf4.format(n);
  else body = nf6.format(n);
  const prefix = sign && n > 0 ? "+" : "";
  return `${prefix}$${body}`;
}

/** Compact money for market caps and volumes: $2.56T, $41.13B. */
export function usdCompact(n) {
  if (!isNum(n)) return "—";
  return `$${compactFmt.format(n)}`;
}

/** Signed percentage, always two decimals. */
export function pct(n, { digits = 2 } = {}) {
  if (!isNum(n)) return "—";
  const v = n.toFixed(digits);
  return `${n > 0 ? "+" : ""}${v}%`;
}

/** Percentage from an already-positive ratio (dominance). */
export function share(n) {
  if (!isNum(n)) return "—";
  return `${n.toFixed(1)}%`;
}

export function num(n) {
  if (!isNum(n)) return "—";
  return nf0.format(n);
}

export function gwei(weiHex) {
  const wei = typeof weiHex === "string" ? Number.parseInt(weiHex, 16) : weiHex;
  if (!isNum(wei)) return "—";
  const g = wei / 1e9;
  // Sub-gwei gas is normal post-blob; one decimal would render 0.052 as "0.1".
  if (g < 0.01) return g.toFixed(4);
  if (g < 1) return g.toFixed(3);
  return g.toFixed(1);
}

export function hashrate(h) {
  if (!isNum(h)) return "—";
  // Network hashrate is reported in EH/s in practice; stop the ladder there.
  const units = ["H/s", "kH/s", "MH/s", "GH/s", "TH/s", "PH/s", "EH/s"];
  let v = h;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v.toFixed(2)} ${units[i]}`;
}

export function bytes(n) {
  if (!isNum(n)) return "—";
  const units = ["B", "kB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function duration(ms) {
  if (!isNum(ms) || ms < 0) return "—";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

/** Short asset label from API shapes: {symbol:"btc"} → "BTC". */
export function sym(asset) {
  return String(asset?.symbol ?? asset?.id ?? "").toUpperCase();
}

export function clockUTC(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())} UTC`;
}

export function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Signed delta used by the ticker: "▲ 0.33%". */
export function arrowPct(n) {
  if (!isNum(n)) return "—";
  return `${n > 0 ? "▲" : n < 0 ? "▼" : "■"} ${Math.abs(n).toFixed(2)}%`;
}
