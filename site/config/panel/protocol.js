// Debate protocol: fixed turn order, hard turn cap and the compact run state that travels with every
// request. There is no server-side session: the server signs the state and re-validates it each turn.

import { ROLES, CANDIDATES, AGENTS, requirementIds } from "./data.js";

export const TURN_ORDER = Object.freeze([
  { agent: "hm", round: 1, kind: "opening" },
  { agent: "tech", round: 1, kind: "opening" },
  { agent: "people", round: 1, kind: "opening" },
  { agent: "auditor", round: 2, kind: "review" },
  { agent: "hm", round: 2, kind: "response" },
  { agent: "tech", round: 2, kind: "response" },
  { agent: "people", round: 2, kind: "response" },
  { agent: "comp", round: 3, kind: "band" },
  { agent: "chair", round: 3, kind: "brief" }
]);

export const MAX_TURNS = TURN_ORDER.length;
export const MAX_CLAIMS = 40;
export const MODES = ["live", "recorded"];
const STATUSES = ["accepted", "unsupported", "struck"];
const ISSUES = ["unsupported", "protected", "weak", "inconsistent"];

export function turnAt(index) {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_TURNS) return null;
  return TURN_ORDER[index];
}

export function initialState(roleId, candidateId, mode) {
  return {
    v: 1,
    roleId,
    candidateId,
    mode,
    turn: 0,
    claims: [],
    said: [],
    challenges: [],
    questions: {},
    chairNotes: [],
    chairSuggestion: null,
    struckStatements: 0,
    usage: { promptTokens: 0, completionTokens: 0, llmTurns: 0 }
  };
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v, max) => typeof v === "string" && v.length <= max;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const onlyKeys = (obj, keys) => Object.keys(obj).every((k) => keys.includes(k));

// Structural validation: allow-listed IDs, types, sizes and consistency with the turn order.
export function validateState(state) {
  const fail = (error) => ({ ok: false, error });
  if (!isObj(state)) return fail("State must be an object.");
  const keys = ["v", "roleId", "candidateId", "mode", "turn", "claims", "said", "challenges", "questions", "chairNotes", "chairSuggestion", "struckStatements", "usage", "sig"];
  if (!onlyKeys(state, keys)) return fail("State has unexpected fields.");
  if (state.v !== 1) return fail("Unsupported state version.");
  if (!Object.hasOwn(ROLES, state.roleId)) return fail("Unknown role.");
  if (!Object.hasOwn(CANDIDATES, state.candidateId)) return fail("Unknown candidate.");
  if (!MODES.includes(state.mode)) return fail("Unknown mode.");
  if (!isInt(state.turn, 0, MAX_TURNS)) return fail("Turn out of range.");
  if (state.turn >= MAX_TURNS) return fail("The panel has already used all its turns.");

  const spoken = new Set(TURN_ORDER.slice(0, state.turn).map((t) => t.agent));
  if (!Array.isArray(state.claims) || state.claims.length > MAX_CLAIMS) return fail("Too many claims.");
  const ids = new Set();
  for (const c of state.claims) {
    if (!isObj(c) || !onlyKeys(c, ["id", "agent", "req", "score", "doc", "quote", "reason", "status", "note", "from", "round"])) return fail("Malformed claim.");
    if (!/^c\d{1,2}$/.test(c.id) || ids.has(c.id)) return fail("Bad claim ID.");
    ids.add(c.id);
    if (!spoken.has(c.agent) || !["hm", "tech", "people"].includes(c.agent)) return fail("Claim from an agent that has not spoken.");
    if (!requirementIds(state.roleId, c.agent).includes(c.req)) return fail("Claim targets an unknown requirement.");
    if (!isInt(c.score, 1, 5) || (c.from !== undefined && !isInt(c.from, 1, 5))) return fail("Bad claim score.");
    if (!isStr(c.quote, 300) || !isStr(c.reason, 300) || !isStr(c.note ?? "", 200)) return fail("Claim text too long.");
    if (!["cv", "cover", "interview"].includes(c.doc)) return fail("Bad claim document.");
    if (!STATUSES.includes(c.status) || !isInt(c.round, 1, 2)) return fail("Bad claim status.");
  }
  if (!Array.isArray(state.said) || state.said.length > state.turn) return fail("Bad transcript summary.");
  for (const s of state.said) {
    if (!isObj(s) || !onlyKeys(s, ["agent", "text"]) || !Object.hasOwn(AGENTS, s.agent) || !isStr(s.text, 500)) return fail("Bad transcript entry.");
  }
  if (!Array.isArray(state.challenges) || state.challenges.length > 6) return fail("Bad challenges.");
  for (const ch of state.challenges) {
    if (!isObj(ch) || !onlyKeys(ch, ["claim", "issue", "note"]) || !ids.has(ch.claim) || !ISSUES.includes(ch.issue) || !isStr(ch.note, 240)) return fail("Bad challenge.");
  }
  if (!isObj(state.questions) || Object.keys(state.questions).length > 8) return fail("Bad questions.");
  for (const [req, q] of Object.entries(state.questions)) {
    if (!requirementIds(state.roleId, "hm").includes(req) || !isStr(q, 240)) return fail("Bad question.");
  }
  if (!Array.isArray(state.chairNotes) || state.chairNotes.length > 4 || !state.chairNotes.every((n) => isStr(n, 240))) return fail("Bad chair notes.");
  if (state.chairSuggestion !== null && !["advance", "more_evidence"].includes(state.chairSuggestion)) return fail("Bad chair suggestion.");
  if (!isInt(state.struckStatements, 0, 200)) return fail("Bad counter.");
  const u = state.usage;
  if (!isObj(u) || !onlyKeys(u, ["promptTokens", "completionTokens", "llmTurns"]) || ![u.promptTokens, u.completionTokens, u.llmTurns].every((n) => isInt(n, 0, 1e7))) return fail("Bad usage.");
  return { ok: true };
}

// --- Signing ---------------------------------------------------------------------------
// The state carries agent text that later prompts reuse, so the server signs it (HMAC-SHA256) and
// refuses any state it did not produce. The key is derived from server-side secrets only.

const encoder = new TextEncoder();

function secretFor(env = {}) {
  if (env.PANEL_STATE_SECRET) return `panel-state:${env.PANEL_STATE_SECRET}`;
  if (env.DEEPSEEK_API_KEY) return `panel-state:${env.DEEPSEEK_API_KEY}`;
  return "panel-state:recorded-only";
}

async function hmac(env, payload) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secretFor(env)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function unsignedJson(state) {
  const { sig, ...rest } = state;
  return JSON.stringify(rest);
}

export async function signState(state, env) {
  const { sig, ...rest } = state;
  return { ...rest, sig: await hmac(env, unsignedJson(rest)) };
}

export async function verifyState(state, env) {
  const valid = validateState(state);
  if (!valid.ok) return valid;
  if (typeof state.sig !== "string" || !/^[0-9a-f]{64}$/.test(state.sig)) return { ok: false, error: "State is not signed." };
  const expected = await hmac(env, unsignedJson(state));
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ state.sig.charCodeAt(i);
  return diff === 0 ? { ok: true } : { ok: false, error: "State signature does not match: the state was altered." };
}
