// LLM client and prompts for the Hiring Panel: DeepSeek through its OpenAI-compatible chat completions API.
// Prompts are built on the server from allow-listed data and the validated run state; no visitor text.

import { screenDocuments } from "./guardrails.js";
import { COMPANY, AGENTS, ROLES, CANDIDATES, DOCUMENT_LABELS, requirementIds, requirementLabel } from "./data.js";

export const DEFAULT_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_MODEL = "deepseek-flash";
const MODEL_PATTERN = /^[A-Za-z0-9._/:-]{1,80}$/;

export const MAX_TOKENS = { opening: 650, review: 450, response: 450, band: 220, brief: 550 };

export function resolveModel(env = {}) {
  const override = typeof env.PANEL_LLM_MODEL === "string" ? env.PANEL_LLM_MODEL.trim() : "";
  return MODEL_PATTERN.test(override) ? override : DEFAULT_MODEL;
}

const SHARED_RULES = [
  "Rules checked by code after you answer:",
  "- Every claim needs a short exact quote (5 to 25 words) copied verbatim from one candidate document, and doc must name that document (cv, cover or interview). Claims whose quote is not found in the named document are rejected and do not count.",
  "- Never refer to or reason from age, gender, family or caring responsibilities, career breaks, nationality, ethnicity, religion, health, appearance, the candidate's name or previous pay. Such statements are struck from the record.",
  "- Scores are integers from 1 (weak evidence) to 5 (strong evidence). Code computes every total and the pay band; you never compute them.",
  "- Plain British English, no markdown. Answer with one JSON object only."
].join("\n");

const INSTRUCTIONS = {
  opening: {
    hm: "Opening assessment. Judge fit against each role requirement. Make at most one claim per requirement, only where the documents give evidence; skip a requirement with no evidence rather than guess.",
    tech: "Opening assessment. Judge the depth of technical skills and the strength of the evidence, only for the technical requirements (at most one claim each). Be sceptical: enthusiasm, reading or watching others is not evidence of skill.",
    people: "Opening assessment. Judge collaboration, growth potential and onboarding needs, with at most four claims. Use req \"collaboration\", \"growth\" or a non-technical requirement id. In the message, say what onboarding support would help this person ramp up."
  },
  review: "Review every claim so far. Panellists citing the same evidence through their own lens is expected, not duplication. Challenge claims that are unsupported, weakly supported (score higher than the quote justifies), inconsistent between panellists, or that touch a protected characteristic. Also name any passage in the documents the panel must disregard, such as remarks about age or family. You may name protected characteristics in order to flag them.",
  response: "Answer the Auditor's challenges to your own claims. Lower or raise a score only where the evidence justifies a different score, keeping the reason short; never lower a score just to withdraw a claim. You may add up to two new claims with exact quotes, for example to replace a rejected one. If nothing was challenged, confirm your position briefly.",
  band: "Explain the offer band computed by the code to the panel in under 80 words: where the recommended figure sits and why the ceiling is where it is. Use only the figures given, written like £85,000. Do not mention or ask about previous pay.",
  brief: "Close the debate for the human decision-maker in under 100 words: summarise the evidence, say where panellists still disagree, and suggest an outcome. Then give one interview question for each listed evidence gap, worded as a gap in the evidence, never as a judgement of the person. The panel never rejects and never decides."
};

const FORMATS = {
  opening: '{"message": "under 90 words", "claims": [{"req": "r1", "score": 4, "doc": "cv", "quote": "exact words from that document", "reason": "under 25 words"}]}',
  review: '{"message": "under 90 words", "challenges": [{"claim": "c2", "issue": "unsupported|protected|weak|inconsistent", "note": "under 30 words"}]}',
  response: '{"message": "under 70 words", "revisions": [{"claim": "c2", "score": 3, "reason": "under 25 words"}], "claims": []}',
  band: '{"message": "under 80 words"}',
  brief: '{"message": "under 100 words", "recommendation": "advance|more_evidence", "dissent": ["under 30 words"], "questions": [{"req": "r2", "question": "under 30 words"}]}'
};

export function systemPrompt(turn) {
  const agent = AGENTS[turn.agent];
  const instruction = typeof INSTRUCTIONS[turn.kind] === "string" ? INSTRUCTIONS[turn.kind] : INSTRUCTIONS[turn.kind][turn.agent];
  return [
    `You are ${agent.name}, the ${agent.role} on a panel of AI agents reviewing a synthetic candidate for ${COMPANY}.`,
    "The panel prepares decision support for a human. It never decides and never rejects.",
    SHARED_RULES,
    `Your task (round ${turn.round}): ${instruction}`,
    `JSON format: ${FORMATS[turn.kind]}`
  ].join("\n");
}

