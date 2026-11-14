/** A small planted project with a starting tree, for the Compare, People and card-line tests.
 *  None of the committed CI fixtures has a starting tree. Test-only: nothing in the page imports it. */
import type { ProjectDocument, ResearchDocument } from '../contract'

const person = (id: string, given: string, surname: string, gender: string, facts: object[] = []) => ({
  id,
  gender,
  names: [{ given, surname }],
  facts
})

const MARY = person('I1', 'Mary', 'Flynn', 'Female', [
  { type: 'Birth', date: '1850', place: 'Illinois, United States' },
  { type: 'Residence', date: '1880', place: 'St Paul, Ramsey, Minnesota, United States' }
])
const PATRICK = person('I2', 'Patrick', 'Flynn', 'Male', [
  { type: 'Birth', date: '3 Mar 1820', place: 'Cork, Ireland' },
  { type: 'Death', date: '1890' }
])
const JOHN = person('I3', 'John', 'Kelly', 'Male')
const BRIDGET = person('I6', 'Bridget', 'Flynn', 'Female')

export const STARTING_TREE = {
  persons: [MARY, PATRICK, JOHN, BRIDGET],
  relationships: [
    { type: 'ParentChild', parent: 'I2', child: 'I1' },
    { type: 'Couple', person1: 'I1', person2: 'I3', facts: [{ type: 'Marriage', date: '1872' }] }
  ]
}

export const TODAY_TREE = {
  persons: [MARY, PATRICK, JOHN, BRIDGET, person('I4', 'Kate', 'Kelly', 'Female'), person('I5', 'Thomas', 'Flynn', 'Male')],
  relationships: [
    ...STARTING_TREE.relationships,
    { type: 'ParentChild', parent: 'I2', child: 'I1', subtype: 'BiologicalParent' },
    { type: 'ParentChild', parent: 'I6', child: 'I1', sources: [{ ref: '#S2' }] },
    { type: 'ParentChild', parent: 'I1', child: 'I4' },
    { type: 'ParentChild', parent: 'I3', child: 'I4' },
    { type: 'ParentChild', parent: 'I2', child: 'I5' }
  ]
}

const CHICAGO = 'Chicago, Cook, Illinois, United States'
const base = { record_role: 'principal', information_quality: 'primary', informant: 'clerk', informant_proximity: 'eyewitness', record_basis: 'original_record', extracted_for_question_ids: ['q_001'] }
const assertion = (id: string, source: string, record: string, fact_type: string, value: string, extra: object = {}) => ({
  id,
  source_id: source,
  record_id: record,
  fact_type,
  value,
  ...base,
  ...extra
})
const link = (id: string, assertion_id: string, person_id: string, confidence: string, extra: object = {}) => ({
  id,
  assertion_id,
  person_id,
  confidence,
  rationale: 'planted',
  created: '2026-11-02T00:00:00Z',
  ...extra
})

const CENSUS = 'ark:/61903/1:1:AAAA-111'
const MARRIAGE = 'ark:/61903/1:1:BBBB-222'
const BIRTH = 'ark:/61903/1:1:CCCC-333'

