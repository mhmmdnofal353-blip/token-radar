/* Token Radar's page: renders window.RADAR (written beside it by main.ts) with no network,
   no framework and no fetch. Three views — the board, the already-trading calibration set,
   and the model — plus a detail page per protocol, all routed on the location hash so any
   view can be linked, screenshotted and read back. */

'use strict';

const R = window.RADAR;
const app = document.getElementById('app');
const bySlug = new Map(R.rows.map((r) => [r.slug, r]));

/* ---------- small formatters ---------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const commas = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
function money(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${commas(n)}`;
}
const moneyFull = (n) => `$${commas(n)}`;
function pct(n) {
  if (n === null || n === undefined) return '<span class="flat">—</span>';
  const cls = n > 0.05 ? 'up' : n < -0.05 ? 'down' : 'flat';
  return `<span class="${cls}">${n > 0 ? '+' : ''}${n.toFixed(1)}%</span>`;
}
function ageText(days) {
  if (days === null || days === undefined) return 'undated';
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30.4)} mo`;
  return `${(days / 365).toFixed(1)} y`;
}
const mult = (n) => `×${Number(n).toFixed(3)}`;

/* ---------- masthead ---------- */

document.getElementById('mast-meta').innerHTML = [
  [commas(R.counts.protocols), 'protocols scanned'],
  [commas(R.counts.board), 'pre-token ranked'],
  [`${R.counts.watchlist}/${R.counts.watchlist}`, 'watchlist covered'],
  [money(R.counts.implied_total_usd), 'total implied'],
].map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`).join('');
document.getElementById('foot-source').textContent = `Snapshot: ${R.source} · Board priced by model ${R.model_version}.`;

/* ---------- routing ---------- */

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [path, query] = hash.split('?');
  const params = new URLSearchParams(query ?? '');
  const parts = path.split('/').filter(Boolean);
  document.querySelectorAll('#tabs a').forEach((a) => {
    const tab = a.getAttribute('data-tab');
    a.classList.toggle('on', tab === parts[0] || (tab === 'board' && (parts[0] === 'board' || parts[0] === 'p' || parts[0] === undefined)));
  });
  app.setAttribute('aria-busy', 'false');
  if (parts[0] === 'p' && parts[1] && bySlug.has(parts[1])) return renderDetail(bySlug.get(parts[1]));
  if (parts[0] === 'live') return renderLive();
  if (parts[0] === 'model') return renderModel();
  return renderBoard(params);
}
window.addEventListener('hashchange', route);

/* ---------- the board ---------- */

const state = { q: '', cat: '', chain: '', wl: false, sort: 'rank' };

function renderBoard(params) {
  state.q = params.get('q') ?? '';
  state.cat = params.get('cat') ?? '';
  state.chain = params.get('chain') ?? '';
  state.wl = params.get('wl') === '1';
  state.sort = params.get('sort') ?? 'rank';
  const cats = [...new Set(R.rows.map((r) => r.category ?? 'Uncategorised'))].sort();
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  app.innerHTML = `
  <section class="view">
    <p class="lede">Every protocol in the snapshot that <b>records no token</b>, ranked by implied value: what a token
    would most plausibly be worth if it launched at the snapshot's figures, priced at the <b>market-cap-to-TVL multiple
    its own category's trading protocols actually carry</b> — weighted by how many peers stand behind that multiple, so one
    rich-trading token never prices a whole category. The house watchlist (over $${(R.floor_usd / 1e6).toFixed(0)}M of TVL) is the floor —
    all ${R.counts.watchlist} are here — and the radar adds ${R.counts.early} earlier protocols below it. Click any row for its
    valuation, factor by factor, and its farm plan.</p>
    <div class="toolbar">
      <label>Search<input type="search" id="f-q" placeholder="Name or slug…" value="${esc(state.q)}"></label>
      <label>Category<select id="f-cat"><option value="">All categories</option>${cats.map((c) => `<option ${c === state.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label>Chain<select id="f-chain"><option value="">All chains</option>${chains.map((c) => `<option ${c === state.chain ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label>Sort by<select id="f-sort">
        <option value="rank" ${state.sort === 'rank' ? 'selected' : ''}>Implied value</option>
        <option value="tvl" ${state.sort === 'tvl' ? 'selected' : ''}>TVL</option>
        <option value="growth" ${state.sort === 'growth' ? 'selected' : ''}>7-day growth</option>
        <option value="age" ${state.sort === 'age' ? 'selected' : ''}>Track record</option>
        <option value="multiple" ${state.sort === 'multiple' ? 'selected' : ''}>Peer multiple</option>
      </select></label>
      <label class="check"><input type="checkbox" id="f-wl" ${state.wl ? 'checked' : ''}> Watchlist only</label>
      <span class="count" id="f-count"></span>
    </div>
    <div class="board-wrap"><table class="board">
      <thead><tr>
        <th>#</th><th>Protocol</th><th>Category</th><th>Chains</th>
        <th class="num">TVL</th><th class="num">7d</th><th class="num">Age</th>
        <th class="num">Peer ×</th><th class="num">Implied value</th><th>Momentum</th>
      </tr></thead>
      <tbody id="rows"></tbody>
    </table></div>
  </section>`;
  const sync = () => {
    history.replaceState(null, '', `#/board?${new URLSearchParams({ q: state.q, cat: state.cat, chain: state.chain, wl: state.wl ? '1' : '0', sort: state.sort })}`);
    applyFilters();
  };
  document.getElementById('f-q').addEventListener('input', (e) => { state.q = e.target.value; sync(); });
  document.getElementById('f-cat').addEventListener('change', (e) => { state.cat = e.target.value; sync(); });
  document.getElementById('f-chain').addEventListener('change', (e) => { state.chain = e.target.value; sync(); });
  document.getElementById('f-sort').addEventListener('change', (e) => { state.sort = e.target.value; sync(); });
  document.getElementById('f-wl').addEventListener('change', (e) => { state.wl = e.target.checked; sync(); });
  document.getElementById('rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = `#/p/${tr.getAttribute('data-slug')}`;
  });
  applyFilters();
}

