AI Agent Implementation Guide: The Genealogical Proof Standard (GPS)

1. Introduction to the GPS for AI Agents

The Genealogical Proof Standard (GPS) is the industry-standard methodology for establishing the credibility of family history conclusions. For an AI agent, the GPS represents the transition from "AI guessing" based on statistical probability to structured autonomous research with mechanical verification.

The agent’s mission is to execute a rigorous, goal-oriented investigation where every assertion is anchored in a verifiable source.

The Five Essential Elements of the GPS

The AI agent must systematically execute these five elements:

1. Reasonably Exhaustive Research: Conduct a thorough search of all relevant records to ensure no obvious evidence is overlooked.
2. Complete and Accurate Source Citation: Provide the "Who, What, When, Where, and Where-within" for every data point.
3. Analysis and Correlation of Evidence: Evaluate the quality of source containers, the reliability of informants, and the relevance of findings.
4. Resolution of Conflicting Evidence: Provide a rational, articulated explanation for discrepancies.
5. Soundly Reasoned and Coherently Written Conclusions: Formulate a defensible argument based on the sum of the evidence.

2. Phase 1: Reasonably Exhaustive Research (RES)

Methodology & Search Strategy

Agents must distinguish between "searching" (casual data retrieval) and "researching" (a goal-directed cycle of problem analysis and planning).

Actionable Instruction: Setting Measurable Goals

The agent must define specific, measurable research objectives to prevent infinite loops or broad, unachievable targets.

* Non-Negotiable Constraint: Every session must begin with a specific research question (e.g., "Identify the biological parents of Patrick Flynn, born 1845 in Pennsylvania").

The FAN Principle (Cluster Research)

When direct evidence for a subject is missing, the agent is commanded to investigate the FAN club:

* Family (Siblings, spouses, in-laws)
* Associates (Witnesses to deeds/wills, godparents, business partners)
* Neighbors (Landowners within a 5-mile radius, census neighbors 12 households before/after)

Negative Evidence Implementation ("The Dog Not Barking")

Negative evidence is the inference drawn from the absence of information that should exist under specific circumstances.

* Logging Protocol: The agent must log every search string attempted, even those returning "nil."
* Example: If a child is missing from an 1860 census where they should logically appear, the agent must log this as a finding rather than an omission.

AI Tool Application: Autonomous Research Loops

Utilize tools like Claude Code to run iterative loops:

1. Search: Execute specific query.
2. Verify: Cross-reference results against existing data inventory.
3. Log: Record the search string, date, and results (including "nil").
4. Pivot: Modify the search based on findings (e.g., switching to the FAN club if the primary subject is missing).

3. Phase 2: Complete and Accurate Source Citation

The Citation Framework

The agent must record citations using Elizabeth Shown Mills’ "QuickCheck" model logic.

Element	Definition
Who	The creator, agency, or informant (e.g., U.S. Census Bureau).
What	The title of the record or a specific description (e.g., "1880 U.S. Federal Census").
When	The date the record was created and the date accessed by the agent.
Where	The physical/digital repository (e.g., National Archives, Ancestry.com).
Where-within	The specific page, entry, line, image number, or microfilm roll.

Actionable Instruction: "Mad-Libs" Citation Template

The agent must generate a working citation for every finding using the following format:

