/**
 * Probe — measure data loss when round-tripping a matchTwoExamples
 * request body through toSimplified → toGedcomX.
 *
 * The matchTwoExamples endpoint
 * (POST /service/search/record/collections/match/matchTwoExamples)
 * is a record-search persona shape that carries Person.identifiers
 * (persistent ARK URLs) and other fields outside the tree/cets subset
 * the converter was originally specified for. This probe loads a real
 * request body, runs each entry's `content.gedcomx` through the
 * converter, and diffs the result against the original to enumerate
 * every dropped or mutated field.
 *
 * Output: stdout. Run with:
 *   cd mcp-server && npx tsx dev/probe-gedcomx-roundtrip.ts
 */
import { toSimplified, toGedcomX } from "../src/utils/gedcomx-convert.js";
import type { GedcomX } from "../src/types/gedcomx.js";

// ─── matchTwoExamples request body (verbatim sample) ───

const matchEntries: { content: { gedcomx: Record<string, unknown> } }[] = [
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
                      { type: "http://gedcomx.org/Given", value: "Elisabeth Henrica Dorothea" },
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
            person1: { resource: "#ark:/61903/4:1:KGS8-LY7", resourceId: "KGS8-LY7" },
            person2: { resource: "#ark:/61903/4:1:KGS8-LY1", resourceId: "KGS8-LY1" },
            type: "http://gedcomx.org/ParentChild",
          },
          {
            person1: { resource: "#ark:/61903/4:1:KGS8-LYC", resourceId: "KGS8-LYC" },
            person2: { resource: "#ark:/61903/4:1:KGS8-LY1", resourceId: "KGS8-LY1" },
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
                      { type: "http://gedcomx.org/Given", value: "Elisabeth Henrica Dorothea" },
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
            person1: { resource: "#ark:/61903/4:1:KDBD-Y1Q", resourceId: "KDBD-Y1Q" },
            person2: { resource: "#ark:/61903/4:1:KCWM-J9H", resourceId: "KCWM-J9H" },
            type: "http://gedcomx.org/ParentChild",
          },
          {
            person1: { resource: "#ark:/61903/4:1:KH11-B46", resourceId: "KH11-B46" },
            person2: { resource: "#ark:/61903/4:1:KCWM-J9H", resourceId: "KCWM-J9H" },
            type: "http://gedcomx.org/ParentChild",
          },
        ],
      },
    },
  },
];

// ─── Loss enumeration ──────────────────────────────────────────────────

interface Diff {
  path: string;
  status: "DROPPED" | "MUTATED";
  before: unknown;
  after: unknown;
}

function diff(original: unknown, roundTripped: unknown, path = ""): Diff[] {
  const diffs: Diff[] = [];

  // Identity / primitive comparison.
  if (original === roundTripped) return diffs;

  // Original missing/null but roundTripped has value → ignore (added field — not lossy).
  // We only care about loss.
  if (
    original !== null &&
    typeof original === "object" &&
    roundTripped !== null &&
    typeof roundTripped === "object"
  ) {
    if (Array.isArray(original) && Array.isArray(roundTripped)) {
      const maxLen = Math.max(original.length, roundTripped.length);
      for (let i = 0; i < maxLen; i++) {
        diffs.push(...diff(original[i], roundTripped[i], `${path}[${i}]`));
      }
      return diffs;
    }
    if (Array.isArray(original) !== Array.isArray(roundTripped)) {
      diffs.push({ path, status: "MUTATED", before: original, after: roundTripped });
      return diffs;
    }
    const origObj = original as Record<string, unknown>;
    const rtObj = roundTripped as Record<string, unknown>;
    const keys = new Set([...Object.keys(origObj), ...Object.keys(rtObj)]);
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in rtObj)) {
        diffs.push({
          path: childPath,
          status: "DROPPED",
          before: origObj[key],
          after: undefined,
        });
        continue;
      }
      if (!(key in origObj)) continue; // added — not a loss
      diffs.push(...diff(origObj[key], rtObj[key], childPath));
    }
    return diffs;
  }

  // Different primitives.
  if (original !== roundTripped) {
    diffs.push({ path, status: "MUTATED", before: original, after: roundTripped });
  }
  return diffs;
}

// ─── Main ──────────────────────────────────────────────────────────────

function summarize(diffs: Diff[]): Map<string, { count: number; sample: Diff }> {
  // Group by leaf key (last segment, stripping array indices) to deduplicate.
  const groups = new Map<string, { count: number; sample: Diff }>();
  for (const d of diffs) {
    const leaf = d.path.replace(/\[\d+\]/g, "[]");
    const existing = groups.get(leaf);
    if (existing) existing.count++;
    else groups.set(leaf, { count: 1, sample: d });
  }
  return groups;
}

let totalLosses = 0;
matchEntries.forEach((entry, idx) => {
  const original = entry.content.gedcomx as GedcomX;
  const simplified = toSimplified(original);
  const roundTripped = toGedcomX(simplified);
  const diffs = diff(original, roundTripped);
  totalLosses += diffs.length;

  console.log(`\n══ Entry ${idx} ════════════════════════════════════════════════`);
  console.log(`  persons:        ${original.persons?.length ?? 0}`);
  console.log(`  relationships:  ${original.relationships?.length ?? 0}`);
  console.log(`  losses found:   ${diffs.length}`);

  const groups = summarize(diffs);
  console.log(`\n  Grouped losses (${groups.size} unique paths):`);
  for (const [path, { count, sample }] of groups) {
    console.log(`    [${sample.status}] ${path}  ×${count}`);
    console.log(`        before: ${JSON.stringify(sample.before)}`);
    console.log(`        after:  ${JSON.stringify(sample.after)}`);
  }
});

console.log(`\n══ Summary ════════════════════════════════════════════════════`);
console.log(`Total field-level losses across both entries: ${totalLosses}`);
console.log(
  totalLosses === 0
    ? "✓ No data loss detected."
    : "✗ Data loss detected. See per-entry breakdown above.",
);
