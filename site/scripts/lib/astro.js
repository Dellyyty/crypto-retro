/**
 * Astronomy + chain math. Deterministic, unit-testable.
 */

const SYNODIC = 29.530588853; // days
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // ms, 2000-01-06 18:14 UTC
const DAY = 86400000;

/** Moon age in days for a given date (0 = new). */
export function moonAge(date = new Date()) {
  const days = (date.getTime() - KNOWN_NEW_MOON) / DAY;
  return ((days % SYNODIC) + SYNODIC) % SYNODIC;
}

/**
 * Eight-phase name for an age.
 * Boundaries are the classic quarters; names use WeatherStar's four
 * primary labels plus interludes so the UI never reads "waxing gibbous"
 * where a 90s weather box would say "First".
 */
export function moonPhase(ageDays) {
  const frac = ageDays / SYNODIC;
  if (frac < 0.033 || frac >= 0.967) return { key: "new", label: "New", icon: "i-moon-new" };
  if (frac < 0.217) return { key: "waxing-crescent", label: "Wax Crescent", icon: "i-moon-first" };
  if (frac < 0.283) return { key: "first", label: "First", icon: "i-moon-first" };
  if (frac < 0.467) return { key: "waxing-gibbous", label: "Wax Gibbous", icon: "i-moon-full" };
  if (frac < 0.533) return { key: "full", label: "Full", icon: "i-moon-full" };
  if (frac < 0.717) return { key: "waning-gibbous", label: "Wan Gibbous", icon: "i-moon-full" };
  if (frac < 0.783) return { key: "last", label: "Last", icon: "i-moon-last" };
  return { key: "waning-crescent", label: "Wan Crescent", icon: "i-moon-last" };
}

/** Date of the next occurrence of each principal phase, relative to `from`. */
export function upcomingPhases(from = new Date()) {
  const age = moonAge(from);
  const targets = [
    { key: "new", label: "New", icon: "i-moon-new", at: 0 },
    { key: "first", label: "First", icon: "i-moon-first", at: SYNODIC * 0.25 },
    { key: "full", label: "Full", icon: "i-moon-full", at: SYNODIC * 0.5 },
    { key: "last", label: "Last", icon: "i-moon-last", at: SYNODIC * 0.75 },
  ];
  return targets.map((t) => {
    let delta = t.at - age;
    if (delta <= 0) delta += SYNODIC;
    return { ...t, date: new Date(from.getTime() + delta * DAY) };
  });
}

/**
 * Bitcoin halving math.
 * Subsidy halves every 210,000 blocks; the 5th halving is block 1,050,000.
 */
export const HALVING_INTERVAL = 210000;

export function nextHalving(height, blockMinutes = 10) {
  if (!Number.isFinite(height)) return null;
  const era = Math.floor(height / HALVING_INTERVAL) + 1;
  const target = era * HALVING_INTERVAL;
  const blocks = target - height;
  const subsidy = 50 / 2 ** (era - 1);
  return {
    targetBlock: target,
    blocksRemaining: blocks,
    subsidy,
    etaMs: blocks * blockMinutes * 60000,
    // Cumulative issuance approaches 21M; era sum of 210000 * 50/2^n.
    issuedPct: eraIssuedPct(height),
  };
}

export function eraIssuedPct(height) {
  if (!Number.isFinite(height)) return null;
  const era = Math.floor(height / HALVING_INTERVAL);
  let issued = 0;
  for (let e = 0; e < era; e++) issued += HALVING_INTERVAL * (50 / 2 ** e);
  issued += (height % HALVING_INTERVAL) * (50 / 2 ** era);
  return (issued / 21000000) * 100;
}

/**
 * Map a 24h % change to a WeatherStar-style sentence.
 * Inputs are real numbers; unknown values produce a neutral line.
 */
export function narrativeFor({ asset, change24h, change7d, high24h, low24h }) {
  if (!Number.isFinite(change24h)) return null;
  const dir = change24h > 0.35 ? "warmer" : change24h < -0.35 ? "cooler" : "steady";
  const strength = Math.abs(change24h) > 4 ? "sharply " : "";
  const week = Number.isFinite(change7d) ? (change7d >= 0 ? "a brighter week" : "a softer week") : "mixed signals";
  return { dir, strength, week, asset, high24h, low24h };
}
