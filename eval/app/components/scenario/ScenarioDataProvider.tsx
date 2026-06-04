import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ResearchData, GedcomxData } from './lib/schema';
import {
  ResearchDataContext,
  buildIndex,
  type IndexEntry,
  type ResearchDataState,
} from './contexts/ResearchDataContext';

/**
 * A network-free, file-watcher-free stand-in for the desktop app's
 * Electron `ResearchDataProvider`. The lifted section components consume
 * everything through `useResearchData()`, so we feed the SAME context from
 * plain props (parsed out of the run-log snapshot) instead of Electron IPC.
 *
 * Everything the scoring viewer doesn't need — sidecar fetching, folder
 * selection, dev mode, file watching — is supplied as an inert no-op so the
 * context value still satisfies `ResearchDataState`.
 */
export function ScenarioDataProvider({
  research,
  gedcomx,
  children,
}: {
  research: ResearchData | null;
  gedcomx: GedcomxData | null;
  children: ReactNode;
}): React.JSX.Element {
  // Kept as local state so CrossLink's (now inert) setActiveSection contract
  // still resolves; nothing in the read-only viewer drives navigation.
  const [activeSection, setActiveSection] = useState('project_overview');

  const index = useMemo(() => buildIndex(research, gedcomx), [research, gedcomx]);
  const getById = useCallback(
    (id: string): IndexEntry | null => index.get(id) ?? null,
    [index],
  );

  const value: ResearchDataState = useMemo(
    () => ({
      research,
      gedcomx,
      error: null,
      clearError: () => {},
      lastUpdated: null,
      folderPath: null,
      devMode: false,
      setDevMode: () => {},
      getById,
      selectFolder: async () => {},
      activeSection,
      setActiveSection,
      sidecar: { status: 'closed' },
      openSidecar: () => {},
      closeSidecar: () => {},
      clearFocusPersona: () => {},
    }),
    [research, gedcomx, getById, activeSection],
  );

  return <ResearchDataContext.Provider value={value}>{children}</ResearchDataContext.Provider>;
}
