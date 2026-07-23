// Manual smoke test for tree_forget — also the dispatch check the drift test
// cannot make (a missing index.ts if-block is a runtime "Unknown tool").
//   npx tsx dev/try-tree-forget.ts <projectPath> <selector> [<selector> ...]
//
// A selector is `kind:arg[:arg]`, matching how SKILL.md talks about them:
//   parents-of:I1  children-of:I1  spouses-of:I1  birth-of:I1  death-of:I1
//   facts-of:I1:Marriage  person:I2  fact:F4  relationship:R1
//
// Defaults to a DRY RUN. Pass --apply to actually write — this deletes tree
// persons and cascades their relationships, so point it at a scratch copy.
import { treeForget, type ForgetSelector, type ForgetSelectorKind } from "../src/tools/tree-forget.js";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const [projectPath, ...rest] = argv.filter((a) => a !== "--apply");

if (!projectPath || rest.length === 0) {
  console.error("usage: try-tree-forget.ts <projectPath> <selector> [<selector> ...] [--apply]");
  process.exit(1);
}

const forget: ForgetSelector[] = rest.map((raw) => {
  const [kind, a, b] = raw.split(":");
  const sel = kind as ForgetSelectorKind;
  switch (sel) {
    case "facts-of":
      return { selector: sel, personId: a, factType: b };
    case "fact":
      return { selector: sel, factId: a };
    case "relationship":
      return { selector: sel, relationshipId: a };
    default:
      return { selector: sel, personId: a };
  }
});

const result = await treeForget({ projectPath, forget, dryRun: !apply });
console.log(JSON.stringify(result, null, 2));
