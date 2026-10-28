import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'gedcom'
import { exportGedcom, gedcomDate, gedcomFileName } from '../gedcom-export'
import type {
  ResearchData,
  GedcomxData,
  GedcomxPerson,
  GedcomxRelationship,
  Source,
  Assertion,
  PersonEvidence
} from '../schema'

// The output is checked with an independent parser (`gedcom`, a dev dependency),
// never by snapshotting the emitter's own text. Spec: docs/specs/gedcom-export-spec.md.

type GNode = {
  type: string
  data?: { value?: string; xref_id?: string; pointer?: string }
  children?: GNode[]
}

const NOW = new Date(Date.UTC(2026, 9, 27))

function records(text: string): GNode[] {
  return (parse(text) as GNode).children ?? []
}

function ofType(text: string, type: string): GNode[] {
  return records(text).filter((r) => r.type === type)
}

function child(node: GNode, type: string): GNode[] {
  return (node.children ?? []).filter((c) => c.type === type)
}

function walk(node: GNode, visit: (n: GNode) => void): void {
  visit(node)
  for (const c of node.children ?? []) walk(c, visit)
}

const POINTER_TAGS = new Set(['HUSB', 'WIFE', 'CHIL', 'FAMC', 'FAMS', 'SOUR', 'NOTE', 'REPO', 'SUBM'])

/** The xref a pointer-tag node points at. The parser reports some (`FAMS`) as
 *  `pointer` and others (`NOTE`) as a value; either way a pointer is a whole
 *  `@X@`, which escaped text (`@@`) can never be. */
function pointerOf(n: GNode): string | undefined {
  if (!POINTER_TAGS.has(n.type)) return undefined
  const v = n.data?.pointer ?? n.data?.value
  return v && /^@[^@]+@$/.test(v) ? v : undefined
}

/** A text value, or undefined for a pointer. */
function textOf(n: GNode): string | undefined {
  return pointerOf(n) ? undefined : n.data?.value
}

function lines(text: string): string[] {
  return text.split('\n').filter((l) => l !== '')
}

// --- builders ------------------------------------------------------------

