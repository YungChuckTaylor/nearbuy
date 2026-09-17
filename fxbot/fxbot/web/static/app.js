/* fxbot dashboard — no build step, no framework. */

const state = {
  schema: null,
  values: {},
  dirty: {},
  status: null,
  insights: null,
  jobs: { list: [], running: null },
  pollTimers: [],
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ------------------------------------------------------------------ helpers */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || detail.detail || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

function toast(message, bad = false) {
  const el = $("#toast");
  el.textContent = message;
  el.className = "toast" + (bad ? " bad" : "");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), 4000);
}

const fmt = (v, digits = 2) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : Number(v).toFixed(digits);
const signed = (v, digits = 2) =>
  v === null || v === undefined ? "—" : (v >= 0 ? "+" : "") + Number(v).toFixed(digits);
const cls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");

function rows(table, headers, body) {
  const head = headers.length
    ? `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`
    : "";
  table.innerHTML = head + `<tbody>${body}</tbody>`;
}

/* --------------------------------------------------------------------- tabs */
$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.remove("active"));
    $$(".tabpage").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $(`#page-${tab.dataset.tab}`).classList.add("active");
    if (tab.dataset.tab === "params") loadSchema();
    if (tab.dataset.tab === "news") loadNews();
    if (tab.dataset.tab === "logs") { loadLogs(); startPolling(loadLogs, 4000); }
    if (tab.dataset.tab === "research") startPolling(loadJobs, 3000);
  });
});

function startPolling(fn, ms) {
  state.pollTimers.forEach(clearInterval);
  state.pollTimers = [];
  fn();
  state.pollTimers.push(setInterval(fn, ms));
}

/* ------------------------------------------------------------------ status */
async function loadHealth() {
  try {
    const h = await api("/api/health");
    $("#version").textContent = `v${h.version}`;
    $("#cfg-path").textContent = h.config_path;
    if (!h.auth_required) {
      const b = $("#banner");
      b.classList.remove("hidden");
      b.innerHTML =
        "⚠️ <b>No web token configured</b> — anyone who can reach this URL can change " +
        "parameters and place trades. Set <code>FXBOT_WEB_TOKEN</code> and restart. " +
        (h.has_deriv_token ? "" : "No Deriv token set: this instance is read-only / paper.");
    }
  } catch (e) {
    toast(`health: ${e.message}`, true);
  }
}

async function loadStatus() {
  try {
    const [s, insights] = await Promise.all([api("/api/status"), api("/api/insights")]);
    state.status = s;
    state.insights = insights;

    const modePill = $("#pill-mode");
    modePill.textContent = `mode: ${s.mode}`;
    modePill.className = "pill " + (s.mode === "live" ? "live" : "");

    const kill = $("#pill-kill");
    const stopped = !!s.state.kill_switch;
    kill.textContent = stopped ? `kill switch: ${s.state.kill_switch}` : "kill switch: clear";
    kill.className = "pill " + (stopped ? "stopped" : "good");

    $("#pill-balance").textContent =
      "balance: " + (s.balance !== null ? fmt(s.balance, 2) : `${fmt(s.paper_equity, 0)} (paper)`);
    $("#pill-day").textContent = `day P&L: ${signed(s.state.day_pnl)}`;
    $("#pill-positions").textContent = `open: ${s.state.open_positions}`;

    $("#kpi-equity").textContent = s.balance !== null ? fmt(s.balance, 2) : fmt(s.paper_equity, 0);
    $("#kpi-day").innerHTML = `<span class="${cls(s.state.day_pnl)}">${signed(s.state.day_pnl)}</span>`;
    $("#kpi-daypct").textContent = s.state.day_pnl_pct !== undefined ? `${signed(s.state.day_pnl_pct)}%` : "";
    $("#kpi-win").textContent = s.state.win_rate === null ? "—" : `${(s.state.win_rate * 100).toFixed(1)}%`;
    $("#kpi-trades").textContent = `${s.state.closed_trades} closed · realised ${signed(s.state.realised_pnl)}`;

    const cost = insights.cost_pct_of_risk;
    $("#kpi-cost").innerHTML = `<span class="${cost > 60 ? "neg" : cost > 35 ? "" : "pos"}">${cost}%</span>`;
    $("#kpi-costsub").textContent =
      `of risk per trade · stop ≈ ${insights.current_stop_pips} pips · break-even hit rate ${insights.break_even_win_rate}% (${insights.verdict})`;

    // positions
    const posBody = (s.positions || []).length
      ? s.positions.map((p) => `<tr>
          <td>${p.contract_id}</td><td>${p.symbol}</td>
          <td>${p.contract_type || ""}</td><td class="num">${fmt(p.stake)}</td>
          <td><button class="btn" data-close="${p.contract_id}">close</button></td></tr>`).join("")
      : `<tr><td class="muted">no open contracts</td></tr>`;
    rows($("#tbl-positions"),
      ["contract", "symbol", "type", "stake", ""], posBody);
    $$("#tbl-positions [data-close]").forEach((b) =>
      b.addEventListener("click", () => closePosition(b.dataset.close)));
    if (s.error) toast(`broker: ${s.error}`, true);
  } catch (e) {
    toast(`status: ${e.message}`, true);
  }
}

