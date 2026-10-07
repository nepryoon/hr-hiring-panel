// Shared test helpers for the Hiring Panel. node --test also loads this file, but it defines no tests.

import { readFile } from "node:fs/promises";
import { onRequestPost } from "../functions/api/panel/turn.js";

export async function loadRecording(roleId, candidateId) {
  const url = new URL(`../demos/hiring-panel/recordings/${roleId}--${candidateId}.json`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

export function postTurn(body, env = {}, deps = {}) {
  const request = new Request("http://localhost/api/panel/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
  return onRequestPost({ request, env }, { loadRecording, sleep: async () => {}, ...deps });
}

// Drives a whole run through the Function, one request per turn, as the page does.
export async function runAll(roleId, candidateId, env = {}, deps = {}) {
  const responses = [];
  let res = await (await postTurn({ start: { roleId, candidateId, mode: env.DEEPSEEK_API_KEY ? "live" : "recorded" } }, env, deps)).json();
  responses.push(res);
  while (res.state && !res.done) {
    res = await (await postTurn({ state: res.state }, env, deps)).json();
    responses.push(res);
  }
  return { responses, last: res };
}

// Fake OpenAI-compatible endpoint: returns queued JSON replies in order; a number is an HTTP status.
export function fakeLlm(replies) {
  const calls = [];
  const queue = [...replies];
  const fetchImpl = async (url, init) => {
    calls.push({ ...JSON.parse(init.body), url });
    const next = queue.shift();
    if (next === undefined) return new Response("{}", { status: 500 });
    if (typeof next === "number") return new Response("{}", { status: next });
    const content = typeof next === "string" ? next : JSON.stringify(next);
    const message = { role: "assistant", content, reasoning_content: "SECRET-REASONING should never reach the page" };
    const usage = { prompt_tokens: 900, completion_tokens: 150, total_tokens: 1050 };
    return new Response(`\n\n${JSON.stringify({ choices: [{ message }], usage })}`, { headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}
