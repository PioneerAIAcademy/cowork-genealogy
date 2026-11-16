// The claim rules of issue #3032 Stage 1b (docs/plan/conclusion-tree.md,
// research_append preconditions 1, 2 and 4-12), each in both directions.
//
// The family: child I1 (male), father I2, mother I3, rival father I4, rival
// mother I5, a sibling I6, a spouse I7. A baptism (rec_bap) names child, father
// and mother; a census (rec_cen) names I1 and I2; a marriage (rec_mar) names a
// groom and a bride; rec_abs is a negative search.
import { afterAll, describe, expect, it } from "vitest";
import { CLAIM_RULE_IDS, claimRuleFindings, questionCapFindings, type ClaimRuleId } from "../../src/validation/claim-rules.js";

/** Every rule id some case in this file made fire, so the registry check at the
 *  end proves each staged rule is one the module actually emits. */
const fired = new Set<string>();

const A = (id: string, record_id: string, record_role: string, fact_type: string, extra: Record<string, unknown> = {}) => ({
  id, record_id, source_id: `src_${record_id}`, record_role, fact_type, value: "x", record_basis: "stated", ...extra,
});
const L = (assertion_id: string, person_id: string, confidence = "confident") => ({
  id: `pe_${assertion_id}_${person_id}`, assertion_id, person_id, confidence, superseded_by: null,
});

function research(links: any[] = BASE_LINKS, extra: any[] = []) {
  return {
    assertions: [
      A("a_bc", "rec_bap", "child", "birth"),
      A("a_bf", "rec_bap", "father", "name"),
      A("a_bm", "rec_bap", "mother", "name"),
      A("a_cc", "rec_cen", "son", "residence"),
      A("a_cf", "rec_cen", "head", "residence"),
      A("a_mg", "rec_mar", "groom", "marriage"),
      A("a_mb", "rec_mar", "bride", "marriage"),
      A("a_abs", "rec_abs", "principal", "death", { record_basis: "absent" }),
      A("a_sib", "rec_sib", "child", "birth"),
      ...extra,
    ],
    person_evidence: links,
  };
}
const BASE_LINKS = [
  L("a_bc", "I1"), L("a_bf", "I2"), L("a_bm", "I3"), L("a_cc", "I1"), L("a_cf", "I2"),
  L("a_mg", "I1"), L("a_mb", "I7"), L("a_sib", "I6"),
];

const P = (id: string, gender: string) => ({ id, gender, names: [{ id: `N${id}`, given: id, surname: "X" }] });
const PC = (parent: string, child: string, subtype?: string) => ({
  id: `R_${parent}_${child}`, type: "ParentChild", parent, child, ...(subtype ? { subtype } : {}),
});
function tree(relationships: any[] = [PC("I2", "I1"), PC("I3", "I1")]) {
  return {
    persons: [P("I1", "Male"), P("I2", "Male"), P("I3", "Female"), P("I4", "Male"), P("I5", "Female"), P("I6", "Male"), P("I7", "Female")],
    relationships,
  };
}

let n = 0;
const claim = (body: Record<string, unknown>, tier = "probable", cites = ["a_bc", "a_bf"], extra: Record<string, unknown> = {}) => ({
  claim: `c${++n}`, proof_tier: tier, supporting_assertion_ids: cites, ...body, ...extra,
});
const father = (parent = "I2", child = "I1", subtype?: string) => ({
  relationship: { type: "ParentChild", parent, child, ...(subtype ? { subtype } : {}) },
});
const couple = (a = "I1", b = "I7") => ({ relationship: { type: "Couple", person1: a, person2: b } });
const fact = (subject: unknown, fact_type: string, extra: Record<string, unknown> = {}) => ({ fact: { subject, fact_type, ...extra } });
const summary = (id: string, claims: any[], tier = "probable", extra: Record<string, unknown> = {}) => ({
  id, question_id: `q_${id}`, tier, supporting_assertion_ids: ["a_bc"], claims, ...extra,
});

