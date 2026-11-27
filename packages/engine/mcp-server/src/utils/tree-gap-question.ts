import type { TreeGap } from "../types/tree-gaps.js";

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

function who(g: QuestionFields): string {
  return g.lifespan ? `${g.name} (${g.lifespan})` : g.name;
}

function couple(g: QuestionFields): string {
  return g.spouseName ? `${g.name} and ${g.spouseName}` : who(g);
}

export function gapQuestion(g: QuestionFields): string {
  switch (g.type) {
    case "missing_parents": {
      const parent = g.detail.startsWith("The father")
        ? "father"
        : g.detail.startsWith("The mother")
          ? "mother"
          : "parents";
      const verb = parent === "parents" ? "were" : "was";
      return `Who ${verb} the ${parent} of ${who(g)}, born${inPlace(g)}${years(g)}?`;
    }
    case "missing_surname":
      return g.spouseName
        ? `What was the maiden surname of ${who(g)}, wife of ${g.spouseName}, married${inPlace(g)}${years(g)}?`
        : `What was the maiden surname of ${who(g)}, married${inPlace(g)}${years(g)}?`;
    case "no_spouse":
      return `Whom did ${who(g)} marry${inPlace(g)}${years(g)}?`;
    case "no_children":
    case "child_gap":
    case "early_last_child":
      return `Who were the children born to ${couple(g)}${inPlace(g)}${years(g)}?`;
    case "no_birth_info":
      return /no birth place\.$/.test(g.detail)
        ? `Where was ${who(g)} born${years(g)}?`
        : `When was ${who(g)} born${inPlace(g)}${years(g)}?`;
    case "no_death_date":
      return g.place
        ? `When did ${who(g)}, born in ${g.place}, die${years(g)}?`
        : `When did ${who(g)} die${years(g)}?`;
  }
}

// Each hole with its `question`, placed after `detail`. A hole that already
// carries one keeps it. Returns new objects.
export function withQuestions<T extends QuestionFields>(gaps: readonly T[]): (T & { question: string })[] {
  return gaps.map((g) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(g)) {
      if (k === "question") continue;
      out[k] = v;
      if (k === "detail") out.question = (g as { question?: string }).question ?? gapQuestion(g);
    }
    if (!("question" in out)) out.question = gapQuestion(g);
    return out as T & { question: string };
  });
}
