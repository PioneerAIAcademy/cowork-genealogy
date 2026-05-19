'use client';

import { useLocalStorage } from '@mantine/hooks';

/**
 * Cross-page "active skill" selector for genealogists who work on one
 * skill at a time. Backed by localStorage so it survives reloads and
 * stays in sync across components on the page.
 *
 * Returns `null` when nothing is selected (initial visit). Both /tests
 * and /results read this and filter their listings to a single skill.
 */
export function useSelectedSkill(): [string | null, (value: string | null) => void] {
  const [value, setValue] = useLocalStorage<string | null>({
    key: 'eval.selectedSkill',
    defaultValue: null,
    getInitialValueInEffect: true,
  });
  return [value, setValue];
}
