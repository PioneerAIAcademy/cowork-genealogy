Deep-Dive Report: GPS Step 3 – Analysis and Correlation of Collected Information

1. Foundations of Genealogical Analysis

Step 3 of the Genealogical Proof Standard (GPS) represents the critical transition from data ingestion to intellectual synthesis. While the preceding steps focus on acquisition and documentation, Step 3 is the "thinking phase"—an architectural rigorous process where raw data is transformed into validated information through exhaustive evaluation.

Key Principle: Step 3 (Analysis and Correlation) The systematic process of assessing the quality of source containers, the reliability of the information within them, and the relevance of that information to a specific research objective. It involves linking disparate data points to identify patterns, resolve identities, and establish a body of evidence that meets the threshold of a soundly reasoned conclusion.

A fundamental methodological distinction exists between searching and researching. Searching is a tactical act—locating a document in a logical repository. Researching, however, is a strategic, architectural process involving problem analysis, research planning, and the continuous processing of findings. Architectural rigor demands that analysis be performed during the research process. This "consideration phase" allows for real-time metadata validation and the pursuit of new findings based on clues uncovered in the workflow. Without ongoing analysis, research remains a collection of records rather than a defensible proof.


--------------------------------------------------------------------------------


2. The Three-Layer Evidence Model

To achieve probabilistic confidence in a genealogical conclusion, the researcher must utilize a three-layer model to classify the container, the content, and the relevance of every data point.

2.1 Layer 1: Source Classification (The Containers)

Sources are the physical or digital artifacts that hold information. In GPS-compliant analysis, sources are never classified as "Primary"; that term is reserved strictly for information.

* Original: The first recording of an event, created by a person or agency with a functional duty to record it at or near the time of the event.
* Derivative: Copies, transcriptions, abstracts, or digital indexes. Methodological standards recognize that every step from creation to digitization—including indexing and transcription—introduces a quantifiable risk of error. This layer is prone to the "viral copying" of inaccuracies found in unverified online trees.
* Authored: Compiled works, such as family histories, biographies, or lineage applications, which synthesize multiple sources to reach a conclusion.

2.2 Layer 2: Information Classification (The Content)

Information refers to the specific assertions found within a source container. Reliability depends on the informant’s proximity to the event.

* Primary: Information provided by a direct witness or participant in the event (e.g., a mother reporting a birth date).
* Secondary: Information reported by an individual who was not a firsthand witness (e.g., a grandson providing his grandfather’s birth state on a death certificate).
* Indeterminate: Information where the informant’s identity or relationship to the event cannot be verified (e.g., many pre-1940 census records).

2.3 Layer 3: Evidence Classification (The Relevance)

Evidence is a mental construct created when information is applied to a specific research question.

* Direct: Explicitly answers the research question on its own.
* Indirect: Suggests an answer but requires inference or correlation with other data points to reach a conclusion.
* Negative: The meaningful absence of information that should exist under a specific set of circumstances (the "dog that didn't bark").

Comparison of the Three-Layer Model

Layer	Classification	Definition
1. Source	Original	The first functional recording; the most reliable container type.
	Derivative	Transcriptions or indexes; error-prone due to repeated processing.
	Authored	Synthesized narratives or compiled works; requires verification.
2. Information	Primary	Assertions from a direct witness or participant in the event.
	Secondary	Secondhand reporting; the informant was not a witness.
	Indeterminate	Information from an unknown or unidentifiable informant.
3. Evidence	Direct	Explicitly provides a standalone answer to the research question.
	Indirect	Provides a partial answer; requires correlation with other facts.
	Negative	An inference drawn from the absence of expected information.


--------------------------------------------------------------------------------


3. Advanced Evidence Types: The Power of the Negative

Negative evidence is the "Sherlock Holmes" of methodology. It is an inference drawn from the absence of a record or mention that should exist if a certain hypothesis were true. Because negative evidence involves "blank space," it cannot stand alone; it must be correlated with direct and indirect evidence to build a convincing case.

Negative Evidence Red Flags

* Census Absence: A school-aged child (e.g., 7–10 years old) missing from a presumed family unit, suggesting death, a different parental relationship, or residence with a different relative.
* Omission from Probate: A living individual omitted from a parent's will when all other siblings are explicitly co-enumerated.
* Spousal Absence: A surviving spouse not mentioned in an obituary or land sale, providing negative evidence of a divorce, legal separation, or prior death.
* Surname Absence: The total absence of a surname or its variants in a specific jurisdiction's tax or property records during a timeframe when an ancestor was allegedly resident there.


--------------------------------------------------------------------------------


4. Extraction and Analysis Methodology for AI Agents

For an AI Agent to perform GPS-compliant analysis, it must follow a mechanical "Standard Operating Procedure" (SOP) to ensure every data point is weighted correctly.

