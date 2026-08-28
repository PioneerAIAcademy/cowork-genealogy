import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

/**
 * A mock fixture's `response` must be a shape its tool can actually return.
 *
 * `eval/fixtures/mcp/*.json` fixtures stand in for real MCP tool responses in
 * every unit eval run. Nothing checked them against the tools: the judge grades
 * a skill's answer against the fixture's *content* and never asks whether the
 * fixture's *shape* is one the tool could produce. So a fixture can hand the
 * model a field the tool never emits, or withhold one it always emits, and the
 * whole corpus stays green while measuring behaviour against an API that does
 * not exist. The defect class surfaced three separate times in one PR (#1803)
 * before anything looked for it repo-wide.
 *
 * WHY THIS LIVES IN THE ENGINE SUITE. The fixtures are eval-side, but the
 * contract they drift from is engine-side, so the check needs a job that sees
 * both change:
 *
 *   - Issue #1891 suggested `eval/harness/scripts/`, alongside
 *     `check_tool_coverage.py`. Those run from `check-runlogs.yml`, whose scope
 *     step deliberately excludes `packages/engine/mcp-server/src/**` (its stated
 *     reason is run-log activeness). The change that silently invalidates 40
 *     fixtures at once — editing a response interface — would match no pattern
 *     there, so the check would report success with every step skipped.
 *   - The harness pytest suite would NOT be dark, and it is NOT short of the
 *     machinery either: `eval-harness-tests.yml`'s PATTERNS carry both
 *     `^eval/fixtures/` and `^packages/engine/mcp-server/`, and that job runs
 *     `npm ci` + `npm run build` in this package. So a Python check there could
 *     drive the TypeScript compiler. What decides against it is the SHAPE that
 *     bridge has to take: `harness/ts_validator.py` is the existing example, and
 *     its contract is to return None so the caller SKIPS when the build or
 *     `node` is absent. That is the exact silent-skip this check exists to
 *     avoid, sitting under the one assertion the whole thing rests on. Here the
 *     reader is native — `typescript` is a devDependency and two packaging tests
 *     already read `src/index.ts` through its AST — so there is no bridge to
 *     degrade and no hand-maintained per-tool field list to drift.
 *   - `engine-tests.yml` also runs UNGATED on every PR, by an explicit decision
 *     recorded in its header, so nothing can scope this check dark later.
 *
 * The narrow ancestor of this check — a hand-written
 * `{persons, relationships, sources}` set for `person_read` in
 * `eval/harness/tests/unit/test_fixtures.py` — is subsumed by the derived key
 * set here and was narrowed to the value assertion this check cannot make.
 *
 * WHAT "THE SHAPE ITS TOOL RETURNS" MEANS FOR `image_read`, THE ONE ARM WHERE
 * THE TWO READINGS DIFFER. Every other arm serializes the whole awaited result,
 * so the handler's return type and the text block the model receives are the
 * same object. `image_read` destructures and serializes only `metadata`,
 * alongside a separate image content block. The check resolves the HANDLER'S
 * RETURN TYPE, so an `image_read` fixture must be `{imageData, metadata}` —
 * which is what the harness actually serves the model, since the mock has no
 * image content block and hands the whole response over as one text block (the
 * existing fixture's own description says so). The consequence to be aware of:
 * for this one tool the fixture is faithful to the harness rather than to the
 * production wire, and this check cannot see that gap.
 *
 * ONE KNOWN OVER-STRICTNESS, recorded rather than accommodated.
 * `place_population` casts the upstream body with no check
 * (`response.json() as Promise<PopulationResponse>`), and the hosted Pop Stats
 * API answers an unknown place with HTTP 200 and `{error, place_id}` — two keys,
 * so the one-key failure envelope below rejects it. No fixture uses that shape,
 * and a failure on it is pointing at the tool's cast rather than at the fixture.
 * Do not loosen the envelope to admit it: that would re-admit
 * `{error, message, status}`, which no arm can produce.
 *
 * DEPTH: TOP-LEVEL KEYS ONLY. This catches a wrong, invented or missing field
 * name. It cannot catch a nested defect — a `place_population` fixture trimmed
 * to `{"place": "Muhlenberg, Kentucky, United States"}` passes here while
 * `place` should be `{place_id, name, level}`. Recursive checking is a much
 * larger job; a green run is not a validated corpus. Recorded in
 * `docs/specs/unit-test-spec.md` § 3.2 as well, so a reader of either finds it.
 *
 * NOTHING HAND-MAINTAINED. Both halves are derived from source, so a new tool
 * or a renamed field is covered without editing this file:
 *   1. `src/index.ts` dispatch arm  ->  the handler it awaits
 *   2. the handler's annotated `Promise<T>`  ->  T's top-level members
 * A tool whose chain does not resolve FAILS (see the meta-assertions at the
 * bottom); it is never skipped, because a silent skip is how a check that
 * cannot fail starts looking like coverage.
 */

