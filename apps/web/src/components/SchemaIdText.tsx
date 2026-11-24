import React from 'react'
import { resolveFamilySearchTarget, imageIdToViewerUrl } from '@genealogy/viewer-ui'
import { findSchemaIds, sectionForId, findFamilySearchTargets } from './schemaIds'

export interface SchemaIdTextProps {
  /** One run of prose from a chat paragraph. */
  text: string
  /**
   * Open the card an id names. OMITTED when nothing can resolve it — with no
   * provider above the chat there is no resolver, and then every id must render as
   * the plain text it is today.
   */
  onOpen?: (id: string, section: string) => void
  /** Whether the project holds the id. An id it does not hold stays plain text. */
  hasId?: (id: string) => boolean
}

/**
 * Chat prose with its schema identifiers turned into links.
 *
 * Additive by construction, which is the whole licence for this change: an id that
 * cannot be placed, or that arrives with no handler, renders EXACTLY as it does
 * today. The failure mode is "no link", never "broken text" and never a dead button
 * that looks clickable and does nothing.
 *
 * Measured need: 193 occurrences of 94 distinct ids reach the reader in the captured
 * session and none of them goes anywhere
 * (`docs/captures/2026-09-29-mcandrew-children/`).
 */
/** One linkable span in a run of prose: a FamilySearch URL, or a research-schema id. */
type Mark =
  | { start: number; end: number; kind: 'fs'; href: string; label: string }
  | { start: number; end: number; kind: 'schema'; id: string; section: string }

export function SchemaIdText({ text, onOpen, hasId }: SchemaIdTextProps): React.JSX.Element {
  // FamilySearch links need no project: the href is rebuilt from a FamilySearch
  // constant, so a reader with no project open still gets a clickable source (#4582).
  const fsHits = findFamilySearchTargets(text, resolveFamilySearchTarget, imageIdToViewerUrl)
  // Schema-id buttons DO need a project -- they open a card in the open project -- so
  // they are only scanned for when a handler is present. With none, every id stays
  // plain text, exactly as before.
  const schemaHits = onOpen ? findSchemaIds(text) : []

  const marks: Mark[] = []
  for (const f of fsHits) {
    marks.push({ start: f.start, end: f.end, kind: 'fs', href: f.href, label: f.raw })
  }
  for (const h of schemaHits) {
    const section = sectionForId(h.id)
    // Unplaceable, or an id the project does not hold: leave it untouched rather than
    // emit a button that goes nowhere.
    if (!section) continue
    if (hasId && !hasId(h.id)) continue
    marks.push({ start: h.start, end: h.end, kind: 'schema', id: h.id, section })
  }
  if (marks.length === 0) return <>{text}</>
  marks.sort((a, b) => a.start - b.start)

  const parts: React.ReactNode[] = []
  let cursor = 0
  marks.forEach((mk, i) => {
    // A FamilySearch URL and a schema id never share a span in practice; if two marks
    // ever overlap, the earlier one wins and the later is left as the prose it sits in.
    if (mk.start < cursor) return
    if (mk.start > cursor) parts.push(text.slice(cursor, mk.start))
    if (mk.kind === 'fs') {
      parts.push(
        <a
          key={`fs-${i}`}
          className="schemaIdLink"
          href={mk.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {mk.label}
        </a>
      )
    } else {
      parts.push(
        <button
          key={`${mk.id}-${i}`}
          type="button"
          className="schemaIdLink"
          title={`Open ${mk.id} in ${mk.section.replace(/_/g, ' ')}`}
          onClick={() => onOpen?.(mk.id, mk.section)}
        >
          {mk.id}
        </button>
      )
    }
    cursor = mk.end
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}
