# plan-subject-from-tree

A question about the project's subject, whose tree entry carries an `ark`. Synthetic ids
(`ZZKR-*`); issue #3384 step 3.

## Why it exists

`project_create` builds the starting tree from the subject's full FamilySearch read, so a
question about the subject is planned from the project tree. Re-reading her profile repeats
the fetch and the memory OCR, and on a large profile it spills. Every person carries an
`ark`, the shape `project_create` writes; this and `plan-reads-question-person-profile` are
the only research-plan scenarios where one does.

## Notes for reviewers

The tree is `plan-reads-question-person-profile`'s, unchanged: Bridget Kerrigan (I1) is the
subject, born 1871 in Pottsville, with her parents Thomas Kerrigan (I2) and Ellen Burke
(I3). The fixture `person-read-kerrigan-subject` holds exactly what the tree holds for
her, so a re-read adds nothing; it stays loaded so that a re-read is matched and the
`subject-from-tree` validator sees it. Keep the subject's tree entry and that fixture
identical; the scenario's premise depends on it.
