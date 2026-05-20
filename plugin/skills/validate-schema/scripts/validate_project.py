#!/usr/bin/env python3
"""Validates research.json and tree.gedcomx.json against published schemas.

Usage: python3 validate_project.py <research.json> <tree.gedcomx.json>

Outputs a validation report to stdout. Exit code 0 = valid, 1 = errors found.
Uses only Python standard library (runs in Cowork VM with no pip).
"""

import json
import sys
from pathlib import Path

# --- Enum definitions (single source of truth) ---

CLOSED_ENUMS = {
    "question_status": {"open", "in_progress", "exhaustive_declared", "resolved"},
    "plan_status": {"active", "completed", "superseded"},
    "plan_item_status": {"planned", "in_progress", "completed", "skipped"},
    "log_outcome": {"positive", "negative", "partial", "error"},
    "source_classification": {"original", "derivative", "authored"},
    "information_quality": {"primary", "secondary", "indeterminate"},
    "evidence_type": {"direct", "indirect", "negative"},
    "conflict_type": {"fact", "identity"},
    "conflict_status": {"unresolved", "resolved", "moot"},
    "hypothesis_status": {"active", "supported", "ruled_out"},
    "proof_tier": {"proved", "probable", "possible", "not_proved", "disproved"},
    "proof_vehicle": {"statement", "summary", "argument"},
    "person_evidence_confidence": {"confident", "probable", "speculative"},
    "project_status": {"active", "paused", "completed"},
    "priority": {"high", "medium", "low"},
    "informant_proximity": {
        "self", "witness", "household_member",
        "family_not_present", "official_duty", "unknown",
    },
    "gender": {"Male", "Female", "Unknown"},
    "relationship_type": {"ParentChild", "Couple"},
    "experience_level": {"novice", "intermediate", "experienced", "professional"},
    "subscription": {
        "Ancestry", "MyHeritage", "FindMyPast", "Newspapers.com",
        "GenealogyBank", "FindAGrave-Plus", "other", "none",
    },
}

SELECTION_BASIS_VALUES = {
    "timeline_gap", "unresolved_conflict", "fan_pivot", "hypothesis_test",
    "objective_decomposition", "new_evidence", "record_found_incidentally",
    "user_directed",
}

DATE_CERTAINTY_VALUES = {
    "exact", "approximate", "estimated", "calculated",
    "before", "after", "between",
}

DATE_CERTAINTY_TIMELINE = {
    "exact", "approximate", "estimated", "calculated",
}

EXTERNAL_SITE_VALUES = {
    "ancestry", "myheritage", "findmypast", "familysearch_web",
}

ID_PREFIXES = {
    "project": "rp_",
    "questions": "q_",
    "plans": "pl_",
    "plan_items": "pli_",
    "log": "log_",
    "sources": "src_",
    "assertions": "a_",
    "person_evidence": "pe_",
    "conflicts": "c_",
    "hypotheses": "h_",
    "timelines": "t_",
    "proof_summaries": "ps_",
}


class ValidationReport:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, path, msg):
        self.errors.append(f"ERROR {path}: {msg}")

    def warn(self, path, msg):
        self.warnings.append(f"WARN  {path}: {msg}")

    def print_report(self):
        if not self.errors and not self.warnings:
            print("VALID: Both project files pass all checks.")
            return
        for e in self.errors:
            print(e)
        for w in self.warnings:
            print(w)
        print(f"\n{len(self.errors)} error(s), {len(self.warnings)} warning(s)")

    @property
    def is_valid(self):
        return len(self.errors) == 0


def check_required(obj, fields, path, report):
    """Check that required fields exist and are not None."""
    for f in fields:
        if f not in obj:
            report.error(path, f"missing required field '{f}'")
        elif obj[f] is None and f not in ("subject_person_ids", "resolved",
                                           "stop_criteria", "external_site",
                                           "fact_type", "identity_question",
                                           "preferred_assertion_id",
                                           "resolution_rationale",
                                           "independence_analysis",
                                           "weighing_analysis",
                                           "ruled_out_reason",
                                           "hypothesis_id",
                                           "match_score", "superseded_by",
                                           "date", "date_certainty", "place",
                                           "informant_bias_notes",
                                           "plan_item_id", "notes",
                                           "url", "url_archived",
                                           "disputed_attribute",
                                           "log_entry_id",
                                           "structured_value",
                                           "fallback_for",
                                           "capture_filename"):
            report.error(path, f"required field '{f}' is null")


