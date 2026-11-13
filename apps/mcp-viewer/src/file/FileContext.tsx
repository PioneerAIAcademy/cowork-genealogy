import { createContext, useContext } from 'react'
import type { Derived, ResearchDocument } from '../contract'
import type { RuleIndex } from '../rules/rule-index'
import type { McpAppResearchTransport } from '../transport/McpAppResearchTransport'
import type { PaneTarget } from './model'

/** Where The case should look: a question, and an element to scroll to. */
export interface CaseFocus {
  questionId?: string
  planItemId?: string
  anchor?: string
}

/** Everything a page of the file reads, set once per document. */
export interface FileView {
  research: ResearchDocument
  tree: unknown
  startingTree: unknown
  collections: unknown
  derived: Derived
  index: RuleIndex
  transport: McpAppResearchTransport
  pane: PaneTarget | null
  focus: CaseFocus | null
  open(target: PaneTarget): void
  close(): void
}

export const FileContext = createContext<FileView | null>(null)

export function useFile(): FileView {
  const file = useContext(FileContext)
  if (!file) throw new Error('useFile outside the case file')
  return file
}