const here = dirname(fileURLToPath(import.meta.url));
const mcpRoot = join(here, "..", "..");
const engineRoot = join(here, "..", "..", ".."); // packages/engine/
const projectRoot = join(engineRoot, "..", ".."); // repo root
const fixturesDir = join(projectRoot, "eval", "fixtures", "mcp");

// ─── TypeScript source index ───────────────────────────────────────

type Named = { node: ts.Node; file: ts.SourceFile };

const interfaces = new Map<string, Named>();
const aliases = new Map<string, Named>();
/** Names declared more than once anywhere under `src/`. The index is keyed by
 *  bare name and last-write-wins, so a duplicate that becomes reachable from a
 *  response type would silently resolve against the wrong declaration. */
const duplicateTypeNames = new Set<string>();
/** Function name -> its annotated return type node. */
const returnTypes = new Map<string, Named>();

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
}

function indexFile(path: string): void {
  const file = parse(path);
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node)) {
      if (interfaces.has(node.name.text)) duplicateTypeNames.add(node.name.text);
      interfaces.set(node.name.text, { node, file });
    } else if (ts.isTypeAliasDeclaration(node)) {
      if (aliases.has(node.name.text)) duplicateTypeNames.add(node.name.text);
      aliases.set(node.name.text, { node, file });
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.type
    ) {
      returnTypes.set(node.name.text, { node: node.type, file });
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer)) &&
      node.initializer.type
    ) {
      // `export const fooTool = async (…): Promise<X> => …`
      returnTypes.set(node.name.text, { node: node.initializer.type, file });
    }
    node.forEachChild(visit);
  };
  file.forEachChild(visit);
}

function walkSrc(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkSrc(path);
    else if (entry.name.endsWith(".ts")) indexFile(path);
  }
}

walkSrc(join(mcpRoot, "src"));

// ─── Dispatch arms: tool name -> handler function ──────────────────

/**
 * Every arm is `if (request.params.name === "<tool>") { … }`. Inside, the
 * handler is the function whose awaited result is serialized for the model:
 *
 *   const result = await recordSearchTool(args);
 *   return { content: [{ type: "text", text: JSON.stringify(result) }] };
 *
 * Two real variants the extraction has to survive, so neither is a special
 * case bolted on later:
 *   - `image_read` destructures (`const { imageData, metadata } = await …`).
 *   - The twelve writer tools serialize through `writerToolResult(result)`
 *     rather than a direct `JSON.stringify(result)`, so no stringify call
 *     names the variable at all.
 */
