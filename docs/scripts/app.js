/**
 * CRYPTOCAST — broadcast controller.
 *
 * Six screens rotate on a fixed clock. State is a single snapshot object
 * written by the data layer; renderers are pure functions of that state.
 * Deep links: #markets, #chart, #network, #ephemeris, #discussion.
 */

import {
  fetchMarkets,
  fetchGlobal,
  fetchFearGreed,
  fetchChain,
  fetchEth,
  fetchFunding,
  fetchCandlesAll,
  readCache,
  writeCache,
} from "./lib/api.js";
import {
  usd, usdCompact, pct, share, num, gwei, hashrate, bytes, duration, clockUTC, shortDate, arrowPct,
} from "./lib/format.js";
import { conditionFor, conditionShort } from "./lib/conditions.js";
import { moonAge, upcomingPhases, nextHalving, eraIssuedPct, narrativeFor } from "./lib/astro.js";
import { drawCandles, drawSparkline, drawGauge } from "./lib/charts.js";
import { startAudio, stopAudio, cue, isAudioOn } from "./lib/audio.js";

const SCREENS = ["conditions", "markets", "chart", "network", "ephemeris", "discussion"];
const TITLES = {
  conditions: "Current Conditions",
  markets: "Market Ladder",
  chart: "Candle Range",
  network: "Chain Telemetry",
  ephemeris: "Market Ephemeris",
  discussion: "Discussion",
};
const SCREEN_MS = 11000;
const REFRESH_MS = 60000;
const STORE_KEY = "cryptocast.screen";
/** Deep-link target, captured at module evaluation — init() rewrites the hash. */
const INITIAL_SCREEN = SCREENS.includes(location.hash.slice(1)) ? location.hash.slice(1) : null;

const $ = (id) => document.getElementById(id);
const state = {
  markets: null,
  global: null,
  fearGreed: null,
  chain: null,
  eth: null,
  funding: null,
  candles: null,
  chartAsset: "BTC",
  screen: "conditions",
  started: false,
  paused: false,
  online: true,
  lastUpdated: null,
};


// ------------------------------------------------------------------ canvases

/**
 * Canvas painters run once against a laid-out box and again whenever the box
 * changes. A hidden screen or an unresolved grid row reports 0 height, which
 * would bake a 1-px bitmap; the observer repaints as soon as layout settles.
 */
const painters = new WeakMap();
let canvasObserver = null;

/**
 * Draw only against a settled box.
 *
 * Two hazards, both real: a detached canvas reports the intrinsic 300×150
 * default, and a canvas inside a display:none screen reports 0×0. Painting in
 * either state bakes a bitmap at the wrong scale. getComputedStyle is the
 * discriminator — before CSS applies it returns "auto" (NaN here), so the
 * comparison fails and the caller retries on the next frame instead of
 * committing a bad size.
 */
function commit(canvas, draw) {
  const cs = getComputedStyle(canvas);
  const cw = Number.parseFloat(cs.width);
  const ch = Number.parseFloat(cs.height);
  if (!(cw >= 8) || !(ch >= 8)) return false;
  const r = canvas.getBoundingClientRect();
  if (Math.abs(r.width - cw) > 1 || Math.abs(r.height - ch) > 1) return false;
  draw();
  return true;
}

/**
 * Register a canvas painter.
 *
 * Painted immediately (once layout settles), on every call — which is what
 * covers new data landing in an unchanged box — and on every later resize.
 * The ResizeObserver alone is not enough: it fires only when the box *changes*.
 */
function paint(canvas, draw) {
  if (!canvas) return;
  painters.set(canvas, draw);
  if (!canvasObserver) {
    canvasObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const drawFn = painters.get(entry.target);
        if (drawFn) commit(entry.target, drawFn);
      }
    });
  }
  canvasObserver.observe(canvas);
  let tries = 0;
  const attempt = () => {
    if (!commit(canvas, draw) && ++tries < 20) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}