const topImplied = R.rows.length > 0 ? R.rows[0].implied_value_usd : 1;

function applyFilters() {
  const q = state.q.trim().toLowerCase();
  let rows = R.rows.filter((r) =>
    (state.cat === '' || (r.category ?? 'Uncategorised') === state.cat) &&
    (state.chain === '' || r.chains.includes(state.chain)) &&
    (!state.wl || r.on_watchlist) &&
    (q === '' || r.name.toLowerCase().includes(q) || r.slug.includes(q)));
  const by = {
    rank: (a, b) => a.rank - b.rank,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    growth: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity),
    age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
    multiple: (a, b) => b.model.peer_multiple - a.model.peer_multiple,
  }[state.sort];
  rows = [...rows].sort(by);
  document.getElementById('f-count').textContent = `${rows.length} of ${R.rows.length} protocols`;
  document.getElementById('rows').innerHTML = rows.length === 0
    ? `<tr><td colspan="10" class="empty">No protocol matches those filters. Loosen one and the radar sweeps again.</td></tr>`
    : rows.map((r) => `
    <tr data-slug="${esc(r.slug)}" class="${r.rank <= 3 ? 'top3' : ''}">
      <td class="rank">${r.rank}</td>
      <td><span class="pname">${esc(r.name)}</span>${r.on_watchlist ? '<span class="tag wl">Watchlist</span>' : '<span class="tag early">Early</span>'}<br><span class="pslug">${esc(r.slug)}</span></td>
      <td class="cat">${esc(r.category ?? 'Uncategorised')}</td>
      <td class="chains">${esc(r.chains[0] ?? '—')}${r.chains.length > 1 ? ` +${r.chains.length - 1}` : ''}</td>
      <td class="num">${money(r.tvl_usd)}</td>
      <td class="num">${pct(r.change_7d)}</td>
      <td class="num">${ageText(r.age_days)}</td>
      <td class="num">${mult(r.model.peer_multiple)}<br><span class="peers">${r.model.peer_count} peer${r.model.peer_count === 1 ? '' : 's'}</span></td>
      <td class="num implied">${money(r.implied_value_usd)}<span class="bar"><i style="width:${Math.max(2, Math.sqrt(r.implied_value_usd / topImplied) * 100).toFixed(1)}%"></i></span></td>
      <td><span class="sig ${r.momentum_signal === 'Surging' || r.momentum_signal === 'Climbing' ? 'hot' : r.momentum_signal === 'Falling' || r.momentum_signal === 'Cooling' ? 'cold' : ''}">${esc(r.momentum_signal)}</span></td>
    </tr>`).join('');
}

