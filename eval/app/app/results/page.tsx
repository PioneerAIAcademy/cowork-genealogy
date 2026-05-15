'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { RunLogListEntry } from '@/lib/types';

function outcomeBadge(o: RunLogListEntry['outcome'], flaky: boolean) {
  const color =
    o === 'pass' || o === 'xfail'
      ? 'green'
      : o === 'partial'
      ? 'yellow'
      : o === 'fail' || o === 'aborted' || o === 'xpass'
      ? 'red'
      : 'gray';
  return (
    <Group gap={4}>
      <Badge color={color} variant="light">
        {o}
      </Badge>
      {flaky ? (
        <Badge color="orange" variant="outline" size="xs">
          flaky
        </Badge>
      ) : null}
    </Group>
  );
}

function ResultsInner() {
  const sp = useSearchParams();
  const router = useRouter();

  const skill = sp.get('skill') ?? '';
  const model = sp.get('model') ?? '';
  const annotated = sp.get('annotated') ?? '';
  const dateFrom = sp.get('dateFrom') ?? '';
  const dateTo = sp.get('dateTo') ?? '';

  const updateParam = (key: string, value: string) => {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`/results?${params.toString()}`);
  };

  const query = useQuery<{ runs: RunLogListEntry[]; corrupt: string[] }>({
    queryKey: ['runlogs', skill, model, annotated, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (skill) params.set('skill', skill);
      if (model) params.set('model', model);
      if (annotated) params.set('annotated', annotated);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const res = await fetch(`/api/runlogs?${params}`);
      if (!res.ok) throw new Error(`GET /api/runlogs → ${res.status}`);
      return res.json();
    },
    // Per the plan: refetch on focus enabled for read views, so a
    // junior who alt-tabs from `RunTests.bat` sees new run logs.
    refetchOnWindowFocus: true,
  });

  const skillOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of query.data?.runs ?? []) s.add(r.skill);
    return Array.from(s).sort();
  }, [query.data]);

  const modelOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of query.data?.runs ?? []) s.add(r.model);
    return Array.from(s).sort();
  }, [query.data]);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Title order={2}>Results</Title>
        <Group>
          {skill && model ? (
            <Button
              component={Link}
              href={`/results/compare?skill=${encodeURIComponent(skill)}&model=${encodeURIComponent(model)}`}
              variant="light"
            >
              Compare last two runs for {skill}
            </Button>
          ) : null}
        </Group>
      </Group>

      {query.data?.corrupt?.length ? (
        <Alert color="yellow">
          {query.data.corrupt.length} run log file{query.data.corrupt.length === 1 ? '' : 's'} could not be read — check
          the server console.
        </Alert>
      ) : null}

      <Card withBorder>
        <Group gap="md" wrap="wrap">
          <Select
            label="Skill"
            data={skillOptions.map((s) => ({ value: s, label: s }))}
            value={skill || null}
            onChange={(v) => updateParam('skill', v ?? '')}
            clearable
            searchable
            placeholder="All skills"
            w={220}
          />
          <Select
            label="Model"
            data={modelOptions.map((s) => ({ value: s, label: s }))}
            value={model || null}
            onChange={(v) => updateParam('model', v ?? '')}
            clearable
            searchable
            placeholder="All models"
            w={220}
          />
          <Select
            label="Annotation"
            data={[
              { value: 'true', label: 'annotated' },
              { value: 'false', label: 'unannotated' },
            ]}
            value={annotated || null}
            onChange={(v) => updateParam('annotated', v ?? '')}
            clearable
            w={180}
          />
          <TextInput
            label="From"
            placeholder="2026-05-01"
            value={dateFrom}
            onChange={(e) => updateParam('dateFrom', e.currentTarget.value)}
            w={140}
          />
          <TextInput
            label="To"
            placeholder="2026-05-31"
            value={dateTo}
            onChange={(e) => updateParam('dateTo', e.currentTarget.value)}
            w={140}
          />
        </Group>
      </Card>

      {query.isLoading ? (
        <Group justify="center" p="lg">
          <Loader />
        </Group>
      ) : (query.data?.runs?.length ?? 0) === 0 ? (
        <Card withBorder>
          <Text c="dimmed">
            No run logs yet — run the harness via <code>RunTests.bat</code> (Windows) or{' '}
            <code>uv run python run_tests.py</code> from <code>eval/harness/</code>.
          </Text>
        </Card>
      ) : (
        <Card withBorder p={0}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Timestamp</Table.Th>
                <Table.Th>Test</Table.Th>
                <Table.Th>Skill</Table.Th>
                <Table.Th>Model</Table.Th>
                <Table.Th>Outcome</Table.Th>
                <Table.Th>Mean</Table.Th>
                <Table.Th>Annotated?</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {query.data!.runs.slice(0, 100).map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td>
                    <Anchor component={Link} href={`/results/${r.id}`} fw={500}>
                      {r.timestamp}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{r.testId}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {r.skill}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {r.model}
                    </Text>
                  </Table.Td>
                  <Table.Td>{outcomeBadge(r.outcome, r.flaky)}</Table.Td>
                  <Table.Td>{r.weightedMean !== null ? r.weightedMean.toFixed(2) : '—'}</Table.Td>
                  <Table.Td>
                    {r.annotated ? (
                      <Badge color="blue" variant="light">
                        annotated
                      </Badge>
                    ) : (
                      <Badge color="gray" variant="light">
                        unannotated
                      </Badge>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      <Box>
        <Text size="xs" c="dimmed">
          Showing {Math.min(100, query.data?.runs?.length ?? 0)} of {query.data?.runs?.length ?? 0} run logs
        </Text>
      </Box>
    </Stack>
  );
}

export default function ResultsListPage() {
  return (
    <Suspense fallback={<Loader />}>
      <ResultsInner />
    </Suspense>
  );
}
