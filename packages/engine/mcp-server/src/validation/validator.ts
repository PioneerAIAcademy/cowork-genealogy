/**
 * Project validator for research.json and tree.gedcomx.json.
 *
 * Performs manual validation of structure, enums, cross-file references, and sidecar files.
 * Port of plugin/skills/validate-schema/scripts/validate_project.py
 */

import { readFile, readdir } from "fs/promises";
import { join, resolve, relative, isAbsolute, basename } from "path";
import type {
  ValidationReport,
  ValidationResult,
} from "./types.js";
import {
  createReport,
  addError,
  addWarning,
  isValid,
} from "./types.js";

// Enum definitions (single source of truth, matching Python validator)
const CLOSED_ENUMS = {
  question_status: new Set(["open", "in_progress", "exhaustive_declared", "resolved"]),
  plan_status: new Set(["active", "completed", "superseded"]),
  plan_item_status: new Set(["planned", "in_progress", "completed", "skipped"]),
  log_outcome: new Set(["positive", "negative", "partial", "error"]),
  source_classification: new Set(["original", "derivative", "authored"]),
  information_quality: new Set(["primary", "secondary", "indeterminate"]),
  evidence_type: new Set(["direct", "indirect", "negative"]),
  conflict_type: new Set(["fact", "identity"]),
  conflict_status: new Set(["unresolved", "resolved", "moot"]),
  hypothesis_status: new Set(["active", "supported", "ruled_out"]),
  proof_tier: new Set(["proved", "probable", "possible", "not_proved", "disproved"]),
  proof_vehicle: new Set(["statement", "summary", "argument"]),
  person_evidence_confidence: new Set(["confident", "probable", "speculative"]),
  project_status: new Set(["active", "paused", "completed"]),
  priority: new Set(["high", "medium", "low"]),
  informant_proximity: new Set([
    "self", "witness", "household_member",
    "family_not_present", "official_duty", "unknown",
  ]),
  gender: new Set(["Male", "Female", "Unknown"]),
  relationship_type: new Set(["ParentChild", "Couple"]),
  experience_level: new Set(["novice", "intermediate", "experienced", "professional"]),
  subscription: new Set([
    "Ancestry", "MyHeritage", "FindMyPast", "Newspapers.com",
    "GenealogyBank", "FindAGrave-Plus", "other", "none",
  ]),
  severity: new Set(["high", "medium", "low"]),
  evaluation_focus: new Set([
    "pre-exhaustiveness", "conclusion-readiness", "proof-critique", "on-demand",
  ]),
  evaluation_target_type: new Set(["question", "proof_summary", "project"]),
  evaluation_verdict: new Set([
    "looks_solid", "consider_addressing", "address_first", "refused",
  ]),
};

const SELECTION_BASIS_VALUES = new Set([
  "timeline_gap", "unresolved_conflict", "fan_pivot", "hypothesis_test",
  "objective_decomposition", "new_evidence", "record_found_incidentally",
  "user_directed",
]);

const DATE_CERTAINTY_VALUES = new Set([
  "exact", "approximate", "estimated", "calculated",
  "before", "after", "between",
]);

const DATE_CERTAINTY_TIMELINE = new Set([
  "exact", "approximate", "estimated", "calculated",
]);

const EXTERNAL_SITE_VALUES = new Set([
  "ancestry", "myheritage", "findmypast", "familysearch_web",
  "findagrave", "newspapers",
]);

const ID_PREFIXES: Record<string, string> = {
  project: "rp_",
  questions: "q_",
  plans: "pl_",
  plan_items: "pli_",
  log: "log_",
  sources: "src_",
  assertions: "a_",
  person_evidence: "pe_",
  conflicts: "c_",
  hypotheses: "h_",
  timelines: "t_",
  proof_summaries: "ps_",
  evaluations: "ev_",
};

/**
 * Validate a project directory containing research.json and tree.gedcomx.json
 */
export async function validateProject(projectPath: string): Promise<ValidationResult> {
  const report = createReport();

  const researchPath = resolve(projectPath, "research.json");
  const treePath = resolve(projectPath, "tree.gedcomx.json");

  let research: any;
  let tree: any;

  // Load files
  try {
    const researchText = await readFile(researchPath, "utf-8");
    research = JSON.parse(researchText);
  } catch (error) {
    addError(report, "", `research.json not found or invalid JSON: ${error}`);
  }

  try {
    const treeText = await readFile(treePath, "utf-8");
    tree = JSON.parse(treeText);
  } catch (error) {
    addError(report, "", `tree.gedcomx.json not found or invalid JSON: ${error}`);
  }

  if (!isValid(report)) {
    return {
      valid: false,
      errors: report.errors,
      warnings: report.warnings,
    };
  }

  // Validate research.json
  const researchIds = validateResearch(research, report);

  // Validate tree.gedcomx.json
  const { personIds, sourceIds } = validateGedcomx(tree, report);

  // Cross-file validation
  validateCrossFile(research, personIds, sourceIds, report);

  // Sidecar validation
  await validateSidecars(research, projectPath, report);

  return {
    valid: isValid(report),
    errors: report.errors,
    warnings: report.warnings,
  };
}

