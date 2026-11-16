import { useMemo } from 'react'
import { useFile } from './FileContext'
import { Open } from './Open'
import { familyOf, peopleView, personIds, relationTo, subjectOf, treeName, type Family } from './people-model'

/** The file's family, its subject, and who the starting tree lacked (null without one). */
export function usePeople() {
  const { research, tree, startingTree } = useFile()
  return useMemo(() => {
    const family = familyOf(tree)
    return { family, subjectId: subjectOf(research, family), starting: personIds(startingTree) }
  }, [research, tree, startingTree])
}

function PersonButton({ id, family, subjectId, starting }: { id: string; family: Family; subjectId: string | null; starting: Set<string> | null }) {
  const { index } = useFile()
  const name = index.persons.get(id)?.name ?? (treeName(family.persons.get(id)) || 'Someone in the tree')
  const relation = id === subjectId ? null : relationTo(family, subjectId, id)
  return (
    <span className="person">
      <Open target={{ kind: 'person', id }}>{name}</Open>
      {relation && <span className="file-meta"> {relation}</span>}
      {starting && !starting.has(id) && <span className="file-tag">Added by this research</span>}
    </span>
  )
}

export function PeoplePage() {
  const { research } = useFile()
  const { family, subjectId, starting } = usePeople()
  const view = useMemo(() => peopleView(research, family), [research, family])
  if (!view) return <p>The tree has no one in it yet.</p>
  const button = (id: string) => <PersonButton key={id} id={id} family={family} subjectId={subjectId} starting={starting} />
  return (
    <article className="people">
      <h2>People</h2>
      {view.parents.length > 0 && (
        <section>
          <h3>Parents</h3>
          <ul className="file-list">{view.parents.map((id) => <li key={id}>{button(id)}</li>)}</ul>
        </section>
      )}
      <section>
        <h3>The subject of this research</h3>
        <p>{button(view.subjectId)}</p>
      </section>
      {view.couples.map((couple) => (
        <section key={couple.spouseId}>
          <h3>With {button(couple.spouseId)}</h3>
          {couple.children.length > 0 && <ul className="file-list">{couple.children.map((id) => <li key={id}>{button(id)}</li>)}</ul>}
        </section>
      ))}
      {view.otherChildren.length > 0 && (
        <section>
          <h3>Other children</h3>
          <ul className="file-list">{view.otherChildren.map((id) => <li key={id}>{button(id)}</li>)}</ul>
        </section>
      )}
      {view.everyoneElse.length > 0 && (
        <section>
          <h3>Everyone else in the tree</h3>
          <ul className="file-list">{view.everyoneElse.map((id) => <li key={id}>{button(id)}</li>)}</ul>
        </section>
      )}
    </article>
  )
}
