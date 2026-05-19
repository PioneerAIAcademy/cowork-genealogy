'use client';

import { use } from 'react';
import Link from 'next/link';
import { Anchor, Card, Code, Group, Loader, Stack, Tabs, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { ScenarioInfo } from '@/lib/types';
import { JsonViewer } from '@/components/common/JsonViewer';
import { MarkdownViewer } from '@/components/common/MarkdownViewer';

export default function ScenarioDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const query = useQuery<{ scenario: ScenarioInfo; references: Array<{ id: string; name: string; skill: string }> }>({
    queryKey: ['scenario', name],
    queryFn: async () => {
      const res = await fetch(`/api/scenarios/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(`GET /api/scenarios/${name} → ${res.status}`);
      return res.json();
    },
  });

  if (query.isLoading) return <Loader />;
  if (!query.data) return <Text c="red">Scenario not found.</Text>;
  const { scenario, references } = query.data;

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>{scenario.name}</Title>
        <Anchor component={Link} href="/scenarios">
          ← back to scenarios
        </Anchor>
      </Group>

      <Tabs defaultValue="readme">
        <Tabs.List>
          <Tabs.Tab value="readme">README</Tabs.Tab>
          <Tabs.Tab value="research">research.json</Tabs.Tab>
          <Tabs.Tab value="tree">tree.gedcomx.json</Tabs.Tab>
          <Tabs.Tab value="references">Used by ({references.length})</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="readme" pt="md">
          {scenario.readme ? (
            <Card withBorder p="md">
              <MarkdownViewer content={scenario.readme} />
            </Card>
          ) : (
            <Text c="dimmed">No README.md.</Text>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="research" pt="md">
          {scenario.research ? <JsonViewer data={scenario.research} /> : <Text c="dimmed">No research.json.</Text>}
        </Tabs.Panel>

        <Tabs.Panel value="tree" pt="md">
          {scenario.tree ? <JsonViewer data={scenario.tree} /> : <Text c="dimmed">No tree.gedcomx.json.</Text>}
        </Tabs.Panel>

        <Tabs.Panel value="references" pt="md">
          {references.length === 0 ? (
            <Text c="dimmed">No tests reference this scenario.</Text>
          ) : (
            <Stack gap="xs">
              {references.map((r) => (
                <Group key={r.id} gap="md">
                  <Code>{r.skill}</Code>
                  <Anchor component={Link} href={`/tests/${r.id}`}>
                    {r.name}
                  </Anchor>
                </Group>
              ))}
            </Stack>
          )}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