function checkRequired(
  obj: any,
  fields: string[],
  path: string,
  report: ValidationReport,
  nullableFields: Set<string> = new Set()
): void {
  for (const field of fields) {
    if (!(field in obj)) {
      addError(report, path, `missing required field '${field}'`);
    } else if (obj[field] === null && !nullableFields.has(field)) {
      addError(report, path, `required field '${field}' is null`);
    }
  }
}

function checkIdPrefix(
  objId: any,
  expectedPrefix: string,
  path: string,
  report: ValidationReport
): void {
  if (typeof objId !== "string") {
    addError(report, path, `id must be a string, got ${typeof objId}`);
  } else if (!objId.startsWith(expectedPrefix)) {
    addError(report, path, `id '${objId}' should start with '${expectedPrefix}'`);
  }
}

function checkEnum(
  value: any,
  enumName: string,
  path: string,
  report: ValidationReport
): void {
  const validValues = CLOSED_ENUMS[enumName as keyof typeof CLOSED_ENUMS];
  if (validValues && !validValues.has(value)) {
    const sorted = Array.from(validValues).sort();
    addError(report, path, `'${value}' is not a valid ${enumName} (expected one of: ${sorted.join(', ')})`);
  }
}

function checkRefExists(
  refId: string,
  validIds: Set<string>,
  refType: string,
  path: string,
  report: ValidationReport
): void {
  if (!validIds.has(refId)) {
    addError(report, path, `references ${refType} '${refId}' which does not exist`);
  }
}

interface ResearchIds {
  questions: Set<string>;
  plans: Set<string>;
  plan_items: Set<string>;
  log: Set<string>;
  sources: Set<string>;
  assertions: Set<string>;
  person_evidence: Set<string>;
  conflicts: Set<string>;
  hypotheses: Set<string>;
  timelines: Set<string>;
  proof_summaries: Set<string>;
}

// Nullable fields (can be null even when required)
const NULLABLE_FIELDS = new Set([
  "subject_person_ids", "resolved", "stop_criteria", "external_site",
  "disputed_attribute", "identity_question", "preferred_assertion_id",
  "resolution_rationale", "independence_analysis", "weighing_analysis",
  "ruled_out_reason", "hypothesis_id", "match_score", "superseded_by",
  "date", "date_certainty", "place", "informant_bias_notes",
  "plan_item_id", "notes", "url", "url_archived", "log_entry_id",
  "structured_value", "fallback_for", "capture_filename", "record_persona_id",
  "results_ref", "results_available", "standard_place", "distance_from_previous_km",
  "conflict_ids", "conflict_note", "justification",
]);

