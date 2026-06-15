// Test fixture extracted from docs/research-schema-spec.md Section 9 (Worked Example)
// and docs/simplified-gedcomx-spec.md Section 8

import type { ResearchData, GedcomxData } from '../schema'

export const patrickFlynnResearch: ResearchData = {
  project: {
    id: 'rp_001',
    objective:
      'Identify the parents of Patrick Flynn, born ca. 1845 in Pennsylvania, died 1908 in Schuylkill County, PA',
    subject_person_ids: ['I1'],
    status: 'active',
    created: '2026-05-01',
    updated: '2026-05-04'
  },
  researcher_profile: {
    experience_level: 'intermediate',
    subscriptions: ['Ancestry', 'Newspapers.com'],
    narration_guidance:
      'Researcher has several years of experience with U.S. census and vital records but limited exposure to Irish parish registers. Explain Irish-record reasoning step by step; assume familiarity with standard U.S. record types.'
  },
  questions: [
    {
      id: 'q_001',
      question: 'Who were the parents of Patrick Flynn (b. ~1845, PA, d. 1908)?',
      rationale: 'This is the primary research objective.',
      selection_basis: 'objective_decomposition',
      priority: 'high',
      status: 'in_progress',
      depends_on: [],
      unblocks: ['q_003'],
      created: '2026-05-01',
      resolved: null,
      resolution_assertion_ids: [],
      exhaustive_declaration: {
        declared: false,
        justification: null,
        log_entry_ids: [],
        stop_criteria: null
      }
    },
    {
      id: 'q_002',
      question: 'Where was Patrick Flynn in the 1850 census?',
      rationale:
        'The 1850 census is the earliest enumeration where Patrick would appear by name (age ~5). Locating him in a household identifies candidate parents.',
      selection_basis: 'objective_decomposition',
      priority: 'high',
      status: 'resolved',
      depends_on: [],
      unblocks: ['q_001'],
      created: '2026-05-01',
      resolved: '2026-05-02',
      resolution_assertion_ids: ['a_001', 'a_002', 'a_003'],
      exhaustive_declaration: {
        declared: true,
        justification:
          'Searched 1850 census for Schuylkill County on FamilySearch (indexed and browse), Ancestry (indexed), and MyHeritage (indexed). All three returned the same household. No other Patrick Flynn of matching age found in the county.',
        log_entry_ids: ['log_001', 'log_002', 'log_003'],
        stop_criteria: {
          goal_alignment:
            'Yes — Patrick Flynn located in a specific 1850 household, answering the question.',
          repository_breadth:
            'Three major repositories searched (FamilySearch, Ancestry, MyHeritage). No additional known indexes of the 1850 Schuylkill County census exist.',
          original_substitution:
            'FamilySearch provides the original census image; Ancestry index is derivative but confirmed consistent.',
          independent_verification:
            'FamilySearch (original) and Ancestry (derivative) both return the same household. Two access paths, one underlying original.',
          evidence_class:
            'Yes — FamilySearch provides original census image with indeterminate-quality information.',
          conflict_resolution: 'No conflicts on the 1850 census placement question.',
          overturn_risk:
            'Low — all three repositories agree, and no competing Patrick Flynn of matching age exists in the county.'
        }
      }
    }
  ],
  plans: [
    {
      id: 'pl_001',
      question_id: 'q_002',
      status: 'completed',
      created: '2026-05-01',
      items: [
        {
          id: 'pli_001',
          sequence: 1,
          record_type: 'census',
          jurisdiction: 'Schuylkill County, Pennsylvania',
          date_range: '1850',
          repository: 'FamilySearch',
          rationale: '1850 census fully indexed on FamilySearch. Free access, start here.',
          fallback_for: null,
          status: 'completed'
        },
        {
          id: 'pli_002',
          sequence: 2,
          record_type: 'census',
          jurisdiction: 'Schuylkill County, Pennsylvania',
          date_range: '1850',
          repository: 'Ancestry',
          rationale: 'Ancestry has independent indexing; cross-check for transcription errors.',
          fallback_for: null,
          status: 'completed'
        }
      ]
    },
    {
      id: 'pl_002',
      question_id: 'q_001',
      status: 'active',
      created: '2026-05-02',
      items: [
        {
          id: 'pli_004',
          sequence: 1,
          record_type: 'census',
          jurisdiction: 'Schuylkill County, Pennsylvania',
          date_range: '1860',
          repository: 'FamilySearch',
          rationale:
            'Confirm Patrick still in Thomas Flynn household in 1860. Strengthens parent-child identification.',
          fallback_for: null,
          status: 'completed'
        },
        {
          id: 'pli_005',
          sequence: 2,
          record_type: 'vital_record',
          jurisdiction: 'Schuylkill County, Pennsylvania',
          date_range: '1908',
          repository: 'FamilySearch',
          rationale: 'Death certificate may name parents directly.',
          fallback_for: null,
          status: 'completed'
        },
        {
          id: 'pli_006',
          sequence: 3,
          record_type: 'probate',
          jurisdiction: 'Schuylkill County, Pennsylvania',
          date_range: '1870-1890',
          repository: 'FamilySearch',
          rationale: 'Thomas Flynn probate/will may name Patrick as son.',
          fallback_for: null,
          status: 'in_progress'
        }
      ]
    }
  ],
  log: [
    {
      id: 'log_001',
      plan_item_id: 'pli_001',
      performed: '2026-05-01T10:15:00Z',
      tool: 'record_search',
      query: {
        surname: 'Flynn',
        given: 'Patrick',
        birth_year: 1845,
        birth_place: 'Pennsylvania',
        collection: '1850 Census'
      },
      outcome: 'positive',
      results_examined: 8,
      results_ref: 'results/log_001.json',
      results_available: 8,
      notes: 'Found Patrick Flynn age 5 in household of Thomas Flynn, dwelling 84, Schuylkill Co.',
      external_site: null
    },
    {
      id: 'log_002',
      plan_item_id: 'pli_002',
      performed: '2026-05-01T11:30:00Z',
      tool: 'external_site',
      query: {
        surname: 'Flynn',
        given: 'Patrick',
        birth_year: 1845,
        birth_place: 'Pennsylvania'
      },
      outcome: 'positive',
      results_examined: 12,
      results_ref: null,
      results_available: null,
      notes: 'Ancestry index confirms same household.',
      external_site: {
        site: 'ancestry',
        url_generated:
          'https://www.ancestry.com/search/collections/8054/?name=Patrick_Flynn&birth=1845',
        capture_received: true,
        capture_filename: 'ancestry-1850-flynn-results.pdf'
      }
    },
    {
      id: 'log_005',
      plan_item_id: 'pli_005',
      performed: '2026-05-03T10:00:00Z',
      tool: 'record_search',
      query: {
        surname: 'Flynn',
        given: 'Patrick',
        death_year: 1908,
        death_place: 'Schuylkill County, Pennsylvania'
      },
      outcome: 'positive',
      results_examined: 2,
      results_ref: 'results/log_005.json',
      results_available: 187,
      notes: 'Death certificate found. Names Thomas Flynn as father.',
      external_site: null
    }
  ],
  sources: [
    {
      id: 'src_001',
      gedcomx_source_description_id: 'S1',
      citation:
        '1850 U.S. Census, Schuylkill County, Pennsylvania, population schedule, dwelling 84, family 91, Thomas Flynn household; NARA microfilm publication M432, roll 810; digital image, FamilySearch.org, accessed 1 May 2026.',
      citation_detail: {
        who: 'U.S. Census Bureau',
        what: '1850 U.S. Federal Census, population schedule',
        when_created: '1850',
        when_accessed: '2026-05-01',
        where: 'FamilySearch.org (NARA microfilm M432, roll 810)',
        where_within: 'Schuylkill County, dwelling 84, family 91'
      },
      source_classification: 'original',
      repository: 'FamilySearch',
      access_date: '2026-05-01',
      url: 'https://www.familysearch.org/ark:/61903/1:1:MXYZ',
      url_archived: null,
      notes: 'Image quality good. Enumerator handwriting clear.',
      log_entry_id: 'log_001',
      transcription:
        'Schuylkill County, Pennsylvania, dwelling 84, family 91:\n  Thomas Flynn        45  M  Laborer    Ireland\n  Bridget Flynn       40  F             Ireland\n  Margaret Flynn      12  F             Pennsylvania\n  Patrick Flynn        5  M             Pennsylvania\n  Mary Flynn           3  F             Pennsylvania\n\nEnumerator: J. Welsh, 12 Aug 1850.'
    },
    {
      id: 'src_002',
      gedcomx_source_description_id: 'S1',
      citation:
        '1850 U.S. Census, Schuylkill County, Pennsylvania, population schedule, dwelling 84, Thomas Flynn household; digital image, Ancestry.com, accessed 1 May 2026.',
      citation_detail: {
        who: 'U.S. Census Bureau',
        what: '1850 U.S. Federal Census, population schedule (Ancestry index)',
        when_created: '1850',
        when_accessed: '2026-05-01',
        where: 'Ancestry.com',
        where_within: 'Schuylkill County, dwelling 84'
      },
      source_classification: 'derivative',
      repository: 'Ancestry',
      access_date: '2026-05-01',
      url: null,
      url_archived: null,
      notes: "Ancestry's index of the same original census.",
      log_entry_id: 'log_002'
    },
    {
      id: 'src_004',
      gedcomx_source_description_id: 'S3',
      citation:
        'Pennsylvania Department of Health, death certificate no. 4521 (1908), Patrick Flynn; Pennsylvania State Archives, Harrisburg; digital image, FamilySearch.org, accessed 3 May 2026.',
      citation_detail: {
        who: 'Pennsylvania Department of Health; informant: James Brown (son-in-law)',
        what: 'Death certificate no. 4521',
        when_created: '1908-03-14',
        when_accessed: '2026-05-03',
        where: 'FamilySearch.org (Pennsylvania State Archives, Harrisburg)',
        where_within: 'Certificate no. 4521'
      },
      source_classification: 'original',
      repository: 'FamilySearch',
      access_date: '2026-05-03',
      url: 'https://www.familysearch.org/ark:/61903/1:1:MDEF',
      url_archived: null,
      notes:
        'Informant is son-in-law James Brown. Primary for death facts, secondary for birth facts.',
      log_entry_id: 'log_005'
    }
  ],
  assertions: [
    {
      id: 'a_001',
      source_id: 'src_001',
      record_id: 'ark:/61903/1:1:MXYZ',
      record_role: 'child_1',
      fact_type: 'name',
      value: 'Patrick Flynn',
      structured_value: { given: 'Patrick', surname: 'Flynn' },
      date: null,
      date_certainty: null,
      place: null,
      information_quality: 'indeterminate',
      informant: 'Unknown household member reporting to census enumerator',
      informant_proximity: 'unknown',
      informant_bias_notes: null,
      evidence_type: 'direct',
      log_entry_id: 'log_001',
      record_persona_id: 'P1',
      extracted_for_question_ids: ['q_002']
    },
    {
      id: 'a_002',
      source_id: 'src_001',
      record_id: 'ark:/61903/1:1:MXYZ',
      record_role: 'child_1',
      fact_type: 'birth',
      value: 'age 5',
      structured_value: { year: 1845, place: 'Ireland' },
      date: '~1845',
      date_certainty: 'estimated',
      place: 'Ireland',
      information_quality: 'indeterminate',
      informant: 'Unknown household member (likely Thomas Flynn or wife)',
      informant_proximity: 'household_member',
      informant_bias_notes: null,
      evidence_type: 'indirect',
      log_entry_id: 'log_001',
      extracted_for_question_ids: ['q_002']
    },
    {
      id: 'a_004',
      source_id: 'src_001',
      record_id: 'ark:/61903/1:1:MXYZ',
      record_role: 'child_1',
      fact_type: 'relationship',
      value: 'Listed in household of Thomas Flynn (head), position consistent with child',
      structured_value: {
        relationship_type: 'child_inferred',
        related_person_role: 'head_of_household'
      },
      date: '1850',
      date_certainty: 'exact',
      place: 'Schuylkill County, Pennsylvania',
      information_quality: 'indeterminate',
      informant: 'Inferred from household structure',
      informant_proximity: 'unknown',
      informant_bias_notes: null,
      evidence_type: 'indirect',
      log_entry_id: 'log_001',
      extracted_for_question_ids: ['q_001']
    },
    {
      id: 'a_010',
      source_id: 'src_004',
      record_id: 'ark:/61903/1:1:MABC',
      record_role: 'child_2',
      fact_type: 'relationship',
      value: "Listed in household of Thomas Flynn (head); position and age consistent with son",
      structured_value: { relationship_type: 'child_inferred', related_person_role: 'head_of_household' },
      date: '1860',
      date_certainty: 'exact',
      place: 'Schuylkill County, Pennsylvania',
      information_quality: 'indeterminate',
      informant: 'Inferred from household structure — no explicit informant for relationships in 1860 census',
      informant_proximity: 'unknown',
      informant_bias_notes:
        '1860 census does not state relationships; like the 1850 census, this assertion is inferred from household position, age, and shared surname. The relationship column was not introduced until the 1880 census.',
      evidence_type: 'indirect',
      log_entry_id: null,
      extracted_for_question_ids: ['q_001']
    },
    {
      id: 'a_012',
      source_id: 'src_004',
      record_id: 'ark:/61903/1:1:MDEF',
      record_role: 'deceased',
      fact_type: 'birth',
      value: 'Born 1845, Pennsylvania',
      structured_value: { year: 1845, place: 'Pennsylvania' },
      date: '1845',
      date_certainty: 'approximate',
      place: 'Pennsylvania',
      information_quality: 'secondary',
      informant: 'James Brown (son-in-law)',
      informant_proximity: 'family_not_present',
      informant_bias_notes:
        'Son-in-law reporting birth facts decades after the event. Death cert says Pennsylvania, but census records say Ireland.',
      evidence_type: 'direct',
      log_entry_id: 'log_005',
      extracted_for_question_ids: ['q_001']
    },
    {
      id: 'a_013',
      source_id: 'src_004',
      record_id: 'ark:/61903/1:1:MDEF',
      record_role: 'deceased',
      fact_type: 'relationship',
      value: 'Father: Thomas Flynn',
      structured_value: { relationship_type: 'father', related_person_role: 'deceased' },
      date: null,
      date_certainty: null,
      place: null,
      information_quality: 'secondary',
      informant: 'James Brown (son-in-law)',
      informant_proximity: 'family_not_present',
      informant_bias_notes: 'Secondary information — son-in-law reporting parentage',
      evidence_type: 'direct',
      log_entry_id: 'log_005',
      extracted_for_question_ids: ['q_001']
    }
  ],
  person_evidence: [
    {
      id: 'pe_001',
      assertion_id: 'a_001',
      person_id: 'I1',
      confidence: 'confident',
      rationale:
        'Name matches (Patrick Flynn), age consistent with ~1845 birth, located in Schuylkill County.',
      match_score: null,
      created: '2026-05-01',
      superseded_by: null
    },
    {
      id: 'pe_002',
      assertion_id: 'a_004',
      person_id: 'I1',
      confidence: 'probable',
      rationale:
        'Household position and shared surname with head suggest parent-child relationship.',
      match_score: null,
      created: '2026-05-01',
      superseded_by: null
    },
    {
      id: 'pe_003',
      assertion_id: 'a_004',
      person_id: 'I2',
      confidence: 'probable',
      rationale: 'Thomas Flynn is the other party in the implied parent-child relationship.',
      match_score: 0.82,
      created: '2026-05-01',
      superseded_by: null
    }
  ],
  conflicts: [
    {
      id: 'c_001',
      conflict_type: 'fact',
      description:
        "Patrick Flynn's birthplace: Ireland (censuses) vs. Pennsylvania (death certificate)",
      disputed_attribute: 'birthplace',
      identity_question: null,
      competing_assertion_ids: ['a_002', 'a_012'],
      independence_analysis:
        'The two census records are independent original sources with different enumerators. The death certificate is a third independent original source.',
      weighing_analysis:
        'The census records are contemporary recordings made near the time of birth. The death certificate was created 63 years later by a secondary informant.',
      preferred_assertion_id: 'a_002',
      resolution_rationale:
        "Ireland is accepted. The 1908 death certificate birthplace of 'Pennsylvania' is rejected as a likely error by the son-in-law informant.",
      status: 'resolved',
      blocks_question_ids: []
    }
  ],
  hypotheses: [
    {
      id: 'h_001',
      claim: "Patrick Flynn's father was Thomas Flynn of Schuylkill County, Pennsylvania",
      status: 'supported',
      supporting_assertion_ids: ['a_004', 'a_010', 'a_013'],
      contradicting_assertion_ids: [],
      ruled_out: false,
      ruled_out_reason: null,
      notes: 'Three independent pieces of evidence: 1850 census, 1860 census, death certificate.',
      related_question_ids: ['q_001']
    }
  ],
  timelines: [
    {
      id: 't_001',
      label: 'Patrick Flynn — assuming Thomas Flynn parentage',
      hypothesis_id: 'h_001',
      person_ids: ['I1'],
      generated: '2026-05-03T12:00:00Z',
      events: [
        {
          date: '~1845',
          date_certainty: 'estimated',
          event_type: 'birth',
          place: 'Ireland',
          place_id: 'place_ireland',
          description: 'Born in Ireland, estimated from census ages',
          assertion_ids: ['a_002']
        },
        {
          date: '1850',
          date_certainty: 'exact',
          event_type: 'census',
          place: 'Schuylkill County, Pennsylvania',
          place_id: 'place_schuylkill_co_pa',
          description: 'Enumerated age 5 in Thomas Flynn household, dwelling 84',
          assertion_ids: ['a_004'],
          distance_from_previous_km: 5400,
          conflict_ids: ['c_001'],
          conflict_note: 'Death certificate gives a different father; see c_001.'
        },
        {
          date: '1908-03-12',
          date_certainty: 'exact',
          event_type: 'death',
          place: 'Schuylkill County, Pennsylvania',
          place_id: 'place_schuylkill_co_pa',
          description: 'Died, death certificate names Thomas Flynn as father',
          assertion_ids: ['a_013'],
          distance_from_previous_km: 0
        }
      ],
      gaps: [
        {
          start: '1850',
          end: '1908-03-12',
          expected_events: ['marriage', '1870_census', '1880_census', '1900_census'],
          severity: 'high',
          notes:
            'Probate, naturalization, and city directories should fill some of this 58-year window.'
        }
      ],
      impossibilities: []
    }
  ],
  proof_summaries: [
    {
      id: 'ps_001',
      question_id: 'q_001',
      tier: 'probable',
      vehicle: 'summary',
      supporting_assertion_ids: ['a_004', 'a_010', 'a_013'],
      resolved_conflict_ids: ['c_001'],
      exhaustive_search_summary:
        'Searched 1850 census (3 repositories), 1860 census (FamilySearch), and death certificate (FamilySearch). Probate search in progress.',
      narrative_markdown:
        '## Parentage of Patrick Flynn (ca. 1845–1908)\n\nPatrick Flynn is **Probably** the son of Thomas Flynn of Schuylkill County, Pennsylvania.\n\n### Evidence Summary\n\nThree independent lines of evidence support this conclusion:\n\n1. **1850 U.S. Census** — Patrick Flynn, age 5, in Thomas Flynn household.\n2. **1860 U.S. Census** — Patrick Flynn, age 15, in household of Thomas Flynn (relationship inferred from household position; not stated explicitly until the 1880 census).\n3. **1908 Death Certificate** — Names Thomas Flynn as father (secondary informant).\n\nConclusion rated **Probable** pending probate records and additional census searches.'
    }
  ]
}

