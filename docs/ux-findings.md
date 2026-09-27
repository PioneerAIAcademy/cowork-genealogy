# UX findings — things to fix as we go

A running list from actually **using** the system rather than reading it. Each entry says
what was seen, whether it is real or an artifact of the environment it was seen in, and
whether it is worth fixing.

**Why this file exists.** Lead guidance, 2026-09-25: *"This project is more about improving
how you feel personally when using the project than following a strict plan… as you
actually use the system yourself, you should be able to improve the plan."* Nothing here
comes from reading code. It comes from the app being open.

**How to read the verdict column.** `fix` means a real user hits this. `artifact` means it
is an artefact of mock mode or a dev setup and tells you nothing about production.
`correct` means it looked wrong and is not.

---

## Open

### 1. Two Sources cards are indistinguishable — **fix**

Two entries in the Sources panel both read *"1880 Federal Census / 1880 U.S. Census,
household of the subject."* Nothing on the card face separates them. The only
distinguishing field is `Captured by: log_001` at the very bottom of the expanded card;
the collapsed one shows none of it.

Seen in mock mode, where the duplication is fake — **but near-identical sources are real in
production.** The live `bagley-father-1884` demo run hit
`sourceReuse: updated_existing`, and the agent wrote in its own narration that prior
assertions "are now duplicated and should be reviewed for cleanup."

So *"are these two the same record, or two records that look alike?"* is a question a real
researcher will ask of this panel, and it currently cannot answer it. A source card needs
something identifying above the fold — the log id, the access date, or an explicit
"same record as src_001" marker.

### 2. The progress rail contradicts itself — **understand first, then decide**

The rail reads `Init → Question Selection → Research Plan → Search Records → Extraction →
Analysis → Proof Summary`. *Research Plan* was highlighted as the current step while
*Search Records* and *Extraction*, both to its right, already showed filled dots — two
record searches had run.

Either the rail is not tracking real state, or "current" means something other than
"furthest reached". Worth establishing which before trusting it, because a progress
indicator that can point backwards is worse than none.

### 3. A cost meter on a run that cost nothing — **check, then fix or remove**

The header showed `~$0.0213` in **mock** mode, which makes no API calls at all. Either the
figure is invented — in which case showing it is worse than showing nothing — or something
is calling out that should not be. Both are worth knowing.

### 4. "Chat unavailable — couldn't reach the agent" is unactionable — **fix**

Hit during a remote-dev session. The control plane was healthy, the sandbox was listening,
and the token was valid — I connected with the user's own token from a shell while the
browser could not. The UI said only *"couldn't reach the agent"*; the browser console said
`WebSocket connection to 'ws://127.0.0.1:51627/?token=…' failed:` with no reason.

The real cause was that the browser was on a different machine over SSH, and the sandbox's
**random per-session port** was not tunnelled. Diagnosing it took a process table and
`SSH_CONNECTION`. Nothing in the product pointed at a port.

Two separable things:

- **The message carries no diagnosis.** It cannot distinguish "sandbox is dead" from
  "sandbox is fine and unreachable from here", which are different problems with different
  fixes.
- **The architecture assumes browser and sandbox share a host.** `/connect` hands the
  browser a raw `ws://127.0.0.1:<random>` (`app/sandbox/local.py` binds
  `("127.0.0.1", 0)`). That is deliberate — the stream bypasses the control plane — and it
  silently breaks every remote-dev setup. A pinnable dev port, or proxying the WS through
  the control plane, would remove a whole class of "it just hangs" reports.

### 5. Retrying 20 times with nothing on screen — **fix**

`SessionConnection.ts` retries up to `MAX_RETRIES = 20` before surfacing an error. Sitting
through that is a placeholder that never changes: no attempt counter, no "still trying",
no elapsed time. The code already knows this is bad — a comment describes the panel
sitting on *"Connecting to the agent…"* indefinitely as a failure mode it is trying to
remove.

Waiting is fine. Waiting with no evidence that anything is happening is not.

### 6. Leaked sandbox processes — **fix (dev hygiene)**

Nine `app.sandbox_server` processes were still running from earlier runs, one **17 days**
old. Local sandboxes are not reaped when their session ends or when the control plane
restarts. On a dev box this is just clutter; it also makes "is my sandbox running?"
unanswerable by `pgrep`.

---

## Closed / not a defect

### Three chat messages produced one research question — **correct**

A question is a *research question*, not a message. One objective produces one opening
question, and `question-selection` adds more only as the research demands. Three messages
producing three questions would be the bug.

### Asked for the 1850 census, got 1880 — **artifact**

`mock_agent.py` hardcodes the citation (`1880 Federal Census`), the query
(`surname: Flynn, birthPlace: Pennsylvania`) and the returned person (`Patrick Flynn`)
regardless of input. It matches only a keyword (`search`/`record`/`find`/`census`/`look`)
and ignores the rest of the message.

Consequence worth remembering: **mock mode cannot tell you anything about search quality or
whether results match the request.** Judge layout, labelling and navigation here; use
`make server-dev` for anything about what the agent actually does.

### Two assertions that are identical — **artifact**

Each mock search appends the same assertion (`Birth, 1845, Pennsylvania`), with only the id
changing. Two real records would differ.

---

## How to reproduce this setup

```
make server-mock     # FastAPI :8000 — mock agent, dev-login, local sandbox, no keys
make web-dev         # Vite :5173  — open http://127.0.0.1:5173 (NOT localhost:
                     #               localhost resolves to ::1, vite binds 127.0.0.1)
```

Sign in with any email. Then: state an objective, and say **"search for census records"** to
make it run a search.

If the browser is not on the same machine as the server, see finding 4 — the WebSocket will
fail and the UI will not tell you why.
