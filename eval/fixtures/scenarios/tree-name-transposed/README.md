# Scenario: tree-name-transposed

A mid-research project whose tree already contains a person recorded under a
**transposed given-name** — the kind of obituary-index rendering that
interleaves a maiden surname among the given names.

- **I1** — John Cooper (husband).
- **I2** — recorded as **"Mary Harvey Ann Cooper"** (preferred name). This is a
  transposed rendering: her maiden surname **Harvey** sits *between* her given
  name (Mary) and middle name (Ann). The correct genealogical order is
  **"Mary Ann Harvey Cooper"** (given Mary, middle Ann, maiden Harvey, married
  Cooper). No source is attached — the name is contrived to set up the
  name-reconciliation test.
- **R1** — Couple I1 ⇄ I2.

Used by `ut_record_extraction_019` (name-order refinement): extracting a
marriage record that establishes Harvey as Mary's maiden surname should let the
record-extractor **refine I2's primary name to the canonical order**, rather
than leave the first-seen transposed form in place. From the
applegarth-parents-1936 e2e run (Olive "Harvey Annie" vs the correct "Annie
Harvey") and the senior-genealogist (Leduthet) review.
