import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The scenario viewer's StatusBadge is a hand-maintained copy of
 * packages/viewer-ui's. The two drifted: viewer-ui carried four gps-mentor
 * verdict colours (#1223) and a known-holding confidence colour that this tree
 * did not, so every mentor verdict here rendered gray — "fix this before the
 * proof stands" looked identical to "looks solid" (#3002).
 *
 * Nothing caught that. Typecheck passes either way, because the map is a plain
 * Record<string, BadgeColor> and a missing key is simply a lookup miss.
 *
 * SUPERSET, not equality: this tree may legitimately carry a colour viewer-ui
 * has no use for. What must not happen again is a value viewer-ui colours and
 * this one greys out.
 */
const ROOT = join(__dirname, '../../../..');
const VIEWER_UI = join(ROOT, 'packages/viewer-ui/src/components/shared/StatusBadge.tsx');
const EVAL_APP = join(ROOT, 'eval/app/components/scenario/components/shared/StatusBadge.tsx');

/**
 * Extract `statusColorMap` by its declaration, anchored at both ends.
 *
 * By name, because viewer-ui's file declares a SECOND map — `statusLabelMap`,
 * a display-label record this tree has no equivalent of. Keyed on "the first
 * object literal" the two would merge, and a new label would red this test for
 * no reason. Anchored at the end too: run to EOF and `statusLabelMap` is
 * swallowed anyway.
 */
function colorMap(file: string): Record<string, string> {
  const src = readFileSync(file, 'utf-8');
  const start = src.indexOf('const statusColorMap');
  if (start === -1) throw new Error(`no statusColorMap declaration in ${file}`);
  const end = src.indexOf('\n}', start);
  if (end === -1) throw new Error(`unterminated statusColorMap in ${file}`);
  const body = src.slice(start, end);

  const out: Record<string, string> = {};
  for (const [, key, color] of body.matchAll(/^\s*(\w+): '(\w+)'/gm)) out[key] = color;
  if (Object.keys(out).length === 0) throw new Error(`statusColorMap parsed empty in ${file}`);
  return out;
}

describe('StatusBadge colour parity with packages/viewer-ui', () => {
  it('colours every status viewer-ui colours, with the same colour', () => {
    const upstream = colorMap(VIEWER_UI);
    const ours = colorMap(EVAL_APP);

    const missing = Object.keys(upstream).filter((k) => !(k in ours));
    expect(missing, 'statuses viewer-ui colours that this tree renders gray').toEqual([]);

    const disagreements = Object.keys(upstream)
      .filter((k) => k in ours && ours[k] !== upstream[k])
      .map((k) => `${k}: viewer-ui ${upstream[k]}, here ${ours[k]}`);
    expect(disagreements, 'same status, different colour').toEqual([]);
  });

  it('parses each map on its own — not viewer-ui statusLabelMap', () => {
    // The guard on the guard: if the extractor ever swallowed the label map,
    // its string values would land here as colours and the assertion above
    // would start failing for reasons that have nothing to do with drift.
    const upstream = colorMap(VIEWER_UI);
    expect(Object.keys(upstream)).not.toContain('exhaustive_declared_label');
    for (const color of Object.values(upstream)) {
      expect(color, 'a colour map value should be a colour name').toMatch(
        /^(green|amber|red|blue|gray|purple)$/,
      );
    }
  });
});
