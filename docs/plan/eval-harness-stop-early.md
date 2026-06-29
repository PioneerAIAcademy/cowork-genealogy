# Stopping the eval harness part-way — design

> Lets a genealogist/developer running the unit-test harness stop it with
> Ctrl-C the moment they see a failing test, instead of waiting for the
> whole skill suite to finish, **without losing the results that already
> ran**. Documents what shipped (the quick path) and the heavier refactor
> we deliberately deferred (the robust path), so we don't rediscover the
> design if the quick path proves insufficient.

## Problem

The harness (`eval/harness/run_tests.py`) runs a skill's tests through a
bounded thread pool and streams a `✓/✗ [n/total] … — outcome` line as each
test completes. A skill suite is minutes per test; a full `--skill` run can
be an hour or more. A tester watching the stream often knows after one red
line that they need to fix something and re-run — but before this change
there was no way to act on that:

- **No interrupt handling.** Ctrl-C raised `KeyboardInterrupt`, which
  unwound *past* the end-of-run write step, so **every completed test
  result was discarded**. Stopping meant the whole run so far was wasted.
- **All-or-nothing persistence.** Run logs were written once, at the very
  end. A crash or the SIGKILL-under-memory-pressure failure that
  `eval/CLAUDE.md` already warns about had the same effect: total loss.

## Mechanism background (why the quick path is cheap)

Three facts about the execution model, verified against the installed
`claude-agent-sdk`, decide the design:

1. **Threads can't be killed.** Tests run in a `ThreadPoolExecutor`; Python
   can't force-terminate a worker thread, and `future.cancel()` only drops
   *not-yet-started* futures. The only way to stop an in-flight test is to
   kill the `claude` CLI subprocess its worker is blocked on.
