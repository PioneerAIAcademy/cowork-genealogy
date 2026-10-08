import React from 'react'
import { findSchemaIds, sectionForId } from './schemaIds'

export interface SchemaIdTextProps {
  /** One run of prose from a chat paragraph. */
  text: string
  /**
   * Open the card an id names. OMITTED when nothing can resolve it — with no
   * provider above the chat there is no resolver, and then every id must render as
   * the plain text it is today.
   */
  onOpen?: (id: string, section: string) => void
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
export function SchemaIdText({ text, onOpen }: SchemaIdTextProps): React.JSX.Element {
  if (!onOpen) return <>{text}</>

  const hits = findSchemaIds(text)
  if (hits.length === 0) return <>{text}</>

  const parts: React.ReactNode[] = []
  let cursor = 0
  hits.forEach((hit, i) => {
    const section = sectionForId(hit.id)
    // Unplaceable: leave it in the prose untouched rather than emit a button that
    // goes nowhere.
    if (!section) return
    if (hit.start > cursor) parts.push(text.slice(cursor, hit.start))
    parts.push(
      <button
        key={`${hit.id}-${i}`}
        type="button"
        className="schemaIdLink"
        title={`Open ${hit.id} in ${section.replace(/_/g, ' ')}`}
        onClick={() => onOpen(hit.id, section)}
      >
        {hit.id}
      </button>
    )
    cursor = hit.end
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}
