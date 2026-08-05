import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Schema field → viewer render drift (issue #1166).
 *
 * A `research.json` field can pass every check the repo has — both JSON Schema
 * copies, `validator.ts`, the `packages/schema` TS mirror, `make engine-test`,
 * `make harness-test`, `make typecheck` — and still be invisible to the
 * researcher, because nothing connects the schema to the components that
 * display it.
 *
 * **Why sibling-outlier and not "every field must render".** Requiring every
 * schema field at every downstream site flags **52 of 187** field-pairs (28%),
 * which is a 52-entry exemption list on day one — the shape of a lint that gets
 * rubber-stamped. Requiring only that a field appear *somewhere* flags **zero**,
 * and would have missed the one real defect. What actually discriminates is
 * whether a field is an outlier **within its own object**: if `external_site`
 * renders `site`, `capture_received` and `capture_filename` but not
 * `url_generated`, that asymmetry is a question worth answering. If an object
 * renders *nothing* it is simply not displayed — a decision, not an oversight —
 * so those are not flagged.
 *
 * That narrowing is deliberate and it is a real one: this says nothing about
 * whether a field is taught (`research-append-examples.ts`) or written (a
 * `SKILL.md`). A field that renders but nothing writes still slips. The
 * researcher-visible gap is the one with a user consequence, and it is the one
 * with a signal sharp enough to enforce.
 *
 * Detection is a word-boundary scan of the section components, with comments
 * stripped first — a comment naming the field satisfies a raw-text scan exactly
 * as well as the render does, so a `TODO: render url_generated` left in place of
 * the work would otherwise turn this suite green while the researcher still saw
 * nothing.
 *
 * A field reached only by destructuring or a generic map still false-negatives.
 * That direction is safe (a miss, not a false alarm), but it is no longer
 * silent: an object whose container renders while none of its field names
 * appear must declare itself in `RENDERED_GENERICALLY`, and `renders enough
 * fields to be scanning correctly` guards against the scan matching nothing.
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..", "..", "..", "..", "..");
const SCHEMA = join(
  projectRoot,
  "docs",
  "specs",
  "schemas",
  "research.schema.json",
);
// All of `components/`, not just `sections/` — a field displayed by a shared
// component (a generic field list, a badge) is rendered just as much as one
// inlined in a section, and scanning only sections/ false-positives on it.
const COMPONENTS = join(
  projectRoot,
  "packages",
  "viewer-ui",
  "src",
  "components",
);

/**
 * Fields deliberately not rendered, each with the reason.
 *
 * This list is the decision record — an entry here means someone looked and
 * said "correct that the researcher does not see this". Keep it short; if it
 * grows past a dozen, the lint is asking the wrong question.
 */
const NOT_RENDERED: Record<string, string> = {
  "timeline.generated":
    "Tool-set generation timestamp. Bookkeeping — the viewer shows the timeline, not when it was built.",
  "timeline_event.standard_place":
    "Machine-resolved sidecar of `place`, which IS rendered. Showing both would double every row.",
  "assertion.standard_place":
    "Same sidecar relationship as timeline_event.standard_place — `place` is rendered.",
  "assertion.extracted_for_question_ids":
    "Provenance FK used by projections and the exhaustiveness check; the assertion is already shown under its question.",
  "exhaustive_declaration.justification":
    "Long free text. Surfaced in the proof summary rather than inline on the declaration.",
  "exhaustive_declaration.log_entry_ids":
    "FK list backing the declaration; the log entries render in their own section.",
  "evaluation_entry.target_id":
    "FK to the evaluated object, which is rendered adjacent to its evaluation.",
  "evaluation_entry.target_type":
    "Discriminator for target_id, not researcher-facing.",
  "evaluation_entry.file_path":
    "Host-side artifact path; meaningless in the viewer.",
  "log_entry.plan_item_id":
    "FK to the plan item that prompted the search. The plan renders in its own section; showing a raw pli_ id in the log row would be noise.",
};

/**
 * Objects the viewer renders generically — a map over `Object.entries(…)` or a
 * destructure — so no field name appears literally in the source.
 *
 * Without this, such an object looks identical to one the viewer does not
 * display: the container matches, zero fields do. Declaring it keeps the
 * difference visible, and records that a new field here is invisible to this
 * lint by construction.
 */
const RENDERED_GENERICALLY: Record<string, string> = {
  stop_criteria:
    "QuestionsSection maps Object.entries(exhaustive_declaration.stop_criteria), so every criterion renders without its name appearing in the source.",
};

type SchemaObject = { properties?: Record<string, unknown> };

/**
 * Strip comments so prose about a field cannot stand in for rendering it.
 *
 * `//` is only treated as a line comment when it is not preceded by `:`, so a
 * `https://…` inside a string literal survives instead of eating its own line.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function componentSource(): string {
  if (!existsSync(COMPONENTS)) return "";
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "__tests__" && e.name !== "__fixtures__") walk(full);
      } else if (e.name.endsWith(".tsx")) {
        out.push(stripComments(readFileSync(full, "utf8")));
      }
    }
  };
  walk(COMPONENTS);
  return out.join("\n");
}

/**
 * `$def` name → the property names that `$ref` it, plus the def's own name.
 *
 * Needed because field names collide across objects. `evaluation_entry` has
 * `id` and `notes`, which every other object also has, so a bare per-field
 * scan reported it "4/8 rendered" when the viewer has no evaluations section
 * at all. Gating on the container first — is this object displayed anywhere? —
 * is what makes the sibling comparison mean something.
 */
function containerNames(schema: unknown): Map<string, Set<string>> {
  const refs = new Map<string, Set<string>>();
  const walk = (node: unknown, prop?: string) => {
    if (Array.isArray(node)) {
      for (const v of node) walk(v, prop);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const ref = obj.$ref;
    if (typeof ref === "string" && ref.startsWith("#/$defs/") && prop) {
      const name = ref.slice("#/$defs/".length);
      if (!refs.has(name)) refs.set(name, new Set());
      refs.get(name)!.add(prop);
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k === "properties" && v && typeof v === "object") {
        for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
          walk(pv, pk);
        }
      } else {
        walk(v, prop);
      }
    }
  };
  walk(schema);
  return refs;
}

