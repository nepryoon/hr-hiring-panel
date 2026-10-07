// Client for the Hiring Panel demo. Plain ES module, no dependencies.
// The page only drives the turn order and animates; every check and score is computed on the server.
// All values from the server are rendered with textContent, never as HTML.

const API = "/api/panel/turn";
const SVG_NS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);

const METRICS = [
  ["roleFit", "Role fit"],
  ["technicalDepth", "Technical depth"],
  ["growthPotential", "Growth potential"],
  ["evidenceStrength", "Evidence strength"],
  ["rampUp", "Ramp-up time"]
];
const KIND_LABELS = { opening: "Opening assessment", review: "Audit review", response: "Response to challenges", band: "Pay band", brief: "Closing brief" };
const STATUS = { accepted: ["ok", "Accepted"], unsupported: ["warn", "Unsupported"], struck: ["bad", "Struck from the record"] };
const ISSUE_LABELS = { unsupported: "unsupported", protected: "protected characteristic", weak: "weakly supported", inconsistent: "inconsistent" };
const PACE = { normal: 1, fast: 0.3 };

let config = null;
let agents = {};
let runToken = 0;
let running = false;
let skipping = false;
let lastMetrics = null;

// --- Small helpers ----------------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

const money = (n) => `£${Number(n).toLocaleString("en-GB")}`;
const moneyShort = (n) => `£${(n / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })}k`;
const speed = () => document.querySelector('input[name="speed"]:checked')?.value || "normal";
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function wait(ms) {
  if (skipping) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms * PACE[speed()]));
}

function scrollTranscript() {
  if (skipping) return;
  const list = $("transcript");
  list.scrollTop = list.scrollHeight;
}

// Simple geometric avatars, one glyph per agent.
const GLYPHS = {
  target: [["circle", { cx: 20, cy: 20, r: 9, fill: "none" }], ["circle", { cx: 20, cy: 20, r: 3.5 }]],
  code: [["path", { d: "M16 14l-6 6 6 6M24 14l6 6-6 6", fill: "none" }]],
  people: [["circle", { cx: 15.5, cy: 16, r: 3.5 }], ["circle", { cx: 25, cy: 16, r: 3.5 }], ["path", { d: "M9 29c0-4 3-7 6.5-7s6.5 3 6.5 7M19 29c0-4 2.6-7 6-7s6 3 6 7", fill: "none" }]],
  band: [["path", { d: "M11 28V20M17 28V14M23 28V17M29 28V11", fill: "none" }]],
  shield: [["path", { d: "M20 10l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z", fill: "none" }], ["path", { d: "M16.5 19.5l2.5 2.5 4.5-5", fill: "none" }]],
  gavel: [["path", { d: "M14 15l6-6 5 5-6 6zM19.5 17.5l7 7M11 30h12", fill: "none" }]]
};

