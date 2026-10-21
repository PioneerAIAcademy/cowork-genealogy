import { openExternal } from '../../lib/external'
import type { ExternalLinkResult } from './SidecarResultCard'
import styles from './SidecarResultCard.module.css'

const OPENABLE_RE = /^https?:\/\//i

/**
 * An `external_links_search` sidecar: one card listing every staged link. These
 * point at Ancestry, FindMyPast and other sites, so they go through the generic
 * `openExternal` channel, not `openFamilySearch` — and, as with every generic
 * sink, the URL is shown as its own text so the reader can see the destination.
 * Only http(s) URLs are clickable, matching Linkify.
 */
export default function ExternalLinksResults({
  results
}: {
  results: ExternalLinkResult[]
}): React.JSX.Element {
  const links = results.filter(
    (r): r is ExternalLinkResult & { url: string } =>
      !!r && typeof r.url === 'string' && r.url.trim() !== ''
  )

  return (
    <article className={styles.card}>
      <div className={styles.body}>
        <ul className={styles.treeMatchList}>
          {links.map((link, i) => {
            const label =
              typeof link.linkText === 'string' && link.linkText.trim() !== ''
                ? link.linkText
                : link.url
            return (
              <li key={i} className={styles.treeMatchItem}>
                <span>{label}</span>
                {' — '}
                {OPENABLE_RE.test(link.url) ? (
                  <button
                    type="button"
                    className={styles.externalLink}
                    onClick={() => openExternal(link.url)}
                  >
                    {link.url}
                  </button>
                ) : (
                  <code className={styles.treeId}>{link.url}</code>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </article>
  )
}
