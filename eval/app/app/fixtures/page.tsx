'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Anchor,
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

interface FixtureListEntry {
  name: string;
  tool: string | null;
  description: string | null;
  usageCount: number;
}

export default function FixturesListPage() {
  const [tool, setTool] = useState<string | null>(null);

  const query = useQuery<{ fixtures: FixtureListEntry[]; corrupt: string[] }>({
    queryKey: ['fixtures'],
    queryFn: async () => {
      const res = await fetch('/api/fixtures');
      if (!res.ok) throw new Error(`GET /api/fixtures → ${res.status}`);
      return res.json();
    },
  });

  const toolOptions = useMemo(() => {
    const s = new Set<string>();
    for (const f of query.data?.fixtures ?? []) if (f.tool) s.add(f.tool);
    return Array.from(s).sort();
  }, [query.data]);

  const filtered = useMemo(
    () => (query.data?.fixtures ?? []).filter((f) => !tool || f.tool === tool),
    [query.data, tool],
  );

  return (
    <Stack gap="md">
      <Title order={2}>MCP Fixtures</Title>
      <Text size="sm" c="dimmed">
        Mocked MCP tool responses used in tests. Read-only in Phase 1.
      </Text>

      {query.data?.corrupt?.length ? (
        <Alert color="yellow">
          {query.data.corrupt.length} fixture file{query.data.corrupt.length === 1 ? '' : 's'} could not be parsed.
        </Alert>
      ) : null}

      <Card withBorder>
        <Group gap="md">
          <Select
            label="Tool"
            data={toolOptions.map((t) => ({ value: t, label: t }))}
            value={tool}
            onChange={setTool}
            clearable
            searchable
            placeholder="All tools"
            w={280}
          />
        </Group>
      </Card>

      {query.isLoading ? (
        <Group justify="center" p="lg">
          <Loader />
        </Group>
      ) : filtered.length === 0 ? (
        <Card withBorder>
          <Text c="dimmed">
            {query.data?.fixtures?.length === 0
              ? 'No fixtures yet — add JSON files under eval/fixtures/mcp/.'
              : 'No fixtures match the current filter.'}
          </Text>
        </Card>
      ) : (
        <Card withBorder p={0}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Tool</Table.Th>
                <Table.Th>Description</Table.Th>
                <Table.Th>Tests using</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.map((f) => (
                <Table.Tr key={f.name}>
                  <Table.Td>
                    <Anchor component={Link} href={`/fixtures/${f.name}`} fw={500}>
                      {f.name}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{f.tool}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {f.description ?? '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>{f.usageCount}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
    </Stack>
  );
}
