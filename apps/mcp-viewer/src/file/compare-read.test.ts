import { describe, expect, it } from 'vitest'
import { closeWord, compareDates, comparePlaces, compareValues, newNamePieces, placeParts, readDate } from './compare-read'

const d = (text: string, certainty?: string) => readDate(text, certainty)

describe('reading a date', () => {
  it('reads the shapes the committed runs hold', () => {
    expect(d('2 Mar 1850')).toEqual({ from: 1850, to: 1850, month: 3, day: 2, approximate: false })
    expect(d('8 August 1878')).toMatchObject({ month: 8, day: 8, approximate: false })
    expect(d('1850-03-02')).toMatchObject({ month: 3, day: 2 })
    expect(d('+1850-03-02')).toMatchObject({ from: 1850, month: 3, day: 2 })
    expect(d('1882-08')).toMatchObject({ month: 8, day: null })
    expect(d('Mar 1850')).toMatchObject({ month: 3, day: null })
    expect(d('17 de maio de 1982')).toMatchObject({ from: 1982, month: 5, day: 17, approximate: false })
    expect(d('1850')).toEqual({ from: 1850, to: 1850, month: null, day: null, approximate: false })
  })

  it('reads approximate dates from the text or the certainty, and ranges across their years', () => {
    for (const text of ['~1850', 'abt 1850', 'about 1850', 'circa 1850', 'aproximadamente 1850', 'ca. 1850']) {
      expect(d(text)?.approximate, text).toBe(true)
    }
    expect(d('1850', 'calculated')?.approximate).toBe(true)
    expect(d('1850', 'before')?.approximate).toBe(true)
    expect(d('December 1869')).toMatchObject({ month: 12, day: null, approximate: false })
    expect(d('Bet 1852 and 1853')).toMatchObject({ from: 1852, to: 1853, approximate: true })
    expect(d('from 1787 to 1791')).toMatchObject({ from: 1787, to: 1791, approximate: true })
    expect(d('Spring 1850')).toMatchObject({ from: 1850, approximate: true })
    expect(d('no date')).toBeNull()
    expect(d('')).toBeNull()
  })
})

describe('comparing dates', () => {
  it('a full date in the tree year is more exact; fewer parts say less', () => {
    expect(compareDates(d('4 Apr 1850'), d('1850'))).toBe('more')
    expect(compareDates(d('1850'), d('4 Apr 1850'))).toBe('less')
    expect(compareDates(d('4 Apr 1850'), d('4 Apr 1850'))).toBe('same')
    expect(compareDates(null, d('1850'))).toBe('less')
    expect(compareDates(d('1850'), null)).toBe('more')
  })

  it('a different exact date conflicts; about, ~ and a bare year agree', () => {
    expect(compareDates(d('4 Apr 1850'), d('3 Mar 1850'))).toBe('conflict')
    expect(compareDates(d('1851'), d('1850'))).toBe('conflict')
    expect(compareDates(d('about 1850'), d('~1850'))).toBe('same')
    expect(compareDates(d('about 1850'), d('1850'))).toBe('less')
    expect(compareDates(d('1850'), d('about 1850'))).toBe('same')
    expect(compareDates(d('4 Apr 1850'), d('about 1850'))).toBe('more')
  })

  it('an approximate year agrees within two years, and not beyond', () => {
    expect(compareDates(d('1851', 'calculated'), d('1849'))).toBe('less')
    expect(compareDates(d('1853', 'calculated'), d('1849'))).toBe('conflict')
    expect(compareDates(d('Bet 1852 and 1853'), d('1855'))).toBe('less')
  })
})

describe('comparing places', () => {
  const p = (a: string, b: string) => comparePlaces(placeParts(a), placeParts(b))

  it('a place inside the other, in order, agrees; the one with fewer parts says less', () => {
    expect(p('Chicago, Cook, Illinois, United States', 'Illinois, United States')).toBe('more')
    expect(p('Illinois, United States', 'Chicago, Cook, Illinois, United States')).toBe('less')
    expect(p('Glasgow, Scotland, United Kingdom', 'Glasgow, Lanarkshire, Scotland, United Kingdom')).toBe('less')
    expect(p('San José de Ocoa, Peravia, Dominican Republic', 'San José de Ocoa, Dominican Republic')).toBe('less')
    expect(p('Darlaston, Staffordshire, England', 'Darlaston, Staffordshire, England, United Kingdom')).toBe('less')
    expect(p('Darlaston, Staffordshire, England, United Kingdom', 'Darlaston, Staffordshire, England')).toBe('less')
    expect(p('Staffordshire, England, United Kingdom', 'Darlaston, Staffordshire, England')).toBe('less')
    expect(p('Brooklyn, New York City, New York, United States', 'Brooklyn, Kings, New York, United States')).toBe('less')
    expect(p('Bogotá, Colombia', 'Bogota, Colombia')).toBe('same')
  })

  it('another place conflicts; a missing place says less', () => {
    expect(p('Chicago, Cook, Illinois, United States', 'St Paul, Ramsey, Minnesota, United States')).toBe('conflict')
    expect(p('', 'Ohio')).toBe('less')
    expect(p('Ohio', '')).toBe('more')
  })
})

describe('names and values', () => {
  it('a spelling variant is close; a maiden surname or a middle name is a new piece', () => {
    expect(closeWord('urna', 'unna')).toBe(true)
    expect(closeWord('mauro', 'manro')).toBe(true)
    expect(closeWord('halsteinsdr', 'halsteinsdatter')).toBe(true)
    expect(newNamePieces('Urna Halsteinsdr [indexed form; actual name Unna Halsteinsdatter]', ['Unna Halsteinsdatter'])).toEqual([])
    expect(newNamePieces('Lena Mauro (maiden name)', ['Lena Manro'])).toEqual([])
    expect(newNamePieces('Maria Joanna de Jesus', ['Maria Joana'])).toEqual(['jesus'])
    expect(newNamePieces('Mary Kelly', ['Mary Flynn'])).toEqual(['kelly'])
  })

  it('an initial says less, and joined words match', () => {
    expect(newNamePieces('Sarah A.', ['Sarah Andrews'])).toEqual([])
    expect(newNamePieces('Sarah B.', ['Sarah Andrews'])).toEqual(['b'])
    expect(newNamePieces('John Mc Andrews', ['John McAndrew'])).toEqual([])
    expect(newNamePieces('John McAndrew', ['John Mc Andrew'])).toEqual([])
    expect(newNamePieces('José María', ['Jose Maria'])).toEqual([])
  })

  it('values compare as word sets', () => {
    expect(compareValues('LABOURER IN TUBE TRADE', 'Tube Inspector Foreman Non Ferrous')).toBe('conflict')
    expect(compareValues('Farmer', 'farmer')).toBe('same')
    expect(compareValues('Farmer', 'Tenant farmer')).toBe('less')
  })
})
