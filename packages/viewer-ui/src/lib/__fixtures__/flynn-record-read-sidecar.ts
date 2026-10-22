// Sidecar fixture for a `record_read` log entry: the 1850 census household of
// Thomas, Mary and Patrick Flynn. Built from the committed MCP fixture
// eval/fixtures/mcp/record-read-flynn-1850-thomas-mary-patrick-mxhy-tq2.json in the
// shape record-read.ts stages it: one result, `gedcomx` the whole simplified
// document, `indexFields` beside it. The census marks every member principal.

import type { SidecarFile } from '../schema'

export const flynnRecordReadSidecar: SidecarFile = {
  log_id: 'log_001',
  tool: 'record_read',
  retrieved: '2026-09-30T12:00:00Z',
  returned_count: 1,
  payload: {
    query: { recordId: 'ark:/61903/1:1:MXHY-TQ2' },
    results: [
      {
        recordId: 'ark:/61903/1:1:MXHY-TQ2',
        gedcomx: {
          persons: [
            {
              id: 'p_1',
              gender: 'Male',
              names: [
                {
                  id: 'n_1',
                  type: 'BirthName',
                  given: 'Thomas',
                  surname: 'Flynn'
                }
              ],
              principal: true,
              facts: [
                {
                  type: 'Occupation',
                  value: 'Miner'
                },
                {
                  type: 'Census',
                  date: '1850',
                  place: 'Schuylkill, Pennsylvania, United States'
                },
                {
                  type: 'Birth',
                  date: '1818',
                  place: 'Ireland'
                }
              ],
              sources: [
                {
                  ref: 'src_r_1'
                }
              ]
            },
            {
              id: 'p_2',
              gender: 'Female',
              names: [
                {
                  id: 'n_2',
                  type: 'BirthName',
                  given: 'Mary',
                  surname: 'Flynn'
                }
              ],
              principal: true,
              facts: [
                {
                  type: 'Census',
                  date: '1850',
                  place: 'Schuylkill, Pennsylvania, United States'
                },
                {
                  type: 'Birth',
                  date: '1822',
                  place: 'Ireland'
                }
              ],
              sources: [
                {
                  ref: 'src_r_1'
                }
              ]
            },
            {
              id: 'p_3',
              gender: 'Male',
              names: [
                {
                  id: 'n_3',
                  type: 'BirthName',
                  given: 'Patrick',
                  surname: 'Flynn'
                }
              ],
              principal: true,
              facts: [
                {
                  type: 'Census',
                  date: '1850',
                  place: 'Schuylkill, Pennsylvania, United States'
                },
                {
                  type: 'Birth',
                  date: '1845',
                  place: 'Ireland'
                }
              ],
              sources: [
                {
                  ref: 'src_r_1'
                }
              ]
            }
          ],
          relationships: [],
          sources: [
            {
              id: 'src_r_1',
              resource_type: 'Record',
              title: 'Entry for Thomas Flynn and Mary Flynn, "United States, Census, 1850"',
              citation:
                '"United States, Census, 1850", <i>FamilySearch</i> (https://www.familysearch.org/ark:/61903/1:1:MXHY-TQ2 : accessed 30 September 2026), Entry for Thomas Flynn and Mary Flynn.',
              url: 'https://www.familysearch.org/ark:/61903/1:1:MXHY-TQ2'
            },
            {
              id: 'sd_c_1',
              resource_type: 'Collection',
              title: 'United States, Census, 1850'
            }
          ],
          places: []
        },
        indexFields: {
          p_1: {
            sortKey: '0000000000000001_00001_00001_0000000000000001_000',
            age: '32',
            householdId: '1'
          },
          p_2: {
            sortKey: '0000000000000001_00001_00001_0000000000000001_001',
            age: '28',
            householdId: '1'
          },
          p_3: {
            sortKey: '0000000000000001_00001_00001_0000000000000001_002',
            age: '5',
            householdId: '1'
          }
        }
      }
    ] as unknown as SidecarFile['payload']['results']
  }
}
