// Scores, offer band, outcome, evidence gaps and dissent are all computed here, from accepted claims.
// Agents propose claims; this code aggregates them. The formulas are also shown on the page.

import { ROLES, AGENTS, BENCHMARK, POLICY, requirementLabel } from "./data.js";

export const OUTCOMES = {
  advance: "Advance to interview",
  more_evidence: "Needs more evidence"
};

export const THRESHOLDS = { roleFit: 60, evidenceStrength: 60 };

export const FORMULA = [
  "mean(r, a) = mean of agent a's accepted scores (1 to 5) for requirement r, or 0 if none",
  "Role fit = 20 × Σ w_r · mean(r, Hiring Manager) ÷ Σ w_r",
  "Technical depth = 20 × Σ w_r · mean(r, Technical Assessor) ÷ Σ w_r, over technical requirements",
  "Growth potential = 20 × mean of the People Partner's accepted scores",
  "Evidence strength = 100 × (½ · accepted ÷ claims made + ½ · weighted share of requirements with an accepted score of 3 or more)",
  "Ramp-up weeks = 2 + round(10 × (1 − Σ w_r · best_r ÷ 5 ÷ Σ w_r)); ramp-up score = 100 × (12 − weeks) ÷ 10"
];

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const round = (value) => Math.round(value);

function acceptedScores(claims, req, agent) {
  return claims.filter((c) => c.status === "accepted" && c.req === req && (!agent || c.agent === agent)).map((c) => c.score);
}

function weighted(reqs, valueOf) {
  const total = reqs.reduce((sum, r) => sum + r.weight, 0);
  return total ? reqs.reduce((sum, r) => sum + r.weight * valueOf(r), 0) / total : 0;
}

export function computeMetrics(roleId, claims) {
  const reqs = ROLES[roleId].requirements;
  const accepted = claims.filter((c) => c.status === "accepted");
  const roleFit = 20 * weighted(reqs, (r) => mean(acceptedScores(claims, r.id, "hm")));
  const technicalDepth = 20 * weighted(reqs.filter((r) => r.technical), (r) => mean(acceptedScores(claims, r.id, "tech")));
  const growthPotential = 20 * mean(accepted.filter((c) => c.agent === "people").map((c) => c.score));
  const coverage = weighted(reqs, (r) => (Math.max(0, ...acceptedScores(claims, r.id)) >= 3 ? 1 : 0));
  const acceptedRatio = claims.length ? accepted.length / claims.length : 0;
  const evidenceStrength = 100 * (0.5 * acceptedRatio + 0.5 * coverage);
  const best = weighted(reqs, (r) => Math.max(0, ...acceptedScores(claims, r.id)) / 5);
  const rampUpWeeks = 2 + round(10 * (1 - best));
  return {
    roleFit: round(roleFit),
    technicalDepth: round(technicalDepth),
    growthPotential: round(growthPotential),
    evidenceStrength: round(evidenceStrength),
    rampUp: round((100 * (12 - rampUpWeeks)) / 10),
    rampUpWeeks
  };
}

export function auditCounters(claims, struckStatements) {
  return {
    claimsMade: claims.length,
    claimsAccepted: claims.filter((c) => c.status === "accepted").length,
    unsupported: claims.filter((c) => c.status === "unsupported").length,
    struck: claims.filter((c) => c.status === "struck").length + struckStatements
  };
}