2. **One Ctrl-C already kills those subprocesses.** The SDK spawns `claude`
   via `anyio.open_process` with **no `start_new_session`**
   (`_internal/transport/subprocess_cli.py`), so the children sit in the
   harness's own process group. A terminal Ctrl-C is delivered by the OS to
   the entire foreground process group — every in-flight `claude` gets
   SIGINT directly and exits, independent of anything Python does. The SDK
   also registers an `atexit` SIGTERM sweep of tracked children as a
   backstop. (`query()`, which the harness uses, is documented as "No
   interrupts" — the in-band `interrupt()` only exists on the streaming
   `ClaudeSDKClient`, which we don't use.)
3. **In-flight tests have no result yet.** A test's entry is only produced
   when it finishes. So killing in-flight tests discards *unfinished* work,
   never a result — there is nothing to preserve about them.

Consequence: on the threaded path, a single Ctrl-C *is* the immediate kill.
The harness's only job is to **catch** the resulting `KeyboardInterrupt` so
it can save what finished instead of crashing. A second Ctrl-C is just an
escape hatch if the save path itself hangs.

## What shipped (the quick path)

Two pieces — incremental persistence (so a stop is never destructive) plus a
catch-and-flush handler (the human-facing control).

### C — incremental partial persistence

As each test completes, the runner rewrites a **partial envelope per skill**
to a dotfile `eval/runlogs/unit/<skill>/.partial_<ts>.json`:

- Helpers live in `eval/harness/harness/runlog.py`:
  `write_partial_runlog()` (atomic temp-file + `os.replace`, validates
  against the v2 schema, **overwrites** each call) and
  `promote_partial_to_scratch()` (renames the dotfile to a recognized
  `scratch_<ts>.json`).
- The dotfile name is deliberately **not** one `versioning.classify()`
  recognizes (it classifies as `other`), so it never participates in
  version numbering, active-state, or the release gate, and is `.gitignore`d.
- Snapshots and the judge hash the partial needs are computed once up front
  and reused for both the partial and the final write (snapshot captured at
  run start — skill files don't change mid-run, and that's the state the
  tests executed against).

This decouples *stopping* from *losing data*: a Ctrl-C, a crash, or a
SIGKILL all leave the completed tests in a valid envelope on disk.

### Catch-and-flush handler

The run loop in `run_tests.py` is wrapped in `try/except KeyboardInterrupt`:

- **First Ctrl-C:** the OS has already SIGINT'd the in-flight `claude`
  subprocesses (they exit); the handler sets `stop_submitting`, drops
  pending tests via `ex.shutdown(wait=False, cancel_futures=True)`, does a
  final partial flush, prints the summary of what ran, **promotes each
  partial dotfile to `scratch_<ts>.json`**, and returns exit code **130**
  (128 + SIGINT).
- **A run is never released from a partial.** Even a `--skill` (normally
  releasable) invocation that is interrupted writes only `scratch_`, never a
  `v{N}` candidate — an interrupted run is not a full-suite result.
- **Clean finish** is unchanged: the existing end-of-run write produces the
  releasable `v{N}_<ts>.json` (or `scratch_` for filtered runs), then the
  partial dotfiles are deleted.
- **Second Ctrl-C** (e.g. during the shutdown join) re-raises past `main()`;
  a guard in `__main__` exits 130 quietly instead of dumping a traceback.

### Tests

- `eval/harness/tests/unit/test_partial_runlog.py` — the writer/promote
  helpers (atomic overwrite, no leftover `.tmp`, dotfile stays unclassified,
  rename to scratch).
- `eval/harness/tests/unit/test_cli.py::test_ctrl_c_keeps_completed_tests_as_scratch_and_exits_130`
  — the integration wiring (interrupt mid-run → 1 completed test promoted to
  `scratch_`, no `v{N}` minted, dotfile gone, rc 130).

### Known limitation of the quick path

It leans on OS process-group signal delivery and the SDK's `atexit` sweep to
kill in-flight subprocesses. That is reliable on macOS/Linux. On **Windows**
(the genealogist team's platform) `CTRL_C_EVENT` reaching child console
processes is murkier. **Verify on a real Windows box.** If in-flight
`claude` processes are observed surviving a Ctrl-C there, that is the signal
to adopt the robust path below.

## The robust path (deferred — implement only if the quick path proves insufficient)

Run each test in a **child process the harness owns**, not just a thread, so
in-flight tests can be terminated deterministically and cross-platform.

- Replace the `ThreadPoolExecutor` of `run_one_test` calls with a
  `ProcessPoolExecutor` (or explicit `subprocess`/`multiprocessing`),
  spawning each worker with `start_new_session=True` (its own process
  group / session).
- On stop, the handler explicitly terminates each worker's process group
  (`os.killpg` on POSIX; `CTRL_BREAK_EVENT` / `TerminateProcess` on
  Windows) rather than relying on the terminal's implicit group delivery.

Trade-offs and notes:

- **Why it's more work.** `run_one_test` currently shares the parent's
  imports, auth object, and `OrchestratorPaths` in-process. Across a process
  boundary, inputs (the `TestSpec`, `auth`, `paths`, timestamp) must be
  picklable or reconstructed in the child, and each child re-imports the
  harness + re-resolves auth. The per-test entry dict comes back over the
  pickle channel (it already round-trips through JSON, so this is benign).
- **Inversion to be aware of.** Putting children in their own session means
  a terminal Ctrl-C **no longer** auto-kills them — the handler *must* signal
  the group itself. Same end-user outcome, but now it's our code doing the
  killing, not the OS. Don't ship the robust path without that explicit
  teardown or interrupts will hang.
- **What stays the same.** Incremental partial persistence (C) is
  transport-agnostic and unchanged; it's what makes any stop non-destructive
  regardless of thread-vs-process. The robust path only changes *how
  in-flight tests are killed*, not *how results are saved*.
- **Bonus.** Owned subprocesses also make the existing
  SIGKILL-under-memory-pressure failure recoverable per-test (a killed child
  is one lost test, caught as a worker error) rather than a process-wide
  hazard.

Decision: not built now. The quick path satisfies the request at a fraction
of the cost; the robust path is the known next step if Windows kill
reliability (or a future need for hard per-test timeouts) forces it.