async function loadEquity() {
  try {
    const eq = await api("/api/equity");
    drawChart(eq.points, eq.start_equity);
    $("#kpi-dd").textContent = eq.points.length ? `max drawdown ${eq.max_drawdown_pct}%` : "";
  } catch (e) { /* non-fatal */ }
}

function drawChart(points, base) {
  const el = $("#equity-chart");
  if (!points || points.length < 2) {
    el.innerHTML = `<div class="muted" style="padding:20px">Not enough closed trades yet — run the bot or fetch data.</div>`;
    return;
  }
  const w = 1000, h = 180, pad = 8;
  const values = [base, ...points.map((p) => p.equity)];
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const x = (i) => pad + (i / (values.length - 1)) * (w - 2 * pad);
  const y = (v) => h - pad - ((v - min) / span) * (h - 2 * pad);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(values.length - 1).toFixed(1)},${h - pad} L${pad},${h - pad} Z`;
  const last = values[values.length - 1];
  const colour = last >= base ? "var(--green)" : "var(--red)";
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
     <path d="${area}" fill="${colour}" opacity="0.10"/>
     <path d="${line}" fill="none" stroke="${colour}" stroke-width="2"/>
     <line x1="0" x2="${w}" y1="${y(base).toFixed(1)}" y2="${y(base).toFixed(1)}"
           stroke="var(--line)" stroke-dasharray="4 4"/>
   </svg>`;
}

async function loadTrades() {
  try {
    const { trades } = await api("/api/trades?limit=25");
    const body = trades.length
      ? trades.slice().reverse().map((t) => `<tr>
          <td>${(t.closed_at || "").replace("T", " ").slice(0, 19)}</td>
          <td>${t.symbol || ""}</td>
          <td class="num">${fmt(t.stake)}</td>
          <td>${t.exit_reason || ""}</td>
          <td class="num ${cls(t.pnl)}">${signed(t.pnl)}</td></tr>`).join("")
      : `<tr><td class="muted">no closed trades yet</td></tr>`;
    rows($("#tbl-trades"), ["closed (UTC)", "symbol", "stake", "reason", "P&L"], body);
  } catch (e) { /* non-fatal */ }
}

/* ----------------------------------------------------------------- controls */
$("#btn-cycle").addEventListener("click", async () => {
  try {
    const r = await api("/api/control/cycle", { method: "POST", body: "{}" });
    toast(`cycle done (${r.dry_run ? "paper" : "LIVE"})`);
    console.log(r.summary);
    loadStatus(); loadTrades(); loadEquity();
  } catch (e) { toast(`cycle failed: ${e.message}`, true); }
});

