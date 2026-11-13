/** The page's only opener for anchors: the frame never navigates, and only https opens. */
export function installLinkOpener(doc: Document, openLink: (url: string) => unknown): () => void {
  function onActivate(event: MouseEvent): void {
    if (event.type === 'auxclick' && event.button !== 1) return
    const target = event.target
    const anchor = target instanceof Element ? target.closest('a[href]') : null
    if (!anchor) return
    event.preventDefault()
    event.stopPropagation()
    const url = httpsUrl(anchor.getAttribute('href'))
    if (url) void Promise.resolve(openLink(url)).catch(() => {})
  }

  doc.addEventListener('click', onActivate, true)
  doc.addEventListener('auxclick', onActivate, true)
  return () => {
    doc.removeEventListener('click', onActivate, true)
    doc.removeEventListener('auxclick', onActivate, true)
  }
}

export function httpsUrl(href: string | null): string | null {
  if (!href) return null
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  return url.protocol === 'https:' ? url.href : null
}