function validateResearch(data: any, report: ValidationReport): ResearchIds {
  const path = "research.json";

  const ids: ResearchIds = {
    questions: new Set(),
    plans: new Set(),
    plan_items: new Set(),
    log: new Set(),
    sources: new Set(),
    assertions: new Set(),
    person_evidence: new Set(),
    conflicts: new Set(),
    hypotheses: new Set(),
    timelines: new Set(),
    proof_summaries: new Set(),
  };

  // Top-level sections
  const requiredSections = [
    "project", "questions", "plans", "log", "sources",
    "assertions", "person_evidence", "conflicts", "hypotheses",
    "timelines", "proof_summaries", "evaluations",
  ];

  for (const section of requiredSections) {
    if (!(section in data)) {
      addError(report, path, `missing top-level section '${section}'`);
    }
  }

  if (typeof data.project !== "object" || data.project === null) {
    addError(report, path, "project must be an object");
    return ids;
  }

  // Project
  const p = data.project;
  const projPath = `${path}/project`;
  checkRequired(p, ["id", "objective", "status", "created", "updated"], projPath, report, NULLABLE_FIELDS);
  if ("id" in p) {
    checkIdPrefix(p.id, ID_PREFIXES.project, projPath, report);
  }
  if ("status" in p && p.status !== null) {
    checkEnum(p.status, "project_status", projPath, report);
  }

  // Researcher profile (optional)
  const rp = data.researcher_profile;
  if (rp !== null && rp !== undefined) {
    const rpPath = `${path}/researcher_profile`;
    if (typeof rp !== "object") {
      addError(report, rpPath, "researcher_profile must be an object");
    } else {
      if ("experience_level" in rp && rp.experience_level !== null) {
        checkEnum(rp.experience_level, "experience_level", rpPath, report);
      }
      const subs = rp.subscriptions;
      if (subs !== null && subs !== undefined) {
        if (!Array.isArray(subs)) {
          addError(report, rpPath, "subscriptions must be an array");
        } else {
          for (const s of subs) {
            if (!CLOSED_ENUMS.subscription.has(s)) {
              addError(report, rpPath, `'${s}' is not a valid subscription value`);
            }
          }
        }
      }
      const ng = rp.narration_guidance;
      if (ng !== null && ng !== undefined && typeof ng !== "string") {
        addError(report, rpPath, "narration_guidance must be a string");
      }
    }
  }

  // Questions
  const questions = Array.isArray(data.questions) ? data.questions : [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const qp = `${path}/questions[${i}]`;
    checkRequired(q, [
      "id", "question", "rationale", "selection_basis", "priority",
      "status", "depends_on", "unblocks", "created", "resolved",
      "resolution_assertion_ids", "exhaustive_declaration",
    ], qp, report, NULLABLE_FIELDS);

    if ("id" in q) {
      checkIdPrefix(q.id, ID_PREFIXES.questions, qp, report);
      ids.questions.add(q.id);
    }
    if ("status" in q) {
      checkEnum(q.status, "question_status", qp, report);
    }
    if ("priority" in q) {
      checkEnum(q.priority, "priority", qp, report);
    }
    if ("selection_basis" in q && !SELECTION_BASIS_VALUES.has(q.selection_basis)) {
      addError(report, qp, `'${q.selection_basis}' is not a valid selection_basis`);
    }

    // Exhaustive declaration
    const ed = q.exhaustive_declaration;
    if (typeof ed === "object" && ed !== null) {
      checkRequired(ed, ["declared", "log_entry_ids"], `${qp}/exhaustive_declaration`, report, NULLABLE_FIELDS);
      if (ed.declared && (!ed.log_entry_ids || ed.log_entry_ids.length === 0)) {
        addError(report, `${qp}/exhaustive_declaration`, "declared is true but log_entry_ids is empty");
      }
      if (ed.declared && ed.stop_criteria === null) {
        addError(report, `${qp}/exhaustive_declaration`, "declared is true but stop_criteria is null");
      }
      if (ed.declared && typeof ed.stop_criteria === "object" && ed.stop_criteria !== null) {
        const sc = ed.stop_criteria;
        for (const field of ["goal_alignment", "repository_breadth", "original_substitution",
                             "independent_verification", "evidence_class", "conflict_resolution",
                             "overturn_risk"]) {
          if (!(field in sc)) {
            addError(report, `${qp}/exhaustive_declaration/stop_criteria`, `missing '${field}'`);
          }
        }
      }
    }
  }

  // Plans
  const plans = Array.isArray(data.plans) ? data.plans : [];
  for (let i = 0; i < plans.length; i++) {
    const pl = plans[i];
    const pp = `${path}/plans[${i}]`;
    checkRequired(pl, ["id", "question_id", "status", "created", "items"], pp, report, NULLABLE_FIELDS);
    if ("id" in pl) {
      checkIdPrefix(pl.id, ID_PREFIXES.plans, pp, report);
      ids.plans.add(pl.id);
    }
    if ("status" in pl) {
      checkEnum(pl.status, "plan_status", pp, report);
    }
    if ("question_id" in pl) {
      checkRefExists(pl.question_id, ids.questions, "question", pp, report);
    }

    const items = Array.isArray(pl.items) ? pl.items : [];
    for (let j = 0; j < items.length; j++) {
      const item = items[j];
      const ip = `${pp}/items[${j}]`;
      checkRequired(item, [
        "id", "sequence", "record_type", "jurisdiction",
        "date_range", "repository", "rationale", "fallback_for", "status",
      ], ip, report, NULLABLE_FIELDS);
      if ("id" in item) {
        checkIdPrefix(item.id, ID_PREFIXES.plan_items, ip, report);
        ids.plan_items.add(item.id);
      }
      if ("status" in item) {
        checkEnum(item.status, "plan_item_status", ip, report);
      }
    }
  }

  // Log
  const log = Array.isArray(data.log) ? data.log : [];
  for (let i = 0; i < log.length; i++) {
    const entry = log[i];
    const lp = `${path}/log[${i}]`;
    checkRequired(entry, [
      "id", "plan_item_id", "performed", "tool", "query",
      "outcome", "results_examined", "external_site",
    ], lp, report, NULLABLE_FIELDS);
    if ("id" in entry) {
      checkIdPrefix(entry.id, ID_PREFIXES.log, lp, report);
      ids.log.add(entry.id);
    }
    if ("outcome" in entry) {
      checkEnum(entry.outcome, "log_outcome", lp, report);
    }

    const ext = entry.external_site;
    if (entry.tool === "external_site" && ext === null) {
      addError(report, lp, "tool is 'external_site' but external_site object is null");
    }
    if (typeof ext === "object" && ext !== null) {
      checkRequired(ext, ["site", "url_generated", "capture_received"], `${lp}/external_site`, report, NULLABLE_FIELDS);
      if ("site" in ext && !EXTERNAL_SITE_VALUES.has(ext.site)) {
        addError(report, `${lp}/external_site`, `'${ext.site}' is not a valid site`);
      }
    }
  }

  // Sources
  const sources = Array.isArray(data.sources) ? data.sources : [];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const sp = `${path}/sources[${i}]`;
    checkRequired(src, [
      "id", "gedcomx_source_description_id", "citation",
      "citation_detail", "source_classification", "repository",
      "access_date",
    ], sp, report, NULLABLE_FIELDS);
    if ("id" in src) {
      checkIdPrefix(src.id, ID_PREFIXES.sources, sp, report);
      ids.sources.add(src.id);
    }
    if ("source_classification" in src) {
      checkEnum(src.source_classification, "source_classification", sp, report);
    }
    if (src.log_entry_id) {
      checkRefExists(src.log_entry_id, ids.log, "log entry", sp, report);
    }

    const cd = src.citation_detail;
    if (typeof cd === "object" && cd !== null) {
      checkRequired(cd, ["who", "what", "when_created", "when_accessed", "where", "where_within"],
                   `${sp}/citation_detail`, report, NULLABLE_FIELDS);
    }
  }

  // Assertions
  const assertions = Array.isArray(data.assertions) ? data.assertions : [];
  for (let i = 0; i < assertions.length; i++) {
    const a = assertions[i];
    const ap = `${path}/assertions[${i}]`;
    checkRequired(a, [
      "id", "source_id", "record_id", "record_role", "fact_type",
      "value", "information_quality", "informant", "informant_proximity",
      "evidence_type", "extracted_for_question_ids",
    ], ap, report, NULLABLE_FIELDS);
    if ("id" in a) {
      checkIdPrefix(a.id, ID_PREFIXES.assertions, ap, report);
      ids.assertions.add(a.id);
    }
    if ("information_quality" in a) {
      checkEnum(a.information_quality, "information_quality", ap, report);
    }
    if ("evidence_type" in a) {
      checkEnum(a.evidence_type, "evidence_type", ap, report);
    }
    if ("informant_proximity" in a) {
      checkEnum(a.informant_proximity, "informant_proximity", ap, report);
    }
    if ("date_certainty" in a && a.date_certainty !== null) {
      if (!DATE_CERTAINTY_VALUES.has(a.date_certainty)) {
        addError(report, ap, `'${a.date_certainty}' is not a valid date_certainty`);
      }
    }
    if ("source_id" in a) {
      checkRefExists(a.source_id, ids.sources, "source", ap, report);
    }
    if (a.log_entry_id) {
      checkRefExists(a.log_entry_id, ids.log, "log entry", ap, report);
    }
  }

  // Person evidence
  const personEvidence = Array.isArray(data.person_evidence) ? data.person_evidence : [];
  for (let i = 0; i < personEvidence.length; i++) {
    const pe = personEvidence[i];
    const pp = `${path}/person_evidence[${i}]`;
    checkRequired(pe, [
      "id", "assertion_id", "person_id", "confidence",
      "rationale", "created",
    ], pp, report, NULLABLE_FIELDS);
    if ("id" in pe) {
      checkIdPrefix(pe.id, ID_PREFIXES.person_evidence, pp, report);
      ids.person_evidence.add(pe.id);
    }
    if ("confidence" in pe) {
      checkEnum(pe.confidence, "person_evidence_confidence", pp, report);
    }
    if ("assertion_id" in pe) {
      checkRefExists(pe.assertion_id, ids.assertions, "assertion", pp, report);
    }
  }

  // Conflicts
  const conflicts = Array.isArray(data.conflicts) ? data.conflicts : [];
  for (let i = 0; i < conflicts.length; i++) {
    const c = conflicts[i];
    const cp = `${path}/conflicts[${i}]`;
    checkRequired(c, [
      "id", "conflict_type", "description", "competing_assertion_ids",
      "status", "blocks_question_ids",
    ], cp, report, NULLABLE_FIELDS);
    if ("id" in c) {
      checkIdPrefix(c.id, ID_PREFIXES.conflicts, cp, report);
      ids.conflicts.add(c.id);
    }
    if ("conflict_type" in c) {
      checkEnum(c.conflict_type, "conflict_type", cp, report);
    }
    if ("status" in c) {
      checkEnum(c.status, "conflict_status", cp, report);
    }

    const ct = c.conflict_type;
    const ca = c.competing_assertion_ids || [];
    if (ct === "fact" && ca.length < 2) {
      addError(report, cp, "fact conflict requires at least 2 competing_assertion_ids");
    } else if (ct === "identity" && ca.length < 1) {
      addError(report, cp, "identity conflict requires at least 1 competing_assertion_ids");
    }
    if (ct === "fact" && !c.disputed_attribute) {
      addError(report, cp, "fact conflict requires disputed_attribute");
    }
    if (ct === "identity" && !c.identity_question) {
      addError(report, cp, "identity conflict requires identity_question");
    }
  }

  // Hypotheses
  const hypotheses = Array.isArray(data.hypotheses) ? data.hypotheses : [];
  for (let i = 0; i < hypotheses.length; i++) {
    const h = hypotheses[i];
    const hp = `${path}/hypotheses[${i}]`;
    checkRequired(h, [
      "id", "claim", "status", "supporting_assertion_ids",
      "contradicting_assertion_ids", "ruled_out", "related_question_ids",
    ], hp, report, NULLABLE_FIELDS);
    if ("id" in h) {
      checkIdPrefix(h.id, ID_PREFIXES.hypotheses, hp, report);
      ids.hypotheses.add(h.id);
    }
    if ("status" in h) {
      checkEnum(h.status, "hypothesis_status", hp, report);
    }
    if (h.ruled_out && !h.ruled_out_reason) {
      addError(report, hp, "ruled_out is true but ruled_out_reason is missing");
    }
  }

  // Timelines
  const timelines = Array.isArray(data.timelines) ? data.timelines : [];
  for (let i = 0; i < timelines.length; i++) {
    const t = timelines[i];
    const tp = `${path}/timelines[${i}]`;
    checkRequired(t, [
      "id", "label", "person_ids", "generated", "events", "gaps",
      "impossibilities",
    ], tp, report, NULLABLE_FIELDS);
    if ("id" in t) {
      checkIdPrefix(t.id, ID_PREFIXES.timelines, tp, report);
      ids.timelines.add(t.id);
    }

    const events = Array.isArray(t.events) ? t.events : [];
    for (let j = 0; j < events.length; j++) {
      const ev = events[j];
      const ep = `${tp}/events[${j}]`;
      checkRequired(ev, ["date", "date_certainty", "event_type", "description", "assertion_ids"], ep, report, NULLABLE_FIELDS);
      if ("date_certainty" in ev && !DATE_CERTAINTY_TIMELINE.has(ev.date_certainty)) {
        const sorted = Array.from(DATE_CERTAINTY_TIMELINE).sort();
        addError(report, ep, `'${ev.date_certainty}' is not valid for timeline events (use: ${sorted.join(', ')})`);
      }
    }

    const gaps = Array.isArray(t.gaps) ? t.gaps : [];
    for (let j = 0; j < gaps.length; j++) {
      const gap = gaps[j];
      const gp = `${tp}/gaps[${j}]`;
      checkRequired(gap, ["start", "end", "expected_events", "severity"], gp, report, NULLABLE_FIELDS);
      if ("severity" in gap) {
        checkEnum(gap.severity, "severity", gp, report);
      }
    }
  }

  // Proof summaries
  const proofSummaries = Array.isArray(data.proof_summaries) ? data.proof_summaries : [];
  for (let i = 0; i < proofSummaries.length; i++) {
    const ps = proofSummaries[i];
    const psp = `${path}/proof_summaries[${i}]`;
    checkRequired(ps, [
      "id", "question_id", "tier", "vehicle",
      "supporting_assertion_ids", "resolved_conflict_ids",
      "exhaustive_search_summary", "narrative_markdown",
    ], psp, report, NULLABLE_FIELDS);
    if ("id" in ps) {
      checkIdPrefix(ps.id, ID_PREFIXES.proof_summaries, psp, report);
      ids.proof_summaries.add(ps.id);
    }
    if ("tier" in ps) {
      checkEnum(ps.tier, "proof_tier", psp, report);
    }
    if ("vehicle" in ps) {
      checkEnum(ps.vehicle, "proof_vehicle", psp, report);
    }
    if ("question_id" in ps) {
      checkRefExists(ps.question_id, ids.questions, "question", psp, report);
    }
  }

  // Evaluations
  validateEvaluations(data, ids, path, report);

  return ids;
}

