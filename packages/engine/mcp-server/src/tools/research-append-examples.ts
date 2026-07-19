/**
 * Worked `research_append` examples, one per writer section.
 *
 * Why these live here and not only in SKILL.md prose: a skill-side example
 * only helps when the skill that owns the section happens to be loaded. The
 * closing report's T15 row is the proof — `conflicts` has had a good worked
 * example in conflict-resolution/SKILL.md for months and still drew ~6
 * rejections in one scenario, because the caller was a different skill. These
 * are attached to the *rejection*, so the shape arrives exactly when the model
 * got it wrong, regardless of which caller is driving.
 *
 * Field lists are transcribed from docs/specs/schemas/research.schema.json;
 * enum literals from enums.schema.json. Every example shows the required keys
 * with explicit `null`s for the not-yet-known optional ones — the explicit
 * null is what stops the trial-and-error loop, since the validator's
 * additionalProperties:false rejects invented keys and its `required` rejects
 * omitted ones.
 *
 * None of these carry an `id`: the tool assigns it (research-append.ts rejects
 * an entry that carries one).
 */

/** Section → a single worked `entry` payload, as pretty JSON. */
const EXAMPLES: Record<string, string> = {
  // No "gedcomx_source_description_id" here on purpose: the composite form
  // below supplies "sourceDescription", which CREATES the tree's S entry and
  // fills the id. Carrying both is rejected; carrying neither is rejected
  // unless the S entry already exists.
  sources: `{
  "citation": "\\"Pennsylvania, Death Certificates, 1906-1968,\\" database with images, FamilySearch, Patrick Flynn, 12 Mar 1908; citing Schuylkill County, certificate no. 24601.",
  "citation_detail": {
    "who": "Schuylkill County registrar",
    "what": "Certificate of death no. 24601",
    "when_created": "1908",
    "when_accessed": "2026-07-18",
    "where": "Harrisburg, Pennsylvania",
    "where_within": "certificate no. 24601"
  },
  "source_classification": "original",
  "repository": "FamilySearch",
  "access_date": "2026-07-18",
  "url": "https://www.familysearch.org/ark:/61903/1:1:MDEF",
  "url_archived": null,
  "notes": null,
  "transcription": null,
  "image_filename": null,
  "log_entry_id": "log_004"
}`,

  assertions: `{
  "source_id": "src_004",
  "record_id": "ark:/61903/1:1:MDEF",
  "record_role": "deceased",
  "record_persona_id": "p1",
  "fact_type": "death",
  "value": "12 Mar 1908",
  "structured_value": null,
  "date": "1908-03-12",
  "date_certainty": "exact",
  "place": "Schuylkill County, Pennsylvania",
  "standard_place": "Schuylkill, Pennsylvania, United States",
  "information_quality": "primary",
  "informant": "Mary Flynn, widow",
  "informant_proximity": "household_member",
  "informant_bias_notes": null,
  "evidence_type": "direct",
  "log_entry_id": "log_004",
  "extracted_for_question_ids": ["q_002"]
}`,

  person_evidence: `{
  "assertion_id": "a_013",
  "person_id": "I1",
  "confidence": "probable",
  "rationale": "Death certificate names Patrick Flynn, d. 1908 Schuylkill County — name, place and date match the subject. Father's name is a single uncorroborated reading, so the link is probable rather than confident.",
  "match_score": null,
  "created": "2026-07-18",
  "superseded_by": null
}`,

  questions: `{
  "question": "Who were the parents of Patrick Flynn (b. abt 1845, Ireland)?",
  "rationale": "The death certificate names a father (Thomas Flynn) on a single uncorroborated reading; no record yet names the mother.",
  "selection_basis": "unresolved_conflict",
  "priority": "high",
  "status": "open",
  "depends_on": [],
  "unblocks": [],
  "created": "2026-07-18",
  "resolved": null,
  "resolution_assertion_ids": [],
  "exhaustive_declaration": {
    "declared": false,
    "justification": null,
    "log_entry_ids": [],
    "stop_criteria": null
  }
}`,

  plans: `{
  "question_id": "q_002",
  "status": "active",
  "created": "2026-07-18",
  "items": []
}`,

  plan_items: `{
  "sequence": 1,
  "record_type": "church",
  "jurisdiction": "County Mayo, Ireland",
  "date_range": "1840-1850",
  "repository": "FamilySearch",
  "rationale": "Catholic baptismal registers are the only pre-civil-registration source naming both parents in this jurisdiction.",
  "fallback_for": null,
  "status": "planned"
}`,

  conflicts: `{
  "conflict_type": "fact",
  "description": "Patrick Flynn's birth year: 1845 (1850 census, age 5) vs. 1843 (delayed birth certificate)",
  "disputed_attribute": "birth_year",
  "identity_question": null,
  "competing_assertion_ids": ["a_002", "a_025"],
  "independence_analysis": null,
  "weighing_analysis": null,
  "preferred_assertion_id": null,
  "resolution_rationale": null,
  "status": "unresolved",
  "blocks_question_ids": []
}`,

  hypotheses: `{
  "claim": "Patrick Flynn of Schuylkill County is the same man as Patrick Flynn who emigrated from County Mayo in 1863.",
  "status": "active",
  "supporting_assertion_ids": ["a_013"],
  "contradicting_assertion_ids": [],
  "ruled_out": false,
  "ruled_out_reason": null,
  "notes": null,
  "related_question_ids": ["q_002"]
}`,

  timelines: `{
  "label": "Patrick Flynn — life events",
  "hypothesis_id": null,
  "person_ids": ["I1"],
  "generated": "2026-07-18T14:05:00Z",
  "events": [],
  "gaps": [],
  "impossibilities": []
}`,

  proof_summaries: `{
  "question_id": "q_002",
  "tier": "probable",
  "vehicle": "summary",
  "supporting_assertion_ids": ["a_013", "a_025"],
  "resolved_conflict_ids": ["c_001"],
  "exhaustive_search_summary": "Searched Schuylkill County civil death registers, Catholic parish registers for St. Patrick's, and the 1850-1880 federal censuses; no further records naming Patrick's parents surfaced.",
  "narrative_markdown": "## Parents of Patrick Flynn\\n\\nThe 1908 death certificate names Thomas Flynn as father..."
}`,

  // The section that drew the identical rejection in 4+ runs across 4
  // scenarios. This entry is a POINTER, not the report: the verdict body
  // (`strengths`, `must_address`, …) is not part of it and must not be
  // appended here. Pass the body as the top-level `verdict` argument instead —
  // the tool writes the sidecar and stamps `file_path` (hence its absence
  // below; supplying both is rejected).
  evaluations: `{
  "focus": "conclusion-readiness",
  "target_id": "q_002",
  "target_type": "question",
  "verdict": "consider_addressing",
  "timestamp": "2026-07-18T14:05:00Z",
  "superseded_by": null
}`,

  known_holdings: `{
  "holding_type": "document",
  "description": "Great-grandmother's family Bible with births recorded on the flyleaf",
  "relevant_facts": "Birth dates for six children, 1868-1881",
  "relates_to_person_ids": ["I1"],
  "confidence": "confident",
  "promoted": false,
  "created": "2026-07-18"
}`,
};