function findings(s: any, opts: { others?: any[]; links?: any[]; t?: any; extra?: any[] } = {}) {
  const out = claimRuleFindings(s, {
    summaries: [s, ...(opts.others ?? [])],
    preCallResearch: research(opts.links, opts.extra),
    tree: opts.t ?? tree(),
  });
  for (const [id, messages] of out) if (messages.length > 0) fired.add(id);
  return out;
}
const fires = (out: Map<ClaimRuleId, string[]>, id: ClaimRuleId) => (out.get(id) ?? []).length > 0;

describe("rule 1, rival verdicts", () => {
  const withRival = tree([PC("I2", "I1"), PC("I4", "I1"), PC("I3", "I1")]);
  it("a likely parent claim beside an unverdicted rival warns", () => {
    const out = findings(summary("ps_1", [claim(father())]), { t: withRival });
    expect(out.get("claims-rival-verdicts")?.[0]).toMatch(/rival parent I4 has no claim/);
  });
  it("a likely mother claim beside an unverdicted Biological rival mother warns", () => {
    const t = tree([PC("I2", "I1"), PC("I3", "I1"), PC("I5", "I1", "Biological")]);
    const out = findings(summary("ps_1", [claim(father("I3"), "probable", ["a_bc", "a_bm"])]), { t });
    expect(out.get("claims-rival-verdicts")?.[0]).toMatch(/rival parent I5/);
  });
  it("a likely parent claim beside a rival carrying a possible denial passes", () => {
    const s = summary("ps_1", [claim(father()), claim(father("I4"), "possible", ["a_bc"], { polarity: "denied" })]);
    expect(fires(findings(s, { t: withRival }), "claims-rival-verdicts")).toBe(false);
  });
  it("a Step rival needs no verdict", () => {
    const t = tree([PC("I2", "I1"), PC("I4", "I1", "Step"), PC("I3", "I1")]);
    expect(fires(findings(summary("ps_1", [claim(father())]), { t }), "claims-rival-verdicts")).toBe(false);
  });
});

describe("rule 2, one answer per slot", () => {
  it("probable Birth claims of 25 Nov 1879 and 1880 for one person warn", () => {
    const s = summary("ps_1", [claim(fact("I1", "Birth", { date: "25 Nov 1879" }), "probable", ["a_bc"]), claim(fact("I1", "Birth", { date: "1880" }), "probable", ["a_bc"])]);
    expect(findings(s).get("claims-one-per-slot")?.[0]).toMatch(/neither date contains the other/);
  });
  it("probable Death claims of 1901 and 1903 in one summary warn", () => {
    const s = summary("ps_1", [claim(fact("I1", "Death", { date: "1901" }), "probable", ["a_bc"]), claim(fact("I1", "Death", { date: "1903" }), "probable", ["a_bc"])]);
    expect(fires(findings(s), "claims-one-per-slot")).toBe(true);
  });
  it("two probable father claims for one child in two live summaries warn", () => {
    const s = summary("ps_1", [claim(father())]);
    const other = summary("ps_2", [claim(father("I4"))]);
    expect(findings(s, { others: [other] }).get("claims-one-per-slot")?.[0]).toMatch(/both affirm a father of I1/);
  });
  it("two probable mother claims for one child in one summary warn", () => {
    const s = summary("ps_1", [claim(father("I3"), "probable", ["a_bc", "a_bm"]), claim(father("I5"), "probable", ["a_bc", "a_bm"])]);
    expect(findings(s).get("claims-one-per-slot")?.[0]).toMatch(/mother of I1/);
  });
  it("two probable Marriage claims with different years on one Couple pass", () => {
    const pair = { person1: "I1", person2: "I7" };
    const s = summary("ps_1", [claim(couple(), "probable", ["a_mg", "a_mb"]), claim(fact(pair, "Marriage", { date: "1880" }), "probable", ["a_mg", "a_mb"]), claim(fact(pair, "Marriage", { date: "1890" }), "probable", ["a_mg", "a_mb"])]);
    expect(fires(findings(s), "claims-one-per-slot")).toBe(false);
  });
  it("probable Birth claims of 1879 and 25 Nov 1879 for one person pass", () => {
    const s = summary("ps_1", [claim(fact("I1", "Birth", { date: "1879" }), "probable", ["a_bc"]), claim(fact("I1", "Birth", { date: "25 Nov 1879" }), "probable", ["a_bc"])]);
    expect(fires(findings(s), "claims-one-per-slot")).toBe(false);
  });
  it("a probable Step father beside a probable biological father passes", () => {
    const s = summary("ps_1", [claim(father()), claim(father("I4", "I1", "Step"), "probable", ["a_bc"])]);
    const out = findings(s, { t: tree([PC("I2", "I1"), PC("I4", "I1", "Step"), PC("I3", "I1")]) });
    expect(fires(out, "claims-one-per-slot")).toBe(false);
    expect(fires(out, "claims-rival-verdicts")).toBe(false);
  });
});