def check_id_prefix(obj_id, expected_prefix, path, report):
    """Check ID uses the correct prefix."""
    if not isinstance(obj_id, str):
        report.error(path, f"id must be a string, got {type(obj_id).__name__}")
    elif not obj_id.startswith(expected_prefix):
        report.error(path, f"id '{obj_id}' should start with '{expected_prefix}'")


def check_enum(value, enum_name, path, report):
    """Check value is in a closed enum."""
    valid = CLOSED_ENUMS.get(enum_name)
    if valid and value not in valid:
        report.error(path, f"'{value}' is not a valid {enum_name} (expected one of: {', '.join(sorted(valid))})")


def check_ref_exists(ref_id, valid_ids, ref_type, path, report):
    """Check a cross-reference resolves."""
    if ref_id not in valid_ids:
        report.error(path, f"references {ref_type} '{ref_id}' which does not exist")


# --- research.json validation ---

def validate_research(data, report):
    path = "research.json"

    # Top-level sections
    required_sections = [
        "project", "questions", "plans", "log", "sources",
        "assertions", "person_evidence", "conflicts", "hypotheses",
        "timelines", "proof_summaries",
    ]
    for section in required_sections:
        if section not in data:
            report.error(path, f"missing top-level section '{section}'")

    if not isinstance(data.get("project"), dict):
        report.error(path, "project must be an object")
        return  # can't continue without project

    # Collect all IDs for cross-reference checking
    ids = {section: set() for section in ID_PREFIXES}
    ids["plan_items"] = set()

    # Project
    p = data["project"]
    proj_path = f"{path}/project"
    check_required(p, ["id", "objective", "status", "created", "updated"], proj_path, report)
    if "id" in p:
        check_id_prefix(p["id"], ID_PREFIXES["project"], proj_path, report)
    if "status" in p and p["status"] is not None:
        check_enum(p["status"], "project_status", proj_path, report)

    # Researcher profile (optional — written by init-project from a short
    # two-question interview; absence is not an error)
    rp = data.get("researcher_profile")
    if rp is not None:
        rp_path = f"{path}/researcher_profile"
        if not isinstance(rp, dict):
            report.error(rp_path, "researcher_profile must be an object")
        else:
            if "experience_level" in rp and rp["experience_level"] is not None:
                check_enum(rp["experience_level"], "experience_level", rp_path, report)
            subs = rp.get("subscriptions")
            if subs is not None:
                if not isinstance(subs, list):
                    report.error(rp_path, "subscriptions must be an array")
                else:
                    for s in subs:
                        if s not in CLOSED_ENUMS["subscription"]:
                            report.error(rp_path, f"'{s}' is not a valid subscription value")
            ng = rp.get("narration_guidance")
            if ng is not None and not isinstance(ng, str):
                report.error(rp_path, "narration_guidance must be a string")

    # Questions
    for i, q in enumerate(data.get("questions", [])):
        qp = f"{path}/questions[{i}]"
        check_required(q, [
            "id", "question", "rationale", "selection_basis", "priority",
            "status", "depends_on", "unblocks", "created", "resolved",
            "resolution_assertion_ids", "exhaustive_declaration",
        ], qp, report)
        if "id" in q:
            check_id_prefix(q["id"], ID_PREFIXES["questions"], qp, report)
            ids["questions"].add(q["id"])
        if "status" in q:
            check_enum(q.get("status"), "question_status", qp, report)
        if "priority" in q:
            check_enum(q.get("priority"), "priority", qp, report)
        if "selection_basis" in q and q["selection_basis"] not in SELECTION_BASIS_VALUES:
            report.error(qp, f"'{q['selection_basis']}' is not a valid selection_basis")

        # Exhaustive declaration
        ed = q.get("exhaustive_declaration")
        if isinstance(ed, dict):
            check_required(ed, ["declared", "log_entry_ids"], f"{qp}/exhaustive_declaration", report)
            if ed.get("declared") and not ed.get("log_entry_ids"):
                report.error(f"{qp}/exhaustive_declaration", "declared is true but log_entry_ids is empty")
            if ed.get("declared") and ed.get("stop_criteria") is None:
                report.error(f"{qp}/exhaustive_declaration", "declared is true but stop_criteria is null")
            if ed.get("declared") and isinstance(ed.get("stop_criteria"), dict):
                sc = ed["stop_criteria"]
                for field in ["goal_alignment", "repository_breadth", "original_substitution",
                              "independent_verification", "evidence_class", "conflict_resolution",
                              "overturn_risk"]:
                    if field not in sc:
                        report.error(f"{qp}/exhaustive_declaration/stop_criteria", f"missing '{field}'")

    # Plans
    for i, pl in enumerate(data.get("plans", [])):
        pp = f"{path}/plans[{i}]"
        check_required(pl, ["id", "question_id", "status", "created", "items"], pp, report)
        if "id" in pl:
            check_id_prefix(pl["id"], ID_PREFIXES["plans"], pp, report)
            ids["plans"].add(pl["id"])
        if "status" in pl:
            check_enum(pl.get("status"), "plan_status", pp, report)
        if "question_id" in pl:
            check_ref_exists(pl["question_id"], ids["questions"], "question", pp, report)

        for j, item in enumerate(pl.get("items", [])):
            ip = f"{pp}/items[{j}]"
            check_required(item, [
                "id", "sequence", "record_type", "jurisdiction",
                "date_range", "repository", "rationale", "fallback_for", "status",
            ], ip, report)
            if "id" in item:
                check_id_prefix(item["id"], ID_PREFIXES["plan_items"], ip, report)
                ids["plan_items"].add(item["id"])
            if "status" in item:
                check_enum(item.get("status"), "plan_item_status", ip, report)

    # Log
    for i, entry in enumerate(data.get("log", [])):
        lp = f"{path}/log[{i}]"
        check_required(entry, [
            "id", "plan_item_id", "performed", "tool", "query",
            "outcome", "results_examined", "external_site",
        ], lp, report)
        if "id" in entry:
            check_id_prefix(entry["id"], ID_PREFIXES["log"], lp, report)
            ids["log"].add(entry["id"])
        if "outcome" in entry:
            check_enum(entry.get("outcome"), "log_outcome", lp, report)

        ext = entry.get("external_site")
        if entry.get("tool") == "external_site" and ext is None:
            report.error(lp, "tool is 'external_site' but external_site object is null")
        if isinstance(ext, dict):
            check_required(ext, ["site", "url_generated", "capture_received"], f"{lp}/external_site", report)
            if "site" in ext and ext["site"] not in EXTERNAL_SITE_VALUES:
                report.error(f"{lp}/external_site", f"'{ext['site']}' is not a valid site")

    # Sources
    for i, src in enumerate(data.get("sources", [])):
        sp = f"{path}/sources[{i}]"
        check_required(src, [
            "id", "gedcomx_source_description_id", "citation",
            "citation_detail", "source_classification", "repository",
            "access_date",
        ], sp, report)
        if "id" in src:
            check_id_prefix(src["id"], ID_PREFIXES["sources"], sp, report)
            ids["sources"].add(src["id"])
        if "source_classification" in src:
            check_enum(src.get("source_classification"), "source_classification", sp, report)
        if src.get("log_entry_id"):
            check_ref_exists(src["log_entry_id"], ids["log"], "log entry", sp, report)

        cd = src.get("citation_detail")
        if isinstance(cd, dict):
            check_required(cd, ["who", "what", "when_created", "when_accessed", "where", "where_within"],
                           f"{sp}/citation_detail", report)

    # Assertions
    for i, a in enumerate(data.get("assertions", [])):
        ap = f"{path}/assertions[{i}]"
        check_required(a, [
            "id", "source_id", "record_id", "record_role", "fact_type",
            "value", "information_quality", "informant", "informant_proximity",
            "evidence_type", "extracted_for_question_ids",
        ], ap, report)
        if "id" in a:
            check_id_prefix(a["id"], ID_PREFIXES["assertions"], ap, report)
            ids["assertions"].add(a["id"])
        if "information_quality" in a:
            check_enum(a.get("information_quality"), "information_quality", ap, report)
        if "evidence_type" in a:
            check_enum(a.get("evidence_type"), "evidence_type", ap, report)
        if "informant_proximity" in a:
            check_enum(a.get("informant_proximity"), "informant_proximity", ap, report)
        if "date_certainty" in a and a["date_certainty"] is not None:
            if a["date_certainty"] not in DATE_CERTAINTY_VALUES:
                report.error(ap, f"'{a['date_certainty']}' is not a valid date_certainty")
        if "source_id" in a:
            check_ref_exists(a["source_id"], ids["sources"], "source", ap, report)
        if a.get("log_entry_id"):
            check_ref_exists(a["log_entry_id"], ids["log"], "log entry", ap, report)

    # Person evidence
    for i, pe in enumerate(data.get("person_evidence", [])):
        pp = f"{path}/person_evidence[{i}]"
        check_required(pe, [
            "id", "assertion_id", "person_id", "confidence",
            "rationale", "created",
        ], pp, report)
        if "id" in pe:
            check_id_prefix(pe["id"], ID_PREFIXES["person_evidence"], pp, report)
            ids["person_evidence"].add(pe["id"])
        if "confidence" in pe:
            check_enum(pe.get("confidence"), "person_evidence_confidence", pp, report)
        if "assertion_id" in pe:
            check_ref_exists(pe["assertion_id"], ids["assertions"], "assertion", pp, report)

    # Conflicts
    for i, c in enumerate(data.get("conflicts", [])):
        cp = f"{path}/conflicts[{i}]"
        check_required(c, [
            "id", "conflict_type", "description", "competing_assertion_ids",
            "status", "blocks_question_ids",
        ], cp, report)
        if "id" in c:
            check_id_prefix(c["id"], ID_PREFIXES["conflicts"], cp, report)
            ids["conflicts"].add(c["id"])
        if "conflict_type" in c:
            check_enum(c.get("conflict_type"), "conflict_type", cp, report)
        if "status" in c:
            check_enum(c.get("status"), "conflict_status", cp, report)

        ct = c.get("conflict_type")
        ca = c.get("competing_assertion_ids", [])
        if ct == "fact" and len(ca) < 2:
            report.error(cp, "fact conflict requires at least 2 competing_assertion_ids")
        elif ct == "identity" and len(ca) < 1:
            report.error(cp, "identity conflict requires at least 1 competing_assertion_ids")
        if ct == "fact" and not c.get("disputed_attribute"):
            report.error(cp, "fact conflict requires disputed_attribute")
        if ct == "identity" and not c.get("identity_question"):
            report.error(cp, "identity conflict requires identity_question")

    # Hypotheses
    for i, h in enumerate(data.get("hypotheses", [])):
        hp = f"{path}/hypotheses[{i}]"
        check_required(h, [
            "id", "claim", "status", "supporting_assertion_ids",
            "contradicting_assertion_ids", "ruled_out", "related_question_ids",
        ], hp, report)
        if "id" in h:
            check_id_prefix(h["id"], ID_PREFIXES["hypotheses"], hp, report)
            ids["hypotheses"].add(h["id"])
        if "status" in h:
            check_enum(h.get("status"), "hypothesis_status", hp, report)
        if h.get("ruled_out") and not h.get("ruled_out_reason"):
            report.error(hp, "ruled_out is true but ruled_out_reason is missing")

    # Timelines
    for i, t in enumerate(data.get("timelines", [])):
        tp = f"{path}/timelines[{i}]"
        check_required(t, [
            "id", "label", "person_ids", "generated", "events", "gaps",
            "impossibilities",
        ], tp, report)
        if "id" in t:
            check_id_prefix(t["id"], ID_PREFIXES["timelines"], tp, report)
            ids["timelines"].add(t["id"])

        for j, ev in enumerate(t.get("events", [])):
            ep = f"{tp}/events[{j}]"
            check_required(ev, ["date", "date_certainty", "event_type", "description", "assertion_ids"], ep, report)
            if "date_certainty" in ev and ev["date_certainty"] not in DATE_CERTAINTY_TIMELINE:
                report.error(ep, f"'{ev['date_certainty']}' is not valid for timeline events (use: {', '.join(sorted(DATE_CERTAINTY_TIMELINE))})")

    # Proof summaries
    for i, ps in enumerate(data.get("proof_summaries", [])):
        psp = f"{path}/proof_summaries[{i}]"
        check_required(ps, [
            "id", "question_id", "tier", "vehicle",
            "supporting_assertion_ids", "resolved_conflict_ids",
            "exhaustive_search_summary", "narrative_markdown",
        ], psp, report)
        if "id" in ps:
            check_id_prefix(ps["id"], ID_PREFIXES["proof_summaries"], psp, report)
        if "tier" in ps:
            check_enum(ps.get("tier"), "proof_tier", psp, report)
        if "vehicle" in ps:
            check_enum(ps.get("vehicle"), "proof_vehicle", psp, report)
        if "question_id" in ps:
            check_ref_exists(ps["question_id"], ids["questions"], "question", psp, report)

    return ids


