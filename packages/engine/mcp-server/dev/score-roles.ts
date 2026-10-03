/**
 * Score the code role rule against the roles the MODEL assigned, over the
 * committed e2e corpus. OFFLINE and deterministic — reads
 * `dev/fixtures/role-scorer-corpus.json`, which `dev/fetch-role-corpus.ts`
 * builds live.
 *
 * This is issue #2937's acceptance check 3: the rule must reproduce **≥ 80%**
 * role-class agreement.
 *
 * ## What "agreement" means here, and what it does not
 *
 * Agreement is measured by role CLASS, not by exact token: `child_1` and
 * `child_3` are the same answer to the question this rule exists to answer, and
 * numbering differences are not disagreements about who someone is. The classes
 * are below.
 *
 * **Agreement is not accuracy.** The model is not ground truth — the issue's own
 * sample of 30 disagreements found 10 cases of the model inventing kin on a
 * pre-1880 census and 7 plain errors, all of which count as disagreements here
 * and are cases where the RULE is right. So a figure below 100% is expected, and
 * a figure near 100% would be evidence the rule had learned the model's mistakes.
 * Read the per-record-type breakdown, not the headline.
 *
 * ## Two clusters that are the MODEL's error, checked
 *
 * Both were opened rather than assumed, because a large cluster normally means a
 * rule gap:
 *
 *   - **`model=principal rule=child`** — records from "Liechtenstein, Births and
 *     Baptisms, 1650-1875" carrying a `Christening` fact and nothing else. The
 *     rule types them `christening` and roles the subject `child`; the model
 *     called the subject `deceased` and the parents `father_of_deceased` /
 *     `mother_of_deceased`, on a baptism. `deceased` on a baptism is named
 *     verbatim in the issue's own sample of 30 as a plain model error.
 *   - **`model=child rule=household_member` / `rule=head_of_household`** —
 *     pre-1880 censuses, where the model assigned `child_N` from position. That
 *     is the doctrine's headline prohibition and the issue's largest error class
 *     (10 of its 30).
 *
 * Neither is a rule defect, and both depress the headline. That is the right
 * direction for this instrument to be wrong in.
 *
 * Run: `npx tsx dev/score-roles.ts [--verbose]` from
 * `packages/engine/mcp-server`.
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractRecord, type ExtractDocument } from "../src/utils/record-extract.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, "fixtures", "role-scorer-corpus.json");

/** The threshold issue #2937 sets. */
const THRESHOLD = 0.8;

/**
 * Role → class. Numbering is stripped, and tokens that answer the same question
 * collapse: the rule and the model disagreeing between `household_member_2` and
 * `boarder_1` is a naming difference, not a claim about who the person is.
 */
function roleClass(role: string): string {
  const r = role.trim().toLowerCase().replace(/_\d+$/, "").replace(/_inferred$/, "");
  if (/^head(_of_household)?$|^self$/.test(r)) return "head";
  if (/^wife$|^husband$|^spouse$/.test(r)) return "spouse";
  if (/^child$|^son$|^daughter$/.test(r)) return "child";
  if (/^(father|mother|parent)(_of_\w+)?$/.test(r)) return "parent";
  if (/^grand(father|mother|parent)/.test(r)) return "grandparent";
  if (/^household_member$|^boarder$|^lodger$|^servant$|^inmate$/.test(r)) {
    return "household_member";
  }
  if (/^groom$|^bride$|^deceased$|^principal$|^registrant$|^subject$/.test(r)) {
    return "principal";
  }
  if (/^witness$/.test(r)) return "witness";
  if (/^informant$/.test(r)) return "informant";
  if (/^godparent$|^sponsor$/.test(r)) return "godparent";
  if (/^absent$/.test(r)) return "absent";
  return "other";
}

interface Row {
  recordId: string;
  recordType: string;
  personaId: string;
  model: string;
  rule: string;
  agree: boolean;
}