function dispatchHandlers(): {
  handlers: Map<string, string>;
  dispatchedTools: Set<string>;
  projectingArms: string[];
} {
  const file = parse(join(mcpRoot, "src", "index.ts"));

  // Every `request.params.name === "<tool>"` comparison, and the `if` body it
  // belongs to. `toolNames` is the superset (any comparison, so a refactor into
  // a `||` or a `switch` still counts as dispatched); `arms` is the if-parented
  // subset, all 48 today.
  const toolNames: string[] = [];
  const arms: Array<{ tool: string; statement: ts.Statement }> = [];
  const findArms = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      ts.isStringLiteral(node.right) &&
      node.left.getText(file) === "request.params.name"
    ) {
      toolNames.push(node.right.text);
      // `setParentNodes: true` in parse() is what makes this reachable: the
      // comparison's parent is the `if (…) { … }` whose body we read.
      const parent = node.parent;
      if (parent && ts.isIfStatement(parent)) {
        arms.push({ tool: node.right.text, statement: parent.thenStatement });
      }
    }
    node.forEachChild(findArms);
  };
  file.forEachChild(findArms);

  const handlers = new Map<string, string>();
  /** Arms that serialize something OTHER than a plain awaited variable, so the
   *  handler's return type is not what the model receives. See the note below. */
  const projectingArms: string[] = [];
  for (const { tool, statement: body } of arms) {
    /** bound name -> awaited function name */
    const awaited = new Map<string, string>();
    const serialized = new Set<string>();
    let projected = false;

    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        let init: ts.Expression = node.initializer;
        if (ts.isAwaitExpression(init)) init = init.expression;
        if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
          const fn = init.expression.text;
          if (ts.isIdentifier(node.name)) {
            awaited.set(node.name.text, fn);
          } else if (ts.isObjectBindingPattern(node.name)) {
            for (const element of node.name.elements) {
              if (ts.isIdentifier(element.name)) awaited.set(element.name.text, fn);
            }
          }
        }
      }
      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        const callee = node.expression.getText(file);
        if (callee === "JSON.stringify" || callee === "writerToolResult") {
          const arg = node.arguments[0];
          if (ts.isIdentifier(arg)) {
            serialized.add(arg.text);
          } else if (!isCatchErrorLiteral(arg)) {
            // The arm builds the serialized object rather than handing over the
            // awaited result, so the handler's return type is NOT the shape the
            // model receives. This reader cannot follow that without a full
            // type-checker, so it must SAY SO rather than compare the wrong
            // thing: `{...result, retrievedAt}` would otherwise leave a field
            // every real response carries absent from every fixture, green.
            projected = true;
          }
        }
      }
      node.forEachChild(visit);
    };
    visit(body);

    // Prefer the variable the arm actually serializes; fall back to the arm's
    // single awaited call when nothing names one (the writer-tool shape).
    let fn: string | undefined;
    for (const name of serialized) {
      const candidate = awaited.get(name);
      if (candidate) {
        fn = candidate;
        break;
      }
    }
    if (!fn) {
      const distinct = new Set(awaited.values());
      if (distinct.size === 1) fn = [...distinct][0];
    }
    if (projected) projectingArms.push(tool);
    else if (fn) handlers.set(tool, fn);
  }
  return { handlers, dispatchedTools: new Set(toolNames), projectingArms };
}

/** The uniform failure literal every arm's `catch` serializes: exactly
 *  `{ error: <expr> }`. Not a projection — it is the modelled error envelope. */
function isCatchErrorLiteral(node: ts.Expression): boolean {
  if (!ts.isObjectLiteralExpression(node) || node.properties.length !== 1) return false;
  const prop = node.properties[0];
  return (
    !!prop.name && ts.isIdentifier(prop.name) && prop.name.text === "error"
  );
}

const { handlers, dispatchedTools, projectingArms } = dispatchHandlers();

// ─── Type resolution ──────────────────────────────────────────────

/**
 * One admissible key set. A union type yields several: a fixture is valid if it
 * satisfies any single alternative, never a mix of two.
 */
interface Alternative {
  required: Set<string>;
  optional: Set<string>;
  /** An index signature admits keys no member names. */
  open: boolean;
}

function membersOf(
  members: readonly ts.TypeElement[],
  file: ts.SourceFile,
  into: Alternative,
): void {
  for (const member of members) {
    if (ts.isIndexSignatureDeclaration(member)) {
      into.open = true;
      continue;
    }
    if (!member.name) continue;
    const name = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
      ? member.name.text
      : member.name.getText(file);
    if ((member as ts.PropertySignature).questionToken) into.optional.add(name);
    else into.required.add(name);
  }
}

/** Merge `extra` into `base` (interface heritage, intersection types). */
function mergeInto(base: Alternative, extra: Alternative): void {
  for (const key of extra.required) base.required.add(key);
  for (const key of extra.optional) base.optional.add(key);
  if (extra.open) base.open = true;
}

function emptyAlternative(): Alternative {
  return { required: new Set(), optional: new Set(), open: false };
}

/**
 * Resolve a type node to its admissible top-level key sets, or `null` when the
 * node is not an object shape this reader understands. `null` is a hard failure
 * for any tool that has fixtures — see the meta-assertions.
 */