[WHO: Creator], "[WHAT: Title]," [WHEN: Date], [WHERE: Repository], [WHERE-WITHIN: Page/Entry/URL/Image #].

Nomenclature Guardrails

To prevent methodological drift, the agent must adhere to strict terminology:

* FORBIDDEN: "Primary Source" or "Secondary Source."
* MANDATED: Describe the container as Original (first recording), Derivative (index, transcription, copy), or Authored (compiled history).

4. Phase 3: Analysis and Correlation of Evidence

The Three-Layer Evidence Model

The agent must classify every finding through this three-layer hierarchy.

Layer	Classification Options	Agent Logic
1: Source (The Container)	Original, Derivative, Authored	How was this record physically created?
2: Information (The Content)	Primary, Secondary, Indeterminate	Did the informant personally witness the event?
3: Evidence (The Relevance)	Direct, Indirect, Negative	Does this fact explicitly answer the research question?

Agent Logic: Discrete Assertion Tracking

The agent shall not evaluate a document as a single unit. It must break documents into discrete, testable assertions. (e.g., a death certificate provides Primary Information for the date of death, but Secondary Information for the birth date).

Note-Taking Protocol Checklist

During the "Consideration Phase," the agent must record:

* [ ] Search Parameters: The exact string and database used.
* [ ] Source Quality: Legibility issues, smudges, or missing pages.
* [ ] Analytical Queries: Questions raised (e.g., "Why is this subject listed as 'Junior' on this deed if no 'Senior' lives in the county?").

5. Phase 4: Resolution of Conflicting Evidence

The Preponderance Hierarchy

When evidence conflicts, rank the strength of the findings using this refined hierarchy:

1. Original Sources over Derivative Sources (only if information quality is equal).
2. Primary Information (eyewitness) over Secondary Information (recollected).
3. Contemporary Recordings (made at the time) over later recollections.
4. Multiple Independent Sources over a single source.

Logic Guardrail: Same-Name Disambiguation

Treat individuals as distinct persons if they are co-enumerated in the same record (e.g., two men named John Smith on the same census page). The agent must never "merge" these identities without explicit proof of identity.

Common Conflict Scenarios

The agent must identify and explain discrepancies such as:

* Boundary Changes: A subject born in "Virginia" who later appears as born in "West Virginia" despite never moving land (e.g., the 1863 statehood split).
* Informant Bias: An individual lying about their age on a 1917 draft card to appear eligible for service.
* Transcription Errors: Name variations (e.g., Patrick Flynn birth listed as "Ohio" in 1900 vs. "Pennsylvania" in 1850/60/70/80).

Defensible Rationale

The agent must articulate a defensible rationale for setting aside conflicting data.

* Example: "The 1900 census birthplace of 'Ohio' is rejected as an outlier provided by an indeterminate informant; Pennsylvania is accepted based on four contemporary censuses and a death certificate."

6. Phase 5: Soundly Reasoned and Coherently Written Conclusions

Proof Vehicles

* Statement: For simple, direct evidence with no conflicts.
* Summary: For multiple sources with minor, resolved conflicts.
* Argument: For complex cases involving indirect or negative evidence.

Confidence Tiers

The agent must categorize every conclusion using this scale:

Tier	Definition
Proved	2+ independent original sources with primary info agree; no conflicts remain.
Probable	Strong evidence exists, but a minor conflict or gap remains unresolved.
Possible	A credible hypothesis with some supporting data; requires more research.
Not Proved	Insufficient evidence to lean toward any conclusion.
Disproved	Evidence affirmatively refutes the hypothesis.

Sample Proof Argument

**Conclusion: Parentage of Patrick Flynn (1845–1908)**
Patrick Flynn is **Proved** to be the son of Thomas Flynn (1818–1881).

**Evidence Summary:**
1. Thomas Flynn’s probated will (Original Source) names Patrick as his son.
2. Patrick’s 1908 death certificate (Primary info for death, Secondary for birth) names Thomas as father.
3. Patrick is co-enumerated in Thomas’s household in 1851 and 1861 censuses.
4. Names of siblings in census records (Jack, Henry, Seth) match heirs named in Thomas's will.

**Conflict Resolution:** 
A 1900 census entry listing Patrick's birth in Ohio is dismissed as an outlier. It was likely provided by a neighbor informant (Secondary Information), whereas the 1850-1880 records (Contemporary) consistently list Pennsylvania.


7. Agent Technical Guardrails & Skills

Non-Negotiable Constraints

* Anti-Fabrication: The agent must NEVER invent a source, person, or URL. Use the tag [citation needed] for unverified claims.
* Graceful Degradation: If technical limits (e.g., broken URLs, illegible text, or paywalls) prevent analysis, the agent must explicitly state what it can provide and what is missing, rather than guessing.

Living Person Protection (The 100-Year Rule)

Any person with an unconfirmed death date or a birth date within the last 100 years is treated as "Living."

* Redaction Rule: Redact all PII (addresses, health info, financial data) for living persons.

Metrics for Success

The agent must report these metrics after every session:

* Ratio of Sourced Claims vs. Total Claims.
* Number of Resolved Conflicts vs. Identified Conflicts.
* Count of Negative Evidence (nil) findings logged.

Deployment Path Comparison

Feature	Cloud-Based (ChatGPT / Claude)	Local Models (LM Studio / Gemma 4)
Data Privacy	Data leaves machine; subject to provider policies.	Total privacy; data remains on local hardware.
Reasoning Power	High; large context windows for complex arguments.	Variable; dependent on local GPU/RAM (e.g., Gemma 4).
Workflow	Ideal for broad web searches.	Ideal for private document analysis (Claude Cowork).
Agent Skill	GPTs / Projects.	Local skills / OpenClaw.
