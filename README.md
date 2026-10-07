# HR Hiring Panel

**Live demo:** https://www.neuromorphicinference.com/demos/hiring-panel/

A panel of six AI agents reviews one synthetic candidate for one role and debates the case in a live,
chat-style view. Scores move as claims are accepted, rejected or revised. The panel never decides: it
prepares a brief for a person, who makes the hiring decision.

> Synthetic candidates. Decision support only. A person makes every hiring decision.

The demo is built to show two things at once: that a multi-agent workflow can be pleasant to watch and
useful to a hiring team, and that AI in a sensitive, high-risk domain can be governed by code rather than
by good intentions in a prompt.

## What the demo shows

| Agent | Role in the debate |
| --- | --- |
| Iris, Hiring Manager | Fit against each weighted role requirement. |
| Theo, Technical Assessor | Depth of skills and strength of evidence, technical requirements only. |
| Pia, People Partner | Collaboration, growth potential and onboarding needs. |
| Faye, Fairness and Compliance Auditor | Challenges the others: unsupported or weak claims, inconsistencies, protected characteristics. |
| Cato, Compensation Analyst | Explains the offer band that the code computed. |
| Sol, Chair | Summarises, records dissent, suggests an outcome and writes interview questions for evidence gaps. |

Visitors pick one of two roles (Automation Lead, People Operations; People Analytics Engineer) and one of
three candidates:

- **Morgan Ellery**: a strong match for the Automation Lead role.
- **Jordan Vale**: mixed, with real evidence gaps (no API or LLM build, no team leadership).
- **Alex Rowan**: a strong candidate whose documents contain bias traps: a career break, an age hint
  (graduation year and an interviewer remark about being "senior in years"), and a remark about children.
  The traps exist so the screen and the Auditor can be seen working.

The brief shows a radar chart (role fit, technical depth, growth potential, evidence strength, ramp-up
time with estimated weeks), the offer range on a P25/P50/P75 band with the equity cap, "points to verify at
interview" worded as gaps in evidence, a dissent log, audit counters and a **Human decision** control that
records the visitor's choice on the page only.

## Architecture

```
Browser (fixed turn order, animation)            Cloudflare Pages Function  POST /api/panel/turn
  │  { start: { roleId, candidateId } }  ──────▶  1. validate body (allow-listed IDs only)
  │  or { state }  (signed, compact)              2. verify state: structure + HMAC signature
  │                                               3. one agent turn:
  │                                                    live: DeepSeek chat completions, JSON reply,
  │                                                          one retry on an invalid reply
  │                                                    recorded: the saved live transcript for the pair
  │                                               4. guardrails: citation check, protected-characteristic
  │                                                  filter, pay-figure check
  │                                               5. code computes scores, band, gaps, dissent, outcome
  ◀──────────── { event, state (re-signed), brief when done } or { fallback: true, reason }
```

- **One agent turn per HTTP request.** The orchestrator fixes the order (three opening assessments, the
  audit, three responses, the pay band, the Chair) and caps the run at nine turns. The page prefetches the
  next turn while the current one animates.
- **No server-side session.** The compact run state (claims, short summaries, challenges, counters) travels
  with each request. The server validates its shape and allow-listed IDs, checks consistency with the turn
  order and verifies an HMAC-SHA256 signature derived from server secrets, so a visitor cannot edit claims,
  scores or text that later prompts reuse.
- **Short prompts.** Each prompt is built on the server from the role, the candidate documents and the
  compact state; the output limit is 220 to 650 tokens depending on the turn. Thinking is disabled and
  `reasoning_content` is never read or forwarded.
- **Recorded fallback.** Every role and candidate pair was run live and saved as JSON in
  `site/demos/hiring-panel/recordings/`. If the key is missing, the provider errors or rate-limits (after one
  short retry), or a turn is invalid twice, the page restarts the run in recorded mode and the badge reads
  "Recorded run". Recorded turns go through the same Function, validation, guardrails and scoring as live
  turns, so the fallback exercises the same code. The demo never fails because of the LLM.

## Scoring formula

Agents propose claims (requirement, score 1 to 5, document, quote, reason). Code aggregates the accepted
ones; unsupported and struck claims are excluded.

```
mean(r, a)         = mean of agent a's accepted scores (1 to 5) for requirement r, or 0 if none
Role fit           = 20 × Σ w_r · mean(r, Hiring Manager) ÷ Σ w_r
Technical depth    = 20 × Σ w_r · mean(r, Technical Assessor) ÷ Σ w_r, over technical requirements
Growth potential   = 20 × mean of the People Partner's accepted scores
Evidence strength  = 100 × (½ · accepted ÷ claims made
                            + ½ · weighted share of requirements with an accepted score of 3 or more)
Ramp-up weeks      = 2 + round(10 × (1 − Σ w_r · best_r ÷ 5 ÷ Σ w_r)); ramp-up score = 100 × (12 − weeks) ÷ 10

Offer floor        = P25
Offer ceiling      = min(P75, internal equity cap)
Recommended offer  = floor + (ceiling − floor) × clamp((role fit − 50) ÷ 50, 0, 1), rounded to £500

Outcome            = "Advance to interview" only if role fit ≥ 60, evidence strength ≥ 60, no gap on a
                     weight-3 requirement and the Chair agrees; otherwise "Needs more evidence"
```

