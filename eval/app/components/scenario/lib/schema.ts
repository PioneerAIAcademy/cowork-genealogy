// The research.json + simplified-GedcomX types, re-exported from the single
// source of truth. This file used to hand-type its own copy of them (#1488);
// eval/app is a pnpm workspace member now, so the copy is deleted rather than
// guarded — ADR-0008 tier 1. Add nothing here that @genealogy/schema owns.
export * from '@genealogy/schema'
