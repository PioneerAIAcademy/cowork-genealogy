import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { list } from '../cards/kit/view'
import type { ProjectDocument, ToolInput } from '../contract'
import { buildRuleIndex } from '../rules/rule-index'
import type { Session } from '../session'
import { projectLabel } from '../transport/McpAppResearchTransport'
import { FileContext, useFile, type FileView } from './FileContext'
import { LogPage } from './LogPage'
import { pagesWithContent, searchFile, sourceTitle, toolWords, type PageKey, type PaneTarget } from './model'
import { Pane } from './Panes'
import { SourcesPage } from './SourcesPage'

const PAGE_TITLES: Record<PageKey, string> = { sources: 'Sources', log: 'Log' }
const PAGES: Record<PageKey, () => React.JSX.Element> = { sources: SourcesPage, log: LogPage }

/** What `show_project` asked the file to open first. */
function initialPane(input: ToolInput): PaneTarget | null {
  if (typeof input.sourceId === 'string') return { kind: 'record', id: input.sourceId }
  if (typeof input.logId === 'string') return { kind: 'search', id: input.logId }
  if (typeof input.personId === 'string') return { kind: 'person', id: input.personId }
  return null
}

/** The pane's item in words, for the model. */
function paneWords(target: PaneTarget, view: Pick<FileView, 'research' | 'index'>): string {
  if (target.kind === 'person') return view.index.persons.get(target.id)?.name ?? 'a person'
  if (target.kind === 'record') {
    const source = list(view.research.sources).find((s) => s.id === target.id)
    return source ? `the record "${sourceTitle(source, view.index)}"` : 'a record'
  }
  const entry = list(view.research.log).find((e) => e.id === target.id)
  return entry ? `the search of ${toolWords(entry)} from ${String(entry.performed ?? '').slice(0, 10)}` : 'a search'
}

function SearchBox() {
  const file = useFile()
  const [query, setQuery] = useState('')
  const hits = useMemo(() => searchFile(file.research, file.index, query), [file.research, file.index, query])
  return (
    <div className="file-search">
      <input
        type="search"
        aria-label="Search the case file"
        placeholder="Search the case file"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            setQuery('')
          }
        }}
      />
      {hits.length > 0 && (
        <ul className="file-search-hits">
          {hits.map((hit, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => {
                  file.open(hit.target)
                  setQuery('')
                }}
              >
                {hit.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The new case file: pages with content, a search box over all of it, and one pane beside the page. */
export function NewCaseFile({ session, input }: { session: Session; input: ToolInput }) {
  const { fileDocument } = useSyncExternalStore(session.subscribe, session.getState)
  const document: ProjectDocument = fileDocument ?? {}
  const research = document.research ?? {}
  const index = useMemo(() => buildRuleIndex({ research, tree: document.tree }), [research, document.tree])
  const pages = pagesWithContent(research, document.collections)
  const wanted = typeof input.page === 'string' && pages.includes(input.page as PageKey) ? (input.page as PageKey) : null
  const [page, setPage] = useState<PageKey | null>(wanted)
  const [pane, setPane] = useState<PaneTarget | null>(() => initialPane(input))
  const shown = page && pages.includes(page) ? page : (pages[0] ?? null)

  const open = useCallback(
    (target: PaneTarget) => {
      setPane(target)
      session.tellModel(`In the case file, the researcher is looking at ${paneWords(target, { research, index })}.`)
    },
    [session, research, index]
  )
  const close = useCallback(() => setPane(null), [])

  const view: FileView = {
    research,
    tree: document.tree,
    startingTree: document.startingTree,
    collections: document.collections,
    derived: document.derived ?? {},
    index,
    transport: session.transport,
    pane,
    open,
    close
  }
  const Page = shown ? PAGES[shown] : null

  return (
    <FileContext.Provider value={view}>
      <div className={`new-file${pane ? ' with-pane' : ''}`}>
        <header className="file-bar">
          <strong>{projectLabel(document)}</strong>
          <SearchBox />
          <button type="button" onClick={() => void session.requestMode('inline')}>
            Back to the card
          </button>
        </header>
        <nav className="file-pages" aria-label="Pages">
          {pages.map((key) => (
            <button key={key} type="button" aria-current={key === shown ? 'page' : undefined} onClick={() => setPage(key)}>
              {PAGE_TITLES[key]}
            </button>
          ))}
        </nav>
        <main className="file-main">{Page ? <Page /> : <p>This project has nothing to show yet.</p>}</main>
        <Pane />
      </div>
    </FileContext.Provider>
  )
}