## Guardrails enforced in code

- **Citation check** (`site/config/panel/guardrails.js`): every claim carries a quote and names its source
  document. The quote must be a substring of that document after normalising case, whitespace,
  typographic quotes and dashes. Otherwise the claim is shown as "Unsupported" with the reason and
  excluded from every score.
- **Document screen**: before the debate, sentences in the candidate's documents that mention a protected
  characteristic are struck from the record. The assessors see the redacted text; only the Auditor sees the
  original, so it can confirm nothing slipped through.
- **Protected-characteristic filter**: a code-side list of terms and proxies (age, gender, family status,
  career breaks, nationality, ethnicity and religion, photo and appearance, name, health, previous pay). Any
  sentence, claim or revision from a non-Auditor agent that uses one is struck through on the page with the
  reason and excluded from the scores. The Auditor may name these characteristics, because it raises them.
- **Pay figures**: the band is computed from the synthetic benchmark and policy only. Previous pay is not an
  input and does not exist in the data. Any £ figure in the Compensation Analyst's words that the policy did
  not compute is struck.
- **Allowed outcomes**: only "Advance to interview" and "Needs more evidence". A Chair reply proposing
  anything else is invalid. There is no reject outcome and no automated decision; the code rule can only
  downgrade the Chair's suggestion, and the page says so.
- **No visitor text reaches the model**: visitors choose a role and a candidate from allow-lists. There is no
  free-text field and no file upload; the Function rejects any other field.

## Responsible use

Using AI to evaluate job candidates is a high-risk use of AI under the EU AI Act (Annex III, point 4,
employment and workers management). This demo shows the controls such a system needs, in working code:

- **Human oversight**: the panel only advises; a person records the decision, and departing from the advice
  is highlighted as something a real process would log with a reason.
- **Evidence traceability**: every scored claim is tied to a verified quote in a named document.
- **Bias checks**: a document screen, a protected-characteristic filter and an adversarial Auditor agent.
- **Logging**: every claim, status, revision, strike and token count is part of the run record and the audit
  trail on the page.
- **No automated rejection**: the only outcomes are "Advance to interview" and "Needs more evidence".

A real deployment would add what a demo cannot: a conformity assessment, a data protection impact
assessment, bias monitoring on real outcomes, candidate notices and a route to contest a decision, records
retention, and review of the term list by people with legal and DEI expertise.

## Layout

`site/` mirrors the portfolio site repository exactly, and `scripts/sync-to-site.sh` copies it there.

```
site/demos/hiring-panel/          index.html, app.js (page, styles, client) and recordings/*.json
site/functions/api/panel/turn.js  GET configuration, POST one turn
site/config/panel/                data.js, guardrails.js, scoring.js, protocol.js, llm.js, engine.js, http.js
site/test/panel-*.test.js         node --test suites (plus panel-helpers.js)
scripts/sync-to-site.sh           copy site/ into ../neuromorphic-inference-lab-site
scripts/record-panel.mjs          run the live panel for every pair and save the transcripts
```

## Running locally

```bash
npm test                                   # node --test, no dependencies
scripts/sync-to-site.sh                    # copy into the site repository
cd ../neuromorphic-inference-lab-site
npx wrangler pages dev .                   # reads DEEPSEEK_API_KEY from .dev.vars
# open http://localhost:8788/demos/hiring-panel/
```

Without `DEEPSEEK_API_KEY` the page runs in recorded mode. `PANEL_LLM_MODEL` overrides the model
(default `deepseek-flash`); `PANEL_STATE_SECRET` sets the state-signing key (otherwise it is derived from the
API key). To refresh the recordings: `DEEPSEEK_API_KEY=… node scripts/record-panel.mjs`.

A full live run takes nine requests of roughly one to three seconds each and about 11,000 to 13,000 tokens
(median per turn: about 1,000 prompt and 160 completion tokens).

## Limits of the demo

- All people, the company, the roles and the pay benchmark are invented. Scores and figures mean nothing
  outside the demo.
- The citation check proves a quote exists in the cited document, not that it supports the claim; that
  judgement is left to the Auditor and to the person reading the brief.
- The protected-term list is short and English-only. It errs towards striking (it also strikes agents who
  merely mention a protected characteristic in order to set it aside), and a determined paraphrase could
  evade it. It is a backstop, not a guarantee.
- Sentence-level redaction can remove legitimate evidence that shares a sentence with a protected detail.
- Live runs vary: the same pair can produce different claims and outcomes on different runs. The recorded
  runs are single samples.
- The human decision is recorded on the page only; nothing is stored.
