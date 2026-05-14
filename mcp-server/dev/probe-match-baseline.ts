/// <reference types="node" />
/**
 * Probe 1 — matchTwoExamples baseline: does the endpoint work, and
 * what does the response actually look like?
 *
 * Endpoint:
 *   POST https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples?minConfidence=2
 *
 * Goal: hit the endpoint with the literal example payload from issue
 * #10 (two extractions of the same Hufenreuter family, with different
 * ARK IDs in each entry) and capture the response so we can see:
 *   - HTTP status (200? 4xx?)
 *   - Response headers (rate limit hints, content-type)
 *   - Full body — does it return a single score, a per-person mapping,
 *     a yes/no decision, an explanation? Unknown.
 *   - What the `?minConfidence=2` query param actually does to the
 *     response.
 *
 * Auth: same OAuth bearer token used by `collections` and `search`
 * (via getValidToken). Same browser-style User-Agent to clear the WAF.
 *
 * Open Q for later probes (not this one):
 *   - Probe 2: non-match payload (different people) — what does that
 *     look like?
 *   - Probe 3: partial input (one entry missing parents) — does it
 *     still match?
 *   - Probe 4: symmetric? swap entries — same result?
 *   - Probe 5: minConfidence semantics — try 0, 1, 5, 10 and compare.
 */
import { getValidToken } from "../src/auth/refresh.js";

// Defaults to production. Override for Beta:
//   FS_MATCH_URL=https://beta.familysearch.org/service/search/record/collections/match/matchTwoExamples
const URL_BASE =
  process.env.FS_MATCH_URL ??
  "https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples";

// Default to the same browser-style Mozilla UA used by collections.ts and
// search.ts in production — this is the UA that passes Imperva WAF.
// The issue suggested "fs-search-agent" but that string is WAF-flagged.
// Override for experiments via FS_UA.
const USER_AGENT =
  process.env.FS_UA ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

// For one-off probes, pass an access token via FS_ACCESS_TOKEN (e.g., the
// Beta-environment token from the FS dev portal). Falls back to the
// canonical getValidToken() path (reads ~/.familysearch-mcp/tokens.json).
async function getToken(): Promise<string> {
  if (process.env.FS_ACCESS_TOKEN) {
    return process.env.FS_ACCESS_TOKEN;
  }
  return getValidToken();
}

