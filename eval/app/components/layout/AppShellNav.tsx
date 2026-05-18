'use client';

import { AppShell, Group, NavLink, Title, Box } from '@mantine/core';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SECTIONS = [
  { href: '/tests', label: 'Tests' },
  { href: '/scenarios', label: 'Scenarios' },
  { href: '/fixtures', label: 'Fixtures' },
  { href: '/results', label: 'Results' },
];

export function AppShellNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  return (
    <AppShell padding="md" header={{ height: 56 }} navbar={{ width: 220, breakpoint: 'sm' }}>
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Title order={4} c="dark">
            GeneFun Eval
          </Title>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="sm">
        {SECTIONS.map((s) => (
          <NavLink
            key={s.href}
            component={Link}
            href={s.href}
            label={s.label}
            active={pathname === s.href || pathname.startsWith(s.href + '/')}
          />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>
        <Box>{children}</Box>
      </AppShell.Main>
    </AppShell>
  );
}
