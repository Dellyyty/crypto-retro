/**
 * Pure-function tests. Run with `npm test` (node --test).
 * No DOM, no network: these modules are imported directly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isNum, usd, usdCompact, pct, share, num, gwei, hashrate, bytes, duration, arrowPct, clockUTC, shortDate,
} from "../site/scripts/lib/format.js";
import { conditionFor, conditionShort, trend } from "../site/scripts/lib/conditions.js";
import {
  moonAge, moonPhase, upcomingPhases, nextHalving, eraIssuedPct, narrativeFor, HALVING_INTERVAL,
} from "../site/scripts/lib/astro.js";

// ------------------------------------------------------------------ format

test("isNum rejects NaN, Infinity, strings and null", () => {
  assert.equal(isNum(1), true);
  assert.equal(isNum(0), true);
  assert.equal(isNum(-2.5), true);
  for (const bad of [NaN, Infinity, -Infinity, "1", null, undefined, {}]) {
    assert.equal(isNum(bad), false, `expected ${String(bad)} to be rejected`);
  }
});

test("usd scales precision with magnitude", () => {
  assert.equal(usd(75681), "$75,681");
  assert.equal(usd(2231.456), "$2,231");
  assert.equal(usd(89.43), "$89.43");
  assert.equal(usd(0.002841), "$0.002841");
  assert.equal(usd(0.00002841), "$0.000028");
  assert.equal(usd(null), "—");
  assert.equal(usd(NaN), "—");
});

test("usd sign option only prefixes positive values", () => {
  assert.equal(usd(12.5, { sign: true }), "+$12.50");
  assert.equal(usd(-12.5, { sign: true }), "$-12.50");
  assert.equal(usd(0, { sign: true }), "$0.00");
});

test("usdCompact formats trillions and billions", () => {
  assert.equal(usdCompact(2_560_915_629_137), "$2.56T");
  assert.equal(usdCompact(41_134_893_139), "$41.13B");
  assert.equal(usdCompact(999), "$999.00");
  assert.equal(usdCompact(undefined), "—");
});

test("pct signs values and keeps two decimals", () => {
  assert.equal(pct(0.33), "+0.33%");
  assert.equal(pct(-2.6), "-2.60%");
  assert.equal(pct(0), "0.00%");
  assert.equal(pct(1.23456, { digits: 4 }), "+1.2346%");
  assert.equal(pct(null), "—");
});

test("share is unsigned and one decimal", () => {
  assert.equal(share(59.3133), "59.3%");
  assert.equal(share(0), "0.0%");
  assert.equal(share(Infinity), "—");
});

test("num groups thousands", () => {
  assert.equal(num(974947), "974,947");
  assert.equal(num(0), "0");
  assert.equal(num(undefined), "—");
});

test("gwei converts hex wei", () => {
  // Post-blob Ethereum routinely sits below 1 gwei; precision must survive.
  assert.equal(gwei("0x3169f40"), "0.052");
  assert.equal(gwei("0x2e7d5f1"), "0.049");
  assert.equal(gwei(1_000_000_000), "1.0");
  assert.equal(gwei(12_500_000_000), "12.5");
  assert.equal(gwei("0x0"), "0.0000");
  assert.equal(gwei("nope"), "—");
});

test("hashrate walks SI prefixes", () => {
  assert.equal(hashrate(1_007_392_401_451_293_000_000), "1007.39 EH/s");
  assert.equal(hashrate(1_000), "1.00 kH/s");
  assert.equal(hashrate(0), "0.00 H/s");
  assert.equal(hashrate(null), "—");
});

test("bytes walks decimal units", () => {
  assert.equal(bytes(13_629_274), "13.6 MB");
  assert.equal(bytes(999), "999.0 B");
  assert.equal(bytes(undefined), "—");
});

test("duration renders days+hours or hours+minutes", () => {
  assert.equal(duration(90 * 60 * 1000), "1h 30m");
  assert.equal(duration(26 * 3600 * 1000), "1d 2h");
  assert.equal(duration(-5), "—");
  assert.equal(duration(NaN), "—");
});

test("arrowPct encodes direction without relying on color", () => {
  assert.equal(arrowPct(1.2), "▲ 1.20%");
  assert.equal(arrowPct(-1.2), "▼ 1.20%");
  assert.equal(arrowPct(0), "■ 0.00%");
  assert.equal(arrowPct(undefined), "—");
});

test("clockUTC is zero-padded and suffixed", () => {
  const d = new Date(Date.UTC(2026, 10, 7, 4, 5, 6));
  assert.equal(clockUTC(d), "04:05:06 UTC");
});

test("shortDate uses UTC month/day", () => {
  assert.equal(shortDate("2026-11-09T16:02:51.151Z"), "Nov 9");
  assert.equal(shortDate("not-a-date"), "—");
});

// ------------------------------------------------------------------ conditions

test("conditionFor maps the ladder boundaries exactly", () => {
  assert.equal(conditionFor(5).label, "Sunny");
  assert.equal(conditionFor(4.999).label, "Fair");
  assert.equal(conditionFor(1).label, "Fair");
  assert.equal(conditionFor(0.999).label, "P Cloudy");
  assert.equal(conditionFor(-1).label, "P Cloudy");
  assert.equal(conditionFor(-1.001).label, "Cloudy");
  assert.equal(conditionFor(-4).label, "Cloudy");
  assert.equal(conditionFor(-4.001).label, "Showers");
  assert.equal(conditionFor(-8).label, "Showers");
  assert.equal(conditionFor(-8.001).label, "Storms");
  assert.equal(conditionFor(-0.13).label, "P Cloudy");
});

test("conditionFor degrades to Haze for unknown input", () => {
  assert.deepEqual(conditionFor(null), { label: "Haze", icon: "haze" });
  assert.deepEqual(conditionFor(NaN), { label: "Haze", icon: "haze" });
  assert.equal(conditionShort(undefined), "HAZE");
});

test("trend is flat at exactly zero", () => {
  assert.equal(trend(1), "up");
  assert.equal(trend(-1), "down");
  assert.equal(trend(0), "flat");
  assert.equal(trend(null), "flat");
});

// ------------------------------------------------------------------ astro

test("moonAge is monotonic and bounded by the synodic month", () => {
  const a = moonAge(new Date("2026-11-01T00:00:00Z"));
  const b = moonAge(new Date("2026-11-02T00:00:00Z"));
  assert.ok(a >= 0 && a < 29.530588853);
  assert.ok(b > a || b < a === false);
  // 24h later should be ~1 day later unless it wrapped
  if (b > a) assert.ok(Math.abs(b - a - 1) < 0.01);
});

test("moonPhase returns the principal quarters at their fractions", () => {
  const S = 29.530588853;
  assert.equal(moonPhase(0).key, "new");
  assert.equal(moonPhase(S * 0.25).key, "first");
  assert.equal(moonPhase(S * 0.5).key, "full");
  assert.equal(moonPhase(S * 0.75).key, "last");
  assert.equal(moonPhase(S * 0.99).key, "new");
  assert.equal(moonPhase(S * 0.1).key, "waxing-crescent");
  assert.equal(moonPhase(S * 0.9).key, "waning-crescent");
});

test("moonPhase names the gibbous interludes", () => {
  const S = 29.530588853;
  assert.equal(moonPhase(S * 0.35).key, "waxing-gibbous");
  assert.equal(moonPhase(S * 0.65).key, "waning-gibbous");
});

test("upcomingPhases returns four future dates in ascending order", () => {
  const phases = upcomingPhases(new Date("2026-11-07T00:00:00Z"));
  assert.equal(phases.length, 4);
  const times = phases.map((p) => p.date.getTime());
  for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1]);
  for (const p of phases) assert.ok(p.date.getTime() > Date.parse("2026-11-07T00:00:00Z"));
});

test("nextHalving targets the next era boundary", () => {
  const h = nextHalving(974947);
  assert.equal(h.targetBlock, 1_050_000);
  assert.equal(h.blocksRemaining, 1_050_000 - 974_947);
  assert.equal(h.subsidy, 3.125);
  assert.ok(h.etaMs > 0);
  assert.equal(nextHalving(null), null);
});

test("nextHalving rolls over exactly at the boundary", () => {
  const at = nextHalving(HALVING_INTERVAL * 4);
  assert.equal(at.targetBlock, HALVING_INTERVAL * 5);
  assert.equal(at.blocksRemaining, HALVING_INTERVAL);
  assert.equal(at.subsidy, 3.125);
});

test("eraIssuedPct is bounded and increases with height", () => {
  const a = eraIssuedPct(0);
  const b = eraIssuedPct(974947);
  assert.equal(a, 0);
  assert.ok(b > 90 && b < 100);
  assert.ok(eraIssuedPct(1_050_000) >= b);
  assert.equal(eraIssuedPct(undefined), null);
});

test("eraIssuedPct never reaches the 21M cap", () => {
  assert.ok(eraIssuedPct(210000 * 34) < 100);
});

test("narrativeFor returns null without a finite 24h change", () => {
  assert.equal(narrativeFor({ change24h: null }), null);
  const n = narrativeFor({ asset: "BTC", change24h: 6, change7d: 2 });
  assert.equal(n.dir, "warmer");
  assert.equal(n.strength, "sharply ");
  assert.equal(n.week, "a brighter week");
});
