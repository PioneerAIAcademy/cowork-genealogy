# Genealogy Research

> **Alpha.** This project is in alpha testing. Expect bugs and rough edges, and
> expect it to change often.

Family history research with Claude, using records that are online.

It is for anyone from a first-time family historian to a certified
genealogist. Ask it a question about your family and it plans the research,
searches online records and reads what it finds. It records every search and
every piece of evidence, and tells you how sure it is and why. It runs in
Claude Desktop's Cowork tab, using your FamilySearch account.

## What you can do

**Research a question start to finish.** Give it a goal in your own words, such
as "Who were John Smith's parents?" It plans, searches, reads the records,
weighs conflicting evidence, and writes a conclusion that says how sure it is
and why.

**Find records**

- **Plan your research** — the record sets to search, in order, and where to
  find them, without running any searches.
- **Search for records** — FamilySearch's indexed collections, full-text
  documents (deeds, wills, probate) and unindexed images. For Ancestry,
  MyHeritage, Find a Grave, Newspapers.com and other sites it builds the search
  for you to open; save the page as a PDF and upload it, and it reads that.
- **Find missing family members** — children and siblings your tree doesn't
  have, reported as candidates with the evidence for each.

**Read records**

- **Read old handwriting** — transcribes FamilySearch page scans, and reads the
  PDFs you upload.
- **Translate a record** in German, French, Spanish, Italian, Dutch, Latin or
  Portuguese, with old terms and abbreviations explained.
- **Build a timeline** — a life year by year from the records, showing the
  gaps and anything that doesn't fit one life.

**Check the FamilySearch tree**

- **Check a person's sources** — which attached sources hold an indexing error
  to correct, and which belong to someone else.
- **Check for impossible dates** — a death before a birth, a parent too young,
  an event after death.
- **Decide whether two people are the same**, with the evidence for and
  against.
- **Review FamilySearch hints** — a recommendation to accept or reject each
  hint on a person.

**Learn and get help**

- **Find out where the records are** for a place and period — what survives,
  where it's held, and what can substitute.
- **Get how-to answers** from the FamilySearch Research Wiki, with links to
  the pages used.
- **Understand the history** — boundary changes, migration, naming customs and
  old calendars.
- **Get your work reviewed** — a mentor reads your conclusion and tells you
  what would make it stronger.
- **Polish your citations** in Evidence Explained style.

## Known limits

- **Requires Claude Desktop.**
- **It searches only online records.** Records held only in courthouses,
  archives or libraries are out of its reach, so a conclusion can miss
  evidence they hold.
- **It's slow and uses a lot of your Claude plan.** A full research question
  usually takes over an hour. We're working on making it faster and on
  cutting the tokens it uses.
- **It doesn't change FamilySearch.** It works on a copy of the tree in your
  project folder; anything you want on FamilySearch, you change there
  yourself.
- **It reads at most 20 page scans from any one film in a project.**
- **Transcriptions of handwriting contain errors.** Check names, dates and
  numbers against the image before you rely on them. Old German script
  (Kurrent or Sütterlin) reads poorly.
- **Don't enter information about living people.** Nothing is encrypted yet.

## What you need

- **Claude Desktop** with the Cowork tab.
- **A FamilySearch account** (free). It asks you to sign in the first time it
  needs one.
- **An OpenRouter API key**, to read page scans. Get one at
  <https://openrouter.ai/keys>; you paste it in when you install. OpenRouter
  charges per use. Without a key it can't read page scans or transcribe
  FamilySearch memories, and hint reviews are less complete.

## Install

You install two files in Claude Desktop:

- **The MCP server** (`genealogy-mcp.mcpb`), a desktop extension. It does the
  searching and reading, so it runs on your computer, where it can reach the
  internet.
- **The plugin** (`genealogy-plugin.zip`). It teaches Claude the research
  method and runs inside Cowork.

### 1. Download both files

