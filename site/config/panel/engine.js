// Turn engine: asks one agent for one turn (live LLM or recorded transcript), validates the reply,
// applies the guardrails and recomputes every score. Live and recorded turns run through the same code.

import { CANDIDATES, DOCUMENT_LABELS, requirementIds, requirementLabel } from "./data.js";
import { checkCitation, findProtected, screenMessage, screenDocuments, checkFigures } from "./guardrails.js";
import { computeMetrics, auditCounters, computeBand, bandFigures, findGaps, findDissent, decideOutcome, OUTCOMES } from "./scoring.js";
import { TURN_ORDER, MAX_TURNS, MAX_CLAIMS, turnAt, initialState, signState } from "./protocol.js";
import { callLlm, systemPrompt, userPrompt, resolveModel, parseJson, MAX_TOKENS } from "./llm.js";

const ISSUES = ["unsupported", "protected", "weak", "inconsistent"];
const LIMITS = { opening: { hm: 6, tech: 4, people: 4 }, newClaims: 2, revisions: 4, challenges: 5, dissent: 3, questions: 8 };

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const asScore = (v) => {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) && Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
};

function validateClaims(list, turn, state, max, errors) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) { errors.push("claims must be an array"); return []; }
  const allowed = requirementIds(state.roleId, turn.agent);
  return list.slice(0, max).flatMap((c, i) => {
    if (!isObj(c)) { errors.push(`claim ${i + 1} is not an object`); return []; }
    const score = asScore(c.score);
    if (!allowed.includes(c.req)) { errors.push(`claim ${i + 1}: req must be one of ${allowed.join(", ")}`); return []; }
    if (score === null) { errors.push(`claim ${i + 1}: score must be an integer from 1 to 5`); return []; }
    if (!text(c.quote, 400)) { errors.push(`claim ${i + 1}: quote is required`); return []; }
    if (!Object.hasOwn(DOCUMENT_LABELS, c.doc)) { errors.push(`claim ${i + 1}: doc must be cv, cover or interview`); return []; }
    return [{ req: c.req, score, doc: c.doc, quote: text(c.quote, 300), reason: text(c.reason, 300) }];
  });
}

