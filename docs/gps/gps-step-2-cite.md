Deep-Dive Report: GPS Step 2 — Complete and Accurate Citation of Sources

1. Fundamentals of the Genealogical Proof Standard (GPS)

The Genealogical Proof Standard (GPS) is a technical framework established by the Board for Certification of Genealogists (BCG) to measure the credibility of genealogical conclusions. It consists of five essential elements that transform raw data into a soundly reasoned conclusion:

1. A reasonably exhaustive search.
2. Complete and accurate citation of sources.
3. Analysis and correlation of the collected information.
4. Resolution of any conflicting evidence.
5. A soundly reasoned, coherently written conclusion.

Within this methodological sequence, Step 2 is not merely a clerical task; it is a methodological requirement that enables Step 3 (Analysis). By extracting and documenting metadata during the citation process, the researcher provides the necessary identifiers required for weighting the evidence. Without a complete citation, the evidence cannot be validated, and the analysis phase lacks the foundational data needed for correlation.

2. The Strategic Purpose of Source Citation

Source citation serves as the technical bedrock of genealogical credibility. It fulfills two primary strategic functions: it demonstrates the extent of the search and the quality of the sources. Crafting the citation is, in fact, the first act of analysis because it requires the researcher to identify the creator of the record and the informant of the information—critical steps in determining reliability.

A central tenet of the GPS is the "Replication of Research." A genealogical conclusion is only as strong as the ability of another researcher to follow the same path and arrive at the same result. The inability to reproduce a finding casts an immediate shadow on the research logic.

"The inability to replicate the research casts doubts on the conclusion." — Board for Certification of Genealogists

3. The Four-Pillar Citation Framework: Who, What, When, Where

To construct a GPS-compliant citation, the researcher must identify four core components. This metadata extraction allows for unique identification and recovery of the source.

Core Citation Components

Element	Definition	Specific Examples	AI Verification Tip
Who	The person, agency, or corporate body responsible for the record's creation.	National Archives; US Census Bureau; Specific informant.	Extract metadata from creator, author, publisher, or credit_line fields.
What	The specific title of the source or a functional description of the record.	1880 US Federal Census; Missouri State Birth Certificate.	Map to db_title, collection_name, or item_type in the raw data stream.
When	The dates of creation, publication, and digital access.	1880 (Creation); 2024 (Digital Access).	Use date, year, or timestamp from session logs for the "Access Date."
Where	The physical repository or the digital access method (URL/Platform).	Ancestry.com; FamilySearch; National Archives (Washington, DC).	Verify repository_url, url, physical_location, or call_number metadata.

4. Sources vs. Repositories: Critical Distinctions

A common methodological error is conflating the "Source" (the container of information) with the "Repository" (the entity holding that container). Modern research also requires documenting "negative searches"—citing a source specifically because it did not contain the expected information—to prevent redundant research loops.

Source (The Container)	Repository (The Holder)
Birth Certificate: A specific document for an individual.	State Department of Health: The agency holding the record.
1900 US Census: A specific population schedule.	Ancestry.com / NARA: The digital or physical platform/archive.
Family Bible: A handwritten record of a family unit.	Private Possession: The current physical location.
Negative Result: A specific record search that yielded "nil."	Research Log / Logged Session: The record of the search event itself.

5. Integration with the Three-Layer Evidence Model

Step 2 feeds directly into Step 3 (Analysis) through Elizabeth Shown Mills’ Three-Layer Model. This model prevents the over-simplification of record reliability.

* Layer 1: Sources (The Containers)
  * Original: The first recording of an event (e.g., a handwritten ledger).
  * Derivative: Copies, transcriptions, or indexes (e.g., a printed census index).
  * Authored: Compiled works or family histories.
* Layer 2: Information (The Content)
  * Primary: Provided by a direct witness or participant.
  * Secondary: Reported by someone who was not a firsthand witness.
  * Indeterminate: Informant's relationship to the event is unknown.
* Layer 3: Evidence (The Relevance)
  * Direct: Explicitly answers a specific research question.
  * Indirect: Implies an answer through inference or correlation.
  * Negative: The meaningful absence of expected information.
* NEVER use the terms "Primary Source" or "Secondary Source." Sources are categorized by their physical state: Original, Derivative, or Authored.
* RATIONALE: A single source, such as a Death Certificate (Original Source), often contains both Primary Information (the physician witnessing the death) and Secondary Information (the informant recalling the deceased’s birth date). Labeling the entire source as "Primary" is a technical failure that leads to improper evidence weighting.

6. Specialized Concept: Negative Evidence in Citations

Negative evidence is an inference drawn from the "dog that did not bark"—the absence of information that should exist under particular circumstances. Documenting a negative search is a critical skill for autonomous agents to ensure the search remains "reasonably exhaustive" without being redundant.

When documenting negative evidence, the citation must include the search parameters: date ranges, name variants searched, and the specific jurisdictions covered.

Examples of Negative Evidence:

* Census Absence: A child of the correct age missing from a known family household in the 1870 census suggests a possible death or relocation.
* Probate Exclusion: An individual not named in a parent's will where all other siblings are listed may indicate a prior inheritance, estrangement, or death.
* Locality Absence: A surname failing to appear in any tax or land records for a county where an individual allegedly resided for a decade.

7. Technical Implementation: The "Working Citation" for AI Agents

AI agents must generate "Working Citations" that include specific locators to ensure the research can be replicated with pinpoint accuracy.

Checklist for Accurate AI-Generated Citations:

* [ ] Who: Creator, agency, or informant.
* [ ] What: Title or description of the record.
* [ ] When: Date of creation and date of digital access.
* [ ] Where: Repository and/or digital platform URL.
* [ ] Where-within: The precise locator, including Microfilm Roll #, Page #, Entry #, Image # of #, or Frame #.

The density of citations and the complexity of the "Proof Vehicle" must scale with the complexity of the research problem:

* Statement: Used for direct evidence with no conflicts; requires a standard citation.
* Summary: Used for multiple sources with minor conflicts; requires detailed footnotes.
* Argument: Required for Step 4 (Resolution of Conflicting Evidence). This vehicle uses high citation density and narrative logic to explain why certain evidence (e.g., Primary Information) was prioritized over conflicting data (e.g., Secondary Information).

8. Reference Resources and Scholarly Models

To maintain the highest professional standards, AI agents and researchers should model outputs after these authoritative resources:

* Board for Certification of Genealogists (BCG): The governing body for the GPS.
* Genealogy Standards manual: The official handbook for the GPS, edited by Dr. Thomas W. Jones.
* Evidence Explained by Elizabeth Shown Mills: The definitive guide for historical analysis and citation.
* EvidenceExplained.com: The digital companion for "QuickCheck Models" to be used for citation structure verification.
* National Genealogical Society Quarterly (NGSQ): The benchmark for scholarly case studies and complex proof arguments.

