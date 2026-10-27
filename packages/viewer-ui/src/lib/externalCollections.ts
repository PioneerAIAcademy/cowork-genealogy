// The project-root `external-collections.json` that `external_links_search`
// writes: FamilySearch's curated external collections, stored per place. The
// shape is mirrored by hand from the engine's external-collections-store.ts —
// the web side never imports the engine. The file is not schema-validated, so
// everything that arrives is parsed here before the viewer renders it.

export interface ExternalCollectionRow {
  key: string
  url: string
  link_text: string
  record_types: string[]
  place: string
  cost: string
  content_type: string
  start_year: string
  end_year: string
}

export interface ExternalCollectionsData {
  places: Record<string, { rows: ExternalCollectionRow[] }>
}

export interface CollectionGroup {
  recordType: string
  rows: ExternalCollectionRow[]
}

export interface PlaceCollections {
  place: string
  groups: CollectionGroup[]
  rowCount: number
}

const OTHER = 'Other'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseRow(raw: unknown): ExternalCollectionRow | null {
  if (!isObject(raw) || typeof raw.url !== 'string' || typeof raw.link_text !== 'string') {
    return null
  }
  return {
    key: str(raw.key),
    url: raw.url,
    link_text: raw.link_text,
    record_types: Array.isArray(raw.record_types)
      ? raw.record_types.filter((t): t is string => typeof t === 'string')
      : [],
    place: str(raw.place),
    cost: str(raw.cost),
    content_type: str(raw.content_type),
    start_year: str(raw.start_year),
    end_year: str(raw.end_year)
  }
}

/** `null` unless `raw` has a `places` object. A place without a `rows` array
 *  and a row without a string `url` and `link_text` are dropped. */
export function parseExternalCollections(raw: unknown): ExternalCollectionsData | null {
  if (!isObject(raw) || !isObject(raw.places)) return null
  const places: ExternalCollectionsData['places'] = {}
  for (const [name, entry] of Object.entries(raw.places)) {
    if (!isObject(entry) || !Array.isArray(entry.rows)) continue
    places[name] = {
      rows: entry.rows.map(parseRow).filter((r): r is ExternalCollectionRow => r !== null)
    }
  }
  return { places }
}

export function countCollectionRows(doc: ExternalCollectionsData | null): number {
  if (!doc) return 0
  return Object.values(doc.places).reduce((n, p) => n + p.rows.length, 0)
}

const byText = (a: string, b: string): number => a.localeCompare(b)

/** Places by name, record types by name, rows by link text. A row with several
 *  record types appears under each; one with none goes under "Other". The file
 *  order is not relied on: on the proto tier jsonb does not keep key order. */
export function groupCollections(doc: ExternalCollectionsData | null): PlaceCollections[] {
  if (!doc) return []
  return Object.keys(doc.places)
    .sort(byText)
    .map((place) => {
      const rows = doc.places[place].rows
      const byType = new Map<string, ExternalCollectionRow[]>()
      for (const row of rows) {
        const types = row.record_types.length > 0 ? row.record_types : [OTHER]
        for (const type of types) {
          const list = byType.get(type) ?? []
          list.push(row)
          byType.set(type, list)
        }
      }
      const groups = [...byType.keys()].sort(byText).map((recordType) => ({
        recordType,
        rows: [...(byType.get(recordType) ?? [])].sort((a, b) => byText(a.link_text, b.link_text))
      }))
      return { place, groups, rowCount: rows.length }
    })
}
