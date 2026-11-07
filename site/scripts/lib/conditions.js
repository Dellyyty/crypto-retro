/**
 * Weather glyph mapping for price action.
 * Positive 24h moves are "sunny"; drawdowns are "storms". The
 * thresholds are intentionally coarse: a broadcast reads at a glance.
 */

const LADDER = [
  { min: 5, label: "Sunny", icon: "sunny" },
  { min: 1, label: "Fair", icon: "fair" },
  { min: -1, label: "P Cloudy", icon: "partly" },
  { min: -4, label: "Cloudy", icon: "cloudy" },
  { min: -8, label: "Showers", icon: "showers" },
  { min: -Infinity, label: "Storms", icon: "storm" },
];

/**
 * @param {number|null|undefined} changePct 24h percentage change
 * @returns {{label: string, icon: string}}
 */
export function conditionFor(changePct) {
  if (typeof changePct !== "number" || !Number.isFinite(changePct)) {
    return { label: "Haze", icon: "haze" };
  }
  return LADDER.find((step) => changePct >= step.min) ?? { label: "Haze", icon: "haze" };
}

/** Compact ticker weather word, matching WeatherStar's abbreviated style. */
export function conditionShort(changePct) {
  return conditionFor(changePct).label.toUpperCase();
}

/** Trend direction helper shared by charts and tables. */
export function trend(changePct) {
  if (typeof changePct !== "number" || !Number.isFinite(changePct) || changePct === 0) return "flat";
  return changePct > 0 ? "up" : "down";
}
