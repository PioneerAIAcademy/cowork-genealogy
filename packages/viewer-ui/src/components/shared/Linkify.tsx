import { openExternal } from '../../lib/external'
import styles from './Linkify.module.css'

// Global matcher for http(s) URLs: a greedy run of non-whitespace after the
// scheme. Trailing sentence punctuation is peeled off afterward (see below),
// because a note like "...?i=353. GPS Standard 32 satisfied" must not swallow
// the period into the link.
const URL_RE = /https?:\/\/[^\s]+/g

// Characters that, at the END of a matched run, are almost always sentence
// punctuation rather than part of the URL.
const TRAILING_PUNCT = new Set(['.', ',', ';', ':', '!', '?', '"', "'", '<', '>', ']'])

// Split a raw matched run into [url, trailing], peeling trailing punctuation.
// A closing paren is only peeled when it is unbalanced (no matching '(' inside
// the URL) so Wikipedia-style "..._(disambiguation)" URLs survive intact.
function splitTrailingPunctuation(raw: string): [string, string] {
  let end = raw.length
  while (end > 0) {
    const ch = raw[end - 1]
    if (TRAILING_PUNCT.has(ch)) {
      end--
      continue
    }
    if (ch === ')') {
      const head = raw.slice(0, end)
      const opens = (head.match(/\(/g) ?? []).length
      const closes = (head.match(/\)/g) ?? []).length
      if (closes > opens) {
        end--
        continue
      }
    }
    break
  }
  return [raw.slice(0, end), raw.slice(end)]
}

export interface LinkifyProps {
  /** The free-text string to render. */
  text: string
  /** Optional className for the wrapping element (only applied when present). */
  className?: string
}

/**
 * Renders a free-text string, turning embedded http(s) URLs into clickable
 * links that open through the platform's external-URL handler (Electron:
 * shell.openExternal; web: window.open). Non-URL text is rendered verbatim.
 * Use this anywhere agent-authored prose (notes, citations, explanations) is
 * shown, so the URLs researchers paste become clickable.
 */
export default function Linkify({ text, className }: LinkifyProps): React.JSX.Element {
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let key = 0
  for (const match of text.matchAll(URL_RE)) {
    const raw = match[0]
    const start = match.index ?? 0
    const [url, trailing] = splitTrailingPunctuation(raw)
    if (start > lastIndex) nodes.push(text.slice(lastIndex, start))
    nodes.push(
      <a
        key={key++}
        href={url}
        title={url}
        className={styles.link}
        onClick={(e) => {
          e.preventDefault()
          // Stop bubbling so a link inside a clickable row/card doesn't also
          // trigger that row's onClick (e.g. the research-log expand toggle).
          e.stopPropagation()
          openExternal(url)
        }}
      >
        {url}
      </a>
    )
    if (trailing) nodes.push(trailing)
    lastIndex = start + raw.length
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  if (nodes.length === 0) return <>{text}</>
  return className ? <span className={className}>{nodes}</span> : <>{nodes}</>
}
