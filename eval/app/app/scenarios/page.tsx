'use client';

import Link from 'next/link';
import { Anchor, Card, Group, Loader, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';

interface ScenarioListEntry {
  name: string;
  description: string | null;
  usageCount: number;
}

export default function ScenariosListPage() {
  const query = useQuery<{ scenarios: ScenarioListEntry[] }>({
    queryKey: ['scenarios'],
    queryFn: async () => {
      const res = await fetch('/api/scenarios');
      if (!res.ok) throw new Error(`GET /api/scenarios → ${res.status}`);
      return res.json();
    },
  });

  return (
    <Stack gap="md">
      <Title order={2}>Scenarios</Title>
      <Text size="sm" c="dimmed">
        Project-state fixtures (research.json + tree.gedcomx.json). Read-only in Phase 1 — devs author scenarios outside the
        UI.
      </Text>

      {query.isLoading ? (
        <Group justify="center" p="lg">
          <Loader />
        </Group>
      ) : (query.data?.scenarios?.length ?? 0) === 0 ? (
        <Card withBorder>
          <Text c="dimmed">No scenarios yet — see eval/README.md to add one under eval/fixtures/scenarios/.</Text>
        </Card>
      ) : (
        <Card withBorder p={0}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Description</Table.Th>
                <Table.Th>Tests using</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {query.data!.scenarios.map((s) => (
                <Table.Tr key={s.name}>
                  <Table.Td>
                    <Anchor component={Link} href={`/scenarios/${s.name}`} fw={500}>
                      {s.name}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {s.description ?? '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>{s.usageCount}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
    </Stack>
  );
}