// Literal payload from issue #10 — two extractions of the Hufenreuter
// family (Johann Georg b. 1758, his parents Johann Tobias and Elisabeth)
// with different ARK IDs in each entry.
const PAYLOAD = {
  entries: [
    {
      content: {
        gedcomx: {
          persons: [
            {
              gender: { type: "http://gedcomx.org/Male" },
              names: [
                {
                  preferred: true,
                  nameForms: [
                    {
                      fullText: "Johann Georg Hufenreuter",
                      parts: [
                        { type: "http://gedcomx.org/Given", value: "Johann Georg" },
                        { type: "http://gedcomx.org/Surname", value: "Hufenreuter" },
                      ],
                    },
                  ],
                  type: "http://gedcomx.org/BirthName",
                },
              ],
              facts: [
                {
                  date: { original: "11Jan1758", formal: "+1758-01-11" },
                  place: { original: "Biesenrode, Schsn, Prss" },
                  type: "http://gedcomx.org/Birth",
                },
              ],
              id: "id1",
              identifiers: {
                "http://gedcomx.org/Persistent": [
                  "https://familysearch.org/ark:/61903/4:1:KGS8-LY1",
                ],
              },
              putativeGender: [{ type: "http://gedcomx.org/Male" }],
            },
            {
              gender: { type: "http://gedcomx.org/Male" },
              names: [
                {
                  preferred: true,
                  nameForms: [
                    {
                      fullText: "Johann Tobias Hufenreuter",
                      parts: [
                        { type: "http://gedcomx.org/Given", value: "Johann Tobias" },
                        { type: "http://gedcomx.org/Surname", value: "Hufenreuter" },
                      ],
                    },
                  ],
                  type: "http://gedcomx.org/BirthName",
                },
              ],
              facts: [
                {
                  date: { original: "16Mar1721", formal: "+1721-03-16" },
                  place: { original: "Biesenrode, Schsn, Prss" },
                  type: "http://gedcomx.org/Birth",
                },
              ],
              id: "ark:/61903/4:1:KGS8-LY7",
              identifiers: {
                "http://gedcomx.org/Persistent": [
                  "https://familysearch.org/ark:/61903/4:1:KGS8-LY7",
                ],
              },
              putativeGender: [{ type: "http://gedcomx.org/Male" }],
            },
            {
              gender: { type: "http://gedcomx.org/Female" },
              names: [
                {
                  preferred: true,
                  nameForms: [
                    {
                      fullText: "Elisabeth Henrica Dorothea",
                      parts: [
                        {
                          type: "http://gedcomx.org/Given",
                          value: "Elisabeth Henrica Dorothea",
                        },
                      ],
                    },
                  ],
                  type: "http://gedcomx.org/BirthName",
                },
              ],
              facts: [
                {
                  date: { original: "1720", formal: "+1720" },
                  place: { original: "Biesenrode, Schsn, Prss" },
                  type: "http://gedcomx.org/Birth",
                },
                {
                  date: { original: "16May1780", formal: "+1780-05-16" },
                  place: { original: "Biesenrode, Schsn, Prss" },
                  type: "http://gedcomx.org/Burial",
                },
              ],
              id: "ark:/61903/4:1:KGS8-LYC",
              identifiers: {
                "http://gedcomx.org/Persistent": [
                  "https://familysearch.org/ark:/61903/4:1:KGS8-LYC",
                ],
              },
              putativeGender: [{ type: "http://gedcomx.org/Female" }],
            },
          ],
          relationships: [
            {
              person1: {
                resource: "#ark:/61903/4:1:KGS8-LY7",
                resourceId: "KGS8-LY7",
              },
              person2: {
                resource: "#ark:/61903/4:1:KGS8-LY1",
                resourceId: "KGS8-LY1",
              },
              type: "http://gedcomx.org/ParentChild",
            },
            {
              person1: {
                resource: "#ark:/61903/4:1:KGS8-LYC",
                resourceId: "KGS8-LYC",
              },
              person2: {
                resource: "#ark:/61903/4:1:KGS8-LY1",
                resourceId: "KGS8-LY1",
              },
              type: "http://gedcomx.org/ParentChild",
            },
          ],
        },
      },
    },
    {
      content: {
        gedcomx: {
          persons: [
            {
              gender: { type: "http://gedcomx.org/Male" },
              names: [
                {
                  preferred: true,
                  nameForms: [
                    {
                      fullText: "Johann Georg Hufenreuter",
                      parts: [
                        { type: "http://gedcomx.org/Given", value: "Johann Georg" },
                        { type: "http://gedcomx.org/Surname", value: "Hufenreuter" },
                      ],
                    },
                  ],
                  type: "http://gedcomx.org/BirthName",
                },
              ],
              facts: [
                {
                  date: { original: "11Jan1758", formal: "+1758-01-11" },
                  place: { original: "Biesenrode, Schsn, Prss" },
                  type: "http://gedcomx.org/Birth",
                },
              ],
              id: "ark:/61903/4:1:KCWM-J9H",
              identifiers: {
                "http://gedcomx.org/Persistent": [
                  "https://familysearch.org/ark:/61903/4:1:KCWM-J9H",
                ],
              },
              putativeGender: [{ type: "http://gedcomx.org/Male" }],
            },
            {
              gender: { type: "http://gedcomx.org/Male" },
              names: [
                {
                  preferred: true,
                  nameForms: [
                    {
                      fullText: "Johann Tobias Hufenreuter",
                      parts: [
                        { type: "http://gedcomx.org/Given", value: "Johann Tobias" },
                        { type: "http://gedcomx.org/Surname", value: "Hufenreuter" },
                      ],
                    },
                  ],
                  type: "http://gedcomx.org/BirthName",
                },
              ],
              facts: [
                {
                  date: { original: "16Mar1721", formal: "+1721-03-16" },
                  place: { original: "Biesenrode, Schsn, Prss" },
                  type: "http://gedcomx.org/Birth",
                },
              ],
              id: "ark:/61903/4:1:KDBD-Y1Q",
              identifiers: {
                "http://gedcomx.org/Persistent": [
                  "https://familysearch.org/ark:/61903/4:1:KDBD-Y1Q",
                ],
              },
              putativeGender: [{ type: "http://gedcomx.org/Male" }],
            },
            {
              gender: { type: "http://gedcomx.org/Female" },
              names: [
                {
                  preferred: true,
                  nameForms: [
                    {
                      fullText: "Elisabeth Henrica Dorothea",
                      parts: [
                        {
                          type: "http://gedcomx.org/Given",
                          value: "Elisabeth Henrica Dorothea",
                        },
                      ],
                    },
                  ],
                  type: "http://gedcomx.org/BirthName",
                },
              ],
              facts: [
                {
                  date: { original: "1720", formal: "+1720" },
                  place: { original: "Biesenrode, Schsn, Prss" },
                  type: "http://gedcomx.org/Birth",
                },
                {
                  date: { original: "16May1780", formal: "+1780-05-16" },
                  place: { original: "Biesenrode, Schsn, Prss" },
                  type: "http://gedcomx.org/Burial",
                },
              ],
              id: "ark:/61903/4:1:KH11-B46",
              identifiers: {
                "http://gedcomx.org/Persistent": [
                  "https://familysearch.org/ark:/61903/4:1:KH11-B46",
                ],
              },
              putativeGender: [{ type: "http://gedcomx.org/Female" }],
            },
          ],
          relationships: [
            {
              person1: {
                resource: "#ark:/61903/4:1:KDBD-Y1Q",
                resourceId: "KDBD-Y1Q",
              },
              person2: {
                resource: "#ark:/61903/4:1:KCWM-J9H",
                resourceId: "KCWM-J9H",
              },
              type: "http://gedcomx.org/ParentChild",
            },
            {
              person1: {
                resource: "#ark:/61903/4:1:KH11-B46",
                resourceId: "KH11-B46",
              },
              person2: {
                resource: "#ark:/61903/4:1:KCWM-J9H",
                resourceId: "KCWM-J9H",
              },
              type: "http://gedcomx.org/ParentChild",
            },
          ],
        },
      },
    },
  ],
};

