import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FORMULA } from "../config/panel/scoring.js";

const html = await readFile(new URL("../demos/hiring-panel/index.html", import.meta.url), "utf8");
const js = await readFile(new URL("../demos/hiring-panel/app.js", import.meta.url), "utf8");
const matches = (pattern) => [...html.matchAll(pattern)];

test("demo page keeps the site layout, provenance footer and unique IDs", () => {
  assert.equal(matches(/<main(?:\s|>)/g).length, 1);
  assert.equal(matches(/<h1(?:\s|>)/g).length, 1);
  assert.match(html, /<html lang="en-GB">/);
  assert.match(html, /<link rel="stylesheet" href="\/style.css" \/>/);
  assert.equal(matches(/<script src="\/build-info\.js"><\/script>/g).length, 1);
  const ids = matches(/\sid="([^"]+)"/g).map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, "IDs must be unique");
  for (const id of ["build-branch", "build-commit", "build-time", "modeBadge", "transcript", "metrics", "brief", "radar", "band", "verifyList", "dissentList", "decisionActions", "skipButton"]) {
    assert.ok(ids.includes(id), `missing #${id}`);
  }
  for (const id of js.matchAll(/\$\("([^"]+)"\)/g)) assert.ok(ids.includes(id[1]), `app.js references missing #${id[1]}`);
});

test("demo page shows the notice, mode badge labels, speed control, formula and Responsible use", () => {
  assert.ok(html.includes("Synthetic candidates. Decision support only. A person makes every hiring decision."));
  assert.match(js, /Live LLM panel/);
  assert.match(js, /Recorded run/);
  assert.match(html, /name="speed" value="normal"/);
  assert.match(html, /name="speed" value="fast"/);
  assert.match(html, /How it works/);
  assert.match(html, /<h3 class="mt-12">Responsible use<\/h3>/);
  assert.match(html, /high-risk use under the EU AI Act/);
  for (const control of ["Human oversight", "Evidence traceability", "Bias checks", "Logging", "no automated rejection"]) assert.ok(html.includes(control), control);
  for (const line of FORMULA) assert.ok(html.includes(line.replaceAll("'", "'")), `formula line missing from the page: ${line}`);
  assert.match(html, /href="https:\/\/github.com\/nepryoon\/hr-hiring-panel" target="_blank" rel="noopener noreferrer"/);
});

test("the human decision is recorded on the page only", () => {
  assert.match(html, /Human decision/);
  assert.match(html, /nothing is stored or sent/);
  const decisionHandler = js.slice(js.indexOf('$("decisionActions").addEventListener'), js.indexOf("// --- Run loop"));
  assert.doesNotMatch(decisionHandler, /fetch|localStorage|sendBeacon/);
});

test("client renders server data as text, never as HTML", () => {
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test("user-facing copy uses British English", () => {
  const american = /\b(color|behavior|organization|prioritize|analyze|initialize|favorite|license|catalog|center|judgment|program)\b/i;
  assert.doesNotMatch(html.replace(/<style>[\s\S]*?<\/style>/, ""), american);
  assert.doesNotMatch(js.replace(/behavior:/g, ""), /\b(behavior|organization|prioritize|analyze|favorite|judgment)\b/i);
});
