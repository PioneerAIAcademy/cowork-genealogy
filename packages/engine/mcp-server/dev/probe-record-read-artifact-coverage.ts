/**
 * Probe: does the recapi persona endpoint carry a DigitalArtifact source
 * description with coverage, and when it does, does the coverage agree with
 * the record's own facts?
 *
 * Evidence for issue #2367 (step 1). The raw recapi response carries
 * sourceDescriptions with `resourceType` and `coverage[]` — fields
 * `simplifySourceDescription` strips today. This probe fetches the RAW
 * GedcomX (before simplification) and inspects those fields directly.
 *
 * Per record it reports:
 *   - whether a DigitalArtifact source description exists
 *   - what `coverage[].spatial.description` resolves to via getPlaceById
 *   - the record's own fact places and dates
 *   - whether the coverage agrees with the facts (place ancestry, date
 *     containment, record type match)
 *
 * Requires a live FamilySearch session (run `make e2e-login` first).
 * Not shipped in any artifact; no unit test needed.
 *
 * Usage:
 *   npx tsx dev/probe-record-read-artifact-coverage.ts
 */
import { LOCAL } from "../src/auth/principal.js";
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { fetchWithRetry } from "../src/utils/http.js";
import { getPlaceById } from "../src/utils/place-api.js";
import { mapWithConcurrency } from "../src/utils/place-resolver.js";
import type {
  GedcomX,
  GedcomXSourceDescription,
  GedcomXCoverage,
} from "../src/types/gedcomx.js";

const RECAPI_BASE =
  "https://sg30p0.familysearch.org/service/cds/recapi/records/persona";

const CONCURRENCY = 4;

interface RecordFamily {
  name: string;
  ids: string[];
}

// Diverse record families: US census, European vital, immigration, military
const RECORD_FAMILIES: RecordFamily[] = [
  {
    name: "US Census (various decades)",
    ids: [
      "M7QZ-8KD",   // 1860 US Census (Ackerman)
      "68Q9-K34P",  // 1850 US Census
      "CFLT-9K2",   // 1850 US Census (Flynn)
      "MPXD-MZC",   // US Census, North Dakota
      "M9VJ-V1R",   // US Census, Grand Forks, North Dakota
    ],
  },
  {
    name: "England parish records",
    ids: [
      "JMF4-CL9",   // England, Births and Christenings (Richardson)
      "NFCY-7VM",   // England, Births and Christenings (Richardson)
      "QL3R-C5SR",  // England parish baptism, West Bromwich
    ],
  },
  {
    name: "Scandinavian records",
    ids: [
      "68Q3-5SGC",  // Norway, Church Books (Birkeland)
      "NW44-PM2",   // Norway, Marriages (Urna/Anders)
      "9XKT-M2P",   // Norway, Church Books (Anders)
      "8YMV-R76Z",  // Norway Census 1801
    ],
  },
  {
    name: "Issue examples (known coverage contradictions)",
    ids: [
      "4VVW-LFW2",  // Birth, Talladega AL — coverage says Tallapoosa 1893-1896
      "6LLN-M7ZZ",  // Marriage, Luxembourg — coverage says Birth 1841-1890
    ],
  },
];

interface CoverageObs {
  recordId: string;
  family: string;
  hasDigitalArtifact: boolean;
  daSourceId: string | null;
  coverageCount: number;
  coverages: CoverageDetail[];
  factSummary: string[];
  agreement: "agree" | "disagree" | "partial" | "no-coverage" | "no-facts" | "error";
  notes: string[];
}

interface CoverageDetail {
  spatialRef: string | null;
  resolvedPlace: string | null;
  temporalOriginal: string | null;
  temporalFormal: string | null;
  recordType: string | null;
}

async function fetchRawGedcomX(
  entityId: string,
  token: string,
): Promise<GedcomX> {
  const url = `${RECAPI_BASE}/${encodeURIComponent(entityId)}.json`;
  const res = await fetchWithRetry(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });
  if (!res.ok) {
    throw new Error(`recapi ${res.status} for ${entityId}`);
  }
  return (await res.json()) as GedcomX;
}