function resolveType(
  type: ts.TypeNode,
  file: ts.SourceFile,
  seen: Set<string>,
  consulted?: Set<string>,
): Alternative[] | null {
  if (ts.isParenthesizedTypeNode(type)) return resolveType(type.type, file, seen, consulted);

  if (ts.isTypeLiteralNode(type)) {
    const alt = emptyAlternative();
    membersOf(type.members, file, alt);
    return [alt];
  }

  if (ts.isUnionTypeNode(type)) {
    const out: Alternative[] = [];
    for (const arm of type.types) {
      // A FRESH copy per arm. Sharing one `seen` across siblings makes a type
      // referenced twice in sibling position look circular, which reports the
      // whole tool unresolvable on a refactor that is purely additive.
      const resolved = resolveType(arm, file, new Set(seen), consulted);
      if (!resolved) return null;
      out.push(...resolved);
    }
    return out;
  }

  if (ts.isIntersectionTypeNode(type)) {
    const merged = emptyAlternative();
    for (const arm of type.types) {
      const resolved = resolveType(arm, file, new Set(seen), consulted);
      if (!resolved || resolved.length !== 1) return null;
      mergeInto(merged, resolved[0]);
    }
    return [merged];
  }

  if (ts.isTypeReferenceNode(type)) {
    const name = type.typeName.getText(file);

    // `Promise<T>` / `Readonly<T>` are transparent; `Record<K, V>` is an open
    // object with no named members.
    if (name === "Promise" || name === "Readonly") {
      const arg = type.typeArguments?.[0];
      return arg ? resolveType(arg, file, seen, consulted) : null;
    }
    if (name === "Record") {
      return [{ required: new Set(), optional: new Set(), open: true }];
    }

    consulted?.add(name);
    if (seen.has(name)) return null; // circular
    seen.add(name);

    const iface = interfaces.get(name);
    if (iface) {
      const declaration = iface.node as ts.InterfaceDeclaration;
      const alt = emptyAlternative();
      for (const clause of declaration.heritageClauses ?? []) {
        for (const parent of clause.types) {
          const resolved = resolveType(parent, iface.file, new Set(seen), consulted);
          if (!resolved || resolved.length !== 1) return null;
          mergeInto(alt, resolved[0]);
        }
      }
      membersOf(declaration.members, iface.file, alt);
      return [alt];
    }

    const alias = aliases.get(name);
    if (alias) {
      return resolveType(
        (alias.node as ts.TypeAliasDeclaration).type,
        alias.file,
        seen,
        consulted,
      );
    }
    return null;
  }

  // An `extends` clause is an ExpressionWithTypeArguments, not a TypeNode.
  if (ts.isExpressionWithTypeArguments(type as unknown as ts.Node)) {
    const expr = type as unknown as ts.ExpressionWithTypeArguments;
    const name = expr.expression.getText(file);
    consulted?.add(name);
    if (seen.has(name)) return null;
    seen.add(name);
    const iface = interfaces.get(name);
    if (iface) {
      const declaration = iface.node as ts.InterfaceDeclaration;
      const alt = emptyAlternative();
      for (const clause of declaration.heritageClauses ?? []) {
        for (const parent of clause.types) {
          const resolved = resolveType(
            parent as unknown as ts.TypeNode,
            iface.file,
            new Set(seen), consulted);
          if (!resolved || resolved.length !== 1) return null;
          mergeInto(alt, resolved[0]);
        }
      }
      membersOf(declaration.members, iface.file, alt);
      return [alt];
    }
    const alias = aliases.get(name);
    if (alias) {
      return resolveType(
        (alias.node as ts.TypeAliasDeclaration).type,
        alias.file,
        seen,
        consulted,
      );
    }
    return null;
  }

  return null;
}

/** tool name -> admissible key sets for the object the model receives. */
const consultedNames = new Map<string, Set<string>>();

function responseShapes(): Map<string, Alternative[]> {
  const out = new Map<string, Alternative[]>();
  for (const [tool, fn] of handlers) {
    const returnType = returnTypes.get(fn);
    if (!returnType) continue;
    const consulted = new Set<string>();
    const resolved = resolveType(
      returnType.node as ts.TypeNode,
      returnType.file,
      new Set(),
      consulted,
    );
    consultedNames.set(tool, consulted);
    if (resolved) out.set(tool, resolved);
  }
  return out;
}

const shapes = responseShapes();

/** A shape that admits ANY key and requires none constrains nothing, so every
 *  fixture for that tool would pass unexamined. `Promise<Record<string, X>>` on
 *  a handler produces exactly that. Treated as unresolved, not as coverage. */
function constrainsNothing(alternatives: Alternative[]): boolean {
  return alternatives.every((a) => a.open && a.required.size === 0);
}

// ─── Fixtures ─────────────────────────────────────────────────────

interface Fixture {
  name: string;
  tool: unknown;
  args: unknown;
  response: unknown;
  hasResponse: boolean;
  /** The documented marker for an aspirational tool: a fixture for a tool with
   *  no compiled source declares the input schema the mock should advertise
   *  (`mock_mcp.py`'s input-schema precedence, and its unit test). */
  declaresInputSchema: boolean;
}

