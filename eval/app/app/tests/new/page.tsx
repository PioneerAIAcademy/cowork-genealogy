'use client';

import { Stack, Title, Group, Anchor } from '@mantine/core';
import Link from 'next/link';
import { TestForm } from '@/components/forms/TestForm';

export default function NewTestPage() {
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>New test</Title>
        <Anchor component={Link} href="/tests">
          ← back to tests
        </Anchor>
      </Group>
      <TestForm mode="create" />
    </Stack>
  );
}
