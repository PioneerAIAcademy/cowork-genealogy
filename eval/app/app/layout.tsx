import type { Metadata } from 'next';
import { ColorSchemeScript, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { Providers } from './providers';
import { AppShellNav } from '@/components/layout/AppShellNav';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Genealogy Skill Eval',
  description: 'CRUD UI for genealogy skill evaluations',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-mantine-color-scheme="light">
      <head>
        <ColorSchemeScript defaultColorScheme="light" />
      </head>
      <body>
        <MantineProvider defaultColorScheme="light">
          <Notifications />
          <Providers>
            <AppShellNav>{children}</AppShellNav>
          </Providers>
        </MantineProvider>
      </body>
    </html>
  );
}
