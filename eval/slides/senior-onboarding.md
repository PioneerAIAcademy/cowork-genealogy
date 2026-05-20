---
marp: true
theme: default
paginate: true
---

<!--
Senior Genealogist onboarding deck.
Render:  npx @marp-team/marp-cli@latest senior-onboarding.md -o senior-onboarding.pdf
   HTML:  npx @marp-team/marp-cli@latest senior-onboarding.md -o senior-onboarding.html
-->

<!-- _class: lead -->
<!-- _paginate: false -->

# Senior Genealogist Onboarding

Building & grading the skill evaluation

**Cowork Genealogy · May 2026**

---

## What we're building

- An AI family history consultant
- Custom **skills** and **tools** added to Claude Cowork — a desktop app for Claude
- Skills do the genealogy work: research planning, record extraction, locality guides, and ~20 more

---

## How we test a skill

- Each skill has **tests**, **scenarios**, and **fixtures**
- A **test harness** runs every test for a skill
- An **AI judge** grades how well the skill performed on each test
- Grades are per-dimension: **1 = fail · 2 = partial · 3 = pass**

---

## Why we need genealogists

- The AI judge is fast but **not reliable** on genealogical judgment calls
- Experts review each run and **correct** the AI's grades
- Those corrections also **train the judge** to get better over time
- This is where your expertise comes in

---

## The review UI

- A web app that shows every test run
- For each test: the skill's input, the tool calls, the skill's output
- For each grade: the AI's score, its reasoning, and a picker for **your correction**
- You'll spend most of your time here

---

## Where this is heading (long-term)

- **Junior genealogists + devs** — author tests, run the harness, correct grades, submit PRs
- **Senior genealogists** — recommend tests, review junior corrections, release versions
- A steady pipeline that keeps all ~23 skills well-tested

---

## This week — your task

- We're hiring the junior genealogist team
- The two of you will build the **assessment** that decides who we keep
- Details in a few slides — first, let's get set up

---

<!-- _class: lead -->

# Getting Started

---

## Getting set up

One-time install:

- **Git** + **GitHub Desktop** — get the project files
- **Node.js** — runs the review UI
- **uv** — runs the test harness
- The **repo**, then run **Setup.bat** — installs everything + saves your API key

We'll do this together in the walkthrough.

---

## Grading vocabulary

- Every test is graded on several **dimensions**
- **Base dimensions** (always): Correctness, Completeness, Tool Arguments
- **Rubric dimensions**: 3–5 skill-specific checks
- Each dimension: **1 (fail) · 2 (partial) · 3 (pass)**
- "Agree with all" marks a whole test reviewed in one click

---

## Running the test harness

- `RunTests.bat` → pick a skill
- Runs every test for that skill, ~30 sec each
- The AI judge grades each run
- Produces a **run log** — the file the review UI reads
- This week the junior devs run it for you; you can also run it yourself

---

## Using the review UI

- `Start.bat` opens the app in your browser
- Pick a skill → pick a run → review each test
- Set the score you think is right; add a one-line comment if you disagree
- The header tracks progress — e.g. `12/40 reviewed`
- Live walkthrough after these slides

---

<!-- _class: lead -->

# Your task this week

---

## The goal

- Build the **onboarding assessment** for junior genealogist applicants
- It decides which **10** join the team
- Your work this week becomes the **answer key** for that assessment

---

## How it fits together

1. Junior devs run the harness on assigned skills, post the run logs
2. You copy the run logs to your laptop
3. **Both of you grade every test, all 23 skills**
4. You pick **5 skills** for the assessment
5. You agree on the exact corrected grades for those 5
6. Applicants grade the same 5 → measured against your answer key → **top 10 kept**

---

## Your grades are the answer key

- Every applicant is measured against the grades **the two of you agree on**
- Strong applicants will match a careful, defensible answer key
- A sloppy answer key selects the wrong people
- **Grade carefully — this is the most important thing this week**

---

## Phase A — grade everything

- Each of you **independently** grades every test across all 23 skills
- Grade independently so the Phase B reconciliation is meaningful
- The other 18 skills aren't wasted — those grades feed judge calibration later

---

## Selecting the 5 skills

Pick 5 skills where:

- The two of you can reach a **confident shared answer key**
- The AI's grades **genuinely needed correcting**
- Judging correctly **requires genealogical expertise**
- Together they **span skill types** — reasoning, extraction, lookup
- Skip tests so ambiguous even the two of you can't agree

---

## Phase B — agree the answer key

- For the 5 selected skills, walk through **every** disagreement between you
- Reconcile each one into a single agreed grade
- Result: one answer key the whole assessment rests on

---

## Deliverable & dates

- **Deliverable:** 5 selected skills + the agreed answer key
- **Decision deadline:** Tuesday, May 26
- **Juniors start:** Wednesday, May 27
- **Daily standup:** 8:30am, 15–30 min, starting Monday, May 25

---

<!-- _class: lead -->

# Questions?

Next: hands-on walkthrough — install, harness, review UI

Daily standup starts Monday
