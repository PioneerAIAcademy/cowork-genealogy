# GEDCOM export — Spec

> **Status:** New (2026-10-27), issue #3896. Implemented by
> `packages/viewer-ui/src/lib/gedcom-export.ts` and the "Export GEDCOM" button in
> `packages/viewer-ui/src/components/layout/Header.tsx`.

The viewer (the alpha web app and the Electron viewer, which share `viewer-ui`) exports
a project's research tree as a GEDCOM file the researcher can import into their own
genealogy program. This spec is the mapping contract: which field of `research.json` and
`tree.gedcomx.json` becomes which GEDCOM line, and which parts of the project are
deliberately left out.

---

## 1. Decisions

- **Client-side, pure.** `exportGedcom(research, gedcomx, { now })` returns the file text.
  No server, MCP tool or transport is involved: both apps already hold both documents in
  `ResearchDataProvider`, and the export needs no network. The agent never produces the
  file.
- **GEDCOM 5.5.1, `CHAR UTF-8`.** 5.5.1 is the version the most programs import. Nothing
  persists the format, so moving to 7.0 later is a change to this module only.
- **Every person is exported, `living` included.** The file goes only to the person who
  owns the research.
- **One `NOTE` record per proof summary, referenced from every `INDI`.** A project holds
  one proof summary per question, so they are not merged into one note.
- **What a genealogist wants to keep.** Beyond the tree itself, the export carries the
  research that justifies it: every source with its full citation and transcription, the
  evidence linking each record to each person (with the confidence and rationale), the
  proof conclusions, and the conflicts, hypotheses and questions that touch each person.
  Process records (the log, plans, evaluations) stay in the project.

## 2. File framing

```
0 HEAD
1 SOUR GENEALOGY_RESEARCH_VIEWER
2 NAME Genealogy Research Viewer
1 DATE 27 OCT 2026
1 SUBM @U1@
1 FILE <file name>
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
1 NOTE Research objective: <project.objective>
0 @U1@ SUBM
1 NAME Genealogy Research Viewer user
... records ...
0 TRLR
```

`SUBM` and its `NAME` are required by 5.5.1. Lines end with LF; there is no BOM. Record
order: INDI, FAM, SOUR, REPO, NOTE.

## 3. Encoding

- **Cross-reference ids are generated** (`@I1@`, `@F1@`, `@S1@`, `@R1@`, `@N1@`), never
  taken from tree ids. Tree ids carry FamilySearch PIDs with characters that are legal
  but collide across documents, and an importer keys on the xref.
- **`@` in a value is written `@@`.** Pointer values (`@I1@`) are the only unescaped `@`.
- **Newlines** in a value split into `CONT` lines one level down. `\r\n` and `\r` count as
  newlines.
- **Long lines wrap with `CONC`** so that no physical line is over 255 characters,
  level and tag included. A split point is never next to a space on either side (some
  importers trim the ends of a `CONC` line), never inside an escaped `@@`, and never
  between the two halves of a surrogate pair. Only a run with no other split point
  falls back to splitting next to a space.

## 4. INDI

One per tree person, in tree order.

| Source | GEDCOM |
|---|---|
| `gender` | `1 SEX M` / `F` / `U` |
| `names[]` (preferred first) | `1 NAME Given /Surname/`, `2 GIVN`, `2 SURN`, `2 NPFX`, `2 NSFX` |
| `names[].type` | `BirthName`→`2 TYPE birth`, `MarriedName`→`2 TYPE married`, `AlsoKnownAs`→`2 TYPE aka`, `Nickname`→`2 NICK <given>`; `Formal`, `Religious` and untyped → no TYPE |
| `names[].sources` | `2 SOUR` (§8) |
| `ark` naming a tree person | `1 _FSFTID <PID>`; `1 REFN <PID>` / `2 TYPE FamilySearch`; `1 NOTE FamilySearch: <url>` |
| `facts[]` | §4.1 |
| `sources` (person-level), parent-child `sources` | `1 SOUR` (§8), skipping a source the person already cites as evidence (§4.3), which carries the fuller citation |
| family links | `1 FAMS @F…@`, `1 FAMC @F…@` (§5) |
| evidence | `1 SOUR @S…@` evidence citations (§4.3) |
| proof summaries | `1 NOTE @N…@` — every proof note on every person |
| research notes | inline `1 NOTE` (§4.4) |

`REFN` carries the bare PID because 5.5.1 caps `USER_REFERENCE_NUMBER` at 20
characters and an ARK (`ark:/61903/4:1:XXXX-XXX`) is longer. `_FSFTID` is the tag
RootsMagic and Ancestry read for a FamilySearch tree id.

