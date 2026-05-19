'use client';

import { AppShell, Box, Group, Select, Stack, Text, Title, Tooltip } from '@mantine/core';
import {
  IconClipboardCheck,
  IconDatabase,
  IconFlask,
  IconStack2,
  type IconProps,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';
import { useSelectedSkill } from '@/lib/useSelectedSkill';
import type { SkillInfo } from '@/lib/types';

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

function HeaderSkillPicker() {
  const [selected, setSelected] = useSelectedSkill();
  const { data } = useQuery<{ skills: SkillInfo[] }>({
    queryKey: ['skills'],
    queryFn: async () => (await fetch('/api/skills')).json(),
    refetchOnWindowFocus: false,
  });
  const options = (data?.skills ?? []).map((s) => ({ value: s.name, label: s.name }));
  return (
    <Group gap="xs" align="center">
      <Text size="sm" c="dimmed">
        Skill:
      </Text>
      <Select
        size="xs"
        placeholder="(none — pick a skill)"
        data={options}
        searchable
        clearable
        value={selected}
        onChange={(v) => setSelected(v)}
        w={240}
      />
    </Group>
  );
}

export function AppShellNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  return (
    <AppShell padding="md" header={{ height: 56 }} navbar={{ width: NAVBAR_WIDTH, breakpoint: 0 }}>
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Title order={4} c="dark">
            Genealogy Skill Eval
          </Title>
          <HeaderSkillPicker />
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
