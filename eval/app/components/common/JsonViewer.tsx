'use client';

import { Card, ScrollArea } from '@mantine/core';

export function JsonViewer({ data }: { data: unknown }) {
  return (
    <Card withBorder p={0}>
      <ScrollArea h={500} type="auto">
        <pre style={{ margin: 0, padding: '12px 16px', fontSize: 13, lineHeight: 1.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </ScrollArea>
    </Card>
  );
}
