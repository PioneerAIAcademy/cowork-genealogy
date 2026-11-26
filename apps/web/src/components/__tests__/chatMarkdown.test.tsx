import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, within } from '@testing-library/react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { joinTextBlocks } from '../chatEvents'
import { SchemaIdText } from '../SchemaIdText'

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

// Issue #4582: a reply that names an image or record by a bare ARK or image id must
// render it as a clickable FamilySearch link, and this must work with NO PROJECT open
// — both feedback #4561 sessions had none. `onOpen={undefined}` is exactly the
// no-project case (ChatPane passes no handler when `research` is null).

const FS = 'https://www.familysearch.org/'

// Mirrors ChatPane's markdown override: string children go through SchemaIdText, parsed
// nodes (links) pass through untouched. With no project, no `onOpen` is supplied.
const noProjectComponents = {
  p: ({ children }: { children?: React.ReactNode }): React.JSX.Element => (
    <p>
      {React.Children.map(children, (child) =>
        typeof child === 'string' ? <SchemaIdText text={child} onOpen={undefined} /> : child
      )}
    </p>
  ),
  li: ({ children }: { children?: React.ReactNode }): React.JSX.Element => (
    <li>
      {React.Children.map(children, (child) =>
        typeof child === 'string' ? <SchemaIdText text={child} onOpen={undefined} /> : child
      )}
    </li>
  ),
  code: ({ children }: { children?: React.ReactNode }): React.JSX.Element => (
    <code>{typeof children === 'string' ? <SchemaIdText text={children} /> : children}</code>
  ),
  strong: ({ children }: { children?: React.ReactNode }): React.JSX.Element => (
    <strong>
      {React.Children.map(children, (child) =>
        typeof child === 'string' ? <SchemaIdText text={child} onOpen={undefined} /> : child
      )}
    </strong>
  )
}

function renderReply(md: string): HTMLElement {
  return render(
    <Markdown remarkPlugins={[remarkGfm]} components={noProjectComponents}>
      {md}
    </Markdown>
  ).container
}

describe('FamilySearch source links in a reply, no project open (#4582)', () => {
  it('renders the four bare ARK "Sources consulted" lines as links', () => {
    // The shape of feedback #4561 session 2: four bare 3:1: image ARKs the main thread
    // wrote into a "Sources consulted" list.
    const arks = [
      'ark:/61903/3:1:3Q9M-CS56-DQGC-1',
      'ark:/61903/3:1:3Q9M-CS56-DQGC-2',
      'ark:/61903/3:1:3Q9M-CS56-DQGC-3',
      'ark:/61903/3:1:3Q9M-CS56-DQGC-4'
    ]
    const container = renderReply(
      ['Sources consulted:', '', ...arks.map((a) => `- ${a}`)].join('\n')
    )
    const links = within(container).getAllByRole('link')
    expect(links).toHaveLength(4)
    expect(links.map((a) => a.getAttribute('href'))).toEqual(arks.map((a) => FS + a))
  })

  it('links an image id to the film viewer with i one less than the page number', () => {
    const container = renderReply('I read image 004567123_00058 of the film.')
    const link = within(container).getByRole('link', { name: '004567123_00058' })
    expect(link.getAttribute('href')).toBe(`${FS}search/film/004567123?i=57`)
  })

  it('links a familysearch.org address written with no scheme', () => {
    const container = renderReply('Browse familysearch.org/ark:/61903/3:1:ABCD-9 for the page.')
    const link = within(container).getByRole('link')
    expect(link.getAttribute('href')).toBe(`${FS.replace('www.', '')}ark:/61903/3:1:ABCD-9`)
  })

  it('leaves an ARK that already sits inside a full URL exactly as it is', () => {
    // The full URL is react-markdown/gfm's own autolink; SchemaIdText adds nothing and
    // must not produce a second link around the nested ARK.
    const container = renderReply('See https://www.familysearch.org/ark:/61903/3:1:ABCD-1 now.')
    const links = within(container).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe(`${FS}ark:/61903/3:1:ABCD-1`)
  })

  it('leaves an ARK inside a markdown link untouched', () => {
    // A markdown link parses into a link node (a non-string child), so SchemaIdText
    // never sees the ARK inside it — one link, the markdown link itself, its label
    // intact and no second link re-scanned from the nested ARK.
    const container = renderReply(
      '[the record](https://www.familysearch.org/ark:/61903/3:1:ABCD-1) is here.'
    )
    const links = within(container).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0].textContent).toBe('the record')
    expect(links[0].getAttribute('href')).toBe(`${FS}ark:/61903/3:1:ABCD-1`)
  })

  it('links an ARK written inside backticks (the model does this ~half the time)', () => {
    const container = renderReply('Image: `ark:/61903/3:1:ABCD-1`.')
    const links = within(container).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe(`${FS}ark:/61903/3:1:ABCD-1`)
  })

  it('links an ARK written in bold', () => {
    const container = renderReply('Source: **ark:/61903/3:1:ABCD-2**')
    const link = within(container).getByRole('link')
    expect(link.getAttribute('href')).toBe(`${FS}ark:/61903/3:1:ABCD-2`)
  })

  it('does not link a bare person ID', () => {
    const container = renderReply('The subject is KW7C-X9P in the tree.')
    expect(within(container).queryByRole('link')).toBeNull()
    expect(container.textContent).toContain('KW7C-X9P')
  })
})
