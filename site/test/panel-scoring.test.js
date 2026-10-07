import test from "node:test";
import assert from "node:assert/strict";
import { computeMetrics, computeBand, decideOutcome, findGaps, findDissent, auditCounters, OUTCOMES, FORMULA } from "../config/panel/scoring.js";
import { CANDIDATES, ROLES } from "../config/panel/data.js";
import { findProtected } from "../config/panel/guardrails.js";

const claim = (id, agent, req, score, status = "accepted", extra = {}) => ({ id, agent, req, score, status, doc: "cv", quote: "q", reason: "r", note: "", round: 1, ...extra });

test("scores aggregate accepted claims with the requirement weights", () => {
  // hr-systems-automation-manager weights: r1 3, r2 3, r3 2, r4 2, r5 2, r6 2 (total 14); technical r1, r2, r4 (total 8).
  const claims = [
    claim("c1", "hm", "r1", 5), claim("c2", "hm", "r2", 4), claim("c3", "hm", "r3", 3),
    claim("c4", "tech", "r1", 4), claim("c5", "tech", "r4", 2),
    claim("c6", "people", "growth", 4), claim("c7", "people", "collaboration", 3)
  ];
  const m = computeMetrics("hr-systems-automation-manager", claims);
  assert.equal(m.roleFit, Math.round(20 * (3 * 5 + 3 * 4 + 2 * 3) / 14));
  assert.equal(m.technicalDepth, Math.round(20 * (3 * 4 + 2 * 2) / 8));
  assert.equal(m.growthPotential, 70);
  // Covered with a score of 3 or more: r1, r2, r3 → weight 8 of 14; all 7 claims accepted.
  assert.equal(m.evidenceStrength, Math.round(100 * (0.5 + 0.5 * 8 / 14)));
  // best: r1 5, r2 4, r3 3, r4 2 → (15 + 12 + 6 + 4) / 5 / 14
  assert.equal(m.rampUpWeeks, 2 + Math.round(10 * (1 - (37 / 5) / 14)));
  assert.equal(m.rampUp, Math.round(100 * (12 - m.rampUpWeeks) / 10));
  assert.equal(FORMULA.length, 6);
});

test("unsupported and struck claims are excluded from every score", () => {
  const base = [claim("c1", "hm", "r1", 4)];
  const withExcluded = [...base, claim("c2", "hm", "r2", 5, "unsupported"), claim("c3", "hm", "r3", 5, "struck")];
  const a = computeMetrics("hr-systems-automation-manager", base);
  const b = computeMetrics("hr-systems-automation-manager", withExcluded);
  assert.equal(b.roleFit, a.roleFit);
  assert.ok(b.evidenceStrength < a.evidenceStrength, "rejected claims lower evidence strength");
  assert.deepEqual(auditCounters(withExcluded, 2), { claimsMade: 3, claimsAccepted: 1, unsupported: 1, struck: 3 });
  assert.equal(computeMetrics("hr-systems-automation-manager", []).roleFit, 0);
});

test("offer band comes from the benchmark and policy only, capped by P75 and the equity cap", () => {
  const low = computeBand("hr-systems-automation-manager", 40);
  assert.equal(low.p25, 78000);
  assert.equal(low.p75, 92000);
  assert.equal(low.ceiling, 89000, "equity cap below P75 sets the ceiling");
  assert.equal(low.recommended, low.floor, "role fit at or below 50 sits at the floor");
  assert.equal(computeBand("hr-systems-automation-manager", 100).recommended, 89000);
  const mid = computeBand("hr-systems-automation-manager", 75);
  assert.equal(mid.recommended, 83500, "78,000 + 11,000 × 0.5, rounded to £500");
  assert.equal(mid.recommended % 500, 0);
  const pa = computeBand("people-analytics", 90);
  assert.ok(pa.ceiling <= pa.p75 && pa.ceiling <= pa.equityCap && pa.recommended <= pa.ceiling);
  assert.equal(computeBand.length, 2, "only role and role fit are inputs: previous pay is not");
  assert.doesNotMatch(JSON.stringify(CANDIDATES), /salary|£|\bearn(?:s|ings)?\b|pay history|current pay/i, "candidate data holds no pay history");
});

test("only two outcomes exist and the code rule can override the Chair", () => {
  assert.deepEqual(Object.keys(OUTCOMES), ["advance", "more_evidence"]);
  assert.doesNotMatch(JSON.stringify(OUTCOMES), /reject/i);
  const strong = { roleFit: 80, evidenceStrength: 90 };
  assert.equal(decideOutcome(strong, [], "advance").id, "advance");
  assert.equal(decideOutcome(strong, [], "more_evidence").id, "more_evidence");
  const weak = decideOutcome({ roleFit: 50, evidenceStrength: 90 }, [], "advance");
  assert.equal(weak.id, "more_evidence");
  assert.equal(weak.overridden, true);
  assert.equal(decideOutcome(strong, [{ weight: 3 }], "advance").id, "more_evidence", "a gap on a weight-3 requirement blocks advancing");
});

test("evidence gaps are worded as gaps in evidence with a question, never as judgements", () => {
  const claims = [claim("c1", "hm", "r1", 5), claim("c2", "hm", "r2", 2), claim("c3", "tech", "r4", 4, "unsupported")];
  const gaps = findGaps("hr-systems-automation-manager", claims, { r3: "Which People processes have you redesigned?" });
  assert.deepEqual(gaps.map((g) => g.req), ["r2", "r3", "r4", "r5", "r6"]);
  assert.match(gaps.find((g) => g.req === "r4").gap, /could not be matched/);
  assert.equal(gaps.find((g) => g.req === "r3").question, "Which People processes have you redesigned?");
  for (const g of gaps) {
    assert.match(g.gap, /evidence|documents|matched/);
    assert.doesNotMatch(g.gap, /\b(weak candidate|unsuitable|poor|lacks ability)\b/i);
    assert.equal(findProtected(g.question), null);
    assert.match(g.question, /[?.]$/);
  }
  for (const role of Object.values(ROLES)) for (const r of role.requirements) assert.equal(findProtected(r.question), null);
});

test("dissent log records split scores and unanswered challenges", () => {
  const claims = [claim("c1", "hm", "r1", 5), claim("c2", "tech", "r1", 2), claim("c3", "hm", "r2", 4)];
  const dissent = findDissent("hr-systems-automation-manager", claims, [{ claim: "c3", issue: "weak", note: "n" }], ["Chair note."]);
  assert.equal(dissent.length, 3);
  assert.deepEqual(dissent[0].agents, ["hm", "tech"]);
  assert.match(dissent[1].note, /not answered/);
});