$("#btn-kill").addEventListener("click", async () => {
  try { await api("/api/control/kill", { method: "POST", body: JSON.stringify({ reason: "dashboard" }) });
        toast("kill switch engaged"); loadStatus(); }
  catch (e) { toast(e.message, true); }
});
$("#btn-resume").addEventListener("click", async () => {
  try { await api("/api/control/resume", { method: "POST" }); toast("trading resumed"); loadStatus(); }
  catch (e) { toast(e.message, true); }
});

async function closePosition(id) {
  if (!confirm(`Close contract ${id}?`)) return;
  try { await api(`/api/positions/${id}/close`, { method: "POST" }); toast(`closed ${id}`); loadStatus(); }
  catch (e) { toast(e.message, true); }
}

/* ------------------------------------------------------------------ signals */
$("#btn-scan").addEventListener("click", async () => {
  const offline = $("#sig-offline").checked;
  $("#tbl-signals").innerHTML = `<tbody><tr><td class="muted">scanning…</td></tr></tbody>`;
  try {
    const { signals } = await api(`/api/signals?offline=${offline}`);
    const body = signals.map((s) => {
      if (s.error) return `<tr><td>${s.symbol}</td><td colspan="5" class="muted">${s.error}</td></tr>`;
      const d = s.decision;
      const side = d ? (d.side > 0 ? "LONG" : "SHORT") : "—";
      const tag = d
        ? (d.accepted ? `<span class="tag take">TAKE</span>` : `<span class="tag skip">SKIP</span>`)
        : `<span class="tag">no setup</span>`;
      return `<tr>
        <td>${s.symbol}</td>
        <td>${(s.bar || "").replace("T", " ").slice(5, 16)}</td>
        <td class="num">${fmt(s.close, 5)}</td>
        <td>${side}</td>
        <td>${d && d.proba !== null ? fmt(d.proba, 3) : "—"}</td>
        <td>${s.news_blocked ? `<span class="tag high">news blackout</span>` : "clear"}</td>
        <td>${tag} <span class="muted">${d ? d.reason : ""}</span></td></tr>`;
    }).join("");
    rows($("#tbl-signals"), ["symbol", "last bar", "close", "side", "P(win)", "news", "decision"], body);
  } catch (e) { toast(`scan failed: ${e.message}`, true); }
});

/* --------------------------------------------------------------- parameters */
async function loadSchema() {
  if (state.schema) return;
  const s = await api("/api/schema");
  state.schema = s;
  state.values = JSON.parse(JSON.stringify(s.values));
  renderParams();
}

function renderParams() {
  const host = $("#param-groups");
  host.innerHTML = state.schema.groups.map((group) => {
    const fields = state.schema.fields.filter((f) => f.group === group);
    return `<div class="group"><h4>${group}</h4><div class="fields">${
      fields.map(fieldHtml).join("")}</div></div>`;
  }).join("");
  $$("#param-groups input, #param-groups select").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.key;
      state.dirty[key] = input.type === "checkbox" ? input.checked : input.value;
      input.closest(".field").classList.toggle("dirty", true);
    });
  });
}

function fieldHtml(f) {
  const v = state.values[f.key];
  let control = "";
  if (f.type === "bool") {
    control = `<input type="checkbox" data-key="${f.key}" ${v ? "checked" : ""} />`;
  } else if (f.type === "select") {
    control = `<select data-key="${f.key}">${f.options.map((o) => {
      const value = typeof o === "object" ? o.value : o;
      const label = typeof o === "object" ? o.label : o;
      return `<option value="${value}" ${String(v) === String(value) ? "selected" : ""}>${label}</option>`;
    }).join("")}</select>`;
  } else if (f.type === "int" || f.type === "float") {
    control = `<input type="number" data-key="${f.key}" value="${v}"
      step="${f.step || (f.type === "int" ? 1 : 0.01)}"
      ${f.min !== undefined ? `min="${f.min}"` : ""} ${f.max !== undefined ? `max="${f.max}"` : ""} />`;
  } else {
    const text = Array.isArray(v) ? v.join(", ") : v;
    control = `<input type="text" data-key="${f.key}" value="${(text ?? "").toString().replace(/"/g, "&quot;")}" />`;
  }
  return `<div class="field">
      <label for="${f.key}">${f.label}</label>
      ${control}
      ${f.help ? `<div class="help">${f.help}</div>` : ""}
    </div>`;
}

