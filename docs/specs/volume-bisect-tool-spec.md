# `volume_bisect` tool spec

Bisect a browse-only image volume toward a target year, one probe per call.

## 1. Overview

A browse volume has no index. Reaching a target year inside a 749-image register
currently has no tool behind it: the agent samples image numbers by eye and
interpolates in prose. The committed corpus records where that leads — one run made
**58 `image_transcribe` calls** bisecting a single image group with no give-up
condition, until it burned the harness wall-clock cap with no proof written
(`image-transcribe-tool-spec.md` §5.8). Another examined roughly the first third of
a 749-image volume and stopped, never reaching the page holding its answer.

`volume_bisect` owns the probe sequence instead. Given a sub-volume, a target year
and the readings so far, it reads **one** page, folds that year into the bracket,
and returns the narrowed bracket with the next image to probe.

## 2. Why one probe per call

The alternative was a host-side loop that ran the whole bisect in one call. It was
rejected on an environment constraint, and the reasoning is recorded here so the
next reader does not re-derive it.

**Cowork's device bridge aborts every MCP call at 60s.** Ten sequential OCR probes
is p50 ~190s. A looping call would therefore be aborted with its result discarded
in the one environment the plugin ships into — and no CI job or harness can observe
that, because the ceiling exists only on the bridged path
(`docs/architecture.md`, "Other environment differences that bite").

**The accepted cost.** A stateless tool returns a next probe the agent is free to
ignore, and on this path advisory return-fields have been measured as ineffective:
in the `elena-asmundsdotter-origin` run of 2026-09-01 (`run-2026-09-01_22-19-45`)
the browse-budget advisory **fired 9 times and changed behaviour 0 times** — the
agent made 22 more transcribes afterwards, 9 of them in the same group. That is the
known weakness of this shape, not a reason to prefer the loop: the loop does not
survive the bridge at all.

**What this tool does not fix.** On the run that motivates it, the agent never
searched for a *death* — the finding it needed is a 1745 death entry. A bisect
would not have moved that run by itself. Anyone measuring this tool by whether it
alone turns a fixture green will measure it wrong.

## 3. Input

| field | type | required | notes |
|---|---|---|---|
| `imageGroupNumber` | string | yes | A **split Natural Group** name, `{prefix}_{part}_{naturalId}` (e.g. `004516861_001_M9S4-SQB`), from `volume_search`. |
| `targetYear` | integer | yes | 1500–1950 (§6). |
| `readings` | Reading[] | no | Probes so far. Empty on the first call. |
| `projectPath` | string | no | Charges the browse budget to this project (§7). |

A `Reading` is `{ position: integer, imageId: string, year: integer | null }`.

**A bare prefix is refused.** `004516861` names a whole film, which is a
concatenation of bound books — year is **not monotone** across it. Measured on
group `004516861`: image 122 reads 1849 while image 257 reads 1685. A plain bisect
for a year in the 1690s walks 322 → 161 → 80 → 40 → 20 → 10 and converges on the
volume's cover, with a locally consistent reading at every step, so "terminate on a
non-monotonic reading" does not catch it. The refusal names `volume_search` as the
way to get a sub-volume name.

**`year: null` means probed, no year found.** It is not optional bookkeeping: the
tool is stateless, so its next probe is a function of `(imageGroupNumber,
targetYear, readings)`. Without a way to record that a position was probed and
yielded nothing, a blank leaf leaves the bracket and the readings unchanged, the
next call recomputes the identical midpoint, and the tool re-reads one image
forever — rebuilding the 58-call hunt inside the tool written to end it.

**`imageId` is carried and re-checked.** Positions are not stable across calls:
`image_search`'s null-drop defect shortens the returned list and shifts every later
position. On a mismatch against `imageIds[position]` the tool refuses with
*"the volume list changed between calls, re-seed"* rather than folding a year in at
a position that now names a different page.

## 4. Output

| field | notes |
|---|---|
| `bracket` | `{ lowPosition, lowYear, highPosition, highYear }` — narrowed, never a bare index. |
| `confidence` | `converging` / `inconclusive` / `non-monotonic` / `resolved`. |
| `nextImageId` | The image to read next, or absent when the tool has stopped. |
| `reading` | The probe this call took, for the caller to echo into `readings`. |
| `browseBudget` | Relayed when the budget fires (§7). |
| `stopped` | Present with a reason when the tool declines to continue. |

## 5. The probe

One OCR read per call, through the shared `runOcr` (`src/utils/ocr.ts`), with a
**year-only prompt** rather than the full-page transcription prompt:

> Read only the year this register page covers. Look for a year heading, a column
> header, or the year written at the head of the first entry. Reply with that year
> as four digits and nothing else. If the page shows no year — a cover, a blank
> leaf, an index, a filming target card — reply exactly NO YEAR.

The prompt is a contract and lives here rather than in the plan, because the
acceptance tests mock `runOcr` and will never exercise it. The "never
caller-supplied" rule in `image-transcribe-tool-spec.md` is about the **MCP
boundary** — an LLM cannot reach this string — not about an in-process caller.

## 6. Reading a year out of the probe

