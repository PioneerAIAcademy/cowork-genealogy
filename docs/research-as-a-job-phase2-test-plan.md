# Phase 2 — the manual test plan

**For:** testing PR #3262 (`research-as-a-job-phase2`) by hand, before un-draft.
**Written:** 2026-10-13. Supersedes the 2026-10-08 plan, which is now wrong in five
places — images, uploads, spend-resume, compaction state and collapsed-card identity
were all listed there as "not built, do not test" and all shipped on 2026-10-13.

This is the human half. The automated half is the four suites (`make server-test`,
`make engine-test`, `make harness-test`, `make test-js`) and they are green; none of
them can see a screen, which is what this plan is for.

---

## 0. There are two stacks, and the split is not cosmetic

Most of phase 2 is testable with **no Docker**. Reach for the prototype stack only for
the three things that genuinely need a blob store and a queue.

| Stack | Command | Covers | Needs Docker |
|---|---|---|---|
| **Alpha, mock** | `make server-mock` (:8000) + `make web-dev` (:5173) | §3 identifiers and collapsed identity, §5 off-plan group and the absence of the rail | **No** |
| **Alpha, real** | `make server` + `make web` (:1837 + :5173) | §1, §2, §4, the tab-close note — anything needing a real agent turn | **No**, but needs FamilySearch sign-in |
| **Prototype** | `make proto-up`, then `make proto-grant` once | §6–§8 — scans from the blob store, uploads, spend-resume | Yes |

`make dev` prints the alpha pair. Start there: it is faster, free of compose, and it is
the plane the hosted alpha actually runs.

**Two corrections from the 2026-10-13 Playwright pass**, both found by running it:

- **§5's four job states are prototype-only.** `job_state` is computed in
  `proto/web/job_state.py` and emitted by the prototype's `session_out`. The alpha's
  `/api/sessions` never sends it (`ProjectOut` has no such field) and the web client
  types it optional, so the list falls back to the sandbox `status` — you will see
  `active`, not `running`/`needs you`/`done`. That is the same plane split as
  spend-resume in §7, not a bug. Test the four states on the prototype.
- **§3's "chips sit where they happened" cannot be tested against `server-mock`.** The
  mock agent emits exactly one chip block and one paragraph per turn, which is the
  degenerate case: it looks identical whether chips are interleaved or stacked above.
  Use a real agent turn, or read `ChatPane`'s unit tests.

### Pre-flight

```sh
git switch research-as-a-job-phase2
git pull
make server          # terminal 1 — real agent + FamilySearch login, :1837
make web             # terminal 2 — Vite client, :5173
```

Sign in with FamilySearch (the alpha forces it; there is no dev-login on this path).

> **Cost.** §1–§6 are live agent turns on your subscription. Each bounded ask is short
> by design — that is what it is testing. Do **not** leave a run going unattended to
> "see what happens": `AUTO_CONTINUE` is off in alpha, so it will not run away, but a
> long research loop still bills. §7 is the one case that needs a deliberate spend, and
> §7 tells you how to get it for cents instead of $35.

---

## 1. A bounded ask stops (R4 — the `delivered` exit)

Ask for exactly one thing:

> *find me a death record for Patrick Flynn*

or

> *just give me a research plan and stop*

- **Pass:** the turn ends at the deliverable. The chat closes with *"Done, that's what
  you asked for. Send a message to carry on."*
- **Fail:** it carries on into a full research loop — building a tree, running to the
  proof or the spend cap. That is issue #2932's complaint and the entire reason R4 exists.

**Also test turn 1.** *"start a project on X and just give me a plan"* must also stop.
The delivery rule binds on the opening turn; only the router rule is exempt.

> Note: the **enforcement** half of this is PR #3372, still in review. Until it merges,
> a miss here is a known gap, not a new bug — check #3372 before filing.

## 2. "I need you" ends the turn as a question, not a failure

Give it something only you can answer — an ambiguous person, two equally good candidates.

- **Pass:** the turn ends and the question is rendered **as a question**.
- **Fail:** the run is marked `no_progress`, so it reads as the agent failing underneath
  its own question.

This is the one piece of R4's family that `main` does not have. Main has the outcome; it
has no carrier for it.

## 3. The reading experience — the big one

Open a session with a long completed run. Six things to look at:

1. **Chips sit where they happened**, interleaved with the prose — not stacked in a block
   above it.
2. **Identifiers are links.** Click a person or source id inside a paragraph; it opens
   that card.
3. **A tool chip opens the card it names.** Click a search-result chip.
4. **A chip's result belongs to the agent that produced it.** With several sub-agents in
   flight, no chip should show another agent's summary. (28 of 1,006 were cross-attributed
   before the fix.)
5. **Search-result chips open a body, not a 404.** Pick a search that *found* something —
   a 404 is still correct for a log entry that genuinely has no sidecar.
6. **Two searches of the same tool on the same day are distinguishable while collapsed.**
   Each row now carries a one-line identity from its query: who, then where, then when,
   capped at three parts. Before this they were identical on screen.

## 4. The two working-pause states