describe("rule 4, no empty escape on rivals", () => {
  const twoFathers = tree([PC("I2", "I1"), PC("I4", "I1"), PC("I3", "I1")]);
  const twoMothers = tree([PC("I2", "I1"), PC("I3", "I1"), PC("I5", "I1")]);
  const finding = (finding_type: string) => ({ finding: { finding_type, statement: "s" } });
  it("a probable summary whose only claim is a finding, citing a child with two live fathers, warns", () => {
    const out = findings(summary("ps_1", [claim(finding("record_content"))]), { t: twoFathers });
    expect(out.get("claims-no-empty-escape")?.[0]).toMatch(/cited child I1 has 2 fathers/);
  });
  it("a possible summary whose only claim is a rejected_candidate finding, citing a child with two live mothers, warns", () => {
    const out = findings(summary("ps_1", [claim(finding("rejected_candidate"), "possible")], "possible"), { t: twoMothers });
    expect(out.get("claims-no-empty-escape")?.[0]).toMatch(/2 mothers/);
  });
  it("a not_proved decline with no claims on a child with two live fathers passes", () => {
    const out = findings(summary("ps_1", [], "not_proved"), { t: twoFathers });
    expect(fires(out, "claims-no-empty-escape")).toBe(false);
    expect(fires(out, "claims-present")).toBe(false);
  });
  it("a probable summary with only a finding, on a child with one father, passes", () => {
    expect(fires(findings(summary("ps_1", [claim(finding("record_content"))])), "claims-no-empty-escape")).toBe(false);
  });
});

describe("code-review cases", () => {
  it("rule 4 does not read a father_of_child role as the cited child", () => {
    const extra = [A("a_fc", "rec_bap", "father_of_child", "name")];
    const links = [...BASE_LINKS, L("a_fc", "I2")];
    const t = tree([PC("I2", "I1"), PC("I3", "I1"), PC("I4", "I2"), PC("I6", "I2")]);
    const s = summary("ps_1", [claim({ finding: { finding_type: "record_content", statement: "s" } }, "probable", ["a_fc"])], "probable", { supporting_assertion_ids: ["a_fc"] });
    expect(fires(findings(s, { t, extra, links }), "claims-no-empty-escape")).toBe(false);
  });
  it("two parents of unknown gender are not rivals for one slot", () => {
    const t = { persons: [P("I1", "Male"), { ...P("I2", "Unknown") }, { ...P("I3", "Unknown") }], relationships: [PC("I2", "I1"), PC("I3", "I1")] };
    const s = summary("ps_1", [claim(father()), claim(father("I3"), "probable", ["a_bc", "a_bm"])]);
    const out = findings(s, { t });
    expect(fires(out, "claims-rival-verdicts")).toBe(false);
    expect(fires(out, "claims-one-per-slot")).toBe(false);
  });
  it("rule 2 reads Aft and Bef as open-ended: a 1901 death and one after 1898 are one value", () => {
    const s = summary("ps_1", [claim(fact("I1", "Death", { date: "1901" }), "probable", ["a_bc"]), claim(fact("I1", "Death", { date: "after 1898" }), "probable", ["a_bc"])]);
    expect(fires(findings(s), "claims-one-per-slot")).toBe(false);
    const late = summary("ps_1", [claim(fact("I1", "Death", { date: "1905" }), "probable", ["a_bc"]), claim(fact("I1", "Death", { date: "before 1903" }), "probable", ["a_bc"])]);
    expect(fires(findings(late), "claims-one-per-slot")).toBe(true);
  });
  it("affirming an untyped father and denying him as a stepfather is not a contradiction", () => {
    const s = summary("ps_1", [claim(father()), claim(father("I2", "I1", "Step"), "possible", ["a_bc"], { polarity: "denied" })]);
    expect(fires(findings(s), "claims-polarity")).toBe(false);
  });
  it("a conflicting pair inside one summary is reported once", () => {
    const s = summary("ps_1", [claim(fact("I1", "Birth", { date: "1879" }), "probable", ["a_bc"]), claim(fact("I1", "Birth", { date: "1885" }), "probable", ["a_bc"])]);
    expect(findings(s).get("claims-one-per-slot")).toHaveLength(1);
  });
});

