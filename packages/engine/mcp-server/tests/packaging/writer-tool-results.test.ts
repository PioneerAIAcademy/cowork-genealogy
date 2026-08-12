import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { OK_FALSE_IS_FAILURE } from "../../src/tool-result.js";

const mcpRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Pins the DISPATCH WIRING, not just the helper.
 *
 * Nothing else can: no other file under `tests/` imports `src/index.ts`, so a
 * change that adds `writerToolResult` and wires three of the eleven arms passes
 * every other check in the suite — `tsc`, the unit test, and the manifest drift
 * test all stay green while eight tools keep reporting failures as successes.
 *
 * It reuses `manifest.test.ts`'s AST approach rather than a regex, for the reason
 * recorded there: a block-commented branch leaves `tsc` at exit 0 and the tool
 * still advertised. But it cannot reuse that collector verbatim — that one keeps
 * only `node.right.text` and discards the node, which would let this test assert
 * merely that the eleven names are *dispatched*, already true on `main`. Keeping
 * the enclosing `IfStatement` is what makes the assertion about the arm's body.
 */
describe("writer-tool dispatch wiring", () => {
  const indexPath = join(mcpRoot, "src", "index.ts");
  const indexAst = ts.createSourceFile(
    indexPath,
    readFileSync(indexPath, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );

  /** tool name → source text of the `if` block that handles it. */
  const armBodies = new Map<string, string>();
  const collect = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      ts.isStringLiteral(node.right) &&
      node.left.getText(indexAst) === "request.params.name"
    ) {
      // `setParentNodes: true` above is what makes this reachable: the
      // comparison's parent is the `if (…) { … }` whose body we assert on.
      const parent = node.parent;
      if (parent && ts.isIfStatement(parent)) {
        armBodies.set(node.right.text, parent.thenStatement.getText(indexAst));
      }
    }
    node.forEachChild(collect);
  };
  indexAst.forEachChild(collect);

  it("finds dispatch arms with bodies at all (guards the extraction itself)", () => {
    // If dispatch is refactored to a lookup map, or the arms stop being plain
    // `if` statements, this fails rather than silently passing an empty check.
    expect(
      armBodies.size,
      "no `if (request.params.name === \"…\") { … }` arms found in src/index.ts — " +
        "if dispatch was refactored, replace this test rather than deleting it",
    ).toBeGreaterThan(0);
  });

  it("routes every OK_FALSE_IS_FAILURE tool through writerToolResult", () => {
    const missing = OK_FALSE_IS_FAILURE.filter(
      (tool) => !(armBodies.get(tool) ?? "").includes("writerToolResult("),
    );
    expect(
      missing,
      "these tools report failure by returning { ok: false }, so their dispatch " +
        "arm must call writerToolResult or the failure reads as a success",
    ).toEqual([]);
  });

  it("routes no other tool through it — the exclusions stay excluded", () => {
    // `merge_warnings` is the one that matters: its ok:false is a dry-run
    // verdict about a merge, not its own failure, so flagging it would tell the
    // agent a working preview had crashed.
    const listed = new Set<string>(OK_FALSE_IS_FAILURE);
    const unexpected = [...armBodies.entries()]
      .filter(([tool, body]) => !listed.has(tool) && body.includes("writerToolResult("))
      .map(([tool]) => tool);
    expect(
      unexpected,
      "a tool outside OK_FALSE_IS_FAILURE is being marked isError on ok:false — " +
        "add it to the list deliberately, or revert the arm",
    ).toEqual([]);
  });

  it("has a dispatch arm for every name in the list (no dead entries)", () => {
    const undispatched = OK_FALSE_IS_FAILURE.filter((t) => !armBodies.has(t));
    expect(
      undispatched,
      "OK_FALSE_IS_FAILURE names a tool with no dispatch arm — the list has " +
        "drifted from src/index.ts",
    ).toEqual([]);
  });
});