function validateEvaluations(
  data: any,
  ids: ResearchIds,
  path: string,
  report: ValidationReport
): void {
  const evaluations = Array.isArray(data.evaluations) ? data.evaluations : [];

  // First pass: collect all evaluation IDs so superseded_by can cross-reference them
  const evIds = new Set<string>();
  for (const ev of evaluations) {
    if (typeof ev === "object" && ev !== null && typeof ev.id === "string") {
      evIds.add(ev.id);
    }
  }

  for (let i = 0; i < evaluations.length; i++) {
    const ev = evaluations[i];
    const ep = `${path}/evaluations[${i}]`;

    checkRequired(ev, [
      "id", "focus", "target_id", "target_type", "verdict",
      "file_path", "timestamp", "superseded_by",
    ], ep, report, NULLABLE_FIELDS);

    if ("id" in ev) {
      checkIdPrefix(ev.id, ID_PREFIXES.evaluations, ep, report);
    }
    if ("focus" in ev) {
      checkEnum(ev.focus, "evaluation_focus", ep, report);
    }
    if ("target_type" in ev) {
      checkEnum(ev.target_type, "evaluation_target_type", ep, report);
    }
    if ("verdict" in ev) {
      checkEnum(ev.verdict, "evaluation_verdict", ep, report);
    }

    // target_id cross-reference: must match a known q_, ps_, or be "project"
    if ("target_id" in ev && typeof ev.target_id === "string") {
      const tt = ev.target_type;
      const tid = ev.target_id;
      if (tt === "question") {
        checkRefExists(tid, ids.questions, "question", ep, report);
      } else if (tt === "proof_summary") {
        checkRefExists(tid, ids.proof_summaries, "proof_summary", ep, report);
      } else if (tt === "project") {
        if (tid !== "project") {
          addError(report, ep, `target_id for target_type 'project' must be "project", got '${tid}'`);
        }
      }
    }

    // superseded_by must be null or reference another evaluation in this array
    if ("superseded_by" in ev && ev.superseded_by !== null) {
      if (typeof ev.superseded_by !== "string") {
        addError(report, ep, `superseded_by must be a string or null, got ${typeof ev.superseded_by}`);
      } else if (!ev.superseded_by.startsWith(ID_PREFIXES.evaluations)) {
        addError(report, ep, `superseded_by '${ev.superseded_by}' should start with '${ID_PREFIXES.evaluations}'`);
      } else if (!evIds.has(ev.superseded_by)) {
        addError(report, ep, `superseded_by references '${ev.superseded_by}' which does not exist in evaluations[]`);
      }
    }

    // timestamp must be a valid ISO 8601 date-time
    if ("timestamp" in ev && typeof ev.timestamp === "string") {
      const ts = new Date(ev.timestamp);
      if (Number.isNaN(ts.getTime())) {
        addError(report, ep, `timestamp '${ev.timestamp}' is not a valid ISO 8601 date-time`);
      }
    }
  }
}