/** Every `*.json` under the fixture dir, RECURSIVELY, relative to it.
 *
 *  `load_fixtures` resolves `fixtures_dir / f"{name}.json"`, so a test naming
 *  `sub/hidden` loads a fixture a flat `readdirSync` never sees — verified
 *  loadable end to end. Recursing here rather than trusting the flat layout. */
function fixturePaths(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...fixturePaths(join(dir, entry.name), rel));
    else if (entry.name.endsWith(".json")) out.push(rel);
  }
  return out;
}

const fixtures: Fixture[] = fixturePaths(fixturesDir).map((rel) => {
  const raw = JSON.parse(readFileSync(join(fixturesDir, rel), "utf8")) as Record<
    string,
    unknown
  >;
  return {
    name: rel,
    tool: raw.tool,
    args: raw.args,
    response: raw.response,
    hasResponse: Object.prototype.hasOwnProperty.call(raw, "response"),
    declaresInputSchema: Object.prototype.hasOwnProperty.call(raw, "input_schema"),
  };
});

/**
 * The failure envelope. All 48 dispatch arms catch identically and return
 * `JSON.stringify({ error: message })`, with no other error shape anywhere in
 * `src/index.ts`, so `{error: <string>}` is a response EVERY tool can return.
 * Modelled here rather than exempted per file: `{error, message, status}` —
 * which `unit-test-spec.md` used to recommend — still fails.
 */
function isErrorEnvelope(response: unknown): boolean {
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    return false;
  }
  const keys = Object.keys(response as Record<string, unknown>);
  return (
    keys.length === 1 &&
    keys[0] === "error" &&
    typeof (response as { error: unknown }).error === "string"
  );
}

/** Why this fixture cannot match this alternative, or null when it matches. */
function mismatch(
  response: Record<string, unknown>,
  alt: Alternative,
): string | null {
  const keys = Object.keys(response);
  const unknown = alt.open
    ? []
    : keys.filter((k) => !alt.required.has(k) && !alt.optional.has(k));
  const missing = [...alt.required].filter((k) => !keys.includes(k));
  if (unknown.length === 0 && missing.length === 0) return null;
  const parts: string[] = [];
  if (unknown.length) parts.push(`fields the tool never returns: ${unknown.join(", ")}`);
  if (missing.length) parts.push(`fields the tool always returns, missing: ${missing.join(", ")}`);
  return parts.join("; ");
}