$("#btn-save").addEventListener("click", async () => {
  if (!Object.keys(state.dirty).length) { toast("nothing to save"); return; }
  try {
    const r = await api("/api/config", {
      method: "PUT",
      body: JSON.stringify({ changes: state.dirty }),
    });
    state.values = r.values;
    state.dirty = {};
    $$(".field").forEach((f) => f.classList.remove("dirty"));
    $("#param-warnings").textContent = (r.warnings || []).join(" · ");
    toast(`saved ${r.saved} parameter(s)`);
    loadStatus();
  } catch (e) { toast(`save failed: ${e.message}`, true); }
});

$("#btn-revert").addEventListener("click", () => {
  state.dirty = {};
  state.values = JSON.parse(JSON.stringify(state.schema.values));
  renderParams();
  toast("reverted unsaved edits");
});

$("#btn-reset").addEventListener("click", async () => {
  if (!confirm("Reset every parameter to the shipped defaults?")) return;
  const r = await api("/api/config/reset", { method: "POST" });
  state.values = r.values;
  state.schema.values = JSON.parse(JSON.stringify(r.values));
  state.dirty = {};
  renderParams();
  toast("defaults restored");
});

/* ----------------------------------------------------------------- research */
$$("[data-job]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    try {
      const r = await api(`/api/jobs/${btn.dataset.job}`, { method: "POST" });
      $("#job-output").textContent = "started…\n";
      pollJob(r.job.id);
      toast(`${btn.dataset.job} started`);
    } catch (e) { toast(e.message, true); }
  });
});

function pollJob(id) {
  const timer = setInterval(async () => {
    try {
      const job = await api(`/api/jobs/${id}`);
      $("#job-output").textContent = (job.logs || []).join("\n") || "running…";
      if (job.status === "done") {
        clearInterval(timer);
        renderJobResult(job);
        toast(`${job.kind} finished`);
      } else if (job.status === "error") {
        clearInterval(timer);
        $("#job-output").textContent += `\n\nERROR: ${job.error}`;
        toast(`${job.kind} failed`, true);
      }
    } catch (e) { clearInterval(timer); toast(e.message, true); }
  }, 1500);
}

function renderJobResult(job) {
  const r = job.result || {};
  if (r.rows) {
    const body = r.rows.map((row) => `<tr>
        <td>${row.symbol}</td><td>${row.variant || "take_all"}</td><td class="num">${row.n_trades}</td>
        <td class="num">${fmt(row.win_rate ? row.win_rate * 100 : null, 1)}%</td>
        <td class="num ${cls(row.expectancy_r)}">${signed(row.expectancy_r, 3)}R</td>
        <td class="num">${fmt(row.t_stat, 2)}</td>
        <td class="num ${cls(row.total_return_pct)}">${signed(row.total_return_pct, 1)}%</td>
        <td class="num neg">${fmt(row.max_drawdown_pct, 1)}%</td>
        <td class="num">${fmt(row.commission_pct_of_risk, 1)}%</td></tr>`).join("");
    rows($("#tbl-backtest"),
      ["symbol", "variant", "trades", "win %", "expectancy", "t-stat", "return", "max DD", "cost % of risk"], body);
  }
  if (r.comparison) {
    const body = r.comparison.map((c) => `<tr>
        <td>${c.variant}</td><td class="num">${c.n_trades}</td>
        <td class="num">${fmt(c.win_rate ? c.win_rate * 100 : null, 1)}%</td>
        <td class="num ${cls(c.expectancy_r)}">${signed(c.expectancy_r, 3)}R</td>
        <td class="num">${fmt(c.t_stat, 2)}</td>
        <td class="num">${fmt(c.profit_factor, 2)}</td>
        <td class="num ${cls(c.total_return_pct)}">${signed(c.total_return_pct, 1)}%</td>
        <td class="num neg">${fmt(c.max_drawdown_pct, 1)}%</td></tr>`).join("");
    rows($("#tbl-comparison"),
      ["variant", "trades", "win %", "expectancy", "t-stat", "PF", "return", "max DD"], body);
  }
  if (r.verdict) {
    $("#job-verdict").textContent = `verdict: ${r.verdict}`;
    toast(r.verdict);
  }
  if (r.error) toast(r.error, true);
  if (r.folds) console.log("folds", r.folds);
}

