import type { TreeGap } from "../types/tree-gaps.js";
import { FATHER_MISSING, MOTHER_MISSING, NO_BIRTH_PLACE } from "./tree-gap-detect.js";

// One research question per hole: a single fact, the person named, and the
// hole's own place and years as its scope (docs/specs/tree-gaps-tool-spec.md,
// "Question"). The eval mock fills `question` on canned holes with this same
// compiled function (eval/harness/harness/mock_mcp.py).

type QuestionFields = Pick<
  TreeGap,
  "type" | "name" | "lifespan" | "detail" | "yearRange" | "place" | "spouseName"
>;

function years(g: QuestionFields): string {
  return g.yearRange ? ` between ${g.yearRange.start} and ${g.yearRange.end}` : "";
}

function inPlace(g: QuestionFields): string {
  return g.place ? ` in ${g.place}` : "";
}

// The place without saying what happened there, for a hole whose `place` may be
// a death or marriage place rather than the event asked about.
function ofPlace(g: QuestionFields): string {
  return g.place ? `, of ${g.place},` : "";
}

// A lifespan only when it gives both years; "1850-", "-1901" and "Deceased"
// say nothing a question can use.
function who(g: QuestionFields): string {
  return g.lifespan && /^\d{3,4}-\d{3,4}$/.test(g.lifespan) ? `${g.name} (${g.lifespan})` : g.name;
}

function couple(g: QuestionFields): string {
  return g.spouseName ? `${g.name} and ${g.spouseName}` : who(g);
}

export function gapQuestion(g: QuestionFields): string {
  switch (g.type) {
    case "missing_parents": {
      const ask =
        g.detail === FATHER_MISSING ? "Who was the father" : g.detail === MOTHER_MISSING ? "Who was the mother" : "Who were the parents";
      const scope = inPlace(g) + years(g);
      return `${ask} of ${who(g)}${scope ? `, born${scope}` : ""}?`;
    }
    case "missing_surname": {
      const wife = g.spouseName ? `, wife of ${g.spouseName}` : "";
      const scope = ofPlace(g).replace(/,$/, "") + years(g);
      return `What was the maiden surname of ${who(g)}${wife}${scope}?`;
    }
    case "no_spouse":
      return `Whom did ${who(g)} marry${inPlace(g)}${years(g)}?`;
    case "no_children":
    case "child_gap":
    case "early_last_child":
      return `Who were the children born to ${couple(g)}${inPlace(g)}${years(g)}?`;
    case "no_birth_info":
      return g.detail === NO_BIRTH_PLACE
        ? `Where was ${who(g)} born${years(g)}?`
        : `When was ${who(g)}${ofPlace(g)} born${years(g)}?`;
    case "no_death_date":
      return g.place
        ? `When did ${who(g)}, born in ${g.place}, die${years(g)}?`
        : `When did ${who(g)} die${years(g)}?`;
  }
}

// Each hole with its `question`, placed right after `detail`. Returns new
// objects; the order of the other keys is kept.
export function withQuestions<T extends QuestionFields>(gaps: readonly T[]): (T & { question: string })[] {
  return gaps.map((g) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(g)) {
      out[k] = v;
      if (k === "detail") out.question = gapQuestion(g);
    }
    return out as T & { question: string };
  });
}