// Structural validation of one agent reply. Anything malformed makes the turn invalid.
export function validateOutput(turn, output, state) {
  const errors = [];
  if (!isObj(output)) return { ok: false, errors: ["reply must be a JSON object"] };
  const message = text(output.message, 900);
  if (!message) errors.push("message is required");
  const value = { message };

  if (turn.kind === "opening") {
    value.claims = validateClaims(output.claims, turn, state, LIMITS.opening[turn.agent], errors);
  } else if (turn.kind === "review") {
    const ids = new Set(state.claims.map((c) => c.id));
    const list = Array.isArray(output.challenges) ? output.challenges : output.challenges === undefined ? [] : null;
    if (!list) errors.push("challenges must be an array");
    value.challenges = (list || []).slice(0, LIMITS.challenges).flatMap((ch, i) => {
      if (!isObj(ch) || !ids.has(ch.claim)) { errors.push(`challenge ${i + 1}: claim must be an existing claim ID`); return []; }
      return [{ claim: ch.claim, issue: ISSUES.includes(ch.issue) ? ch.issue : "weak", note: text(ch.note, 240) }];
    });
  } else if (turn.kind === "response") {
    const own = new Set(state.claims.filter((c) => c.agent === turn.agent).map((c) => c.id));
    const list = Array.isArray(output.revisions) ? output.revisions : output.revisions === undefined ? [] : null;
    if (!list) errors.push("revisions must be an array");
    value.revisions = (list || []).slice(0, LIMITS.revisions).flatMap((rv, i) => {
      const score = isObj(rv) ? asScore(rv.score) : null;
      if (!isObj(rv) || !own.has(rv.claim)) { errors.push(`revision ${i + 1}: claim must be one of your own claim IDs`); return []; }
      if (score === null) { errors.push(`revision ${i + 1}: score must be an integer from 1 to 5`); return []; }
      return [{ claim: rv.claim, score, reason: text(rv.reason, 300) }];
    });
    value.claims = validateClaims(output.claims, turn, state, LIMITS.newClaims, errors);
  } else if (turn.kind === "brief") {
    if (!Object.hasOwn(OUTCOMES, output.recommendation)) errors.push("recommendation must be \"advance\" or \"more_evidence\"");
    value.recommendation = output.recommendation;
    value.dissent = Array.isArray(output.dissent) ? output.dissent.map((d) => text(d, 240)).filter(Boolean).slice(0, LIMITS.dissent) : [];
    const reqs = requirementIds(state.roleId, "hm");
    value.questions = Array.isArray(output.questions)
      ? output.questions.filter((q) => isObj(q) && reqs.includes(q.req) && text(q.question, 240)).slice(0, LIMITS.questions).map((q) => ({ req: q.req, question: text(q.question, 240) }))
      : [];
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

// --- Applying a validated turn ------------------------------------------------------------

function classify(claim, documents) {
  const hit = findProtected(`${claim.reason} ${claim.quote}`);
  if (hit) return { status: "struck", note: `Struck: relies on ${hit.label} (“${hit.term}”)` };
  const cite = checkCitation(claim.quote, documents, claim.doc, DOCUMENT_LABELS);
  if (!cite.ok) return { status: "unsupported", note: cite.reason };
  return { status: "accepted", note: `Verified in ${DOCUMENT_LABELS[cite.doc]}` };
}

function displayClaim(state, c) {
  return { id: c.id, agent: c.agent, req: c.req, doc: c.doc, label: requirementLabel(state.roleId, c.req), score: c.score, from: c.from, quote: c.quote, reason: c.reason, status: c.status, note: c.note };
}

export function applyTurn(prev, turn, value) {
  const state = structuredClone(prev);
  const documents = CANDIDATES[state.candidateId].documents;
  let sentences = screenMessage(value.message, turn.agent);
  const event = { index: state.turn, agent: turn.agent, round: turn.round, kind: turn.kind, claims: [], revisions: [], challenges: [], notes: [] };

  if (state.turn === 0) {
    event.documentScreening = screenDocuments(documents).passages.map((p) => ({ ...p, label: DOCUMENT_LABELS[p.doc] }));
    state.struckStatements += event.documentScreening.length;
  }

  for (const claim of value.claims || []) {
    if (state.claims.length >= MAX_CLAIMS) break;
    const c = { id: `c${state.claims.length + 1}`, agent: turn.agent, ...claim, ...classify(claim, documents), round: turn.round };
    state.claims.push(c);
    event.claims.push(displayClaim(state, c));
  }

  for (const rv of value.revisions || []) {
    const c = state.claims.find((x) => x.id === rv.claim);
    const hit = findProtected(rv.reason);
    if (hit) {
      state.struckStatements += 1;
      event.revisions.push({ claim: c.id, label: requirementLabel(state.roleId, c.req), from: c.score, to: rv.score, reason: rv.reason, status: "struck", note: `Revision struck: relies on ${hit.label} (“${hit.term}”)` });
      continue;
    }
    if (rv.score === c.score) continue;
    event.revisions.push({ claim: c.id, label: requirementLabel(state.roleId, c.req), from: c.score, to: rv.score, reason: rv.reason, status: c.status, note: c.status === "accepted" ? "Score revised" : `Revised, but still excluded (${c.status})` });
    if (c.from === undefined) c.from = c.score;
    c.score = rv.score;
  }

  if (turn.kind === "review") {
    state.challenges = value.challenges;
    event.challenges = value.challenges.map((ch) => {
      const c = state.claims.find((x) => x.id === ch.claim);
      return { ...ch, target: c.agent, label: requirementLabel(state.roleId, c.req) };
    });
  }

  const metrics = computeMetrics(state.roleId, state.claims);
  if (turn.kind === "band" || turn.kind === "brief") {
    event.band = computeBand(state.roleId, metrics.roleFit);
    if (turn.kind === "band") sentences = checkFigures(sentences, bandFigures(event.band));
  }

  if (turn.kind === "brief") {
    state.chairSuggestion = value.recommendation;
    for (const note of value.dissent) {
      if (findProtected(note)) state.struckStatements += 1;
      else state.chairNotes.push(note);
    }
    for (const q of value.questions) {
      if (findProtected(q.question)) { state.struckStatements += 1; event.notes.push(`A suggested question for ${requirementLabel(state.roleId, q.req)} was struck and replaced with the standard question.`); }
      else state.questions[q.req] = q.question;
    }
  }

  state.struckStatements += sentences.filter((s) => s.struck).length;
  const kept = sentences.filter((s) => !s.struck).map((s) => s.text).join(" ").slice(0, 500);
  state.said.push({ agent: turn.agent, text: kept });
  state.turn += 1;

  event.sentences = sentences;
  event.metrics = metrics;
  event.counters = auditCounters(state.claims, state.struckStatements);
  return { state, event };
}

export function buildBrief(state) {
  const metrics = computeMetrics(state.roleId, state.claims);
  const gaps = findGaps(state.roleId, state.claims, state.questions);
  return {
    roleId: state.roleId,
    candidateId: state.candidateId,
    mode: state.mode,
    metrics,
    band: computeBand(state.roleId, metrics.roleFit),
    gaps,
    dissent: findDissent(state.roleId, state.claims, state.challenges, state.chairNotes),
    outcome: decideOutcome(metrics, gaps, state.chairSuggestion),
    counters: auditCounters(state.claims, state.struckStatements),
    claims: state.claims.map((c) => displayClaim(state, c)),
    usage: state.usage
  };
}

// --- One turn per request -------------------------------------------------------------

async function liveOutput(turn, state, env, deps) {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) return { fallback: "No LLM key is configured." };
  const metrics = computeMetrics(state.roleId, state.claims);
  const extra = { metrics, band: computeBand(state.roleId, metrics.roleFit), gaps: findGaps(state.roleId, state.claims) };
  const messages = [
    { role: "system", content: systemPrompt(turn) },
    { role: "user", content: userPrompt(turn, state, extra) }
  ];
  const usage = { promptTokens: 0, completionTokens: 0, calls: 0 };
  const invalid = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await callLlm({ apiKey, model: resolveModel(env), messages, maxTokens: MAX_TOKENS[turn.kind], fetchImpl: deps.fetchImpl, sleep: deps.sleep });
    if (!reply.ok) return { fallback: `The LLM provider was unavailable (${reply.error}).`, usage };
    usage.promptTokens += reply.usage.promptTokens;
    usage.completionTokens += reply.usage.completionTokens;
    usage.calls += 1;
    const parsed = parseJson(reply.content);
    const check = parsed ? validateOutput(turn, parsed, state) : { ok: false, errors: ["reply was not valid JSON"] };
    if (check.ok) return { output: parsed, value: check.value, usage, invalid };
    invalid.push(check.errors.slice(0, 4).join("; "));
    messages.push({ role: "assistant", content: reply.content.slice(0, 1500) });
    messages.push({ role: "user", content: `Your reply was rejected: ${check.errors.slice(0, 4).join("; ")}. Reply again with one valid JSON object.` });
  }
  return { fallback: "The agent returned an invalid turn twice.", usage };
}