/** Paint every registered canvas inside `root`; used after a screen is revealed. */
function paintWithin(root) {
  for (const canvas of root.querySelectorAll("canvas")) {
    const draw = painters.get(canvas);
    if (draw) commit(canvas, draw);
  }
}

// ------------------------------------------------------------------ boot

function hydrateFromCache() {
  const cached = readCache();
  if (!cached) return;
  for (const key of ["markets", "global", "fearGreed", "chain", "eth", "funding"]) {
    if (cached[key]) state[key] = cached[key];
  }
  if (cached.candles) state.candles = cached.candles;
  state.lastUpdated = cached.savedAt ?? null;
  renderAll();
}

async function loadAll() {
  const [markets, global, fearGreed, chain, eth, funding] = await Promise.all([
    fetchMarkets(),
    fetchGlobal(),
    fetchFearGreed(),
    fetchChain(),
    fetchEth(),
    fetchFunding(),
  ]);
  if (markets) state.markets = markets;
  if (global) state.global = global;
  if (fearGreed) state.fearGreed = fearGreed;
  if (chain) state.chain = chain;
  if (eth) state.eth = eth;
  if (funding) state.funding = funding;
  state.lastUpdated = Date.now();
  state.online = Boolean(markets || chain || eth);
  writeCache({
    markets: state.markets,
    global: state.global,
    fearGreed: state.fearGreed,
    chain: state.chain,
    eth: state.eth,
    funding: state.funding,
  });
  renderAll();
}

async function loadCandles() {
  const candles = await fetchCandlesAll();
  if (!candles) return;
  const merged = { ...(state.candles ?? {}), ...Object.fromEntries(Object.entries(candles).filter(([, v]) => v)) };
  state.candles = merged;
  writeCache({
    markets: state.markets,
    global: state.global,
    fearGreed: state.fearGreed,
    chain: state.chain,
    eth: state.eth,
    funding: state.funding,
    candles: merged,
  });
  renderChart();
  renderForecastCards();
}

// ------------------------------------------------------------------ screens

function showScreen(name, { announce = true } = {}) {
  if (!SCREENS.includes(name)) return;
  state.screen = name;
  try { sessionStorage.setItem(STORE_KEY, name); } catch { /* ignore */ }

  for (const key of SCREENS) {
    const el = $(`screen-${key}`);
    if (!el) continue;
    const active = key === name;
    el.hidden = !active;
    el.classList.toggle("is-entering", active && announce);
  }
  const title = $("screenTitle");
  if (title) title.textContent = TITLES[name];
  if (location.hash.slice(1) !== name) history.replaceState(null, "", `#${name}`);
  if (announce) cue("change");
  // Canvas views measure 0×0 while hidden; redraw on reveal.
  if (name === "chart") requestAnimationFrame(() => { renderChart(); renderForecastCards(); });
  if (name === "ephemeris") requestAnimationFrame(renderGauge);
  if (name === "markets") requestAnimationFrame(renderMarkets);
  if (name === "discussion") requestAnimationFrame(() => fitCopy($("narrative")));
}

function cycle() {
  if (!state.started || state.paused) return;
  const i = SCREENS.indexOf(state.screen);
  showScreen(SCREENS[(i + 1) % SCREENS.length]);
}

function startRotation() {
  setInterval(cycle, SCREEN_MS);
}

// ------------------------------------------------------------------ render

function renderAll() {
  renderConditions();
  renderMarkets();
  renderChart();
  renderNetwork();
  renderEphemeris();
  renderDiscussion();
  renderTicker();
  renderClock();
}

function btc() {
  return state.markets?.find((m) => m.symbol === "BTC") ?? null;
}

