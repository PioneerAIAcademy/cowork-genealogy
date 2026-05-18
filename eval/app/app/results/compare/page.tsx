'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Anchor,
  Badge,
  Box,
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
import type {
  ComparisonResult,
} from '@/lib/compare';
import type { RunLogListEntry } from '@/lib/types';

interface CompareResponse extends ComparisonResult {
  recentId: string;
  previousId: string;
}

function Histogram({ h, label }: { h: { 1: number; 2: number; 3: number }; label: string }) {
  const total = h[1] + h[2] + h[3];
  if (total === 0) return <Text size="xs" c="dimmed">no dimensions</Text>;
  return (
    <Box>
      <Text size="xs" c="dimmed">{label}</Text>
      <Group gap={4}>
        <Badge color="red" variant="light">1: {h[1]}</Badge>
        <Badge color="yellow" variant="light">2: {h[2]}</Badge>
        <Badge color="green" variant="light">3: {h[3]}</Badge>
      </Group>
    </Box>
  );
}

function CompareInner() {
  const runlogs = useQuery<{ runs: RunLogListEntry[] }>({
    queryKey: ['runlogs'],
    queryFn: async () => {
      const res = await fetch('/api/runlogs');
      if (!res.ok) throw new Error(`GET /api/runlogs → ${res.status}`);
      return res.json();
    },
  });

  const [skill, setSkill] = useState<string | null>(null);
  const [recentId, setRecentId] = useState<string | null>(null);
  const [previousId, setPreviousId] = useState<string | null>(null);

  const skillOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of runlogs.data?.runs ?? []) s.add(r.skill);
    return Array.from(s).sort().map((v) => ({ value: v, label: v }));
  }, [runlogs.data]);

  const runsForSkill = useMemo(
    () => (runlogs.data?.runs ?? []).filter((r) => r.skill === skill),
    [runlogs.data, skill],
  );

  // Auto-pick: latest released as previous, latest candidate as recent.
  useEffect(() => {
    if (!skill || runsForSkill.length === 0) return;
    const released = runsForSkill.find((r) => r.kind === 'released');
    const candidate = runsForSkill.find((r) => r.kind === 'candidate');
    setRecentId(candidate?.id ?? runsForSkill[0]?.id ?? null);
    setPreviousId(released?.id ?? runsForSkill[1]?.id ?? null);
  }, [skill, runsForSkill]);

  const runOptions = runsForSkill.map((r) => ({
    value: r.id,
    label: `${r.kind === 'released' ? `v${r.version} (released)` : r.kind === 'candidate' ? `v${r.version} candidate` : 'scratch'} — ${r.timestamp}`,
  }));

  const compare = useQuery<CompareResponse>({
    queryKey: ['compare', recentId, previousId],
    enabled: !!recentId && !!previousId,
    queryFn: async () => {
      const res = await fetch(`/api/runlogs/compare?recent=${encodeURIComponent(recentId!)}&previous=${encodeURIComponent(previousId!)}`);
      if (!res.ok) throw new Error(`compare → ${res.status}`);
      return res.json();
    },
  });

  return (
    <Stack gap="md">
      <Title order={2}>Compare versions</Title>
      <Group>
        <Select
          label="Skill"
          placeholder="pick a skill"
          data={skillOptions}
          value={skill}
          onChange={setSkill}
          searchable
          w={260}
        />
        <Select
          label="Recent"
          placeholder="pick a run log"
          data={runOptions}
          value={recentId}
          onChange={setRecentId}
          disabled={!skill}
          w={360}
        />
        <Select
          label="Previous"
          placeholder="pick a run log"
          data={runOptions}
          value={previousId}
          onChange={setPreviousId}
          disabled={!skill}
          w={360}
        />
      </Group>

      {compare.isLoading ? <Loader /> : null}
      {compare.isError ? <Alert color="red">{(compare.error as Error).message}</Alert> : null}
      {compare.data ? (
        <>
          <Card withBorder>
            <Group justify="space-between">
              <Box>
                <Text size="xs" c="dimmed">Weighted-mean delta ({compare.data.headline.comparableCount} comparable test(s))</Text>
                <Group gap="md" align="baseline">
                  <Text size="xl" fw={700}>
                    {compare.data.headline.delta?.toFixed(2) ?? '—'}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {compare.data.headline.previousMean?.toFixed(2) ?? '—'} → {compare.data.headline.recentMean?.toFixed(2) ?? '—'}
                  </Text>
                </Group>
                {compare.data.headline.withinVariance ? (
                  <Text size="xs" c="orange">within typical run-to-run variation — interpret cautiously</Text>
                ) : null}
                {compare.data.fallbackToLlmScores ? (
                  <Text size="xs" c="dimmed">⚠ at least one side has no .ann.json; LLM scores used as fallback.</Text>
                ) : null}
              </Box>
              <Stack gap={4}>
                <Histogram h={compare.data.headline.previousHistogram} label="previous" />
                <Histogram h={compare.data.headline.recentHistogram} label="recent" />
              </Stack>
            </Group>
          </Card>

          <Card withBorder>
            <Title order={5}>Per-test comparison</Title>
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
                {compare.data.rows.map((row) => {
                  const delta =
                    row.recent && row.previous
                      ? (row.recent.weightedMean ?? 0) - (row.previous.weightedMean ?? 0)
                      : null;
                  return (
                    <Table.Tr key={row.test_id}>
                      <Table.Td><Code>{row.test_id}</Code></Table.Td>
                      <Table.Td>{row.previous?.weightedMean?.toFixed(2) ?? '—'}</Table.Td>
                      <Table.Td>{row.recent?.weightedMean?.toFixed(2) ?? '—'}</Table.Td>
                      <Table.Td>{delta?.toFixed(2) ?? '—'}</Table.Td>
                      <Table.Td>
                        {row.edited ? <Badge color="gray" variant="outline">edited — excluded</Badge> :
                          row.recentOnly ? <Badge color="blue" variant="light">new</Badge> :
                          row.previousOnly ? <Badge color="red" variant="light">removed</Badge> :
                          null}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Card>

          {compare.data.snapshotDiff.length > 0 ? (
            <Card withBorder>
              <Title order={5}>What changed</Title>
              <Stack gap={2}>
                {compare.data.snapshotDiff.map((d) => (
                  <Group key={d.path} gap={6}>
                    <Badge
                      color={d.kind === 'added' ? 'green' : d.kind === 'removed' ? 'red' : 'yellow'}
                      variant="light"
                    >
                      {d.kind}
                    </Badge>
                    <Code>{d.path}</Code>
                  </Group>
                ))}
              </Stack>
            </Card>
          ) : (
            <Text c="dimmed" size="sm">No snapshot differences.</Text>
          )}
        </>
      ) : null}
    </Stack>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<Loader />}>
      <CompareInner />
    </Suspense>
  );
}
