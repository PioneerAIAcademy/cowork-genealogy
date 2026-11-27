import React from 'react'
import { SchemaIdText } from './SchemaIdText'

/**
 * The chat bubble's react-markdown overrides. Prose in a paragraph, list item or bold
 * runs through SchemaIdText; a code span links FamilySearch references only, since a
 * schema id in code is literal. Parsed nodes (links, emphasis) pass through untouched.
 * With no handler, schema ids stay plain text and FamilySearch references still link.
 */
export function chatMarkdownComponents(
  openSchemaId?: (id: string, section: string) => void,
  hasSchemaId?: (id: string) => boolean
) {
  const prose = (children: React.ReactNode): React.ReactNode =>
    React.Children.map(children, (child) =>
      typeof child === 'string' ? (
        <SchemaIdText text={child} onOpen={openSchemaId} hasId={hasSchemaId} />
      ) : (
        child
      )
    )
  return {
    p: ({ children }: { children?: React.ReactNode }): React.JSX.Element => <p>{prose(children)}</p>,
    li: ({ children }: { children?: React.ReactNode }): React.JSX.Element => <li>{prose(children)}</li>,
    strong: ({ children }: { children?: React.ReactNode }): React.JSX.Element => (
      <strong>{prose(children)}</strong>
    ),
    code: ({ children, className }: { children?: React.ReactNode; className?: string }): React.JSX.Element => (
      <code className={className}>
        {typeof children === 'string' ? <SchemaIdText text={children} /> : children}
      </code>
    )
  }
}
