import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { proseMarkdown } from './prose-markdown'
import type { RuleIndex } from './rule-index'

const COMPONENTS: Components = {
  img: ({ alt }) => <>{alt ?? ''}</>,
  a: ({ href, children }) => <a href={href}>{children}</a>
}

const INLINE: Components = { ...COMPONENTS, p: ({ children }) => <>{children}</> }

/** Agent-written prose under the display rules. Images load nothing; the link opener opens anchors.
 *  `inline` draws a short value inside a line, with no paragraph around it. */
export function Prose({ text, index, inline = false }: { text: unknown; index: RuleIndex; inline?: boolean }) {
  if (typeof text !== 'string' || text.trim() === '') return null
  const markdown = proseMarkdown(text, index)
  if (inline) {
    return (
      <span className="prose-inline">
        <Markdown remarkPlugins={[remarkGfm]} components={INLINE}>
          {markdown}
        </Markdown>
      </span>
    )
  }
  return (
    <div className="prose">
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {markdown}
      </Markdown>
    </div>
  )
}

/** The same rules as plain text, for a place that holds no markup (a menu option, a title). */
export function plainProse(text: unknown, index: RuleIndex): string {
  if (typeof text !== 'string') return ''
  return proseMarkdown(text, index)
    .replace(/!?\[((?:\\.|[^\]\\])*)\]\([^)]*\)/g, (_m, label: string) => label.replace(/\\([\\[\]])/g, '$1'))
    .replace(/\*\*|\*|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
