import { NextRequest, NextResponse } from 'next/server';
import { listRunLogsInDir, runLogHistogram, runLogWeightedMean } from '@/lib/fs/runlogs';
import type { RunLogFile } from '@/lib/types';

function aggregate(log: RunLogFile) {
  return {
    timestamp: log.timestamp,
    model: log.model,
    weightedMean: runLogWeightedMean(log),
    histogram: runLogHistogram(log),
    test_id: log.test_id,
    test_content_hash: log.test_content_hash,
    outcome: log.outcome,
    flaky: log.flaky,
    dimensions: log.outcome_summary.aggregated_dimensions,
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const skill = sp.get('skill');
  const model = sp.get('model');
  if (!skill || !model) {
    return NextResponse.json({ error: 'skill and model query params required' }, { status: 400 });
  }
  const { runs, corrupt } = await listRunLogsInDir(skill, model);

  if (runs.length === 0) {
    return NextResponse.json({ skill, model, recent: null, previous: null, runs: [], corrupt });
  }

  // We want comparison at the *test* granularity: group run logs by
  // test_id, and within each group pick the two most recent. The
  // headline weighted-mean comes from joining the most-recent vs
  // second-most-recent run log per test (hash-mismatched rows are
  // de-emphasized).
  const byTest = new Map<string, typeof runs>();
  for (const r of runs) {
    const arr = byTest.get(r.log.test_id) ?? [];
    arr.push(r);
    byTest.set(r.log.test_id, arr);
  }
  const tests: Array<{
    test_id: string;
    recent: ReturnType<typeof aggregate>;
    previous: ReturnType<typeof aggregate> | null;
    edited: boolean;
  }> = [];
  for (const [test_id, arr] of byTest.entries()) {
    const sorted = [...arr].sort((a, b) => (a.log.timestamp < b.log.timestamp ? 1 : -1));
    const recent = aggregate(sorted[0].log);
    const previous = sorted[1] ? aggregate(sorted[1].log) : null;
    // If either side is missing a hash, treat as edited (safer default per plan).
    const edited = previous
      ? !recent.test_content_hash || !previous.test_content_hash || recent.test_content_hash !== previous.test_content_hash
      : false;
    tests.push({ test_id, recent, previous, edited });
  }

  // Headline weighted-mean over non-edited tests with both sides present.
  const comparable = tests.filter((t) => t.previous && !t.edited);
  const headlineRecent =
    comparable.length === 0
      ? null
      : comparable.reduce((acc, t) => acc + (t.recent.weightedMean ?? 0), 0) / comparable.length;
  const headlinePrevious =
    comparable.length === 0
      ? null
      : comparable.reduce((acc, t) => acc + (t.previous!.weightedMean ?? 0), 0) / comparable.length;

  return NextResponse.json({
    skill,
    model,
    tests: tests.sort((a, b) => a.test_id.localeCompare(b.test_id)),
    headline: {
      comparableCount: comparable.length,
      recentMean: headlineRecent,
      previousMean: headlinePrevious,
      delta: headlineRecent !== null && headlinePrevious !== null ? headlineRecent - headlinePrevious : null,
      withinVariance:
        headlineRecent !== null && headlinePrevious !== null && Math.abs(headlineRecent - headlinePrevious) < 0.3,
    },
    corrupt,
  });
}
