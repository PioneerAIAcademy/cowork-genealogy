/** Whether an assertion says the record lacked the value: `record_basis: absent`, or, in a
 *  document written before the 2026-09-18 rename, `evidence_type: negative`. Read-only,
 *  as the engine's `src/utils/record-basis.ts` reads it. */
export function isAbsent(assertion: object): boolean {
  const a = assertion as { record_basis?: unknown; evidence_type?: unknown }
  return a.record_basis === 'absent' || (a.record_basis === undefined && a.evidence_type === 'negative')
}