function summarizeKeys(obj: unknown, prefix = "", depth = 0, maxDepth = 5): void {
  if (depth > maxDepth) return;
  if (Array.isArray(obj)) {
    console.log(`${prefix}[]  (length=${obj.length})`);
    if (obj.length > 0) {
      console.log(`${prefix}[0]:`);
      summarizeKeys(obj[0], `${prefix}  `, depth + 1, maxDepth);
    }
    return;
  }
  if (obj === null || typeof obj !== "object") {
    const sample = JSON.stringify(obj);
    const preview = sample && sample.length > 80 ? `${sample.slice(0, 77)}...` : sample;
    console.log(`${prefix}<${typeof obj}> = ${preview}`);
    return;
  }
  const o = obj as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const v = o[k];
    const t = Array.isArray(v) ? `[]:${v.length}` : v === null ? "null" : typeof v;
    const inline = ["string", "number", "boolean"].includes(typeof v)
      ? ` = ${JSON.stringify(v).slice(0, 80)}`
      : "";
    console.log(`${prefix}${k}  <${t}>${inline}`);
    if (v && typeof v === "object" && depth < maxDepth) {
      summarizeKeys(v, `${prefix}  `, depth + 1, maxDepth);
    }
  }
}

async function main(): Promise<void> {
  const token = await getToken();
  const url = `${URL_BASE}?minConfidence=2`;

  console.log(`POST ${url}`);
  console.log("---");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(PAYLOAD),
  });

  console.log(`Status: ${response.status} ${response.statusText}`);
  console.log("Response headers:");
  for (const [k, v] of response.headers.entries()) {
    console.log(`  ${k}: ${v}`);
  }
  console.log("---");

  const rawText = await response.text();
  console.log(`Body length: ${rawText.length} bytes`);
  console.log("Raw body:");
  console.log(rawText);

  if (rawText.trim().startsWith("{") || rawText.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(rawText);
      console.log("---");
      console.log("Parsed structure (key shape):");
      summarizeKeys(parsed);
    } catch (e) {
      console.log("---");
      console.log("(body looked JSON-ish but failed to parse:", (e as Error).message, ")");
    }
  }
}

await main();
