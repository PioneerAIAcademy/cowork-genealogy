'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Alert,
  Anchor,
  Badge,
  Card,
  Code,
  Group,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { ComparisonHeadline, ComparisonRow, ComparisonResult } from '@/lib/compare';
import type { RunLogListEntry } from '@/lib/types';

interface CompareResponse extends ComparisonResult {
  skill: string;
  model: string;
  corrupt: string[];
}

function fmtMean(n: number | null): string {
  if (n === null) return '—';
  return n.toFixed(2);
}

function deltaBadge(delta: number | null) {
  if (delta === null) return <Text size="sm" c="dimmed">—</Text>;
  const color = Math.abs(delta) < 0.001 ? 'gray' : delta > 0 ? 'green' : 'red';
  const sign = delta > 0 ? '+' : '';
  return (
    <Badge color={color} variant="light">
      Δ {sign}
      {delta.toFixed(2)}
    </Badge>
  );
}

function rowDelta(row: ComparisonRow): number | null {
  if (!row.previous) return null;
  if (row.recent.weightedMean === null || row.previous.weightedMean === null) return null;
  return row.recent.weightedMean - row.previous.weightedMean;
}

function CompareInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const skill = sp.get('skill') ?? '';
  const model = sp.get('model') ?? '';

  // Pull skill/model option lists from the run-log index.
  const indexQuery = useQuery<{ runs: RunLogListEntry[] }>({
    queryKey: ['compare-index'],
    queryFn: async () => (await fetch('/api/runlogs')).json(),
  });

  const skillOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of indexQuery.data?.runs ?? []) s.add(r.skill);
    return Array.from(s).sort();
  }, [indexQuery.data]);

  const modelOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of indexQuery.data?.runs ?? []) {
      if (!skill || r.skill === skill) s.add(r.model);
    }
    return Array.from(s).sort();
  }, [indexQuery.data, skill]);

  const compareQuery = useQuery<CompareResponse>({
    queryKey: ['compare', skill, model],
    enabled: Boolean(skill && model),
    queryFn: async () => {
      const res = await fetch(`/api/runlogs/compare?skill=${encodeURIComponent(skill)}&model=${encodeURIComponent(model)}`);
      if (!res.ok) throw new Error(`compare → ${res.status}`);
      return res.json();
    },
  });

  const update = (key: 'skill' | 'model', value: string) => {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`/results/compare?${params.toString()}`);
  };

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>Compare runs</Title>
        <Anchor component={Link} href="/results">
          ← back to results
        </Anchor>
      </Group>

      <Card withBorder>
        <Group gap="md">
          <Select
            label="Skill"
            data={skillOptions.map((s) => ({ value: s, label: s }))}
            value={skill || null}
            onChange={(v) => update('skill', v ?? '')}
            searchable
            placeholder="Pick a skill"
            w={260}
          />
          <Select
            label="Model"
            data={modelOptions.map((s) => ({ value: s, label: s }))}
            value={model || null}
            onChange={(v) => update('model', v ?? '')}
            searchable
            placeholder="Pick a model"
            w={260}
          />
        </Group>
      </Card>

      {!skill || !model ? (
        <Card withBorder>
          <Text c="dimmed">Pick a skill and model to compare the two most recent runs per test.</Text>
        </Card>
      ) : compareQuery.isLoading ? (
        <Group justify="center" p="lg">
          <Loader />
        </Group>
      ) : !compareQuery.data ? (
        <Alert color="red">Failed to load comparison.</Alert>
      ) : (
        <CompareBody data={compareQuery.data} />
      )}
    </Stack>
  );
}