function validateGedcomx(
  data: any,
  report: ValidationReport
): { personIds: Set<string>; sourceIds: Set<string> } {
  const path = "tree.gedcomx.json";

  const personIds = new Set<string>();
  const sourceIds = new Set<string>();

  for (const section of ["persons", "relationships", "sources"]) {
    if (!(section in data)) {
      addError(report, path, `missing top-level section '${section}'`);
    }
  }

  // Sources
  const sources = Array.isArray(data.sources) ? data.sources : [];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const sp = `${path}/sources[${i}]`;
    checkRequired(src, ["id", "title"], sp, report, NULLABLE_FIELDS);
    if ("id" in src) {
      sourceIds.add(src.id);
    }
  }

  // Persons
  const persons = Array.isArray(data.persons) ? data.persons : [];
  for (let i = 0; i < persons.length; i++) {
    const person = persons[i];
    const pp = `${path}/persons[${i}]`;
    checkRequired(person, ["id", "gender", "names"], pp, report, NULLABLE_FIELDS);
    if ("id" in person) {
      personIds.add(person.id);
    }
    if ("gender" in person) {
      checkEnum(person.gender, "gender", pp, report);
    }

    const names = Array.isArray(person.names) ? person.names : [];
    if (names.length === 0) {
      addError(report, pp, "person must have at least one name");
    }
    for (let j = 0; j < names.length; j++) {
      const name = names[j];
      const np = `${pp}/names[${j}]`;
      checkRequired(name, ["id", "given", "surname"], np, report, NULLABLE_FIELDS);
      const nameSources = Array.isArray(name.sources) ? name.sources : [];
      for (let k = 0; k < nameSources.length; k++) {
        const sref = nameSources[k];
        const srp = `${np}/sources[${k}]`;
        if (!("ref" in sref)) {
          addError(report, srp, "source reference missing 'ref'");
        } else if (!sourceIds.has(sref.ref)) {
          addError(report, srp, `references source '${sref.ref}' which does not exist`);
        }
      }
    }

    const facts = Array.isArray(person.facts) ? person.facts : [];
    for (let j = 0; j < facts.length; j++) {
      const fact = facts[j];
      const fp = `${pp}/facts[${j}]`;
      checkRequired(fact, ["id", "type"], fp, report, NULLABLE_FIELDS);
      const ftype = fact.type || "";
      if (ftype && ftype[0] !== ftype[0].toUpperCase()) {
        addError(report, fp, `fact type '${ftype}' should be PascalCase (e.g., 'Birth' not 'birth')`);
      }
      const factSources = Array.isArray(fact.sources) ? fact.sources : [];
      for (let k = 0; k < factSources.length; k++) {
        const sref = factSources[k];
        const srp = `${fp}/sources[${k}]`;
        if (!("ref" in sref)) {
          addError(report, srp, "source reference missing 'ref'");
        } else if (!sourceIds.has(sref.ref)) {
          addError(report, srp, `references source '${sref.ref}' which does not exist`);
        }
      }
    }
  }

  // Relationships
  const relationships = Array.isArray(data.relationships) ? data.relationships : [];
  for (let i = 0; i < relationships.length; i++) {
    const rel = relationships[i];
    const rp = `${path}/relationships[${i}]`;
    checkRequired(rel, ["id", "type"], rp, report, NULLABLE_FIELDS);
    if ("type" in rel) {
      checkEnum(rel.type, "relationship_type", rp, report);
    }

    const rtype = rel.type;
    if (rtype === "ParentChild") {
      if (!("parent" in rel)) {
        addError(report, rp, "ParentChild relationship missing 'parent'");
      } else if (!personIds.has(rel.parent)) {
        addError(report, rp, `parent '${rel.parent}' not found in persons`);
      }
      if (!("child" in rel)) {
        addError(report, rp, "ParentChild relationship missing 'child'");
      } else if (!personIds.has(rel.child)) {
        addError(report, rp, `child '${rel.child}' not found in persons`);
      }
      if ("person1" in rel || "person2" in rel) {
        addError(report, rp, "ParentChild should use 'parent'/'child', not 'person1'/'person2'");
      }
    } else if (rtype === "Couple") {
      if (!("person1" in rel)) {
        addError(report, rp, "Couple relationship missing 'person1'");
      } else if (!personIds.has(rel.person1)) {
        addError(report, rp, `person1 '${rel.person1}' not found in persons`);
      }
      if (!("person2" in rel)) {
        addError(report, rp, "Couple relationship missing 'person2'");
      } else if (!personIds.has(rel.person2)) {
        addError(report, rp, `person2 '${rel.person2}' not found in persons`);
      }
    }

    const relSources = Array.isArray(rel.sources) ? rel.sources : [];
    for (let k = 0; k < relSources.length; k++) {
      const sref = relSources[k];
      const srp = `${rp}/sources[${k}]`;
      if (!("ref" in sref)) {
        addError(report, srp, "source reference missing 'ref'");
      } else if (!sourceIds.has(sref.ref)) {
        addError(report, srp, `references source '${sref.ref}' which does not exist`);
      }
    }
  }

  return { personIds, sourceIds };
}

