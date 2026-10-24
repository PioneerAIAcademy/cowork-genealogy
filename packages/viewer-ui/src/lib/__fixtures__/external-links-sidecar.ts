// Sidecar fixture for an `external_links_search` log entry. external-links-search.ts
// stages `{ url, linkText }` rows. The ftp:// row is not openable and must render
// as text only.

import type { SidecarFile } from '../schema'

export const externalLinksSidecar: SidecarFile = {
  log_id: 'log_007',
  tool: 'external_links_search',
  retrieved: '2026-09-30T12:05:00Z',
  returned_count: 3,
  payload: {
    query: { standardPlace: 'Schuylkill, Pennsylvania, United States' },
    results: [
      {
        url: 'https://www.ancestry.com/search/collections/8054/',
        linkText: 'Pennsylvania, Church and Town Records, 1669-2013'
      },
      {
        url: 'https://www.findmypast.com/search/united-states-records',
        linkText: 'United States Records'
      },
      { url: 'ftp://archive.example.org/schuylkill/', linkText: 'Schuylkill County archive' }
    ] as unknown as SidecarFile['payload']['results']
  }
}
