'use client';

/**
 * Unit-test create/edit form.
 *
 * - Validates shape via the generated Zod schema. Reference existence
 *   (does the scenario exist? does the fixture exist?) is NOT enforced
 *   here — those checks drive the blocked badge in the list view but
 *   never block a save. A junior whose scenario was renamed must still
 *   be able to save the test so they can fix it.
 *
 * - Skill drives the rubric sidebar (shown so authors avoid duplicating
 *   in judge_context) and visibility of the mcp_fixtures picker
 *   (stateless skills hide it).
 *
 * - When editing, a hash-change warning surfaces if any grading-relevant
 *   field changed (spec §3 / plan §2.4).
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Divider,
  Grid,
  Group,
  MultiSelect,
  Select,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useQuery } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { useSelectedSkill } from '@/lib/useSelectedSkill';
import type { ExpectedOutcome, SkillInfo, UnitTestFile, UnitTestListEntry } from '@/lib/types';

interface TestFormProps {
  mode: 'create' | 'edit';
  initialValues?: UnitTestFile;
  onSaved?: (saved: UnitTestFile) => void;
}

const EMPTY_TEST: UnitTestFile = {
  test: {
    id: '',
    skill: '',
    name: '',
    type: 'positive',
    description: '',
    tags: [],
  },
  input: {
    user_message: '',
    scenario: null,
    scenario_notes: null,
  },
  mcp_fixtures: [],
  judge_context: [],
};

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function hasGradingRelevantChange(before: UnitTestFile, after: UnitTestFile): boolean {
  if (before.input.user_message !== after.input.user_message) return true;
  if ((before.input.scenario ?? null) !== (after.input.scenario ?? null)) return true;
  if (JSON.stringify(before.mcp_fixtures ?? []) !== JSON.stringify(after.mcp_fixtures ?? [])) return true;
  if (JSON.stringify(before.judge_context) !== JSON.stringify(after.judge_context)) return true;
  if (JSON.stringify(before.negative ?? null) !== JSON.stringify(after.negative ?? null)) return true;
  // holdout survives snapshot normalization (only name/description/tags are
  // stripped), so toggling it changes the content hash. Keep this in sync with
  // GRADING_RELEVANT_FIELDS in lib/fs/tests.ts.
  if ((before.test.holdout ?? false) !== (after.test.holdout ?? false)) return true;
  // judge_reads_files likewise survives normalization and changes what the
  // judge sees — toggling it invalidates the content hash.
  if ((before.judge_reads_files ?? false) !== (after.judge_reads_files ?? false)) return true;
  // expected_outcome / xfail_reason survive normalization too, and
  // expected_outcome changes how the harness labels the result — so a run
  // log taken under the old marking no longer describes the test.
  if ((before.test.expected_outcome ?? 'pass') !== (after.test.expected_outcome ?? 'pass')) return true;
  if ((before.test.xfail_reason ?? '') !== (after.test.xfail_reason ?? '')) return true;
  return false;
}

export function TestForm({ mode, initialValues, onSaved }: TestFormProps) {
  const router = useRouter();
  const [headerSkill] = useSelectedSkill();

  const form = useForm<UnitTestFile>({
    initialValues: initialValues ? deepClone(initialValues) : deepClone(EMPTY_TEST),
    validate: {
      test: {
        skill: (v) => (v?.trim() ? null : 'Skill is required'),
        name: (v) => (v?.trim() ? null : 'Name is required'),
        description: (v) => (v?.trim() ? null : 'Description is required'),
        // The schema makes xfail_reason conditionally required (see
        // unit-test.schema.json's if/then). Nothing validates the file
        // server-side, so this form is the enforcement point.
        xfail_reason: (v, values) =>
          values.test.expected_outcome === 'xfail' && !(v ?? '').trim()
            ? 'A reason is required when the expected outcome is xfail'
            : null,
      },
      input: {
        user_message: (v) => (v?.trim() ? null : 'user_message is required'),
      },
    },
  });

  const skillsQuery = useQuery<{ skills: SkillInfo[] }>({
    queryKey: ['skills'],
    queryFn: async () => {
      const res = await fetch('/api/skills');
      if (!res.ok) throw new Error(`GET /api/skills → ${res.status}`);
      return res.json();
    },
    // The form is an edit view; alt-tabbing back shouldn't reset the in-progress
    // form to defaults from a re-fetch.
    refetchOnWindowFocus: false,
  });

  const scenariosQuery = useQuery<{ scenarios: Array<{ name: string; description: string | null }> }>({
    queryKey: ['scenarios-for-form'],
    queryFn: async () => (await fetch('/api/scenarios')).json(),
    refetchOnWindowFocus: false,
  });

  const fixturesQuery = useQuery<{ fixtures: Array<{ name: string; tool: string | null; description: string | null }> }>({
    queryKey: ['fixtures-for-form'],
    queryFn: async () => (await fetch('/api/fixtures')).json(),
    refetchOnWindowFocus: false,
  });

  // Drives the autocomplete for the Tags field. Pulls the unique tags
  // already in use across all tests so genealogists can pick from the
  // existing taxonomy instead of inventing one-off spellings.
  const testsQuery = useQuery<{ tests: UnitTestListEntry[] }>({
    queryKey: ['tests-for-tags'],
    queryFn: async () => (await fetch('/api/tests')).json(),
    refetchOnWindowFocus: false,
  });
  const existingTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of testsQuery.data?.tests ?? []) {
      for (const tag of t.tags ?? []) {
        if (tag) set.add(tag);
      }
    }
    return Array.from(set).sort();
  }, [testsQuery.data]);

  const selectedSkill = useMemo(
    () => skillsQuery.data?.skills.find((s) => s.name === form.values.test.skill) ?? null,
    [skillsQuery.data, form.values.test.skill],
  );

  // When skill changes, clear mcp_fixtures if the new skill is stateless.
  useEffect(() => {
    if (selectedSkill?.stateless && (form.values.mcp_fixtures?.length ?? 0) > 0) {
      form.setFieldValue('mcp_fixtures', []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSkill?.name]);

  // Pre-fill Skill from the sticky header picker for new tests. Runs once
  // when headerSkill loads from localStorage (which happens post-mount via
  // useEffect inside useLocalStorage). Doesn't overwrite a user pick.
  useEffect(() => {
    if (mode === 'create' && !initialValues && !form.values.test.skill && headerSkill) {
      form.setFieldValue('test.skill', headerSkill);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerSkill]);

  const [hashWarning, setHashWarning] = useState<string | null>(null);

  // Watch grading-relevant fields against the initialValues snapshot.
  useEffect(() => {
    if (mode !== 'edit' || !initialValues) {
      setHashWarning(null);
      return;
    }
    const changed = hasGradingRelevantChange(initialValues, form.values);
    setHashWarning(
      changed
        ? 'This edit changes the test\'s content hash — it will be excluded from cross-PR comparison for one PR.'
        : null,
    );
  }, [form.values, initialValues, mode]);

  const isNegative = form.values.test.type === 'negative';
  const isXfail = form.values.test.expected_outcome === 'xfail';

  const onSubmit = form.onSubmit(async (values) => {
    const payload = deepClone(values);

    // Negative tests must carry `negative`; positive tests must not.
    if (isNegative) {
      if (!payload.negative) payload.negative = { correct_skill: [], explanation: '' };
      payload.negative.correct_skill = payload.negative.correct_skill ?? [];
      payload.negative.explanation = payload.negative.explanation ?? '';
    } else {
      delete payload.negative;
    }
    // holdout defaults to false (schema default) — only persist the key when
    // true, so existing tests that never opted in keep their content hash.
    if (payload.test.holdout) payload.test.holdout = true;
    else delete payload.test.holdout;
    // judge_reads_files defaults to false — same treatment: only persist when
    // true so tests that never opt in keep their content hash unchanged.
    if (payload.judge_reads_files) payload.judge_reads_files = true;
    else delete payload.judge_reads_files;
    // expected_outcome defaults to "pass" — same treatment. xfail_reason is
    // only meaningful alongside `xfail`, so drop it when the test is back to
    // pass rather than leaving a stale reason in the file.
    if (payload.test.expected_outcome === 'xfail') {
      payload.test.xfail_reason = (payload.test.xfail_reason ?? '').trim();
    } else {
      delete payload.test.expected_outcome;
      delete payload.test.xfail_reason;
    }
    // Empty string scenarios → null so the API/file shape matches the schema.
    if (payload.input.scenario === '') payload.input.scenario = null;
    if (payload.input.scenario_notes === '') payload.input.scenario_notes = null;
    // Strip empty judge-context entries.
    payload.judge_context = (payload.judge_context ?? []).map((s) => s.trim()).filter(Boolean);

    try {
      const url = mode === 'create' ? '/api/tests' : `/api/tests/${payload.test.id}`;
      const method = mode === 'create' ? 'POST' : 'PUT';
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
      }
      const json = await res.json();
      notifications.show({ color: 'green', title: 'Saved', message: `Test ${mode === 'create' ? 'created' : 'updated'}.` });
      onSaved?.(payload);
      if (mode === 'create' && json.id) {
        router.push(`/tests/${json.id}`);
      } else {
        router.push('/tests');
      }
    } catch (err) {
      notifications.show({ color: 'red', title: 'Save failed', message: (err as Error).message });
    }
  });

  const scenarioOptions = (scenariosQuery.data?.scenarios ?? []).map((s) => ({ value: s.name, label: s.name }));
  const fixtureOptions = (fixturesQuery.data?.fixtures ?? []).map((f) => ({ value: f.name, label: f.tool ? `${f.name}  (${f.tool})` : f.name }));
  const skillOptions = (skillsQuery.data?.skills ?? []).map((s) => ({ value: s.name, label: s.name }));

  return (
    <form onSubmit={onSubmit}>
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Stack gap="md">
            <Card withBorder>
              <Stack gap="sm">
                <Group grow>
                  <Select
                    label="Skill"
                    placeholder="Pick a skill"
                    data={skillOptions}
                    searchable
                    required
                    {...form.getInputProps('test.skill')}
                    onChange={(v) => form.setFieldValue('test.skill', v ?? '')}
                    value={form.values.test.skill || null}
                  />
                  <Select
                    label="Type"
                    data={[
                      { value: 'positive', label: 'positive — skill should activate' },
                      { value: 'negative', label: 'negative — skill should decline' },
                    ]}
                    {...form.getInputProps('test.type')}
                  />
                </Group>

                <TextInput label="Name" required {...form.getInputProps('test.name')} />
                <Textarea
                  label="Description"
                  description="1–2 sentences explaining what this test verifies and why it matters."
                  autosize
                  minRows={2}
                  required
                  {...form.getInputProps('test.description')}
                />
                <TagsInput
                  label="Tags"
                  description="Pick from existing tags or type a new one and press Enter."
                  data={existingTags}
                  value={form.values.test.tags}
                  onChange={(t) => form.setFieldValue('test.tags', t)}
                  acceptValueOnBlur
                  clearable
                  splitChars={[',']}
                />
                <Switch
                  label="Hold out from the skill-improver"
                  description="Reserve this test as a generalization check. The body-optimizer won't read or tune against it when proposing SKILL.md edits — it only checks afterward whether the edit helped. The harness still runs, grades, and releases it like any other test. Mark ~2–3 diverse, representative tests and keep them stable."
                  checked={!!form.values.test.holdout}
                  onChange={(e) => form.setFieldValue('test.holdout', e.currentTarget.checked)}
                />
                <Switch
                  label="Let the judge read this skill's written files"
                  description="When on, the harness shows the LLM judge the actual content this test wrote to research.json / tree.gedcomx.json (truncated), not just a summary of what changed. Enable it for skills whose graded output is written to a file rather than echoed in the chat reply (e.g. proof-conclusion's proof narrative). Default off; leave off for skills graded on their chat response."
                  checked={!!form.values.judge_reads_files}
                  onChange={(e) => form.setFieldValue('judge_reads_files', e.currentTarget.checked)}
                />
                <Select
                  label="Expected outcome"
                  description="Mark a test xfail when you know it fails for a documented reason and you don't want that failure read as a regression. Its failures report as xfail instead of fail; if it starts passing, the harness reports xpass so you know to investigate and remove the marker."
                  data={[
                    { value: 'pass', label: 'pass — the test should pass' },
                    { value: 'xfail', label: 'xfail — known failure, not a regression' },
                  ]}
                  value={form.values.test.expected_outcome ?? 'pass'}
                  onChange={(v) => {
                    const next = (v as ExpectedOutcome) ?? 'pass';
                    form.setFieldValue('test.expected_outcome', next);
                    // Seed the reason so the Textarea below is controlled from
                    // its first render — getInputProps on an absent path hands
                    // back `undefined`, which React reads as uncontrolled.
                    if (next === 'xfail' && form.values.test.xfail_reason == null) {
                      form.setFieldValue('test.xfail_reason', '');
                    }
                  }}
                />
                {isXfail ? (
                  <Textarea
                    label="Why is this expected to fail?"
                    description="Required. Say what's broken and what would let you remove the marker — ideally with an issue or PR link."
                    placeholder="Skill drops the source citation on multi-page records — #712. Remove once that ships."
                    autosize
                    minRows={2}
                    required
                    {...form.getInputProps('test.xfail_reason')}
                  />
                ) : null}
              </Stack>
            </Card>

            <Card withBorder>
              <Stack gap="sm">
                <Title order={5}>Input</Title>
                <Textarea
                  label="User message"
                  description="The exact user input fed to the test harness."
                  autosize
                  minRows={3}
                  required
                  {...form.getInputProps('input.user_message')}
                />
                <Group grow>
                  <Select
                    label="Scenario"
                    description={selectedSkill?.stateless ? 'Stateless skill — scenario optional.' : undefined}
                    placeholder={scenarioOptions.length === 0 ? 'No scenarios available' : 'Pick a scenario'}
                    data={scenarioOptions}
                    clearable
                    searchable
                    value={form.values.input.scenario ?? null}
                    onChange={(v) => form.setFieldValue('input.scenario', v)}
                  />
                </Group>
                {!selectedSkill?.stateless ? (
                  <MultiSelect
                    label="MCP fixtures"
                    description={
                      selectedSkill
                        ? `${selectedSkill.name} declares allowed-tools — pick fixtures for the tool calls this test triggers.`
                        : 'Pick a skill first to see fixtures.'
                    }
                    data={fixtureOptions}
                    searchable
                    value={form.values.mcp_fixtures ?? []}
                    onChange={(v) => form.setFieldValue('mcp_fixtures', v)}
                  />
                ) : null}
              </Stack>
            </Card>

            <Card withBorder>
              <Stack gap="sm">
                <Title order={5}>Judge context</Title>
                <Textarea
                  description="Background the AI judge should know when scoring this test. For example: 'A correct answer should mention the 1850 census' or 'Look for emigration records, not just baptism records'. Leave blank if no extra context is needed."
                  autosize
                  minRows={3}
                  value={(form.values.judge_context ?? []).join('\n\n')}
                  onChange={(e) => {
                    const txt = e.currentTarget.value;
                    form.setFieldValue(
                      'judge_context',
                      txt.trim() ? txt.split('\n\n').map((s) => s.trim()).filter(Boolean) : [],
                    );
                  }}
                />
              </Stack>
            </Card>

            {isNegative ? (
              <Card withBorder>
                <Stack gap="sm">
                  <Title order={5}>Negative test</Title>
                  <MultiSelect
                    label="Correct skill(s) for this request"
                    description="Empty = no skill should fire (out-of-scope user message)."
                    data={skillOptions}
                    searchable
                    value={form.values.negative?.correct_skill ?? []}
                    onChange={(v) =>
                      form.setFieldValue('negative', {
                        correct_skill: v,
                        explanation: form.values.negative?.explanation ?? '',
                      })
                    }
                  />
                  <Textarea
                    label="Explanation"
                    description="Why the tested skill should not activate. Documents the boundary."
                    autosize
                    minRows={3}
                    value={form.values.negative?.explanation ?? ''}
                    onChange={(e) =>
                      form.setFieldValue('negative', {
                        correct_skill: form.values.negative?.correct_skill ?? [],
                        explanation: e.currentTarget.value,
                      })
                    }
                  />
                </Stack>
              </Card>
            ) : null}

            {hashWarning ? (
              <Alert color="yellow" title="Content hash will change">
                {hashWarning} You may proceed — the senior reviewing your PR will see the diff.
              </Alert>
            ) : null}

            <Group justify="space-between">
              <Button variant="default" onClick={() => router.push('/tests')}>
                Cancel
              </Button>
              <Button type="submit">{mode === 'create' ? 'Create test' : 'Save'}</Button>
            </Group>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 4 }}>
          <Stack gap="md">
            <Card withBorder>
              <Stack gap="xs">
                <Title order={5}>Rubric</Title>
                {!selectedSkill ? (
                  <Text size="sm" c="dimmed">
                    Pick a skill to see its rubric dimensions.
                  </Text>
                ) : selectedSkill.rubricDimensions.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    No rubric.md found for {selectedSkill.name}.
                  </Text>
                ) : (
                  <Stack gap="sm">
                    {selectedSkill.rubricDimensions.map((d) => (
                      <Box key={d.name}>
                        <Text fw={600} size="sm">
                          {d.name}
                        </Text>
                        {d.description ? (
                          <Text size="xs" c="dimmed">
                            {d.description}
                          </Text>
                        ) : null}
                      </Box>
                    ))}
                  </Stack>
                )}
              </Stack>
            </Card>
            <Card withBorder>
              <Stack gap="xs">
                <Title order={5}>Skill metadata</Title>
                {selectedSkill ? (
                  <>
                    <Text size="sm">{selectedSkill.description ?? '—'}</Text>
                    <Divider />
                    <Group gap={4} wrap="wrap">
                      <Text size="xs" c="dimmed">
                        Allowed tools:
                      </Text>
                      {selectedSkill.allowedTools.length === 0 ? (
                        <Badge size="xs" variant="light">
                          stateless
                        </Badge>
                      ) : (
                        selectedSkill.allowedTools.map((t) => (
                          <Code key={t}>
                            {t}
                          </Code>
                        ))
                      )}
                    </Group>
                  </>
                ) : (
                  <Text size="sm" c="dimmed">
                    Pick a skill to see its metadata.
                  </Text>
                )}
              </Stack>
            </Card>
          </Stack>
        </Grid.Col>
      </Grid>
    </form>
  );
}