function schemaObjects(): {
  objects: Map<string, string[]>;
  containers: Map<string, Set<string>>;
} {
  const schema = JSON.parse(readFileSync(SCHEMA, "utf8")) as {
    $defs?: Record<string, SchemaObject>;
  };
  const objects = new Map<string, string[]>();
  for (const [name, def] of Object.entries(schema.$defs ?? {})) {
    const props = def?.properties;
    // Single-property objects have no siblings, so the outlier test is
    // meaningless for them.
    if (props && Object.keys(props).length >= 2) {
      objects.set(name, Object.keys(props));
    }
  }
  return { objects, containers: containerNames(schema) };
}

describe("research.json fields reach the viewer", () => {
  const source = componentSource();
  const { objects, containers } = schemaObjects();
  const renders = (field: string) =>
    new RegExp(`\\b${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(
      source,
    );

  it("renders enough fields to be scanning correctly", () => {
    // If the sections move or the scan breaks, every object looks
    // "nothing rendered" and the whole lint passes vacuously.
    //
    // The floor is set from two measurements, not taste: 169 of 187 match
    // today, and deleting all of components/sections/ leaves 46. A floor just
    // above that broken figure is not a guard — a handful of new
    // generically-named fields would lift the broken case over it. 120 sits
    // clear of both.
    const rendered = [...objects.values()]
      .flat()
      .filter((f) => renders(f)).length;
    expect(
      rendered,
      `only ${rendered} schema fields found in ${COMPONENTS} — the viewer ` +
        `components probably moved. Fix this test rather than letting it pass.`,
    ).toBeGreaterThan(120);
  });

  it("has no stale entries in the exemption list", () => {
    // An exemption for a field that no longer exists is a decision record
    // pointing at nothing, and it hides that the list was never revisited.
    const live = new Set(
      [...objects.entries()].flatMap(([o, fs]) => fs.map((f) => `${o}.${f}`)),
    );
    const stale = Object.keys(NOT_RENDERED).filter((k) => !live.has(k));
    expect(
      stale,
      `these exemptions name fields that are no longer in the schema: ${stale.join(", ")}`,
    ).toEqual([]);

    const staleGeneric = Object.keys(RENDERED_GENERICALLY).filter(
      (k) => !objects.has(k),
    );
    expect(
      staleGeneric,
      `these RENDERED_GENERICALLY entries name objects that are no longer in ` +
        `the schema: ${staleGeneric.join(", ")}`,
    ).toEqual([]);
  });

  for (const [objectName, fields] of objects) {
    // Is this object displayed at all? Ask by its container property, not by
    // its field names — those collide. If no container is referenced, the whole
    // object is undisplayed, which is a decision about the object rather than
    // a per-field oversight, and the sibling comparison does not apply.
    const holders = [objectName, ...(containers.get(objectName) ?? [])];
    if (!holders.some(renders)) continue;

    const rendered = fields.filter(renders);
    if (rendered.length === 0) {
      // The container is displayed but not one field name appears. Either the
      // viewer renders the object generically, or the container name matched
      // something unrelated and the gate above is lying. Both need saying out
      // loud: silently skipping is what left `stop_criteria`'s seven fields
      // outside this lint.
      it(`${objectName}: renders generically, and says so`, () => {
        expect(
          objectName in RENDERED_GENERICALLY,
          `${objectName} is referenced in ${COMPONENTS} but none of its ` +
            `${fields.length} field names are. If the viewer renders it through ` +
            `a generic map, add it to RENDERED_GENERICALLY naming the component — ` +
            `a new field on it will not be caught here. If the reference is ` +
            `incidental, the container gate matched the wrong thing.`,
        ).toBe(true);
      });
      continue;
    }

    it(`${objectName}: every sibling of a rendered field is rendered or exempt`, () => {
      const unexplained = fields.filter(
        (f) => !rendered.includes(f) && !(`${objectName}.${f}` in NOT_RENDERED),
      );
      expect(
        unexplained,
        `${objectName} renders ${rendered.length}/${fields.length} fields, but ` +
          `these are neither rendered nor exempt: ${unexplained.join(", ")}. ` +
          `Either render them in packages/viewer-ui/src/components/, ` +
          `or add each to NOT_RENDERED with the reason it should stay hidden.`,
      ).toEqual([]);
    });
  }
});