/** `project` is a singleton: update-only field writes, no `entry`. */
const PROJECT_EXAMPLE = `research_append({
  projectPath: "<absolute-path-to-project-directory>",
  section: "project",
  op: "update",
  fields: { "status": "completed" }
})`;

/**
 * A worked `research_append` call for `section`, or null when the section has
 * no example. `op` selects the call shape (`plan_items` needs a `planId`).
 */
export function exampleFor(section: string, op: "append" | "update" = "append"): string | null {
  if (section === "project") return PROJECT_EXAMPLE;
  const entry = EXAMPLES[section];
  if (!entry) return null;
  const planId = section === "plan_items" ? `\n  planId: "pl_001",` : "";
  // A source append must either reference an S entry that already exists in the
  // tree or create one in the same call. The composite form is the norm, so the
  // example teaches it rather than a bare id that would be rejected.
  // The evaluations example is a pointer; the verdict body rides alongside it
  // as the top-level `verdict` argument, which is what fills file_path.
  const verdictArg =
    section === "evaluations"
      ? `\n  verdict: { /* strengths, must_address, consider_addressing, narrative_for_user, ... */ },`
      : "";
  const sourceDescription =
    section === "sources"
      ? `\n  sourceDescription: {\n    title: "Pennsylvania Death Certificate — Patrick Flynn (1908)",\n    author: "Pennsylvania Department of Health",\n    url: "https://www.familysearch.org/ark:/61903/1:1:MDEF"\n  },`
      : "";
  const indented = entry.split("\n").join("\n  ");
  if (op === "update") {
    return `research_append({
  projectPath: "<absolute-path-to-project-directory>",
  section: "${section}",
  op: "update",${planId}
  entryId: "<existing-id>",
  fields: { /* only the fields you are changing */ }
})`;
  }
  return `research_append({
  projectPath: "<absolute-path-to-project-directory>",
  section: "${section}",
  op: "append",${planId}${sourceDescription}${verdictArg}
  entry: ${indented}
})`;
}

/**
 * Rejection-time teaching aid: the worked call for each implicated section,
 * appended to the error list. Capped so a wide batch failure cannot bury the
 * actual errors under example text.
 */
export function exampleHints(
  sections: Array<{ section: string; op: "append" | "update" }>,
  max = 2,
): string[] {
  const seen = new Set<string>();
  const hints: string[] = [];
  for (const { section, op } of sections) {
    if (hints.length >= max) break;
    if (seen.has(section)) continue;
    seen.add(section);
    const ex = exampleFor(section, op);
    if (ex) hints.push(`worked example for '${section}':\n${ex}`);
  }
  return hints;
}

export const __testing = { EXAMPLES };
