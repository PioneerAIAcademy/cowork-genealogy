# flynn-competing-fathers-parentage

Fork of `flynn-competing-fathers` (issue #2525) adding one record, so each
candidate father has a parentage assertion of his own:

- **src_008 / S8, log_009:** an 1845 baptism at St. Nicholas Church,
  Wilkes-Barre, Luzerne County: Patrick, son of Thomas Flynn and Mary.
- **a_018:** the baptism's `relationship` assertion, "Father: Thomas Flynn".
- **pe_010:** a_018 linked to I3, the Luzerne Thomas, at `speculative`, on place.

Everything else is the parent scenario unchanged. I2 (Thomas of Schuylkill) is
already Patrick's father through R1, sourced S1, S2 and S3 (a_004, a_010,
a_013). Adding I3 as a second father is the write the tree writers now refuse
with a `conflicts_surfaced` entry.

The parent scenario is left untouched because seven tests in three other suites
use it, and editing it would stale each of those snapshots.

Used by: ut_conflict_resolution_017 (a ParentChild conflict surfaced by a
writer).