# --- tree.gedcomx.json validation ---

def validate_gedcomx(data, report):
    path = "tree.gedcomx.json"

    for section in ["persons", "relationships", "sources"]:
        if section not in data:
            report.error(path, f"missing top-level section '{section}'")

    source_ids = set()
    person_ids = set()

    # Sources
    for i, src in enumerate(data.get("sources", [])):
        sp = f"{path}/sources[{i}]"
        check_required(src, ["id", "title"], sp, report)
        if "id" in src:
            source_ids.add(src["id"])

    # Persons
    for i, person in enumerate(data.get("persons", [])):
        pp = f"{path}/persons[{i}]"
        check_required(person, ["id", "gender", "names"], pp, report)
        if "id" in person:
            person_ids.add(person["id"])
        if "gender" in person:
            check_enum(person["gender"], "gender", pp, report)

        names = person.get("names", [])
        if not names:
            report.error(pp, "person must have at least one name")
        for j, name in enumerate(names):
            np = f"{pp}/names[{j}]"
            check_required(name, ["id", "given", "surname"], np, report)
            # Check source refs
            for k, sref in enumerate(name.get("sources", [])):
                srp = f"{np}/sources[{k}]"
                if "ref" not in sref:
                    report.error(srp, "source reference missing 'ref'")
                elif sref["ref"] not in source_ids:
                    report.error(srp, f"references source '{sref['ref']}' which does not exist")

        for j, fact in enumerate(person.get("facts", [])):
            fp = f"{pp}/facts[{j}]"
            check_required(fact, ["id", "type"], fp, report)
            # PascalCase check
            ftype = fact.get("type", "")
            if ftype and not ftype[0].isupper():
                report.error(fp, f"fact type '{ftype}' should be PascalCase (e.g., 'Birth' not 'birth')")
            for k, sref in enumerate(fact.get("sources", [])):
                srp = f"{fp}/sources[{k}]"
                if "ref" not in sref:
                    report.error(srp, "source reference missing 'ref'")
                elif sref["ref"] not in source_ids:
                    report.error(srp, f"references source '{sref['ref']}' which does not exist")

    # Relationships
    for i, rel in enumerate(data.get("relationships", [])):
        rp = f"{path}/relationships[{i}]"
        check_required(rel, ["id", "type"], rp, report)
        if "type" in rel:
            check_enum(rel["type"], "relationship_type", rp, report)

        rtype = rel.get("type")
        if rtype == "ParentChild":
            if "parent" not in rel:
                report.error(rp, "ParentChild relationship missing 'parent'")
            elif rel["parent"] not in person_ids:
                report.error(rp, f"parent '{rel['parent']}' not found in persons")
            if "child" not in rel:
                report.error(rp, "ParentChild relationship missing 'child'")
            elif rel["child"] not in person_ids:
                report.error(rp, f"child '{rel['child']}' not found in persons")
            if "person1" in rel or "person2" in rel:
                report.error(rp, "ParentChild should use 'parent'/'child', not 'person1'/'person2'")
        elif rtype == "Couple":
            if "person1" not in rel:
                report.error(rp, "Couple relationship missing 'person1'")
            elif rel["person1"] not in person_ids:
                report.error(rp, f"person1 '{rel['person1']}' not found in persons")
            if "person2" not in rel:
                report.error(rp, "Couple relationship missing 'person2'")
            elif rel["person2"] not in person_ids:
                report.error(rp, f"person2 '{rel['person2']}' not found in persons")

        for k, sref in enumerate(rel.get("sources", [])):
            srp = f"{rp}/sources[{k}]"
            if "ref" not in sref:
                report.error(srp, "source reference missing 'ref'")
            elif sref["ref"] not in source_ids:
                report.error(srp, f"references source '{sref['ref']}' which does not exist")

    return person_ids, source_ids


