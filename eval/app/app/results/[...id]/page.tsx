'use client';

import { use } from 'react';
import Link from 'next/link';
import {
  Alert,
  Anchor,
  Badge,
  Card,
  Code,
  Group,
  Loader,
  Stack,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { AnnotationFile, RunLogFile } from '@/lib/types';
import { JsonViewer } from '@/components/common/JsonViewer';
import { AnnotationGrid } from '@/components/results/AnnotationGrid';

function partialJudgeFailure(log: RunLogFile): string | null {
  for (const run of log.runs) {
    if (run.judge?.skipped && run.judge?.error) {
      return run.judge.error;
    }
  }
  return null;
}

function weightedMean(log: RunLogFile): number | null {
  const dims = log.outcome_summary.aggregated_dimensions;
  if (dims.length === 0) return null;
  return dims.reduce((acc, d) => acc + d.score, 0) / dims.length;
}

export default function RunLogDetailPage({ params }: { params: Promise<{ id: string[] }> }) {
  const { id } = use(params);
  const runLogId = id.join('/');

  const query = useQuery<{ runLog: RunLogFile; annotation: AnnotationFile | null; id: string }>({
    queryKey: ['runlog', runLogId],
    queryFn: async () => {
      // params from Next 15 catch-all are URL-encoded — pass through.
      const res = await fetch(`/api/runlogs/${id.join('/')}`);
      if (!res.ok) throw new Error(`GET /api/runlogs/${runLogId} → ${res.status}`);
      return res.json();
    },
    // Read-view: re-fetch on focus so a newly-written annotation by another
    // tab is reflected here. We do NOT auto-refetch the AnnotationGrid's
    // in-progress state — that's handled inside the grid component.
    refetchOnWindowFocus: true,
  });

  if (query.isLoading) return <Loader />;
  if (!query.data) return <Text c="red">Run log not found.</Text>;
  const { runLog, annotation } = query.data;
  const mean = weightedMean(runLog);
  const judgeError = partialJudgeFailure(runLog);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Stack gap={2}>
          <Title order={2}>{runLog.test_id}</Title>
          <Text size="xs" c="dimmed">
            {runLog.skill} · {runLog.model} · {runLog.timestamp}
          </Text>
        </Stack>
        <Anchor component={Link} href="/results">
          ← back to results
        </Anchor>
      </Group>

      <Card withBorder>
        <Group gap="lg" wrap="wrap">
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              Outcome
            </Text>
            <Group gap={6}>
              <Badge color={runLog.outcome === 'pass' ? 'green' : runLog.outcome === 'partial' ? 'yellow' : 'red'}>
                {runLog.outcome}
              </Badge>
              {runLog.flaky ? (
                <Badge color="orange" variant="outline" size="xs">
                  flaky
                </Badge>
              ) : null}
            </Group>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              Weighted mean
            </Text>
            <Text fw={600}>{mean !== null ? mean.toFixed(2) : '—'}</Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              Runs
            </Text>
            <Text>{runLog.runs.length}</Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              Scenario
            </Text>
            <Text>{runLog.scenario ?? '—'}</Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              Test content hash
            </Text>
            <Code>{runLog.test_content_hash ? `${runLog.test_content_hash.slice(0, 12)}…` : '—'}</Code>
          </Stack>
        </Group>
      </Card>

      <Tabs defaultValue="annotate">
        <Tabs.List>
          <Tabs.Tab value="annotate">Annotation grid</Tabs.Tab>
          <Tabs.Tab value="output">Skill output</Tabs.Tab>
          <Tabs.Tab value="runs">Per-run details ({runLog.runs.length})</Tabs.Tab>
          <Tabs.Tab value="raw">Raw run log</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="annotate" pt="md">
          {judgeError ? (
            <Alert color="red" title="Partial judge results">
              The LLM judge crashed on at least one run for this test ({judgeError}). Re-run the harness until every test
              has judge scores before annotating.
            </Alert>
          ) : (
            <AnnotationGrid runLogId={runLogId} runLog={runLog} initialAnnotation={annotation} />
          )}
        </Tabs.Panel>

        <Tabs.Panel value="output" pt="md">
          <Stack gap="sm">
            {runLog.runs.map((run, idx) => {
              const output = (run as unknown as { output?: { text_response?: unknown } }).output;
              const text = typeof output?.text_response === 'string' ? output.text_response : JSON.stringify(output?.text_response, null, 2);
              return (
                <Card key={idx} withBorder>
                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Text fw={600} size="sm">
                        Run #{run.run_index}
                      </Text>
                      <Badge color={run.outcome === 'pass' ? 'green' : run.outcome === 'partial' ? 'yellow' : 'red'}>
                        {run.outcome}
                      </Badge>
                    </Group>
                    <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 13 }}>{text}</pre>
                  </Stack>
                </Card>
              );
            })}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="runs" pt="md">
          <JsonViewer data={runLog.runs} />
        </Tabs.Panel>

        <Tabs.Panel value="raw" pt="md">
          <JsonViewer data={runLog} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
