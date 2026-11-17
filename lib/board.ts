// The board itself: which protocols are ranked, in what order, and the data file the dashboard
// renders. The watchlist is the floor — every slug it names is ranked, even one the early
// radar's hygiene rules would pass over — and the early radar adds every other pre-token
// protocol those rules let through, so the board is the whole pre-token field the snapshot
// supports, not a top slice of it. Rows are ordered by implied value; ties fall to TVL, then
// to the slug, so two runs of the program write the same bytes.

import { farmPlan } from './farm.ts';
import {
  CONSTANTS,
  LIVE_VIEW_ROWS,
  MODEL_VERSION,
  PEER_MIN_TVL_USD,
  PEER_RATIO_CAP,
  isEarlyCandidate,
  measureMultiples,
  momentumSignal,
  recordSignal,
  recordsNoToken,
  valueProtocol,
  type CategoryMultiple,
  type Constants,
  type Protocol,
  type Snapshot,
  type Valuation,
} from './model.ts';

/** One row of /output/board.json: the ranked claim, its evidence and its farm plan. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  token_status: 'records no token';
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    momentum_factor: number;
    maturity_factor: number;
    breadth_factor: number;
  };
  farm_steps: string[];
}

/** One row of the dashboard's data: everything the page shows, farm plan included. */
export interface DashRow extends BoardRow {
  momentum_signal: string;
  record_signal: string;
}

/** A protocol whose token already trades: shown apart, at the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  mcap_to_tvl: number;
  change_7d: number | null;
  symbol: string | null;
}

/** Everything data.js carries: the board, the calibration set, the model and its multiples. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  constants: Constants;
  peer_min_tvl_usd: number;
  peer_ratio_cap: number;
  market_multiple: number;
  multiples: CategoryMultiple[];
  counts: {
    protocols: number;
    pre_token: number;
    board: number;
    watchlist: number;
    early: number;
    live: number;
    implied_total_usd: number;
  };
  rows: DashRow[];
  live: LiveRow[];
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/** The ranked board: watchlist first by right, then the early radar, all ordered by value. */
export function buildBoard(snapshot: Snapshot, constants: Constants = CONSTANTS): BoardRow[] {
  const { byCategory } = measureMultiples(snapshot, constants);
  const chosen = new Map<string, Protocol>();
  for (const slug of snapshot.watchlist) {
    const p = snapshot.protocols.find((q) => q.slug === slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isEarlyCandidate(p)) chosen.set(p.slug, p);
  }
  const watchlist = new Set(snapshot.watchlist);
  const scored: Array<{ p: Protocol; v: Valuation }> = [];
  for (const p of chosen.values()) scored.push({ p, v: valueProtocol(p, snapshot.as_of, byCategory, constants) });
  scored.sort(
    (a, b) =>
      b.v.implied_value_usd - a.v.implied_value_usd ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map(({ p, v }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: v.age_days,
    on_watchlist: watchlist.has(p.slug),
    token_status: 'records no token',
    implied_value_usd: v.implied_value_usd,
    model: {
      peer_multiple: round4(v.peer_multiple),
      peer_count: v.peer_count,
      momentum_factor: round4(v.momentum_factor),
      maturity_factor: round4(v.maturity_factor),
      breadth_factor: round4(v.breadth_factor),
    },
    farm_steps: farmPlan(p, snapshot.as_of),
  }));
}

/** The calibration set: the largest already-trading protocols, at the market's own values. */
export function buildLive(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_VIEW_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      mcap_to_tvl: p.tvl_usd > 0 ? round4(p.mcap_usd! / p.tvl_usd) : 0,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

/** The board and the dashboard's data, from one snapshot. */
export function buildRadar(snapshot: Snapshot, constants: Constants = CONSTANTS): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, constants);
  const live = buildLive(snapshot);
  const { market, byCategory } = measureMultiples(snapshot, constants);
  const multiples = [...byCategory.values()].sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    constants,
    peer_min_tvl_usd: PEER_MIN_TVL_USD,
    peer_ratio_cap: PEER_RATIO_CAP,
    market_multiple: round4(market),
    multiples: multiples.map((m) => ({ ...m, peer_median: m.peer_median === null ? null : round4(m.peer_median), multiple: round4(m.multiple) })),
    counts: {
      protocols: snapshot.protocols.length,
      pre_token: snapshot.protocols.filter(recordsNoToken).length,
      board: board.length,
      watchlist: snapshot.watchlist.length,
      early: board.filter((r) => !r.on_watchlist).length,
      live: live.length,
      implied_total_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    },
    rows: board.map((r) => ({ ...r, momentum_signal: momentumSignal(r.change_7d), record_signal: recordSignal(r.age_days) })),
    live,
  };
  return { board, radar };
}

/**
 * Why a board is not one the gate takes, or null. Mirrors the gate's rows that a program can
 * check itself: coverage, ranks 1..N, value never rising with rank, no single shared value,
 * farm-step shape, and the board's size.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const seen = new Set<string>();
  for (const r of board) {
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `row ${i} carries rank ${board[i]!.rank}`;
    if (i > 0 && board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} carries implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} carries ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${r.slug} carries a farm step of ${len} characters`;
    }
  }
  return null;
}

/** data.js: the dashboard's whole dataset as one script — no fetch, no network, deterministic. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
