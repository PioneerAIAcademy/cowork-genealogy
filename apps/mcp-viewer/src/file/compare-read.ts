/** How Compare reads a date, a place and a name, so two records' words can be set side by side. */

/** A month by its first three letters, in English, Portuguese and Spanish. */
const MONTH_PREFIXES: Record<string, number> = {
  jan: 1, ene: 1, feb: 2, fev: 2, mar: 3, apr: 4, abr: 4, may: 5, mai: 5, jun: 6, jul: 7,
  aug: 8, ago: 8, sep: 9, set: 9, oct: 10, out: 10, nov: 11, dec: 12, dez: 12, dic: 12
}
/** Words a date holds that say nothing: "17 de maio de 1982", "1850 г.". */
const DATE_FILLER = new Set(['de', 'del', 'of', 'the', 'г', 'st', 'nd', 'rd', 'th'])
const APPROXIMATE_CERTAINTY = new Set(['approximate', 'estimated', 'calculated', 'before', 'after', 'between'])
const APPROXIMATE_TEXT = /^\s*(~|abt\b|about\b|circa\b|ca\.?(?=\s|\d)|c\.(?=\s|\d)|aproximadamente\b|bef\b|before\b|aft\b|after\b|bet\b|between\b|from\b)/i
const YEAR = /(?<!\d)(1\d{3}|20\d{2})(?!\d)/g

export interface ReadDate {
  /** The first and last year it can mean; equal for one year. */
  from: number
  to: number
  month: number | null
  day: number | null
  approximate: boolean
}

/** A date's year, month and day, and whether it is only approximate. Null when it holds no year. */
export function readDate(text: unknown, certainty?: unknown): ReadDate | null {
  if (typeof text !== 'string' || text.trim() === '') return null
  const s = text.trim().replace(/^[+]/, '')
  const years = [...s.matchAll(YEAR)].map((m) => Number(m[1]))
  if (years.length === 0) return null
  const from = Math.min(...years)
  const to = Math.max(...years)
  const approximate =
    (typeof certainty === 'string' && APPROXIMATE_CERTAINTY.has(certainty)) || APPROXIMATE_TEXT.test(s) || from !== to
  const iso = /^~?(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(s)
  if (iso) {
    return { from, to, month: iso[2] ? Number(iso[2]) : null, day: iso[3] ? Number(iso[3]) : null, approximate: approximate || s.startsWith('~') }
  }
  if (approximate) return { from, to, month: null, day: null, approximate: true }
  let month: number | null = null
  let other = false
  for (const word of s.toLowerCase().match(/\p{L}+/gu) ?? []) {
    const at = word.length >= 3 ? MONTH_PREFIXES[word.slice(0, 3)] : undefined
    if (at !== undefined) month = at
    else if (!DATE_FILLER.has(word)) other = true
  }
  if (other) return { from, to, month: null, day: null, approximate: true }
  const day = month !== null ? /(?<!\d)(\d{1,2})(?!\d)/.exec(s.replace(YEAR, ' ')) : null
  return { from, to, month, day: day ? Number(day[1]) : null, approximate: false }
}

export type Reading = 'same' | 'less' | 'more' | 'conflict'

function parts(date: ReadDate): number {
  return date.month === null ? 1 : date.day === null ? 2 : 3
}

/** A finding's date against the tree's: equal, saying less, more exact, or another date. */
export function compareDates(finding: ReadDate | null, tree: ReadDate | null): Reading {
  if (!finding) return tree ? 'less' : 'same'
  if (!tree) return 'more'
  if (finding.approximate || tree.approximate) {
    const near = finding.from <= tree.to + 2 && tree.from <= finding.to + 2
    if (!near) return 'conflict'
    if (finding.approximate && tree.approximate) return 'same'
    return finding.approximate ? 'less' : 'more'
  }
  if (finding.from !== tree.from) return 'conflict'
  if (finding.month !== null && tree.month !== null && finding.month !== tree.month) return 'conflict'
  if (finding.day !== null && tree.day !== null && finding.day !== tree.day) return 'conflict'
  const a = parts(finding)
  const b = parts(tree)
  return a === b ? 'same' : a < b ? 'less' : 'more'
}

/** Lower-cased, with accents stripped. */
export function plain(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** A place's parts, lower-cased, trimmed, accents stripped. */
export function placeParts(text: unknown): string[] {
  if (typeof text !== 'string') return []
  return plain(text)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
}

function inOrder(short: string[], long: string[]): boolean {
  let at = 0
  for (const part of short) {
    at = long.indexOf(part, at)
    if (at < 0) return false
    at++
  }
  return true
}

/** Two places agree when their first parts are equal, or when, after dropping a last part only
 *  one side has, the shorter's parts all appear in the other in order. Agreeing, the finding is
 *  more exact only when its first part is not in the tree's place. */
export function comparePlaces(finding: string[], tree: string[]): Reading {
  if (finding.length === 0) return tree.length === 0 ? 'same' : 'less'
  if (tree.length === 0) return 'more'
  let agree = finding[0] === tree[0]
  if (!agree) {
    let a = finding
    let b = tree
    if (a[a.length - 1] !== b[b.length - 1]) {
      if (!b.includes(a[a.length - 1])) a = a.slice(0, -1)
      else if (!a.includes(b[b.length - 1])) b = b.slice(0, -1)
    }
    const [short, long] = a.length <= b.length ? [a, b] : [b, a]
    agree = short.length > 0 && inOrder(short, long)
  }
  if (!agree) return 'conflict'
  if (!tree.includes(finding[0])) return 'more'
  return finding.length === tree.length && finding.every((p, i) => p === tree[i]) ? 'same' : 'less'
}

const PARTICLES = new Set(['de', 'da', 'do', 'dos', 'das', 'van', 'von', 'der', 'la', 'le'])

/** A name's words: notes in brackets and particles dropped, lower-cased, accents stripped. */
export function nameWords(text: unknown): string[] {
  const s = plain(String(text ?? '').replace(/\[[^\]]*\]|\([^)]*\)/g, ' '))
  return (s.match(/\p{L}+/gu) ?? []).filter((w) => !PARTICLES.has(w))
}

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) row.push(Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)))
    prev = row
  }
  return prev[b.length]
}

