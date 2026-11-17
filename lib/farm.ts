// Farm plans: what a reader actually does about a row, in order, with what it costs and how
// long it takes. A plan is assembled from the protocol's own record — its category picks the
// playbook, its first chain prices the gas, its TVL sizes the position, its age sets the hold —
// so two protocols share a plan's shape only when their records genuinely rhyme. Every step is
// one string of the board's farm_steps: the action, then its cost, then its time, and the
// builder below keeps each inside the gate's 20 to 600 characters.

import { ageInDays, type Protocol } from './model.ts';

/** Gas for one ordinary transaction on a chain, in dollars, as a working estimate for a plan. */
const GAS_BY_CHAIN: Record<string, number> = {
  Ethereum: 12,
  Bitcoin: 3,
  Solana: 0.1,
  Binance: 0.3,
  Base: 0.4,
  'Hyperliquid L1': 0.1,
  Arbitrum: 0.5,
  Sui: 0.1,
  Tron: 1,
  Avalanche: 0.6,
  Polygon: 0.3,
  Monad: 0.2,
  Near: 0.1,
  TON: 0.2,
};

/** The chain a plan is priced on: the first the record names, else Ethereum as the dear default. */
function mainChain(p: Protocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
}

/** One transaction's gas on the protocol's main chain, formatted for a cost line. */
function gasText(p: Protocol): string {
  const gas = GAS_BY_CHAIN[mainChain(p)] ?? 1;
  return gas < 1 ? `about $${gas.toFixed(2)}` : `about $${Math.round(gas)}`;
}

/** The position a plan works with, sized to the protocol's scale: deep pools absorb more. */
function capitalFor(p: Protocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 75;
  return 50;
}

/** How long a position must be held to read as a farmer's, not a snapshot tourist's. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 75;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The two moves of a category's playbook: the core position, then the second leg that deepens it. */
interface Playbook {
  open: (name: string, chain: string, capital: number) => string;
  deepen: (name: string, chain: string, capital: number) => string;
}

