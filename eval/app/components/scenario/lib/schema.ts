// TypeScript types mirroring docs/research-schema-spec.md and docs/simplified-gedcomx-spec.md

// ============================================================
// research.json enums
// ============================================================

export type QuestionStatus = 'open' | 'in_progress' | 'exhaustive_declared' | 'resolved'
export type PlanStatus = 'active' | 'completed' | 'superseded'
export type PlanItemStatus = 'planned' | 'in_progress' | 'completed' | 'skipped'
export type LogOutcome = 'positive' | 'negative' | 'partial' | 'error'
export type SourceClassification = 'original' | 'derivative' | 'authored'
export type InformationQuality = 'primary' | 'secondary' | 'indeterminate'
export type EvidenceType = 'direct' | 'indirect' | 'negative'
export type ConflictType = 'fact' | 'identity'
export type ConflictStatus = 'unresolved' | 'resolved' | 'moot'
export type HypothesisStatus = 'active' | 'supported' | 'ruled_out'
export type ProofTier = 'proved' | 'probable' | 'possible' | 'not_proved' | 'disproved'
export type ProofVehicle = 'statement' | 'summary' | 'argument'
export type PersonEvidenceConfidence = 'confident' | 'probable' | 'speculative'
export type ProjectStatus = 'active' | 'paused' | 'completed'
export type Priority = 'high' | 'medium' | 'low'

export type SelectionBasis =
  | 'timeline_gap'
  | 'unresolved_conflict'
  | 'fan_pivot'
  | 'hypothesis_test'
  | 'objective_decomposition'
  | 'new_evidence'
  | 'record_found_incidentally'
  | 'user_directed'

export type InformantProximity =
  | 'self'
  | 'witness'
  | 'household_member'
  | 'family_not_present'
  | 'official_duty'
  | 'unknown'

export type DateCertainty =
  | 'exact'
  | 'approximate'
  | 'estimated'
  | 'calculated'
  | 'before'
  | 'after'
  | 'between'

export type ExperienceLevel = 'novice' | 'intermediate' | 'experienced' | 'professional'

export type Subscription =
  | 'Ancestry'
  | 'MyHeritage'
  | 'FindMyPast'
  | 'Newspapers.com'
  | 'GenealogyBank'
  | 'FindAGrave-Plus'
  | 'other'
  | 'none'

// ============================================================
// research.json section types
// ============================================================

export interface Project {
  id: string
  objective: string
  subject_person_ids: string[] | null
  status: ProjectStatus
  created: string
  updated: string
}

export interface ResearcherProfile {
  experience_level?: ExperienceLevel
  subscriptions?: Subscription[]
  narration_guidance?: string | null
}

export interface StopCriteria {
  goal_alignment: string
  repository_breadth: string
  original_substitution: string
  independent_verification: string
  evidence_class: string
  conflict_resolution: string
  overturn_risk: string
}

export interface ExhaustiveDeclaration {
  declared: boolean
  justification: string | null
  log_entry_ids: string[]
  stop_criteria: StopCriteria | null
}

export interface Question {
  id: string
  question: string
  rationale: string
  selection_basis: SelectionBasis
  priority: Priority
  status: QuestionStatus
  depends_on: string[]
  unblocks: string[]
  created: string
  resolved: string | null
  resolution_assertion_ids: string[]
  exhaustive_declaration: ExhaustiveDeclaration
}

export interface PlanItem {
  id: string
  sequence: number
  record_type: string
  jurisdiction: string
  date_range: string
  repository: string
  rationale: string
  fallback_for: string | null
  status: PlanItemStatus
}

export interface Plan {
  id: string
  question_id: string
  status: PlanStatus
  created: string
  items: PlanItem[]
}

export interface ExternalSite {
  site: string
  url_generated: string
  capture_received: boolean
  capture_filename: string | null
}

export interface LogEntry {
  id: string
  plan_item_id: string | null
  performed: string
  tool: string
  query: Record<string, unknown>
  outcome: LogOutcome
  results_examined: number
  results_ref?: string | null
  results_available?: number | null
  notes: string | null
  external_site: ExternalSite | null
}

export interface CitationDetail {
  who: string
  what: string
  when_created: string
  when_accessed: string
  where: string
  where_within: string
}

export interface Source {
  id: string
  gedcomx_source_description_id: string
  citation: string
  citation_detail: CitationDetail
  source_classification: SourceClassification
  repository: string
  access_date: string
  url: string | null
  url_archived: string | null
  notes: string | null
  log_entry_id?: string | null
  transcription?: string | null
}

export interface Assertion {
  id: string
  source_id: string
  record_id: string
  record_role: string
  fact_type: string
  value: string
  structured_value: Record<string, unknown> | null
  date: string | null
  date_certainty: DateCertainty | null
  place: string | null
  standard_place?: string | null
  information_quality: InformationQuality
  informant: string
  informant_proximity: InformantProximity
  informant_bias_notes: string | null
  evidence_type: EvidenceType
  log_entry_id: string | null
  record_persona_id?: string | null
  extracted_for_question_ids: string[]
}

export interface PersonEvidence {
  id: string
  assertion_id: string
  person_id: string
  confidence: PersonEvidenceConfidence
  rationale: string
  match_score: number | null
  created: string
  superseded_by: string | null
}