function nearSpelling(word: string, other: string): boolean {
  return distance(word, other) <= Math.max(1, Math.floor(Math.max(word.length, other.length) / 4))
}

/** Close enough to be the same name spelled another way. */
export function closeWord(word: string, other: string): boolean {
  if (word === other) return true
  if (word.length >= 4 && other.length >= 4 && word.slice(0, 4) === other.slice(0, 4)) return true
  return nearSpelling(word, other)
}

function joinedPairs(words: string[]): string[] {
  return words.slice(1).map((w, i) => words[i] + w)
}

/** The finding's name words that no tree name word is, is close to, or is the initial of.
 *  Neighbours are also tried joined, on both sides (`Mc Andrews` against `McAndrew`), by
 *  spelling alone: a shared first four letters says nothing about a joined pair. */
export function newNamePieces(finding: unknown, treeNames: unknown[]): string[] {
  const words = treeNames.map(nameWords)
  const single = words.flat()
  const joinedTree = words.flatMap(joinedPairs)
  const mine = nameWords(finding)
  return mine.filter((w, i) => {
    if (w.length === 1) return !single.some((t) => t.startsWith(w))
    if (single.some((t) => closeWord(w, t))) return false
    if (joinedTree.some((t) => nearSpelling(w, t))) return false
    const joined = [i > 0 ? mine[i - 1] + w : null, i + 1 < mine.length ? w + mine[i + 1] : null]
    return !joined.some((j) => j !== null && single.some((t) => nearSpelling(j, t)))
  })
}

/** Words of a value (an occupation, a religion): equal, a subset, a superset, or neither. */
export function compareValues(finding: unknown, tree: unknown): Reading {
  const words = (v: unknown) => new Set((String(v ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []))
  const a = words(finding)
  const b = words(tree)
  if (a.size === 0) return b.size === 0 ? 'same' : 'less'
  if (b.size === 0) return 'more'
  const aInB = [...a].every((w) => b.has(w))
  const bInA = [...b].every((w) => a.has(w))
  return aInB && bInA ? 'same' : aInB ? 'less' : bInA ? 'more' : 'conflict'
}
