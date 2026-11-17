import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { leftoverIds } from './id-check'
import { plainProse, Prose } from './Prose'
import { buildRuleIndex, type RuleIndex } from './rule-index'
import { COMPOUND, compound, mcandrew } from './test-data'

afterEach(cleanup)

function shown(text: string, index: RuleIndex = mcandrew) {
  const { container } = render(<Prose text={text} index={index} />)
  const anchors = [...container.querySelectorAll('a')].map((a) => ({ label: a.textContent, href: a.getAttribute('href') }))
  return { text: (container.textContent ?? '').replace(/\s+/g, ' ').trim(), anchors, container }
}

describe('internal ids in prose', () => {
  it.each([
    ['Cited (S28, S29) here.', 'Cited here.'],
    ['Both (src_001/S26 and src_003/S28) agree.', 'Both agree.'],
    ['Linked (pe_045–pe_049).', 'Linked.'],
    ['Searched (pli_007 log_027–log_028, pli_010 log_031–log_034).', 'Searched.'],
    ['Child (src_001/S26, child_1 role, assertions a_034–a_039).', 'Child (child_1 role).'],
    ['born 1887 (S28).', 'born 1887.'],
    ['born to I1 and I2.', 'born to Mary E McAndrew and John Mogan.'],
    ["I4's birth fact", "John Vincent Mogan's birth fact"],
    ['I4 (John Vincent Mogan) was born', 'John Vincent Mogan was born'],
    ['Mary (X8D9-HL9; parents: Peter Farber + Barbara Wilhelm)', 'Mary (parents: Peter Farber + Barbara Wilhelm)'],
    ['Conflict c_001: the source (see also a_001) says', 'Conflict: the source says'],
    ['As shown by S26, the child', 'As shown by Michigan, Births, 1867-1902, the child'],
    ['The index (assertions a_008, a_009: *source* = original) holds', 'The index (source = original) holds'],
    ['The record (tree source S1) and q_001.', 'The record.'],
    ['From 1885-1910 Mary-Ann ran a full-text search.', 'From 1885-1910 Mary-Ann ran a full-text search.'],
    ['Read a_012-a_014 -> I4 today.', 'Read Michigan, County Births, 1867-1917, entry for John V Mogan -> John Vincent Mogan today.'],
    ['### Conflict resolved (c\\_001)', 'Conflict resolved'],
    ['The record `ark:/61903/1:1:NQ8J-TVV` holds it.', 'The record Michigan, Births, 1867-1902 holds it.'],
    ['Her name is Anne [?] in the index.', 'Her name is Anne [?] in the index.'],
    ['It needs a formal hypotheses[] entry.', 'It needs a formal hypotheses entry.']
  ])('%j renders as %j', (input, expected) => {
    const out = shown(input)
    expect(out.text).toBe(expected)
    expect(leftoverIds(out.text)).toEqual([])
  })

  it('an Ancestry tree source names nothing, so its id goes with no link', () => {
    const out = shown('Bryan is in the 1860 census (S5).')
    expect(out.text).toBe('Bryan is in the 1860 census.')
    expect(out.anchors).toEqual([])
  })

  it('a retired assertion and a retired link name nothing', () => {
    const research = structuredClone(COMPOUND.research) as Record<string, unknown>
    const assertions = research.assertions as Array<Record<string, unknown>>
    const links = research.person_evidence as Array<Record<string, unknown>>
    assertions[0].superseded_by = 'a_999'
    links[0].superseded_by = 'pe_999'
    const index = buildRuleIndex({ research, tree: COMPOUND.tree })
    expect(shown(`Read ${assertions[0].id} and ${links[0].id} today.`, index).text).toBe('Read today.')
  })
})

