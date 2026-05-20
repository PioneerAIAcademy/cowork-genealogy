---
marp: true
theme: default
paginate: true
---

<!--
Junior Genealogist onboarding deck.
Render:  npx @marp-team/marp-cli@latest junior-onboarding.md -o junior-onboarding.pdf
   HTML:  npx @marp-team/marp-cli@latest junior-onboarding.md -o junior-onboarding.html
-->

<!-- _class: lead -->
<!-- _paginate: false -->

# Junior Genealogist Onboarding

Evaluating AI genealogy skills

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
- Genealogists review each run and **correct** the AI's grades
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

- **Junior genealogists** (you) — author tests, run the harness, correct grades, submit PRs
- **Senior genealogists** — recommend tests and review your corrections
- You'll work in small teams, each owning a few skills

---

## This week — your first task

- An onboarding exercise: grade the AI's work on **5 skills**
- It helps us calibrate everyone's genealogical judgment and form the teams
- Details after we get set up

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

## The test harness

- Runs every test for a skill and has the AI judge grade each run
- Produces a **run log** — the file the review UI reads
- This week the run logs are prepared for you — you'll focus on grading
- Later you'll run the harness yourself

---

## Using the review UI

- `Start.bat` opens the app in your browser
- Pick a skill → pick a run → review each test
- Read the trace, then set the score you think is right
- Add a one-line comment when you disagree with the AI
- Live walkthrough after these slides

---

<!-- _class: lead -->

# Your task this week

---

## Your task — grade 5 skills

- You'll review the AI's grades for **5 skills**
  *(the 5 skills are announced at kickoff)*
- For every test and every dimension, decide: do you **agree** with the AI's score?
- Correct the ones you think are wrong; leave a short reason

---

## How your grading is used

- The senior genealogists have built a reference **answer key** for these 5 skills
- We compare your grades to theirs
- This is an **onboarding assessment** — it helps us select the genealogist team
- No trick questions — just grade the way your expertise tells you

---

## Grading well

- Read the full trace before scoring — input, tool calls, output
- Judge against the **rubric**, not your gut feeling about the skill overall
- Use **2 (partial)** honestly — it's not all-or-nothing
- When you disagree with the AI, say **why** in one line
- Take your time; quality over speed

---

## Dates & cadence

- **You start:** Wednesday, May 27
- **Daily standup:** 8:30am, 15–30 min — bring questions
- The 5 skills will be announced at kickoff

---

<!-- _class: lead -->

# Questions?

Next: hands-on walkthrough — install, the review UI, your first graded test

Thanks for being here — let's get started