function validateCrossFile(
  research: any,
  gedcomxPersonIds: Set<string>,
  gedcomxSourceIds: Set<string>,
  report: ValidationReport
): void {
  // Check gedcomx_source_description_id references
  const sources = Array.isArray(research.sources) ? research.sources : [];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const ref = src.gedcomx_source_description_id;
    if (ref && !gedcomxSourceIds.has(ref)) {
      addError(
        report,
        `research.json/sources[${i}]`,
        `gedcomx_source_description_id '${ref}' not found in tree.gedcomx.json sources`
      );
    }
  }

  // Check person_id references in person_evidence
  const personEvidence = Array.isArray(research.person_evidence) ? research.person_evidence : [];
  for (let i = 0; i < personEvidence.length; i++) {
    const pe = personEvidence[i];
    const pid = pe.person_id;
    if (pid && !gedcomxPersonIds.has(pid)) {
      addError(
        report,
        `research.json/person_evidence[${i}]`,
        `person_id '${pid}' not found in tree.gedcomx.json persons`
      );
    }
  }

  // Check subject_person_ids
  const subjectIds = research.project?.subject_person_ids;
  if (Array.isArray(subjectIds)) {
    for (const pid of subjectIds) {
      if (!gedcomxPersonIds.has(pid)) {
        addError(
          report,
          "research.json/project",
          `subject_person_ids contains '${pid}' which is not in tree.gedcomx.json persons`
        );
      }
    }
  }

  // Check timeline person_ids
  const timelines = Array.isArray(research.timelines) ? research.timelines : [];
  for (let i = 0; i < timelines.length; i++) {
    const t = timelines[i];
    const personIds = Array.isArray(t.person_ids) ? t.person_ids : [];
    for (const pid of personIds) {
      if (!gedcomxPersonIds.has(pid)) {
        addError(
          report,
          `research.json/timelines[${i}]`,
          `person_ids contains '${pid}' which is not in tree.gedcomx.json persons`
        );
      }
    }
  }
}

