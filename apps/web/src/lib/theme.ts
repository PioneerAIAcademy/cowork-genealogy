// Light/dark theme for the web shell. Deliberately mirrors the viewer's own
// toggle (packages/viewer-ui Sidebar.tsx): same localStorage key (`theme`) and
// same global attribute (`document.documentElement.dataset.theme`), so toggling
// from the shell or from inside the viewer always switches BOTH panes together
// — there is one source of truth for the rendered theme (the <html> attribute).
import { useCallback, useState } from 'react'

function initTheme(): string {
  const stored = localStorage.getItem('theme') || 'light'
  if (document.documentElement.dataset.theme == null) {
    document.documentElement.dataset.theme = stored
  }
  return stored
}

export function useTheme(): { theme: string; toggleTheme: () => void } {
  const [theme, setTheme] = useState(initTheme)
  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    localStorage.setItem('theme', next)
    setTheme(next)
  }, [theme])
  return { theme, toggleTheme }
}