describe("rule 5, claims present", () => {
  it("a probable proof with no claims warns", () => {
    expect(findings(summary("ps_1", [])).get("claims-present")?.[0]).toMatch(/carries no claims/);
  });
  it("a disproved proof with no claims warns", () => {
    expect(fires(findings(summary("ps_1", [], "disproved")), "claims-present")).toBe(true);
  });
  it("a not_proved decline with no claims passes", () => {
    expect(fires(findings(summary("ps_1", [], "not_proved")), "claims-present")).toBe(false);
  });
});

describe("rule 6, claims cite", () => {
  it("a disproved claim citing no assertion warns", () => {
    expect(findings(summary("ps_1", [claim(father(), "disproved", [])], "disproved")).get("claims-cite")?.[0]).toMatch(/cites no assertion/);
  });
  it("a probable denial citing no assertion warns", () => {
    expect(fires(findings(summary("ps_1", [claim(father("I4"), "probable", [], { polarity: "denied" })])), "claims-cite")).toBe(true);
  });
  it("an absence finding citing only log entries passes", () => {
    const c = claim({ finding: { finding_type: "absence", statement: "no burial", log_entry_ids: ["log_001"] } }, "probable", []);
    expect(fires(findings(summary("ps_1", [c])), "claims-cite")).toBe(false);
  });
});

