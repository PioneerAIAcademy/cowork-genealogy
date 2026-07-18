# Alpha Guide — researching with the Genealogy Workbench

> **For our alpha testers** — the senior genealogists trying the workbench on
> real research. You do your own research in a browser, and when something goes
> wrong you tell us. That's the whole job. Nothing to install, no repository, no
> command line.
>
> Keep this open for your first couple of sessions.

**Where it lives:** <https://genealogy-workbench.fly.dev>

## Your job, and ours

| You | Us |
|---|---|
| Research real questions and judge the work as a genealogist. | Read every piece of feedback. |
| Tell us when the agent gets it wrong — or gets it right badly. | Reproduce it, fix it, and write a test so it stays fixed. |
| Say what it *should* have done. | Ship the fix and tell you what changed. |

You are the only person who can tell us whether the reasoning is sound. Wrong
answers are useful; **plausible-looking wrong answers are the most useful thing
you can find**, because those are what would quietly corrupt a real tree.

---

## Signing in

Sign in with your **FamilySearch account**. That one sign-in does two jobs: it
gets you into the app, and it gives the agent the FamilySearch access it needs to
search records on your behalf. There's no second "connect" step.

> ⚠️ **We allowlist the email on your FamilySearch account** — which is often
> *not* the email you gave us. If you get a page saying your address isn't
> permitted, it will name the address it saw. Send us that address and we'll add
> it.

---

## Start here: open the sample project

Before spending anything, click **Open a sample project**. It loads a finished
research project (the Patrick Flynn case) into the viewer so you can see how the
workbench lays out a research log, assertions, conflicts, sources and a proof
summary. Nothing runs; it costs nothing. Five minutes here makes everything
after it clearer.

---

## Your first real session

Click **+ New research session**. The agent opens by asking what you'd like to
research.

### Put everything in your first reply

The setup runs in **one pass** — it won't interview you question by question. So
your first message should carry everything you already know:

- **Who you're researching.** A FamilySearch person ID (PID) is best. A name
  with dates and places works too. If the person isn't on FamilySearch at all,
  just describe them — the agent builds a local tree from what you type.
- **Everything you already have.** Names, dates, places, relationships, what
  family members have told you, what you've already searched and ruled out.
- **Your experience level** — just starting out / some research / experienced /
  professional.
- **Your subscriptions** — Ancestry, MyHeritage, FindMyPast, Newspapers.com,
  GenealogyBank, FindAGrave-Plus, or none.

If you skip the last two it will quietly assume "intermediate" and "none", which
changes how much it explains as it works. You can correct it later, but it's
easier to say up front.

**Pick a real brick wall.** The best test is a question you genuinely haven't
answered. If you pick someone whose tree is already complete on FamilySearch, the
agent may simply read the answer off the tree and you'll learn very little about
whether it can research.

### Bringing in a document

Click the **📎** button beside the message box to upload a document or image —
a scan from another site, a county PDF, a photo of a family bible page. It lands
in the project and the agent reads it.

You'll need this for anything **not** on FamilySearch. FamilySearch's own record
images the agent fetches by itself; you don't need to upload those.

### Practising on a question you've already solved

If you want to test the agent against an answer you already know, ask it to
**forget** what's in the tree and work it out again:

> "Forget who John's parents were and see if you can find them from records."

It will remove that information from the project's copy of the tree, show you a
count of what went, and then research it. Two things to know:

- **Check the count before you say go.** Removing a *person* also removes their
  other links. Forgetting a father can also cut the siblings attached to him.
  The agent will show you what would go; look before agreeing.
- **It won't be listed back to you.** The agent deliberately doesn't repeat what
  it removed — that would put the answer straight back in front of it. Confirm
  the gap in the viewer instead.
- Live FamilySearch still holds the answer, so the agent is also instructed not
  to look it up. That rule holds because it follows it, not because anything
  enforces it. If you catch it peeking, **that's a great piece of feedback.**

### Watching it work

The viewer fills in live beside the chat — research log, sources, assertions,
conflicts, timelines. Interrupt whenever you like. Some of the most valuable
things you can ask:

- *"Why did you search there first?"*
- *"Why is that direct evidence rather than indirect?"*
- *"What would change your mind about this conclusion?"*
- *"You haven't looked at probate — why not?"*

The **cost of the session so far** shows in the header. It's there so nothing
surprises you. (It counts from when the page loaded, so a refresh restarts it.)

---

## Sending feedback

Click **Submit feedback** in the viewer. It bundles the project state and your
notes and sends them to us privately.

The form asks four things, and the middle two are what make a report usable:

1. **What you asked the agent to do.**
2. **What the agent did.** What actually happened.
3. **What it should have done.** This is the one that turns a complaint into a
   fix.
4. **If it reached a wrong conclusion: the correct answer and its evidence.**
   Optional, and only relevant when the *answer* was wrong rather than the
   method. Fill it in and we can build a test from your case without coming back
   to ask you. Leave it blank when the problem was how it worked, not what it
   concluded.

**Send feedback while it's fresh**, in the session where it happened — the
bundle captures that project's state, which is how we reproduce it.

> **What gets sent:** your project files, and (if you leave the box ticked) the
> session transcript — your prompts, the agent's replies and its internal
> reasoning, and every tool call with its results. The reasoning is the single
> most useful part for diagnosing *why* it went wrong. It goes to a private
> Drive folder only the Pioneer Academy team can read. Untick the box if a
> session contains anything you'd rather not share.

### What makes a report we can act on

Small and specific beats broad. "The citation for the 1900 census had no page or
line number, so I couldn't find the record again" is worth more than "citations
are weak." One problem per submission.

---

## What doesn't work yet

Being straight with you, so you don't waste time:

- **No GEDCOM import.** You can't upload a tree file. Type what you know, or
  give a PID.
- **The cost figure restarts when you reload the page.** It's per page-load, not
  per session.
- **Only one model.** No model picker during the alpha.
- **You can't reset a project.** To start over, create a new session.
- **Living people:** please don't enter information about anyone living. Nothing
  is encrypted at rest yet.
- **Sessions are private to you.** No sharing or collaboration yet.

---

## When something goes wrong

| What you see | What's happening |
|---|---|
| "Your address isn't permitted" | We allowlisted a different address. Send us the one on the page — it's the email on your FamilySearch account. |
| The agent says it can't reach FamilySearch | Its access may have gone stale on an older session. Start a new session; tell us if it keeps happening. |
| It stops mid-research | Say "continue". If it stalls again, that's worth reporting. |
| It's slow | Real research is genuinely slow — it reads records one at a time. Minutes is normal. |
| A wiki page lookup fails | Known; tell us what you were doing. |
| It asks who you want to research after you already said | It missed your first message. Repeat it with the details. |
| Something looks wrong genealogically | **That's the point — submit feedback.** |

Anything else, or anything alarming: send feedback and describe it. There is no
wrong report.

---

## What happens to your feedback

We unpack your case, open your project, and **continue the research from exactly
where you left off** to watch the same thing happen. Then we fix the cause and
write a regression test so it can't come back silently. That test is the durable
result of your report — which is why "what it should have done" matters so much.

The developer-facing version of that loop is
[`e2e-testing-guide.md`](e2e-testing-guide.md); a worked example of one report
becoming a fix is [`alpha-feedback-example.md`](alpha-feedback-example.md).