function CompareBody({ data }: { data: CompareResponse }) {
  const { rows, headline, emptyState } = data;
  if (emptyState === 'no-runs') {
    return (
      <Card withBorder>
        <Text c="dimmed">No run logs in eval/runlogs/unit/{data.skill}/{data.model}/. Run the harness against this skill first.</Text>
      </Card>
    );
  }

  return (
    <Stack gap="md">
      <Card withBorder>
        <HeadlineBanner headline={headline} emptyState={emptyState} />
      </Card>

      <Card withBorder p={0}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Test</Table.Th>
              <Table.Th>Previous</Table.Th>
              <Table.Th>Recent</Table.Th>
              <Table.Th>Δ</Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => {
              const delta = rowDelta(row);
              return (
                <Table.Tr
                  key={row.test_id}
                  bg={row.edited || row.recentOnly || row.previousOnly ? 'var(--mantine-color-gray-0)' : undefined}
                  style={row.edited || row.recentOnly ? { color: 'var(--mantine-color-gray-6)' } : undefined}
                >
                  <Table.Td>
                    <Anchor component={Link} href={`/tests/${row.test_id}`} fw={500}>
                      {row.test_id}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>
                    {row.previous ? (
                      <Stack gap={2}>
                        <Text size="sm">{fmtMean(row.previous.weightedMean)}</Text>
                        <Text size="xs" c="dimmed">
                          {row.previous.timestamp}
                        </Text>
                        <HistogramChips h={row.previous.histogram} />
                      </Stack>
                    ) : (
                      <Text size="xs" c="dimmed">
                        — (no previous run)
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Stack gap={2}>
                      <Text size="sm">{fmtMean(row.recent.weightedMean)}</Text>
                      <Text size="xs" c="dimmed">
                        {row.recent.timestamp}
                      </Text>
                      <HistogramChips h={row.recent.histogram} />
                    </Stack>
                  </Table.Td>
                  <Table.Td>{deltaBadge(delta)}</Table.Td>
                  <Table.Td>
                    {row.recentOnly ? (
                      <Badge color="blue" variant="light">
                        new — single-side
                      </Badge>
                    ) : row.edited ? (
                      <Badge color="gray" variant="light">
                        edited — excluded
                      </Badge>
                    ) : (
                      <Badge color="green" variant="light">
                        comparable
                      </Badge>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Card>

      {data.corrupt?.length ? (
        <Alert color="yellow">
          {data.corrupt.length} run log file{data.corrupt.length === 1 ? '' : 's'} could not be read — check the server
          console.
        </Alert>
      ) : null}
    </Stack>
  );
}

function HeadlineBanner({ headline, emptyState }: { headline: ComparisonHeadline; emptyState: string | null }) {
  if (emptyState === 'single-run') {
    return <Text c="dimmed">Only one run log per test in this directory — no previous run to compare against.</Text>;
  }
  if (headline.comparableCount === 0) {
    return (
      <Stack gap={4}>
        <Title order={4}>No comparable tests</Title>
        <Text size="sm" c="dimmed">
          Every test in this directory was either added since the previous run or had its grading-relevant content
          change (different test_content_hash). Inspect the per-test rows below — comparison values are still shown but
          excluded from the headline mean.
        </Text>
      </Stack>
    );
  }
  return (
    <Group gap="xl" align="flex-start" wrap="wrap">
      <Stack gap={2}>
        <Text size="xs" c="dimmed">
          Comparable tests
        </Text>
        <Text fw={600}>{headline.comparableCount}</Text>
      </Stack>
      <Stack gap={2}>
        <Text size="xs" c="dimmed">
          Previous mean
        </Text>
        <Text fw={600}>{fmtMean(headline.previousMean)}</Text>
      </Stack>
      <Stack gap={2}>
        <Text size="xs" c="dimmed">
          Recent mean
        </Text>
        <Text fw={600}>{fmtMean(headline.recentMean)}</Text>
      </Stack>
      <Stack gap={2}>
        <Text size="xs" c="dimmed">
          Δ (recent − previous)
        </Text>
        {deltaBadge(headline.delta)}
      </Stack>
      {headline.withinVariance ? (
        <Alert color="yellow" variant="light" style={{ flex: 1, minWidth: 320 }}>
          |Δ| &lt; 0.3 — within typical run-to-run variation; interpret cautiously. Re-run the harness for a second
          sample if you want more signal.
        </Alert>
      ) : null}
    </Group>
  );
}

function HistogramChips({ h }: { h: { 1: number; 2: number; 3: number } }) {
  return (
    <Group gap={4}>
      {h[3] ? (
        <Badge size="xs" color="green" variant="light">
          {h[3]}×3
        </Badge>
      ) : null}
      {h[2] ? (
        <Badge size="xs" color="yellow" variant="light">
          {h[2]}×2
        </Badge>
      ) : null}
      {h[1] ? (
        <Badge size="xs" color="red" variant="light">
          {h[1]}×1
        </Badge>
      ) : null}
    </Group>
  );
}

export default function CompareRunsPage() {
  return (
    <Suspense fallback={<Loader />}>
      <CompareInner />
    </Suspense>
  );
}

// Silence unused import warning if Code is removed later.
export const _CompareCode = Code;