function renderConditions() {
  const coin = btc();
  const move = coin?.change24h;
  const cond = conditionFor(move);
  $("btcPrice").textContent = coin ? usd(coin.price) : "—";
  $("btcName").textContent = coin ? coin.name.toUpperCase() : "BITCOIN";
  $("btcCondition").textContent = cond.label;
  const changeEl = $("btcChange");
  changeEl.textContent = pct(move);
  changeEl.className = move > 0 ? "up" : move < 0 ? "down" : "";
  $("btcIcon").innerHTML = `<use href="#i-${cond.icon}"/>`;
  $("btcHigh").textContent = coin ? usd(coin.high24h) : "—";
  $("btcLow").textContent = coin ? usd(coin.low24h) : "—";

  const g = state.global;
  const fg = state.fearGreed;
  const chain = state.chain;
  const eth = state.eth;
  const rows = $("conditionsStats").querySelectorAll("dd");
  rows[0].textContent = g ? share(g.btcDominance) : "—";
  rows[1].textContent = g ? usdCompact(g.totalVolume) : "—";
  rows[2].textContent = fg ? `${fg.value} ${fg.label}` : "—";
  rows[3].textContent = eth ? `${gwei(eth.gasPriceWei)} gwei` : "—";
  rows[4].textContent = state.funding?.BTC != null ? pct(state.funding.BTC * 100, { digits: 4 }) : "—";
  rows[5].textContent = chain ? hashrate(chain.hashrate) : "—";

  // Four asset chips: 24h moves of the top four.
  const strip = $("conditionsStrip");
  strip.replaceChildren();
  (state.markets ?? []).slice(0, 4).forEach((m) => {
    const el = document.createElement("div");
    el.className = "chip";
    const b = document.createElement("b");
    b.textContent = m.symbol;
    const span = document.createElement("span");
    span.textContent = arrowPct(m.change24h);
    span.className = m.change24h > 0 ? "up" : m.change24h < 0 ? "down" : "";
    el.append(b, span);
    strip.append(el);
  });
}

function renderMarkets() {
  const rows = $("marketRows");
  const list = state.markets ?? [];
  if (!list.length) {
    rows.innerHTML = "";
    return;
  }
  const frag = document.createDocumentFragment();
  const canvases = [];
  list.forEach((m, i) => {
    const tr = document.createElement("tr");
    if (i === 0) tr.className = "is-top";

    const rank = document.createElement("td");
    rank.className = "col-rank";
    rank.textContent = String(i + 1).padStart(2, "0");

    const asset = document.createElement("th");
    asset.scope = "row";
    asset.className = "sym";
    asset.textContent = m.symbol;

    const last = document.createElement("td");
    last.className = "col-num";
    last.textContent = usd(m.price);

    const d24 = document.createElement("td");
    d24.className = `col-num ${m.change24h > 0 ? "up" : m.change24h < 0 ? "down" : ""}`;
    d24.textContent = pct(m.change24h);

    const d7 = document.createElement("td");
    d7.className = `col-num ${m.change7d > 0 ? "up" : m.change7d < 0 ? "down" : ""}`;
    d7.textContent = pct(m.change7d);

    const spark = document.createElement("td");
    spark.className = "col-spark";
    const canvas = document.createElement("canvas");
    canvas.className = "spark-canvas";
    canvas.setAttribute("aria-hidden", "true");
    spark.append(canvas);

    tr.append(rank, asset, last, d24, d7, spark);
    frag.append(tr);
    canvases.push([canvas, m]);
  });
  rows.replaceChildren(frag);
  for (const [canvas, m] of canvases) {
    paint(canvas, () => drawSparkline(canvas, m.sparkline ?? [], m.change24h >= 0 ? "up" : "down"));
  }
  paintWithin(rows);
}

function renderChart() {
  const asset = state.chartAsset;
  const candles = state.candles?.[asset] ?? null;
  $("chartAsset").textContent = `${asset} / USD`;
  // 350 sessions at stage width would be sub-pixel wicks; 120 keeps marks legible.
  const chart = $("candleChart");
  paint(chart, () => drawCandles(chart, candles ? candles.slice(-70) : null));
  $("chartEmpty").hidden = Boolean(candles?.length > 1);
  document.querySelectorAll("#chartTabs button").forEach((btn) => {
    btn.setAttribute("aria-selected", String(btn.dataset.asset === asset));
  });
}