# --- Cross-file checks ---

def validate_cross_file(research, gedcomx_person_ids, gedcomx_source_ids, report):
    # Check gedcomx_source_description_id references
    for i, src in enumerate(research.get("sources", [])):
        ref = src.get("gedcomx_source_description_id")
        if ref and ref not in gedcomx_source_ids:
            report.error(
                f"research.json/sources[{i}]",
                f"gedcomx_source_description_id '{ref}' not found in tree.gedcomx.json sources"
            )

    # Check person_id references in person_evidence
    for i, pe in enumerate(research.get("person_evidence", [])):
        pid = pe.get("person_id")
        if pid and pid not in gedcomx_person_ids:
            report.error(
                f"research.json/person_evidence[{i}]",
                f"person_id '{pid}' not found in tree.gedcomx.json persons"
            )

    # Check subject_person_ids
    subject_ids = research.get("project", {}).get("subject_person_ids")
    if isinstance(subject_ids, list):
        for pid in subject_ids:
            if pid not in gedcomx_person_ids:
                report.error(
                    "research.json/project",
                    f"subject_person_ids contains '{pid}' which is not in tree.gedcomx.json persons"
                )

    # Check timeline person_ids
    for i, t in enumerate(research.get("timelines", [])):
        for pid in t.get("person_ids", []):
            if pid not in gedcomx_person_ids:
                report.error(
                    f"research.json/timelines[{i}]",
                    f"person_ids contains '{pid}' which is not in tree.gedcomx.json persons"
                )


