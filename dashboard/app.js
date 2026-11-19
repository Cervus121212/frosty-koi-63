// Launch Radar v4 dashboard: renders window.RADAR (written by main.ts).
// No framework, no network. Sort + filter the board, open a protocol's detail
// view (model breakdown + farm plan in dollars + what-if selectors that
// recompute the economics live), read the method page.
(function () {
  var R = window.RADAR;
  if (!R) { document.body.innerHTML = '<p style="padding:24px">No radar data loaded.</p>'; return; }
  var board = R.board;
  var model = R.model;
  var val = model.validation;
  var audit = R.audit;
  var odds = model.odds;

  function money(v) {
    if (v == null || isNaN(v)) return '—';
    var neg = v < 0;
    var a = Math.abs(v);
    var s;
    if (a >= 1e9) s = '$' + (a / 1e9).toFixed(2) + 'bn';
    else if (a >= 1e6) s = '$' + (a / 1e6).toFixed(1) + 'm';
    else if (a >= 1e3) s = '$' + (a / 1e3).toFixed(1) + 'k';
    else if (a >= 100) s = '$' + Math.round(a);
    else s = '$' + a.toFixed(2);
    return neg ? '-' + s : s;
  }
  function pct(v) { return v == null || isNaN(v) ? '—' : (v * 100).toFixed(1) + '%'; }
  function num(v) { return v == null ? '—' : v.toLocaleString('en-US'); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- header + KPI strip
  document.getElementById('meta-line').textContent =
    'Snapshot sealed 14 Nov 2026 · ' + audit.total + ' protocols · ' + audit.records_no_token +
    ' pre-token audited · ' + audit.ranked + ' ranked by expected value · ' + audit.watchlist_ranked + '/' +
    audit.watchlist_total + ' watchlist on the board · value fit from ' +
    val.comps + ' traded comps · odds fit from ' + odds.n_dated + ' dated protocols.';
  var farmCount = board.filter(function (r) { return r.verdict === 'Farm'; }).length;
  var thinCount = board.filter(function (r) { return r.verdict === 'Thin'; }).length;
  var kpis = [
    { label: 'Rank', value: 'Expected value', sub: 'conditional value × launch odds' },
    { label: '5-fold CV × 5 seeds', value: val.cv_blend.toFixed(4), sub: 'starter ' + val.cv_starter.toFixed(4) + ' · old model ' + val.cv_old.toFixed(4) },
    { label: 'Walk-forward 70/30', value: val.wf70_blend.toFixed(4), sub: 'train oldest 66, test newest 29', accent: true },
    { label: 'Launch odds, held out', value: (odds.validation.random_holdout.hit_rate * 100).toFixed(1) + '% hit', sub: 'Brier ' + odds.validation.random_holdout.brier + ' vs base ' + odds.validation.random_holdout.base_brier },
    { label: 'Ranked', value: String(audit.ranked), sub: audit.records_no_token + ' pre-token audited' },
    { label: 'Verdict Farm', value: String(farmCount), sub: thinCount + ' Thin · ' + (board.length - farmCount - thinCount) + ' Skip' },
  ];
  document.getElementById('kpi-strip').innerHTML = kpis.map(function (k) {
    return '<div class="cell"><div class="label">' + k.label + '</div><div class="value' +
      (k.accent ? ' accent' : '') + '">' + k.value + '</div><div class="sub">' + esc(k.sub) + '</div></div>';
  }).join('');

  // ---- cover: formula + scatter + ablation
  document.getElementById('cover-formula').innerHTML =
    '<h3>Fitted value model</h3>' +
    '<div class="formula">ln(mcap) = ' + model.curve_a + ' + ' + model.curve_s + ' * ln(tvl)\n' +
    '  + group offset  (shrunk n/(n+' + model.shrink_k + '))\n' +
    'blend:  ln(conditional) = ' + model.blend_grouped + ' * grouped + ' + model.blend_ridge + ' * ridge-LAD</div>' +
    '<h3>Launch odds</h3>' +
    '<div class="formula">P(launch in 2y) = 1 - exp(-multiplier x (H(age+2) - H(age)))\n' +
    'hazard per year: ' + odds.edges.map(function (e, i) {
      return '[' + e + ', ' + (odds.edges[i + 1] == null ? 'inf' : odds.edges[i + 1]) + ') ' + odds.hazards[i].toFixed(2);
    }).join(' · ') + '</div>' +
    '<p><strong>Expected value = conditional value × launch odds.</strong> ' +
    'The board is sorted by it. ' + esc(board[0].name) + ' is #1 at ' + money(board[0].implied_value_usd) +
    ' expected (' + money(board[0].conditional_value_usd) + ' if it launches × ' +
    pct(board[0].launch_p) + ' odds).</p>';

  (function scatter() {
    var pts = R.scatter.points;
    var line = R.scatter.line;
    var W = 560, H = 340, padL = 52, padB = 40, padT = 14, padR = 14;
    var xs = pts.map(function (p) { return p.x; });
    var ys = pts.map(function (p) { return p.y; });
    var x0 = Math.min.apply(null, xs.concat([line[0]])), x1 = Math.max.apply(null, xs.concat([line[2]]));
    var y0 = Math.min.apply(null, ys.concat([line[1]])), y1 = Math.max.apply(null, ys.concat([line[3]]));
    function X(v) { return padL + (v - x0) / (x1 - x0) * (W - padL - padR); }
    function Y(v) { return H - padB - (v - y0) / (y1 - y0) * (H - padT - padB); }
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Fit scatter of log market cap against log TVL">';
    svg += '<line x1="' + X(x0) + '" y1="' + Y(y0) + '" x2="' + X(x1) + '" y2="' + Y(y0) + '" stroke="#94a3b8"/>';
    svg += '<line x1="' + X(x0) + '" y1="' + Y(y0) + '" x2="' + X(x0) + '" y2="' + Y(y1) + '" stroke="#94a3b8"/>';
    svg += '<line x1="' + X(line[0]) + '" y1="' + Y(line[1]) + '" x2="' + X(line[2]) + '" y2="' + Y(line[3]) + '" stroke="#b45309" stroke-width="2"/>';
    pts.forEach(function (p) {
      var above = p.y >= p.yh;
      svg += '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="3" fill="' +
        (above ? '#1d4ed8' : '#0e7490') + '" fill-opacity="0.75"/>';
    });
    svg += '<text x="' + (W / 2) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="12" fill="#475569">ln(TVL)</text>';
    svg += '<text x="14" y="' + (H / 2) + '" text-anchor="middle" font-size="12" fill="#475569" transform="rotate(-90 14 ' + (H / 2) + ')">ln(mcap)</text>';
    svg += '</svg>';
    document.getElementById('scatter').innerHTML = svg;
    document.getElementById('scatter-note').textContent =
      'Each dot is one traded comp; the line is the fitted log-log curve. Blue dots sit above ' +
      'their fitted value, teal below. The scatter is wide — a typical value is right within a ' +
      'factor of ~3.7, not to the dollar — and that width is what the per-row bands measure.';
  })();

  document.getElementById('ablation-body').innerHTML = val.ablation.map(function (s) {
    return '<tr><td>' + esc(s.step) + '</td><td class="num">x' + s.geo.toFixed(2) + '</td>' +
      '<td class="num">' + Math.round(s.within3 * 100) + '%</td></tr>';
  }).join('');

  // ---- filters + sort
  var cats = Array.from(new Set(board.map(function (r) { return r.category; }))).sort();
  var catSel = document.getElementById('cat');
  cats.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });
  var state = { q: '', cat: '', verdict: '', watch: false, sort: 'rank', dir: 1 };
  var verdictOrder = { Farm: 0, Thin: 1, Skip: 2 };

  function filtered() {
    var rows = board.filter(function (r) {
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      }
      if (state.cat && r.category !== state.cat) return false;
      if (state.verdict && r.verdict !== state.verdict) return false;
      if (state.watch && !r.watchlist) return false;
      return true;
    });
    var key = state.sort;
    rows.sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (key === 'verdict') { av = verdictOrder[a.verdict]; bv = verdictOrder[b.verdict]; }
      if (key === 'band') { av = a.band_lo_usd; bv = b.band_lo_usd; }
      if (typeof av === 'string') return state.dir * (av < bv ? -1 : av > bv ? 1 : 0);
      return state.dir * (av - bv);
    });
    return rows;
  }

  var tbody = document.getElementById('board-body');
  function renderBoard() {
    var rows = filtered();
    document.getElementById('row-count').textContent = rows.length + ' of ' + board.length + ' rows';
    tbody.innerHTML = rows.map(function (r) {
      var band = r.rank_lo === r.rank_hi ? 'rank ' + r.rank : r.rank_lo + '–' + r.rank_hi;
      var oddsCls = r.launch_p >= r.break_even_p ? 'good' : 'bad';
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + (r.watchlist ? ' <span class="watch">★</span>' : '') + '</td>' +
        '<td>' + esc(r.name) + '<br><span style="color:var(--muted);font-size:12px">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + money(r.conditional_value_usd) + '</td>' +
        '<td class="num"><span class="' + oddsCls + '">' + pct(r.launch_p) + '</span></td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong><br><span style="color:var(--muted);font-size:12px">' + band + ' · ' + money(r.band_lo_usd) + '–' + money(r.band_hi_usd) + '</span></td>' +
        '<td class="num">' + money(r.expected_net_usd) + '</td>' +
        '<td class="num">' + pct(r.break_even_p) + '</td>' +
        '<td><span class="badge ' + r.verdict.toLowerCase() + '">' + r.verdict + '</span></td></tr>';
    }).join('');
  }
  tbody.addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (tr) openDetail(tr.getAttribute('data-slug'), true);
  });
  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = 1; }
      renderBoard();
    });
  });
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  catSel.addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  document.getElementById('verdict').addEventListener('change', function (e) { state.verdict = e.target.value; renderBoard(); });
  document.getElementById('watch').addEventListener('change', function (e) { state.watch = e.target.checked; renderBoard(); });
  renderBoard();

  // ---- detail view
  var detail = document.getElementById('detail');
  var detailBody = document.getElementById('detail-body');
  function groupKey(category) {
    var pool = {
      'Bridge': 'Bridge', 'Canonical Bridge': 'Bridge', 'Cross Chain Bridge': 'Bridge',
      'Liquid Staking': 'Staking', 'Liquid Restaking': 'Staking', 'Restaking': 'Staking', 'Staking Pool': 'Staking',
      'Yield': 'Yield', 'Yield Aggregator': 'Yield', 'Leveraged Farming': 'Yield',
      'Lending': 'Lending', 'CDP': 'Lending', 'Collateral Management': 'Lending',
      'AI Agents': 'AI', 'Decentralized AI': 'AI', 'Dexs': 'Dexs', 'Liquidity Manager': 'Dexs'
    };
    return pool[category] || category;
  }
  function openDetail(slug, scroll) {
    var r = board.find(function (x) { return x.slug === slug; });
    if (!r) return;
    document.querySelectorAll('#board-body tr').forEach(function (tr) {
      tr.classList.toggle('selected', tr.getAttribute('data-slug') === slug);
    });
    var band = r.rank_lo === r.rank_hi
      ? 'Rank'
      : 'Rank · band ' + r.rank_lo + '–' + r.rank_hi;
    var age = r.age_days == null ? 'unknown age' : r.age_days + ' days old';
    var growth = r.growth_7d == null ? 'no 7-day change in the snapshot' : (r.growth_7d > 0 ? '+' : '') + r.growth_7d.toFixed(1) + '% in 7 days';
    detailBody.innerHTML =
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' · ' + esc(r.category) + ' · ' + esc(r.chains.join(', ') || 'no chains listed') +
      ' · TVL ' + money(r.tvl_usd) + ' · ' + age + ' · ' + growth +
      (r.watchlist ? ' · <span class="watch">★ on the watchlist</span>' : '') + '</p>' +
      '<div class="grid">' +
      '<div class="stat"><div class="l">Expected value</div><div class="v">' + money(r.implied_value_usd) + '</div></div>' +
      '<div class="stat"><div class="l">' + esc(band) + '</div><div class="v">#' + r.rank + '</div></div>' +
      '<div class="stat"><div class="l">If it launches</div><div class="v">' + money(r.conditional_value_usd) + '</div></div>' +
      '<div class="stat"><div class="l">Launch odds (2y)</div><div class="v">' + pct(r.launch_p) + '</div></div>' +
      '<div class="stat"><div class="l">Value band P25–P75</div><div class="v">' + money(r.band_lo_usd) + ' – ' + money(r.band_hi_usd) + '</div></div>' +
      '<div class="stat"><div class="l">Farmer value (if launch)</div><div class="v">' + money(r.farmer_value_usd) + '</div></div>' +
      '<div class="stat"><div class="l">Expected net</div><div class="v">' + money(r.expected_net_usd) + '</div></div>' +
      '<div class="stat"><div class="l">Break-even odds</div><div class="v">' + pct(r.break_even_p) + '</div></div>' +
      '<div class="stat"><div class="l">Verdict</div><div class="v"><span class="badge ' + r.verdict.toLowerCase() + '">' + r.verdict + '</span></div></div>' +
      '</div>' +
      '<h3>How the value is built</h3>' +
      '<p>Curve alone (TVL only): <strong>' + money(r.curve_usd) + '</strong> · ' +
      'curve + ' + esc(r.category) + ' group offset: <strong>' + money(r.grouped_usd) + '</strong> · ' +
      'ridge leg alone (growth, age, chains): <strong>' + money(r.ridge_usd) + '</strong> · ' +
      'blend 0.8 × grouped + 0.2 × ridge: <strong>' + money(r.conditional_value_usd) + '</strong> · ' +
      '× launch odds ' + pct(r.launch_p) + ' = expected <strong>' + money(r.implied_value_usd) + '</strong> ' +
      '(band ' + money(r.ev_band_lo_usd) + ' – ' + money(r.ev_band_hi_usd) + '). ' +
      'The group offset for ' + esc(r.category) + ' is ' +
      (model.group_offsets[groupKey(r.category)] != null
        ? (model.group_offsets[groupKey(r.category)] >= 0 ? '+' : '') + model.group_offsets[groupKey(r.category)].toFixed(2) + ' in log space'
        : 'the global median (no comps in this group)') + '. ' +
      'The band is the P25–P75 of the fitted value, from the leave-one-out errors of comps near this TVL.</p>' +
      '<h3>What if — change the farm, see the economics move</h3>' +
      '<div class="whatif">' +
      '<label>Deposit <select id="wi-deposit">' +
      '<option value="' + r.capital_usd + '" selected>Model: ' + money(r.capital_usd) + '</option>' +
      '<option value="50">$50</option><option value="100">$100</option><option value="250">$250</option>' +
      '</select></label>' +
      '<label>Farmer share <select id="wi-share">' +
      '<option value="0.025">2.5%</option><option value="0.05" selected>5%</option><option value="0.10">10%</option>' +
      '</select></label>' +
      '<label>T-bill yield <select id="wi-tbill">' +
      '<option value="0">0%</option><option value="0.04" selected>4%</option><option value="0.08">8%</option>' +
      '</select></label>' +
      '<p class="note">A bigger deposit buys a bigger share of the airdrop, up to 4× the model’s capital. ' +
      'The share scales the farmer value; the T-bill rate prices what the deposit forgoes over 8 weeks. ' +
      'The steps below stay the base plan — this panel recomputes only the economics.</p>' +
      '<div class="grid" id="wi-out"></div>' +
      '</div>' +
      '<h3>Farm plan — concrete steps, costed in dollars</h3>' +
      '<ol>' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    detail.hidden = false;
    // Scroll only on a click: a hash deep-link opens the detail in place,
    // so a headless capture (and a reader's scroll position) is not moved.
    if (scroll) detail.scrollIntoView({ behavior: 'auto', block: 'start' });
    try { history.replaceState(null, '', '#detail=' + slug); } catch (e) { /* file:// */ }

    // what-if recompute
    var wiOut = document.getElementById('wi-out');
    function recompute() {
      var dep = parseFloat(document.getElementById('wi-deposit').value);
      var share = parseFloat(document.getElementById('wi-share').value);
      var tb = parseFloat(document.getElementById('wi-tbill').value);
      var scale = Math.min(dep / r.capital_usd, 4);
      var fv = r.farmer_value_usd * scale * (share / 0.05);
      var tbill = tb * dep * 56 / 365;
      var net = fv - 15 - tbill;
      var expNet = fv * r.launch_p - 15 - tbill;
      var be = (15 + tbill) / fv;
      var verdict = (net >= 200 && net / 8 >= 25 && r.launch_p >= be) ? 'Farm'
        : (net >= 50 && net / 8 >= 10 && r.launch_p >= be) ? 'Thin' : 'Skip';
      wiOut.innerHTML =
        '<div class="stat"><div class="l">Farmer value</div><div class="v">' + money(fv) + '</div></div>' +
        '<div class="stat"><div class="l">Net (if launch)</div><div class="v">' + money(net) + '</div></div>' +
        '<div class="stat"><div class="l">Expected net</div><div class="v">' + money(expNet) + '</div></div>' +
        '<div class="stat"><div class="l">Break-even odds</div><div class="v">' + pct(be) + '</div></div>' +
        '<div class="stat"><div class="l">Verdict</div><div class="v"><span class="badge ' + verdict.toLowerCase() + '">' + verdict + '</span></div></div>';
    }
    ['wi-deposit', 'wi-share', 'wi-tbill'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', recompute);
    });
    recompute();
  }
  document.getElementById('detail-close').addEventListener('click', function () {
    detail.hidden = true;
    document.querySelectorAll('#board-body tr').forEach(function (tr) { tr.classList.remove('selected'); });
  });

  // ---- method page
  var offs = Object.keys(model.group_offsets).sort().map(function (g) {
    return g + ' (n=' + (model.group_sizes[g] || 0) + '): ' +
      (model.group_offsets[g] >= 0 ? '+' : '') + model.group_offsets[g].toFixed(2);
  }).join(' · ');
  var compRows = (val.comparison || []).map(function (c) {
    return '<tr><td>' + esc(c.model) + '</td><td class="num">' + c.cv.toFixed(4) + '</td>' +
      '<td class="num">' + c.wf70.toFixed(4) + '</td><td class="num">' + c.wf60.toFixed(4) + '</td>' +
      '<td class="num">' + c.blind.toFixed(4) + '</td><td class="num">' + c.loo.toFixed(4) + '</td>' +
      '<td class="num">' + c.boot.toFixed(4) + '</td></tr>';
  }).join('');
  document.getElementById('method-body').innerHTML =
    '<p>The implied value of a pre-token protocol is fitted from the ' + val.comps +
    ' protocols in this snapshot that already trade (positive market cap and TVL). ' +
    'Nothing is a hand-made multiple, and no protocol name is hard-coded anywhere: ' +
    'a protocol that does not exist yet gets its value from its TVL, its category, ' +
    'its growth, its age and its chains.</p>' +
    '<div class="formula">ln(mcap) = ' + model.curve_a + ' + ' + model.curve_s + ' * ln(tvl)   [OLS on the ' + val.comps + ' comps]\n' +
    '  + group offset  (median residual of the category group, shrunk n/(n+' + model.shrink_k + ') toward the global median ' + model.global_median_resid + ')\n' +
    'blend:  ln(conditional) = ' + model.blend_grouped + ' * grouped + ' + model.blend_ridge + ' * ridge-LAD\n' +
    'ridge-LAD: median regression on [lnTVL, growth7d, log(age+1), nChains, top-5 chain flags],\n' +
    '  lambda=' + model.ridge_lambda + ', ' + model.ridge_rounds + ' IRLS rounds, intercept ' + model.ridge_intercept + '</div>' +
    '<p><strong>Group offsets (log space):</strong> ' + esc(offs) + '.</p>' +
    '<p><strong>Ridge coefficients (standardised features):</strong> ' +
    Object.keys(model.ridge_coefs).map(function (k) { return k + ' ' + model.ridge_coefs[k]; }).join(' · ') + '.</p>' +
    '<h3>The launch odds — fitted, not guessed</h3>' +
    '<p>For every protocol with a listing date the snapshot says only whether it has a token by ' +
    '14 Nov 2026, never when it launched. A piecewise-constant hazard by age is the honest model ' +
    'for that shape of data, fitted by maximum likelihood on ' + odds.n_dated + ' dated protocols ' +
    '(' + odds.n_token + ' with a token; log-likelihood ' + odds.loglik + '; a Weibull cross-check fits ' +
    'worse at ' + odds.weibull.loglik + '). Hazard per year: ' +
    odds.edges.map(function (e, i) {
      return '[' + e + ', ' + (odds.edges[i + 1] == null ? 'inf' : odds.edges[i + 1]) + ') ' + odds.hazards[i].toFixed(2);
    }).join(' · ') + '. Each category carries a shrunk multiplier (events+3)/(expected+3). ' +
    'P(launch in 2y) = 1 - exp(-multiplier × (H(age+2) - H(age))).</p>' +
    '<p>Random 70/30 hold-out: hit rate ' + pct(odds.validation.random_holdout.hit_rate) + ' against a ' +
    pct(odds.validation.random_holdout.majority_rate) + ' majority rate; Brier ' +
    odds.validation.random_holdout.brier + ' against a ' + odds.validation.random_holdout.base_brier +
    ' constant-rate base. Time split at the median listing date: Brier ' +
    odds.validation.time_holdout.brier + ' against a ' + odds.validation.time_holdout.base_brier +
    ' base — better than the base, but it under-predicts (mean predicted ' +
    pct(odds.validation.time_holdout.mean_predicted) + ' vs observed ' +
    pct(odds.validation.time_holdout.observed) + '): the future launches faster than the past, and ' +
    'the board reports it instead of correcting for it.</p>' +
    '<h3>Out-of-sample validation — same protocol for every model</h3>' +
    '<p>Metric: median |ln(pred/mcap)|, lower is better. 5-fold CV × 5 seeds; walk-forward ' +
    'trains on the oldest listed comps and tests on the newest (70/30: 66 train / 29 test; ' +
    '60/40: 57 train / 38 test); blind is a stratified 20% hold-out (n=' + val.blind_n +
    ', mean over 5 seeds; seed 999 alone is ' + val.blind_seed999.toFixed(4) + ' for the blend — one small split); ' +
    'LOO refits once per comp; bootstrap refits 200 times and scores the out-of-bag comps.</p>' +
    '<table><thead><tr><th>Model</th><th>CV ×5</th><th>WF 70/30</th><th>WF 60/40</th><th>Blind ×5</th><th>LOO</th><th>Boot OOB</th></tr></thead><tbody>' +
    compRows + '</tbody></table>' +
    '<p>The fitted family beats the starter by ~16% on CV (' + val.cv_blend.toFixed(4) + ' vs ' +
    val.cv_starter.toFixed(4) + ') and ~24% on walk-forward (' + val.wf70_blend.toFixed(4) + ' vs 1.3945). ' +
    'The blend wins walk-forward; the curve wins CV and LOO; grouped-only wins the blind mean — no leg ' +
    'dominates everywhere, and the table shows it. Sensitivity is flat: blend 0.6/0.7/0.8/0.9/1.0 → CV ' +
    ['0.6', '0.7', '0.8', '0.9', '1.0'].map(function (w) { return val.sensitivity_blend[w].toFixed(4); }).join(' / ') +
    '. Shrink k=3/5/10 → CV ' +
    ['3', '5', '10'].map(function (k) { return val.sensitivity_shrink[k].toFixed(4); }).join(' / ') +
    '. Two alternatives were tested and rejected: a ln(age) term in the curve loses walk-forward badly ' +
    '(WF70 1.46 vs 1.06), and training on the ratio-banded 109-comp pool loses walk-forward too (WF70 1.27 vs 1.06).</p>' +
    '<h3>Farm assumptions — stated, so they can be argued with</h3>' +
    '<p>Farmer allocation 5% of the conditional value; farmers = TVL / $10,000, clamped to ' +
    '100–100,000; gas ~$15 total (bridge $5, deposit $5, exit $5); 8 hours of work ' +
    '(1 deploy + 4 weekly + 2 monitor + 1 exit); capital is 10% of TVL, capped $50–$250, ' +
    'and comes back on exit — it is not a cost. The deposit forgoes a 4% T-bill yield over the ' +
    '8 weeks (at most $3.06); that leg is small and it is charged. Verdict: <strong>Farm</strong> if the ' +
    'conditional net ≥ $200 and $/hour ≥ $25 <strong>and</strong> the launch odds clear the break-even odds; ' +
    '<strong>Thin</strong> if net ≥ $50 and $/hour ≥ $10 and the odds clear break-even; otherwise ' +
    '<strong>Skip</strong>. Break-even odds = (gas + forgone yield) / farmer value: the odds that make ' +
    'the farm exactly zero-EV. The odds change exactly one verdict against the conditional-only rule: ' +
    'Polymarket International has a $66.5m conditional value and an $87 conditional net, but its ' +
    'launch odds (8.1%) sit below its break-even (15.9%), so farming it loses about $8 on average and it is a Skip.</p>' +
    '<p>Value and farmability diverge on purpose: the board ranks by expected value, ' +
    'but the verdict is net dollars per farmer. The biggest protocols are the most ' +
    'diluted — ' + esc(board[0].name) + ' ranks #1 by expected value yet nets about ' +
    money(board[0].expected_net_usd) + ' in expectation for 8 hours, so it is ' +
    'a ' + board[0].verdict + ', while mid-size protocols with fewer farmers net $200+ and earn Farm. ' +
    'A high rank is not a farming recommendation.</p>' +
    '<h3>What would make this better</h3>' +
    '<p>The noise floor is the story: within a category, log(mcap/TVL) spreads 1.0–3.0, ' +
    'and one comp sits at mcap/TVL 400×. No feature in the snapshot — growth, age, ' +
    'chains, category — closes that gap. The odds model is the weakest leg: the time split shows ' +
    'the future launches faster than the past, and the oldest-age bucket over-predicts on 5 protocols. ' +
    'The next step is not a fancier curve but a richer snapshot: revenue, team size, or a real launch signal.</p>';

  // ---- comps table
  document.getElementById('comps-body').innerHTML = R.live.map(function (c) {
    return '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.category) + '</td>' +
      '<td class="num">' + money(c.tvl_usd) + '</td><td class="num">' + money(c.mcap_usd) + '</td>' +
      '<td class="num">' + c.ratio.toFixed(2) + '×</td></tr>';
  }).join('');

  // ---- audit
  document.getElementById('audit-body').innerHTML =
    '<div class="grid">' +
    '<div class="stat"><div class="l">Protocols in snapshot</div><div class="v">' + num(audit.total) + '</div></div>' +
    '<div class="stat"><div class="l">Pre-token (no token recorded)</div><div class="v">' + num(audit.records_no_token) + '</div></div>' +
    '<div class="stat"><div class="l">Record a token already</div><div class="v">' + num(audit.records_token) + '</div></div>' +
    '<div class="stat"><div class="l">Live with a market cap</div><div class="v">' + num(audit.live_with_mcap) + '</div></div>' +
    '<div class="stat"><div class="l">Ranked on the board</div><div class="v">' + num(audit.ranked) + '</div></div>' +
    '<div class="stat"><div class="l">Excluded by rule</div><div class="v">' + num(audit.excluded) + '</div></div>' +
    '<div class="stat"><div class="l">Watchlist on the board</div><div class="v">' + audit.watchlist_ranked + ' / ' + audit.watchlist_total + '</div></div>' +
    '</div>' +
    '<p>Excluded: ' + audit.excluded_cex + ' centralised exchanges, ' + audit.excluded_bridge +
    ' bridges, ' + audit.excluded_staking + ' staking products, ' + audit.excluded_wrapped_btc +
    ' wrapped-BTC products, ' + audit.excluded_wrapped_stablecoin + ' wrapped stablecoins, ' +
    audit.excluded_versioned + ' versioned pools, ' + audit.excluded_wrapped +
    ' wrapped or staked products. Excluded protocols are ' +
    'counted here, not hidden — the audit adds up: ' + audit.ranked + ' ranked + ' +
    audit.excluded + ' excluded = ' + audit.records_no_token + ' pre-token; ' +
    audit.records_no_token + ' pre-token + ' + audit.records_token + ' with a token = ' +
    audit.total + ' total. Three watchlist protocols are ranked even though the screening ' +
    'would leave them out — the watchlist is the floor: ' + audit.watchlist_floor.join(', ') + '.</p>';

  // ---- hash deep links (for the screenshots): #detail=<slug>, #filter=farm|thin|skip, #watch=1
  var hash = (location.hash || '').replace(/^#/, '');
  var params = {};
  hash.split('&').forEach(function (kv) {
    var p = kv.split('=');
    if (p[0]) params[p[0]] = decodeURIComponent(p[1] || '');
  });
  if (params.filter) {
    var f = params.filter.charAt(0).toUpperCase() + params.filter.slice(1).toLowerCase();
    state.verdict = f;
    document.getElementById('verdict').value = f;
  }
  if (params.watch) {
    state.watch = true;
    document.getElementById('watch').checked = true;
  }
  if (params.filter || params.watch) renderBoard();
  if (params.detail) openDetail(params.detail);
})();