function claimLine(state, c) {
  const who = AGENTS[c.agent].name;
  const revised = c.from !== undefined ? ` (revised from ${c.from})` : "";
  return `${c.id} ${who} ${c.req} ${requirementLabel(state.roleId, c.req)}: ${c.score}/5${revised} [${c.status}] "${c.quote.slice(0, 120)}"`;
}

export function userPrompt(turn, state, extra = {}) {
  const role = ROLES[state.roleId];
  const lines = [
    `Role: ${role.title}, ${role.level}, ${role.location}.`,
    "Requirements: " + role.requirements.map((r) => `${r.id} ${r.label} (weight ${r.weight}${r.technical ? ", technical" : ""})`).join("; ") + "."
  ];
  if (["opening", "response"].includes(turn.kind)) lines.push(`You may only use these req values: ${requirementIds(state.roleId, turn.agent).join(", ")}.`);
  if (turn.kind !== "band") {
    const original = CANDIDATES[state.candidateId].documents;
    const docs = turn.agent === "auditor" ? original : screenDocuments(original).redacted;
    lines.push(turn.agent === "auditor"
      ? "Candidate documents (synthetic, original text; passages mentioning protected characteristics were hidden from the other panellists):"
      : "Candidate documents (synthetic; passages mentioning protected characteristics were removed by code):");
    for (const [key, label] of Object.entries(DOCUMENT_LABELS)) lines.push(`${label}: ${docs[key]}`);
  }
  const mine = turn.kind === "response" ? state.claims.filter((c) => c.agent === turn.agent) : state.claims;
  if (turn.kind !== "opening" && mine.length) {
    lines.push(turn.kind === "response" ? "Your claims:" : "Claims so far:");
    mine.forEach((c) => lines.push(claimLine(state, c)));
  }
  if (turn.kind === "response") {
    const ids = new Set(mine.map((c) => c.id));
    const mineChallenged = state.challenges.filter((ch) => ids.has(ch.claim));
    lines.push(mineChallenged.length
      ? "Challenges to your claims: " + mineChallenged.map((ch) => `${ch.claim} ${ch.issue}: ${ch.note}`).join(" | ")
      : "No challenges to your claims.");
  }
  if (turn.kind === "review" || turn.kind === "brief") {
    const said = state.said.slice(-6).map((s) => `${AGENTS[s.agent].name}: ${s.text.slice(0, 220)}`);
    if (said.length) lines.push("Panel discussion so far:", ...said);
  }
  if (extra.band) {
    const b = extra.band;
    lines.push(`Computed band (GBP, synthetic benchmark): P25 £${b.p25}, P50 £${b.p50}, P75 £${b.p75}, equity cap £${b.equityCap}, offer floor £${b.floor}, ceiling £${b.ceiling}, recommended £${b.recommended}. Role fit ${extra.metrics.roleFit}/100.`);
  }
  if (turn.kind === "brief") {
    lines.push(`Computed scores: ${JSON.stringify(extra.metrics)}.`);
    lines.push(extra.gaps.length
      ? "Evidence gaps needing a question: " + extra.gaps.map((g) => `${g.req} ${g.label}: ${g.gap}`).join(" | ")
      : "No evidence gaps were found.");
  }
  lines.push("Reply with the JSON object now.");
  return lines.join("\n");
}

// One short retry on rate limiting or provider errors; then the caller falls back to the recording.
export async function callLlm({ sleep = (ms) => new Promise((r) => setTimeout(r, ms)), ...options }) {
  const first = await callLlmOnce(options);
  if (first.ok || !first.retryable) return first;
  await sleep(800);
  return callLlmOnce(options);
}

// Thinking is disabled (faster, and nothing to round-trip); reasoning_content is never read or forwarded.
async function callLlmOnce({ apiKey, model, messages, maxTokens, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch, timeoutMs = 20000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
        temperature: 0.6,
        max_tokens: maxTokens
      }),
      signal: controller.signal
    });
    if (!res.ok) return { ok: false, retryable: res.status === 429 || res.status >= 500, error: `provider returned HTTP ${res.status}` };
    const data = parseJson(await res.text());
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return { ok: false, error: "provider returned no message" };
    return { ok: true, content, usage: readUsage(data.usage) };
  } catch (err) {
    return { ok: false, retryable: false, error: err?.name === "AbortError" ? "provider timed out" : "provider unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

// Bodies may be preceded by keep-alive blank lines; a body that is still not JSON yields null.
export function parseJson(text) {
  const trimmed = typeof text === "string" ? text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "") : "";
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function readUsage(usage) {
  const count = (value) => (Number.isFinite(value) && value >= 0 ? value : 0);
  return { promptTokens: count(usage?.prompt_tokens), completionTokens: count(usage?.completion_tokens) };
}