async function validateSidecars(
  research: any,
  projectPath: string,
  report: ValidationReport
): Promise<void> {
  const resultsDir = join(projectPath, "results");
  const logById = new Map<string, any>();
  const log = Array.isArray(research.log) ? research.log : [];

  for (const e of log) {
    if (typeof e === "object" && e !== null && typeof e.id === "string") {
      logById.set(e.id, e);
    }
  }

  const referenced = new Set<string>();
  const payloads = new Map<string, any>();

  // Validate each log entry's sidecar
  for (const e of log) {
    if (typeof e !== "object" || e === null) continue;
    const ref = e.results_ref;
    if (!ref) continue;

    const lp = `research.json/log (${e.id})`;
    if (typeof ref !== "string") {
      addError(report, lp, "results_ref must be a string path or null");
      continue;
    }

    referenced.add(basename(ref));
    const scPath = join(projectPath, ref);

    // Guard against path traversal: results_ref must resolve inside projectPath
    // (it is user-influenced; in multi-tenant it must not read outside the dir).
    const relToProject = relative(resolve(projectPath), resolve(projectPath, ref));
    if (relToProject.startsWith("..") || isAbsolute(relToProject)) {
      addError(report, lp, `results_ref '${ref}' escapes the project directory`);
      continue;
    }

    let sc: any;
    try {
      const scText = await readFile(scPath, "utf-8");
      sc = JSON.parse(scText);
    } catch (error) {
      addError(report, lp, `results_ref points at '${ref}' which does not exist or is invalid JSON`);
      continue;
    }

    const scp = `results/${basename(ref)}`;
    if (typeof sc !== "object" || sc === null) {
      addError(report, scp, "sidecar must be a JSON object");
      continue;
    }

    checkRequired(sc, ["log_id", "tool", "retrieved", "returned_count", "payload"], scp, report, NULLABLE_FIELDS);

    // log_id must match both the owning log entry and the filename
    if (sc.log_id !== e.id) {
      addError(report, scp, `sidecar log_id '${sc.log_id}' does not match log entry id '${e.id}'`);
    }
    if (sc.log_id !== basename(ref, ".json")) {
      addError(report, scp, `sidecar log_id '${sc.log_id}' does not match filename '${basename(ref)}'`);
    }

    // D2: intra-payload consistency — returned_count vs actual results length
    const payload = sc.payload;
    const rc = sc.returned_count;
    if (typeof payload === "object" && payload !== null && Array.isArray(payload.results)) {
      const actual = payload.results.length;
      if (typeof rc === "number" && rc !== actual) {
        addError(report, scp, `returned_count ${rc} != actual results length ${actual} — payload may be truncated`);
      }
      payloads.set(e.id, payload);
    } else {
      addError(report, scp, "payload has no 'results' array — cannot verify retrieval integrity");
    }
  }

  // Orphan sidecars: a results/ file that no log entry references
  try {
    const files = await readdir(resultsDir);
    for (const f of files) {
      if (f.endsWith(".json") && !referenced.has(f)) {
        addError(report, `results/${f}`, "orphan sidecar — no log entry references it");
      }
    }
  } catch {
    // results/ directory doesn't exist — not an error if no log entries reference sidecars
  }

  // D5: every assertion carrying a record_persona_id must resolve it to a
  // real person inside the specific record it names
  const assertions = Array.isArray(research.assertions) ? research.assertions : [];
  for (let i = 0; i < assertions.length; i++) {
    const a = assertions[i];
    if (typeof a !== "object" || a === null) continue;

    const persona = a.record_persona_id;
    if (!persona) continue;

    const ap = `research.json/assertions[${i}]`;
    const logId = a.log_entry_id;
    if (!logId) {
      addError(report, ap, "has record_persona_id but no log_entry_id to resolve it against");
      continue;
    }

    const entry = logById.get(logId);
    if (!entry) {
      continue; // dangling log_entry_id already reported by validateResearch
    }

    if (!entry.results_ref) {
      addError(report, ap, `has record_persona_id but its log entry '${logId}' has no sidecar (results_ref is null)`);
      continue;
    }

    const payload = payloads.get(logId);
    if (!payload) {
      continue; // sidecar missing/unreadable — already reported above
    }

    const recordId = a.record_id;
    let record: any = null;
    for (const r of payload.results || []) {
      if (typeof r === "object" && r !== null && r.recordId === recordId) {
        record = r;
        break;
      }
    }

    if (!record) {
      addError(report, ap, `record_id '${recordId}' does not match any result's recordId in sidecar '${entry.results_ref}'`);
      continue;
    }

    const gx = record.gedcomx;
    const personaIds = new Set<string>();
    if (typeof gx === "object" && gx !== null && Array.isArray(gx.persons)) {
      for (const person of gx.persons) {
        if (typeof person === "object" && person !== null && typeof person.id === "string") {
          personaIds.add(person.id);
        }
      }
    }

    if (!personaIds.has(persona)) {
      addError(report, ap, `record_persona_id '${persona}' does not resolve to a person in record '${recordId}'`);
    }
  }
}
