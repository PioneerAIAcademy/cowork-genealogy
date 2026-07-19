import { useCallback, useEffect, useRef, useState } from 'react'

// Width of the chat pane in the session two-pane layout, in px. Draggable via
// the divider in SessionView, persisted per browser so it survives a reload.
const KEY = 'cg.chatWidth'
export const DEFAULT_CHAT_WIDTH = 380
const MIN_CHAT_WIDTH = 280
// The viewer's own section nav is ~240px, so anything under ~560 leaves a
// content column too narrow to read (text wraps to one word per line).
const MIN_VIEWER_WIDTH = 560

function maxChatWidth(): number {
  return Math.max(MIN_CHAT_WIDTH, window.innerWidth - MIN_VIEWER_WIDTH)
}

function clamp(px: number): number {
  return Math.min(Math.max(px, MIN_CHAT_WIDTH), maxChatWidth())
}

function load(): number {
  const raw = Number(localStorage.getItem(KEY))
  return clamp(Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CHAT_WIDTH)
}

type DividerProps = React.ComponentPropsWithoutRef<'div'> & { 'data-dragging'?: string }

export function useChatWidth(): {
  width: number
  dragging: boolean
  dividerProps: DividerProps
} {
  const [width, setWidth] = useState(load)
  const [dragging, setDragging] = useState(false)
  const originRef = useRef({ x: 0, width: 0 })
  const activeRef = useRef<number | null>(null) // pointerId of the in-flight drag

  // The width the user actually asked for. `width` is that value clamped to the
  // current window; keeping the two apart is what lets a narrow window squeeze
  // the pane without destroying the choice behind it.
  const desiredRef = useRef(width)

  const commit = useCallback((px: number) => {
    const next = clamp(px)
    desiredRef.current = next
    setWidth(next)
    localStorage.setItem(KEY, String(next))
  }, [])

  // Narrowing the window can leave the chosen width wider than the clamp allows.
  // Re-derive from the choice (not from the current rendered width, which would
  // ratchet the pane permanently narrower) and don't persist — so widening the
  // window back restores what the user picked.
  useEffect(() => {
    const onResize = (): void => setWidth(clamp(desiredRef.current))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.preventDefault() // don't start a text selection in either pane
      // Capture keeps the pointer stream on the handle when the cursor runs
      // ahead of it, but it is an optimization, not the gate — `activeRef` is,
      // so a browser that refuses capture still drags instead of silently
      // no-opping.
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* not fatal — see above */
      }
      originRef.current = { x: e.clientX, width }
      activeRef.current = e.pointerId
      setDragging(true)
    },
    [width]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (activeRef.current !== e.pointerId) return
      commit(originRef.current.width + (e.clientX - originRef.current.x))
    },
    [commit]
  )

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (activeRef.current !== e.pointerId) return
    activeRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setDragging(false)
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 48 : 16
      if (e.key === 'ArrowLeft') commit(width - step)
      else if (e.key === 'ArrowRight') commit(width + step)
      else if (e.key === 'Home') commit(DEFAULT_CHAT_WIDTH)
      else return
      e.preventDefault()
    },
    [commit, width]
  )

  return {
    width,
    dragging,
    dividerProps: {
      className: 'paneDivider',
      role: 'separator',
      tabIndex: 0,
      'aria-orientation': 'vertical',
      'aria-label': 'Resize chat pane',
      'aria-valuenow': width,
      'aria-valuemin': MIN_CHAT_WIDTH,
      'aria-valuemax': Math.round(maxChatWidth()),
      'data-dragging': dragging ? 'true' : undefined,
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onDoubleClick: () => commit(DEFAULT_CHAT_WIDTH),
      onKeyDown
    }
  }
}
