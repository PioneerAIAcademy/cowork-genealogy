import { isOpenableUrl, openExternal } from '../../lib/external'
import { nonEmpty, type ExternalLinkResult } from './SidecarResultCard'
import styles from './SidecarResultCard.module.css'

/**
 * An `external_links_search` sidecar: one card listing every staged link. These
 * point at Ancestry, FindMyPast and other sites, so they go through the generic
 * `openExternal` channel, not `openFamilySearch` — and, as with every generic
 * sink, the URL is shown as its own text so the reader can see the destination.
 * Only https URLs are clickable (`isOpenableUrl`).
 */
export default function ExternalLinksResults({
  results
}: {
  results: ExternalLinkResult[]
}): React.JSX.Element {
  const links = results
    .filter((r) => r && nonEmpty(r.url))
    .map((r) => ({ url: (r.url as string).trim(), label: nonEmpty(r.linkText) ? r.linkText : '' }))

  return (
    <article className={styles.card}>
      <div className={styles.body}>
        {links.length === 0 && <span className={styles.personFactsEmpty}>No links recorded</span>}
        <ul className={styles.treeMatchList}>
          {links.map((link, i) => {
            return (
              <li key={i} className={styles.treeMatchItem}>
                <span>{link.label || link.url}</span>
                {' — '}
                {isOpenableUrl(link.url) ? (
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
