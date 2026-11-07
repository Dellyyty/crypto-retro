/**
 * Data layer. Every function is public, CORS-enabled, and needs no key.
 * Failures resolve to `null` — the broadcast degrades to "NO SIGNAL"
 * rather than inventing numbers.
 */

const TIMEOUT_MS = 12000;

/** fetch + JSON with an AbortController deadline. */
async function getJSON(url, { init, timeout = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { accept: "application/json", ...(init?.headers ?? {}) } });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return await res.json();
  } catch (err) {
    console.warn("[cryptocast] fetch failed", url, err?.message ?? err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const ENDPOINTS = {
  markets: "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=12&page=1&sparkline=true&price_change_percentage=24h,7d",
  global: "https://api.coingecko.com/api/v3/global",
  fearGreed: "https://api.alternative.me/fng/?limit=2",
  fearGreedHistory: "https://api.alternative.me/fng/?limit=0",
  candles: (asset) => `https://api.exchange.coinbase.com/products/${asset}-USD/candles?granularity=86400`,
  mempool: "https://mempool.space/api/mempool",
  fees: "https://mempool.space/api/v1/fees/recommended",
  blocks: "https://mempool.space/api/v1/blocks",
  hashrate: "https://mempool.space/api/v1/mining/hashrate/3d",
  retarget: "https://mempool.space/api/v1/difficulty-adjustment",
  ethRpc: "https://eth.drpc.org",
  hyperliquid: "https://api.hyperliquid.xyz/info",
};

const ASSETS = ["BTC", "ETH", "SOL"];

/** Top-12 markets, normalized. */
export async function fetchMarkets() {
  const raw = await getJSON(ENDPOINTS.markets);
  if (!Array.isArray(raw)) return null;
  return raw.map((c) => ({
    id: c.id,
    symbol: String(c.symbol).toUpperCase(),
    name: c.name,
    price: c.current_price,
    change24h: c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h,
    change7d: c.price_change_percentage_7d_in_currency,
    marketCap: c.market_cap,
    volume: c.total_volume,
    high24h: c.high_24h,
    low24h: c.low_24h,
    ath: c.ath,
    athChange: c.ath_change_percentage,
    sparkline: c.sparkline_in_7d?.price ?? null,
  }));
}

/** Global aggregate metrics, normalized. */
export async function fetchGlobal() {
  const raw = await getJSON(ENDPOINTS.global);
  const d = raw?.data;
  if (!d) return null;
  return {
    totalMarketCap: d.total_market_cap?.usd,
    totalVolume: d.total_volume?.usd,
    marketCapChange24h: d.market_cap_change_percentage_24h_usd,
    btcDominance: d.market_cap_percentage?.btc,
    ethDominance: d.market_cap_percentage?.eth,
    stableDominance: ["usdt", "usdc", "dai"].reduce((sum, k) => sum + (d.market_cap_percentage?.[k] ?? 0), 0),
    activeAssets: d.active_cryptocurrencies,
  };
}

export async function fetchFearGreed() {
  const raw = await getJSON(ENDPOINTS.fearGreed);
  const row = raw?.data?.[0];
  if (!row) return null;
  return {
    value: Number(row.value),
    label: row.value_classification,
    previous: Number(raw.data[1]?.value),
  };
}

export async function fetchFearGreedHistory() {
  const raw = await getJSON(ENDPOINTS.fearGreedHistory);
  const rows = raw?.data;
  if (!Array.isArray(rows)) return null;
  return rows
    .map((r) => ({ value: Number(r.value), ts: Number(r.timestamp) * 1000 }))
    .filter((r) => Number.isFinite(r.value))
    .sort((a, b) => a.ts - b.ts);
}

/** Daily candles, oldest first: {t, o, h, l, c, v}. */
export async function fetchCandles(asset) {
  const raw = await getJSON(ENDPOINTS.candles(asset));
  if (!Array.isArray(raw)) return null;
  return raw
    .map(([t, l, h, o, c, v]) => ({ t: t * 1000, o, h, l, c, v }))
    .sort((a, b) => a.t - b.t);
}

export async function fetchCandlesAll() {
  const pairs = await Promise.all(ASSETS.map(async (asset) => [asset, await fetchCandles(asset)]));
  return Object.fromEntries(pairs);
}

export async function fetchChain() {
  const [mempool, fees, blocks, hashrate, retarget] = await Promise.all([
    getJSON(ENDPOINTS.mempool),
    getJSON(ENDPOINTS.fees),
    getJSON(ENDPOINTS.blocks),
    getJSON(ENDPOINTS.hashrate),
    getJSON(ENDPOINTS.retarget),
  ]);
  if (!mempool && !fees && !blocks) return null;
  return {
    tipHeight: Array.isArray(blocks) ? blocks[0]?.height : null,
    chain: Array.isArray(blocks) ? blocks : [],
    mempool: mempool
      ? { count: mempool.count, vsize: mempool.vsize, totalFee: mempool.total_fee }
      : null,
    fees: fees
      ? { fastest: fees.fastestFee, halfHour: fees.halfHourFee, hour: fees.hourFee, economy: fees.economyFee }
      : null,
    hashrate: hashrate?.currentHashrate ?? null,
    difficulty: hashrate?.currentDifficulty ?? null,
    retarget: retarget
      ? {
          progress: retarget.progressPercent,
          change: retarget.difficultyChange,
          remainingBlocks: retarget.remainingBlocks,
          estimatedMs: retarget.remainingTime,
        }
      : null,
  };
}

/** Batched JSON-RPC against a keyless public endpoint. */
export async function fetchEth() {
  const body = [
    { jsonrpc: "2.0", id: 1, method: "eth_gasPrice", params: [] },
    { jsonrpc: "2.0", id: 2, method: "eth_blockNumber", params: [] },
    { jsonrpc: "2.0", id: 3, method: "eth_getBlockByNumber", params: ["latest", false] },
  ];
  const raw = await getJSON(ENDPOINTS.ethRpc, {
    init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  });
  if (!Array.isArray(raw)) return null;
  const byId = new Map(raw.map((r) => [r.id, r.result]));
  const gasPrice = byId.get(1);
  const blockNumber = byId.get(2);
  const block = byId.get(3);
  if (!gasPrice) return null;
  return {
    gasPriceWei: Number.parseInt(gasPrice, 16),
    baseFeeWei: block?.baseFeePerGas ? Number.parseInt(block.baseFeePerGas, 16) : null,
    blockNumber: blockNumber ? Number.parseInt(blockNumber, 16) : null,
    gasUsedRatio: block ? Number.parseInt(block.gasUsed, 16) / Number.parseInt(block.gasLimit, 16) : null,
  };
}

/** Perpetual funding from Hyperliquid: {BTC: rate, ETH: rate}. */
export async function fetchFunding() {
  const raw = await getJSON(ENDPOINTS.hyperliquid, {
    init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "metaAndAssetCtxs" }) },
  });
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const [meta, ctxs] = raw;
  const out = {};
  for (const asset of ["BTC", "ETH"]) {
    const i = meta.universe.findIndex((u) => u.name === asset);
    if (i >= 0) out[asset] = Number(ctxs[i]?.funding);
  }
  return Object.keys(out).length ? out : null;
}

// ---------------------------------------------------------------- cache

const CACHE_KEY = "cryptocast.cache.v1";

/** Read the last good snapshot (used for first paint before network settles). */
export function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCache(snapshot) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...snapshot, savedAt: Date.now() }));
  } catch {
    /* storage may be unavailable in private mode; not fatal */
  }
}