function research(overrides: Partial<ResearchData> = {}): ResearchData {
  return {
    project: {
      id: 'proj_1',
      objective: 'Find the parents of John Smith',
      status: 'active',
      created: '2026-01-01',
      updated: '2026-01-01',
      title: 'Smith parents'
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
    proof_summaries: [],
    evaluations: [],
    ...overrides
  } as ResearchData
}

function person(id: string, overrides: Partial<GedcomxPerson> = {}): GedcomxPerson {
  return {
    id,
    gender: 'Male',
    names: [{ id: `${id}-n`, given: id, surname: 'Smith', preferred: true }],
    ...overrides
  }
}

function tree(
  persons: GedcomxPerson[],
  relationships: GedcomxRelationship[] = [],
  sources: GedcomxData['sources'] = []
): GedcomxData {
  return { persons, relationships, sources }
}

function researchSource(id: string, treeId: string, overrides: Partial<Source> = {}): Source {
  return {
    id,
    gedcomx_source_description_id: treeId,
    citation: `Citation for ${id}`,
    citation_detail: {
      who: 'County clerk',
      what: `Record ${id}`,
      when_created: '1850',
      when_accessed: '2026-01-01',
      where: 'Cork, Ireland',
      where_within: `page for ${id}`
    },
    source_classification: 'original',
    repository: 'FamilySearch',
    access_date: '2026-01-01',
    ...overrides
  } as Source
}

function assertion(id: string, sourceId: string, overrides: Partial<Assertion> = {}): Assertion {
  return {
    id,
    source_id: sourceId,
    record_id: 'rec',
    record_role: 'principal',
    fact_type: 'birth',
    value: 'John Smith',
    date: '1845',
    place: 'Cork',
    information_quality: 'primary',
    informant: 'father',
    informant_proximity: 'direct',
    record_basis: 'image',
    extracted_for_question_ids: [],
    ...overrides
  } as Assertion
}

function evidence(id: string, assertionId: string, personId: string): PersonEvidence {
  return {
    id,
    assertion_id: assertionId,
    person_id: personId,
    confidence: 'probable',
    rationale: `rationale ${id}`,
    created: '2026-01-01'
  } as PersonEvidence
}

const couple = (id: string, p1: string, p2: string): GedcomxRelationship => ({
  id,
  type: 'Couple',
  person1: p1,
  person2: p2
})
const parentOf = (id: string, parent: string, kid: string, subtype?: string): GedcomxRelationship => ({
  id,
  type: 'ParentChild',
  parent,
  child: kid,
  ...(subtype ? { subtype } : {})
})

// --- §2 framing ----------------------------------------------------------

describe('file framing', () => {
  const text = exportGedcom(research(), tree([person('I1')]), { now: NOW })

  it('starts with a 5.5.1 UTF-8 HEAD and ends with TRLR', () => {
    const all = lines(text)
    expect(all[0]).toBe('0 HEAD')
    expect(all[all.length - 1]).toBe('0 TRLR')
    const head = ofType(text, 'HEAD')[0]
    const gedc = child(head, 'GEDC')[0]
    expect(child(gedc, 'VERS')[0].data?.value).toBe('5.5.1')
    expect(child(gedc, 'FORM')[0].data?.value).toBe('LINEAGE-LINKED')
    expect(child(head, 'CHAR')[0].data?.value).toBe('UTF-8')
    expect(child(head, 'SOUR')).toHaveLength(1)
    expect(child(head, 'DATE')[0].data?.value).toBe('27 OCT 2026')
  })

  it('has a SUBM record with a NAME, pointed at from HEAD', () => {
    const subm = ofType(text, 'SUBM')
    expect(subm).toHaveLength(1)
    expect(child(subm[0], 'NAME')[0].data?.value).toBeTruthy()
    expect(child(ofType(text, 'HEAD')[0], 'SUBM')[0].data?.pointer).toBe(subm[0].data?.xref_id)
  })
})

describe('gedcomFileName', () => {
  it('uses the project title and strips characters no file system accepts', () => {
    expect(gedcomFileName(research())).toBe('Smith parents.ged')
    const r = research()
    r.project.title = 'A/B: "C"?'
    expect(gedcomFileName(r)).toBe('AB C.ged')
    expect(gedcomFileName(null)).toBe('research.ged')
  })
})

// --- §3 encoding ---------------------------------------------------------

describe('encoding', () => {
  it('generates xrefs and never uses tree ids', () => {
    const text = exportGedcom(research(), tree([person('KWCJ-JAM7')]), { now: NOW })
    const indi = ofType(text, 'INDI')[0]
    expect(indi.data?.xref_id).toBe('@I1@')
    expect(text).not.toContain('@KWCJ-JAM7@')
  })

  it('writes a literal @ as @@', () => {
    const r = research()
    r.project.objective = 'email me at a@b.org'
    const text = exportGedcom(r, tree([]), { now: NOW })
    expect(text).toContain('a@@b.org')
    expect(text).not.toMatch(/a@b\.org/)
  })

  it('splits newlines into CONT and wraps long lines with CONC, no line over 255', () => {
    const word = 'abcdefghij '
    const long = word.repeat(60).trim() // 659 chars
    const r = research({
      questions: [
        { id: 'q_001', question: 'Who were the parents?' } as ResearchData['questions'][number]
      ],
      proof_summaries: [
        {
          id: 'ps_001',
          question_id: 'q_001',
          tier: 'proved',
          vehicle: 'argument',
          shortfall: 'none',
          supporting_assertion_ids: [],
          resolved_conflict_ids: [],
          exhaustive_search_summary: '',
          narrative_markdown: `First paragraph.\n\n${long}`
        } as unknown as ResearchData['proof_summaries'][number]
      ]
    })
    const text = exportGedcom(r, tree([person('I1')]), { now: NOW })
    for (const l of lines(text)) expect(l.length).toBeLessThanOrEqual(255)
    expect(text).toMatch(/^1 CONT First paragraph\.$/m)
    expect(text).toMatch(/^1 CONT$/m)
    expect(text).toMatch(/^1 CONC /m)
    for (const l of lines(text)) {
      if (l.startsWith('1 CONC ')) expect(l[7]).not.toBe(' ')
    }
    const note = ofType(text, 'NOTE')[0]
    // The parser folds CONT/CONC back; the long line survives intact.
    expect(note.data?.value).toContain(long)
  })

  it('never splits a surrogate pair across CONC lines', () => {
    const r = research()
    r.project.objective = '😀'.repeat(200)
    const text = exportGedcom(r, tree([]), { now: NOW })
    for (const l of lines(text)) {
      expect(l.length).toBeLessThanOrEqual(255)
      expect(l).not.toMatch(/[\ud800-\udbff]$/)
      expect(l).not.toMatch(/ [\udc00-\udfff]/)
    }
  })
})

// --- §4 individuals ------------------------------------------------------

describe('individuals', () => {
  it('writes the FamilySearch PID as _FSFTID and a REFN of at most 20 characters', () => {
    const p = person('I1', { ark: 'ark:/61903/4:1:KWCJ-JAM7' })
    const text = exportGedcom(research(), tree([p]), { now: NOW })
    const indi = ofType(text, 'INDI')[0]
    expect(child(indi, '_FSFTID')[0].data?.value).toBe('KWCJ-JAM7')
    const refn = child(indi, 'REFN')[0]
    expect(refn.data?.value).toBe('KWCJ-JAM7')
    expect(refn.data!.value!.length).toBeLessThanOrEqual(20)
    expect(child(refn, 'TYPE')[0].data?.value).toBe('FamilySearch')
    expect(text).toContain('https://www.familysearch.org/ark:/61903/4:1:KWCJ-JAM7')
  })

  it.each([
    ['https://familysearch.org/ark:/61903/4:1:KWCJ-JAM7', 'KWCJ-JAM7', 'https://www.familysearch.org/ark:/61903/4:1:KWCJ-JAM7'],
    ['https://www.familysearch.org/tree/person/KW7C-X9P', 'KW7C-X9P', 'https://www.familysearch.org/tree/person/KW7C-X9P'],
    ['4:1:KWCJ-JAM', 'KWCJ-JAM', 'https://www.familysearch.org/ark:/61903/4:1:KWCJ-JAM']
  ])('recognises the FamilySearch id in %s', (ark, pid, url) => {
    const text = exportGedcom(research(), tree([person('I1', { ark })]), { now: NOW })
    const indi = ofType(text, 'INDI')[0]
    expect(child(indi, '_FSFTID')[0].data?.value).toBe(pid)
    expect(child(indi, 'REFN')[0].data?.value).toBe(pid)
    expect(child(indi, 'NOTE').map((n) => n.data?.value)).toContain(`FamilySearch: ${url}`)
  })

  it.each(['ark:/61903/1:1:MXHY-TQ2', 'https://example.org/tree/person/KW7C-X9P', 'not an ark'])(
    'writes no FamilySearch id for %s',
    (ark) => {
      const indi = ofType(exportGedcom(research(), tree([person('I1', { ark })]), { now: NOW }), 'INDI')[0]
      expect(child(indi, '_FSFTID')).toHaveLength(0)
      expect(child(indi, 'REFN')).toHaveLength(0)
    }
  )

  it('maps name types and puts the preferred name first', () => {
    const p = person('I1', {
      names: [
        { id: 'n1', given: 'Jack', surname: 'Smith', type: 'Nickname' },
        { id: 'n2', given: 'John', surname: 'Smith', type: 'BirthName', preferred: true },
        { id: 'n3', given: 'Jane', surname: 'Jones', type: 'MarriedName' },
        { id: 'n4', given: 'J.', surname: 'Smith', type: 'AlsoKnownAs' },
        { id: 'n5', given: 'Johannes', surname: 'Smith', type: 'Religious' }
      ]
    })
    const names = child(ofType(exportGedcom(research(), tree([p]), { now: NOW }), 'INDI')[0], 'NAME')
    expect(names.map((n) => n.data?.value)).toEqual([
      'John /Smith/',
      'Jack /Smith/',
      'Jane /Jones/',
      'J. /Smith/',
      'Johannes /Smith/'
    ])
    expect(child(names[0], 'TYPE')[0].data?.value).toBe('birth')
    expect(child(names[1], 'NICK')[0].data?.value).toBe('Jack')
    expect(child(names[1], 'TYPE')).toHaveLength(0)
    expect(child(names[2], 'TYPE')[0].data?.value).toBe('married')
    expect(child(names[3], 'TYPE')[0].data?.value).toBe('aka')
    expect(child(names[4], 'TYPE')).toHaveLength(0)
  })

  it('maps fact types to tags, with EVEN+TYPE for the rest and Parents skipped', () => {
    const p = person('I1', {
      facts: [
        { id: 'f1', type: 'Birth', date: '1845', place: 'Cork' },
        { id: 'f2', type: 'Occupation', value: 'Farmer' },
        { id: 'f3', type: 'MilitaryService', value: 'Union Army' },
        { id: 'f4', type: 'Marriage', date: '1870' },
        { id: 'f5', type: 'Parents', value: 'Pat - Mary' },
        { id: 'f6', type: 'Residence', standard_place: 'Boston, Massachusetts', place: 'Bostn' }
      ]
    })
    const indi = ofType(exportGedcom(research(), tree([p]), { now: NOW }), 'INDI')[0]
    const tags = (indi.children ?? []).map((c) => c.type)
    expect(tags).toContain('BIRT')
    expect(child(indi, 'OCCU')[0].data?.value).toBe('Farmer')
    const evens = child(indi, 'EVEN')
    expect(evens.map((e) => child(e, 'TYPE')[0].data?.value)).toEqual(['MilitaryService', 'Marriage'])
    expect(evens[0].data?.value).toBe('Union Army')
    expect(tags).not.toContain('MARR')
    expect(JSON.stringify(indi)).not.toContain('Pat - Mary')
    expect(child(child(indi, 'RESI')[0], 'PLAC')[0].data?.value).toBe('Boston, Massachusetts')
  })
})

describe('dates', () => {
  it.each([
    [{ standard_date: 'Abt 1865' }, 'ABT 1865'],
    [{ standard_date: '11 Sep 1718' }, '11 SEP 1718'],
    [{ standard_date: 'Bet 1917 and 1918' }, 'BET 1917 AND 1918'],
    [{ standard_date: 'Bef Oct 1855' }, 'BEF OCT 1855'],
    [{ standard_date: 'Abt 1845 (?)', date: '~1845 (?)' }, '(Abt 1845 (?))'],
    [{ date: '1850' }, '1850'],
    [{ date: '~1845' }, 'ABT 1845'],
    [{ date: '1908-03-12' }, '12 MAR 1908'],
    [{ date: '1908-03' }, 'MAR 1908'],
    // A `~` before an ISO date: the ISO rewrite runs on the text after it.
    [{ date: '~1908-03' }, 'ABT MAR 1908'],
    [{ date: '~1908-03-12' }, 'ABT 12 MAR 1908'],
    // Full and mixed-case month names, and month-first order.
    [{ date: '2 October 1876' }, '2 OCT 1876'],
    [{ date: '12 March 1908' }, '12 MAR 1908'],
    [{ date: 'Mar 12, 1908' }, '12 MAR 1908'],
    [{ date: 'Sept. 1850' }, 'SEP 1850'],
    [{ date: 'about 1850' }, '(about 1850)'],
    [{ date: 'about Spring 1845' }, '(about Spring 1845)'],
    [{ date: 'March' }, '(March)']
  ])('%o → %s', (fact, expected) => {
    expect(gedcomDate(fact)).toBe(expected)
  })

  it('returns null for a fact with no date', () => {
    expect(gedcomDate({})).toBeNull()
  })
})

// --- §5 families ---------------------------------------------------------

describe('families', () => {
  const famCount = (persons: GedcomxPerson[], rels: GedcomxRelationship[]): number =>
    ofType(exportGedcom(research(), tree(persons, rels), { now: NOW }), 'FAM').length

  it('puts a couple and their children in exactly one FAM', () => {
    const persons = [person('I1'), person('I2', { gender: 'Female' }), person('I3'), person('I4')]
    const rels = [
      couple('R1', 'I1', 'I2'),
      parentOf('R2', 'I1', 'I3'),
      parentOf('R3', 'I2', 'I3'),
      parentOf('R4', 'I1', 'I4'),
      parentOf('R5', 'I2', 'I4')
    ]
    const text = exportGedcom(research(), tree(persons, rels), { now: NOW })
    const fams = ofType(text, 'FAM')
    expect(fams).toHaveLength(1)
    expect(child(fams[0], 'HUSB')[0].data?.pointer).toBe('@I1@')
    expect(child(fams[0], 'WIFE')[0].data?.pointer).toBe('@I2@')
    expect(child(fams[0], 'CHIL').map((c) => c.data?.pointer)).toEqual(['@I3@', '@I4@'])
  })

  it('gives two parents with no couple record one FAM', () => {
    const persons = [person('I1'), person('I2', { gender: 'Female' }), person('I3')]
    expect(famCount(persons, [parentOf('R1', 'I1', 'I3'), parentOf('R2', 'I2', 'I3')])).toBe(1)
  })

  it('never invents a couple out of more than two competing parents', () => {
    const persons = ['I1', 'I2', 'I3', 'I4', 'I5'].map((id) => person(id))
    const rels = ['I2', 'I3', 'I4', 'I5'].map((p, i) => parentOf(`R${i}`, p, 'I1'))
    const text = exportGedcom(research(), tree(persons, rels), { now: NOW })
    const fams = ofType(text, 'FAM')
    expect(fams).toHaveLength(4)
    for (const f of fams) {
      expect(child(f, 'HUSB').length + child(f, 'WIFE').length).toBe(1)
    }
  })

  it('assigns HUSB by sex even when the woman is person1', () => {
    const persons = [person('I1', { gender: 'Female' }), person('I2')]
    const fam = ofType(exportGedcom(research(), tree(persons, [couple('R1', 'I1', 'I2')]), { now: NOW }), 'FAM')[0]
    expect(child(fam, 'HUSB')[0].data?.pointer).toBe('@I2@')
    expect(child(fam, 'WIFE')[0].data?.pointer).toBe('@I1@')
  })

  it.each([
    ['Biological', 'birth'],
    ['Adoptive', 'adopted'],
    ['Foster', 'foster']
  ])('maps a %s subtype to PEDI %s', (subtype, pedi) => {
    const text = exportGedcom(
      research(),
      tree([person('I1'), person('I2')], [parentOf('R1', 'I1', 'I2', subtype)]),
      { now: NOW }
    )
    const famc = child(ofType(text, 'INDI')[1], 'FAMC')[0]
    expect(child(famc, 'PEDI')[0].data?.value).toBe(pedi)
  })

  it.each(['Step', 'Guardian'])('writes a %s subtype as a FAMC note, not a PEDI', (subtype) => {
    const text = exportGedcom(
      research(),
      tree([person('I1'), person('I2')], [parentOf('R1', 'I1', 'I2', subtype)]),
      { now: NOW }
    )
    const famc = child(ofType(text, 'INDI')[1], 'FAMC')[0]
    expect(child(famc, 'PEDI')).toHaveLength(0)
    expect(child(famc, 'NOTE')[0].data?.value).toBe(`${subtype} parent`)
  })

  it('puts a parent-child note under the child FAMC, not on the FAM', () => {
    const rel = { ...parentOf('R1', 'I1', 'I2'), notes: ['adopted informally'] } as GedcomxRelationship
    const text = exportGedcom(research(), tree([person('I1'), person('I2')], [rel]), { now: NOW })
    const famc = child(ofType(text, 'INDI')[1], 'FAMC')[0]
    expect(child(famc, 'NOTE')[0].data?.value).toBe('adopted informally')
    expect(child(ofType(text, 'FAM')[0], 'NOTE')).toHaveLength(0)
  })

  it('cites a record shared by both parent edges once on the child', () => {
    const src = [{ ref: 'S1', quality: 1 }]
    const rels = [
      { ...parentOf('R1', 'I1', 'I3'), sources: src },
      { ...parentOf('R2', 'I2', 'I3'), sources: src }
    ] as GedcomxRelationship[]
    const text = exportGedcom(
      research(),
      tree([person('I1'), person('I2', { gender: 'Female' }), person('I3')], rels, [
        { id: 'S1', title: 'baptism' }
      ]),
      { now: NOW }
    )
    expect(child(ofType(text, 'INDI')[2], 'SOUR')).toHaveLength(1)
  })

  it('writes couple facts on the FAM', () => {
    const rel = {
      ...couple('R1', 'I1', 'I2'),
      facts: [{ id: 'f1', type: 'Marriage', standard_date: '3 Jun 1870', place: 'Cork' }]
    } as GedcomxRelationship
    const fam = ofType(
      exportGedcom(research(), tree([person('I1'), person('I2', { gender: 'Female' })], [rel]), { now: NOW }),
      'FAM'
    )[0]
    expect(child(child(fam, 'MARR')[0], 'DATE')[0].data?.value).toBe('3 JUN 1870')
  })
})

// --- §6 / §8 sources -----------------------------------------------------

describe('sources', () => {
  it('writes one SOUR per research source even when two share a tree source', () => {
    const r = research({
      sources: [researchSource('src_001', 'S1'), researchSource('src_002', 'S1')]
    })
    const p = person('I1', {
      facts: [{ id: 'f1', type: 'Birth', date: '1845', sources: [{ ref: 'S1', page: 'line 4', quality: 3 }] }]
    })
    const text = exportGedcom(r, tree([p], [], [{ id: 'S1', title: '1850 census' }]), { now: NOW })
    const sour = ofType(text, 'SOUR')
    expect(sour).toHaveLength(2)
    const birth = child(ofType(text, 'INDI')[0], 'BIRT')[0]
    const refs = child(birth, 'SOUR')
    expect(refs.map((s) => s.data?.pointer)).toEqual(sour.map((s) => s.data?.xref_id))
    for (const ref of refs) {
      expect(child(ref, 'PAGE')[0].data?.value).toBe('line 4')
      expect(child(ref, 'QUAY')[0].data?.value).toBe('3')
    }
  })

  it('carries the citation detail, repository and transcription', () => {
    const r = research({
      sources: [
        researchSource('src_001', 'S1', {
          url: 'https://example.org/rec',
          transcription: 'line one\nline two',
          transcription_truncated: true
        })
      ]
    })
    const text = exportGedcom(r, tree([], [], [{ id: 'S1', title: '1850 census' }]), { now: NOW })
    const sour = ofType(text, 'SOUR')[0]
    expect(child(sour, 'TITL')[0].data?.value).toBe('1850 census')
    expect(child(sour, 'AUTH')[0].data?.value).toBe('County clerk')
    expect(child(sour, 'PUBL')[0].data?.value).toBe('Cork, Ireland, 1850')
    expect(child(sour, 'TEXT')[0].data?.value).toContain('[partial transcription]')
    expect(child(sour, 'NOTE')[0].data?.value).toContain('URL: https://example.org/rec')
    const repo = ofType(text, 'REPO')
    expect(repo).toHaveLength(1)
    expect(child(sour, 'REPO')[0].data?.pointer).toBe(repo[0].data?.xref_id)
    expect(child(repo[0], 'NAME')[0].data?.value).toBe('FamilySearch')
  })

  it('also writes tree sources no research source covers', () => {
    const r = research({ sources: [researchSource('src_001', 'S1')] })
    const g = tree([], [], [
      { id: 'S1', title: 'covered' },
      { id: 'S2', title: 'tree only', url: 'https://example.org/s2' }
    ])
    const titles = ofType(exportGedcom(r, g, { now: NOW }), 'SOUR').map(
      (s) => child(s, 'TITL')[0].data?.value
    )
    expect(titles).toEqual(['covered', 'tree only'])
  })

  it("cites evidence by the assertion's own research source, not the shared tree id", () => {
    const r = research({
      sources: [researchSource('src_001', 'S1'), researchSource('src_002', 'S1')],
      assertions: [assertion('a_001', 'src_002')],
      person_evidence: [evidence('pe_001', 'a_001', 'I1')]
    })
    const text = exportGedcom(r, tree([person('I1')], [], [{ id: 'S1', title: 'census' }]), { now: NOW })
    const cites = child(ofType(text, 'INDI')[0], 'SOUR')
    expect(cites).toHaveLength(1)
    expect(cites[0].data?.pointer).toBe('@S2@')
    expect(child(cites[0], 'PAGE')[0].data?.value).toBe('page for src_002')
    expect(child(cites[0], 'NOTE')[0].data?.value).toBe(
      'birth: John Smith, 1845, Cork — probable: rationale pe_001'
    )
  })

  it('cites a source once on a person when it is both a person ref and evidence', () => {
    const r = research({
      sources: [researchSource('src_001', 'S1')],
      assertions: [assertion('a_001', 'src_001')],
      person_evidence: [evidence('pe_001', 'a_001', 'I1')]
    })
    const p = person('I1', {
      sources: [{ ref: 'S1' }],
      facts: [{ id: 'f1', type: 'Birth', date: '1845', sources: [{ ref: 'S1' }] }]
    })
    const indi = ofType(exportGedcom(r, tree([p], [], [{ id: 'S1', title: 'census' }]), { now: NOW }), 'INDI')[0]
    const cites = child(indi, 'SOUR')
    expect(cites).toHaveLength(1)
    // The one kept is the evidence citation, with its NOTE.
    expect(child(cites[0], 'NOTE')).toHaveLength(1)
    // A fact-level citation of the same source is a different place and stays.
    expect(child(child(indi, 'BIRT')[0], 'SOUR')).toHaveLength(1)
  })

  it('keeps a person ref to a source that has no evidence citation', () => {
    const r = research({ sources: [researchSource('src_001', 'S1')] })
    const p = person('I1', { sources: [{ ref: 'S1', page: 'p. 4' }] })
    const indi = ofType(exportGedcom(r, tree([p], [], [{ id: 'S1', title: 'census' }]), { now: NOW }), 'INDI')[0]
    expect(child(indi, 'SOUR').map((s) => s.data?.pointer)).toEqual(['@S1@'])
  })

  it('ignores superseded person_evidence', () => {
    const r = research({
      sources: [researchSource('src_001', 'S1')],
      assertions: [assertion('a_001', 'src_001')],
      person_evidence: [{ ...evidence('pe_001', 'a_001', 'I1'), superseded_by: 'pe_002' }]
    })
    const text = exportGedcom(r, tree([person('I1')]), { now: NOW })
    expect(child(ofType(text, 'INDI')[0], 'SOUR')).toHaveLength(0)
  })
})

// --- §4.4 / §7 notes -----------------------------------------------------

describe('notes', () => {
  const base = (): ResearchData =>
    research({
      questions: [
        { id: 'q_001', question: 'Who were the parents?', status: 'resolved', resolution_assertion_ids: ['a_001'] },
        { id: 'q_002', question: 'When did he emigrate?', status: 'in_progress', resolution_assertion_ids: [] }
      ] as unknown as ResearchData['questions'],
      sources: [researchSource('src_001', 'S1')],
      assertions: [assertion('a_001', 'src_001', { extracted_for_question_ids: ['q_002'] })],
      person_evidence: [evidence('pe_001', 'a_001', 'I1')],
      conflicts: [
        {
          id: 'c_001',
          conflict_type: 'fact',
          description: 'Birth year differs',
          competing_assertion_ids: ['a_001'],
          status: 'resolved',
          resolved_value: '1845',
          resolution_rationale: 'census is closer',
          blocks_question_ids: []
        }
      ] as unknown as ResearchData['conflicts'],
      hypotheses: [
        {
          id: 'h_001',
          claim: 'He is the son of Pat',
          status: 'active',
          supporting_assertion_ids: [],
          contradicting_assertion_ids: ['a_001'],
          ruled_out: false,
          related_question_ids: []
        }
      ] as unknown as ResearchData['hypotheses'],
      proof_summaries: [
        { id: 'ps_001', question_id: 'q_001', tier: 'proved', narrative_markdown: 'Proof one', exhaustive_search_summary: 'searched' },
        { id: 'ps_002', question_id: 'q_002', tier: 'probable', narrative_markdown: 'Proof two', exhaustive_search_summary: '' }
      ] as unknown as ResearchData['proof_summaries']
    })

  it('writes one NOTE record per proof summary and links every INDI to all of them', () => {
    const text = exportGedcom(base(), tree([person('I1'), person('I2')]), { now: NOW })
    const notes = ofType(text, 'NOTE')
    expect(notes).toHaveLength(2)
    expect(notes[0].data?.value).toContain('Proof conclusion — Who were the parents? (Tier: proved)')
    expect(notes[0].data?.value).toContain('Search summary: searched')
    for (const indi of ofType(text, 'INDI')) {
      const pointers = child(indi, 'NOTE').map(pointerOf).filter(Boolean)
      expect(pointers).toEqual(notes.map((n) => n.data?.xref_id))
    }
  })

  it('reaches a person with the conflicts, hypotheses and open questions their evidence touches', () => {
    const text = exportGedcom(base(), tree([person('I1'), person('I2')]), { now: NOW })
    const [linked, unlinked] = ofType(text, 'INDI')
    const inline = (indi: GNode): string[] =>
      child(indi, 'NOTE')
        .map(textOf)
        .filter((v): v is string => Boolean(v))
    const notes = inline(linked)
    expect(notes.some((n) => n.startsWith('Conflict (resolved): Birth year differs'))).toBe(true)
    expect(notes.some((n) => n.startsWith('Hypothesis (active): He is the son of Pat'))).toBe(true)
    // q_002 is in_progress with an empty resolution_assertion_ids: it still arrives.
    expect(notes).toContain('Research question (in_progress): When did he emigrate?')
    expect(inline(unlinked)).toEqual([])
  })
})

// --- real fixtures -------------------------------------------------------

const SCENARIOS = path.resolve(__dirname, '../../../../../eval/fixtures/scenarios')

// FAM counts worked out by hand from each fixture's relationships; the test
// never re-implements the grouping.
const FIXTURES: [string, number][] = [
  ['compound-objective-fully-covered', 2], // couples I1–I2 and I3–I4
  ['mid-research-flynn', 1], // I2 alone, three children
  ['mid-research-flynn-merge-pending', 1], // I2 alone, one child
  ['g9gj-proof-update-after-later-search', 2], // couple I1–I2; I1 alone for I3
  ['research-competing-parent-sets-no-hypotheses', 3] // couples I1–I6, I2–I3, I4–I5
]

describe.each(FIXTURES)('fixture %s', (name, expectedFams) => {
  const load = <T,>(file: string): T =>
    JSON.parse(fs.readFileSync(path.join(SCENARIOS, name, file), 'utf8')) as T
  const r = load<ResearchData>('research.json')
  const g = load<GedcomxData>('tree.gedcomx.json')
  const text = exportGedcom(r, g, { now: NOW })
  const recs = records(text)
  const byType = (t: string): GNode[] => recs.filter((x) => x.type === t)

  it('has one INDI per person, the expected FAMs, and every source and proof', () => {
    expect(byType('INDI')).toHaveLength(g.persons.length)
    expect(byType('FAM')).toHaveLength(expectedFams)
    expect(byType('SOUR').length).toBeGreaterThanOrEqual(r.sources.length)
    expect(byType('NOTE')).toHaveLength(r.proof_summaries.length)
  })

  it('resolves every pointer to a defined record', () => {
    const defined = new Set(recs.map((x) => x.data?.xref_id).filter(Boolean))
    const pointers: string[] = []
    for (const rec of recs) {
      walk(rec, (n) => {
        const p = pointerOf(n)
        if (p) pointers.push(p)
      })
    }
    expect(pointers.length).toBeGreaterThan(0)
    if (r.proof_summaries.length) expect(pointers).toContain('@N1@')
    for (const p of pointers) expect(defined).toContain(p)
  })

  it('links families both ways', () => {
    const indiById = new Map(byType('INDI').map((i) => [i.data?.xref_id, i]))
    const pointersOf = (n: GNode, tag: string): string[] =>
      child(n, tag).map((c) => c.data?.pointer ?? '')
    for (const fam of byType('FAM')) {
      const id = fam.data!.xref_id!
      for (const kid of pointersOf(fam, 'CHIL')) {
        expect(pointersOf(indiById.get(kid)!, 'FAMC')).toContain(id)
      }
      for (const spouse of [...pointersOf(fam, 'HUSB'), ...pointersOf(fam, 'WIFE')]) {
        expect(pointersOf(indiById.get(spouse)!, 'FAMS')).toContain(id)
      }
    }
    for (const indi of byType('INDI')) {
      const famById = new Map(byType('FAM').map((f) => [f.data?.xref_id, f]))
      for (const famc of pointersOf(indi, 'FAMC')) {
        expect(pointersOf(famById.get(famc)!, 'CHIL')).toContain(indi.data?.xref_id)
      }
      for (const fams of pointersOf(indi, 'FAMS')) {
        const fam = famById.get(fams)!
        expect([...pointersOf(fam, 'HUSB'), ...pointersOf(fam, 'WIFE')]).toContain(indi.data?.xref_id)
      }
    }
  })

  it('keeps every line within 255 characters', () => {
    for (const l of lines(text)) expect(l.length).toBeLessThanOrEqual(255)
  })
})