describe('FamilySearch identifiers', () => {
  it('a known person id in the compound proof links to the person page', () => {
    const out = shown(COMPOUND.research.proof_summaries[0].narrative_markdown, compound)
    expect(out.anchors).toContainEqual({
      label: 'Elizabeth Mariah Turnbow',
      href: 'https://www.familysearch.org/tree/person/details/KWJ6-RPH'
    })
    expect(out.text).not.toContain('KWJ6-RPH')
    expect(out.text).not.toContain('Turnbow (Elizabeth Mariah Turnbow)')
  })

  it('a person whose id is a PID links by it', () => {
    const tree = { persons: [{ id: 'LKFW-9XH', names: [{ given: 'Ole', surname: 'Monsen' }] }] }
    const out = shown('Ole (LKFW-9XH) and LKFW-9XH.', buildRuleIndex({ research: {}, tree }))
    expect(out.anchors).toEqual([
      { label: 'Ole Monsen', href: 'https://www.familysearch.org/tree/person/details/LKFW-9XH' },
      { label: 'Ole Monsen', href: 'https://www.familysearch.org/tree/person/details/LKFW-9XH' }
    ])
  })

  it('a record id links to its ARK, named by its title', () => {
    expect(shown('the record NQ8J-TVV.').anchors).toEqual([
      { label: 'Michigan, Births, 1867-1902', href: 'https://www.familysearch.org/ark:/61903/1:1:NQ8J-TVV' }
    ])
  })

  it('a raw ARK and a bare page-image ARK become named links, and 1:2:30 stays text', () => {
    const out = shown('raw ark:/61903/1:1:QGYQ-QXMZ, image 3:1:3QSQ-G9NW-8ZZC and 1:2:30.')
    expect(out.anchors).toEqual([
      {
        label: 'Michigan, County Births, 1867-1917, entry for John V Mogan',
        href: 'https://www.familysearch.org/ark:/61903/1:1:QGYQ-QXMZ'
      },
      { label: 'page image on FamilySearch', href: 'https://www.familysearch.org/ark:/61903/3:1:3QSQ-G9NW-8ZZC' }
    ])
    expect(out.text).toContain('1:2:30')
    expect(leftoverIds(out.text)).toEqual([])
  })

  it('a FamilySearch URL in brackets keeps its punctuation and takes its title', () => {
    const out = shown('(https://www.familysearch.org/ark:/61903/1:1:QLT2-G99Q?lang=en).')
    expect(out.anchors).toEqual([
      {
        label: 'Entry for Martin Magin, "Michigan, County Births, 1867-1917"',
        href: 'https://www.familysearch.org/ark:/61903/1:1:QLT2-G99Q'
      }
    ])
    expect(out.text).toBe('(Entry for Martin Magin, "Michigan, County Births, 1867-1917").')
  })

  it.each([
    ['https://familysearch.org/search/collection/1459684', 'collection on FamilySearch'],
    ['https://www.familysearch.org/en/wiki/Wayne_County,_Michigan_Genealogy', 'Wayne County, Michigan Genealogy'],
    ['https://www.familysearch.org/tree/person/details/G13G-P68', 'Mary E McAndrew'],
    ['https://www.familysearch.org/tree/person/details/ZZZZ-ZZZ', 'this person on FamilySearch'],
    ['https://www.familysearch.org/ark:/61903/1:1:ZZZZ-ZZZ', 'this record on FamilySearch'],
    ['http://www.familysearch.org/search/catalog/123', 'on FamilySearch']
  ])('%s is named %j and rebuilt on https', (url, label) => {
    const out = shown(`See ${url} now.`)
    expect(out.anchors).toHaveLength(1)
    expect(out.anchors[0].label).toBe(label)
    expect(out.anchors[0].href).toMatch(/^https:\/\/www\.familysearch\.org\//)
  })

  it.each([
    'https://evil.example/ark:/61903/1:1:QPRC-WPBZ',
    'https://familysearch.org.evil.example/en/wiki/X',
    'https://www.familysearch.org@evil.example/en/wiki/X',
    'https://evil.example/https://www.familysearch.org/en/wiki/X'
  ])('%s stays whole, with no "on FamilySearch" label', (url) => {
    const out = shown(`See ${url} now.`)
    expect(out.text).toBe(`See ${url} now.`)
    expect(out.anchors).toEqual([{ label: url, href: url }])
  })

  it("a tree source whose ARK ends in a person's id leaves that person's link", () => {
    const tree = {
      persons: [{ id: 'I1', ark: 'ark:/61903/4:1:KWJ6-RPH', names: [{ given: 'Ann', surname: 'Lee' }] }],
      sources: [{ id: 'S1', title: 'A record', url: 'https://www.familysearch.org/ark:/61903/1:1:KWJ6-RPH' }]
    }
    const out = shown('Ann (KWJ6-RPH).', buildRuleIndex({ research: {}, tree }))
    expect(out.anchors).toEqual([{ label: 'Ann Lee', href: 'https://www.familysearch.org/tree/person/details/KWJ6-RPH' }])
  })

  it('a markdown link and its destination are left as written', () => {
    const out = shown('[the S28 page](https://www.familysearch.org/ark:/61903/1:1:QLT2-G99Q)')
    expect(out.anchors).toEqual([{ label: 'the S28 page', href: 'https://www.familysearch.org/ark:/61903/1:1:QLT2-G99Q' }])
  })

  it('a planted image loads nothing', () => {
    const out = shown('Look ![x](https://evil.example/a.png) here.')
    expect(out.container.querySelector('img')).toBeNull()
    expect(out.text).toBe('Look x here.')
  })
})

describe('the id check', () => {
  it.each([
    'S28 in a citation',
    'I19 in a name',
    'a sentence with a_014 inside it',
    'raw ark:/61903/1:1:QPRC-WPBZ',
    'bare 3:1:3QSQ-G9NW-8ZZC',
    'unknown QZX9-K2P token',
    'stray src_003/ fragment',
    'an empty ( , ) bracket'
  ])('fails on %j', (text) => {
    expect(leftoverIds(text)).not.toEqual([])
  })

  it.each(['born 12 May 1877', 'from 1885-1910', 'Mary-Ann', 'full-text', 'Ward 8, Dwelling 32', '(child_1 role)', 'https://evil.example/ark:/61903/1:1:QPRC-WPBZ'])(
    'passes %j',
    (text) => {
      expect(leftoverIds(text)).toEqual([])
    }
  )

  it('passes on the McAndrew and compound proofs as rendered', () => {
    expect(leftoverIds(shown(COMPOUND.research.proof_summaries[0].narrative_markdown, compound).text)).toEqual([])
  })
})

describe('plain text under the rules', () => {
  it('names and links become their words, and markup goes', () => {
    expect(plainProse('Did **I1** (KWJ6-RPH) marry in `1850`?', compound)).toBe('Did Elizabeth Mariah Turnbow marry in 1850?')
    expect(plainProse('the child_1 role, kept', compound)).toBe('the child_1 role, kept')
  })

  it('a short value draws inline, with no paragraph', () => {
    const { container } = render(<Prose text="child of I1 (I1)" index={compound} inline />)
    expect(container.querySelector('p')).toBeNull()
    expect(container.textContent).toBe('child of Elizabeth Mariah Turnbow')
  })
})