The `ark` field carries several shapes in project data: a bare `ark:/61903/4:1:<PID>`,
an ARK resolver URL with or without `www`, a bare `4:1:<PID>`, and a
`https://www.familysearch.org/tree/person/<PID>` URL. All are resolved through
`resolveFamilySearchTarget` (`packages/viewer-ui/src/lib/familysearch-url.ts`), which
also builds the NOTE's URL; the PID is taken from a resolved `4:1:` ARK or
`/tree/person/` path. A record-persona ARK (`1:1:`) or a non-FamilySearch URL writes no
FamilySearch lines.

### 4.1 Facts

| Fact type | Tag |
|---|---|
| Birth | `BIRT` |
| Death | `DEAT` |
| Burial | `BURI` |
| Christening | `CHR` |
| Baptism | `BAPM` |
| Blessing | `BLES` |
| Residence | `RESI` |
| Census | `CENS` |
| Immigration | `IMMI` |
| Emigration | `EMIG` |
| Naturalization | `NATU` |
| Occupation | `OCCU <value>` |
| Education | `EDUC <value>` |
| Religion | `RELI <value>` |
| Will | `WILL` |
| Probate | `PROB` |
| Property | `PROP <value>` |
| `Parents` | skipped — it transcribes the parents' names, which the FAM structure already carries |
| anything else (Military, MilitaryService, a person-level Marriage, custom types) | `1 EVEN [value]` + `2 TYPE <type>` |

A person-level `Marriage` is an `EVEN` because the marriage event belongs on the FAM
(§5). For an event tag, a `value` that is not carried on the line goes in `2 NOTE`.
Under each fact:

- `2 DATE` (§4.2)
- `2 PLAC <standard_place ?? place>`
- `2 SOUR` for each of the fact's source refs (§8)

### 4.2 Dates

1. Take `standard_date` when present. Otherwise take `date`, normalized: a leading `~`
   becomes `ABT ` and the rest is normalized after it; ISO `YYYY-MM-DD` becomes
   `D MON YYYY` and ISO `YYYY-MM` becomes `MON YYYY`; an English month name or
   abbreviation in any case (`March`, `Sept.`) becomes the three-letter month; and
   month-first `Mon D, YYYY` becomes `D MON YYYY`.
2. Uppercase it and check it against the 5.5.1 date grammar: an exact date (`[D] [MON]
   YYYY`), `ABT`/`CAL`/`EST <date>`, `BEF`/`AFT <date>`, `BET <date> AND <date>`,
   `FROM <date> [TO <date>]`, `TO <date>`.
3. If it fails, write the date phrase `(text)` with the original text (`standard_date`
   if present, else `date`). That covers a trailing annotation (`Abt 1845 (?)`) and free
   text (`about Spring 1845`).

A valid date followed by an annotation (`Abt 1845 (?)`) stays a phrase, as issue #3896
specifies. 5.5.1's interpreted-date form, `INT ABT 1845 (?)`, would keep such a date
sortable with its annotation; it is a possible follow-up, not built.

`standard_date` is already GEDCOM-shaped in mixed case (`simplified-gedcomx-spec.md`
§4.5). Step 1's fallback to `date` goes beyond issue #3896's literal rule, which made
every date-only fact a phrase. The data forces it: 526 of the 777 dated facts in
`eval/fixtures/scenarios/*/tree.gedcomx.json` (2026-10-27) carry no `standard_date`, and
the commonest of those values — `~1845`, `1908-03-12`, `1850` — are valid GEDCOM dates
that an importer can sort only if they are not phrases.

### 4.3 Evidence citations

For each non-superseded `person_evidence` on the person, its assertion's **`source_id`**
names the research source (never the tree source id, which several research sources can
share). One citation per distinct research source:

```
1 SOUR @S3@
2 PAGE <citation_detail.where_within>
2 NOTE birth: 1845, Cork, Ireland — probable: same name, age and parish as …
```

The `NOTE` lists each linked assertion as `fact_type: value, date, place — confidence:
rationale`, one per line. This is the record-to-person reasoning a genealogist loses
otherwise.

### 4.4 Research notes

An item links to a person when any of its assertions has a non-superseded
`person_evidence` on that person.

| Item | Its assertions | Note text |
|---|---|---|
| conflict | `competing_assertion_ids` | `Conflict (<status>): <description>`, then the resolved value and rationale |
| hypothesis | `supporting_assertion_ids` + `contradicting_assertion_ids` | `Hypothesis (<status>): <claim>`, then the ruled-out reason and notes |
| question | assertions whose `extracted_for_question_ids` contains it | `Research question (<status>): <question>` |