const PLAYBOOKS: Record<string, Playbook> = {
  Lending: {
    open: (n, c, k) => `Supply $${k} of USDC to ${n} on ${c} and leave the deposit receipt in the wallet.`,
    deepen: (n, c, k) => `Borrow no more than $${Math.round(k * 0.3)} against the supply, hold it in stablecoins, and repay it once a month so the account shows both sides of the market.`,
  },
  CDP: {
    open: (n, c, k) => `Open a vault on ${n} with $${k} of ETH collateral at no less than 200% collateralisation and mint its stablecoin.`,
    deepen: (n, c, k) => `Park the minted stablecoin in ${n}'s own stability pool or a paired lending market, and top the vault up whenever the ratio drifts under 220%.`,
  },
  'CDP Manager': {
    open: (n, c, k) => `Open a managed vault position of $${k} through ${n} on ${c}, choosing the conservative collateral setting.`,
    deepen: (n, c, k) => `Review the position weekly and let the manager's rebalancing run; add $${Math.round(k * 0.25)} after the first month if the vault held its peg.`,
  },
  Dexs: {
    open: (n, c, k) => `Provide $${k} of liquidity to ${n}'s deepest stable or ETH pool on ${c}, split evenly across both sides.`,
    deepen: (n, c, k) => `Stake the LP receipt in ${n}'s gauge or farm tab if it offers one, and re-centre the position when fees earned pass $${Math.max(5, Math.round(k * 0.05))}.`,
  },
  Yield: {
    open: (n, c, k) => `Deposit $${k} of USDC into ${n}'s flagship yield vault on ${c} and keep the vault shares.`,
    deepen: (n, c, k) => `Move a quarter of the position into a second ${n} vault with a different strategy, so the wallet is not riding on one pool.`,
  },
  'Yield Aggregator': {
    open: (n, c, k) => `Deposit $${k} into the highest-TVL vault ${n} runs on ${c} and keep the auto-compounding on.`,
    deepen: (n, c, k) => `Once a month, compare the vault's realised yield with its page and shift $${Math.round(k * 0.25)} to the better vault if the gap persists.`,
  },
  'Liquidity Manager': {
    open: (n, c, k) => `Place $${k} in a managed liquidity position through ${n} on ${c}, in its widest-range strategy.`,
    deepen: (n, c, k) => `Check the position weekly; if it sits out of range for two checks in a row, withdraw and re-place it rather than letting it idle.`,
  },
  Farm: {
    open: (n, c, k) => `Deposit $${k} into ${n}'s main farm pool on ${c} and stake the receipt where its farm page directs.`,
    deepen: (n, c, k) => `Compound the harvested rewards back into the pool once a week instead of selling them, so the position grows on its own record.`,
  },
  'Liquid Staking': {
    open: (n, c, k) => `Stake $${k} of the chain's native asset through ${n} and keep the liquid staking token it returns.`,
    deepen: (n, c, k) => `Put half the staking token to work as collateral in a lending market ${n} links to, at a conservative loan-to-value.`,
  },
  'Staking Pool': {
    open: (n, c, k) => `Stake $${k} of the native asset in ${n}'s pool on ${c} and keep the pool receipt.`,
    deepen: (n, c, k) => `Claim and restake the rewards weekly; a compounding pool position is the clearest long-term signal a staking protocol keeps.`,
  },
  Restaking: {
    open: (n, c, k) => `Restake $${k} of ETH or its liquid staking token through ${n} and register the wallet on its points page.`,
    deepen: (n, c, k) => `Keep the restaked position untouched through a full points season and add a second operator or service only if ${n} opens one.`,
  },
  'Liquid Restaking': {
    open: (n, c, k) => `Deposit $${k} of a liquid staking token into ${n} and hold the restaking token it issues.`,
    deepen: (n, c, k) => `Use a slice of the restaking token in a paired liquidity pool, keeping at least half idle so an exit is never blocked.`,
  },
  'Restaked BTC': {
    open: (n, c, k) => `Deposit $${k} of BTC or a BTC liquid staking token into ${n} and keep its restaked receipt.`,
    deepen: (n, c, k) => `Bridge a small part of the position to one chain ${n} supports and use it there, so the wallet shows cross-chain activity.`,
  },
  'Anchor BTC': {
    open: (n, c, k) => `Deposit $${k} of BTC through ${n} on ${c} and keep the anchored BTC token it returns.`,
    deepen: (n, c, k) => `Supply half the anchored token to a lending market that accepts it, keeping the loan-to-value under 30%.`,
  },
  'Decentralized BTC': {
    open: (n, c, k) => `Mint or deposit $${k} of BTC-backed assets through ${n} on ${c} and hold the token it issues.`,
    deepen: (n, c, k) => `Provide liquidity for the BTC token's main pair with $${Math.round(k * 0.5)}, so the wallet earns fees as well as holding.`,
  },
  Bridge: {
    open: (n, c, k) => `Bridge $${k} of USDC through ${n} to ${c} and use the bridged funds in one app on the far side.`,
    deepen: (n, c, k) => `Bridge a smaller amount back once, then repeat the round trip monthly: bridges count completed journeys, not one-way deposits.`,
  },
  'Canonical Bridge': {
    open: (n, c, k) => `Bridge $${k} of ETH or USDC to ${c} through ${n}, the chain's own bridge, and keep the funds on the far side.`,
    deepen: (n, c, k) => `Put the bridged funds to work in the chain's flagship lending market or DEX, so the wallet is active on the new chain, not just present.`,
  },
  'Cross Chain Bridge': {
    open: (n, c, k) => `Route $${k} of USDC across two chains through ${n}, ending on ${c}, and keep the arrival transaction.`,
    deepen: (n, c, k) => `Make one cross-chain swap a week through ${n}'s routes, varying the destination chain across the month.`,
  },
  Derivatives: {
    open: (n, c, k) => `Deposit $${k} of USDC as margin on ${n} and open one small position hedged against a spot holding of the same size.`,
    deepen: (n, c, k) => `Provide $${Math.round(k * 0.5)} to ${n}'s counterparty vault if it runs one, so the wallet earns from the house side as well as trading.`,
  },
  Options: {
    open: (n, c, k) => `Buy one small, far-dated option on ${n} with no more than $${Math.round(k * 0.2)} of premium, on an asset you already hold.`,
    deepen: (n, c, k) => `Write one covered option a month through ${n} against the same holding, keeping the strike well above the market.`,
  },
  'Options Vault': {
    open: (n, c, k) => `Deposit $${k} into ${n}'s flagship options vault on ${c} and keep the vault shares through a full weekly cycle.`,
    deepen: (n, c, k) => `Stay through at least four weekly settlements; options vaults reward completed cycles, and early exits forfeit the week's premium.`,
  },
  'Interest Rate Derivatives': {
    open: (n, c, k) => `Open a $${k} fixed-rate position through ${n} on ${c}, fixing the rate on funds you already lend elsewhere.`,
    deepen: (n, c, k) => `Add a second position at a different maturity, so the wallet shows a ladder rather than a single bet.`,
  },
  Synthetics: {
    open: (n, c, k) => `Stake or deposit $${k} of collateral on ${n} and mint a small amount of its synthetic asset.`,
    deepen: (n, c, k) => `Trade the synthetic once a week in small size and keep the debt ratio inside the band ${n} publishes.`,
  },
  RWA: {
    open: (n, c, k) => `Subscribe $${k} to ${n}'s flagship real-world-asset product on ${c}, completing whatever onboarding its page asks for.`,
    deepen: (n, c, k) => `Hold through one full distribution or interest cycle and reinvest the payout, so the record shows a completed round trip of income.`,
  },
  'Risk Curators': {
    open: (n, c, k) => `Deposit $${k} of USDC into a vault on ${n} curated by a named risk curator, on ${c}.`,
    deepen: (n, c, k) => `Split a second $${Math.round(k * 0.5)} across a vault from a different curator on ${n}, so no single curator's calls decide the whole position.`,
  },
  'Onchain Capital Allocator': {
    open: (n, c, k) => `Deposit $${k} into ${n}'s main allocation vault on ${c} and keep the shares.`,
    deepen: (n, c, k) => `Follow the allocator's rebalancing for a month before adding more; its record, not its marketing, is what the position is buying.`,
  },
  'Collateral Management': {
    open: (n, c, k) => `Deposit $${k} of collateral into ${n} on ${c} and open the smallest position its manager allows.`,
    deepen: (n, c, k) => `Keep the health factor above the level ${n} flags as safe and add collateral early whenever it drifts toward it.`,
  },
  'Collateral Markets': {
    open: (n, c, k) => `Supply $${k} of collateral to a market on ${n} and borrow a quarter of it in stablecoins.`,
    deepen: (n, c, k) => `Rotate the supplied collateral once a month between two markets on ${n}, keeping total borrowings under a third throughout.`,
  },
  'Basis Trading': {
    open: (n, c, k) => `Deposit $${k} of USDC into ${n}'s basis-trading vault on ${c} and keep the shares.`,
    deepen: (n, c, k) => `Hold through at least two funding-rate cycles; basis vaults pay over cycles, and a position closed mid-cycle keeps almost none of it.`,
  },
  Chain: {
    open: (n, c, k) => `Bridge $${k} of funds onto ${c} and make it the wallet's home chain for a month: swaps, lending and one NFT mint.`,
    deepen: (n, c, k) => `Use two of ${n}'s flagship apps weekly — new chains reward wallets that behave like residents, not tourists.`,
  },
  Launchpad: {
    open: (n, c, k) => `Take a small ticket, no more than $${Math.round(k * 0.4)}, in one sale on ${n} and complete its participation steps.`,
    deepen: (n, c, k) => `Stake or hold whatever ${n} asks launch participants to hold, in the smallest qualifying tier, between sales.`,
  },
  Privacy: {
    open: (n, c, k) => `Make one shielded deposit of $${k} into ${n} on ${c} and store the note or key it gives you offline.`,
    deepen: (n, c, k) => `Make one private transfer a month and keep each deposit's note backed up: a lost note is a lost balance.`,
  },
  Indexes: {
    open: (n, c, k) => `Buy $${k} of ${n}'s flagship index token on ${c} and hold it rather than its components.`,
    deepen: (n, c, k) => `Add $${Math.round(k * 0.2)} after each quarterly rebalance, so the wallet's history spans more than one index composition.`,
  },
  Payments: {
    open: (n, c, k) => `Open an account with ${n}, fund it with $${k}, and route two real payments a week through it.`,
    deepen: (n, c, k) => `Keep a working balance in the account between payments; services read dormant funded accounts as abandoned, not loyal.`,
  },
  'Crypto Card Issuer': {
    open: (n, c, k) => `Order ${n}'s card if it issues in your country, load $${k}, and make it the card for small daily purchases.`,
    deepen: (n, c, k) => `Keep the card active weekly and hold any cashback in the account rather than withdrawing it at once.`,
  },
  'Prediction Market': {
    open: (n, c, k) => `Fund $${k} on ${n} and take small positions in three markets you actually follow.`,
    deepen: (n, c, k) => `Trade at least twice a week in small size and let positions settle; settled history is the record prediction markets keep.`,
  },
  Insurance: {
    open: (n, c, k) => `Buy $${k} of cover from ${n} against a position you genuinely hold, for the longest term it offers.`,
    deepen: (n, c, k) => `Stake a smaller amount into ${n}'s cover pool if it runs one, so the wallet appears on both sides of the market.`,
  },
  'Stablecoin Issuer': {
    open: (n, c, k) => `Mint $${k} of ${n}'s stablecoin against collateral on ${c}, at the collateral ratio its page calls safe.`,
    deepen: (n, c, k) => `Provide liquidity for the stablecoin's main pair with the minted amount, so the wallet both issues and supports it.`,
  },
  'Dual-Token Stablecoin': {
    open: (n, c, k) => `Mint $${k} of ${n}'s stablecoin with its collateral token on ${c} and hold both sides of the pair.`,
    deepen: (n, c, k) => `Stake the governance-side token if ${n} offers staking, in the smallest tier, and leave it through a full epoch.`,
  },
  'Algo-Stables': {
    open: (n, c, k) => `Mint or buy $${k} of ${n}'s stablecoin on ${c} and place it in the protocol's own liquidity pool.`,
    deepen: (n, c, k) => `Watch the peg weekly; algorithmic stablecoins reward holders who stay through small deviations and punish panic exits.`,
  },
  'Stablecoin Wrapper': {
    open: (n, c, k) => `Wrap $${k} of the underlying stablecoin through ${n} on ${c} and hold the wrapped token.`,
    deepen: (n, c, k) => `Use the wrapped token in one lending market that accepts it, keeping the position small and easy to unwind.`,
  },
  'NFT Marketplace': {
    open: (n, c, k) => `List one item you own on ${n} and buy one floor item under $${Math.round(k * 0.5)}, so the wallet trades on both sides.`,
    deepen: (n, c, k) => `Trade once a week in small size and use ${n}'s lending or offers feature once, if it runs one.`,
  },
  'AI Agents': {
    open: (n, c, k) => `Fund $${k} on ${n} and put its flagship agent to work on a real task you would otherwise do by hand.`,
    deepen: (n, c, k) => `Run the agent weekly and keep its outputs; agent platforms count returning usage, not one-off trials.`,
  },
  'Decentralized AI': {
    open: (n, c, k) => `Spend up to $${k} using ${n}'s compute or inference service on ${c} for a workload you actually have.`,
    deepen: (n, c, k) => `Stake or supply resources to the network if ${n} offers it, in the smallest tier that its page counts.`,
  },
  'Token Locker': {
    open: (n, c, k) => `Lock a small LP position, about $${Math.round(k * 0.5)}, through ${n} for the longest term it offers.`,
    deepen: (n, c, k) => `Renew the lock before it expires once; locker protocols count lock duration and renewals, not just a single lock.`,
  },
  'Governance Incentives': {
    open: (n, c, k) => `Stake $${k} in ${n}'s governance programme on ${c} and vote on the next live proposal.`,
    deepen: (n, c, k) => `Vote on every proposal for a full quarter; an unbroken voting record is the whole product these programmes reward.`,
  },
  'OTC Marketplace': {
    open: (n, c, k) => `Register on ${n}, complete its verification, and complete one small trade of about $${Math.round(k * 0.5)}.`,
    deepen: (n, c, k) => `Keep the account current with one trade a month; OTC desks count counterparties with a live record, not sign-ups.`,
  },
  'Uncollateralized Lending': {
    open: (n, c, k) => `Lend $${Math.round(k * 0.5)} — half the usual size, this market carries real default risk — into one pool on ${n}.`,
    deepen: (n, c, k) => `Spread a second $${Math.round(k * 0.5)} across a pool with a different borrower, and read each pool's repayment record monthly.`,
  },
  'Reserve Currency': {
    open: (n, c, k) => `Buy and stake $${k} of ${n}'s reserve asset on ${c}, following the staking flow its own page sets out.`,
    deepen: (n, c, k) => `Compound the staking rewards weekly and hold through at least one full rebase cycle before judging the position.`,
  },
  CeDeFi: {
    open: (n, c, k) => `Deposit $${k} into ${n}'s flagship earn product and keep the position through one full interest period.`,
    deepen: (n, c, k) => `Use one more of ${n}'s products — a card, a loan or a swap — so the account reads as a customer, not a parked balance.`,
  },
  'Leveraged Farming': {
    open: (n, c, k) => `Open a $${k} position in ${n}'s main farm at no more than 2x leverage, in a stable pair where the borrow cannot run away.`,
    deepen: (n, c, k) => `Check the position's health weekly and deleverage early if the borrow rate spikes; leveraged farms punish inattention, not markets.`,
  },
};

