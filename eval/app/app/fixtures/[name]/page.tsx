'use client';

import { use } from 'react';
import Link from 'next/link';
import { Anchor, Card, Code, Group, Loader, Stack, Tabs, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { McpFixtureFile } from '@/lib/types';
import { JsonViewer } from '@/components/common/JsonViewer';

export default function FixtureDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const query = useQuery<{
    fixture: McpFixtureFile;
    references: Array<{ id: string; name: string; skill: string }>;
  }>({
    queryKey: ['fixture', name],
    queryFn: async () => {
      const res = await fetch(`/api/fixtures/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(`GET /api/fixtures/${name} → ${res.status}`);
      return res.json();
    },
  });

  if (query.isLoading) return <Loader />;
  if (!query.data) return <Text c="red">Fixture not found.</Text>;
  const { fixture, references } = query.data;

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>{name}</Title>
        <Anchor component={Link} href="/fixtures">
          ← back to fixtures
        </Anchor>
      </Group>

      <Card withBorder>
        <Stack gap={6}>
          <Group gap="md">
            <Text size="sm" c="dimmed">
              Tool:
            </Text>
            <Code>{fixture.tool ?? '—'}</Code>
          </Group>
          {fixture.description ? <Text size="sm">{fixture.description}</Text> : null}
          <Group gap="md" align="flex-start">
            <Text size="sm" c="dimmed" style={{ minWidth: 80 }}>
              Expected args:
            </Text>
            <Code block style={{ whiteSpace: 'pre-wrap', flex: 1 }}>
              {JSON.stringify(fixture.args ?? {}, null, 2)}
            </Code>
          </Group>
          <Text size="xs" c="dimmed">
            Drives dispatch (which fixture answers a given call) AND the Tool
            Arguments base grading dimension. `~`-prefixed strings are
            case-insensitive substring matches.
          </Text>
        </Stack>
      </Card>

      <Tabs defaultValue="response">
        <Tabs.List>
          <Tabs.Tab value="response">Response</Tabs.Tab>
          <Tabs.Tab value="full">Full JSON</Tabs.Tab>
          <Tabs.Tab value="references">Used by ({references.length})</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="response" pt="md">
          <JsonViewer data={fixture.response} />
        </Tabs.Panel>

        <Tabs.Panel value="full" pt="md">
          <JsonViewer data={fixture} />
        </Tabs.Panel>

        <Tabs.Panel value="references" pt="md">
          {references.length === 0 ? (
            <Text c="dimmed">No tests reference this fixture.</Text>
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
