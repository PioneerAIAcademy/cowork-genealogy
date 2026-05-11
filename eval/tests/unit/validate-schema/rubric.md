# Validate Schema Rubric

## Dimensions

### Error detection
Did the skill detect all schema violations in the input files? Missing required fields, invalid enum values, and broken ID references should all be caught.

### Error clarity
Are error messages specific enough to locate and fix the problem? Each error should identify the section, field, and what's wrong.

### False positive rate
Did the skill avoid flagging valid data as errors? Legitimate patterns (null optional fields, empty arrays, valid open enum values) should not trigger warnings.
