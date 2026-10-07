import test from "node:test";
import assert from "node:assert/strict";
import { checkCitation, findProtected, screenMessage, checkFigures, moneyFigures, normalise } from "../config/panel/guardrails.js";
import { CANDIDATES, DOCUMENT_LABELS } from "../config/panel/data.js";

const docs = CANDIDATES["morgan-ellery"].documents;

test("citation check accepts exact quotes and reports the source document", () => {
  const result = checkCitation("Led the automation of 14 HR workflows", docs);
  assert.deepEqual(result, { ok: true, doc: "cv" });
  assert.equal(checkCitation("Mentored two junior developers", docs).doc, "interview");
});

test("citation check normalises whitespace, case, typographic quotes and wrapping punctuation", () => {
  assert.equal(checkCitation("  LED THE   automation\nof 14 hr WORKFLOWS ", docs).ok, true);
  assert.equal(checkCitation("“Mentored two junior developers.”", docs).ok, true);
  assert.equal(checkCitation("described the root cause and the new approval step clearly", docs).ok, true);
  assert.equal(normalise("A’s “x” – y"), "a's \"x\" - y");
  assert.equal(checkCitation("the team’s code review rota", docs).ok, true, "curly apostrophe matches a straight one");
});

test("citation check rejects paraphrases, fabrications, fragments and the wrong cited document", () => {
  assert.equal(checkCitation("Automated 14 HR workflows and cut handling time by 62%", docs).ok, false);
  assert.match(checkCitation("Designed a warehouse schema for HR data", docs).reason, /not found/);
  assert.match(checkCitation("HR", docs).reason, /too short/);
  assert.match(checkCitation("x ".repeat(200), docs).reason, /too long/);
  const wrongDoc = checkCitation("Mentored two junior developers", docs, "cv", DOCUMENT_LABELS);
  assert.equal(wrongDoc.ok, false);
  assert.match(wrongDoc.reason, /cited CV/);
  assert.equal(checkCitation("Mentored two junior developers", docs, "interview", DOCUMENT_LABELS).ok, true);
});

test("protected-characteristic filter catches each category and common proxies", () => {
  const cases = {
    age: "Possibly a little senior in years for a young team.",
    gender: "As a woman she may prefer a supportive manager.",
    family: "With two children at primary school, Tuesdays may be hard.",
    "career-break": "The career break suggests their skills may be dated.",
    nationality: "Their accent could be a barrier with stakeholders.",
    appearance: "The photo gives a professional impression.",
    name: "Their surname suggests a strong local network.",
    health: "A health condition might affect delivery.",
    "pay-history": "Their previous salary should anchor the offer."
  };
  for (const [category, sentence] of Object.entries(cases)) {
    assert.equal(findProtected(sentence)?.category, category, sentence);
  }
  assert.equal(findProtected("Graduated 1994, so very experienced.")?.category, "age");
  assert.equal(findProtected("Worth checking energy levels.")?.category, "age");
});

test("protected-characteristic filter leaves ordinary assessment language alone", () => {
  const benign = [
    "Pia, the People Partner, sees strong collaboration.",
    "Managed stakeholders across HR, legal and IT.",
    "Mentored two junior developers and ran the code review rota.",
    "Built retrieval-augmented generation over 300 policy documents with event-driven APIs.",
    "Cut manual handling time by 62% and messaged managers.",
    "Leadership evidence is lighter; their message was clear and their image of the role realistic."
  ];
  for (const sentence of benign) assert.equal(findProtected(sentence), null, sentence);
});

test("statements are struck sentence by sentence, and the Auditor is exempt", () => {
  const text = "Strong delivery record. Two children at primary school may limit availability. Evidence is verified.";
  const screened = screenMessage(text, "people");
  assert.equal(screened.length, 3);
  assert.deepEqual(screened.map((s) => Boolean(s.struck)), [false, true, false]);
  assert.match(screened[1].struck, /family status/);
  assert.ok(screenMessage(text, "auditor").every((s) => !s.struck), "the Auditor may name protected characteristics to flag them");
});

test("pay figures not computed by the policy are struck", () => {
  assert.deepEqual(moneyFigures("Between £78,000 and £89k, not £87500."), [78000, 89000, 87500]);
  const checked = checkFigures([{ text: "The ceiling is £89,000.", struck: null }, { text: "I would offer £95,000.", struck: null }], [78000, 89000]);
  assert.equal(checked[0].struck, null);
  assert.match(checked[1].struck, /not a figure computed/);
});

test("document screen strikes protected passages before the debate and keeps the rest", async () => {
  const { screenDocuments, REDACTION } = await import("../config/panel/guardrails.js");
  const trap = screenDocuments(CANDIDATES["alex-rowan"].documents);
  assert.equal(trap.passages.length, 5);
  assert.ok(trap.passages.some((p) => p.doc === "interview" && /senior in years/.test(p.text)));
  assert.match(trap.redacted.interview, new RegExp(REDACTION.replace(/[[\]]/g, "\\$&")));
  assert.match(trap.redacted.cover, /rebuilt my skills in LLM evaluation/, "evidence next to a struck passage survives");
  assert.equal(screenDocuments(CANDIDATES["morgan-ellery"].documents).passages.length, 0);
  assert.equal(screenDocuments(CANDIDATES["jordan-vale"].documents).passages.length, 0);
});

test("a claim citing the wrong document is unsupported, as in a recorded live run", async () => {
  const { checkCitation: check } = await import("../config/panel/guardrails.js");
  const alex = CANDIDATES["alex-rowan"].documents;
  const result = check("rebuilt my skills in LLM evaluation and completed a course", alex, "cv", DOCUMENT_LABELS);
  assert.equal(result.ok, false);
  assert.match(result.reason, /cited CV/);
});
