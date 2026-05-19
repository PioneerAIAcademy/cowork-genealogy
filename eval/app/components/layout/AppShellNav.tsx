'use client';

import { AppShell, Box, Group, Stack, Title, Tooltip } from '@mantine/core';
import {
  IconClipboardCheck,
  IconDatabase,
  IconFlask,
  IconStack2,
  type IconProps,
} from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';

interface Section {
  href: string;
  label: string;
  Icon: ComponentType<IconProps>;
}

const SECTIONS: Section[] = [
  { href: '/tests', label: 'Tests', Icon: IconFlask },
  { href: '/scenarios', label: 'Scenarios', Icon: IconStack2 },
  { href: '/fixtures', label: 'Fixtures', Icon: IconDatabase },
  { href: '/results', label: 'Results', Icon: IconClipboardCheck },
];

const NAVBAR_WIDTH = 56;

export function AppShellNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  return (
    <AppShell padding="md" header={{ height: 56 }} navbar={{ width: NAVBAR_WIDTH, breakpoint: 0 }}>
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Title order={4} c="dark">
            Genealogy Skill Eval
          </Title>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p={0} style={{ background: 'var(--mantine-color-gray-0)' }}>
        <Stack gap={0} align="stretch" pt={4}>
          {SECTIONS.map(({ href, label, Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/');
            return (
              <Tooltip key={href} label={label} position="right" withArrow openDelay={300}>
                <Box
                  component={Link}
                  href={href}
                  aria-label={label}
                  data-active={active || undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 48,
                    color: active
                      ? 'var(--mantine-color-blue-6)'
                      : 'var(--mantine-color-gray-7)',
                    borderLeft: active
                      ? '3px solid var(--mantine-color-blue-6)'
                      : '3px solid transparent',
                    textDecoration: 'none',
                    transition: 'color 120ms, background 120ms',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background =
                      'var(--mantine-color-gray-1)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }}
                >
                  <Icon size={22} stroke={1.75} />
                </Box>
              </Tooltip>
            );
          })}
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
