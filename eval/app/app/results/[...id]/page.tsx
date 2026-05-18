'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Code,
  CopyButton,
  Divider,
  Grid,
  Group,
  Kbd,
  Loader,
  Modal,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AnnotationCorrection,
  AnnotationFile,
  RunLogDimension,
  RunLogFile,
  TestEntry,
} from '@/lib/types';

interface Detail {
  runLog: RunLogFile;
  annotation: AnnotationFile | null;
}

interface DimensionId {
  test_id: string;
  source: string;
  name: string;
}

function correctionKey(c: DimensionId): string {
  return `${c.test_id}|${c.source}|${c.name}`;
}

function buildPrComment(opts: {
  test_id: string;
  source: string;
  name: string;
  llmScore: number;
  correctedScore: number;
  judgeRationale: string;
  juniorComment: string;
}): string {
  const lines = [
    `**\`${opts.test_id}\`** — \`${opts.source}\` / \`${opts.name}\``,
    `LLM: ${opts.llmScore} → Junior: ${opts.correctedScore}`,
    '',
    '> ' + (opts.judgeRationale || '(no rationale)').replace(/\n/g, '\n> '),
    '',
    `Junior: ${opts.juniorComment || '(no comment)'}`,
  ];
  return lines.join('\n');
}

function testSectionDomId(test_id: string): string {
  return `test-section-${test_id}`;
}