describe("rule 7, grounding", () => {
  it("a probable ParentChild claim whose parent no cited assertion links warns, and the same claim at possible passes", () => {
    const cites = ["a_bc", "a_cc"];
    expect(findings(summary("ps_1", [claim(father(), "probable", cites)])).get("claims-grounding")?.[0]).toMatch(/would stand at possible: no assertion it cites is linked to I2/);
    expect(fires(findings(summary("ps_1", [claim(father(), "possible", cites)], "possible")), "claims-grounding")).toBe(false);
  });
  it("a probable fact claim whose value record is linked to nobody warns", () => {
    const extra = [A("a_dd", "rec_death", "deceased", "death")];
    const c = claim(fact("I1", "Death", { date: "1901" }), "probable", ["a_bc", "a_dd"]);
    expect(findings(summary("ps_1", [c]), { extra }).get("claims-grounding")?.[0]).toMatch(/no cited Death assertion \(a_dd\) comes from a record persona tied to I1/);
  });
  it("a probable Birth claim whose only birth persona is tied to a sibling, while a census links the subject, warns", () => {
    const c = claim(fact("I1", "Birth", { date: "1879" }), "probable", ["a_cc", "a_sib"]);
    expect(findings(summary("ps_1", [c])).get("claims-grounding")?.[0]).toMatch(/a_sib/);
  });
  it("a probable Marriage claim whose only marriage persona is tied to the groom, the bride linked only through another record, warns", () => {
    const extra = [A("a_bride2", "rec_other", "principal", "residence"), A("a_mar", "rec_mar2", "groom", "marriage")];
    const links = [...BASE_LINKS, L("a_bride2", "I7"), L("a_mar", "I1")];
    const pair = { person1: "I1", person2: "I7" };
    const s = summary("ps_1", [claim(couple(), "probable", ["a_mar", "a_bride2"]), claim(fact(pair, "Marriage", { date: "1880" }), "probable", ["a_mar", "a_bride2"])]);
    expect((findings(s, { extra, links }).get("claims-grounding") ?? []).join(" ")).toMatch(/tied to I7/);
  });
  it("a probable denial whose contrary record is linked to nobody warns", () => {
    const extra = [A("a_x", "rec_x", "father", "name")];
    const c = claim(father("I4"), "probable", ["a_x"], { polarity: "denied" });
    expect(findings(summary("ps_1", [c]), { extra }).get("claims-grounding")?.[0]).toMatch(/linked to I1, the person whose slot it contests/);
  });
  it("a probable denial whose only linked cited assertion links the denied father, not the child, warns", () => {
    const c = claim(father("I2"), "probable", ["a_bf"], { polarity: "denied" });
    expect(fires(findings(summary("ps_1", [c])), "claims-grounding")).toBe(true);
  });
  it("a probable denial of a Birth whose only cited contrary birth persona is tied to a sibling, while a census links the subject, warns", () => {
    const c = claim(fact("I1", "Birth", { date: "1879" }), "probable", ["a_cc", "a_sib"], { polarity: "denied" });
    expect(findings(summary("ps_1", [c])).get("claims-grounding")?.[0]).toMatch(/no cited Birth assertion \(a_sib\) comes from a record persona tied to I1/);
  });
  it("a probable claim whose only link runs through a persona a live denied identity claim covers warns", () => {
    const denial = claim({ identity: { person: "I2", record_id: "rec_bap", party: "father" } }, "probable", ["a_bc"], { polarity: "denied" });
    const s = summary("ps_1", [claim(father(), "probable", ["a_bc", "a_bf"]), denial]);
    expect((findings(s).get("claims-grounding") ?? []).join(" ")).toMatch(/linked to I2/);
  });
  it("a sibling set of ParentChild edges from deeds, with no cited assertion linking any child to either parent, warns on every edge", () => {
    const extra = [A("a_deed", "rec_deed", "grantor", "land")];
    const links = [...BASE_LINKS, L("a_deed", "I2")];
    const s = summary("ps_1", [claim(father("I2", "I1"), "probable", ["a_deed"]), claim(father("I2", "I6"), "probable", ["a_deed"])]);
    expect(findings(s, { extra, links }).get("claims-grounding")).toHaveLength(2);
  });
  it("a parent claim whose two people are linked from different cited assertions passes", () => {
    expect(fires(findings(summary("ps_1", [claim(father(), "probable", ["a_cc", "a_bf"])])), "claims-grounding")).toBe(false);
  });
  it("a probable denial of an import father no cited assertion links, whose contrary baptism is linked to the child, passes", () => {
    expect(fires(findings(summary("ps_1", [claim(father("I4"), "probable", ["a_bc"], { polarity: "denied" })])), "claims-grounding")).toBe(false);
  });
  it("a probable parent claim whose baptism is linked to the child alone, beside the father's own linked census, passes", () => {
    const links = BASE_LINKS.filter((l) => l.assertion_id !== "a_bf");
    expect(fires(findings(summary("ps_1", [claim(father(), "probable", ["a_bc", "a_cf"])]), { links }), "claims-grounding")).toBe(false);
  });
});

describe("rule 8, absence never grounds", () => {
  it("an affirmed fact claim citing only absence evidence warns", () => {
    expect(findings(summary("ps_1", [claim(fact("I1", "Death", { date: "1901" }), "probable", ["a_abs"])])).get("claims-absence")?.[0]).toMatch(/only absence evidence/);
  });
  it("an affirmed ParentChild claim citing only absence evidence warns", () => {
    expect(fires(findings(summary("ps_1", [claim(father(), "probable", ["a_abs"])])), "claims-absence")).toBe(true);
  });
  it("an absence finding citing only negative evidence passes", () => {
    const c = claim({ finding: { finding_type: "absence", statement: "no death record" } }, "probable", ["a_abs"]);
    expect(fires(findings(summary("ps_1", [c])), "claims-absence")).toBe(false);
  });
});