async function loadJobs() {
  try {
    state.jobs = await api("/api/jobs");
  } catch (e) { /* ignore */ }
}

/* --------------------------------------------------------------------- news */
async function loadNews() {
  try {
    const n = await api("/api/news?limit=20");
    const symBody = Object.entries(n.symbols).map(([symbol, s]) => `<tr>
        <td>${symbol}</td>
        <td>${s.blocked ? `<span class="tag high">blocked</span>` : `<span class="tag take">clear</span>`}</td>
        <td class="muted">${s.reason || (s.should_close ? `close: ${s.close_reason}` : "")}</td></tr>`).join("");
    rows($("#tbl-news-symbols"), ["symbol", "entries", ""], symBody);

    const evBody = n.events.length ? n.events.map((e) => {
      const mins = e.in_minutes;
      const when = mins < 0 ? `${Math.abs(mins).toFixed(0)} min ago`
                            : `in ${mins < 90 ? mins.toFixed(0) + " min" : (mins / 60).toFixed(1) + " h"}`;
      return `<tr>
        <td>${(e.time || "").replace("T", " ").slice(0, 16)} UTC</td>
        <td>${e.currency}</td>
        <td>${e.name}${e.approx ? ' <span class="muted">(approx)</span>' : ""}</td>
        <td><span class="tag ${e.impact >= 3 ? "high" : e.impact === 2 ? "medium" : "low"}">${
          e.impact >= 3 ? "high" : e.impact === 2 ? "medium" : "low"}</span></td>
        <td>${when}</td></tr>`;
    }).join("") : `<tr><td class="muted">no events — calendar empty or disabled</td></tr>`;
    rows($("#tbl-news"), ["time (UTC)", "ccy", "event", "impact", "when"], evBody);
    if (n.error) toast(`calendar: ${n.error}`, true);
  } catch (e) { toast(`news: ${e.message}`, true); }
}

$("#btn-news-refresh").addEventListener("click", async () => {
  const r = await api("/api/news/refresh", { method: "POST" });
  toast(`calendar loaded: ${r.count} event(s)`);
  loadNews();
});

$("#btn-news-add").addEventListener("click", async () => {
  const payload = {
    time: $("#ev-time").value,
    currency: $("#ev-currency").value,
    name: $("#ev-name").value,
    impact: Number($("#ev-impact").value),
  };
  if (!payload.time || !payload.name) { toast("time and name are required", true); return; }
  try {
    await api("/api/news/add", { method: "POST", body: JSON.stringify(payload) });
    toast("event added");
    $("#ev-time").value = $("#ev-name").value = "";
    loadNews();
  } catch (e) { toast(e.message, true); }
});

/* --------------------------------------------------------------------- logs */
async function loadLogs() {
  try {
    const { lines } = await api("/api/logs?limit=200");
    const el = $("#log-output");
    el.textContent = lines.join("\n") || "no log output yet";
    el.scrollTop = el.scrollHeight;
  } catch (e) { /* ignore */ }
}

/* --------------------------------------------------------------------- boot */
(async function boot() {
  await loadHealth();
  await loadStatus();
  loadEquity();
  loadTrades();
  loadNews();
  setInterval(loadStatus, 20000);
  setInterval(loadTrades, 30000);
})();
