# Scenario: phipps-1860-household-member-extracted

The Phipps feedback-case project (issue #4670) as it stood after the first turn
of a headless replay on 2026-11-26: the router had extracted the records
attached to Benjamin Fairbanks Phipps (`I1`), built his timeline, and had
question-selection write the children question. The next message in that
replay was "Who would the Harriet Phillips be, in the 1860 census household?",
and the router answered it in conversation with no hand-off.

## State

- **The tree** is the session's starting tree, whole.
- **`q_001`** is the question that replay wrote (enumerative, `date_window`
  1849-1893, status `open`). There is no plan yet.
- **Kept from the extraction:** the four census sources, 1850 (`M68Y-B65`),
  1860 (`MHR9-JWT`), 1870 (`MN7R-N8P`) and 1880 (`MFZQ-VND`), with their
  assertions, person-evidence links and record-read log entries (log_024,
  log_025, log_027, log_034, with sidecars). Harriet appears as Harriet G Phipps
  (1850), Harriet Phillips (1860) and Harriet Phipps (1870).
- **Trimmed, to keep the size down:** the ten non-census sources and their
  assertions and links, the session's search log entries and sidecars
  (including log_019, the session's own read of the 1860 record, which no
  assertion references and which would otherwise route the router to
  extraction), the namesakes, and the timeline events that rested on trimmed
  assertions.
- **Added:** the two `localities` entries of `phipps-1860-household-member`
  (Windham, Connecticut and Worcester, Massachusetts), so a question with no
  plan is not first routed to a locality survey.

Checked: the engine validator passes on both files; every kept assertion,
person-evidence link and timeline event refers to a kept source or assertion.
Real data (deceased, public Family Tree persons); no scrub applied.
