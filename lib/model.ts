// Token Radar's model: one sealed snapshot in, one ranked board of pre-token protocols out.
//
// The question the board answers: if this protocol issued a token today, what would the market
// most plausibly pay for it, judged only by the snapshot's own figures? The answer is built the
// way an analyst builds it, from comparable companies:
//
//   implied = TVL x peer multiple x momentum x maturity x breadth
//
// - peer multiple: protocols in the same DefiLlama category whose token already trades give a
//   market cap / TVL ratio each; the category's multiple starts from their median, but the
//   median counts only with its credibility Z = peers / (peers + k): the multiple is the
//   geometric blend market^(1-Z) x median^Z. One peer — in this snapshot a single $12M book
//   whose token happens to trade rich — moves its category barely a seventh of the way from
//   the market median to its own figure, while a category with thirty peers stands nearly on
//   its own. The blend is geometric because a multiple is a ratio: evidence about ratios
//   multiplies, it does not add. No multiple is typed in by hand: every one is measured from
//   the snapshot's live-token protocols at run time, so the same program re-prices the board
//   the day the snapshot changes.
// - momentum: the seven-day TVL change, passed through a saturating curve (g / (25 + |g|)) so a
//   +4,000% print on a small base cannot outvote a year of TVL, then weighted at 0.35.
// - maturity: a hyperbolic credit for days tracked with no token, age / (age + 365), worth
//   0.60 at birth and rising toward 1.00; an unreported listing date is scored as one year.
// - breadth: 2% per extra chain the protocol's TVL sits on, capped at ten extra chains.
//
// The board ranks every protocol the snapshot's watchlist names (the floor) and every other
// pre-token protocol the hygiene rules below let through (the early radar). Protocols whose
// token already trades are never ranked: they are the measuring instruments, and the dashboard
// shows them apart, at the market's own values.

/** One protocol of the snapshot: exactly the ten fields the sealed input carries. */
export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** The model's constants, printed on the dashboard's model page so a reader can re-derive a row. */
export interface Constants {
  shrink_k: number;
  momentum_weight: number;
  momentum_scale: number;
  maturity_base: number;
  maturity_span: number;
  maturity_mid_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra: number;
}

export const CONSTANTS: Constants = {
  shrink_k: 6,
  momentum_weight: 0.35,
  momentum_scale: 25,
  maturity_base: 0.6,
  maturity_span: 0.4,
  maturity_mid_days: 365,
  unknown_age_days: 365,
  breadth_per_chain: 0.02,
  breadth_max_extra: 10,
};

/** The model's version, named wherever its values are quoted. */
export const MODEL_VERSION = 'radar-3 (credibility-weighted peer multiples)';

/** How many already-trading protocols the dashboard's calibration view carries. */
export const LIVE_VIEW_ROWS = 36;

/** Why a snapshot cannot be scored. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// ---------------------------------------------------------------- the snapshot

/** The snapshot out of a file's text, refused unless it carries the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not an object');
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof doc.source !== 'string' || doc.source.length === 0) throw new SnapshotError('snapshot.json has no source');
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no whole-dollar floor_usd');
  }
  if (!Array.isArray(doc.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slug strings');
  }
  const protocols = doc.protocols.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = entry as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string') throw new SnapshotError(`protocol ${i} lacks a slug or a name`);
    if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) throw new SnapshotError(`protocol ${i} lacks a TVL`);
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return { as_of: doc.as_of, source: doc.source, floor_usd: doc.floor_usd, protocols, watchlist: doc.watchlist as string[] };
}

// ---------------------------------------------------------------- reading a protocol

/** Whether the record carries no token: no market cap, no CoinGecko id, no ticker. */
export function recordsNoToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version marker: a name that ends in a release is another protocol's pool, not a launch of its own. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word that marks a wrapped or staked product of an asset that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name that begins with an exchange's: the exchange's own product, not an independent launch. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * The categories the snapshot's own watchlist definition sets aside as wrapped, staked or
 * bridged products of a token that already trades — bridges and canonical bridges carry other
 * protocols' assets, and a staking product's receipt is itself a trading token — plus the
 * exchanges. The radar applies the same hygiene below the floor as the watchlist applies
 * above it: the floor is a size line, not a second definition of a launch.
 */
const SET_ASIDE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Whether the early radar may rank a protocol: it records no token, its category is not one
 * the snapshot's own definition sets aside, and its name does not mark it as an exchange
 * product, a versioned pool or a wrapped/staked product. The watchlist is exempt by
 * construction: the gate requires every one of its slugs on the board, and the definition
 * that built the list already applied this hygiene to it.
 */
export function isEarlyCandidate(p: Protocol): boolean {
  return (
    recordsNoToken(p) &&
    !SET_ASIDE_CATEGORIES.has(p.category ?? '') &&
    !EXCHANGE_PREFIX.test(p.name) &&
    !VERSIONED_NAME.test(p.name) &&
    !WRAPPED_WORD.test(p.name)
  );
}

const DAY_MS = 86_400_000;

/** Whole days from the day DefiLlama began tracking a protocol to the snapshot's day; null when unreported. */
export function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

// ---------------------------------------------------------------- peer multiples