A question's `resolution_assertion_ids` is not used: it is empty on every unresolved
question in the fixtures, so an open question would never reach anyone.

## 5. FAM

1. **Couples first.** One FAM per `Couple` relationship.
2. **Then parent-child, grouped per child.** The child's parents that form a couple
   with a FAM join it as a child of that FAM.
3. **Leftover parents** of that child form one new FAM only when **exactly two** are
   left. Otherwise each leftover parent gets a single-parent FAM. A child with
   competing candidate parents must not have a couple invented out of them.
4. A FAM is keyed by its unordered parent pair (or single parent), so the same family is
   never written twice.

`HUSB`/`WIFE` are assigned by sex. For a same-sex pair or an `Unknown`, the first person
is `HUSB` and the second `WIFE` — a 5.5.1 limitation (7.0 relaxes it).

Each child gets `1 CHIL` on the FAM and `1 FAMC` on its INDI; each parent gets `1 FAMS`.
Under `FAMC`, the parent-child `subtype` gives `2 PEDI`: `Biological`→`birth`,
`Adoptive`→`adopted`, `Foster`→`foster`. `Step`, `Guardian` and a missing subtype get no
PEDI; `Step` and `Guardian` get `2 NOTE <subtype> parent` instead. When the child's two
parent edges disagree, the first one with a subtype is used.

| Couple fact | Tag |
|---|---|
| Marriage | `MARR` |
| Divorce | `DIV` |
| Annulment | `ANUL` |
| Engagement | `ENGA` |
| MarriageBanns | `MARB` |
| anything else | `EVEN` + `TYPE` |

A couple's `notes[]` and `sources` go on its FAM. A parent-child's `notes[]` go as
`2 NOTE` under the child's `FAMC`, and its `sources` as `1 SOUR` on the child's INDI: a
FAM is shared by all the couple's children, so a note about one child's link does not
belong on it.

## 6. SOUR and REPO

One SOUR record per **research source** (`research.sources[]`), then one per tree source
no research source covers (`treeOnlySources()`).

| Field | GEDCOM |
|---|---|
| tree `title`, else `citation_detail.what` | `1 TITL` |
| tree `author`, else `citation_detail.who` | `1 AUTH` |
| `citation_detail.where`, `when_created` | `1 PUBL` |
| `repository` | `1 REPO @R…@` — one `0 @R…@ REPO` / `1 NAME` per distinct name |
| `transcription` | `1 TEXT` (prefixed `[partial transcription]` when `transcription_truncated`) |
| `citation`, `source_classification`, `url`, `url_archived`, `access_date`, `notes` | `1 NOTE`, one labeled line each |

The URL goes in the NOTE because 5.5.1 has no source URL tag, and a note survives every
importer. A tree-only source writes `TITL`, `AUTH`, and `citation`/`url` in its NOTE.

## 7. Proof notes

One `0 @N…@ NOTE` per `proof_summaries[]` entry:

```
Proof conclusion — <question text> (Tier: <tier>)
<narrative_markdown>
Search summary: <exhaustive_search_summary>
```

## 8. Source references

A tree source ref (`ref`, `page`, `quality`) on a fact, name, person or relationship
resolves to **every** research source whose `gedcomx_source_description_id` equals `ref`,
each written as its own `n SOUR @S…@` with `n+1 PAGE` and `n+1 QUAY`. When no research
source matches, it points at the tree-only SOUR for `ref`. A ref to no known source is
dropped.

## 9. Coverage

Every top-level `research.json` section:

| Section | Exported as |
|---|---|
| `project` | HEAD `NOTE` (objective); `title` names the file |
| `sources` | SOUR records (§6) |
| `assertions`, `person_evidence` | evidence citations (§4.3) |
| `conflicts`, `hypotheses`, `questions` | research notes (§4.4) |
| `proof_summaries` | proof notes (§7) |
| `timelines` | left out — re-derivable from the exported facts |
| `log`, `plans`, `evaluations` | left out — process records, not conclusions |
| `localities`, `known_holdings` | left out — not about a person |
| `rejected_links`, `namesakes`, `warning_justifications` | left out — the tool's own bookkeeping |
| `researcher_profile` | left out — narration settings |

Every `Source` field is covered in §6 except `id`, `gedcomx_source_description_id`
(join keys), `citation_detail.when_accessed` (duplicates `access_date`), `log_entry_id`
(process) and `image_filename` (a path inside the project folder, meaningless elsewhere).

Tree fields left out: `assertion_id` (a backlink into `research.json`), `living` (every
person is exported), `primary`, and fact/name ids.
