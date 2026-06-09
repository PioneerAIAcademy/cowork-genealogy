// Alpha-mode flag — gates the operator/developer affordances (cost meter,
// sandbox Logs, raw-JSON peeks) that ship during the alpha test and can be
// removed after. OFF by default, so normal users never see them.
//
// Operators turn it on by visiting `/?alpha=1` once (the flag is then sticky in
// localStorage); `/?alpha=0` or clicking the alpha badge turns it back off.
import { useCallback, useState } from 'react'

const KEY = 'alpha'

function compute(): boolean {
  // An `?alpha=` param flips the sticky flag, then it persists across reloads.
  // Accept it in the real query string OR inside the hash — with a `#/s/:id`
  // route, operators tend to append "?alpha=1" to the end of the URL, which
  // lands it in the fragment, not in window.location.search.
  const hash = window.location.hash
  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  const param =
    new URLSearchParams(window.location.search).get('alpha') ??
    new URLSearchParams(hashQuery).get('alpha')
  if (param === '1') localStorage.setItem(KEY, '1')
  else if (param === '0') localStorage.removeItem(KEY)
  return localStorage.getItem(KEY) === '1'
}

export function useAlpha(): { alpha: boolean; setAlpha: (on: boolean) => void } {
  const [alpha, setOn] = useState(compute)
  const setAlpha = useCallback((on: boolean) => {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
    setOn(on)
  }, [])
  return { alpha, setAlpha }
}