/* ---------- a protocol's detail ---------- */

function renderDetail(r) {
  const m = R.multiples.find((x) => x.category === (r.category ?? '(none named)'));
  const peers = R.live.filter((l) => l.category === r.category).slice(0, 5);
  const steps = [
    ['TVL — the book being priced', moneyFull(r.tvl_usd), r.tvl_usd],
    [`Peer multiple — ${esc(r.category ?? 'uncategorised')}, ${m && m.peers > 0 ? `median ${mult(m.peer_median ?? 0)} from ${m.peers} trading peer${m.peers === 1 ? '' : 's'}, credibility ${Math.round(m.credibility * 100)}%` : 'market median, no qualifying peer'}`, mult(r.model.peer_multiple), r.tvl_usd * r.model.peer_multiple],
    [`Momentum — seven-day TVL change ${r.change_7d === null ? 'unreported' : `${r.change_7d.toFixed(1)}%`}, saturated`, mult(r.model.momentum_factor), r.tvl_usd * r.model.peer_multiple * r.model.momentum_factor],
    [`Maturity — ${r.age_days === null ? 'listing date unreported, scored as one year' : `${commas(r.age_days)} days tracked with no token`}`, mult(r.model.maturity_factor), r.tvl_usd * r.model.peer_multiple * r.model.momentum_factor * r.model.maturity_factor],
    [`Breadth — TVL on ${r.chains.length} chain${r.chains.length === 1 ? '' : 's'}`, mult(r.model.breadth_factor), r.implied_value_usd],
  ];
  app.innerHTML = `
  <section class="view">
    <a class="back" href="#/board">← Back to the board</a>
    <div class="detail-head">
      <div>
        <h2>${esc(r.name)} ${r.on_watchlist ? '<span class="tag wl">Watchlist</span>' : '<span class="tag early">Early radar</span>'}</h2>
        <p class="sub">${esc(r.category ?? 'Uncategorised')} · rank #${r.rank} of ${R.rows.length} · records no token in the snapshot · <span class="pslug">${esc(r.slug)}</span></p>
      </div>
      <div class="big-implied"><span>Implied value</span><b>${moneyFull(r.implied_value_usd)}</b></div>
    </div>
    <div class="tiles">
      <div class="tile"><span>TVL</span><b>${moneyFull(r.tvl_usd)}</b></div>
      <div class="tile"><span>7-day change</span><b>${r.change_7d === null ? '—' : `${r.change_7d > 0 ? '+' : ''}${r.change_7d.toFixed(1)}%`}</b></div>
      <div class="tile"><span>Tracked for</span><b>${r.age_days === null ? 'undated' : `${commas(r.age_days)} days`}</b></div>
      <div class="tile"><span>Record</span><b>${esc(r.record_signal)}</b></div>
      <div class="tile"><span>Chains</span><b>${r.chains.length}</b></div>
      <div class="tile"><span>Implied / TVL</span><b>${mult(r.implied_value_usd / Math.max(1, r.tvl_usd))}</b></div>
    </div>
    <div class="cols">
      <div>
        <div class="card">
          <h3>Why this value</h3>
          <table class="factors">
            ${steps.map(([name, factor, running], i) => `<tr class="${i === steps.length - 1 ? 'total' : ''}"><td class="fname">${name}</td><td class="num">${factor}</td><td class="num">${moneyFull(Math.round(running))}</td></tr>`).join('')}
          </table>
          <p>${m && m.peers > 0
            ? `The category median is ${mult(m.peer_median ?? 0)} — the median market-cap/TVL of ${m.peers} already-trading ${esc(m.category)} protocol${m.peers === 1 ? '' : 's'} with a book over ${money(R.peer_min_tvl_usd)}, each ratio capped at ${R.peer_ratio_cap}×. A median of ${m.peers} is evidence, not gospel, so it counts with credibility ${Math.round(m.credibility * 100)}% (${m.peers} peer${m.peers === 1 ? '' : 's'} against the model's k = ${R.constants.shrink_k}) and the multiple used is its geometric blend with the market median of ${mult(R.market_multiple)}: ${mult(r.model.peer_multiple)}. Thin categories stay near the market's price until more of their tokens trade; thick ones speak for themselves.`
            : `No already-trading protocol in this category carries a book over ${money(R.peer_min_tvl_usd)}, so the radar prices it at the whole-market median multiple of ${mult(R.market_multiple)} rather than inventing a category figure.`}</p>
          ${peers.length > 0 ? `<p>Trading peers on the calibration view: ${peers.map((l) => `${esc(l.name)} (${mult(l.mcap_to_tvl)})`).join(' · ')}.</p>` : ''}
          <p>Chains: ${r.chains.map(esc).join(', ') || 'none named'}.</p>
        </div>
      </div>
      <div class="card">
        <h3>Farm plan — ${r.farm_steps.length} steps</h3>
        <ol class="plan">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      </div>
    </div>
  </section>`;
  window.scrollTo(0, 0);
}

/* ---------- already trading ---------- */

function renderLive() {
  app.innerHTML = `
  <section class="view">
    <p class="lede">These protocols' tokens <b>already trade</b>, so the radar never ranks them — it measures with them.
    The board's multiples are built from the qualifying peers among them: a book over ${money(R.peer_min_tvl_usd)} and a ratio
    no higher than ${R.peer_ratio_cap}×, so a stretched or tiny-book token — a few sit near the top of this very table — cannot
    set a category's price; and each category's median counts only with its credibility, so a category carried by one or two
    of these books stays near the market's own price. Here they all are at the market's own raw values, largest first.</p>
    <div class="board-wrap"><table class="board">
      <thead><tr><th>Protocol</th><th>Category</th><th>Token</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Cap / TVL</th><th class="num">7d</th></tr></thead>
      <tbody>${R.live.map((l) => `
        <tr><td><span class="pname">${esc(l.name)}</span><br><span class="pslug">${esc(l.slug)}</span></td>
        <td class="cat">${esc(l.category ?? 'Uncategorised')}</td>
        <td class="cat">${esc(l.symbol ?? '—')}</td>
        <td class="num">${money(l.tvl_usd)}</td>
        <td class="num">${money(l.mcap_usd)}</td>
        <td class="num">${mult(l.mcap_to_tvl)}</td>
        <td class="num">${pct(l.change_7d)}</td></tr>`).join('')}
      </tbody>
    </table></div>
  </section>`;
}

/* ---------- the model ---------- */

function renderModel() {
  const c = R.constants;
  const top = R.rows[0];
  app.innerHTML = `
  <section class="view">
    <p class="lede">One formula, no hand-kept list of names. Every figure below is recomputed from the sealed snapshot
    each time the program runs, so a future snapshot re-prices the whole board with no code change — that is what makes
    it a radar rather than a table.</p>
    <div class="formula">implied value = TVL × peer multiple × momentum × maturity × breadth</div>
    <div class="grid2" style="margin-top:14px">
      <div class="card">
        <h3>The four factors</h3>
        <ul class="tight">
          <li><b>Peer multiple.</b> For the protocol's category, the median market-cap/TVL of its already-trading protocols whose TVL clears ${money(R.peer_min_tvl_usd)} (twice the snapshot's own floor), each ratio capped at ${R.peer_ratio_cap}× so one float-driven token cannot set a category's price. The median then counts only with its <b>credibility</b>, Z = peers / (peers + ${c.shrink_k}), and the multiple used is the geometric blend <code>market^(1−Z) × median^Z</code> against the market median (${mult(R.market_multiple)}): a lone peer — one small book whose token trades rich — moves its category barely a seventh of the way off the market's price, six peers earn half the say, and a category with thirty peers stands nearly on its own. The blend is geometric because a multiple is a ratio, and evidence about ratios multiplies rather than adds. A category with no qualifying peer is priced at the market median, openly.</li>
          <li><b>Momentum.</b> The seven-day TVL change through a saturating curve, <code>1 + ${c.momentum_weight} × g / (${c.momentum_scale} + |g|)</code>: +25% earns about ×1.18, +400% only ×1.33, and a collapsing book is marked down, never to zero.</li>
          <li><b>Maturity.</b> <code>${c.maturity_base} + ${c.maturity_span} × age / (age + ${c.maturity_mid_days})</code> on days tracked with no token: a launch-day record starts at ×0.60 and a three-year record approaches ×1.00. An unreported listing date is scored as one year — neither punished nor believed.</li>
          <li><b>Breadth.</b> ×${c.breadth_per_chain} per chain beyond the first, up to ${c.breadth_max_extra} extra chains: distribution is worth something, and not much.</li>
        </ul>
        <h3 style="margin-top:16px">Who is on the board</h3>
        <ul class="tight">
          <li>Every slug on the snapshot's watchlist — TVL at or over ${money(R.floor_usd)} and no token recorded — is ranked. The watchlist is the floor, never the ceiling.</li>
          <li>Below the floor, the early radar adds every other protocol that records no token, under the same hygiene the watchlist's own definition uses: bridge, canonical-bridge, liquid-staking, liquid-restaking and restaked-BTC categories and the exchanges are set aside as products of tokens that already trade, as are versioned pools, exchange-named products and names carrying a whole word <i>wrapped</i>, <i>staked</i> or <i>staking</i>.</li>
          <li>Protocols whose token already trades are never ranked; they are the measuring instruments, on the Already trading view.</li>
        </ul>
        <h3 style="margin-top:16px">Worked example — the board's #1</h3>
        <p>${esc(top.name)}: TVL ${moneyFull(top.tvl_usd)} × peer multiple ${mult(top.model.peer_multiple)} (${top.model.peer_count} peers)
        × momentum ${mult(top.model.momentum_factor)} × maturity ${mult(top.model.maturity_factor)} × breadth ${mult(top.model.breadth_factor)}
        = <b>${moneyFull(top.implied_value_usd)}</b>. Every row's detail page shows its own arithmetic the same way.</p>
      </div>
      <div>
        <h3 style="margin:2px 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:0.1em; color:var(--teal)">Measured multiples by category</h3>
        <div class="scrollbox"><table class="plain">
          <thead><tr><th>Category</th><th class="num">Peers</th><th class="num">Peer median</th><th class="num">Credibility</th><th class="num">Multiple used</th></tr></thead>
          <tbody>${R.multiples.map((m) => `<tr><td>${esc(m.category)}</td><td class="num">${m.peers}</td><td class="num">${m.peer_median === null ? '—' : mult(m.peer_median)}</td><td class="num">${m.peers === 0 ? '—' : `${Math.round(m.credibility * 100)}%`}</td><td class="num">${mult(m.multiple)}</td></tr>`).join('')}
          </tbody>
        </table></div>
        <p style="color:var(--faint); font-size:12.5px">Model ${esc(R.model_version)} · snapshot as of ${esc(R.as_of)}. Implied value is a claim about a hypothetical token at today's figures, not a forecast of an airdrop, a date or an allocation.</p>
      </div>
    </div>
  </section>`;
}

route();
