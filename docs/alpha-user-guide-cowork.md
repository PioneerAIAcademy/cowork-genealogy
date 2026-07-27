# Alpha Guide (Cowork) — researching with the Genealogy Workbench

> **For our alpha testers using Cowork** — the senior genealogists trying the
> workbench on real research, through Claude Desktop's Cowork tab. You do
> your own research, and when something goes wrong you tell us.

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

## Setting up

You need two things running side by side: **Cowork**, where you research, and
the **Research Viewer**, where you watch the research happen and send us
feedback. Cowork alone can't do the second part. Both are built from the same
repo checkout, so you set both up in one pass.

### 1. Clone the repo

**Windows:** install [GitHub Desktop](https://desktop.github.com/) — you
don't need to know git from the command line. Sign in, then **File → Clone
Repository**, choose **URL**, and paste:

```
https://github.com/pioneeraiacademy/cowork-genealogy
```

Pick a folder and click **Clone**. GitHub Desktop remembers the location —
when we tell you there's an update to test, come back to this same window
and click **Fetch origin** then **Pull origin** to pick it up, then repeat
step 3 below to rebuild.

**macOS/Linux:** if you're comfortable in a terminal, plain
[git](https://git-scm.com/downloads) is simplest:

```bash
git clone https://github.com/pioneeraiacademy/cowork-genealogy
cd cowork-genealogy
```

GitHub Desktop also has a macOS build if you'd rather use the GUI there too.

### 2. One-time dependency setup

**Windows:** double-click **`eval\Setup.bat`** in the repo folder. It
installs the tools the rest of these steps need (Node.js/pnpm and a couple
of small dependencies) — one-time, and safe to re-run later if something
looks broken.

**macOS/Linux:** install Node from [nodejs.org](https://nodejs.org/) (pick
the LTS installer) if you don't already have it, then from the repo folder:

```bash
corepack enable
```

That's it for one-time setup.

### 3. Build the MCP server and the Cowork plugin

**Windows:** two double-click scripts, from the repo folder:

- **`eval\BuildMcpb.bat`** — compiles the MCP server and produces
  `releases\genealogy-mcp.mcpb`.
- **`eval\BuildPlugin.bat`** — packs the skills into
  `releases\genealogy-plugin.zip`.

**macOS/Linux:** the same two builds, run directly, from the repo folder:

```bash
node scripts/build-mcpb.mjs      # -> releases/genealogy-mcp.mcpb
node scripts/package-plugin.mjs  # -> releases/genealogy-plugin.zip
```

Both scripts install what they need automatically. Re-run whichever one
after you pull a repo update (GitHub Desktop's **Fetch origin** / **Pull
origin**, or `git pull` from a terminal), so you're always testing current
code.

### 4. Install both in Claude Desktop

1. **The MCP server** — Claude Desktop → Settings → Extensions → Advanced
   Settings → Install extension → select `releases\genealogy-mcp.mcpb`.
2. **The Cowork plugin** — Claude Desktop → **Cowork tab** → Customize → Add
   → Upload Plugin → select `releases\genealogy-plugin.zip`. (Claude Code and
   Cowork keep separate plugin lists — make sure you're uploading from the
   Cowork tab, not the Code tab.)
3. **Fully quit and reopen Claude Desktop** after installing either one.

If you rebuild a newer plugin later, remove the old one in Cowork →
Customize first, then upload the new `.zip` — that's the reliable way to be
sure you're running the new skills.

Full step-by-step, including a Claude Code alternative if you ever need it,
is in the main `README.md` under
["Installation (for end users)"](../README.md#installation-for-end-users).

### 5. Launch the Research Viewer

**Windows:** double-click **`eval\Viewer.bat`** whenever you want to
research.

**macOS/Linux:** from the repo folder:

```bash
pnpm install                              # first time only
pnpm --filter @genealogy/electron dev
```

The first `pnpm install` fetches the Viewer's own dependencies (a few
minutes, one-time); after that, just re-run the second line whenever you
want to research. If it fails with something like `Error: Electron
uninstall`, run this once and try again:

```bash
pnpm --filter @genealogy/electron rebuild electron
```

Either way, it's a separate desktop app from Claude Desktop, so leave its
window open alongside Cowork. Use its **Open Project** button to point it at
the same project folder you're using in Cowork.

### Signing in to FamilySearch

There's no separate sign-in step for Cowork — start a project and ask the
agent to research something, and the first time it needs FamilySearch access
it will log you in itself (or you can say "log me in to FamilySearch" up
front). That opens a browser window for the FamilySearch OAuth screen and
stores the resulting tokens locally on your machine. You only need to do
this once; later sessions reuse the saved tokens automatically.

---

## Your first session

In **Cowork**, open a project folder (a new or existing folder) and tell the
agent what you'd like to research. The first time, it'll ask a couple of
quick setup questions before it starts.

Open that same folder in the **Research Viewer** too — via **Open Project**
— so you can watch it fill in live as you go (see "Watching it work" below).

### Choosing what to work on

Don't hand it your hardest brick wall.
What we need instead is a **research objective that tests a specific ability** and
whose answer is available by accessing FamilySearch records, full-text, or images.
There are two ways to set one up, and they behave differently.

#### Path A — your own research, not on FamilySearch

Use this when the answer lives in your files rather than in the FamilySearch tree.
You supply the starting point and the target, and the agent builds a local tree
from what you type.

In your first message, give it:

- **The starting point** — names, dates, places, and relationships you're confident
  in. This is what it reasons *from*.
- **The objective** — the specific question to answer. "Identify Mary Corrigan's
  parents"; "establish whether the John Byrne in the 1880 census is the same man as
  the one in the 1885 land record".
- **What you've already ruled out**, and why.

You know the answer; the agent has no way to look it up in the tree. That makes
this the cleanest test of whether it can actually *research*.

#### Path B — a FamilySearch person, with something removed

Use this when the case you want to test is already well documented on FamilySearch.
Give it a **PID**, and tell it **what to forget**:

> "Research PID KWZX-1AB. Forget who his parents were and see if you can find them
> from records."

It removes that information from the project's copy of the tree, shows you how many records
were removed from the project's copy, and researches from what's left. Three things to know:

- **Check the count before you say go.** Removing a *person* also removes their
  other links — forgetting a father can cut the siblings attached to him. Look at
  what would go before agreeing.
- **It won't be listed back to you.** The agent deliberately doesn't repeat what it
  removed; that would put the answer straight back in front of it. Confirm the gap
  in the viewer instead.
- **Live FamilySearch still holds the answer**, so it's also instructed not to look
  it up. That rule holds because it follows it, not because anything enforces it.
  If you catch it peeking, **that's a great piece of feedback.**

If you give a PID and remove *nothing*, the agent will often just read the answer
off the tree and you'll learn very little.

### Also tell it about you

Whichever path you take, include these two up front:

- **Your experience level** — just starting out / some research / experienced /
  professional.
- **Your subscriptions** — Ancestry, MyHeritage, FindMyPast, Newspapers.com,
  GenealogyBank, FindAGrave-Plus, or none.

Skip them and it quietly assumes "intermediate" and "none", which changes how much
it explains as it works. You can correct it later by just telling it, or by
editing `researcher_profile` in the project's `research.json` directly.

### Bringing in a document

Use Cowork's own file-attachment mechanism to bring in a scan from another
site, a county PDF, a photo of a family bible page — it lands in the project
and the agent reads it.

You'll need this for anything **not** on FamilySearch. FamilySearch's own
record images the agent fetches by itself; you don't need to upload those.

Anything you upload travels with your feedback by default, so a report about a
document arrives with the document attached. You can untick **"Include media
files"** on the feedback form (see below) if you'd rather not send it.

### Watching it work

The **Research Viewer**, open on the same project folder, fills in live —
research log, sources, assertions, conflicts, timelines — while you research
in Cowork. It's a separate window from Cowork's chat, so keep both up. Some
of the most valuable things you can ask the agent, in Cowork, any time:

- *"Why did you search there first?"*
- *"Why is that direct evidence rather than indirect?"*
- *"What would change your mind about this conclusion?"*
- *"You haven't looked at probate — why not?"*

---

## Sending feedback

Click **Send Feedback** in the **Research Viewer's** header — not in Cowork,
which has no feedback UI of its own. The Viewer bundles your project's
current state and your notes and sends them to us privately, the same as it
would for any project folder.

1. **What you asked the agent to do.**
2. **What the agent did.** What actually happened.
3. **What it should have done.** This is the one that turns a complaint into a
   fix.
4. **If it reached a wrong conclusion: the correct answer and its evidence.**
   Optional, and only relevant when the *answer* was wrong rather than the
   method. Fill it in and we can build a test from your case without coming
   back to ask you. Leave it blank when the problem was how it worked, not
   what it concluded.

There's also your email, and a free-text **Notes** box for anything that
doesn't fit the four.

**Send feedback while it's fresh**, right after it happened, from the Viewer
open on that same project folder — the bundle captures that folder's current
state, which is how we reproduce it.

> **What gets sent**, and the two checkboxes at the bottom of the form:
>
> - **Your project files** — always.
> - **"Include Claude Code session log"** — this captures a Claude Code
>   session transcript specifically, so it won't have anything to attach for
>   a Cowork session; leave it as-is.
> - **"Include media files"** — **ticked by default.** Documents and images you
>   uploaded, so a report about a document arrives with the document. Untick
>   it to leave them out. Very large bundles are trimmed automatically,
>   largest files first.
>
> Everything goes to a private Drive folder only the Pioneer Academy team can
> read.

### What makes a report we can act on

Small and specific beats broad. "The citation for the 1900 census had no page or
line number, so I couldn't find the record again" is worth more than "citations
are weak." One problem per submission.

---

## What doesn't work yet

Being straight with you, so you don't waste time:

- **You can't reset a project** through the agent — your project folder is
  just a directory on disk, so copy or archive it yourself if you want to
  retry from scratch.
- **Living people:** please don't enter information about anyone living. Nothing
  is encrypted yet.
- **Sessions are private to you.** No sharing or collaboration.

---

## When something goes wrong

| What you see | What's happening |
|---|---|
| Build/launch step fails or can't find a tool (Windows) | Run `eval\Setup.bat` first — those scripts need Node/pnpm in place, and Setup installs them. |
| Build/launch step fails or can't find a tool (macOS/Linux) | Confirm `node -v` shows 22 or higher and `corepack enable` succeeded (step 2) — that's the only prerequisite. |
| Viewer fails with `Error: Electron uninstall` (macOS/Linux) | Run `pnpm --filter @genealogy/electron rebuild electron` from the repo folder, then retry. |
| Plugin doesn't appear after uploading the `.zip` | Confirm you uploaded from the **Cowork** tab, not the Code tab — they keep separate plugin lists. Fully quit and reopen Claude Desktop after installing. |
| The agent says it can't reach FamilySearch | Ask it to log in again ("log me in to FamilySearch") — tokens may have expired or never been created on this machine. |
| The Research Viewer won't open your project folder | It needs a `research.json` in the folder to recognize it as a project — make sure the agent has run at least once (it creates this on your first message). |
| It stops mid-research | Say "continue". If it stalls again, that's worth reporting. |
| It's slow | Real research is genuinely slow — it reads records one at a time. Minutes is normal. |
| It asks who you want to research after you already said | It missed your first message. Repeat it with the details. |
| Something looks wrong genealogically | **That's the point — submit feedback.** |

Anything else, or anything alarming: send feedback and describe it. There is no
wrong report.

---

## What happens to your feedback

We unpack your case, open your project, and **continue the research from
exactly where you submitted the feedback** so we can watch the same thing
happen. Then we fix the cause and write a regression test so it can't come
back silently. That test is the durable result of your report — which is why
"what it should have done" matters so much.
