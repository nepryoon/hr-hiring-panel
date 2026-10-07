import test from "node:test";
import assert from "node:assert/strict";
import { runAll, loadRecording } from "./panel-helpers.js";
import { ROLES, CANDIDATES } from "../config/panel/data.js";
import { TURN_ORDER } from "../config/panel/protocol.js";
import { OUTCOMES } from "../config/panel/scoring.js";

const pairs = Object.keys(ROLES).flatMap((roleId) => Object.keys(CANDIDATES).map((candidateId) => [roleId, candidateId]));

for (const [roleId, candidateId] of pairs) {
  test(`recorded fallback produces a complete brief: ${roleId} × ${candidateId}`, async () => {
    const recording = await loadRecording(roleId, candidateId);
    assert.equal(recording.synthetic, true);
    assert.deepEqual(recording.turns.map((t) => t.agent), TURN_ORDER.map((t) => t.agent));

    const { responses, last } = await runAll(roleId, candidateId, {});
    assert.equal(responses.length, TURN_ORDER.length, "one request per turn, nine turns");
    assert.ok(responses.every((r) => r.mode === "recorded" && !r.error && !r.fallback));
    assert.equal(last.done, true);
    const brief = last.brief;
    for (const key of ["roleFit", "technicalDepth", "growthPotential", "evidenceStrength", "rampUp"]) {
      assert.ok(Number.isInteger(brief.metrics[key]) && brief.metrics[key] >= 0 && brief.metrics[key] <= 100, key);
    }
    assert.ok(brief.metrics.rampUpWeeks >= 2 && brief.metrics.rampUpWeeks <= 12);
    const b = brief.band;
    assert.ok(b.p25 < b.p50 && b.p50 < b.p75);
    assert.ok(b.floor <= b.recommended && b.recommended <= b.ceiling && b.ceiling <= b.p75);
    assert.ok(Object.values(OUTCOMES).includes(brief.outcome.label));
    assert.ok(Array.isArray(brief.gaps) && brief.gaps.every((g) => g.gap && g.question));
    assert.ok(Array.isArray(brief.dissent));
    const c = brief.counters;
    assert.equal(c.claimsMade, c.claimsAccepted + c.unsupported + brief.claims.filter((x) => x.status === "struck").length);
    assert.equal(c.claimsMade, brief.claims.length);
  });
}

test("the bias-trap candidate's recorded runs show statements struck from the record", async () => {
  let struck = 0;
  for (const roleId of Object.keys(ROLES)) struck += (await runAll(roleId, "alex-rowan", {})).last.brief.counters.struck;
  assert.ok(struck >= 1, `expected at least one struck statement, got ${struck}`);
});

test("the strong match advances and the mixed candidate needs more evidence for the HR Systems Automation Manager role", async () => {
  assert.equal((await runAll("hr-systems-automation-manager", "morgan-ellery", {})).last.brief.outcome.id, "advance");
  const mixed = (await runAll("hr-systems-automation-manager", "jordan-vale", {})).last.brief;
  assert.equal(mixed.outcome.id, "more_evidence");
  assert.ok(mixed.gaps.length >= 2);
});
