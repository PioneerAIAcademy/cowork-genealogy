import type { LogEntry, Source } from '@genealogy/schema'
import type { ResearchDocument } from '../../contract'
import { list } from './view'

function handOffUrl(entry: LogEntry): string | null {
  const site = entry.tool === 'external_site' ? entry.external_site : null
  return site && typeof site.url_generated === 'string' ? site.url_generated : null
}

/** The question's searches, as the engine's `ownedLogEntries` reads them: entries on an
 *  item of one of its plans, plus each later entry that closes one of their website
 *  hand-offs (the researcher's upload, which names no plan item). */
export function questionSearches(research: ResearchDocument, questionId: string | undefined): LogEntry[] {
  if (!questionId) return []
  const items = new Set<string>()
  for (const plan of list(research.plans)) {
    if (plan.question_id !== questionId) continue
    for (const item of list(plan.items as unknown as Array<{ id?: unknown }>)) {
      if (typeof item.id === 'string') items.add(item.id)
    }
  }
  const log = list(research.log)
  const own = (entry: LogEntry) => typeof entry.plan_item_id === 'string' && items.has(entry.plan_item_id)
  const urls = log.filter(own).map(handOffUrl).filter((url): url is string => url !== null)
  return log.filter((entry) => own(entry) || (entry.outcome !== 'partial' && urls.includes(handOffUrl(entry) ?? '')))
}

/** The search a card is about: the named one if it is the question's, else the newest. */
export function thisSearch(searches: LogEntry[], logId: unknown): LogEntry | null {
  const named = typeof logId === 'string' ? searches.find((entry) => entry.id === logId) : undefined
  if (named) return named
  return [...searches].sort((a, b) => String(a.performed ?? '').localeCompare(String(b.performed ?? ''))).at(-1) ?? null
}

export interface SearchCounts {
  total: number
  found: number
  nothing: number
  failed: number
}

export function searchCounts(searches: LogEntry[]): SearchCounts {
  const counts: SearchCounts = { total: searches.length, found: 0, nothing: 0, failed: 0 }
  for (const entry of searches) {
    if (entry.outcome === 'positive' || entry.outcome === 'partial') counts.found++
    else if (entry.outcome === 'negative') counts.nothing++
    else if (entry.outcome === 'error') counts.failed++
  }
  return counts
}

/** Sources whose reading came from one of these searches. */
export function recordsKept(research: ResearchDocument, searches: LogEntry[]): Source[] {
  const ids = new Set(searches.map((entry) => entry.id))
  return list(research.sources).filter((source) => typeof source.log_entry_id === 'string' && ids.has(source.log_entry_id))
}

const MAX_FIRST_SENTENCE = 240
/** A period after one of these does not end a sentence: an initial, St. Louis, Wayne Co. */
const ABBREVIATION = /^(?:[A-Z]|St|Ste|Co|Mr|Mrs|Dr|Jr|Sr|Ft|Mt|No|Vol|Twp|ca|abt|bef|aft|b|d|m|bap|bur)$/

/** A note's first sentence, cut at a word when it runs long. */
export function firstSentence(text: unknown): string | null {
  if (typeof text !== 'string' || text.trim() === '') return null
  const flat = text.trim().replace(/\s+/g, ' ')
  let sentence = flat
  for (const end of flat.matchAll(/[.!?](?=\s+[A-Z(“"]|$)/g)) {
    const word = /(\S+)$/.exec(flat.slice(0, end.index))?.[1] ?? ''
    if (end[0] === '.' && ABBREVIATION.test(word)) continue
    sentence = flat.slice(0, (end.index ?? 0) + 1)
    break
  }
  if (sentence.length <= MAX_FIRST_SENTENCE) return sentence
  const cut = sentence.slice(0, MAX_FIRST_SENTENCE)
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`
}

const OUTCOME_WORDS: Record<string, string> = {
  positive: 'found what it looked for',
  partial: 'found something',
  negative: 'found nothing',
  error: 'did not run'
}

export function outcomeWords(outcome: unknown): string | null {
  return typeof outcome === 'string' ? OUTCOME_WORDS[outcome] ?? null : null
}
