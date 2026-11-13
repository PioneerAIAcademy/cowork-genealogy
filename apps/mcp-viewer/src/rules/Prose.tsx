import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { proseMarkdown } from './prose-markdown'
import type { RuleIndex } from './rule-index'

const COMPONENTS: Components = {
  img: ({ alt }) => <>{alt ?? ''}</>,
  a: ({ href, children }) => <a href={href}>{children}</a>
}

/** Agent-written prose under the display rules. Images load nothing; the link opener opens anchors. */
export function Prose({ text, index }: { text: unknown; index: RuleIndex }) {
  if (typeof text !== 'string' || text.trim() === '') return null
  return (
    <div className="prose">
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {proseMarkdown(text, index)}
      </Markdown>
    </div>
  )
}
