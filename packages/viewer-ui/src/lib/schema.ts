// The canonical research.json + simplified-GedcomX types now live in the
// shared @genealogy/schema package (single source of truth, also consumed by
// the web client and the control plane). This module re-exports them so the
// many `../lib/schema` relative imports across the viewer keep working.
export * from '@genealogy/schema'
