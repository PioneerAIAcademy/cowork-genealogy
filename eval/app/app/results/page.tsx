'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
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

function kindBadge(entry: RunLogListEntry) {
  if (entry.released) {
    return <Badge color="green" variant="filled">v{entry.version} released</Badge>;
  }
  if (entry.kind === 'candidate') {
    return <Badge color="blue" variant="light">v{entry.version} candidate</Badge>;
  }
  if (entry.kind === 'scratch') {
    return <Badge color="gray" variant="outline">scratch</Badge>;
  }
  return <Badge color="gray">other</Badge>;
}

export default function ResultsPage() {
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);

  // List all run logs, then group by skill.
  const query = useQuery<{ runs: RunLogListEntry[]; corrupt: string[] }>({
    queryKey: ['runlogs'],
    queryFn: async () => {
      const res = await fetch('/api/runlogs');
      if (!res.ok) throw new Error(`GET /api/runlogs → ${res.status}`);
      return res.json();
    },
    refetchOnWindowFocus: true,
  });

  const skillsWithRuns = useMemo(() => {
    const byskill = new Map<string, RunLogListEntry[]>();
    for (const r of query.data?.runs ?? []) {
      const arr = byskill.get(r.skill) ?? [];
      arr.push(r);
      byskill.set(r.skill, arr);
    }
    return Array.from(byskill.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [query.data]);

  const skillOptions = skillsWithRuns.map(([s]) => ({ value: s, label: s }));

  if (query.isLoading) {
    return (
      <Stack gap="md" align="center" py="xl">
        <Loader />
        <Text c="dimmed">loading run logs…</Text>
      </Stack>
    );
  }

  if (query.isError) {
    return <Alert color="red">{(query.error as Error).message}</Alert>;
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Title order={2}>Results</Title>
        <Group>
          <Select
            placeholder="filter by skill"
            data={skillOptions}
            value={selectedSkill}
            onChange={setSelectedSkill}
            clearable
            searchable
            w={260}
          />
          <Button component={Link} href="/results/compare" variant="default">
            Compare versions
          </Button>
        </Group>
      </Group>

      {query.data?.corrupt && query.data.corrupt.length > 0 ? (
        <Alert color="yellow" title="Some run logs failed to parse">
          {query.data.corrupt.map((p) => (
            <Text key={p} size="xs" ff="monospace">{p}</Text>
          ))}
        </Alert>
      ) : null}

      {skillsWithRuns
        .filter(([s]) => !selectedSkill || s === selectedSkill)
        .map(([skill, runs]) => (
          <Card key={skill} withBorder>
            <Group justify="space-between" mb="xs">
              <Title order={4}>{skill}</Title>
              <Group gap={4}>
                <Anchor component={Link} href={`/results/trend?skill=${skill}`}>
                  trend ↗
                </Anchor>
              </Group>
            </Group>
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Run</Table.Th>
                  <Table.Th>Timestamp</Table.Th>
                  <Table.Th>Tests</Table.Th>
                  <Table.Th>Weighted mean</Table.Th>
                  <Table.Th>Annotation</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {runs.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td>
                      <Group gap={6}>
                        {kindBadge(r)}
                        <Anchor component={Link} href={`/results/${r.id}`}>
                          {r.id.split('/').pop()}
                        </Anchor>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" ff="monospace">{r.timestamp}</Text>
                    </Table.Td>
                    <Table.Td>{r.testCount}</Table.Td>
                    <Table.Td>
                      {r.weightedMean !== null ? r.weightedMean.toFixed(2) : '—'}
                    </Table.Td>
                    <Table.Td>
                      {r.annotated ? (
                        r.annotationComplete ? (
                          <Badge color="green" variant="light">complete</Badge>
                        ) : (
                          <Badge color="yellow" variant="light">partial</Badge>
                        )
                      ) : (
                        <Badge color="gray" variant="outline">none</Badge>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        ))}
    </Stack>
  );
}
