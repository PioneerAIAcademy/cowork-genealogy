import React from 'react'
import type { JobState } from '../api'

// "That is the returning reader's one screen." The list showed a title and a model
// pill, so a finished job, one waiting on the reader, and one that stopped at a cap
// all looked identical.
//
// `new` and a missing state render NOTHING. A brand-new session needs no badge --
// every row on a new list was new a moment ago -- and an older server that omits the
// field must degrade to no badge rather than a wrong one.
const LABELS: Record<Exclude<JobState, 'new'>, string> = {
  running: 'Working…',
  'needs you': 'Needs you',
  done: 'Done',
  stopped: 'Stopped'
}

// Two of the four want the reader's attention; two are resting states.
const ATTENTION = new Set<JobState>(['running', 'needs you'])

export function JobStateBadge({ state }: { state?: JobState }): React.JSX.Element | null {
  if (!state || state === 'new') return null
  const label = LABELS[state as Exclude<JobState, 'new'>]
  if (!label) return null
  return (
    <span className={`jobState ${ATTENTION.has(state) ? 'jobStateLive' : 'jobStateRest'}`}>
      {label}
    </span>
  )
}