export interface Conflict {
  id: string
  conflict_type: ConflictType
  description: string
  disputed_attribute: string | null
  identity_question: string | null
  competing_assertion_ids: string[]
  independence_analysis: string | null
  weighing_analysis: string | null
  preferred_assertion_id: string | null
  resolution_rationale: string | null
  status: ConflictStatus
  blocks_question_ids: string[]
}

export interface Hypothesis {
  id: string
  claim: string
  status: HypothesisStatus
  supporting_assertion_ids: string[]
  contradicting_assertion_ids: string[]
  ruled_out: boolean
  ruled_out_reason: string | null
  notes: string | null
  related_question_ids: string[]
}

export interface TimelineEvent {
  date: string
  date_certainty: string
  event_type: string
  place: string | null
  standard_place?: string | null
  description: string
  assertion_ids: string[]
  distance_from_previous_km?: number | null
  conflict_ids?: string[] | null
  conflict_note?: string | null
}

export interface TimelineGap {
  start: string
  end: string
  expected_events: string[]
  severity: 'high' | 'medium' | 'low'
  notes?: string | null
}

export interface TimelineImpossibility {
  description: string
  event_1_assertion_id: string
  event_2_assertion_id: string
}

export interface Timeline {
  id: string
  label: string
  hypothesis_id: string | null
  person_ids: string[]
  generated: string
  events: TimelineEvent[]
  gaps: TimelineGap[]
  impossibilities: TimelineImpossibility[]
}

export interface ProofSummary {
  id: string
  question_id: string
  tier: ProofTier
  vehicle: ProofVehicle
  supporting_assertion_ids: string[]
  resolved_conflict_ids: string[]
  exhaustive_search_summary: string
  narrative_markdown: string
}

export interface ResearchData {
  project: Project
  researcher_profile?: ResearcherProfile
  questions: Question[]
  plans: Plan[]
  log: LogEntry[]
  sources: Source[]
  assertions: Assertion[]
  person_evidence: PersonEvidence[]
  conflicts: Conflict[]
  hypotheses: Hypothesis[]
  timelines: Timeline[]
  proof_summaries: ProofSummary[]
}

// ============================================================
// tree.gedcomx.json types (simplified GedcomX)
// ============================================================

export interface GedcomxSourceRef {
  ref: string
  page?: string
  quality?: number
}

export interface GedcomxName {
  id: string
  preferred?: boolean
  given: string
  surname: string
  type?: string
  sources?: GedcomxSourceRef[]
}

export interface GedcomxFact {
  id: string
  type: string
  primary?: boolean
  date?: string
  standard_date?: string
  place?: string
  value?: string
  sources?: GedcomxSourceRef[]
}

export interface GedcomxPerson {
  id: string
  ark?: string
  gender: 'Male' | 'Female' | 'Unknown'
  names: GedcomxName[]
  facts?: GedcomxFact[]
}

export interface GedcomxParentChildRelationship {
  id: string
  type: 'ParentChild'
  parent: string
  child: string
  subtype?: string
  notes?: string[]
  sources?: GedcomxSourceRef[]
}

export interface GedcomxCoupleRelationship {
  id: string
  type: 'Couple'
  person1: string
  person2: string
  facts?: GedcomxFact[]
  notes?: string[]
  sources?: GedcomxSourceRef[]
}

export type GedcomxRelationship = GedcomxParentChildRelationship | GedcomxCoupleRelationship

export interface GedcomxSource {
  id: string
  title: string
  citation?: string
  author?: string
  url?: string
}

export interface GedcomxData {
  persons: GedcomxPerson[]
  relationships: GedcomxRelationship[]
  sources: GedcomxSource[]
}

// ============================================================
// Sidecar payloads (results/log_NNN.json) — per research-schema-spec §5.4.1
// ============================================================

export interface TreeMatch {
  personId: string
  personName: string
  treeId?: string
  ark?: string
}

export interface RecordSearchResult {
  primaryId: string
  personId?: string
  personName?: string
  score?: number
  arkUrl?: string
  collectionTitle?: string
  recordTitle?: string
  birthDate?: string
  birthPlace?: string
  events?: Array<{ type?: string; date?: string; place?: string }>
  gedcomx?: {
    persons: GedcomxPerson[]
    relationships: GedcomxRelationship[]
  }
  treeMatches?: TreeMatch[]
}

export interface FulltextSearchResult {
  id: string
  collectionTitle?: string
  recordType?: string
  recordPlace?: string
  textDocument?: string
  names?: string[]
  places?: string[]
  highlightTerms?: string[]
}

export type SidecarTool = 'record_search' | 'fulltext_search' | string

export interface SidecarFile {
  log_id: string
  tool: SidecarTool
  retrieved: string
  returned_count: number
  payload: {
    results?: Array<RecordSearchResult | FulltextSearchResult>
    [key: string]: unknown
  }
}

// ============================================================
// Helpers
// ============================================================

export function getPreferredName(person: GedcomxPerson): string {
  const preferred = person.names.find((n) => n.preferred) ?? person.names[0]
  if (!preferred) return '(unknown)'
  const parts = [preferred.given, preferred.surname].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : '(unknown)'
}

export function getPrimaryFact(person: GedcomxPerson, type: string): GedcomxFact | undefined {
  return (
    person.facts?.find((f) => f.type === type && f.primary) ??
    person.facts?.find((f) => f.type === type)
  )
}