# --- Main ---

def main():
    if len(sys.argv) != 3:
        print("Usage: python3 validate_project.py <research.json> <tree.gedcomx.json>")
        sys.exit(2)

    research_path = Path(sys.argv[1])
    gedcomx_path = Path(sys.argv[2])
    report = ValidationReport()

    # Load files
    if not research_path.exists():
        report.error("", f"research.json not found at {research_path}")
    if not gedcomx_path.exists():
        report.error("", f"tree.gedcomx.json not found at {gedcomx_path}")

    if report.errors:
        report.print_report()
        sys.exit(1)

    try:
        with open(research_path) as f:
            research = json.load(f)
    except json.JSONDecodeError as e:
        report.error("research.json", f"invalid JSON: {e}")
        report.print_report()
        sys.exit(1)

    try:
        with open(gedcomx_path) as f:
            gedcomx = json.load(f)
    except json.JSONDecodeError as e:
        report.error("tree.gedcomx.json", f"invalid JSON: {e}")
        report.print_report()
        sys.exit(1)

    # Validate each file
    research_ids = validate_research(research, report)
    gedcomx_person_ids, gedcomx_source_ids = validate_gedcomx(gedcomx, report)

    # Cross-file checks
    validate_cross_file(research, gedcomx_person_ids, gedcomx_source_ids, report)

    report.print_report()
    sys.exit(0 if report.is_valid else 1)


if __name__ == "__main__":
    main()
