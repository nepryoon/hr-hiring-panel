// Runs the live panel for every role and candidate pair and saves each validated transcript as JSON.
// Usage: DEEPSEEK_API_KEY=... node scripts/record-panel.mjs [roleId--candidateId ...]
// The key is read from the environment only and is never printed or written anywhere.

import { writeFile } from "node:fs/promises";
import { ROLES, CANDIDATES } from "../site/config/panel/data.js";
import { runTurn, startState, buildBrief } from "../site/config/panel/engine.js";
import { resolveModel } from "../site/config/panel/llm.js";
import { TURN_ORDER } from "../site/config/panel/protocol.js";

const env = { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, PANEL_LLM_MODEL: process.env.PANEL_LLM_MODEL };
if (!env.DEEPSEEK_API_KEY) {
  console.error("DEEPSEEK_API_KEY is not set.");
  process.exit(1);
}
const only = process.argv.slice(2);
const OUT = new URL("../site/demos/hiring-panel/recordings/", import.meta.url);

async function recordPair(roleId, candidateId) {
  let state = startState(roleId, candidateId, "live");
  const turns = [];
  let invalidReplies = 0;
  while (turns.length < TURN_ORDER.length) {
    const result = await runTurn({ state, env });
    if (result.fallback || result.error) return { ok: false, reason: result.reason || result.error, at: turns.length };
    invalidReplies += result.event.invalidReplies.length;
    turns.push({ agent: result.event.agent, round: result.event.round, kind: result.event.kind, output: result.output, usage: result.event.usage, invalidReplies: result.event.invalidReplies });
    state = result.state;
  }
  const brief = buildBrief(state);
  return { ok: true, invalidReplies, recording: {
    synthetic: true,
    note: "Recorded live panel run on synthetic data. Replayed through the same citation check, filter and scoring code.",
    roleId,
    candidateId,
    model: resolveModel(env),
    recordedAt: new Date().toISOString().slice(0, 10),
    turns,
    summary: { counters: brief.counters, metrics: brief.metrics, outcome: brief.outcome.label, usage: brief.usage }
  } };
}

for (const roleId of Object.keys(ROLES)) {
  for (const candidateId of Object.keys(CANDIDATES)) {
    const key = `${roleId}--${candidateId}`;
    if (only.length && !only.includes(key)) continue;
    let result;
    for (let attempt = 1; attempt <= 3; attempt++) {
      result = await recordPair(roleId, candidateId);
      if (result.ok) break;
      console.log(`${key}: attempt ${attempt} fell back at turn ${result.at} (${result.reason})`);
    }
    if (!result.ok) { console.log(`${key}: FAILED`); continue; }
    await writeFile(new URL(`${key}.json`, OUT), JSON.stringify(result.recording, null, 2) + "\n");
    const s = result.recording.summary;
    for (const t of result.recording.turns) if (t.invalidReplies.length) console.log(`  invalid ${t.agent}/${t.kind}: ${t.invalidReplies.join(" || ")}`);
    console.log(`${key}: ${s.outcome} | ${JSON.stringify(s.counters)} | ${JSON.stringify(s.metrics)} | tokens ${s.usage.promptTokens}+${s.usage.completionTokens} | invalid replies ${result.invalidReplies}`);
  }
}
