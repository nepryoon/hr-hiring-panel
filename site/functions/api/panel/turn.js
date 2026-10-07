// /functions/api/panel/turn.js
// GET: demo configuration (allow-listed roles and candidates, agents, mode).
// POST: run exactly one panel turn. The signed run state travels with each request and is
// re-validated before anything happens; there is no server-side session.

import { publicCatalogue } from "../../../config/panel/data.js";
import { TURN_ORDER, MAX_TURNS, verifyState } from "../../../config/panel/protocol.js";
import { FORMULA, THRESHOLDS } from "../../../config/panel/scoring.js";
import { resolveModel } from "../../../config/panel/llm.js";
import { runTurn, startState } from "../../../config/panel/engine.js";
import { jsonResponse, parseTurnRequest, recordingPath } from "../../../config/panel/http.js";

export function onRequestGet(context) {
  const live = Boolean(context.env.DEEPSEEK_API_KEY);
  return jsonResponse({
    ...publicCatalogue(),
    turnOrder: TURN_ORDER,
    maxTurns: MAX_TURNS,
    formula: FORMULA,
    thresholds: THRESHOLDS,
    mode: live ? "live" : "recorded",
    model: live ? resolveModel(context.env) : null
  });
}

// Recorded transcripts are static files next to the page, read through the Pages asset binding.
export function recordingLoader(context) {
  return async (roleId, candidateId) => {
    const url = new URL(recordingPath(roleId, candidateId), context.request.url);
    const res = context.env.ASSETS ? await context.env.ASSETS.fetch(url) : await fetch(url);
    return res.ok ? res.json() : null;
  };
}

export async function onRequestPost(context, deps = {}) {
  const env = context.env || {};
  const input = await parseTurnRequest(context.request);
  if (input.error) return jsonResponse({ error: input.error }, 400);

  let state;
  if (input.start) {
    const mode = input.start.mode || (env.DEEPSEEK_API_KEY ? "live" : "recorded");
    state = startState(input.start.roleId, input.start.candidateId, mode);
  } else {
    const verified = await verifyState(input.state, env);
    if (!verified.ok) return jsonResponse({ error: verified.error }, 400);
    state = input.state;
  }

  try {
    const result = await runTurn({ state, env, deps: { loadRecording: recordingLoader(context), ...deps } });
    if (result.error) return jsonResponse({ error: result.error }, 500);
    const { output, ...body } = result;
    return jsonResponse(body);
  } catch {
    return jsonResponse({ error: "The panel hit an unexpected error." }, 500);
  }
}