function main(): void {
  if (!existsSync(CORPUS)) {
    console.error(
      `no corpus at ${CORPUS}\nRun \`npx tsx dev/fetch-role-corpus.ts\` first (live, billed).`,
    );
    process.exit(2);
  }
  const verbose = process.argv.includes("--verbose");
  const records: Record<string, any> = JSON.parse(readFileSync(CORPUS, "utf8")).records ?? {};

  const rows: Row[] = [];
  let recordsScored = 0;
  let recordsSkipped = 0;

  for (const [recordId, entry] of Object.entries(records)) {
    const modelRoles: Record<string, string> = entry.modelRoles ?? {};
    if (Object.keys(modelRoles).length === 0) {
      recordsSkipped++;
      continue;
    }
    const doc: ExtractDocument = {
      recordId,
      gedcomx: entry.gedcomx ?? {},
      indexFields: entry.indexFields,
    };
    const out = extractRecord(doc, { logEntryId: "l", questionIds: [] });
    // The rule's role per persona, read off the assertions it produced.
    const ruleRoles = new Map<string, string>();
    for (const a of out.assertions) {
      if (a.record_persona_id && !ruleRoles.has(a.record_persona_id)) {
        ruleRoles.set(a.record_persona_id, a.record_role);
      }
    }
    let any = false;
    for (const [persona, modelRole] of Object.entries(modelRoles)) {
      const ruleRole = ruleRoles.get(persona);
      // A persona the rule produced nothing for cannot be compared — it is
      // absent from the record the rule read, which is a join failure, not a
      // disagreement. Counted separately so it cannot flatter the rate.
      if (!ruleRole) continue;
      any = true;
      rows.push({
        recordId,
        recordType: out.recordType,
        personaId: persona,
        model: modelRole,
        rule: ruleRole,
        agree: roleClass(modelRole) === roleClass(ruleRole),
      });
    }
    if (any) recordsScored++;
    else recordsSkipped++;
  }

  if (rows.length === 0) {
    console.error("NOTHING SCORED — the corpus produced no comparable personas.");
    console.error("A clean zero here is a broken join, not a passing rule.");
    process.exit(2);
  }

  const agreed = rows.filter((r) => r.agree).length;
  const rate = agreed / rows.length;

  // Denominators first: a rate with no denominator is unreadable, and a
  // silently-empty scan prints a cheerful number.
  console.log(`records in corpus:   ${Object.keys(records).length}`);
  console.log(`records scored:      ${recordsScored}`);
  console.log(`records with nothing comparable: ${recordsSkipped}`);
  console.log(`persona comparisons: ${rows.length}`);
  console.log("");

  const byType = new Map<string, { n: number; ok: number }>();
  for (const r of rows) {
    const b = byType.get(r.recordType) ?? { n: 0, ok: 0 };
    b.n++;
    if (r.agree) b.ok++;
    byType.set(r.recordType, b);
  }
  console.log("role-class agreement by record type:");
  for (const [t, b] of [...byType].sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      `  ${t.padEnd(20)} ${String(b.ok).padStart(5)}/${String(b.n).padEnd(5)} ` +
        `${((b.ok / b.n) * 100).toFixed(1)}%`,
    );
  }

  // The commonest disagreements, which is the actionable output: a cluster here
  // is either a rule gap or a known model error, and the two look different.
  const pairs = new Map<string, number>();
  for (const r of rows.filter((x) => !x.agree)) {
    const k = `model=${roleClass(r.model)} rule=${roleClass(r.rule)}`;
    pairs.set(k, (pairs.get(k) ?? 0) + 1);
  }
  console.log("\ntop disagreements (model class vs rule class):");
  for (const [k, n] of [...pairs].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(n).padStart(5)}  ${k}`);
  }

  if (verbose) {
    console.log("\nevery disagreement:");
    for (const r of rows.filter((x) => !x.agree)) {
      console.log(`  ${r.recordId} ${r.personaId} model=${r.model} rule=${r.rule}`);
    }
  }

  console.log(
    `\nROLE-CLASS AGREEMENT: ${agreed}/${rows.length} = ${(rate * 100).toFixed(1)}% ` +
      `(threshold ${(THRESHOLD * 100).toFixed(0)}%)`,
  );
  console.log(
    "Agreement is not accuracy: the model is not ground truth, and known model " +
      "errors (kin invented on a pre-1880 census) count as disagreements here.",
  );

  if (rate < THRESHOLD) {
    console.log("\nBELOW THRESHOLD — report the per-type breakdown above, do not lower the bar.");
    process.exit(1);
  }
}

main();