Scan maximal digit runs left to right; take **the first whose value is in
1500–1950**; ignore runs outside that range. Not "the first run, rejected if out of
range" — the two differ on any page whose heading follows a page number. Never
`Number.parseInt`, which reads `16` out of `"16xx"` (the discipline
`volume-search.ts`'s `leadingYear` already follows).

**Why the 1950 ceiling is load-bearing.** Every archival target card on this film
carries the filming stamp *"DEC 2 . 1952 / THE GENEALOGICAL SOCIETY UTAH"* —
verified on `004516861_00122`, whose card also reads "IN- OCH UTFLYTTNINGSLÄNGD
1849 - 62". A ceiling above 1950 reads **1952** as the page year on every title card
in the corpus. Do not widen the range without re-checking that.

**No year found** → the bracket does not move; return `reading.year: null` and
`confidence: inconclusive`; probe **the first position not already in `readings`,
stepping outward from the midpoint**, so a run of blank leaves walks rather than
re-probing one image. **Stop after 3 consecutive null-year readings** and return the
bracket.

**A non-monotonic reading** — a probe whose year contradicts the bracket it falls
inside — stops the bisect with `confidence: non-monotonic`, naming the disagreeing
pair. It does not keep halving: inside one sub-volume a contradiction means the
year headings are not resolving the volume, and another probe cannot fix that.

## 7. The browse budget

Probes charge the **same** counter as `image_transcribe`, via
`src/utils/browse-budget.ts`. A hunt that alternates between the two tools must be
visible to one bound or the bound means nothing.

Two consequences worth stating:

- **The counter is keyed on the bare prefix** (`imageId.split("_")[0]`), so every
  sub-volume of one film shares a bucket, while this tool's input domain is the
  sub-volume. That is correct — the budget should see the whole film — but it is
  surprising enough to say.
- **The threshold of 20 was calibrated for one producer.** It was derived from
  `image_transcribe` distinct-image counts alone over the committed corpus. With a
  second producer it is reached sooner; re-measure before changing the constant.

The advisory this tool relays is **not** the transcription one. That text says
"page-by-page browsing rarely pays past this point … pivot to the indexed route",
which is sound against a hand-hunt and wrong against a bisect that is converging.
The bisect advisory reports the spend and points at the bracket instead.

Probes must pass `imageId`, never `ark`: an ARK carries no image-group number, so
an ark-driven read never advances the budget.

## 8. Timeouts — a three-leg budget under 60s

Cowork aborts at 60s, so all three legs are bounded to fit, not just the OCR:

| leg | default | here | why |
|---|---|---|---|
| `image_search` | 30s per attempt, ×2 on the null-drop defect retry | **10s** | the default would spend the whole ceiling on the resolve alone |
| image download | 90s per attempt, plus a fallback attempt | **15s** | a hang-catcher sized for a multi-MB scan, not for a probe |
| OCR | 180s | **20s** | a year-only answer is a few output tokens |

Worst case ≈ 55s, inside the ceiling.

**These are bounds, not measurements.** The 20s OCR figure is reasoned from the
full-page whole-call p50 of 18.7s — a year-only prompt returns a handful of output
tokens against a full page's ~1.6k, so it should sit well under — but it has not
been measured for this prompt. Measure it with `dev/try-volume-bisect.ts` against
the corpus before treating it as a latency budget.

**The trade this makes, deliberately.** Bounding a leg means a slow-but-genuine
read is *aborted* rather than completed — the opposite of `image_transcribe`'s 180s
hang-catcher. That is right for a probe and wrong for a transcription: a bisect that
loses one midpoint probes again, where a transcription that loses a page loses the
evidence.

## 9. Seeding the bracket

From the sub-volume's **own first and last readings**, never from `volume_search`'s
date range. All four sub-volumes of `004514824` return the same coverage — that is a
catalogue span, not a register span, and seeding from it puts the bracket outside
the book.

## 10. What nothing checks

No test can confirm that a probe's year is the page's true year, or that a bracket
names the right book. The acceptance tests mock `runOcr` and measure bracket
narrowing, refusal and termination. The reading layer is covered by
`image-transcribe-tool-spec.md`; the volume-to-year mapping is not covered anywhere.

**No agent can call it on merge.** `agents/search-images.md` carries an explicit
`tools:` list, entries are matched exactly, and this tool is not on it — so the one
agent that does exactly this browsing work is left hand-probing while a green CI
reports a shipped tool. Nothing detects that: `agent-tool-names.test.ts` pins the
lists that exist against a snapshot, and no check asserts a *new* tool reached any
agent. The wiring belongs with whoever next edits that agent, because every edit
to it has to buy the same `make eval-skill SKILL=search-images` run: the skill
body carries `@plugin:search-images`, so the agent is inside the skill's eval
snapshot and touching it stales the skill's run log.

**The three-leg budget in §8 is bounds, not measurements.** 10s + 15s + 20s was
chosen to sum under Cowork's 60s bridge abort, not derived from observed latency,
and no CI job can observe that ceiling — it exists only on the bridged path. A
sub-volume whose `image_search` leg is slower than 10s fails with a timeout that
reads like an outage. Re-derive them from `dev/try-volume-bisect.ts` against a real
volume before treating any of the three as measured.
