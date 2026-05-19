import { NextRequest, NextResponse } from 'next/server';
import { listRunLogsForSkill, runLogHistogram, runLogWeightedMean } from '@/lib/fs/runlogs';
import { readAnnotation } from '@/lib/fs/annotations';
import type { RunLogFile } from '@/lib/types';

interface TrendPoint {
  version: number;
  released: boolean;
  timestamp: string;
  testCount: number;
  weightedMean: number | null;
  histogram: { 1: number; 2: number; 3: number };
  testsChangedSincePrevious: { added: number; removed: number; modified: number } | null;
}

function correctedWeightedMean(
  log: RunLogFile,
  ann: { corrections: Array<{ test_id: string; dimension_source: string; dimension_name: string; corrected_score: number }> } | null,
): number | null {
  const byKey = new Map<string, number>();
  for (const c of ann?.corrections ?? []) {
    byKey.set(`${c.test_id}|${c.dimension_source}|${c.dimension_name}`, c.corrected_score);
  }
  const scores: number[] = [];
  for (const t of log.tests) {
    for (const d of t.outcome_summary.aggregated_dimensions) {
      const key = `${t.test_id}|${d.source}|${d.name}`;
      scores.push(byKey.get(key) ?? d.score);
    }
  }
  if (scores.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function diffTestFiles(prevSnap: Record<string, string>, currSnap: Record<string, string>, skill: string) {
  const prefix = `eval/tests/unit/${skill}/`;
  const prevTests = new Set(Object.keys(prevSnap).filter((k) => k.startsWith(prefix) && k.endsWith('.json')));
  const currTests = new Set(Object.keys(currSnap).filter((k) => k.startsWith(prefix) && k.endsWith('.json')));
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const k of currTests) {
    if (!prevTests.has(k)) added += 1;
    else if (prevSnap[k] !== currSnap[k]) modified += 1;
  }
  for (const k of prevTests) {
    if (!currTests.has(k)) removed += 1;
  }
  return { added, removed, modified };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const skill = sp.get('skill');
  if (!skill) return NextResponse.json({ error: 'skill required' }, { status: 400 });

  const { runs } = await listRunLogsForSkill(skill);
  // Trend covers RELEASED runs only.
  const released = runs
    .filter((r) => r.log.released && r.log.version != null)
    .sort((a, b) => (a.log.version ?? 0) - (b.log.version ?? 0));

  const points: TrendPoint[] = [];
  for (let i = 0; i < released.length; i++) {
    const r = released[i];
    const ann = (await readAnnotation(r.id)) as
      | { corrections: Array<{ test_id: string; dimension_source: string; dimension_name: string; corrected_score: number }> }
      | null;
    points.push({
      version: r.log.version!,
      released: true,
      timestamp: r.log.timestamp,
      testCount: r.log.tests.length,
      weightedMean: correctedWeightedMean(r.log, ann),
      histogram: runLogHistogram(r.log),
      testsChangedSincePrevious:
        i > 0
          ? diffTestFiles(released[i - 1].log.snapshot, r.log.snapshot, skill)
          : null,
    });
  }
  return NextResponse.json({ skill, points });
}