function ScorePicker({
  value,
  onChange,
  onFocus,
  onBlur,
}: {
  value: number;
  onChange: (v: 1 | 2 | 3) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  return (
    <Box onFocus={onFocus} onBlur={onBlur}>
      <SegmentedControl
        size="xs"
        value={String(value)}
        onChange={(v) => onChange(Number(v) as 1 | 2 | 3)}
        data={[
          { label: '1', value: '1' },
          { label: '2', value: '2' },
          { label: '3', value: '3' },
        ]}
      />
    </Box>
  );
}

function DimensionRow({
  test_id,
  dim,
  judgeRationale,
  correction,
  onUpdate,
  onFocus,
  onBlur,
}: {
  test_id: string;
  dim: RunLogDimension;
  judgeRationale: string;
  correction: AnnotationCorrection | undefined;
  onUpdate: (c: AnnotationCorrection | null) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const corrected = correction?.corrected_score ?? dim.score;
  const comment = correction?.comment ?? '';

  const setScore = (s: 1 | 2 | 3) => {
    onUpdate({
      test_id,
      dimension_source: dim.source,
      dimension_name: dim.name,
      llm_score: dim.score,
      corrected_score: s,
      comment: comment || null,
    });
  };

  const setComment = (text: string) => {
    if (!correction) {
      onUpdate({
        test_id,
        dimension_source: dim.source,
        dimension_name: dim.name,
        llm_score: dim.score,
        corrected_score: dim.score,
        comment: text || null,
      });
    } else {
      onUpdate({ ...correction, comment: text || null });
    }
  };

  return (
    <Card withBorder padding="xs">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Box style={{ flex: 1 }}>
          <Group gap={6} mb={2}>
            <Badge color="gray" variant="outline" size="xs">{dim.source}</Badge>
            <Text fw={500}>{dim.name}</Text>
            {correction ? (
              <Badge color="blue" variant="light" size="xs">reviewed</Badge>
            ) : (
              <Badge color="orange" variant="outline" size="xs">unreviewed</Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
            {judgeRationale || '(no rationale)'}
          </Text>
        </Box>
        <Stack gap={4} align="flex-end">
          <Group gap={4}>
            <Text size="xs" c="dimmed">LLM:</Text>
            <Badge variant="light" size="sm">{dim.score}</Badge>
          </Group>
          <Group gap={4}>
            <Text size="xs" c="dimmed">You:</Text>
            <ScorePicker value={corrected} onChange={setScore} onFocus={onFocus} onBlur={onBlur} />
          </Group>
          <CopyButton
            value={buildPrComment({
              test_id,
              source: dim.source,
              name: dim.name,
              llmScore: dim.score,
              correctedScore: corrected,
              judgeRationale,
              juniorComment: comment,
            })}
          >
            {({ copied, copy }) => (
              <Tooltip label={copied ? 'copied!' : 'copy as PR comment'}>
                <Button size="xs" variant="subtle" onClick={copy}>
                  📋 {copied ? 'copied' : 'PR comment'}
                </Button>
              </Tooltip>
            )}
          </CopyButton>
        </Stack>
      </Group>
      <Textarea
        size="xs"
        mt={4}
        placeholder="comment (optional, expected on disagreement)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        autosize
        minRows={1}
      />
    </Card>
  );
}

/**
 * Find the test JSON for `test_id` inside the run log's snapshot.
 * The snapshot embeds every test in eval/tests/unit/<skill>/; we scan
 * for the one whose `test.id` matches. Returns null if not found.
 */
function findTestJson(
  snapshot: Record<string, string>,
  skill: string,
  test_id: string,
): Record<string, unknown> | null {
  const prefix = `eval/tests/unit/${skill}/`;
  for (const [path, content] of Object.entries(snapshot)) {
    if (!path.startsWith(prefix) || !path.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(content);
      if (parsed?.test?.id === test_id) return parsed;
    } catch {
      // skip malformed entries
    }
  }
  return null;
}

/** Get the fixture's `response` body from the snapshot, by fixture name. */
function findFixtureResponse(
  snapshot: Record<string, string>,
  fixtureName: string,
): unknown {
  const content = snapshot[`eval/fixtures/mcp/${fixtureName}.json`];
  if (!content) return null;
  try {
    const parsed = JSON.parse(content);
    return parsed?.response ?? parsed;
  } catch {
    return null;
  }
}

function TestSection({
  entry,
  skill,
  snapshot,
  annotation,
  onSetCorrection,
  onAgreeAll,
  onDimensionFocus,
  onDimensionBlur,
}: {
  entry: TestEntry;
  skill: string;
  snapshot: Record<string, string>;
  annotation: AnnotationFile | null;
  onSetCorrection: (c: AnnotationCorrection | null, key: string) => void;
  onAgreeAll: (test_id: string) => void;
  onDimensionFocus: (dim: DimensionId) => void;
  onDimensionBlur: () => void;
}) {
  const correctionsByKey = useMemo(() => {
    const m = new Map<string, AnnotationCorrection>();
    for (const c of annotation?.corrections ?? []) {
      m.set(`${c.test_id}|${c.dimension_source}|${c.dimension_name}`, c);
    }
    return m;
  }, [annotation]);

  const dims = entry.outcome_summary.aggregated_dimensions;
  const unreviewedCount = dims.filter(
    (d) => !correctionsByKey.has(`${entry.test_id}|${d.source}|${d.name}`),
  ).length;

  return (
    <Card withBorder id={testSectionDomId(entry.test_id)}>
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <Title order={4}>{entry.test_id}</Title>
          <Badge color={entry.outcome === 'pass' ? 'green' : entry.outcome === 'partial' ? 'yellow' : 'red'}>
            {entry.outcome}
          </Badge>
          {entry.flaky ? <Badge color="orange">flaky</Badge> : null}
          {unreviewedCount > 0 ? (
            <Badge color="orange" variant="outline">{unreviewedCount} unreviewed</Badge>
          ) : (
            <Badge color="green" variant="light">complete</Badge>
          )}
        </Group>
        <Button size="xs" variant="default" onClick={() => onAgreeAll(entry.test_id)}>
          Agree with all
        </Button>
      </Group>

      {entry.scenario ? (
        <Group gap={6} mb="xs">
          <Text size="sm" c="dimmed">scenario:</Text>
          <Anchor component={Link} href={`/scenarios/${entry.scenario}`}>
            <Code>{entry.scenario}</Code>
          </Anchor>
        </Group>
      ) : null}
      {entry.mcp_fixtures.length > 0 ? (
        <Group gap={6} mb="xs" wrap="wrap">
          <Text size="sm" c="dimmed">fixtures:</Text>
          {entry.mcp_fixtures.map((f) => (
            <Anchor key={f} component={Link} href={`/fixtures/${f}`}>
              <Code>{f}</Code>
            </Anchor>
          ))}
        </Group>
      ) : null}

      <Accordion variant="separated" defaultValue="grade">
        <Accordion.Item value="trace">
          <Accordion.Control>Trace</Accordion.Control>
          <Accordion.Panel>
            <Trace entry={entry} skill={skill} snapshot={snapshot} />
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="grade">
          <Accordion.Control>Grade ({dims.length} dimensions)</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              {dims.map((d) => {
                const key = `${entry.test_id}|${d.source}|${d.name}`;
                return (
                  <DimensionRow
                    key={key}
                    test_id={entry.test_id}
                    dim={d}
                    judgeRationale={d.rationale}
                    correction={correctionsByKey.get(key)}
                    onUpdate={(c) => onSetCorrection(c, key)}
                    onFocus={() => onDimensionFocus({ test_id: entry.test_id, source: d.source, name: d.name })}
                    onBlur={onDimensionBlur}
                  />
                );
              })}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Card>
  );
}

function Trace({
  entry,
  skill,
  snapshot,
}: {
  entry: TestEntry;
  skill: string;
  snapshot: Record<string, string>;
}) {
  const run = entry.runs[0];
  if (!run) return <Text c="dimmed">no runs recorded</Text>;
  const output = run.output as Record<string, unknown> | undefined;
  const text =
    typeof output?.text_response === 'string'
      ? output.text_response
      : '(text response in sidecar file)';
  const toolCalls = (output?.tool_calls as Array<Record<string, unknown>> | undefined) ?? [];
  const filesCreated = (output?.files_created as string[] | undefined) ?? [];

  // Pull the test JSON out of the snapshot to surface the user_message
  // + additional_criteria — neither lives in the run-log envelope, so
  // without this lookup the junior would have to flip to /tests to see
  // what was actually asked.
  const testJson = findTestJson(snapshot, skill, entry.test_id);
  const userMessage =
    (testJson?.input as Record<string, unknown> | undefined)?.user_message as string | undefined;
  const scenarioNotes =
    (testJson?.input as Record<string, unknown> | undefined)?.scenario_notes as string | undefined;
  const additionalCriteria = (testJson?.additional_criteria as string[] | undefined) ?? [];

  return (
    <Stack gap="xs">
      <Box>
        <Text size="xs" c="dimmed" tt="uppercase" mb={2}>user message (test input)</Text>
        <Code block style={{ whiteSpace: 'pre-wrap' }}>
          {userMessage ?? '(not found in snapshot)'}
        </Code>
        {scenarioNotes ? (
          <Text size="xs" c="dimmed" mt={4}>
            scenario notes: {scenarioNotes}
          </Text>
        ) : null}
      </Box>

      {additionalCriteria.length > 0 ? (
        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" mb={2}>
            additional criteria (the &quot;criteria&quot; dimensions below grade these)
          </Text>
          <Stack gap={2}>
            {additionalCriteria.map((c, i) => (
              <Text key={i} size="sm" style={{ whiteSpace: 'pre-wrap' }}>• {c}</Text>
            ))}
          </Stack>
        </Box>
      ) : null}

      <Box>
        <Text size="xs" c="dimmed" tt="uppercase" mb={2}>tool calls + fixture responses</Text>
        {toolCalls.length === 0 ? (
          <Text size="sm" c="dimmed">no tool calls</Text>
        ) : (
          toolCalls.map((c, i) => {
            const fixtureName = c.response_fixture
              ? String(c.response_fixture)
              : null;
            const fixtureBody = fixtureName ? findFixtureResponse(snapshot, fixtureName) : null;
            return (
              <Card key={i} padding="xs" withBorder mb={4}>
                <Group gap={6} mb={4}>
                  <Code>{String(c.tool)}</Code>
                  {fixtureName ? (
                    <>
                      <Text size="xs" c="dimmed">→</Text>
                      <Anchor component={Link} href={`/fixtures/${fixtureName}`}>
                        <Code>{fixtureName}</Code>
                      </Anchor>
                    </>
                  ) : null}
                </Group>
                <Text size="xs" c="dimmed" mb={2}>arguments:</Text>
                <Code block style={{ whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(c.args, null, 2)}
                </Code>
                {fixtureBody !== null ? (
                  <Box mt={4}>
                    <details>
                      <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--mantine-color-dimmed)' }}>
                        fixture response (click to expand)
                      </summary>
                      <Code block style={{ whiteSpace: 'pre-wrap', marginTop: 4, maxHeight: 400, overflow: 'auto' }}>
                        {typeof fixtureBody === 'string'
                          ? fixtureBody
                          : JSON.stringify(fixtureBody, null, 2)}
                      </Code>
                    </details>
                  </Box>
                ) : null}
              </Card>
            );
          })
        )}
      </Box>

      <Box>
        <Text size="xs" c="dimmed" tt="uppercase" mb={2}>text response</Text>
        <Code block style={{ whiteSpace: 'pre-wrap' }}>
          {text}
        </Code>
      </Box>

      {filesCreated.length > 0 ? (
        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" mb={2}>files created</Text>
          <Stack gap={2}>
            {filesCreated.map((f, i) => (
              <Code key={i}>{f}</Code>
            ))}
          </Stack>
        </Box>
      ) : null}
    </Stack>
  );
}

function ProgressSidebar({
  tests,
  annotation,
  onJumpTo,
}: {
  tests: TestEntry[];
  annotation: AnnotationFile | null;
  onJumpTo: (test_id: string) => void;
}) {
  const reviewedByTest = useMemo(() => {
    const out: Record<string, { reviewed: number; total: number }> = {};
    const have = new Set(
      (annotation?.corrections ?? []).map(
        (c) => `${c.test_id}|${c.dimension_source}|${c.dimension_name}`,
      ),
    );
    for (const t of tests) {
      const total = t.outcome_summary.aggregated_dimensions.length;
      const reviewed = t.outcome_summary.aggregated_dimensions.filter((d) =>
        have.has(`${t.test_id}|${d.source}|${d.name}`),
      ).length;
      out[t.test_id] = { reviewed, total };
    }
    return out;
  }, [tests, annotation]);

  const totalReviewed = Object.values(reviewedByTest).reduce((a, b) => a + b.reviewed, 0);
  const totalDimensions = Object.values(reviewedByTest).reduce((a, b) => a + b.total, 0);

  return (
    <Card withBorder padding="xs" style={{ position: 'sticky', top: 80 }}>
      <Text fw={600} mb="xs" size="sm">
        Progress: {totalReviewed}/{totalDimensions}
      </Text>
      <Stack gap={4}>
        {tests.map((t) => {
          const { reviewed, total } = reviewedByTest[t.test_id] ?? { reviewed: 0, total: 0 };
          const complete = reviewed === total && total > 0;
          return (
            <Button
              key={t.test_id}
              variant="subtle"
              size="xs"
              justify="space-between"
              fullWidth
              onClick={() => onJumpTo(t.test_id)}
              styles={{ inner: { justifyContent: 'space-between' }, label: { fontFamily: 'monospace', fontSize: 11 } }}
              rightSection={
                <Badge
                  color={complete ? 'green' : reviewed > 0 ? 'yellow' : 'gray'}
                  variant={complete ? 'filled' : 'light'}
                  size="xs"
                >
                  {reviewed}/{total}
                </Badge>
              }
            >
              {t.test_id}
            </Button>
          );
        })}
      </Stack>
    </Card>
  );
}

function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal opened={open} onClose={onClose} title="Keyboard shortcuts" size="sm">
      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="sm">Set focused score to 1 / 2 / 3</Text>
          <Group gap={4}><Kbd>1</Kbd><Kbd>2</Kbd><Kbd>3</Kbd></Group>
        </Group>
        <Group justify="space-between">
          <Text size="sm">Move between dimensions</Text>
          <Group gap={4}><Kbd>Tab</Kbd><Text size="xs" c="dimmed">/</Text><Kbd>⇧Tab</Kbd></Group>
        </Group>
        <Group justify="space-between">
          <Text size="sm">Jump to next test</Text>
          <Kbd>⌘/Ctrl + Enter</Kbd>
        </Group>
        <Group justify="space-between">
          <Text size="sm">Show this help</Text>
          <Kbd>?</Kbd>
        </Group>
        <Divider my={4} />
        <Text size="xs" c="dimmed">
          Shortcuts ignore typing in the comment field. To set a score with the
          keyboard, focus the score picker first (Tab into it from the comment
          field above, or click on it).
        </Text>
      </Stack>
    </Modal>
  );
}

export default function RunLogDetailPage({
  params,
}: {
  params: Promise<{ id: string[] }>;
}) {
  const { id } = use(params);
  const runLogId = id.map(decodeURIComponent).join('/');
  const qc = useQueryClient();

  const query = useQuery<Detail>({
    queryKey: ['runlog', runLogId],
    queryFn: async () => {
      const res = await fetch(`/api/runlogs/${runLogId}`);
      if (!res.ok) throw new Error(`GET /api/runlogs/${runLogId} → ${res.status}`);
      return res.json();
    },
    refetchOnWindowFocus: false,
  });

  const [localAnn, setLocalAnn] = useState<AnnotationFile | null>(null);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [focusedDim, setFocusedDim] = useState<DimensionId | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the latest annotation in a ref so the keydown handler can read
  // it without re-binding the listener every keystroke.
  const localAnnRef = useRef<AnnotationFile | null>(null);
  useEffect(() => {
    localAnnRef.current = localAnn;
  }, [localAnn]);

  useEffect(() => {
    if (query.data) {
      const filename = runLogId.split('/').pop() + '.json';
      setLocalAnn(
        query.data.annotation ?? {
          run_log: filename,
          annotator: '',
          corrections: [],
        },
      );
    }
  }, [query.data, runLogId]);

  const persist = useCallback(
    (next: AnnotationFile) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaving('saving');
        try {
          const res = await fetch(`/api/runlogs/annotation/${runLogId}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(next),
          });
          if (!res.ok) {
            setSaving('error');
            return;
          }
          setSaving('saved');
          qc.invalidateQueries({ queryKey: ['runlog', runLogId] });
        } catch {
          setSaving('error');
        }
      }, 400);
    },
    [runLogId, qc],
  );

  const setCorrection = useCallback(
    (c: AnnotationCorrection | null, key: string) => {
      const current = localAnnRef.current;
      if (!current) return;
      const filtered = current.corrections.filter(
        (x) => `${x.test_id}|${x.dimension_source}|${x.dimension_name}` !== key,
      );
      const next: AnnotationFile = {
        ...current,
        corrections: c ? [...filtered, c] : filtered,
      };
      setLocalAnn(next);
      persist(next);
    },
    [persist],
  );

  const agreeAll = (test_id: string) => {
    if (!localAnn || !query.data) return;
    const test = query.data.runLog.tests.find((t) => t.test_id === test_id);
    if (!test) return;
    const filtered = localAnn.corrections.filter((c) => c.test_id !== test_id);
    const additions: AnnotationCorrection[] = test.outcome_summary.aggregated_dimensions.map((d) => {
      const existing = localAnn.corrections.find(
        (c) =>
          c.test_id === test_id &&
          c.dimension_source === d.source &&
          c.dimension_name === d.name,
      );
      return {
        test_id,
        dimension_source: d.source,
        dimension_name: d.name,
        llm_score: d.score,
        corrected_score: existing?.corrected_score ?? d.score,
        comment: existing?.comment ?? null,
      };
    });
    const next: AnnotationFile = { ...localAnn, corrections: [...filtered, ...additions] };
    setLocalAnn(next);
    persist(next);
  };

  // Jump-to-test helper for the sidebar + Ctrl+Enter shortcut.
  const jumpToTest = useCallback((test_id: string) => {
    const el = document.getElementById(testSectionDomId(test_id));
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const jumpToNextTest = useCallback(() => {
    if (!query.data) return;
    const tests = query.data.runLog.tests;
    if (tests.length === 0) return;
    const currentIdx = focusedDim
      ? tests.findIndex((t) => t.test_id === focusedDim.test_id)
      : -1;
    const nextIdx = currentIdx >= 0 && currentIdx < tests.length - 1 ? currentIdx + 1 : 0;
    jumpToTest(tests[nextIdx].test_id);
  }, [query.data, focusedDim, jumpToTest]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inTypingField =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') &&
        !target.hasAttribute('readonly');

      // `?` always shows help (works in text fields too — useful escape hatch).
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }

      // Ctrl/Cmd+Enter jumps to next test.
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        jumpToNextTest();
        return;
      }

      if (inTypingField) return; // 1/2/3 in a textarea is a literal digit.

      if ((e.key === '1' || e.key === '2' || e.key === '3') && focusedDim) {
        e.preventDefault();
        const score = Number(e.key) as 1 | 2 | 3;
        const tests = query.data?.runLog.tests;
        const test = tests?.find((t) => t.test_id === focusedDim.test_id);
        const dim = test?.outcome_summary.aggregated_dimensions.find(
          (d) => d.source === focusedDim.source && d.name === focusedDim.name,
        );
        if (!dim) return;
        const key = `${focusedDim.test_id}|${focusedDim.source}|${focusedDim.name}`;
        const existing = localAnnRef.current?.corrections.find(
          (c) => `${c.test_id}|${c.dimension_source}|${c.dimension_name}` === key,
        );
        setCorrection(
          {
            test_id: focusedDim.test_id,
            dimension_source: focusedDim.source as 'base' | 'rubric' | 'criteria',
            dimension_name: focusedDim.name,
            llm_score: dim.score,
            corrected_score: score,
            comment: existing?.comment ?? null,
          },
          key,
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusedDim, query.data, jumpToNextTest, setCorrection]);

  if (query.isLoading) {
    return <Loader />;
  }
  if (query.isError || !query.data) {
    return <Alert color="red">{(query.error as Error)?.message ?? 'failed to load'}</Alert>;
  }

  const log = query.data.runLog;
  const ann = localAnn;
  const allDimensions = log.tests.flatMap((t) =>
    t.outcome_summary.aggregated_dimensions.map((d) => ({ t: t.test_id, d })),
  );
  const reviewedCount = allDimensions.filter(({ t, d }) =>
    ann?.corrections.some(
      (c) =>
        c.test_id === t &&
        c.dimension_source === d.source &&
        c.dimension_name === d.name,
    ),
  ).length;
  const complete = reviewedCount === allDimensions.length;

  const activate = async () => {
    if (!confirm(`Activate this run log? This will overwrite ${Object.keys(log.snapshot).length} skill-side files.`)) {
      return;
    }
    const res = await fetch(`/api/runlogs/${runLogId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'activate' }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(`activate failed: ${body.error ?? res.status}`);
    } else {
      alert('Activated — files written. Re-run the harness to produce a fresh run log against this state.');
    }
  };
  const release = async () => {
    if (!complete) {
      alert('Cannot release: annotation is incomplete. Review every dimension first.');
      return;
    }
    if (!confirm(`Release this candidate as v${log.version}? The file will be renamed.`)) {
      return;
    }
    const res = await fetch(`/api/runlogs/${runLogId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'release' }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(`release failed: ${body.error ?? res.status}`);
    } else {
      window.location.href = `/results/${body.newRunLogId}`;
    }
  };
  const deleteCandidate = async () => {
    if (!confirm(`Delete this candidate iteration? The .json and .ann.json will be removed.`)) {
      return;
    }
    const res = await fetch(`/api/runlogs/${runLogId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'delete' }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(`delete failed: ${body.error ?? res.status}`);
    } else {
      window.location.href = '/results';
    }
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Stack gap={2}>
          <Title order={2}>{log.skill}</Title>
          <Group gap="xs">
            {log.released ? (
              <Badge color="green">v{log.version} released</Badge>
            ) : log.version != null ? (
              <Badge color="blue">v{log.version} candidate</Badge>
            ) : (
              <Badge color="gray">scratch</Badge>
            )}
            <Text size="sm" c="dimmed">
              {log.timestamp} • model: <Code>{log.model}</Code> • {log.tests.length} test(s) • invocation: {log.invocation}
            </Text>
            <Badge color={complete ? 'green' : 'orange'} variant="light">
              {reviewedCount}/{allDimensions.length} reviewed
            </Badge>
          </Group>
        </Stack>
        <Group>
          <Text size="xs" c="dimmed">{saving === 'saving' ? 'saving…' : saving === 'saved' ? 'saved' : saving === 'error' ? '⚠ save failed' : ''}</Text>
          <Tooltip label="Keyboard shortcuts (?)">
            <Button size="xs" variant="subtle" onClick={() => setHelpOpen(true)}>?</Button>
          </Tooltip>
          {log.releasable ? (
            <Button size="xs" variant="default" onClick={activate}>Activate</Button>
          ) : null}
          {log.version != null && !log.released && log.releasable ? (
            <Button size="xs" variant="filled" color="green" disabled={!complete} onClick={release}>
              Release v{log.version}
            </Button>
          ) : null}
          {log.version != null && !log.released ? (
            <Button size="xs" variant="subtle" color="red" onClick={deleteCandidate}>Delete</Button>
          ) : null}
        </Group>
      </Group>
      <Divider />
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, md: 3 }}>
          <ProgressSidebar
            tests={log.tests}
            annotation={localAnn}
            onJumpTo={jumpToTest}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 9 }}>
          <Stack gap="md">
            {log.tests.map((entry) => (
              <TestSection
                key={entry.test_id}
                entry={entry}
                skill={log.skill}
                snapshot={log.snapshot}
                annotation={localAnn}
                onSetCorrection={setCorrection}
                onAgreeAll={agreeAll}
                onDimensionFocus={setFocusedDim}
                onDimensionBlur={() => setFocusedDim(null)}
              />
            ))}
          </Stack>
        </Grid.Col>
      </Grid>
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </Stack>
  );
}
