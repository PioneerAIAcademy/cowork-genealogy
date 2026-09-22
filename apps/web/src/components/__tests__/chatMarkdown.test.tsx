import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { joinTextBlocks } from '../chatEvents'

// Renders through the same <Markdown remarkPlugins={[remarkGfm]}> as the chat
// bubble (ChatPane.tsx). Guards issue #1458: the global reset zeroes every
// block margin, and .msgText must restore separation for the blocks agent
// narration emits. jsdom loads no stylesheet, so this asserts DOM STRUCTURE
// only — that each block renders as its own element — not computed margins.

describe('chat markdown rendering (#1458 / #1524)', () => {
  it('renders a blank-line paragraph break as two separate <p> (#1524)', () => {
    // joinTextBlocks is exactly how two streamed text blocks are stitched, so
    // this pins the regression #1312/#1524 describe: a flattened join renders
    // one <p>, a real break renders two.
    const { container } = render(
      <Markdown remarkPlugins={[remarkGfm]}>
        {joinTextBlocks('First paragraph.', 'Second paragraph.')}
      </Markdown>
    )
    expect(container.querySelectorAll('p')).toHaveLength(2)
  })

  it('renders lists, a fenced block, a blockquote and headings as distinct blocks', () => {
    const md = [
      '- item one',
      '- item two',
      '',
      '1. first',
      '2. second',
      '',
      '```',
      'code fence',
      '```',
      '',
      '> a quote',
      '',
      '## Heading two',
      '',
      '### Heading three'
    ].join('\n')
    const { container } = render(
      <Markdown remarkPlugins={[remarkGfm]}>{md}</Markdown>
    )
    expect(container.querySelectorAll('ul')).toHaveLength(1)
    expect(container.querySelectorAll('ol')).toHaveLength(1)
    expect(container.querySelectorAll('li')).toHaveLength(4)
    expect(container.querySelectorAll('pre')).toHaveLength(1)
    expect(container.querySelectorAll('blockquote')).toHaveLength(1)
    // The de-escalated headings must still render as their own h2/h3 elements,
    // not be swallowed or promoted — the .msgText override styles these tags.
    expect(container.querySelectorAll('h2')).toHaveLength(1)
    expect(container.querySelectorAll('h3')).toHaveLength(1)
  })
})
