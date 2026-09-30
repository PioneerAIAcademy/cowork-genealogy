import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The scenario viewer's StatusBadge is a hand-maintained copy of
 * packages/viewer-ui's. The two drifted: viewer-ui carried four gps-mentor
 * verdict colours (#1223) and a known-holding confidence colour this tree did
 * not, so every mentor verdict rendered gray — "fix this before the proof
 * stands" looked the same as "looks solid" (#3002).
 *
 * Nothing caught that. Typecheck passes either way: the map is a plain
 * Record<string, BadgeColor> and a missing key is just a lookup miss.
 *
 * SUPERSET, not equality: this tree may legitimately carry a colour viewer-ui
 * has no use for. What must not happen again is a value viewer-ui colours and
 * this one greys out.
 *
 * SCOPE: the colour map only. viewer-ui's `statusLabelMap` has no counterpart
 * here and is NOT pinned — see the note in the second test.
 */
const ROOT = join(__dirname, '../../../..');
const VIEWER_UI = join(ROOT, 'packages/viewer-ui/src/components/shared/StatusBadge.tsx');
const EVAL_APP = join(ROOT, 'eval/app/components/scenario/components/shared/StatusBadge.tsx');

/** Colour names this tree's BadgeColor union admits, read from the source so a
 *  legitimate new colour upstream does not red this file for the wrong reason. */
function badgeColors(file: string): Set<string> {
  const src = readFileSync(file, 'utf-8');
  const m = src.match(/type BadgeColor\s*=\s*([^\n;]+)/);
  if (!m) throw new Error(`no BadgeColor union in ${file}`);
  return new Set([...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]));
}

/**
 * Extract `statusColorMap` by declaration, anchored at both ends.
 *
 * By name because viewer-ui declares a SECOND map (`statusLabelMap`) in the
 * same file. Matching "the first object literal" would merge them.
 *
 * The end anchor is the matching brace found by depth counting, NOT the first
 * line starting with `}`. That shortcut failed OPEN on the upstream side: any
 * nested or reflowed construct truncated `upstream`, and a superset assertion
 * over fewer keys passes green while this tree is genuinely missing colours.
 *
 * Keys may be bare identifiers OR quoted — `'needs-work': 'red'` is legal and
 * is what hyphenated closed-enum values (evaluation_focus) must be written as.
 * An identifier-only pattern let exactly that drift through green.
 */
function colorMap(file: string): Record<string, string> {
  const src = readFileSync(file, 'utf-8');
  const decl = src.indexOf('const statusColorMap');
  if (decl === -1) throw new Error(`no statusColorMap declaration in ${file}`);
  const open = src.indexOf('{', decl);
  if (open === -1) throw new Error(`unterminated statusColorMap in ${file}`);

  let depth = 0;
  let close = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close === -1) throw new Error(`unbalanced statusColorMap braces in ${file}`);
  const body = src.slice(open + 1, close);

  const out: Record<string, string> = {};
  // Three key groups (bare / single-quoted / double-quoted), then the colour.
  for (const [, bare, single, double, color] of body.matchAll(
    /^\s*(?:(\w+)|'([^']+)'|"([^"]+)")\s*:\s*'(\w+)'/gm,
  ) as unknown as Iterable<string[]>) {
    out[bare ?? single ?? double] = color;
  }
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

  it('extracts the colour map alone, and the whole of it', () => {
    // The guard on the guard, and it has to be able to fail. Two ways the
    // extractor has actually been wrong: swallowing viewer-ui's statusLabelMap
    // (its values are prose, not colour names), and truncating early (which
    // fails OPEN, since a shorter upstream trivially satisfies the superset).
    const upstream = colorMap(VIEWER_UI);
    const src = readFileSync(VIEWER_UI, 'utf-8');

    const admitted = badgeColors(VIEWER_UI);
    for (const [key, color] of Object.entries(upstream)) {
      expect(admitted, `${key} maps to '${color}', which BadgeColor does not admit`).toContain(
        color,
      );
    }

    // Every key the file declares in that literal must survive extraction, so a
    // truncation cannot quietly shrink the comparison.
    const declared = (src.slice(src.indexOf('const statusColorMap')).match(
      /^\s*(?:\w+|'[^']+'|"[^"]+")\s*:\s*'\w+',?\s*$/gm,
    ) ?? []).length;
    expect(
      Object.keys(upstream).length,
      'extractor dropped entries — truncated before the closing brace?',
    ).toBeGreaterThanOrEqual(Math.min(declared, 40));
  });
});