function avatar(agent) {
  const root = svg("svg", { viewBox: "0 0 40 40", class: "avatar", "aria-hidden": "true" });
  root.append(svg("circle", { cx: 20, cy: 20, r: 18.5, fill: agent.colour, "fill-opacity": 0.14, stroke: agent.colour, "stroke-width": 1.5 }));
  const glyph = svg("g", { stroke: agent.colour, fill: agent.colour, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" });
  for (const [tag, attrs] of GLYPHS[agent.glyph] || []) glyph.append(svg(tag, attrs));
  root.append(glyph);
  return root;
}

// --- Configuration and choices ---------------------------------------------------------

function setMode(mode, model) {
  const badge = $("modeBadge");
  badge.className = `mode-badge ${mode}`;
  badge.textContent = mode === "live" ? "Live LLM panel" : "Recorded run";
  badge.title = mode === "live" ? `Each turn calls ${model || "the LLM"} live` : "Replaying a recorded live run through the same checks and scoring";
}

function choice(name, value, title, lines, checked) {
  const label = el("label", "choice");
  const input = el("input");
  input.type = "radio";
  input.name = name;
  input.value = value;
  input.checked = checked;
  const face = el("span", "face");
  face.append(el("b", "", title));
  lines.forEach((line) => face.append(el("span", "", line)));
  label.append(input, face);
  return label;
}

function selected(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value;
}

function renderDocs() {
  const candidate = config.candidates.find((c) => c.id === selected("candidate"));
  if (!candidate) return;
  const items = [];
  for (const [key, label] of Object.entries(config.documentLabels)) items.push(el("dt", "", label), el("dd", "", candidate.documents[key]));
  $("docList").replaceChildren(...items);
}

function renderRoster() {
  $("roster").replaceChildren(...Object.values(agents).map((agent) => {
    const li = el("li");
    li.dataset.agent = agent.id;
    li.append(avatar(agent), el("span", "", `${agent.name} · ${agent.role}`));
    return li;
  }));
}

function renderMetricBars() {
  $("metrics").replaceChildren(...METRICS.map(([key, label]) => {
    const row = el("div", "metric");
    row.dataset.metric = key;
    const head = el("div", "metric-head");
    head.append(el("span", "", label), el("b", "", "0"));
    const bar = el("div", "bar");
    bar.setAttribute("role", "meter");
    bar.setAttribute("aria-label", label);
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", "0");
    bar.append(el("i"));
    row.append(head, bar);
    return row;
  }));
}

async function loadConfig() {
  try {
    const res = await fetch(API, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    config = await res.json();
  } catch {
    $("roleChoices").replaceChildren(el("p", "small", "The demo API is unavailable right now. Please try again shortly."));
    $("modeBadge").textContent = "Unavailable";
    return;
  }
  agents = Object.fromEntries(config.agents.map((a) => [a.id, a]));
  setMode(config.mode, config.model);
  $("roleChoices").replaceChildren(...config.roles.map((role, i) =>
    choice("role", role.id, role.title, [`${role.level} · ${role.location}`, role.summary], i === 0)));
  $("candidateChoices").replaceChildren(...config.candidates.map((c, i) =>
    choice("candidate", c.id, c.name, [c.headline, `Synthetic profile: ${c.profile.toLowerCase()}`], i === 0)));
  $("candidateChoices").addEventListener("change", renderDocs);
  renderDocs();
  renderRoster();
  renderMetricBars();
  $("runButton").disabled = false;
}

// --- Live scoreboard -----------------------------------------------------------------

function animateNumber(node, from, to, suffix = "") {
  if (skipping || reducedMotion() || from === to) { node.textContent = `${to}${suffix}`; return; }
  const start = performance.now();
  const duration = 700;
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    node.textContent = `${Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)))}${suffix}`;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function updateMetrics(metrics) {
  for (const [key] of METRICS) {
    const row = document.querySelector(`.metric[data-metric="${key}"]`);
    const value = metrics[key];
    const before = lastMetrics ? lastMetrics[key] : 0;
    row.querySelector(".bar i").style.width = `${value}%`;
    row.querySelector(".bar").setAttribute("aria-valuenow", String(value));
    const label = row.querySelector(".metric-head b");
    if (key === "rampUp") label.textContent = `${value} · ${metrics.rampUpWeeks} wks`;
    else animateNumber(label, before, value);
    row.classList.remove("bump", "dip");
    if (value !== before) {
      void row.offsetWidth;
      row.classList.add(value > before ? "bump" : "dip");
    }
  }
  lastMetrics = metrics;
}

function updateCounters(c) {
  $("cMade").textContent = String(c.claimsMade);
  $("cAccepted").textContent = String(c.claimsAccepted);
  $("cUnsupported").textContent = String(c.unsupported);
  $("cStruck").textContent = String(c.struck);
}

function setSpeaker(agentId, round) {
  document.querySelectorAll("#roster li").forEach((li) => li.classList.toggle("on", li.dataset.agent === agentId));
  document.querySelectorAll(".round").forEach((node) => {
    const r = Number(node.dataset.round);
    node.classList.toggle("on", r === round);
    node.classList.toggle("done", round !== null && r < round);
  });
}

// --- Transcript ------------------------------------------------------------------------

function messageShell(agent, subtitle) {
  const li = el("li", "msg");
  li.style.setProperty("--c", agent.colour);
  const bubble = el("div", "bubble");
  const who = el("div", "who");
  who.append(el("b", "", agent.name), el("span", "", `${agent.role} · ${subtitle}`));
  bubble.append(who);
  li.append(avatar(agent), bubble);
  return { li, bubble };
}

function showTyping(agentId) {
  const agent = agents[agentId];
  const { li, bubble } = messageShell(agent, "thinking");
  li.classList.add("typing");
  bubble.replaceChildren(el("span", "", `${agent.name} is preparing a turn`));
  const dots = el("span", "dots");
  dots.append(el("i"), el("i"), el("i"));
  bubble.append(dots);
  $("transcript").append(li);
  scrollTranscript();
  return li;
}

function addSystemNote(text) {
  $("transcript").append(el("li", "system", text));
  scrollTranscript();
}

function claimPill(status) {
  const [kind, label] = STATUS[status];
  return el("span", `pill ${kind}`, label);
}

function claimNode(c) {
  const li = el("li", "claim");
  li.dataset.claim = c.id;
  const head = el("div", "claim-head");
  const score = el("span", "score", `${c.score}/5`);
  const status = el("span", "pill info", "checking quote…");
  head.append(el("b", "", `${c.id} · ${c.label}`), score, el("span", "pill", config.documentLabels[c.doc] || c.doc), status);
  li.append(head, el("q", "", c.quote));
  if (c.reason) li.append(el("div", "reason", c.reason));
  return { li, status };
}

async function renderClaims(bubble, claims) {
  if (!claims.length) return;
  const list = el("ul", "items");
  bubble.append(list);
  for (const c of claims) {
    const { li, status } = claimNode(c);
    list.append(li);
    scrollTranscript();
    await wait(380);
    status.replaceWith(claimPill(c.status));
    li.classList.add(c.status, "flash");
    if (c.status !== "accepted") li.append(el("div", "note", c.note));
    await wait(160);
  }
}

function renderSentences(bubble, sentences) {
  const p = el("p", "sentences");
  const struck = [];
  sentences.forEach((s, i) => {
    if (i) p.append(document.createTextNode(" "));
    const span = el("span", "sentence", s.text);
    p.append(span);
    if (s.struck) {
      p.append(el("span", "strike-label", s.struck));
      struck.push(span);
    }
  });
  bubble.append(p);
  return struck;
}

function renderChallenges(bubble, challenges) {
  if (!challenges.length) return;
  const list = el("ul", "items");
  for (const ch of challenges) {
    const li = el("li", "claim");
    const head = el("div", "claim-head");
    head.append(el("b", "", `Challenge to ${agents[ch.target].name}’s ${ch.claim} · ${ch.label}`), el("span", "pill warn", ISSUE_LABELS[ch.issue] || ch.issue));
    li.append(head);
    if (ch.note) li.append(el("div", "reason", ch.note));
    list.append(li);
    const target = document.querySelector(`.claim[data-claim="${ch.claim}"] .claim-head`);
    if (target && !target.querySelector(".challenged")) target.append(el("span", "pill warn challenged", "challenged"));
  }
  bubble.append(list);
}

async function renderRevisions(bubble, revisions) {
  if (!revisions.length) return;
  const list = el("ul", "items");
  bubble.append(list);
  for (const rv of revisions) {
    const li = el("li", "claim flash");
    const head = el("div", "claim-head");
    head.append(el("b", "", `Revised ${rv.claim} · ${rv.label}`), el("span", "score", `${rv.from}/5 → ${rv.to}/5`), el("span", `pill ${rv.status === "accepted" ? "info" : rv.status === "struck" ? "bad" : "warn"}`, rv.note));
    li.append(head);
    if (rv.reason) li.append(el("div", "reason", rv.reason));
    list.append(li);
    const original = document.querySelector(`.claim[data-claim="${rv.claim}"] .score`);
    if (original && rv.status !== "struck") original.textContent = `${rv.from}/5 → ${rv.to}/5`;
    scrollTranscript();
    await wait(450);
  }
}

// Code screens the documents before any agent speaks; struck passages are shown, then struck through.
async function renderScreening(passages) {
  const li = el("li", "system");
  li.append(el("b", "", passages.length
    ? `Document screen (code, before the debate): ${passages.length} ${passages.length === 1 ? "passage" : "passages"} struck from the record. Assessors see the redacted documents; only the Auditor sees the original.`
    : "Document screen (code, before the debate): no passages mention a protected characteristic."));
  const struck = [];
  if (passages.length) {
    const list = el("ul", "items");
    for (const p of passages) {
      const item = el("li", "claim struck");
      const head = el("div", "claim-head");
      head.append(el("span", "pill", p.label));
      const text = el("span", "sentence", p.text);
      item.append(head, text, el("span", "strike-label", p.struck));
      list.append(item);
      struck.push(text);
    }
    li.append(list);
  }
  $("transcript").append(li);
  scrollTranscript();
  await wait(500);
  struck.forEach((span) => span.classList.add("struck"));
  if (struck.length) await wait(700);
}

async function renderTurn(event) {
  if (event.documentScreening) await renderScreening(event.documentScreening);
  const agent = agents[event.agent];
  setSpeaker(event.agent, event.round);
  const { li, bubble } = messageShell(agent, `Round ${event.round} · ${KIND_LABELS[event.kind]}`);
  $("transcript").append(li);
  const struck = renderSentences(bubble, event.sentences);
  if (event.invalidReplies?.length) {
    bubble.append(el("span", "pill warn", `${event.invalidReplies.length} invalid ${event.invalidReplies.length === 1 ? "reply" : "replies"} rejected by the validator and retried`));
  }
  scrollTranscript();
  await wait(500);
  struck.forEach((span) => span.classList.add("struck"));
  if (struck.length) await wait(500);

  await renderClaims(bubble, event.claims);
  renderChallenges(bubble, event.challenges);
  await renderRevisions(bubble, event.revisions);
  if (event.kind === "band" && event.band) {
    const b = event.band;
    const line = el("div", "claim accepted");
    line.append(el("b", "", "Computed by code: "), document.createTextNode(`offer range ${money(b.floor)} to ${money(b.ceiling)}, recommended ${money(b.recommended)}.`));
    bubble.append(line);
  }
  for (const note of event.notes || []) bubble.append(el("p", "small", note));
  if (event.usage) bubble.append(el("p", "small", `${event.usage.promptTokens + event.usage.completionTokens} tokens`));
  updateMetrics(event.metrics);
  updateCounters(event.counters);
  scrollTranscript();
}

// --- Brief ------------------------------------------------------------------------------

function renderRadar(metrics) {
  const root = $("radar");
  const desc = root.querySelector("desc");
  root.replaceChildren(desc);
  root.setAttribute("viewBox", "0 0 460 300");
  const cx = 230, cy = 150, R = 100;
  const angle = (i) => (-90 + i * 72) * (Math.PI / 180);
  const point = (i, v) => [cx + Math.cos(angle(i)) * R * v / 100, cy + Math.sin(angle(i)) * R * v / 100];
  for (const ring of [25, 50, 75, 100]) {
    root.append(svg("polygon", { points: METRICS.map((_, i) => point(i, ring).join(",")).join(" "), fill: "none", stroke: "rgba(255,255,255,.12)" }));
  }
  METRICS.forEach(([key, label], i) => {
    const [x, y] = point(i, 100);
    root.append(svg("line", { x1: cx, y1: cy, x2: x, y2: y, stroke: "rgba(255,255,255,.12)" }));
    const [lx, ly] = point(i, 122);
    const anchor = Math.abs(lx - cx) < 10 ? "middle" : lx > cx ? "start" : "end";
    const text = svg("text", { x: lx, y: ly + (ly < cy ? -6 : 10), "text-anchor": anchor, "font-size": 14 });
    text.append(svg("tspan", { x: lx, dy: 0 }, label));
    const value = key === "rampUp" ? `${metrics[key]} (${metrics.rampUpWeeks} weeks)` : String(metrics[key]);
    text.append(svg("tspan", { x: lx, dy: 17, "font-weight": 700, fill: "#EAF0FF" }, value));
    root.append(text);
  });
  const shape = svg("polygon", { fill: "rgba(110,231,255,.22)", stroke: "#6EE7FF", "stroke-width": 2, "stroke-linejoin": "round" });
  const dots = METRICS.map(() => svg("circle", { r: 3.5, fill: "#6EE7FF" }));
  root.append(shape, ...dots);
  const draw = (t) => {
    const pts = METRICS.map(([key], i) => point(i, metrics[key] * t));
    shape.setAttribute("points", pts.map((p) => p.join(",")).join(" "));
    pts.forEach(([x, y], i) => { dots[i].setAttribute("cx", x); dots[i].setAttribute("cy", y); });
  };
  if (skipping || reducedMotion()) { draw(1); return; }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / 900);
    draw(1 - Math.pow(1 - t, 3));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderBand(band) {
  const root = $("band");
  const desc = root.querySelector("desc");
  root.replaceChildren(desc);
  const top = Math.max(band.p75, band.equityCap || 0);
  const lo = band.p25 - (top - band.p25) * 0.25;
  const hi = top + (top - band.p25) * 0.12;
  const x = (v) => 24 + ((v - lo) / (hi - lo)) * 352;
  const anchor = (px) => (px > 300 ? "end" : px < 100 ? "start" : "middle");
  root.append(svg("rect", { x: 24, y: 64, width: 352, height: 14, rx: 7, fill: "rgba(255,255,255,.06)" }));
  root.append(svg("rect", { x: x(band.p25), y: 64, width: x(band.p75) - x(band.p25), height: 14, fill: "rgba(167,139,250,.25)" }));
  root.append(svg("rect", { x: x(band.floor), y: 60, width: Math.max(2, x(band.ceiling) - x(band.floor)), height: 22, rx: 4, fill: "rgba(110,231,255,.30)", stroke: "#6EE7FF" }));
  for (const [key, label] of [["p25", "P25"], ["p50", "P50"], ["p75", "P75"]]) {
    const px = x(band[key]);
    root.append(svg("line", { x1: px, y1: 84, x2: px, y2: 92, stroke: "rgba(234,240,255,.6)" }));
    root.append(svg("text", { x: px, y: 107, "text-anchor": "middle", "font-size": 13 }, label));
    root.append(svg("text", { x: px, y: 124, "text-anchor": "middle", "font-size": 13, fill: "#EAF0FF" }, moneyShort(band[key])));
  }
  if (band.equityCap) {
    const px = x(band.equityCap);
    root.append(svg("line", { x1: px, y1: 50, x2: px, y2: 86, stroke: "#F87171", "stroke-dasharray": "4 3", "stroke-width": 1.5 }));
    root.append(svg("text", { x: px, y: 144, "text-anchor": anchor(px), "font-size": 13, fill: "#F87171" }, `Equity cap ${moneyShort(band.equityCap)}`));
  }
  const rx = x(band.recommended);
  root.append(svg("path", { d: `M${rx - 7} 44 L${rx + 7} 44 L${rx} 56 Z`, fill: "#FBBF24" }));
  root.append(svg("text", { x: rx, y: 34, "text-anchor": anchor(rx), "font-size": 14, "font-weight": 700, fill: "#FBBF24" }, `Recommended ${money(band.recommended)}`));

  const figures = [["Offer floor", band.floor], ["Recommended", band.recommended], ["Ceiling", band.ceiling]];
  $("offerFigures").replaceChildren(...figures.map(([label, value]) => {
    const span = el("span", "", `${label} `);
    span.append(el("b", "", money(value)));
    return span;
  }));
  $("bandFormula").textContent = `${band.formula}. ${band.level}, ${band.location}. ${band.source}.`;
}

function renderBrief(brief, model) {
  $("brief").hidden = false;
  const label = $("outcomeLabel");
  label.textContent = brief.outcome.label;
  label.className = `outcome-label ${brief.outcome.id}`;
  $("outcomeRule").textContent = brief.outcome.rule;
  $("outcomeNote").textContent = brief.outcome.overridden
    ? `The Chair suggested “${brief.outcome.chairSuggestion}”, but the code rule does not allow it on this evidence, so the outcome is “${brief.outcome.label}”.`
    : brief.outcome.chairSuggestion ? `The Chair suggested “${brief.outcome.chairSuggestion}”.` : "";
  renderRadar(brief.metrics);
  renderBand(brief.band);

  $("verifyList").replaceChildren(...(brief.gaps.length ? brief.gaps.map((g) => {
    const li = el("li", "", g.gap);
    li.append(el("span", "", `Suggested question: ${g.question}`));
    return li;
  }) : [el("li", "", "No evidence gaps against the role requirements. Verify the strongest claims in the usual way.")]));

  $("dissentList").replaceChildren(...(brief.dissent.length ? brief.dissent.map((d) => {
    const li = el("li", "", `${d.agents.map((id) => agents[id].name).join(" vs ")} · ${d.topic}`);
    li.append(el("span", "", d.note));
    return li;
  }) : [el("li", "", "No remaining disagreement was recorded.")]));

  const c = brief.counters;
  $("sMade").textContent = String(c.claimsMade);
  $("sAccepted").textContent = String(c.claimsAccepted);
  $("sUnsupported").textContent = String(c.unsupported);
  $("sStruck").textContent = String(c.struck);
  $("sTokens").textContent = brief.mode === "live" ? String(brief.usage.promptTokens + brief.usage.completionTokens) : "0";
  $("sMode").textContent = brief.mode === "live"
    ? `Live LLM panel (${model}) · ${brief.usage.llmTurns} LLM turns · ${brief.usage.promptTokens} prompt and ${brief.usage.completionTokens} completion tokens.`
    : `Recorded run${model ? ` (originally produced live by ${model})` : ""}: the same citation check, filter and scoring ran on the recorded content.`;

  document.querySelectorAll("#decisionActions button").forEach((b) => b.setAttribute("aria-pressed", "false"));
  $("decisionRecord").textContent = "";
  setSpeaker(null, 4);
  $("brief").scrollIntoView({ behavior: skipping || reducedMotion() ? "auto" : "smooth", block: "start" });
}

$("decisionActions").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-decision]");
  if (!button) return;
  document.querySelectorAll("#decisionActions button").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
  const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const panel = $("outcomeLabel").textContent;
  const differs = (button.dataset.decision === "Invite to interview") !== (panel === "Advance to interview");
  $("decisionRecord").textContent = `Recorded on this page at ${time}: “${button.dataset.decision}”. The panel advised “${panel}”.`
    + (differs ? " You departed from the panel’s advice; in a real process your reason would be logged with the decision." : "");
});

// --- Run loop: one request per turn, the next one prefetched while this one animates ------

async function requestTurn(body) {
  try {
    const res = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { httpError: data.error || `HTTP ${res.status}` };
    return data;
  } catch {
    return { httpError: "network error" };
  }
}

function resetView() {
  $("transcript").replaceChildren();
  $("brief").hidden = true;
  lastMetrics = null;
  renderMetricBars();
  updateCounters({ claimsMade: 0, claimsAccepted: 0, unsupported: 0, struck: 0 });
  setSpeaker(null, null);
}

async function run(roleId, candidateId, mode, notice) {
  const token = ++runToken;
  resetView();
  setMode(mode, config.model);
  if (notice) addSystemNote(notice);
  const order = config.turnOrder;
  let pending = requestTurn({ start: { roleId, candidateId, mode } });
  for (let i = 0; i < order.length; i++) {
    const typing = showTyping(order[i].agent);
    setSpeaker(order[i].agent, order[i].round);
    const [res] = await Promise.all([pending, wait(900)]);
    if (token !== runToken) return;
    typing.remove();
    if (res.fallback || res.httpError) {
      const reason = res.reason || `the panel service answered with an error (${res.httpError})`;
      if (mode === "live") return run(roleId, candidateId, "recorded", `Switched to the recorded run: ${reason.replace(/\.$/, "")}. The same checks and scoring run on the recorded content.`);
      addSystemNote(`The recorded run could not be loaded (${res.httpError || reason}). Please try again shortly.`);
      return;
    }
    setMode(res.mode, res.model);
    if (!res.done) pending = requestTurn({ state: res.state });
    await renderTurn(res.event);
    if (token !== runToken) return;
    if (res.done) {
      renderBrief(res.brief, res.model);
      return;
    }
    await wait(350);
  }
}

$("runForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (running || !config) return;
  running = true;
  skipping = false;
  $("runButton").disabled = true;
  $("skipButton").disabled = false;
  $("runStatus").textContent = "The panel is in session…";
  try {
    await run(selected("role"), selected("candidate"), config.mode);
  } finally {
    running = false;
    skipping = false;
    $("runButton").disabled = false;
    $("skipButton").disabled = true;
    $("runStatus").textContent = "";
  }
});

$("skipButton").addEventListener("click", () => {
  skipping = true;
  $("skipButton").disabled = true;
  $("runStatus").textContent = "Skipping to the brief…";
});

loadConfig();