describe("rule 9, polarity holds", () => {
  it("affirming a Couple that another live summary rules out warns", () => {
    const other = summary("ps_2", [claim(couple(), "disproved", ["a_mg"])], "disproved");
    const out = findings(summary("ps_1", [claim(couple(), "probable", ["a_mg", "a_mb"])]), { others: [other] });
    expect(out.get("claims-polarity")?.[0]).toMatch(/rules out/);
  });
  it("two live summaries affirming and denying one edge warn", () => {
    const other = summary("ps_2", [claim(father(), "possible", ["a_bc"], { polarity: "denied" })], "possible");
    expect(findings(summary("ps_1", [claim(father())]), { others: [other] }).get("claims-polarity")?.[0]).toMatch(/denies/);
  });
  it("one summary affirming and denying one fact warns", () => {
    const s = summary("ps_1", [claim(fact("I1", "Birth", { date: "1879" }), "probable", ["a_bc"]), claim(fact("I1", "Birth", { date: "1879" }), "possible", ["a_bc"], { polarity: "denied" })]);
    expect(fires(findings(s), "claims-polarity")).toBe(true);
  });
  it("affirming a fact a live disproved claim covers warns", () => {
    const other = summary("ps_2", [claim(fact("I1", "Death", { date: "1901" }), "disproved", ["a_bc"])], "disproved");
    expect(fires(findings(summary("ps_1", [claim(fact("I1", "Death", { date: "1901" }), "probable", ["a_bc"])]), { others: [other] }), "claims-polarity")).toBe(true);
  });
  it("one record persona affirmed at probable as two persons in one summary warns", () => {
    const s = summary("ps_1", [claim({ identity: { person: "I1", record_id: "rec_cen", party: "son" } }, "probable", ["a_cc"]), claim({ identity: { person: "I6", record_id: "rec_cen", party: "son" } }, "probable", ["a_cc"])]);
    expect(findings(s).get("claims-polarity")?.join(" ")).toMatch(/affirms record persona rec_cen \(son\)/);
  });
  it("the same across two live summaries warns", () => {
    const other = summary("ps_2", [claim({ identity: { person: "I6", record_id: "rec_cen", party: "son" } }, "probable", ["a_cc"])]);
    expect(fires(findings(summary("ps_1", [claim({ identity: { person: "I1", record_id: "rec_cen", party: "son" } }, "probable", ["a_cc"])]), { others: [other] }), "claims-polarity")).toBe(true);
  });
  it("one persona affirmed at probable as I1 and at possible as I2 passes", () => {
    const s = summary("ps_1", [claim({ identity: { person: "I1", record_id: "rec_cen", party: "son" } }, "probable", ["a_cc"]), claim({ identity: { person: "I2", record_id: "rec_cen", party: "son" } }, "possible", ["a_cc"])]);
    expect(fires(findings(s), "claims-polarity")).toBe(false);
  });
  it("affirming a Step parent and denying him as Biological passes", () => {
    const s = summary("ps_1", [claim(father("I4", "I1", "Step"), "probable", ["a_bc"]), claim(father("I4", "I1", "Biological"), "probable", ["a_bc"], { polarity: "denied" })]);
    expect(fires(findings(s), "claims-polarity")).toBe(false);
  });
  it("revising the ruling-out summary in the same batch passes: the rules read the final state", () => {
    const revised = summary("ps_2", [claim(couple(), "possible", ["a_mg"])], "possible");
    expect(fires(findings(summary("ps_1", [claim(couple(), "probable", ["a_mg", "a_mb"])]), { others: [revised] }), "claims-polarity")).toBe(false);
  });
});

