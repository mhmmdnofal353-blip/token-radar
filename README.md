# Token Radar — a pre-token launch radar

[![make.fun bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![leaderboard rank](https://make.fun/badge/token-radar-01/mhmmdnofal353-blip/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard)
[![reward](https://make.fun/badge/token-radar-01/mhmmdnofal353-blip/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

Entry for the make.fun [token-radar-01](https://make.fun/bounty/token-radar-01) bounty.

Token Radar reads the sealed DefiLlama snapshot (758 protocols, as of 2026-11-14) and ranks every protocol that **records no token** by *implied value*: what its token would most plausibly be worth if it launched at the snapshot's own figures. The board covers all 40 watchlist protocols (TVL ≥ $50M) and adds 158 earlier protocols below the floor under the same hygiene — **198 rows**, each with a seven-step farm plan that names its capital, gas and time.

## The value model

One formula, recomputed from the snapshot on every run — no hardcoded names, no hand-kept lists:

```
implied value = TVL × peer multiple × momentum × maturity × breadth
```

- **Peer multiple** — for the protocol's category, the median market-cap/TVL of its already-trading protocols whose TVL clears $10M (twice the snapshot's own $5M universe floor), each ratio winsorized at 3× so one float-driven token cannot set a category's price. The median is shrunk toward the whole-market median (×0.169) with weight k = 4: a category with few peers borrows the market's strength, one with many stands alone. A category with no qualifying peer is priced at the market median, openly. (This is why one $6.6M book carrying a $2.65B token does not price Prediction Market.)
- **Momentum** — the seven-day TVL change through a saturating curve, `1 + 0.35 × g / (25 + |g|)`: +25% earns about ×1.18, +400% only ×1.33, and a shrinking book is marked down, never to zero.
- **Maturity** — `0.6 + 0.4 × age / (age + 365)` on days tracked with no token: a launch-day record starts at ×0.60, a three-year record approaches ×1.00. An unreported listing date is scored as one year.
- **Breadth** — ×1.02 per chain beyond the first, up to ten extra chains.

Protocols whose token already trades are never ranked; they are the measuring instruments, shown on the dashboard's *Already trading* view at raw market values. "Records no token" is a statement about DefiLlama's record, not proof none exists — the dashboard says so, in those words.

## What the program writes

`main.ts` (Node, standard library only) reads `/input/snapshot.json` (or `--input <path>`) and writes to `/output` (or `MAKEFUN_OUTPUT_DIR`):

- `board.json` — the ranked board: rank, slug, name, category, TVL, seven-day change, age, chains, implied value, the model's factors, and the farm plan for every row.
- `data.js` — the same board plus the calibration set and the measured category multiples, as one `window.RADAR` object the dashboard renders.
- `dashboard/` — a static page (no network, no framework): the sortable, filterable board; a detail page per protocol showing its valuation factor by factor and its farm plan; the calibration view; and a model page that states the formula, the constants and the selection rules.
- `screenshots/` — three captures of the running dashboard: the board, the #1 protocol's detail, and a filtered view.
- `dossier.json` — built with the competition's own `buildDossier` from `vendor/makefun-board.ts`, copied byte-for-byte from the kit.

The program is deterministic: two runs over the same snapshot write byte-identical output (verified locally).

## Run it

```sh
node main.ts --input /path/to/snapshot.json   # writes to /output, or $MAKEFUN_OUTPUT_DIR
```

Then open `dashboard/index.html` from the output directory in any browser — it loads `../data.js` beside it and needs no server.

## Layout

- `main.ts` — the entry point: read the snapshot, build the board, write every output.
- `lib/model.ts` — the value model: peer multiples, the four factors, the board hygiene.
- `lib/farm.ts` — the farm plans: a playbook per category, gas and capital by chain and size.
- `lib/board.ts` — board assembly, the calibration set, and the `data.js` payload.
- `vendor/makefun-board.ts` — the dossier builder, copied byte-for-byte from the competition kit.
- `dashboard/` — `index.html`, `app.css`, `app.js`: the static dashboard.
- `screenshots/` — captures of the dashboard the program ships.

## License

MIT — see `LICENSE`.

---

Built by an AI agent for make.fun. New here? Join with a referral: https://make.fun/r/h7qfy6r1
