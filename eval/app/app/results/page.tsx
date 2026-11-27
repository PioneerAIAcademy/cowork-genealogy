'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSelectedSkill } from '@/lib/useSelectedSkill';
import type { RunLogListEntry } from '@/lib/types';

function kindBadge(entry: RunLogListEntry) {
  if (entry.kind === 'candidate') {
    return <Badge color="blue" variant="light">v{entry.version} candidate</Badge>;
  }
  if (entry.kind === 'scratch') {
    return <Badge color="gray" variant="outline">scratch</Badge>;
  }
  return <Badge color="gray">other</Badge>;
}

function isDeletable(entry: RunLogListEntry): boolean {
  return entry.kind === 'candidate';
}

export default function ResultsPage() {
  const [selectedSkill] = useSelectedSkill();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();

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

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setSkillSelection = (skill: string, ids: string[], checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const deleteSelectedForSkill = async (skill: string, ids: string[]) => {
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} run log(s) for ${skill}? Each .json and .ann.json will be removed.`)) {
      return;
    }
    setDeleting(true);
    const failures: string[] = [];
    for (const id of ids) {
      try {
        const res = await fetch(`/api/runlogs/${id}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'delete' }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          failures.push(`${id}: ${body.error ?? res.status}`);
        }
      } catch (e) {
        failures.push(`${id}: ${(e as Error).message}`);
      }
    }
    setDeleting(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    qc.invalidateQueries({ queryKey: ['runlogs'] });
    if (failures.length > 0) {
      alert(`Some deletes failed:\n${failures.join('\n')}`);
    }
  };

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
        <Button component={Link} href="/results/compare" variant="default">
          Compare versions
        </Button>
      </Group>

      {query.data?.corrupt && query.data.corrupt.length > 0 ? (
        <Alert color="yellow" title="Some run logs failed to parse">
          {query.data.corrupt.map((p) => (
            <Text key={p} size="xs" ff="monospace">{p}</Text>
          ))}
        </Alert>
      ) : null}

      {!selectedSkill ? (
        <Card withBorder>
          <Text c="dimmed">Pick a skill in the header to see its run logs.</Text>
        </Card>
      ) : null}

      {selectedSkill && skillsWithRuns.filter(([s]) => s === selectedSkill).length === 0 ? (
        <Card withBorder>
          <Text c="dimmed">No run logs yet for {selectedSkill}.</Text>
        </Card>
      ) : null}

      {skillsWithRuns
        .filter(([s]) => selectedSkill && s === selectedSkill)
        .map(([skill, runs]) => {
          const deletableIds = runs
            .filter(isDeletable)
            .map((r) => r.id);
          const selectedForSkill = deletableIds.filter((id) => selectedIds.has(id));
          const allSelected = deletableIds.length > 0 && selectedForSkill.length === deletableIds.length;
          const someSelected = selectedForSkill.length > 0 && !allSelected;

          return (
            <Card key={skill} withBorder>
              <Group justify="space-between" mb="xs">
                <Title order={4}>{skill}</Title>
                <Group gap="sm">
                  {selectedForSkill.length > 0 ? (
                    <Button
                      size="xs"
                      color="red"
                      variant="light"
                      loading={deleting}
                      onClick={() => deleteSelectedForSkill(skill, selectedForSkill)}
                    >
                      Delete {selectedForSkill.length} selected
                    </Button>
                  ) : null}
                </Group>
              </Group>
              <Table striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ width: 36 }}>
                      {deletableIds.length > 0 ? (
                        <Checkbox
                          aria-label={`select all run logs for ${skill}`}
                          checked={allSelected}
                          indeterminate={someSelected}
                          onChange={(e) =>
                            setSkillSelection(skill, deletableIds, e.currentTarget.checked)
                          }
                        />
                      ) : null}
                    </Table.Th>
                    <Table.Th>Run</Table.Th>
                    <Table.Th>Timestamp</Table.Th>
                    <Table.Th>Tests</Table.Th>
                    <Table.Th>Weighted mean</Table.Th>
                    <Table.Th>Annotation</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {runs.map((r) => {
                    const selectable = isDeletable(r);
                    return (
                      <Table.Tr key={r.id}>
                        <Table.Td>
                          {selectable ? (
                            <Checkbox
                              aria-label={`select ${r.id}`}
                              checked={selectedIds.has(r.id)}
                              onChange={() => toggleId(r.id)}
                            />
                          ) : null}
                        </Table.Td>
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
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Card>
          );
        })}
    </Stack>
  );
}