// Offer band from the benchmark and the policy only. Previous pay is not an input and does not exist in the data.
export function computeBand(roleId, roleFit) {
  const { level, location } = ROLES[roleId];
  const row = BENCHMARK.rows.find((r) => r.roleId === roleId && r.level === level && r.location === location);
  if (!row) throw new Error(`No benchmark row for ${roleId} ${level} ${location}`);
  const cap = POLICY.equityCaps[`${roleId}:${level}`] ?? Infinity;
  const floor = row[POLICY.floor];
  const ceiling = Math.min(row[POLICY.ceiling], cap);
  const position = Math.min(1, Math.max(0, (roleFit - 50) / 50));
  const step = POLICY.roundTo;
  const recommended = Math.min(ceiling, Math.max(floor, Math.round((floor + (ceiling - floor) * position) / step) * step));
  return {
    currency: "GBP",
    level,
    location,
    p25: row.p25,
    p50: row.p50,
    p75: row.p75,
    equityCap: Number.isFinite(cap) ? cap : null,
    floor,
    ceiling,
    recommended,
    position: Math.round(position * 100) / 100,
    source: BENCHMARK.source,
    formula: "floor = P25; ceiling = min(P75, equity cap); recommended = floor + (ceiling − floor) × clamp((role fit − 50) ÷ 50, 0, 1), rounded to £500"
  };
}

export function bandFigures(band) {
  return [band.p25, band.p50, band.p75, band.equityCap, band.floor, band.ceiling, band.recommended].filter(Number.isFinite);
}

// Evidence gaps, worded as gaps in the evidence, never as judgements of the person.
export function findGaps(roleId, claims, questions = {}) {
  return ROLES[roleId].requirements.flatMap((r) => {
    const scores = acceptedScores(claims, r.id);
    const unsupported = claims.some((c) => c.req === r.id && c.status === "unsupported");
    let gap = null;
    if (!scores.length) {
      gap = unsupported
        ? `Claims about ${r.label.toLowerCase()} could not be matched to the documents.`
        : `The documents contain no verified evidence for ${r.label.toLowerCase()}.`;
    } else if (mean(scores) < 3) {
      gap = `The evidence for ${r.label.toLowerCase()} is limited (mean ${mean(scores).toFixed(1)} of 5).`;
    }
    return gap ? [{ req: r.id, label: r.label, weight: r.weight, gap, question: questions[r.id] || r.question }] : [];
  });
}

export function findDissent(roleId, claims, challenges, chairNotes = []) {
  const entries = [];
  for (const r of ROLES[roleId].requirements) {
    const hm = acceptedScores(claims, r.id, "hm");
    const tech = acceptedScores(claims, r.id, "tech");
    if (hm.length && tech.length && Math.abs(mean(hm) - mean(tech)) >= 2) {
      entries.push({
        agents: ["hm", "tech"],
        topic: r.label,
        note: `${AGENTS.hm.name} scores ${mean(hm).toFixed(1)} of 5, ${AGENTS.tech.name} scores ${mean(tech).toFixed(1)} of 5.`
      });
    }
  }
  for (const ch of challenges) {
    const claim = claims.find((c) => c.id === ch.claim);
    if (claim && claim.status === "accepted" && claim.from === undefined) {
      entries.push({
        agents: ["auditor", claim.agent],
        topic: requirementLabel(roleId, claim.req),
        note: `${AGENTS.auditor.name}'s challenge to ${claim.id} was not answered with a revision; the score stands at ${claim.score} of 5.`
      });
    }
  }
  for (const note of chairNotes) entries.push({ agents: ["chair"], topic: "Chair's note", note });
  return entries.slice(0, 8);
}

export function decideOutcome(metrics, gaps, chairSuggestion) {
  const blockingGap = gaps.find((g) => g.weight >= 3);
  const meetsRule = metrics.roleFit >= THRESHOLDS.roleFit && metrics.evidenceStrength >= THRESHOLDS.evidenceStrength && !blockingGap;
  const id = meetsRule && chairSuggestion !== "more_evidence" ? "advance" : "more_evidence";
  const overridden = chairSuggestion === "advance" && !meetsRule;
  return {
    id,
    label: OUTCOMES[id],
    chairSuggestion: chairSuggestion ? OUTCOMES[chairSuggestion] : null,
    overridden,
    rule: `Advance only if role fit ≥ ${THRESHOLDS.roleFit}, evidence strength ≥ ${THRESHOLDS.evidenceStrength} and no gap on a weight-3 requirement; otherwise ask for more evidence. There is no reject outcome.`
  };
}