function renderForecastCards() {
  const wrap = $("forecastCards");
  const candles = state.candles?.[state.chartAsset];
  if (!candles || candles.length < 4) {
    wrap.replaceChildren();
    return;
  }
  // All three cards derive from the same series (Coinbase spot) so they cannot
  // disagree with each other. The window high/low is what makes them differ.
  const windows = [
    { label: "1D", span: 1 },
    { label: "7D", span: 7 },
    { label: "30D", span: 30 },
  ];
  const cards = windows.map(({ label, span }) => {
      const n = Math.min(span, candles.length - 1);
      const slice = candles.slice(-n - 1);
      const first = slice[0];
      const last = slice[slice.length - 1];
      const change = ((last.c - first.c) / first.c) * 100;
      const hi = Math.max(...slice.map((c) => c.h));
      const lo = Math.min(...slice.map((c) => c.l));
      const card = document.createElement("article");
      card.className = "fc";
      card.innerHTML = `
        <h3>${label}</h3>
        <span class="fc-chg ${change > 0 ? "up" : change < 0 ? "down" : ""}">${pct(change)}</span>
        <canvas class="fc-spark" aria-hidden="true"></canvas>
        <dl><dt>Hi</dt><dd>${usd(hi)}</dd><dt>Lo</dt><dd>${usd(lo)}</dd></dl>`;
      return { card, spark: card.querySelector(".fc-spark"), series: slice.map((c) => c.c), up: change >= 0 };
    });
  wrap.replaceChildren(...cards.map((c) => c.card));
  for (const { spark, series, up } of cards) {
    paint(spark, () => drawSparkline(spark, series, up ? "up" : "down"));
  }
  paintWithin(wrap);
}

function renderNetwork() {
  const chain = state.chain;
  if (chain) {
    $("blockHeight").textContent = num(chain.tipHeight);
    $("mempool").textContent = chain.mempool ? `${num(chain.mempool.count)} tx` : "—";
    $("feeFast").textContent = chain.fees ? `${chain.fees.fastest} sat/vB` : "—";
    $("feeHalf").textContent = chain.fees ? `${chain.fees.halfHour} sat/vB` : "—";
    $("feeHour").textContent = chain.fees ? `${chain.fees.hour} sat/vB` : "—";
    $("hashrate").textContent = hashrate(chain.hashrate);
    $("difficulty").textContent = chain.difficulty ? `${(chain.difficulty / 1e12).toFixed(1)} T` : "—";
    if (chain.retarget) {
      const p = Math.max(0, Math.min(100, chain.retarget.progress ?? 0));
      $("retargetBar").style.width = `${p}%`;
      const sign = chain.retarget.change >= 0 ? "+" : "";
      $("retargetMeta").textContent = `${chain.retarget.remainingBlocks} blocks · ${sign}${chain.retarget.change.toFixed(2)}%`;
    }
    const strip = $("blockStrip");
    // How many recent blocks fit is a function of the panel, not the viewport:
    // measure the track and add rows while they still fit.
    const all = (chain.chain ?? []).slice(0, 8);
    strip.replaceChildren();
    for (const b of all) {
      const li = document.createElement("li");
      const h = document.createElement("b");
      h.textContent = num(b.height);
      const tx = document.createElement("span");
      tx.textContent = `${num(b.tx_count)} tx`;
      const age = document.createElement("span");
      age.textContent = duration(Date.now() - b.timestamp * 1000);
      li.append(h, tx, age);
      strip.append(li);
      // Keep the row only if the list still fits its track.
      if (strip.scrollHeight > strip.clientHeight + 1) {
        li.remove();
        break;
      }
    }
  }
  const eth = state.eth;
  if (eth) {
    $("ethGas").textContent = gwei(eth.gasPriceWei);
    $("ethBaseFee").textContent = eth.baseFeeWei != null ? `${gwei(eth.baseFeeWei)} gwei` : "—";
    $("ethBlock").textContent = num(eth.blockNumber);
  }
  const f = state.funding;
  $("fundingBtc").textContent = f?.BTC != null ? `${(f.BTC * 100).toFixed(4)}% / 8h` : "—";
  $("fundingEth").textContent = f?.ETH != null ? `${(f.ETH * 100).toFixed(4)}% / 8h` : "—";
}