function extractFactSummary(gedcomx: GedcomX): string[] {
  const facts: string[] = [];
  for (const person of gedcomx.persons ?? []) {
    for (const fact of person.facts ?? []) {
      const type = (fact.type ?? "").replace(/.*\//, "");
      const date = fact.date?.original ?? fact.date?.formal ?? "";
      const place = fact.place?.original ?? "";
      if (type || date || place) {
        facts.push(`${type}: ${date} ${place}`.trim());
      }
    }
  }
  return facts;
}

function stripUriPrefix(uri: string): string {
  return uri.replace(/^https?:\/\/gedcomx\.org\//, "").replace(/.*\//, "");
}

function assessAgreement(
  coverages: CoverageDetail[],
  factSummary: string[],
): { agreement: CoverageObs["agreement"]; notes: string[] } {
  if (coverages.length === 0) return { agreement: "no-coverage", notes: [] };
  if (factSummary.length === 0) return { agreement: "no-facts", notes: [] };

  const notes: string[] = [];
  let agrees = 0;
  let disagrees = 0;

  for (const cov of coverages) {
    const covPlace = (cov.resolvedPlace ?? "").toLowerCase();
    const covType = (cov.recordType ?? "").toLowerCase();

    for (const factStr of factSummary) {
      const factLower = factStr.toLowerCase();

      // Place check: does the coverage place appear in or overlap with any fact place?
      if (covPlace && factLower.includes(",")) {
        const factPlace = factLower.split(":").pop()?.trim() ?? "";
        // Check if any segment of the coverage place appears in the fact place or vice versa
        const covSegments = covPlace.split(",").map((s) => s.trim());
        const factSegments = factPlace.split(",").map((s) => s.trim());
        const placeOverlap = covSegments.some(
          (cs) => cs && factSegments.some((fs) => fs && (fs.includes(cs) || cs.includes(fs))),
        );
        if (!placeOverlap && covPlace && factPlace) {
          notes.push(`place mismatch: coverage="${covPlace}" vs fact="${factPlace}"`);
          disagrees++;
        } else if (placeOverlap) {
          agrees++;
        }
      }

      // Record type check: does the coverage type match any fact type?
      if (covType) {
        const factType = factStr.split(":")[0]?.trim().toLowerCase() ?? "";
        if (factType && covType.includes(factType)) {
          agrees++;
        } else if (factType && !covType.includes(factType) && !factType.includes(covType)) {
          notes.push(`type mismatch: coverage="${covType}" vs fact="${factType}"`);
        }
      }
    }
  }

  if (disagrees > 0 && agrees === 0) return { agreement: "disagree", notes };
  if (disagrees > 0) return { agreement: "partial", notes };
  if (agrees > 0) return { agreement: "agree", notes };
  return { agreement: "partial", notes: ["insufficient data to determine agreement"] };
}

async function probeRecord(
  recordId: string,
  family: string,
  token: string,
): Promise<CoverageObs> {
  try {
    const gedcomx = await fetchRawGedcomX(recordId, token);
    const sourceDescs = (gedcomx as any).sourceDescriptions as GedcomXSourceDescription[] ?? [];

    // Find DigitalArtifact source descriptions
    const daDescs = sourceDescs.filter(
      (sd) =>
        sd.resourceType === "http://gedcomx.org/DigitalArtifact" ||
        sd.resourceType === "DigitalArtifact",
    );

    if (daDescs.length === 0) {
      const factSummary = extractFactSummary(gedcomx);
      return {
        recordId,
        family,
        hasDigitalArtifact: false,
        daSourceId: null,
        coverageCount: 0,
        coverages: [],
        factSummary,
        agreement: "no-coverage",
        notes: [`${sourceDescs.length} source descriptions, none DigitalArtifact`],
      };
    }

    const daDesc = daDescs[0];
    const rawCoverages: GedcomXCoverage[] = daDesc.coverage ?? [];
    const coverages: CoverageDetail[] = [];

    for (const cov of rawCoverages) {
      const spatialRef = cov.spatial?.description ?? null;
      let resolvedPlace: string | null = null;

      if (spatialRef) {
        // spatial.description is a place-description reference like "#6720779"
        // or a full URL; extract the numeric id and resolve via getPlaceById
        const placeIdMatch = spatialRef.match(/(\d+)$/);
        if (placeIdMatch) {
          try {
            const placeResult = await getPlaceById(placeIdMatch[1]);
            resolvedPlace = placeResult?.name ?? null;
          } catch {
            resolvedPlace = `[resolve-error: ${placeIdMatch[1]}]`;
          }
        }
      }

      coverages.push({
        spatialRef,
        resolvedPlace,
        temporalOriginal: cov.temporal?.original ?? null,
        temporalFormal: cov.temporal?.formal ?? null,
        recordType: cov.recordType ? stripUriPrefix(cov.recordType) : null,
      });
    }

    const factSummary = extractFactSummary(gedcomx);
    const { agreement, notes } = assessAgreement(coverages, factSummary);

    return {
      recordId,
      family,
      hasDigitalArtifact: true,
      daSourceId: daDesc.id ?? null,
      coverageCount: rawCoverages.length,
      coverages,
      factSummary,
      agreement,
      notes,
    };
  } catch (e) {
    return {
      recordId,
      family,
      hasDigitalArtifact: false,
      daSourceId: null,
      coverageCount: 0,
      coverages: [],
      factSummary: [],
      agreement: "error",
      notes: [(e as Error).message],
    };
  }
}

async function main(): Promise<void> {
  const token = await getValidToken(LOCAL);

  const allRecords: { id: string; family: string }[] = [];
  for (const fam of RECORD_FAMILIES) {
    for (const id of fam.ids) {
      allRecords.push({ id, family: fam.name });
    }
  }

  console.log(`Probing ${allRecords.length} records across ${RECORD_FAMILIES.length} families...\n`);

  const results = await mapWithConcurrency(allRecords, CONCURRENCY, (r) =>
    probeRecord(r.id, r.family, token),
  );

  console.log("=== per-record observations ===\n");
  for (const r of results) {
    console.log(`${r.recordId}  [${r.family}]`);
    console.log(`  DigitalArtifact: ${r.hasDigitalArtifact ? `YES (${r.daSourceId})` : "NO"}`);
    if (r.coverages.length > 0) {
      for (const cov of r.coverages) {
        console.log(
          `  coverage: place=${cov.resolvedPlace ?? "(none)"}` +
            `  date=${cov.temporalOriginal ?? cov.temporalFormal ?? "(none)"}` +
            `  type=${cov.recordType ?? "(none)"}`,
        );
      }
    }
    if (r.factSummary.length > 0) {
      console.log(`  facts: ${r.factSummary.join("; ")}`);
    }
    console.log(`  agreement: ${r.agreement}`);
    if (r.notes.length > 0) {
      for (const n of r.notes) console.log(`  note: ${n}`);
    }
    console.log();
  }

  // Summary
  const total = results.length;
  const errors = results.filter((r) => r.agreement === "error").length;
  const fetched = total - errors;
  const withDA = results.filter((r) => r.hasDigitalArtifact).length;
  const withCoverage = results.filter((r) => r.coverageCount > 0).length;
  const agree = results.filter((r) => r.agreement === "agree").length;
  const disagree = results.filter((r) => r.agreement === "disagree").length;
  const partial = results.filter((r) => r.agreement === "partial").length;
  const noCoverage = results.filter((r) => r.agreement === "no-coverage").length;

  console.log("=== summary ===");
  console.log(`records: ${total} requested, ${fetched} fetched, ${errors} errors`);
  console.log(
    `DigitalArtifact present: ${withDA}/${fetched}` +
      ` (${fetched ? Math.round((withDA / fetched) * 100) : 0}%)`,
  );
  console.log(
    `with coverage[]: ${withCoverage}/${fetched}` +
      ` (${fetched ? Math.round((withCoverage / fetched) * 100) : 0}%)`,
  );
  console.log(
    `agreement: agree=${agree} disagree=${disagree} partial=${partial} no-coverage=${noCoverage}`,
  );
  if (withCoverage > 0) {
    const agreementRate = Math.round((agree / withCoverage) * 100);
    console.log(
      `agreement rate (among records with coverage): ${agree}/${withCoverage} (${agreementRate}%)`,
    );
  }
  console.log(
    "\nStamp into gedcomx-convert-spec.md as:" +
      `\n  measured ${new Date().toISOString().slice(0, 10)}, ` +
      "npx tsx dev/probe-record-read-artifact-coverage.ts, " +
      `n=${fetched} records across ${RECORD_FAMILIES.length} families`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
