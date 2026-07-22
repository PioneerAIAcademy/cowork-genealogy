"""A deterministic, scripted stand-in for the real Claude Agent SDK + genealogy
skills. It needs no Anthropic key, so the whole POC runs offline. It:

  * conducts the init-project researcher-profile interview (experience +
    subscriptions + objective) conversationally,
  * writes a schema-shaped research.json + tree.gedcomx.json on completion,
  * on later "search records" turns, appends a source/assertion/log entry and a
    results sidecar (which the control-plane watch turns into live viewer
    updates) — demonstrating the full chat -> tools -> viewer loop.

Conversation state persists to /project/.agent_state.json so it survives a
sandbox suspend/resume (the mock-mode analogue of the Agent SDK's session
resume).
"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from pathlib import Path

STATE_FILE = ".agent_state.json"

_EXPERIENCE = ["novice", "intermediate", "experienced", "professional"]
_SUBSCRIPTIONS = [
    "Ancestry", "MyHeritage", "FindMyPast", "Newspapers.com",
    "GenealogyBank", "FindAGrave-Plus",
]
_NARRATION = {
    "novice": "Narrate why each step matters; define genealogy terms on first use.",
    "intermediate": "One-line preamble per step; assume standard record-type familiarity.",
    "experienced": "No preambles; concise rationale only when non-obvious.",
    "professional": "No preambles; terse, citation-first.",
}


def _event(kind: str, **kw) -> dict:
    return {"kind": kind, **kw}


def _title_from_objective(objective: str) -> str:
    """A concise session name from the objective — the mock's stand-in for the
    real agent naming the project (a Claude-style chat title)."""
    head = objective.strip().split(",", 1)[0].strip()
    return head[:57].rsplit(" ", 1)[0] + "…" if len(head) > 60 else head


class MockAgent:
    def __init__(self, project_dir: Path):
        self.dir = project_dir
        self.dir.mkdir(parents=True, exist_ok=True)
        self.state = self._load_state()

    # ── persistence ──────────────────────────────────────────────
    def _load_state(self) -> dict:
        p = self.dir / STATE_FILE
        if p.is_file():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                pass
        # Pre-seeded (sample) project: skip onboarding.
        if (self.dir / "research.json").is_file():
            return {"phase": "active", "experience_level": "intermediate",
                    "subscriptions": [], "objective": None, "log_seq": 1}
        return {"phase": "greet", "experience_level": None, "subscriptions": [],
                "objective": None, "log_seq": 0}

    def _save_state(self) -> None:
        (self.dir / STATE_FILE).write_text(json.dumps(self.state, indent=2))

    def _read_research(self) -> dict | None:
        p = self.dir / "research.json"
        if p.is_file():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                return None
        return None

    def _write_research(self, data: dict) -> None:
        (self.dir / "research.json").write_text(json.dumps(data, indent=2))

    async def interrupt(self) -> bool:
        """The scripted mock has no external call to abort — it cannot self-stop,
        so it returns False and the runner cancels the turn task instead."""
        return False

    # ── turn handling ────────────────────────────────────────────
    async def handle_turn(self, text: str) -> AsyncIterator[dict]:
        phase = self.state["phase"]
        handler = {
            "greet": self._greet,
            "await_experience": self._await_experience,
            "await_subscriptions": self._await_subscriptions,
            "await_objective": self._await_objective,
            "active": self._active,
        }.get(phase, self._active)
        async for ev in handler(text):
            yield ev
        # Synthetic per-turn usage so the alpha-mode cost meter is demonstrable
        # in the offline mock (real cost only accrues in AGENT_MODE=real).
        # `estimated` tells the client to show a "~" + "mock estimate" hint.
        yield _event(
            "usage",
            cost_usd=round(0.004 + 0.00003 * len(text), 5),
            input_tokens=420 + len(text) // 4,
            output_tokens=260,
            estimated=True,
        )
        # turn_done is emitted by the runner (uniform for mock + real).

    async def _greet(self, text: str) -> AsyncIterator[dict]:
        yield _event(
            "text",
            text=(
                "Welcome! I'll help you run a GPS-conformant genealogy research "
                "project. First, a couple of quick questions so I can pitch my "
                "explanations at the right level.\n\n"
                "**What's your genealogy experience?** (novice, intermediate, "
                "experienced, or professional)"
            ),
        )
        self.state["phase"] = "await_experience"
        self._save_state()

    async def _await_experience(self, text: str) -> AsyncIterator[dict]:
        lvl = next((w for w in _EXPERIENCE if w in text.lower()), "intermediate")
        self.state["experience_level"] = lvl
        yield _event("text", text=(
            f"Got it — **{lvl}**. "
            "Which paid record subscriptions do you have? (e.g. Ancestry, "
            "MyHeritage, Newspapers.com — or say \"none\")"
        ))
        self.state["phase"] = "await_subscriptions"
        self._save_state()

    async def _await_subscriptions(self, text: str) -> AsyncIterator[dict]:
        low = text.lower()
        subs = [s for s in _SUBSCRIPTIONS if s.lower() in low]
        self.state["subscriptions"] = subs
        shown = ", ".join(subs) if subs else "none"
        yield _event("text", text=(
            f"Noted — **{shown}**.\n\n"
            "Last thing: **what's your research objective?** Describe the person "
            "and question, e.g. \"Identify the parents of Mary Sullivan, born "
            "ca. 1860 in County Cork.\""
        ))
        self.state["phase"] = "await_objective"
        self._save_state()

    async def _await_objective(self, text: str) -> AsyncIterator[dict]:
        objective = text.strip() or "Unstated objective"
        self.state["objective"] = objective
        lvl = self.state["experience_level"] or "intermediate"

        yield _event("tool_use", tool="init_project",
                     summary="Creating research.json + researcher profile")
        research = {
            "project": {
                "id": "rp_001",
                "objective": objective,
                "subject_person_ids": ["I1"],
                "status": "active",
                "created": "2026-06-06",
                "updated": "2026-06-06",
                "title": _title_from_objective(objective),
            },
            "researcher_profile": {
                "experience_level": lvl,
                "subscriptions": self.state["subscriptions"],
                "narration_guidance": _NARRATION[lvl],
            },
            "questions": [{
                "id": "q_001",
                "question": objective,
                "rationale": "Primary objective set at project start.",
                "selection_basis": "objective_decomposition",
                "priority": "high",
                "status": "open",
                "depends_on": [], "unblocks": [],
                "created": "2026-06-06", "resolved": None,
                "resolution_assertion_ids": [],
                "exhaustive_declaration": {
                    "declared": False, "justification": None,
                    "log_entry_ids": [], "stop_criteria": None,
                },
            }],
            "plans": [], "log": [], "sources": [], "assertions": [],
            "person_evidence": [], "conflicts": [], "hypotheses": [],
            "timelines": [], "proof_summaries": [],
        }
        self._write_research(research)
        # A minimal tree with the subject person.
        (self.dir / "tree.gedcomx.json").write_text(json.dumps({
            "persons": [{
                "id": "I1", "gender": "Unknown",
                "names": [{"id": "n1", "preferred": True, "given": "(subject)", "surname": ""}],
                "facts": [],
            }],
            "relationships": [], "sources": [],
        }, indent=2))
        yield _event("tool_result", tool="init_project",
                     summary="research.json + tree.gedcomx.json created")
        yield _event("text", text=(
            "Your project is set up — you can see it filling in on the right. "
            "I framed your objective as the first research question.\n\n"
            "Try **\"search for census records\"** and I'll run a record search "
            "and log what I find."
        ))
        self.state["phase"] = "active"
        self._save_state()

    async def _active(self, text: str) -> AsyncIterator[dict]:
        low = text.lower()
        if any(k in low for k in ("search", "record", "find", "census", "look")):
            async for ev in self._simulate_search():
                yield ev
        else:
            yield _event("text", text=(
                "I'm in research mode. I can **search for records**, and I'll log "
                "each search with its results, sources, and extracted assertions "
                "(watch the viewer update as I work). What should I look for?"
            ))

    async def _simulate_search(self) -> AsyncIterator[dict]:
        research = self._read_research()
        if research is None:
            yield _event("text", text="No project yet — let's set one up first.")
            return
        self.state["log_seq"] += 1
        seq = self.state["log_seq"]
        log_id = f"log_{seq:03d}"

        yield _event("tool_use", tool="record_search",
                     summary="Searching historical records for the subject")

        # Write a results sidecar the viewer can open.
        sidecar = {
            "log_id": log_id, "tool": "record_search",
            "retrieved": "2026-06-06T12:00:00Z", "returned_count": 1,
            "payload": {"results": [{
                "primaryId": f"rec_{seq}",
                "score": 0.91,
                "collectionTitle": "U.S. Federal Census, 1880",
                "recordTitle": "Household of the subject",
                "arkUrl": "https://www.familysearch.org/ark:/example",
                "gedcomx": {
                    "persons": [{
                        "id": "p1", "gender": "Male",
                        "names": [{"id": "n", "preferred": True,
                                   "given": "Patrick", "surname": "Flynn"}],
                        "facts": [{"id": "f1", "type": "Birth", "primary": True,
                                   "date": "1845", "place": "Pennsylvania"}],
                    }],
                    "relationships": [],
                },
            }]},
        }
        results_dir = self.dir / "results"
        results_dir.mkdir(exist_ok=True)
        (results_dir / f"{log_id}.json").write_text(json.dumps(sidecar, indent=2))

        # Append a log entry + source + assertion to research.json.
        research.setdefault("log", []).append({
            "id": log_id, "plan_item_id": None, "performed": "2026-06-06",
            "tool": "record_search",
            "query": {"surname": "Flynn", "birthPlace": "Pennsylvania"},
            "outcome": "positive", "results_examined": 1,
            "results_ref": f"results/{log_id}.json", "results_available": 1,
            "notes": "Census match for the subject.", "external_site": None,
        })
        src_id = f"src_{seq:03d}"
        research.setdefault("sources", []).append({
            "id": src_id, "gedcomx_source_description_id": f"S{seq}",
            "citation": "1880 U.S. Census, household of the subject.",
            "citation_detail": {
                "who": "U.S. Census Bureau", "what": "1880 Federal Census",
                "when_created": "1880", "when_accessed": "2026-06-06",
                "where": "FamilySearch", "where_within": "Schedule 1",
            },
            "source_classification": "original", "repository": "FamilySearch",
            "access_date": "2026-06-06", "url": None, "url_archived": None,
            "notes": None, "log_entry_id": log_id, "transcription": None,
        })
        research.setdefault("assertions", []).append({
            "id": f"a_{seq:03d}", "source_id": src_id, "record_id": f"rec_{seq}",
            "record_role": "principal", "fact_type": "Birth",
            "value": "1845", "structured_value": None, "date": "1845",
            "date_certainty": "approximate", "place": "Pennsylvania",
            "information_quality": "secondary", "informant": "head of household",
            "informant_proximity": "household_member", "informant_bias_notes": None,
            "evidence_type": "direct", "log_entry_id": log_id,
            "record_persona_id": None, "extracted_for_question_ids": ["q_001"],
        })
        research["project"]["updated"] = "2026-06-06"
        self._write_research(research)
        self._save_state()

        yield _event("tool_result", tool="record_search",
                     summary=f"1 match → logged as {log_id} with a source + assertion")
        yield _event("text", text=(
            f"Found a strong census match. I logged it as **{log_id}**, recorded "
            "the source, and extracted a birth assertion (~1845, Pennsylvania). "
            "Open the Research Log or Assertions section to see it, or click the "
            "log entry to view the raw results."
        ))