function renderGauge() {
  const gauge = $("gauge");
  paint(gauge, () => drawGauge(gauge, state.fearGreed?.value ?? NaN));
}

function renderEphemeris() {
  const fg = state.fearGreed;
  $("fgValue").textContent = fg ? String(fg.value) : "—";
  $("fgLabel").textContent = fg ? fg.label : "—";
  renderGauge();

  const g = state.global;
  const bars = $("dominanceBars");
  const entries = g
    ? [
        { label: "BTC", value: g.btcDominance, klass: "" },
        { label: "ETH", value: g.ethDominance, klass: "alt" },
        { label: "STABLE", value: g.stableDominance, klass: "alt2" },
      ]
    : [];
  bars.replaceChildren(
    ...entries.map((e) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${e.label}</span><span class="bar-track"><span class="bar-fill ${e.klass}" style="width:${Math.min(100, e.value ?? 0)}%"></span></span><b>${share(e.value)}</b>`;
      return li;
    }),
  );

  const age = moonAge();
  const phases = upcomingPhases();
  const grid = $("moonGrid");
  grid.replaceChildren(
    ...phases.map((p) => {
      const fig = document.createElement("figure");
      fig.className = "moon";
      fig.innerHTML = `<figcaption class="phase">${p.label}</figcaption><svg aria-hidden="true"><use href="#${p.icon}"/></svg><span>${shortDate(p.date)}</span>`;
      return fig;
    }),
  );
  grid.dataset.age = age.toFixed(2);
}

function renderDiscussion() {
  const markets = state.markets ?? [];
  const btcCoin = btc();
  const ethCoin = markets.find((m) => m.symbol === "ETH");
  const fg = state.fearGreed;

  const lines = [];
  if (btcCoin) {
    lines.push(`<p><b>Bitcoin</b> — ${conditionShort(btcCoin.change24h)} conditions. Last ${usd(btcCoin.price)}, ${pct(btcCoin.change24h)} over 24 hours, ${pct(btcCoin.change7d)} on the week. Range ${usd(btcCoin.low24h)} to ${usd(btcCoin.high24h)}.</p>`);
  }
  if (ethCoin) {
    lines.push(`<p><b>Ether</b> — ${conditionShort(ethCoin.change24h)}. Trading ${usd(ethCoin.price)}, ${pct(ethCoin.change24h)} in the last session. Dominance ${share(state.global?.ethDominance)}.</p>`);
  }
  if (fg) {
    lines.push(`<p><b>Sentiment</b> — Fear &amp; Greed at ${fg.value} (${fg.label}). Prior reading ${fg.previous}.</p>`);
  }
  if (state.global) {
    lines.push(`<p><b>Broad market</b> — ${usdCompact(state.global.totalMarketCap)} cap, ${pct(state.global.marketCapChange24h)} on the day.</p>`);
  }
  if (state.chain?.tipHeight) {
    lines.push(`<p><b>Chain</b> — Block ${num(state.chain.tipHeight)}, ${num(state.chain.mempool?.count)} tx in the mempool, fees ${state.chain.fees?.fastest} sat/vB.</p>`);
  }
  // Extremes across the board: the one paragraph that cannot be derived from
  // the headline rows above, so it earns its line.
  const ranked = markets.filter((m) => Number.isFinite(m.change24h) && m.marketCap > 1e8);
  if (ranked.length > 3) {
    const best = ranked.reduce((a, b) => (b.change24h > a.change24h ? b : a));
    const worst = ranked.reduce((a, b) => (b.change24h < a.change24h ? b : a));
    lines.push(`<p><b>Movers</b> — ${best.symbol} ${pct(best.change24h)} the warmest, ${worst.symbol} ${pct(worst.change24h)} the coolest across the top twelve.</p>`);
  }
  const narrative = $("narrative");
  narrative.innerHTML = lines.join("") || "<p>Acquiring signal.</p>";
  fitCopy(narrative);

  const halving = nextHalving(state.chain?.tipHeight);
  if (halving) {
    $("halvingBlocks").textContent = num(halving.blocksRemaining);
    $("halvingDate").textContent = new Date(Date.now() + halving.etaMs).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    $("subsidy").textContent = `${halving.subsidy} BTC`;
    $("issued").textContent = `${halving.issuedPct.toFixed(2)}%`;
    $("remaining").textContent = `${(100 - halving.issuedPct).toFixed(2)}%`;
  }
}

/**
 * Fit the narrative to its panel by shrinking type, never by truncating.
 * A broadcast cannot scroll and cannot clip a sentence mid-word, so the copy
 * keeps every line and gives up size instead. Bounded loop: <1 frame on any
 * realistic panel, and it stops as soon as the content fits.
 */
function fitCopy(el, { max = 1.1, min = 0.4, step = 0.03 } = {}) {
  el.style.fontSize = `${max}em`;
  el.style.lineHeight = "";
  // Bail out if the panel is hidden (0 height) — it will be fitted on reveal.
  if (el.clientHeight === 0) return;
  let size = max;
  while (el.scrollHeight > el.clientHeight && size > min) {
    size = Math.max(min, size - step);
    el.style.fontSize = `${size}em`;
  }
  // Last resort for pathological copy: tighten leading rather than clip.
  if (el.scrollHeight > el.clientHeight) {
    const lh = Number.parseFloat(getComputedStyle(el).lineHeight) / Number.parseFloat(getComputedStyle(el).fontSize);
    el.style.lineHeight = String(Math.max(1.25, lh * 0.86));
  }
}

function renderTicker() {
  const parts = [];
  if (state.markets) {
    for (const m of state.markets.slice(0, 8)) {
      parts.push(`${m.symbol} ${usd(m.price)} ${arrowPct(m.change24h)}`);
    }
  }
  if (state.fearGreed) parts.push(`F&G ${state.fearGreed.value} ${state.fearGreed.label.toUpperCase()}`);
  if (state.eth) parts.push(`GAS ${gwei(state.eth.gasPriceWei)} GWEI`);
  if (state.chain?.fees) parts.push(`BTC FEE ${state.chain.fees.fastest} SAT/VB`);
  if (state.global) parts.push(`CAP ${usdCompact(state.global.totalMarketCap)}`);
  if (state.chain?.tipHeight) parts.push(`BLOCK ${num(state.chain.tipHeight)}`);

  const text = parts.join("   ●   ");
  const el = $("tickerText");
  // Duplicate the string so the CSS -50% loop is seamless.
  el.textContent = `${text}   ●   ${text}`;
  el.style.animationDuration = `${Math.max(24, text.length * 0.42)}s`;
}

function renderClock() {
  const now = clockUTC();
  $("metaRight").textContent = now;
  const clock = $("startClock");
  if (clock) clock.textContent = now;
  const live = $("startLive");
  if (live) live.textContent = state.online ? "LIVE" : "REPLAY";
}

// ------------------------------------------------------------------ events

function wireStart() {
  const start = $("start");
  const tv = $("tv");
  const btn = $("startBtn");

  const begin = async () => {
    if (state.started) return;
    state.started = true;
    start.classList.add("is-hidden");
    tv.classList.add("is-booting");
    document.body.style.overflow = "hidden";
    try { await startAudio(); } catch { /* audio is optional */ }
    $("muteBtn").setAttribute("aria-pressed", String(isAudioOn()));
    cue("start");
    showScreen(INITIAL_SCREEN ?? "conditions");
    startRotation();
    setTimeout(() => tv.classList.remove("is-booting"), 700);
  };

  btn.addEventListener("click", begin);
  document.addEventListener("keydown", (e) => {
    if (!state.started && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      begin();
    }
  });

  // Deep link straight into a screen: ?direct#network skips the title card.
  if (INITIAL_SCREEN && new URLSearchParams(location.search).has("direct")) {
    begin();
  }
}

function wireKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLElement && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key >= "1" && e.key <= "6") {
      showScreen(SCREENS[Number(e.key) - 1]);
      return;
    }
    const idx = SCREENS.indexOf(state.screen);
    if (e.key === "ArrowRight") showScreen(SCREENS[(idx + 1) % SCREENS.length]);
    else if (e.key === "ArrowLeft") showScreen(SCREENS[(idx + SCREENS.length - 1) % SCREENS.length]);
    else if (e.key === " ") {
      e.preventDefault();
      togglePause();
    }
    else if (e.key === "m") toggleMute();
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const assets = ["BTC", "ETH", "SOL"];
      const i = assets.indexOf(state.chartAsset);
      state.chartAsset = assets[(i + (e.key === "ArrowDown" ? 1 : -1) + assets.length) % assets.length];
      renderChart();
      renderForecastCards();
    }
  });

  $("chartTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-asset]");
    if (!btn) return;
    state.chartAsset = btn.dataset.asset;
    renderChart();
    renderForecastCards();
  });

  $("muteBtn").addEventListener("click", toggleMute);
  $("pauseBtn").addEventListener("click", togglePause);

  window.addEventListener("hashchange", () => {
    const h = location.hash.slice(1);
    if (SCREENS.includes(h) && h !== state.screen) showScreen(h, { announce: false });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAudio();
    else if (state.started && isAudioOn()) startAudio();
  });
}

function toggleMute() {
  if (!state.started) return;
  const btn = $("muteBtn");
  if (isAudioOn()) {
    stopAudio();
    btn.setAttribute("aria-pressed", "false");
    $("muteIconUse").setAttribute("href", "#i-muted");
    btn.setAttribute("aria-label", "Enable audio");
  } else {
    startAudio();
    btn.setAttribute("aria-pressed", "true");
    $("muteIconUse").setAttribute("href", "#i-audio");
    btn.setAttribute("aria-label", "Mute audio");
  }
}

function togglePause() {
  state.paused = !state.paused;
  const btn = $("pauseBtn");
  btn.setAttribute("aria-pressed", String(state.paused));
  $("pauseIconUse").setAttribute("href", state.paused ? "#i-play" : "#i-pause");
  btn.setAttribute("aria-label", state.paused ? "Resume rotation" : "Pause rotation");
}

// ------------------------------------------------------------------ init

function init() {
  hydrateFromCache();
  wireStart();
  wireKeyboard();
  renderClock();
  setInterval(renderClock, 1000);
  showScreen(INITIAL_SCREEN ?? "conditions", { announce: false });

  loadAll();
  loadCandles();
  setInterval(loadAll, REFRESH_MS);
  setInterval(loadCandles, REFRESH_MS * 5);

  window.addEventListener("online", () => { state.online = true; loadAll(); });
  window.addEventListener("offline", () => { state.online = false; });

  window.addEventListener("resize", () => {
    if (state.screen === "discussion") fitCopy($("narrative"));
    if (state.screen === "chart") renderChart();
    if (state.screen === "ephemeris") renderGauge();
    if (state.screen === "markets") renderMarkets();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