Standard Operating Procedure (SOP)

1. Deconstruction into Discrete Assertions: Break every document into "discrete, testable assertions." An AI must not treat a document as a single reliability unit. This allows the agent to assign different reliability scores to different facts. Example: A death certificate provides Primary Information for the death date (witnessed by the physician) but Secondary Information for the birth date (reported by a child decades later).
2. Metadata Validation (Who, What, When, Where):
  * Who: Identify the creator and the informant for each specific assertion.
  * What: Categorize the source type and title (e.g., "1880 U.S. Federal Census").
  * When: Record the event date, the record creation date, and the access date.
  * Where: Log the physical/digital repository and the exact internal location (page/entry/image number).
3. Classification & Scoring: Assign the Three-Layer Model classifications to every assertion.
4. Literal Transcription: Transcribe text exactly as written. Use brackets for uncertain readings (e.g., [?Smith]) or [blank] to denote missing data.


--------------------------------------------------------------------------------


5. Correlation Strategies: Connecting the Dots

Correlation is the act of integrating the "whole body of evidence" to identify patterns that a single document cannot reveal.

The FAN Principle (Family, Associates, Neighbors)

When direct records reach a "brick wall," analysis must expand to the subject's cluster.

* Actionable Insight: Analyze witnesses on land deeds and neighbors in census records (12 households before and after). Because people historically "migrated in clusters," identifying a neighbor's origin frequently reveals the origin of the subject.

Timeline Construction and Gap Analysis

Building a chronological timeline of every documented event (migrations, tax payments, jury duty) allows for the identification of inconsistencies.

* Actionable Insight: Perform Timeline Gap Analysis to identify periods where records should exist but are absent. This reveals "Frankenstein" profiles, such as an individual appearing in two distant locations simultaneously.


--------------------------------------------------------------------------------


6. Conflict Identification and Same-Name Disambiguation

Step 3 requires the explicit identification of conflicts. If conflicts remain unresolved, the conclusion lacks the credibility required by the GPS.

Same-Name Disambiguation Protocol

* Candidate Separation: Treat individuals with the same name as distinct persons until proven otherwise.
* The Co-enumeration Rule: Two individuals with the same name appearing on the same census page or tax list constitute definitive evidence of two separate persons.
* Viral Error Mitigation: Explicitly ignore "hints" from online trees unless they link to an original source, as these platforms often merge distinct people into single erroneous profiles.

Checklist: Conflict Indicators

* [ ] Phonetic vs. Structural Name Variations: Are variations explained by literacy levels or Americanization (e.g., Müller to Miller)?
* [ ] Jurisdictional & Boundary Shifts: Is a birthplace conflict actually a result of changing borders (e.g., a person born in Virginia later enumerated in West Virginia without moving)?
* [ ] Cultural & Social Biases: Are facts altered due to social pressure (e.g., the "Little Dutch Girl" bias where German immigrants identified as Dutch/Deutsch to avoid WWI-era prejudice)?
* [ ] Incentivized Informants: Did the informant have a reason to lie (e.g., a soldier altering their age to enlist or receive a pension)?
* [ ] Chronological Impossibilities: Is a child born after a mother's documented death or before a father's maturity?


--------------------------------------------------------------------------------


7. Implementation: The Preponderance Hierarchy

When sources irreconcilably disagree, use the following hierarchy to weigh evidence. Strength is prioritized from top to bottom.

1. Source Strength
  * Original Sources over Derivative Sources.
  * Derivative Sources over Authored Works.
2. Information Reliability
  * Primary Information (Witness/Participant) over Secondary Information (Secondhand).
  * Case Study: A Delayed Birth Certificate is an Original Source, but if created 50 years after the fact, its information is a "Later Recollection" and is weaker than a Contemporary Recording made at the time of birth.
3. Contextual Validity
  * Contemporary Recordings (at the time of event) over Later Recollections.
  * Official/Formal Records (Probate/Land) over Casual/Informal Records (Letters/Trees).
  * Unbiased Informants over Biased Informants.
4. Quantity and Independence
  * Multiple independent sources agreeing over a single source.
  * Note: Two derivative indexes of the same original count as only one source.


--------------------------------------------------------------------------------


8. Conclusion: Moving Toward a Soundly Reasoned Conclusion

Thorough analysis and correlation establish the credibility of research findings. By adhering to these protocols, a researcher ensures that their logic can be replicated—a core requirement of the GPS. If conflicts are "swept under the rug," the research is fundamentally flawed.

Final Verification for AI Agents

Before concluding a Step 3 analysis, the agent must pass this quality gate:

1. Have I assigned discrete reliability scores to individual facts rather than the whole document?
2. Have I explicitly identified and accounted for "missing" information (negative evidence)?
3. Have I analyzed the subject within their community context (FAN) and accounted for jurisdictional or cultural biases?