Both are about the screen not going silent while something is happening.

- **Compaction.** On any long run, the chat should show
  ***"Still here — organising what I have found so far…"*** — roughly three times per run,
  about two minutes each. Before this, that was ~6 minutes of blank screen per run, during
  which a working pause and a crash looked identical.
  - It is **cleared by the next event**, because the CLI announces a compaction's *start*
    and never its end. A notice that lingers after output resumes is a bug.
  - It ranks **below** reconnecting: if the connection drops mid-compaction you should see
    *"Reconnecting (attempt N of M)…"*, not the compaction line. A lost connection
    outranks a working pause.
- **Retry.** *"●●● Reconnecting (attempt N of M)…"* — this has shipped since PR #765 and
  was wrongly listed as deferred. Confirm it still works; do not treat it as new.

## 5. One view of job state, and the job outliving the tab

On the **session list**:

- **Four states only** — `new`, `running`, `needs you`, `done`, plus `stopped`.
- **There is no progress rail.** It was deleted deliberately: it read all-green on a
  looping run, because a stage counted as "done" forever once its section was non-empty.
  If you see a rail, you are on the wrong branch.
- **Off-plan work appears in its own group** rather than being invisible.

Then: start a long run, **close the tab**, come back.

- **Pass:** the run continued, and the chat says *"This keeps running if you close the
  tab, come back any time."*
- **Fail:** copy that promises a notification. The product cannot send one.

---

## 6. Scans and uploads

Both routes exist on **both** planes, but they read from different places — the alpha
from the sandbox filesystem, the prototype from the blob store. The blob-store path is
what phase 2 built, so test it on the prototype.

```sh
make proto-up                              # postgres, minio, elasticmq, worker, shim, web, tools
make proto-grant                           # ONCE per stack, after proto-up
make proto-seed FIXTURE=anders-monsen-ancestry
make proto-logs SERVICE=worker             # follow one service
```

- **A census page opens from the feed.** Open a session whose run fetched a record image
  and click through to the scan.
  - `GET /api/sessions/{id}/image?filename=images/<key>.jpg`
  - **Pass:** the image renders.
  - **A 404 is a real state** — most projects hold no scans. The thing to catch is a 404
    on a project that *does*. A name outside the `images/<key>.jpg` shape is a **400**,
    deliberately: a 404 there would tell a prober the path shape was accepted.
- **A PDF attached mid-run reaches the project.** Attach a PDF or a photo while a run is
  going.
  - `POST /api/sessions/{id}/files`
  - **Pass:** the agent can read it back at `uploads/<name>`. The worker's deny hook routes
    that prefix to `sidecar_read`, and a binary falls through to `image_transcribe`, which
    takes PDFs by magic bytes.
  - **Re-upload the same filename.** It should replace, not duplicate — the researcher's
    mental model is a folder.
- `.../logs` still answers **501 on purpose.** Sandbox logs are an operator debug surface
  and are not in phase 2's acceptance. Not a bug.

## 7. Spend-resume — prototype only, and this one is on purpose

> **Read this before hunting for the button on `make server`.** On the **alpha**, a
> session *is* a project (`ProjectOut.of(p: Project)`), so "continue on the same project"
> has no meaning there and `POST /{session_id}/resume` already does that job. Only the
> **prototype** separates sessions from projects, which is why the continue action exists
> there and cannot render on the alpha. Its absence on `make server` is correct.

Forcing a real $35 spend stop to see one button is not worth it. Use the bounds harness,
which injects usage over the cap after the first allow — one agent call, not a full run:

```sh
make proto-bounds CASE=cap_main
```

- **Pass:** the session stops at the spend bound, and the chat offers a **continue on the
  same project** action that opens a new session already bound to that project — one
  action, no copying ids.
- **Fail:** the run stops and the only way forward is to start a fresh project and lose
  the work.

`CASE=cap_main_real` lowers `SESSION_SPEND_CAP_USD` and lets the real meter fire. It is
the honest version and it is billed; `cap_main` is the one to use unless you are
specifically testing the meter.

## 8. Tearing down

```sh
make proto-down      # stops the stack AND drops volumes — the next up re-migrates
```

---

## What is NOT built — do not file these

- **Errands / `waiting`** (phase 3 item 2) — blocked on #1830, benter, still open.
- **"Three kinds of nothing"** — deferred by design; R5 pins it to phase 3's errand.
- **Sandbox logs** (`.../logs`) — 501 on purpose, see §6.
- **R2's live activation measurement** — needs `AUTO_CONTINUE` turned back on in the
  hosted alpha, which is the lead's call. Not testable locally and not yours to unblock.

## Known red that is not a bug

`apps/electron`'s suite exits 1 with *"Electron failed to install correctly"* — a missing
binary, not code.

## What to do with what you find

Per `CLAUDE.md`: fix it in this PR if you can (that is the right answer about two times in
three), drop it if it is a nit, comment on the issue that already covers it, and only file
a new issue if the work is big enough to carry four-person overhead. A finding here that is
a **tooling** defect goes to an MCP tool PR, not to a SKILL.md edit.