- [genealogy-mcp.mcpb](https://github.com/PioneerAIAcademy/cowork-genealogy/releases/download/cowork-latest/genealogy-mcp.mcpb)
- [genealogy-plugin.zip](https://github.com/PioneerAIAcademy/cowork-genealogy/releases/download/cowork-latest/genealogy-plugin.zip)

They are rebuilt every time the code changes. On a Mac, Safari may unzip the
plugin into a folder. You need the `.zip`, so if that happens, turn off Safari
→ Settings → General → **Open "safe" files after downloading** and download it
again.

### 2. Install the MCP server

Claude Desktop → **Settings** → **Extensions** → **Advanced Settings** →
**Install extension** → select `genealogy-mcp.mcpb`. Claude Desktop warns that
the extension isn't signed; allow it. Paste your OpenRouter key into the
**OpenRouter API key** field, or leave it blank. "Genealogy Research" appears in
your list of extensions; to add or change the key later, click it there.

### 3. Install the plugin

Claude Desktop → **Cowork** tab → **Customize** → **Add** → **Upload Plugin** →
select `genealogy-plugin.zip`. Upload it from the Cowork tab, not the Code tab;
the two keep separate plugin lists.

### 4. Restart Claude Desktop

Quit Claude Desktop completely and reopen it. Closing the window isn't enough.

### Updating

Download both files again and install both. The MCP server installs over the
old one. For the plugin, remove the old one in Cowork → Customize first, then
upload the new zip; uploading on top of the old one can leave old skills
behind. Then restart Claude Desktop.

### Building from source

To install a branch or your own changes, build the two files yourself. You need
Git (on Windows, [GitHub Desktop](https://desktop.github.com/)) and Node.js 22.9
or later from <https://nodejs.org>.

1. **Get the code.** macOS/Linux:

   ```bash
   git clone https://github.com/pioneeraiacademy/cowork-genealogy
   cd cowork-genealogy
   ```

   Windows: in GitHub Desktop, choose **File → Clone Repository → URL**, paste
   `https://github.com/pioneeraiacademy/cowork-genealogy`, set **Local path**
   to `C:\src\cowork-genealogy`, and click **Clone**. Don't clone into
   Documents or Desktop: they sync to OneDrive, which breaks the build.
2. **Get npm 11.12**, newer than the npm that comes with Node. Run this once.
   On Windows, run it in Command Prompt (Start → type `cmd`), not PowerShell.
   On macOS, put `sudo` in front if it fails with a permissions error.

   ```bash
   npm install -g npm@11.12.1
   ```
3. **Build.** macOS/Linux, from the repo folder:

   ```bash
   node scripts/build-mcpb.mjs       # MCP server → releases/genealogy-mcp.mcpb
   node scripts/package-plugin.mjs   # plugin     → releases/genealogy-plugin.zip
   ```

   Windows: double-click `eval\CoworkInstall.bat` in the repo folder. It runs
   the same two commands.

Then install the two files from the `releases` folder as in steps 2–4.

## Using it

In Cowork, open a folder for the project and say who you want to research and
what you want to find out:

> Start a project for Patrick Flynn, born about 1845 in Ireland. I want to
> find his parents.

If you know the person's FamilySearch ID, give that instead. Then:

- **`/research`** works the whole question: "/research find Patrick's parents".
- **Ask for one thing** and it does just that: "Make a research plan, but leave
  it at that", "Translate this German baptism", "Are these hints right?",
  "Where are the records for Schuylkill County, Pennsylvania?"
- **"Where are we?"** picks a project back up.

## A note on responsibility

These tools assist your research; they don't replace it. Every record, match
and conclusion is a starting point to check against the original sources. Weighing the
evidence is your job, not the tool's, so treat what it produces as a working
draft, not a citable conclusion.

## Contributing

- [docs/architecture.md](docs/architecture.md) — how the system fits together
  and where a change lands. Read it before your first PR.
- [DEVELOPMENT.md](DEVELOPMENT.md) — building, testing, adding tools and
  agents, the eval harness, and running the hosted web version.
- [CONTRIBUTING.md](CONTRIBUTING.md) — what contributions are welcome.
- [docs/catalog.md](docs/catalog.md) — every tool, skill and agent.

Run `make install-hooks` once per clone (Windows: double-click
`eval\InstallHooks.bat`).

## License

Apache 2.0 — see [LICENSE](LICENSE).