describe("eval/fixtures/mcp response shapes match the tools' return types", () => {
  it("every fixture declares the envelope the harness requires", () => {
    // `harness/fixtures.py` `build_manifest` raises on a missing `tool`, a
    // missing `response` and an absent/empty `args` — but only for a fixture some
    // test references, so a dead fixture is never loaded and never validated.
    // That is how an `image_search` fixture with `input`/`output` instead of
    // `args`/`response` survived in the corpus. This assertion is slightly wider
    // than the loader: a `tool` that is present but empty or not a string fails
    // here and does not there.
    const bad = fixtures
      .filter(
        (f) =>
          typeof f.tool !== "string" ||
          !f.tool ||
          typeof f.args !== "object" ||
          f.args === null ||
          Array.isArray(f.args) ||
          Object.keys(f.args as object).length === 0 ||
          !f.hasResponse,
      )
      .map((f) => f.name);
    expect(
      bad,
      "each fixture needs a `tool` string, a non-empty `args` predicate and a " +
        "`response` (docs/specs/unit-test-spec.md § 3.2)",
    ).toEqual([]);
  });

  it("every fixture names a dispatched tool, or declares its own input schema", () => {
    // The oracle is `dispatchedTools` (every arm in the chain), NOT the
    // extraction-resolved `handlers` map: a tool whose handler this reader
    // cannot follow is still dispatched, and blaming its fixtures for having
    // "no dispatch arm" would send the reader to the wrong file.
    //
    // An undispatched tool is allowed when the fixture declares `input_schema`.
    // That is the documented escape hatch for an aspirational tool — one with
    // fixtures but no compiled source yet — honoured by `mock_mcp.py`'s
    // input-schema precedence and covered by its own harness unit test. A
    // fixture-shape check must not quietly close it.
    const unknownTools = [
      ...new Set(
        fixtures
          .filter(
            (f) =>
              typeof f.tool === "string" &&
              !dispatchedTools.has(f.tool) &&
              !f.declaresInputSchema,
          )
          .map((f) => `${f.name} -> ${String(f.tool)}`),
      ),
    ];
    expect(
      unknownTools,
      "these fixtures mock a tool with no dispatch arm in src/index.ts. If the " +
        "tool is aspirational (fixtures before source), declare the fixture's " +
        "own `input_schema` — the harness honours it and this check then skips " +
        "the shape comparison, because there is no return type to compare to",
    ).toEqual([]);
  });

  it("every fixture's response is a shape its tool can return", () => {
    const failures: string[] = [];
    for (const fixture of fixtures) {
      if (typeof fixture.tool !== "string" || !fixture.hasResponse) continue;
      const alternatives = shapes.get(fixture.tool);
      // No shape: either an aspirational tool (allowed, and it declares its own
      // input_schema) or an extraction failure — which the meta-assertion below
      // turns into a failure rather than a skip.
      if (!alternatives) continue;
      const response = fixture.response;
      if (isErrorEnvelope(response)) continue;
      if (typeof response !== "object" || response === null || Array.isArray(response)) {
        failures.push(
          `${fixture.name}: response must be a JSON object, got ` +
            (Array.isArray(response) ? "an array" : typeof response),
        );
        continue;
      }
      const reasons = alternatives.map((alt) =>
        mismatch(response as Record<string, unknown>, alt),
      );
      if (reasons.every((r) => r !== null)) {
        failures.push(`${fixture.name} (${fixture.tool}): ${reasons.join(" | ")}`);
      }
    }
    expect(
      failures,
      "top-level keys only — see this file's header for what that cannot catch",
    ).toEqual([]);
  });

  // ─── Meta-assertions: the extraction must fail loudly, never silently ───

  it("finds the dispatch arms at all", () => {
    // If dispatch is refactored to a lookup map, this fails rather than
    // quietly checking nothing.
    expect(
      handlers.size,
      'no `if (request.params.name === "…")` arms resolved to a handler in ' +
        "src/index.ts — if dispatch was refactored, rewrite this extraction " +
        "rather than deleting the test",
    ).toBeGreaterThan(0);
  });

  it("finds fixtures at all", () => {
    expect(
      fixtures.length,
      `no fixtures found under ${fixturesDir}`,
    ).toBeGreaterThan(0);
  });

  it("every tool that has a fixture is really covered, not silently skipped", () => {
    // The load-bearing meta-assertion, and the one that has to enumerate EVERY
    // way coverage can disappear quietly. Each arm below is a way the check
    // could report green while examining nothing.
    const withFixtures = [
      ...new Set(
        fixtures
          .map((f) => f.tool)
          .filter((tool): tool is string => typeof tool === "string"),
      ),
    ].sort();
    const problems: string[] = [];

    for (const tool of withFixtures) {
      // Aspirational tools are legitimately uncovered — see the dispatch test.
      const aspirational =
        !dispatchedTools.has(tool) &&
        fixtures.every((f) => f.tool !== tool || f.declaresInputSchema);
      if (aspirational) continue;

      if (projectingArms.includes(tool)) {
        problems.push(
          `${tool}: its dispatch arm serializes a value it BUILDS rather than ` +
            `the awaited result, so the handler's return type is not the shape ` +
            `the model receives. This reader cannot follow that; compare against ` +
            `the arm's own shape or stop projecting`,
        );
        continue;
      }
      const alternatives = shapes.get(tool);
      if (!alternatives) {
        problems.push(
          `${tool}: its handler's return type could not be resolved to a set of ` +
            `top-level fields. Give the handler an explicit \`Promise<T>\` ` +
            `annotation, or teach resolveType() the construct it uses`,
        );
        continue;
      }
      if (constrainsNothing(alternatives)) {
        problems.push(
          `${tool}: its return type admits any key and requires none ` +
            `(a \`Record\`/index signature at the top level), so every fixture ` +
            `for it would pass unexamined. Declare the real shape`,
        );
        continue;
      }
      const ambiguous = [...(consultedNames.get(tool) ?? [])].filter((n) =>
        duplicateTypeNames.has(n),
      );
      if (ambiguous.length) {
        problems.push(
          `${tool}: resolved through ${ambiguous.join(", ")}, declared more than ` +
            `once under src/. The type index is keyed by bare name and ` +
            `last-write-wins, so this may have resolved against the wrong ` +
            `declaration. Rename one, or qualify the index by file`,
        );
      }
    }

    expect(
      problems,
      "a tool whose fixtures this check cannot examine must FAIL here, never be " +
        "skipped — a silent skip is how a check that cannot fail starts looking " +
        "like coverage",
    ).toEqual([]);
  });
});
