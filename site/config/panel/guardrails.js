// Guardrails enforced in code: the citation check, the protected-characteristic filter and the
// pay-figure check. The prompts ask the agents to behave; these functions make sure they did.

const MIN_QUOTE_CHARS = 12;
const MAX_QUOTE_CHARS = 240;

// Case, whitespace, typographic quotes and dashes are normalised before matching.
export function normalise(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

// Quotation marks, ellipses and a final full stop around a quote are not part of the evidence.
function trimQuote(text) {
  return normalise(text).replace(/^["'.\s]+/, "").replace(/["'\s]+$/, "").replace(/\.+$/, "").trim();
}

// With citedDoc, the quote must appear in that document: evidence has to be traceable to its source.
export function checkCitation(quote, documents, citedDoc, labels = {}) {
  const needle = trimQuote(quote);
  if (needle.length < MIN_QUOTE_CHARS) return { ok: false, reason: "Quote too short to verify." };
  if (needle.length > MAX_QUOTE_CHARS) return { ok: false, reason: "Quote too long: cite one passage." };
  const found = Object.keys(documents).find((doc) => normalise(documents[doc]).includes(needle));
  if (!found) return { ok: false, reason: "Quote not found in the candidate's documents." };
  if (citedDoc && citedDoc !== found) return { ok: false, reason: `Quote not found in the cited ${labels[citedDoc] || citedDoc}.` };
  return { ok: true, doc: found };
}

// Protected characteristics and common proxies (Equality Act 2010 categories, career breaks, photos,
// names and pay history). Any statement that relies on one is struck from the record.
export const PROTECTED_TERMS = [
  { category: "age", label: "age or an age proxy", pattern: "\\b(?:age|aged|ageing|aging|years old|older|younger|young|senior in years|energy levels|overqualified|digital native|millennial|boomer|gen z|retire|retirement|graduated (?:in )?(?:19|20)\\d\\d)\\b" },
  { category: "gender", label: "gender or sex", pattern: "\\b(?:gender|male|female|woman|women|man|men|maternity|paternity|pregnant|pregnancy|mother|father|motherhood|fatherhood)\\b" },
  { category: "family", label: "family status", pattern: "\\b(?:children|child|childcare|kids|school run|primary school|family|families|married|marital|spouse|husband|wife|caring responsibilities|carer|dependants?)\\b" },
  { category: "career-break", label: "a career break", pattern: "\\b(?:career break|career gap|employment gap|gap in (?:their |the )?(?:cv|employment|career)|time out of work|time away from work)\\b" },
  { category: "nationality", label: "nationality, ethnicity or religion", pattern: "\\b(?:nationality|national origin|native speaker|accent|foreign|ethnic|ethnicity|race|racial|religion|religious|immigrant|immigration|visa)\\b" },
  { category: "appearance", label: "a photo or appearance", pattern: "\\b(?:photo|photograph|appearance|attractive|looks young|looks old)\\b" },
  { category: "name", label: "the candidate's name as a proxy", pattern: "\\b(?:name suggests|name sounds|sounds foreign|surname|first name)\\b" },
  { category: "health", label: "health or disability", pattern: "\\b(?:disability|disabled|health condition|illness|sick leave|medical)\\b" },
  { category: "pay-history", label: "previous pay", pattern: "\\b(?:(?:previous|current|last|past|existing) (?:salary|pay|compensation|earnings)|salary history|currently earns|pay history)\\b" }
].map((term) => ({ ...term, regex: new RegExp(term.pattern, "i") }));

export function findProtected(text) {
  const value = normalise(text);
  for (const term of PROTECTED_TERMS) {
    const match = value.match(term.regex);
    if (match) return { category: term.category, label: term.label, term: match[0] };
  }
  return null;
}

export function splitSentences(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“‘(])/)
    .filter(Boolean);
}

// Splits an agent's message into sentences and strikes any that rely on a protected characteristic.
// The Auditor is exempt: it names these characteristics in order to challenge them.
export function screenMessage(text, agentId) {
  return splitSentences(text).map((sentence) => {
    if (agentId === "auditor") return { text: sentence, struck: null };
    const hit = findProtected(sentence);
    return { text: sentence, struck: hit ? `Struck: refers to ${hit.label} (“${hit.term}”)` : null };
  });
}

// Before the debate, code screens the candidate documents: passages that mention a protected
// characteristic are struck from the record. Assessors see the redacted text; the Auditor sees the
// original, so it can confirm nothing slipped through. Quotes are still verified against the original.
export const REDACTION = "[passage removed by the protected-characteristic screen]";

export function screenDocuments(documents) {
  const passages = [];
  const redacted = {};
  for (const [doc, text] of Object.entries(documents)) {
    const sentences = screenMessage(text, "screen");
    sentences.filter((s) => s.struck).forEach((s) => passages.push({ doc, text: s.text, struck: s.struck }));
    redacted[doc] = sentences.map((s) => (s.struck ? REDACTION : s.text)).join(" ");
  }
  return { passages, redacted };
}

// Pay figures in the Compensation Analyst's words must be ones the code computed.
export function moneyFigures(text) {
  const figures = [];
  const pattern = /£\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k\b)?/gi;
  for (const match of String(text ?? "").matchAll(pattern)) {
    const base = Number(match[1].replace(/,/g, ""));
    figures.push(match[2] ? Math.round(base * 1000) : base);
  }
  return figures;
}

export function checkFigures(sentences, allowed) {
  const allowedSet = new Set(allowed);
  return sentences.map((s) => {
    if (s.struck) return s;
    const wrong = moneyFigures(s.text).find((value) => !allowedSet.has(value));
    return wrong === undefined ? s : { ...s, struck: `Struck: £${wrong.toLocaleString("en-GB")} is not a figure computed by the pay policy` };
  });
}
