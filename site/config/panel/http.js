// Request validation and responses for the Hiring Panel Function.

import { ROLES, CANDIDATES } from "./data.js";
import { MODES } from "./protocol.js";

const MAX_BODY_BYTES = 64 * 1024;

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

const onlyKeys = (obj, keys) => Object.keys(obj).every((key) => keys.includes(key));

// Two shapes only: { start: { roleId, candidateId, mode } } or { state }. Visitors pick IDs from
// allow-lists; there is no free-text field anywhere, so nothing a visitor types can reach the model.
export async function parseTurnRequest(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { error: "Request body is too large." };
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { error: "Body must be valid JSON." };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Body must be a JSON object." };
  if (body.start !== undefined) {
    const s = body.start;
    if (!onlyKeys(body, ["start"]) || !s || typeof s !== "object" || !onlyKeys(s, ["roleId", "candidateId", "mode"])) return { error: "Only start.roleId, start.candidateId and start.mode are accepted." };
    if (typeof s.roleId !== "string" || !Object.hasOwn(ROLES, s.roleId)) return { error: "Unknown roleId." };
    if (typeof s.candidateId !== "string" || !Object.hasOwn(CANDIDATES, s.candidateId)) return { error: "Unknown candidateId." };
    if (s.mode !== undefined && !MODES.includes(s.mode)) return { error: "Unknown mode." };
    return { start: { roleId: s.roleId, candidateId: s.candidateId, mode: s.mode } };
  }
  if (!onlyKeys(body, ["state"]) || body.state === undefined) return { error: "Send either start or state." };
  return { state: body.state };
}

export function recordingPath(roleId, candidateId) {
  return `/demos/hiring-panel/recordings/${roleId}--${candidateId}.json`;
}