export const COMPARE_RESEARCH = {
  project: { id: 'p', objective: 'Find Mary Flynn’s family', subject_person_ids: ['I1'], status: 'active', created: '2026-11-01T10:00:00Z', updated: '2026-11-03T10:00:00Z' },
  sources: [
    { id: 'src_001', citation: '1880 census, Chicago', url: 'https://www.familysearch.org/ark:/61903/1:2:ZZZZ-999', citation_detail: { what: '1880 census' } },
    { id: 'src_002', citation: 'Marriage of Mary Flynn and John Kelly', url: `https://www.familysearch.org/${MARRIAGE}`, gedcomx_source_description_id: 'S2', citation_detail: { what: 'Marriage record' } },
    { id: 'src_003', citation: 'Birth of Kate Kelly', url: `https://www.familysearch.org/${BIRTH}`, citation_detail: { what: 'Birth record' } }
  ],
  assertions: [
    assertion('a_001', 'src_001', CENSUS, 'name', 'Mary Ann Flynn'),
    assertion('a_002', 'src_001', CENSUS, 'birth', 'born', { date: '1851', date_certainty: 'calculated', place: 'Illinois, United States' }),
    assertion('a_003', 'src_001', CENSUS, 'residence', 'lived', { date: '1880', place: CHICAGO }),
    assertion('a_004', 'src_002', MARRIAGE, 'birth', 'born', { date: '4 Apr 1850', place: CHICAGO }),
    assertion('a_005', 'src_002', MARRIAGE, 'marriage', 'married', { date: '12 May 1872', place: CHICAGO }),
    assertion('a_006', 'src_002', MARRIAGE, 'name', 'Mary Kelly'),
    assertion('a_007', 'src_003', BIRTH, 'birth', 'born', { date: '1875', place: CHICAGO }),
    assertion('a_008', 'src_003', BIRTH, 'name', 'Thomas Flynn'),
    assertion('a_009', 'src_001', CENSUS, 'death', 'died', { date: '1895' }),
    assertion('a_010', 'src_001', CENSUS, 'birth', 'born', { date: '1700', superseded_by: 'a_002' }),
    assertion('a_011', 'src_001', CENSUS, 'birth', 'born', { date: '1 Jan 1849' }),
    assertion('a_012', 'src_003', BIRTH, 'relationship', 'daughter of Mary'),
    assertion('a_013', 'src_001', CENSUS, 'birthplace', CHICAGO),
    assertion('a_014', 'src_002', MARRIAGE, 'name', 'Bridget Flynn')
  ],
  person_evidence: [
    link('pe_001', 'a_001', 'I1', 'confident'),
    link('pe_002', 'a_001', 'I1', 'probable'),
    link('pe_003', 'a_002', 'I1', 'confident'),
    link('pe_004', 'a_003', 'I1', 'confident'),
    link('pe_005', 'a_004', 'I1', 'probable'),
    link('pe_006', 'a_005', 'I1', 'confident'),
    link('pe_007', 'a_005', 'I3', 'confident'),
    link('pe_008', 'a_006', 'I1', 'probable'),
    link('pe_009', 'a_007', 'I4', 'confident'),
    link('pe_010', 'a_008', 'I5', 'speculative'),
    link('pe_011', 'a_009', 'I2', 'speculative'),
    link('pe_012', 'a_010', 'I1', 'confident'),
    link('pe_013', 'a_011', 'I1', 'confident', { superseded_by: 'pe_003' }),
    link('pe_014', 'a_012', 'I1', 'confident'),
    link('pe_015', 'a_012', 'I4', 'confident'),
    link('pe_016', 'a_013', 'I1', 'confident'),
    link('pe_017', 'a_014', 'I6', 'probable')
  ],
  timelines: [
    {
      id: 'tl_001',
      label: 'Mary Flynn',
      person_ids: ['I1'],
      generated: '2026-11-02T00:00:00Z',
      events: [
        {
          date: '1880',
          date_certainty: 'exact',
          event_type: 'residence',
          description: 'In the census',
          assertion_ids: ['a_003'],
          conflict_note: 'The census puts her in Chicago, the tree in St Paul.'
        }
      ],
      gaps: [{ start: '1851', end: '1879', expected_events: ['census'], severity: 'medium', notes: 'No census found for 1860 or 1870.' }]
    }
  ],
  namesakes: [
    {
      id: 'ns_001',
      person_id: 'I1',
      name: 'Mary Flynn',
      place: 'Cork, Ireland',
      time_period: '1840s',
      record_ids: ['ark:/61903/1:1:DDDD-444'],
      notes: 'Another Mary Flynn, born in Cork, who stayed there.',
      created: '2026-11-02T00:00:00Z'
    }
  ],
  rejected_links: [
    { id: 'rl_001', assertion_id: 'a_008', person_id: 'I1', reason: 'A man', researcher_words: 'That is her brother, not her.', created: '2026-11-02T00:00:00Z' }
  ]
} as unknown as ResearchDocument

export const COMPARE_DOCUMENT: ProjectDocument = {
  research: COMPARE_RESEARCH,
  tree: TODAY_TREE,
  startingTree: STARTING_TREE,
  derived: { folderName: 'proj_00000000000000aa' }
}