export const patrickFlynnGedcomx: GedcomxData = {
  persons: [
    {
      id: 'I1',
      ark: 'https://familysearch.org/ark:/61903/4:1:KGS8-LY1',
      gender: 'Male',
      names: [
        {
          id: 'N1',
          preferred: true,
          given: 'Patrick',
          surname: 'Flynn',
          type: 'BirthName'
        }
      ],
      facts: [
        {
          id: 'F1',
          type: 'Birth',
          primary: true,
          date: '~1845',
          place: 'Ireland',
          sources: [{ ref: 'S1', page: '1850 Census, Schuylkill Co., dwelling 84' }]
        },
        {
          id: 'F2',
          type: 'Death',
          date: '1908-03-12',
          place: 'Schuylkill County, Pennsylvania',
          sources: [{ ref: 'S3', page: 'Death cert. no. 4521' }]
        }
      ]
    },
    {
      id: 'I2',
      gender: 'Male',
      names: [
        {
          id: 'N2',
          preferred: true,
          given: 'Thomas',
          surname: 'Flynn',
          type: 'BirthName'
        }
      ],
      facts: [
        {
          id: 'F3',
          type: 'Birth',
          primary: true,
          date: '~1818',
          place: 'Ireland'
        }
      ]
    },
    {
      id: 'I3',
      gender: 'Female',
      names: [
        {
          id: 'N3',
          preferred: true,
          given: 'Bridget',
          surname: 'Flynn',
          type: 'MarriedName'
        }
      ]
    }
  ],
  relationships: [
    {
      id: 'R1',
      type: 'ParentChild',
      parent: 'I2',
      child: 'I1',
      sources: [
        { ref: 'S1', page: '1850 Census, Schuylkill Co., dwelling 84', quality: 2 },
        { ref: 'S2', page: '1860 Census, Schuylkill Co., dwelling 112', quality: 2 },
        { ref: 'S3', page: 'Death cert. no. 4521', quality: 2 }
      ]
    },
    {
      id: 'R2',
      type: 'ParentChild',
      parent: 'I3',
      child: 'I1',
      subtype: 'Step',
      notes: [
        "Bridget appears as Thomas's wife in the 1850 census; family lore holds she raised Patrick after his birth mother died on the passage from Ireland."
      ],
      sources: [{ ref: 'S1', page: '1850 Census, Schuylkill Co., dwelling 84', quality: 1 }]
    }
  ],
  sources: [
    { id: 'S1', title: '1850 U.S. Federal Census', author: 'U.S. Census Bureau' },
    { id: 'S2', title: '1860 U.S. Federal Census', author: 'U.S. Census Bureau' },
    {
      id: 'S3',
      title: 'Pennsylvania Death Certificates',
      author: 'Pennsylvania Dept. of Health'
    },
    {
      id: 'S4',
      title: 'Schuylkill County Probate Records',
      author: 'Schuylkill County Register of Wills'
    }
  ]
}

// Empty research data for testing initial/empty states
export const emptyResearch: ResearchData = {
  project: {
    id: 'rp_001',
    objective: 'Test objective',
    subject_person_ids: null,
    status: 'active',
    created: '2026-05-01',
    updated: '2026-05-01'
  },
  questions: [],
  plans: [],
  log: [],
  sources: [],
  assertions: [],
  person_evidence: [],
  conflicts: [],
  hypotheses: [],
  timelines: [],
  proof_summaries: []
}
