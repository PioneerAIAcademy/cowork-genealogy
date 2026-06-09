# Validation Protocol

After writing to `research.json` or `tree.gedcomx.json`, follow these steps:

1. **Invoke `validate_research_schema`** to verify both files conform to
   the published schemas. If validation fails, fix the errors before
   proceeding. This tool also checks for genealogical impossibilities
   (married before 12, died after 120, child born after parent's death,
   etc.) and returns both errors and warnings in one call.

This is not auto-triggered — you must invoke it explicitly.
