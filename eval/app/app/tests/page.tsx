'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
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
  Tooltip,
  Alert,
  Box,
  TextInput,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useSelectedSkill } from '@/lib/useSelectedSkill';
import type { UnitTestListEntry, BlockedReason } from '@/lib/types';

interface TestsListResponse {
  tests: UnitTestListEntry[];
  corrupt: string[];
}

function blockedReasonText(b: BlockedReason): string {
  switch (b.kind) {
    case 'missing-scenario':
      return `Scenario "${b.scenario}" does not exist.`;
    case 'missing-fixture':
      return `MCP fixture "${b.fixture}" does not exist.`;
    case 'scenario-notes-present':
      return `scenario_notes is set — needs a matching scenario.`;
  }
}

function TestsListInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const [selectedSkill] = useSelectedSkill();

  // Skill selection is global, sticky, lives in the header. The remaining
  // filters (type, tag, q) stay as URL params so they're shareable.
  const skill = selectedSkill ?? '';
  const type = sp.get('type') ?? '';
  const tag = sp.get('tag') ?? '';
  const q = sp.get('q') ?? '';

  const updateParam = (key: string, value: string) => {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`/tests?${params.toString()}`);
  };

  const query = useQuery<TestsListResponse>({
    queryKey: ['tests'],
    queryFn: async () => {
      const res = await fetch('/api/tests');
      if (!res.ok) throw new Error(`GET /api/tests → ${res.status}`);
      return res.json();
    },
  });

  const filtered = useMemo(() => {
    const tests = query.data?.tests ?? [];
    return tests.filter((t) => {
      if (skill && t.skill !== skill) return false;
      if (type && t.type !== type) return false;
      if (tag && !t.tags.includes(tag)) return false;
      if (q && !`${t.name} ${t.description}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [query.data, skill, type, tag, q]);

  const tagOptions = useMemo(() => {
    const s = new Set<string>();
    for (const t of query.data?.tests ?? []) for (const tag of t.tags) s.add(tag);
    return Array.from(s).sort();
  }, [query.data]);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Title order={2}>Tests</Title>
        {selectedSkill ? (
          <Button component={Link} href="/tests/new">
            New test
          </Button>
        ) : (
          <Tooltip label="Pick a skill in the header first" withArrow>
            <Button disabled data-disabled>
              New test
            </Button>
          </Tooltip>
        )}
      </Group>

      {query.data?.corrupt?.length ? (
        <Alert color="yellow">
          {query.data.corrupt.length} test file{query.data.corrupt.length === 1 ? '' : 's'} could not be parsed — check
          the server console for paths.
        </Alert>
      ) : null}

      <Card withBorder>
        <Group gap="md" wrap="wrap">
          <Select
            label="Type"
            placeholder="All types"
            data={[
              { value: 'positive', label: 'positive' },
              { value: 'negative', label: 'negative' },
            ]}
            value={type || null}
            onChange={(v) => updateParam('type', v ?? '')}
            clearable
            w={160}
          />
          <Select
            label="Tag"
            placeholder="Any tag"
            data={tagOptions.map((t) => ({ value: t, label: t }))}
            value={tag || null}
            onChange={(v) => updateParam('tag', v ?? '')}
            clearable
            searchable
            w={200}
          />
          <TextInput
            label="Search"
            placeholder="name / description"
            value={q}
            onChange={(e) => updateParam('q', e.currentTarget.value)}
            w={240}
          />
        </Group>
      </Card>

      {!selectedSkill ? (
        <Card withBorder>
          <Text c="dimmed">Pick a skill in the header to see its tests.</Text>
        </Card>
      ) : query.isLoading ? (
        <Group justify="center" p="lg">
          <Loader />
        </Group>
      ) : filtered.length === 0 ? (
        <Card withBorder>
          <Text c="dimmed">
            {query.data?.tests?.length === 0
              ? 'No tests yet — see eval/README.md to add your first one, or click "New test".'
              : 'No tests match the current filters.'}
          </Text>
        </Card>
      ) : (
        <Card withBorder p={0}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Status</Table.Th>
                <Table.Th>Name</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Scenario</Table.Th>
                <Table.Th>Tags</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.map((t) => (
                <Table.Tr key={t.id}>
                  <Table.Td>
                    {t.blocked ? (
                      <Tooltip label={blockedReasonText(t.blocked)} withArrow>
                        <Badge color="orange" variant="light">
                          blocked
                        </Badge>
                      </Tooltip>
                    ) : (
                      <Badge color="green" variant="light">
                        ok
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Anchor component={Link} href={`/tests/${t.id}`} fw={500}>
                      {t.name}
                    </Anchor>
                    <Text size="xs" c="dimmed">
                      {t.id}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="outline" color={t.type === 'positive' ? 'blue' : 'gray'}>
                      {t.type}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{t.scenario ?? <Text component="span" c="dimmed">—</Text>}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="wrap">
                      {t.tags.map((tag) => (
                        <Badge key={tag} size="xs" variant="light">
                          {tag}
                        </Badge>
                      ))}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      <Box>
        <Text size="xs" c="dimmed">
          {filtered.length} of {query.data?.tests?.length ?? 0} tests shown
        </Text>
      </Box>
    </Stack>
  );
}

export default function TestsListPage() {
  return (
    <Suspense fallback={<Loader />}>
      <TestsListInner />
    </Suspense>
  );
}
