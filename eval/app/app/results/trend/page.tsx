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
import type { RunLogListEntry } from '@/lib/types';

interface TrendPoint {
  version: number;
  released: boolean;
  timestamp: string;
  testCount: number;
  weightedMean: number | null;
  histogram: { 1: number; 2: number; 3: number };
  testsChangedSincePrevious: { added: number; removed: number; modified: number } | null;
}

interface TrendResponse {
  skill: string;
  points: TrendPoint[];
}

function TrendInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const skill = sp.get('skill') ?? '';

  const runlogs = useQuery<{ runs: RunLogListEntry[] }>({
    queryKey: ['runlogs'],
    queryFn: async () => (await fetch('/api/runlogs')).json(),
  });
  const skillOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of runlogs.data?.runs ?? []) s.add(r.skill);
    return Array.from(s).sort().map((v) => ({ value: v, label: v }));
  }, [runlogs.data]);

  const trend = useQuery<TrendResponse>({
    queryKey: ['trend', skill],
    enabled: !!skill,
    queryFn: async () => {
      const res = await fetch(`/api/runlogs/trend?skill=${encodeURIComponent(skill)}`);
      if (!res.ok) throw new Error(`trend → ${res.status}`);
      return res.json();
    },
  });

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Title order={2}>Trend</Title>
        <Select
          placeholder="pick a skill"
          data={skillOptions}
          value={skill}
          onChange={(v) => router.replace(`/results/trend?skill=${v ?? ''}`)}
          searchable
          w={260}
        />
      </Group>
      {trend.isLoading ? <Loader /> : null}
      {trend.isError ? <Alert color="red">{(trend.error as Error).message}</Alert> : null}
      {trend.data && trend.data.points.length === 0 ? (
        <Text c="dimmed">No released versions for {skill}. Release a candidate via the run log detail page.</Text>
      ) : null}
      {trend.data && trend.data.points.length > 0 ? (
        <Card withBorder>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Version</Table.Th>
                <Table.Th>Released at</Table.Th>
                <Table.Th>Tests</Table.Th>
                <Table.Th>Weighted mean</Table.Th>
                <Table.Th>Histogram</Table.Th>
                <Table.Th>Tests changed since prior</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {trend.data.points.map((p) => (
                <Table.Tr key={p.version}>
                  <Table.Td>
                    <Anchor component={Link} href={`/results/${skill}/v${p.version}`}>
                      <Badge color="green">v{p.version}</Badge>
                    </Anchor>
                  </Table.Td>
                  <Table.Td><Text size="xs" ff="monospace">{p.timestamp}</Text></Table.Td>
                  <Table.Td>{p.testCount}</Table.Td>
                  <Table.Td>{p.weightedMean?.toFixed(2) ?? '—'}</Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      <Badge color="red" variant="light" size="xs">1: {p.histogram[1]}</Badge>
                      <Badge color="yellow" variant="light" size="xs">2: {p.histogram[2]}</Badge>
                      <Badge color="green" variant="light" size="xs">3: {p.histogram[3]}</Badge>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {p.testsChangedSincePrevious ? (
                      <Text size="xs" c="dimmed">
                        +{p.testsChangedSincePrevious.added} added,&nbsp;
                        −{p.testsChangedSincePrevious.removed} removed,&nbsp;
                        ~{p.testsChangedSincePrevious.modified} modified
                      </Text>
                    ) : <Text size="xs" c="dimmed">—</Text>}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      ) : null}
    </Stack>
  );
}

export default function TrendPage() {
  return (
    <Suspense fallback={<Loader />}>
      <TrendInner />
    </Suspense>
  );
}
