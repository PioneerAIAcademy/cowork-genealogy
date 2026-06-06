import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import type { ResearchData, GedcomxData, SidecarFile } from '../lib/schema'
import {
  ResearchDataContext,
  buildIndex,
  type IndexEntry,
  type ResearchDataState,
  type SidecarState
} from './ResearchDataContext'

// Debounce window for per-logId sidecar refresh — collapses bursts of
// watcher events (e.g. a tool writing many results files in 100ms) into
// a single readSidecar call per logId.
const SIDECAR_COALESCE_MS = 100

export function ResearchDataProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [research, setResearch] = useState<ResearchData | null>(null)
  const [gedcomx, setGedcomx] = useState<GedcomxData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [devMode, setDevMode] = useState(false)
  const [activeSection, setActiveSection] = useState('project_overview')
  const [sidecar, setSidecar] = useState<SidecarState>({ status: 'closed' })

  // Refs that always see the latest sidecar state inside callbacks captured
  // by useEffect on mount (avoids re-binding the watcher subscription every
  // time sidecar state changes).
  const sidecarRef = useRef(sidecar)
  useEffect(() => {
    sidecarRef.current = sidecar
  }, [sidecar])

  // Pending per-logId fetch timers — supports the debounce coalesce.
  const pendingFetchTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Actual fetch implementation. Reads the sidecar via IPC, parses in the
  // renderer (so the main process stays responsive on multi-MB payloads),
  // and lands the right SidecarState branch.
  const performFetch = useCallback(
    async (logId: string, focusPersonaId?: string): Promise<void> => {
      try {
        const result = await window.api.readSidecar(logId)
        if (result === null) {
          // Only land MISSING if the user still cares about this logId.
          setSidecar((prev) => {
            if (prev.status === 'closed' || prev.logId !== logId) return prev
            return { status: 'missing', logId }
          })
          return
        }
        const payload = JSON.parse(result.raw) as SidecarFile
        setSidecar((prev) => {
          if (prev.status === 'closed' || prev.logId !== logId) return prev
          // Race guard: a newer fetch already landed for this logId.
          if (prev.status === 'loaded' && prev.lastMtime > result.mtime) return prev
          return {
            status: 'loaded',
            logId,
            focusPersonaId:
              focusPersonaId ?? (prev.status !== 'loaded' ? undefined : prev.focusPersonaId),
            payload,
            lastMtime: result.mtime
          }
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setSidecar((prev) => {
          if (prev.status === 'closed' || prev.logId !== logId) return prev
          return { status: 'error', logId, error: message }
        })
      }
    },
    []
  )

  useEffect(() => {
    // Capture ref value for cleanup — Map instance is stable across renders.
    const timers = pendingFetchTimers.current

    // Hydrate from main process state (covers CLI --project-dir and page reloads)
    window.api.getState().then((state) => {
      if (state.folderPath) {
        setFolderPath(state.folderPath)
        if (state.research) {
          setResearch(state.research as ResearchData)
          setLastUpdated(new Date())
        }
        if (state.gedcomx) {
          setGedcomx(state.gedcomx as GedcomxData)
        }
      }
    })

    window.api.onResearchUpdated((data) => {
      setResearch(data as ResearchData)
      setLastUpdated(new Date())
      setError(null)
      setFolderPath((prev) => prev ?? '(watching)')
    })

    window.api.onGedcomxUpdated((data) => {
      setGedcomx(data as GedcomxData)
      setLastUpdated(new Date())
    })

    window.api.onWatchError((err) => {
      setError(err)
    })

    // Sidecar watcher subscription. Pointer-only events (logId + mtime);
    // we refetch via readSidecar so the drawer always sees the latest file.
    window.api.onSidecarUpdated(({ logId, mtime }) => {
      const current = sidecarRef.current
      // Drawer is closed or showing a different sidecar — ignore.
      if (current.status === 'closed') return
      if (current.logId !== logId) return
      // Race guard: incoming event is no newer than what we have.
      if (current.status === 'loaded' && mtime > 0 && current.lastMtime >= mtime) return

      // Per-logId coalesce: reset any pending timer, fire after a quiet window.
      const existing = timers.get(logId)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        timers.delete(logId)
        const stillCurrent = sidecarRef.current
        if (stillCurrent.status === 'closed') return
        if (stillCurrent.logId !== logId) return
        const focus =
          stillCurrent.status === 'loading' || stillCurrent.status === 'loaded'
            ? stillCurrent.focusPersonaId
            : undefined
        performFetch(logId, focus)
      }, SIDECAR_COALESCE_MS)
      timers.set(logId, timer)
    })

    return () => {
      window.api.removeAllWatchListeners()
      // Cancel any pending sidecar refetches on unmount.
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
    }
  }, [performFetch])

  const index = useMemo(() => buildIndex(research, gedcomx), [research, gedcomx])

  const getById = useCallback(
    (id: string): IndexEntry | null => {
      const entry = index.get(id)
      if (!entry) {
        console.warn(`[ResearchDataContext] Reference not found: ${id}`)
        return null
      }
      return entry
    },
    [index]
  )

  const clearError = useCallback(() => setError(null), [])

  const selectFolder = useCallback(async () => {
    try {
      const path = await window.api.selectFolder()
      if (path) {
        setFolderPath(path)
        setError(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select folder')
    }
  }, [])

  const openSidecar = useCallback(
    (logId: string, focusPersonaId?: string) => {
      // Idempotent: opening the same already-loaded sidecar only updates
      // focusPersonaId. Avoids a wasteful re-fetch + lost scroll position.
      const current = sidecarRef.current
      if (current.status === 'loaded' && current.logId === logId) {
        setSidecar({ ...current, focusPersonaId })
        return
      }
      setSidecar({ status: 'loading', logId, focusPersonaId })
      performFetch(logId, focusPersonaId)
    },
    [performFetch]
  )

  const closeSidecar = useCallback(() => {
    setSidecar({ status: 'closed' })
    // Cancel any pending refetch timers — drawer is closed, results don't matter.
    const timers = pendingFetchTimers.current
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
  }, [])

  const clearFocusPersona = useCallback(() => {
    setSidecar((prev) => {
      if (prev.status === 'closed') return prev
      if (prev.status === 'loaded') return { ...prev, focusPersonaId: undefined }
      if (prev.status === 'loading') return { ...prev, focusPersonaId: undefined }
      return prev
    })
  }, [])

  const value: ResearchDataState = useMemo(
    () => ({
      research,
      gedcomx,
      error,
      clearError,
      lastUpdated,
      folderPath,
      devMode,
      setDevMode,
      getById,
      selectFolder,
      activeSection,
      setActiveSection,
      sidecar,
      openSidecar,
      closeSidecar,
      clearFocusPersona
    }),
    [
      research,
      gedcomx,
      error,
      clearError,
      lastUpdated,
      folderPath,
      devMode,
      getById,
      selectFolder,
      activeSection,
      sidecar,
      openSidecar,
      closeSidecar,
      clearFocusPersona
    ]
  )

  return <ResearchDataContext.Provider value={value}>{children}</ResearchDataContext.Provider>
}