async function recordedOutput(turn, state, deps) {
  const recording = await deps.loadRecording(state.roleId, state.candidateId);
  const output = recording?.turns?.[state.turn]?.output;
  if (!output || recording.turns[state.turn].agent !== turn.agent) return { error: "The recorded transcript is missing this turn." };
  const check = validateOutput(turn, output, state);
  if (!check.ok) return { error: "The recorded transcript failed validation." };
  return { output, value: check.value, usage: null, invalid: recording.turns[state.turn].invalidReplies || [], model: recording.model };
}

// state must already be verified (or freshly created). Returns the JSON body for the page.
export async function runTurn({ state, env = {}, deps = {} }) {
  const turn = turnAt(state.turn);
  if (!turn) return { error: "The panel has already used all its turns." };
  const result = state.mode === "live" ? await liveOutput(turn, state, env, deps) : await recordedOutput(turn, state, deps);
  if (result.error) return { error: result.error };
  if (result.fallback) return { fallback: true, reason: result.fallback };

  const { state: next, event } = applyTurn(state, turn, result.value);
  if (result.usage) {
    next.usage.promptTokens += result.usage.promptTokens;
    next.usage.completionTokens += result.usage.completionTokens;
    next.usage.llmTurns += 1;
  }
  event.invalidReplies = result.invalid;
  event.usage = result.usage ? { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens } : null;
  const done = next.turn >= MAX_TURNS;
  return {
    mode: state.mode,
    model: state.mode === "live" ? resolveModel(env) : result.model || null,
    event,
    done,
    nextAgent: done ? null : TURN_ORDER[next.turn].agent,
    brief: done ? buildBrief(next) : null,
    state: await signState(next, env),
    output: result.output
  };
}

export function startState(roleId, candidateId, mode) {
  return initialState(roleId, candidateId, mode);
}