const GENERIC: Playbook = {
  open: (n, c, k) => `Deposit $${k} of USDC into ${n}'s flagship product on ${c} and keep the position open.`,
  deepen: (n, c, k) => `Add a second, smaller position of $${Math.round(k * 0.5)} in another of ${n}'s products, so the wallet is not a one-action visitor.`,
};

/** One board row's farm plan: seven steps, each an action with its cost and its time. */
export function farmPlan(p: Protocol, asOf: string): string[] {
  const chain = mainChain(p);
  const capital = capitalFor(p);
  const gas = gasText(p);
  const book = PLAYBOOKS[p.category ?? ''] ?? GENERIC;
  const hold = holdDaysFor(ageInDays(asOf, p.listed_at));
  const steps: Array<[string, string, string]> = [
    [
      `Open a fresh wallet for this farm alone, fund it on ${chain} with the gas token and $${capital} of stablecoins, and keep its seed phrase offline.`,
      `${gas} of gas to fund and set up`,
      '10 minutes',
    ],
    [book.open(p.name, chain, capital), `$${capital} of capital plus ${gas} of gas`, '15 to 20 minutes'],
    [book.deepen(p.name, chain, capital), `${gas} of gas, no new capital beyond the first step's`, '15 minutes'],
    [
      `Repeat one qualifying action every week — a deposit, a repayment, a vote or a small trade — varying the amount by a fifth either way so the record reads as use, not scripting.`,
      `${gas} of gas a week`,
      '10 minutes a week',
    ],
    [
      `Hold the position for at least ${hold} days, across at least two monthly snapshots of the protocol's numbers, before changing it materially.`,
      `the $${capital} stays in the position; the cost is the wait`,
      `${hold} days`,
    ],
    [
      `Check ${p.name}'s own app weekly for a points, rewards or season page, and claim only from links inside that app — never from a search result, a DM or a lookalike site, and never pay a fee to claim.`,
      'nothing to check; a claim fee is always a scam',
      '5 minutes a week',
    ],
    [
      `Keep a farm log — wallet, dates, amounts, transaction hashes — and set the exit now: claim and reassess if a token launches, unwind if TVL falls 40% from your entry or the app goes quiet for a month.`,
      'nothing but the log itself',
      '10 minutes',
    ],
  ];
  return steps.map(([action, cost, time]) => finishStep(`${action} Cost: ${cost}. Time: ${time}.`));
}

/** A step held inside the gate's 20 to 600 characters, trimmed at a word when it runs long. */
function finishStep(text: string): string {
  let s = text.trim();
  if (s.length > 600) {
    s = s.slice(0, 597);
    const cut = s.lastIndexOf(' ');
    if (cut > 400) s = s.slice(0, cut);
    s = `${s}...`;
  }
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own app weekly.`;
  return s;
}