describe("rule 10, couple first", () => {
  const pair = { person1: "I1", person2: "I7" };
  it("a probable Marriage claim with no Couple claim warns", () => {
    expect(findings(summary("ps_1", [claim(fact(pair, "Marriage", { date: "1880" }), "probable", ["a_mg", "a_mb"])])).get("claims-couple-first")?.[0]).toMatch(/no affirmed Couple claim/);
  });
  it("a probable Divorce claim beside only a possible Couple claim warns", () => {
    const s = summary("ps_1", [claim(couple(), "possible", ["a_mg", "a_mb"]), claim(fact(pair, "Divorce", { date: "1890" }), "probable", ["a_mg", "a_mb"])]);
    expect(fires(findings(s), "claims-couple-first")).toBe(true);
  });
  it("a probable Marriage claim beside a probable Couple claim in another live summary passes", () => {
    const other = summary("ps_2", [claim(couple("I7", "I1"), "probable", ["a_mg", "a_mb"])]);
    expect(fires(findings(summary("ps_1", [claim(fact(pair, "Marriage", { date: "1880" }), "probable", ["a_mg", "a_mb"])]), { others: [other] }), "claims-couple-first")).toBe(false);
  });
});

describe("rule 11, capped claims keep the question open", () => {
  const ctx = (summaries: any[], t = tree()) => ({ summaries, preCallResearch: research(), tree: t });
  it("resolving a question whose summary holds a claim held at possible by grounding warns", () => {
    const s = summary("ps_1", [claim(father(), "possible", ["a_bc", "a_cc"])], "possible");
    const [hit] = questionCapFindings({ id: "q_ps_1", status: "resolved" }, ctx([s]));
    fired.add("claims-capped-open");
    expect(hit.summaryId).toBe("ps_1");
    expect(hit.messages[0]).toMatch(/stands at possible because no assertion it cites is linked to I2/);
  });
  it("resolving a question whose summary holds a fact claim held at possible by grounding warns", () => {
    const s = summary("ps_1", [claim(fact("I1", "Birth", { date: "1879" }), "possible", ["a_cc", "a_sib"])], "possible");
    expect(questionCapFindings({ id: "q_ps_1", status: "resolved" }, ctx([s]))).toHaveLength(1);
  });
  it("resolving a parentage question whose unlinked import rival is set aside at possible passes", () => {
    const s = summary("ps_1", [claim(father(), "probable", ["a_bc", "a_bf"]), claim(father("I4"), "possible", ["a_bc"])]);
    expect(questionCapFindings({ id: "q_ps_1", status: "resolved" }, ctx([s], tree([PC("I2", "I1"), PC("I4", "I1"), PC("I3", "I1")])))).toEqual([]);
  });
});

describe("rule 12, proved needs confident identity", () => {
  it("a proved claim on a probable-only link warns, and a proved identity claim on a probable link does not cover it", () => {
    const links = BASE_LINKS.map((l) => (l.assertion_id === "a_bf" ? { ...l, confidence: "probable" } : l));
    const idn = claim({ identity: { person: "I2", record_id: "rec_bap", party: "father" } }, "proved", ["a_bf"]);
    const out = findings(summary("ps_1", [claim(father(), "proved", ["a_bc", "a_bf"]), idn], "proved"), { links });
    expect(out.get("claims-proved-identity")?.[0]).toMatch(/would stand at probable: I2/);
  });
  it("a proved claim covered by a proved identity claim whose own persona link is confident passes", () => {
    const links = [...BASE_LINKS.filter((l) => l.assertion_id !== "a_bf"), L("a_bf", "I2", "probable"), L("a_cf", "I2")];
    const extra = [A("a_bf2", "rec_bap", "father", "residence")];
    const links2 = [...links, L("a_bf2", "I2")];
    const idn = claim({ identity: { person: "I2", record_id: "rec_bap", party: "father" } }, "proved", ["a_bf2"]);
    const out = findings(summary("ps_1", [claim(father(), "proved", ["a_bc", "a_bf"]), idn], "proved"), { links: links2, extra });
    expect(fires(out, "claims-proved-identity")).toBe(false);
  });
});

afterAll(() => {
  // Every staged claim rule fired on some case above: a rule id registered in
  // rule-modes.ts that the module never emits would pass every other check.
  expect([...fired].sort()).toEqual([...CLAIM_RULE_IDS].sort());
});
