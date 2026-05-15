'use client';

import { use } from 'react';
import Link from 'next/link';
import { Anchor, Button, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { notifications } from '@mantine/notifications';
import { TestForm } from '@/components/forms/TestForm';
import type { UnitTestFile } from '@/lib/types';

export default function EditTestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const query = useQuery<{ test: UnitTestFile; filePath: string }>({
    queryKey: ['test', id],
    queryFn: async () => {
      const res = await fetch(`/api/tests/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`GET /api/tests/${id} → ${res.status}`);
      return res.json();
    },
    refetchOnWindowFocus: false,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tests/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      notifications.show({ color: 'gray', title: 'Deleted', message: `${id} removed.` });
      router.push('/tests');
    },
    onError: (err) => {
      notifications.show({ color: 'red', title: 'Delete failed', message: (err as Error).message });
    },
  });

  if (query.isLoading) return <Loader />;
  if (!query.data) return <Text c="red">Test not found.</Text>;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Stack gap={2}>
          <Title order={2}>{query.data.test.test.name}</Title>
          <Text size="xs" c="dimmed">
            {query.data.test.test.id}
          </Text>
        </Stack>
        <Group>
          <Anchor component={Link} href="/tests">
            ← back to tests
          </Anchor>
          <Button
            variant="subtle"
            color="red"
            onClick={() => {
              if (confirm(`Delete ${id}? This cannot be undone.`)) deleteMutation.mutate();
            }}
            loading={deleteMutation.isPending}
          >
            Delete test
          </Button>
        </Group>
      </Group>
      <TestForm mode="edit" initialValues={query.data.test} />
    </Stack>
  );
}
