# every-mention-czelusniak-survey

Marianna Czelusniak (`I1`, b. about 1822, Lipinki, Gorlice, Województwo Rzeszów,
Polska; m. 15 May 1843) has no parents or siblings in the tree yet. One open
question (`q_001`) and one active plan (`pl_001`) with a single planned item
(`pli_001`) target FamilySearch's indexed Poland, Church Books collection
(4135958, image group 004118433), covering the Wójtowa, Pagorzyna and Lipinki
parishes — an every-mention survey of the surname Czelusniak, not a search for
Marianna's own record.

The plan item's own `rationale` says plainly that the collection is indexed
and searchable with `record_search`, not a browse-only volume — this is
deliberate: an earlier wording ("digitized... DGS 004118433") sent `research`'s
router to `search-images` instead of `search-records` (issue #4348). Any
rewording of this scenario's `rationale` fields must keep that indexed-search
framing.

No searches have been logged yet (`log: []`) — this scenario starts right
before `search-records` executes `pli_001`.

Use when: testing that a caller relaying a `search-records` every-mention
survey hand-back (issue #4348) — never calls it complete or "every occurrence",
keeps the hand-back's own coverage caveats (the godparent/witness gap, the
per-parish split the index can't make), and doesn't overclaim the hits as
ready for extraction.
