import test from "node:test";
import assert from "node:assert/strict";
import { postTurn, fakeLlm } from "./panel-helpers.js";
import { resolveModel, DEFAULT_MODEL } from "../config/panel/llm.js";

const env = { DEEPSEEK_API_KEY: "sk-test", PANEL_STATE_SECRET: "test-secret" };
const start = { start: { roleId: "automation-lead", candidateId: "alex-rowan", mode: "live" } };

const opening = {
  message: "Strong delivery record. The interview notes say they have two children at primary school, which may limit availability. Overall evidence is solid.",
  claims: [
    { req: "r1", score: 5, doc: "cv", quote: "Designed and delivered an automation programme covering 22 HR processes", reason: "Large programme, delivered." },
    { req: "r2", score: 4, doc: "cv", quote: "Built a GPT-4 chatbot that answers all employee questions", reason: "LLM product experience." },
    { req: "r5", score: 4, doc: "cv", quote: "Led a team of six engineers and analysts", reason: "Leads people." },
    { req: "r3", score: 3, doc: "cv", quote: "Career break (2019 to 2021) to care for a family member", reason: "The career break means skills may be dated." }
  ]
};

test("a live turn applies the citation check, the filter and the scores, and sends safe parameters", async () => {
  const llm = fakeLlm([opening]);
  const res = await postTurn(start, env, { fetchImpl: llm.fetchImpl });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.doesNotMatch(text, /SECRET-REASONING/, "reasoning_content is never forwarded");
  const body = JSON.parse(text);
  assert.equal(body.mode, "live");
  const statuses = body.event.claims.map((c) => c.status);
  assert.deepEqual(statuses, ["accepted", "unsupported", "accepted", "struck"]);
  assert.match(body.event.claims[1].note, /not found/);
  assert.match(body.event.claims[3].note, /career break|family/);
  assert.deepEqual(body.event.sentences.map((s) => Boolean(s.struck)), [false, true, false]);
  // The document screen strikes 5 passages before the debate, then 1 claim and 1 sentence are struck.
  assert.equal(body.event.documentScreening.length, 5);
  assert.deepEqual(body.event.counters, { claimsMade: 4, claimsAccepted: 2, unsupported: 1, struck: 7 });
  const prompt = llm.calls[0].messages[1].content;
  assert.doesNotMatch(prompt, /two children|senior in years|graduated 1994/, "assessors see redacted documents");
  assert.match(prompt, /removed by the protected-characteristic screen/);
  // Only c1 (r1: 5) and c3 (r5: 4) count: 20 × (3·5 + 2·4) ÷ 14.
  assert.equal(body.event.metrics.roleFit, Math.round(20 * 23 / 14));
  assert.equal(body.nextAgent, "tech");
  const [call] = llm.calls;
  assert.deepEqual(call.thinking, { type: "disabled" });
  assert.equal(call.model, DEFAULT_MODEL);
  assert.ok(call.max_tokens <= 650);
  assert.deepEqual(call.response_format, { type: "json_object" });
  assert.equal(call.messages.length, 2, "one compact prompt per turn");
  assert.ok(call.url.startsWith("https://api.deepseek.com/chat/completions"));
});

test("the next turn continues from the signed state returned by the previous one", async () => {
  const llm = fakeLlm([opening, { message: "Technical evidence is strong.", claims: [{ req: "r4", score: 4, doc: "cv", quote: "integration layer between the HRIS, payroll and the learning platform", reason: "Event-driven integration." }] }]);
  const first = await (await postTurn(start, env, { fetchImpl: llm.fetchImpl })).json();
  const second = await (await postTurn({ state: first.state }, env, { fetchImpl: llm.fetchImpl })).json();
  assert.equal(second.event.agent, "tech");
  assert.equal(second.event.claims[0].id, "c5");
  assert.equal(second.state.turn, 2);
  assert.match(llm.calls[1].messages[1].content, /You may only use these req values: r1, r2, r4/);
});

test("one invalid reply is retried; two invalid replies switch to the recording", async () => {
  const once = fakeLlm(["not json at all", opening]);
  const ok = await (await postTurn(start, env, { fetchImpl: once.fetchImpl })).json();
  assert.equal(ok.event.invalidReplies.length, 1);
  assert.equal(once.calls.length, 2);
  assert.match(once.calls[1].messages.at(-1).content, /rejected/);

  const twice = fakeLlm([{ message: "x", claims: [{ req: "r9", score: 7 }] }, { claims: [] }]);
  const fb = await (await postTurn(start, env, { fetchImpl: twice.fetchImpl })).json();
  assert.equal(fb.fallback, true);
  assert.match(fb.reason, /invalid turn twice/);
});

test("provider errors, rate limits and a missing key all fall back instead of failing", async () => {
  const limited = fakeLlm([429, 429]);
  const a = await (await postTurn(start, env, { fetchImpl: limited.fetchImpl })).json();
  assert.equal(a.fallback, true);
  assert.equal(limited.calls.length, 2, "one short retry, then fall back");
  const down = fakeLlm([500, 503]);
  assert.equal((await (await postTurn(start, env, { fetchImpl: down.fetchImpl })).json()).fallback, true);
  const noKey = await (await postTurn(start, {})).json();
  assert.equal(noKey.fallback, true);
  assert.match(noKey.reason, /No LLM key/);
});

test("the Chair cannot propose a reject outcome", async () => {
  const { validateOutput } = await import("../config/panel/engine.js");
  const { initialState } = await import("../config/panel/protocol.js");
  const state = { ...initialState("automation-lead", "alex-rowan", "live"), turn: 8 };
  const turn = { agent: "chair", round: 3, kind: "brief" };
  assert.equal(validateOutput(turn, { message: "Summary.", recommendation: "reject" }, state).ok, false);
  assert.equal(validateOutput(turn, { message: "Summary.", recommendation: "advance" }, state).ok, true);
});

test("model override is validated", () => {
  assert.equal(resolveModel({}), "deepseek-flash");
  assert.equal(resolveModel({ PANEL_LLM_MODEL: "deepseek-pro" }), "deepseek-pro");
  assert.equal(resolveModel({ PANEL_LLM_MODEL: "bad model; rm -rf" }), "deepseek-flash");
});