/** One category's measured multiple: how it was derived, so the dashboard can show its working. */
export interface CategoryMultiple {
  category: string;
  peers: number;
  peer_median: number | null;
  /** How far the category's own median counts against the market's: peers / (peers + shrink_k). */
  credibility: number;
  multiple: number;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * A peer's book must clear twice the snapshot's own $5M universe floor before its ratio
 * prices anyone else's launch: below that, a token's price is mostly float and noise, and
 * one $6.6M book carrying a $2.6B token would otherwise set a whole category's yardstick.
 */
export const PEER_MIN_TVL_USD = 10_000_000;

/**
 * No peer ratio counts past this: a token priced beyond three times its own protocol's book
 * is being priced on something other than the book — a float squeeze, a meme, a treasury the
 * snapshot does not carry — and none of that is evidence about what a new token's book buys.
 */
export const PEER_RATIO_CAP = 3;

/**
 * The market's own yardsticks, measured from the snapshot: for every category, the median
 * market-cap/TVL of its already-trading protocols with a real book (TVL at or above
 * PEER_MIN_TVL_USD), each ratio winsorised at PEER_RATIO_CAP. The median is then blended
 * with the whole-market median by credibility: with n peers the category's own figure
 * carries weight Z = n / (n + shrink_k) and the market's carries 1 - Z, combined
 * geometrically — multiple = market^(1-Z) x median^Z — so a category needs shrink_k peers
 * before its own median counts for even half, and a lone peer, however rich its token
 * trades, can lift its category only a little way off the market's price. Categories with
 * no trading peer take the market median itself.
 */
export function measureMultiples(snapshot: Snapshot, constants: Constants = CONSTANTS): { market: number; byCategory: Map<string, CategoryMultiple> } {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (recordsNoToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd < PEER_MIN_TVL_USD) continue;
    const ratio = Math.min(p.mcap_usd / p.tvl_usd, PEER_RATIO_CAP);
    all.push(ratio);
    const key = p.category ?? '(none named)';
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const market = all.length > 0 ? median(all) : 0.2;
  const byCategory = new Map<string, CategoryMultiple>();
  const categories = new Set<string>();
  for (const p of snapshot.protocols) categories.add(p.category ?? '(none named)');
  for (const category of categories) {
    const ratios = ratiosByCategory.get(category) ?? [];
    if (ratios.length === 0) {
      byCategory.set(category, { category, peers: 0, peer_median: null, credibility: 0, multiple: market });
    } else {
      const med = median(ratios);
      const credibility = ratios.length / (ratios.length + constants.shrink_k);
      const multiple =
        med > 0 && market > 0 ? Math.exp((1 - credibility) * Math.log(market) + credibility * Math.log(med)) : market;
      byCategory.set(category, { category, peers: ratios.length, peer_median: med, credibility, multiple });
    }
  }
  return { market, byCategory };
}

// ---------------------------------------------------------------- scoring

/** One protocol's valuation, factor by factor, so any row can be re-derived by hand. */
export interface Valuation {
  implied_value_usd: number;
  peer_multiple: number;
  peer_count: number;
  momentum_pct: number;
  momentum_factor: number;
  maturity_factor: number;
  age_days: number | null;
  breadth_factor: number;
}

/** Value one pre-token protocol from the snapshot's figures and the measured multiples. */
export function valueProtocol(p: Protocol, asOf: string, multiples: Map<string, CategoryMultiple>, constants: Constants = CONSTANTS): Valuation {
  const entry = multiples.get(p.category ?? '(none named)');
  const peerMultiple = entry === undefined ? 0.2 : entry.multiple;
  const peerCount = entry === undefined ? 0 : entry.peers;
  const growth = p.change_7d ?? 0;
  const momentumFactor = 1 + constants.momentum_weight * (growth / (constants.momentum_scale + Math.abs(growth)));
  const age = ageInDays(asOf, p.listed_at);
  const ageForCredit = age ?? constants.unknown_age_days;
  const maturityFactor = constants.maturity_base + constants.maturity_span * (ageForCredit / (ageForCredit + constants.maturity_mid_days));
  const extraChains = Math.min(Math.max(p.chains.length - 1, 0), constants.breadth_max_extra);
  const breadthFactor = 1 + constants.breadth_per_chain * extraChains;
  const implied = Math.max(1, Math.round(p.tvl_usd * peerMultiple * momentumFactor * maturityFactor * breadthFactor));
  return {
    implied_value_usd: implied,
    peer_multiple: peerMultiple,
    peer_count: peerCount,
    momentum_pct: growth,
    momentum_factor: momentumFactor,
    maturity_factor: maturityFactor,
    age_days: age,
    breadth_factor: breadthFactor,
  };
}

/** A short reading of a row's seven-day direction, for the board's signal column. */
export function momentumSignal(change7d: number | null): string {
  if (change7d === null) return 'Unreported';
  if (change7d >= 10) return 'Surging';
  if (change7d >= 2) return 'Climbing';
  if (change7d > -2) return 'Steady';
  if (change7d > -10) return 'Cooling';
  return 'Falling';
}

/** A short reading of a row's track record, for the board's signal column. */
export function recordSignal(ageDays: number | null): string {
  if (ageDays === null) return 'Undated';
  if (ageDays >= 730) return 'Established';
  if (ageDays >= 365) return 'Proven';
  if (ageDays >= 90) return 'Young';
  return 'New';
}
