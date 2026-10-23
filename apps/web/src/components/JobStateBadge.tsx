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
  // A message the reader sent mid-turn, waiting for the turn to end. Not "Needs
  // you" -- they have already spoken and the system owes the next move -- and not
  // "Working…", which would blur it with a turn that is actually executing.
  queued: 'Queued',
  'needs you': 'Needs you',
  done: 'Done',
  stopped: 'Stopped'
}

// Three of the five want the reader's attention; two are resting states. `queued`
// is live work pending, so it reads as active rather than at rest.
const ATTENTION = new Set<JobState>(['running', 'queued', 'needs you'])

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
