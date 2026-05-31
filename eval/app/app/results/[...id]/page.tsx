'use client';

import { memo, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Group,
  Kbd,
  Loader,
  Menu,
  Modal,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
  Textarea,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HSplit } from '@/components/layout/HSplit';
import { JsonViewer } from '@/components/common/JsonViewer';
import { ScenarioViewer } from '@/components/scenario/ScenarioViewer';
import { findScenarioData } from '@/lib/scenarioSnapshot';
import type {
  AnnotationCorrection,
  AnnotationFile,
  RunLogDimension,
  RunLogFile,
  TestEntry,
} from '@/lib/types';
import { NULLABLE_BASE_DIMENSIONS } from '@/lib/types';
import { buildArgTableRows, formatArgValue } from '@/lib/argTable';

interface Detail {
  runLog: RunLogFile;
  annotation: AnnotationFile | null;
  /** Highest released version on disk for this skill, or null if none. */
  latestReleasedVersion: number | null;
}

interface DimensionId {
  test_id: string;
  source: string;
  name: string;
}

function buildPrComment(opts: {
  test_id: string;
  source: string;
  name: string;
  llmScore: 1 | 2 | 3 | null;
  correctedScore: 1 | 2 | 3 | null;
  judgeRationale: string;
  juniorComment: string;
}): string {
  const fmt = (s: 1 | 2 | 3 | null) => (s === null ? 'N/A' : String(s));
  const lines = [
    `**\`${opts.test_id}\`** — \`${opts.source}\` / \`${opts.name}\``,
    `LLM: ${fmt(opts.llmScore)} → Junior: ${fmt(opts.correctedScore)}`,
    '',
    '> ' + (opts.judgeRationale || '(no rationale)').replace(/\n/g, '\n> '),
    '',
    `Junior: ${opts.juniorComment || '(no comment)'}`,
  ];
  return lines.join('\n');
}

type ScoreOrNull = 1 | 2 | 3 | null;

function ScorePicker({
  value,
  onChange,
  allowNa,
  onFocus,
  onBlur,
}: {
  value: ScoreOrNull;
  onChange: (v: ScoreOrNull) => void;
  /** When true, the picker shows N/A as a fourth option (used for the
   * Tool Arguments dimension, which is N/A when zero MCP calls happened). */
  allowNa?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const data = [
    { label: '1', value: '1' },
    { label: '2', value: '2' },
    { label: '3', value: '3' },
  ];
  if (allowNa) data.push({ label: 'N/A', value: 'na' });
  return (
    <Tooltip label="Click the LLM score to mark this dimension reviewed" openDelay={600} withArrow>
      <Box
        onFocus={onFocus}
        onBlur={onBlur}
        // SegmentedControl's onChange fires only when the value changes.
        // Re-clicking the already-selected option (e.g. agreeing with the
        // LLM's score, which the picker shows pre-selected) produces a click
        // but no change. This delegated handler catches that case and still
        // records the correction, marking the dimension reviewed.
        onClick={(e) => {
          const label = (e.target as HTMLElement).closest('label');
          const input = label?.parentElement?.querySelector<HTMLInputElement>(
            'input[type="radio"]',
          );
          if (!input) return;
          const picked: ScoreOrNull =
            input.value === 'na' ? null : (Number(input.value) as 1 | 2 | 3);
          if (picked === value) onChange(picked);
        }}
      >
        <SegmentedControl
          size="xs"
          value={value === null ? 'na' : String(value)}
          onChange={(v) => onChange(v === 'na' ? null : (Number(v) as 1 | 2 | 3))}
          data={data}
        />
      </Box>
    </Tooltip>
  );
}

function formatScore(s: ScoreOrNull): string {
  return s === null ? 'N/A' : String(s);
}

// memo'd so typing in one row's textarea doesn't re-render every other row.
// Requires that callbacks (onUpdate/onFocus/onBlur) be stable references
// across renders, and that `correction` only changes reference for the row
// whose data actually changed.
const DimensionRow = memo(function DimensionRow({
  test_id,
  dimKey,
  dim,
  judgeRationale,
  correction,
  onUpdate,
  onFocus,
  onBlur,
}: {
  test_id: string;
  dimKey: string;
  dim: RunLogDimension;
  judgeRationale: string;
  correction: AnnotationCorrection | undefined;
  onUpdate: (c: AnnotationCorrection | null, key: string) => void;
  onFocus: (dim: DimensionId) => void;
  onBlur: () => void;
}) {
  // `correction?.corrected_score` may be 1/2/3/null; default to the LLM
  // score (which may itself be null for Tool Arguments N/A).
  const corrected: ScoreOrNull =
    correction !== undefined ? correction.corrected_score : dim.score;
  const comment = correction?.comment ?? '';
  const disagrees = correction != null && correction.corrected_score !== correction.llm_score;
  const needsComment = disagrees && !comment.trim();
  const allowNa = dim.source === 'base' && NULLABLE_BASE_DIMENSIONS.has(dim.name);

  const setScore = (s: ScoreOrNull) => {
    onUpdate({
      test_id,
      dimension_source: dim.source,
      dimension_name: dim.name,
      llm_score: dim.score,
      corrected_score: s,
      comment: comment || null,
    }, dimKey);
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
      }, dimKey);
    } else {
      onUpdate({ ...correction, comment: text || null }, dimKey);
    }
  };

  const handleFocus = () => onFocus({ test_id, source: dim.source, name: dim.name });

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
            <Badge variant="light" size="sm">{formatScore(dim.score)}</Badge>
          </Group>
          <Group gap={4}>
            <Text size="xs" c="dimmed">You:</Text>
            <ScorePicker
              value={corrected}
              onChange={setScore}
              allowNa={allowNa}
              onFocus={handleFocus}
              onBlur={onBlur}
            />
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
        error={needsComment ? 'comment required when overriding the LLM score' : undefined}
      />
    </Card>
  );
});

/** Find the test JSON for `test_id` inside the run log's snapshot. */
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

// ---- Tool-args side-by-side table ------------------------------------------

function ToolArgsTable({
  expected,
  actual,
}: {
  expected: Record<string, unknown> | null;
  actual: Record<string, unknown>;
}) {
  const rows = buildArgTableRows(expected, actual);

  if (rows.length === 0) {
    return <Text size="xs" c="dimmed">(no arguments)</Text>;
  }

  return (
    <Box mt={2} mb={2}>
      <Text size="xs" c="dimmed" mb={2}>arguments:</Text>
      <Box style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 4 }}>
        <Box
          style={{
            display: 'grid',
            gridTemplateColumns: '24px 1fr 2fr 2fr',
            gap: 8,
            padding: '4px 8px',
            fontSize: 11,
            color: 'var(--mantine-color-dimmed)',
            borderBottom: '1px solid var(--mantine-color-default-border)',
          }}
        >
          <span />
          <span>param</span>
          <span>expected</span>
          <span>actual</span>
        </Box>
        {rows.map((r, i) => {
          const symbol =
            r.status.kind === 'match' ? '✓'
              : r.status.kind === 'mismatch' ? '✗'
              : r.status.kind === 'actual-missing' ? '—'
              : '+';
          const color =
            r.status.kind === 'match' ? 'var(--mantine-color-green-7)'
              : r.status.kind === 'mismatch' ? 'var(--mantine-color-red-7)'
              : r.status.kind === 'actual-missing' ? 'var(--mantine-color-red-7)'
              : 'var(--mantine-color-yellow-7)';
          return (
            <Box
              key={`${r.rawKey}-${i}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '24px 1fr 2fr 2fr',
                gap: 8,
                padding: '4px 8px',
                fontSize: 12,
                fontFamily: 'var(--mantine-font-family-monospace)',
                borderTop: i === 0 ? 'none' : '1px solid var(--mantine-color-default-border)',
              }}
            >
              <span style={{ color, fontWeight: 600, textAlign: 'center' }}>{symbol}</span>
              <span>{r.key}</span>
              <span style={{ wordBreak: 'break-word' }}>{formatArgValue(r.expected)}</span>
              <span style={{ wordBreak: 'break-word' }}>{formatArgValue(r.actual)}</span>
            </Box>
          );
        })}
      </Box>
      <Text size="xs" c="dimmed" mt={2}>
        ✓ match · ✗ mismatch · — actual missing · + extra (not declared in fixture)
      </Text>
    </Box>
  );
}

function GradesPane({
  entry,
  annotation,
  onSetCorrection,
  onAgreeAll,
  onDimensionFocus,
  onDimensionBlur,
  onNextTest,
  nextDisabled,
}: {
  entry: TestEntry;
  annotation: AnnotationFile | null;
  onSetCorrection: (c: AnnotationCorrection | null, key: string) => void;
  onAgreeAll: (test_id: string) => void;
  onDimensionFocus: (dim: DimensionId) => void;
  onDimensionBlur: () => void;
  onNextTest: () => void;
  nextDisabled: boolean;
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
  const hasUncommentedDisagreement = dims.some((d) => {
    const c = correctionsByKey.get(`${entry.test_id}|${d.source}|${d.name}`);
    return c != null && c.corrected_score !== c.llm_score && !(c.comment ?? '').trim();
  });

  return (
    <Stack gap="sm" p="md" h="100%">
      <Group justify="space-between" wrap="nowrap">
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
        <Button
          size="xs"
          variant="default"
          px="xs"
          style={{ flexShrink: 0 }}
          onClick={() => onAgreeAll(entry.test_id)}
        >
          Agree All
        </Button>
      </Group>

      {entry.scenario ? (
        <Group gap={6}>
          <Text size="sm" c="dimmed">scenario:</Text>
          <Anchor component={Link} href={`/scenarios/${entry.scenario}`}>
            <Code>{entry.scenario}</Code>
          </Anchor>
        </Group>
      ) : null}
      {entry.mcp_fixtures.length > 0 ? (
        <Group gap={6} wrap="wrap">
          <Text size="sm" c="dimmed">fixtures:</Text>
          {entry.mcp_fixtures.map((f) => (
            <Anchor key={f} component={Link} href={`/fixtures/${f}`}>
              <Code>{f}</Code>
            </Anchor>
          ))}
        </Group>
      ) : null}

      <Stack gap="xs" style={{ flex: 1 }}>
        {dims.map((d) => {
          const key = `${entry.test_id}|${d.source}|${d.name}`;
          return (
            <DimensionRow
              key={key}
              test_id={entry.test_id}
              dimKey={key}
              dim={d}
              judgeRationale={d.rationale}
              correction={correctionsByKey.get(key)}
              onUpdate={onSetCorrection}
              onFocus={onDimensionFocus}
              onBlur={onDimensionBlur}
            />
          );
        })}
      </Stack>

      <Divider />
      <Group justify="space-between">
        {hasUncommentedDisagreement ? (
          <Text size="xs" c="red">
            Add a comment to any dimension where you overrode the LLM score.
          </Text>
        ) : (
          <span />
        )}
        <Button
          size="sm"
          variant="filled"
          onClick={onNextTest}
          disabled={nextDisabled || hasUncommentedDisagreement}
        >
          Next test →
        </Button>
      </Group>
    </Stack>
  );
}

// memo'd so typing in a dimension comment doesn't re-render the trace pane,
// which would otherwise re-parse the snapshot's test JSON and every fixture
// JSON on each keystroke.
const TracePane = memo(function TracePane({
  entry,
  skill,
  snapshot,
}: {
  entry: TestEntry;
  skill: string;
  snapshot: Record<string, string>;
}) {
  const run = entry.runs[0];
  const output = run?.output as Record<string, unknown> | undefined;
  // useMemo so the reference is stable across re-renders when run.output is
  // undefined (the `?? []` fallback would otherwise create a fresh array).
  const toolCalls = useMemo(
    () => (output?.tool_calls as Array<Record<string, unknown>> | undefined) ?? [],
    [output],
  );

  // Hooks must run unconditionally; we early-return below if !run.
  const testJson = useMemo(
    () => findTestJson(snapshot, skill, entry.test_id),
    [snapshot, skill, entry.test_id],
  );
  const fixtureBodies = useMemo(() => {
    const map = new Map<string, unknown>();
    for (const c of toolCalls) {
      const name = c.response_fixture ? String(c.response_fixture) : null;
      if (name && !map.has(name)) {
        map.set(name, findFixtureResponse(snapshot, name));
      }
    }
    return map;
  }, [snapshot, toolCalls]);

  if (!run) {
    return (
      <Box p="md">
        <Text c="dimmed">no runs recorded</Text>
      </Box>
    );
  }
  const text =
    typeof output?.text_response === 'string'
      ? output.text_response
      : '(text response in sidecar file)';
  const filesCreated = (output?.files_created as string[] | undefined) ?? [];

  const userMessage =
    (testJson?.input as Record<string, unknown> | undefined)?.user_message as string | undefined;
  const scenarioNotes =
    (testJson?.input as Record<string, unknown> | undefined)?.scenario_notes as string | undefined;
  const judgeContext = (testJson?.judge_context as string[] | undefined) ?? [];

  const defaultOpen = ['user', 'tools', 'response'];
  if (judgeContext.length > 0) defaultOpen.push('judge');
  if (filesCreated.length > 0) defaultOpen.push('files');

  return (
    <Box p="md">
      <Title order={5} mb="xs">Trace</Title>
      <Accordion multiple defaultValue={defaultOpen} variant="separated">
        <Accordion.Item value="user">
          <Accordion.Control>User message</Accordion.Control>
          <Accordion.Panel>
            <Code block style={{ whiteSpace: 'pre-wrap' }}>
              {userMessage ?? '(not found in snapshot)'}
            </Code>
            {scenarioNotes ? (
              <Text size="xs" c="dimmed" mt={4}>
                scenario notes: {scenarioNotes}
              </Text>
            ) : null}
          </Accordion.Panel>
        </Accordion.Item>

        {judgeContext.length > 0 ? (
          <Accordion.Item value="judge">
            <Accordion.Control>Judge context</Accordion.Control>
            <Accordion.Panel>
              <Stack gap={2}>
                {judgeContext.map((c, i) => (
                  <Text key={i} size="sm" style={{ whiteSpace: 'pre-wrap' }}>• {c}</Text>
                ))}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        ) : null}

        <Accordion.Item value="tools">
          <Accordion.Control>Tool calls ({toolCalls.length})</Accordion.Control>
          <Accordion.Panel>
            {toolCalls.length === 0 ? (
              <Text size="sm" c="dimmed">no tool calls</Text>
            ) : (
              toolCalls.map((c, i) => {
                const fixtureName = c.response_fixture ? String(c.response_fixture) : null;
                const fixtureBody = fixtureName ? fixtureBodies.get(fixtureName) ?? null : null;
                const actual = (c.args ?? {}) as Record<string, unknown>;
                const expected = (c.expected_args ?? null) as Record<string, unknown> | null;
                const matched = (c.matched ?? {}) as { kind?: string };
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
                      ) : (
                        <Badge size="xs" color="red" variant="light">
                          {matched.kind === 'none' ? 'fixture_not_found' : 'no fixture'}
                        </Badge>
                      )}
                    </Group>
                    <ToolArgsTable expected={expected} actual={actual} />
                    {fixtureBody !== null ? (
                      <Box mt={4}>
                        <details>
                          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--mantine-color-dimmed)' }}>
                            fixture response (click to expand)
                          </summary>
                          <Box mt={4}>
                            {typeof fixtureBody === 'string' ? (
                              <Code block style={{ whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto' }}>
                                {fixtureBody}
                              </Code>
                            ) : (
                              <JsonViewer data={fixtureBody} />
                            )}
                          </Box>
                        </details>
                      </Box>
                    ) : null}
                  </Card>
                );
              })
            )}
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="response">
          <Accordion.Control>Text response</Accordion.Control>
          <Accordion.Panel>
            <Code block style={{ whiteSpace: 'pre-wrap' }}>
              {text}
            </Code>
          </Accordion.Panel>
        </Accordion.Item>

        {filesCreated.length > 0 ? (
          <Accordion.Item value="files">
            <Accordion.Control>Files created ({filesCreated.length})</Accordion.Control>
            <Accordion.Panel>
              <Stack gap={2}>
                {filesCreated.map((f, i) => (
                  <Code key={i}>{f}</Code>
                ))}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        ) : null}
      </Accordion>
    </Box>
  );
});

// The third pane: tabs the per-run Trace against the Scenario (what's
// been researched). The Scenario tab appears only when the test references
// a scenario whose files are in the snapshot. Genealogists need the
// scenario to judge whether the LLM's scores are correct, but consult it
// *alongside* scoring — hence a non-blocking tab, not a modal/drawer.
function EvidencePane({
  entry,
  skill,
  snapshot,
}: {
  entry: TestEntry;
  skill: string;
  snapshot: Record<string, string>;
}) {
  const scenarioData = useMemo(
    () => (entry.scenario ? findScenarioData(snapshot, entry.scenario) : null),
    [entry.scenario, snapshot],
  );

  return (
    <Box h="100%" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Tabs
        defaultValue="trace"
        keepMounted={false}
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        <Tabs.List>
          <Tabs.Tab value="trace">Trace</Tabs.Tab>
          {scenarioData ? <Tabs.Tab value="scenario">Scenario</Tabs.Tab> : null}
        </Tabs.List>

        <Tabs.Panel value="trace" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <TracePane entry={entry} skill={skill} snapshot={snapshot} />
        </Tabs.Panel>

        {scenarioData ? (
          <Tabs.Panel value="scenario" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <ScenarioViewer research={scenarioData.research} gedcomx={scenarioData.gedcomx} />
          </Tabs.Panel>
        ) : null}
      </Tabs>
    </Box>
  );
}

function TestsPane({
  tests,
  annotation,
  selectedTestId,
  onSelect,
}: {
  tests: TestEntry[];
  annotation: AnnotationFile | null;
  selectedTestId: string | null;
  onSelect: (test_id: string) => void;
}) {
  // The run-log snapshot strips test.name/description/tags (they're
  // "cosmetic" per eval/CLAUDE.md). Fetch current names from /api/tests
  // so the sidebar shows something a genealogist can read at a glance.
  const namesQuery = useQuery<{ tests: Array<{ id: string; name: string }> }>({
    queryKey: ['tests-names'],
    queryFn: async () => (await fetch('/api/tests')).json(),
    refetchOnWindowFocus: false,
  });
  const nameByTest = useMemo(() => {
    const out: Record<string, string> = {};
    for (const t of namesQuery.data?.tests ?? []) {
      if (t.id && t.name) out[t.id] = t.name;
    }
    return out;
  }, [namesQuery.data]);

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
    <Stack gap={0} p="sm" h="100%">
      <Text fw={600} mb="xs" size="sm">
        Progress: {totalReviewed}/{totalDimensions}
      </Text>
      <Stack gap={2}>
        {tests.map((t) => {
          const { reviewed, total } = reviewedByTest[t.test_id] ?? { reviewed: 0, total: 0 };
          const complete = reviewed === total && total > 0;
          const active = selectedTestId === t.test_id;
          const name = nameByTest[t.test_id];
          return (
            <Tooltip
              key={t.test_id}
              label={t.test_id}
              position="right"
              openDelay={400}
              withArrow
            >
              <UnstyledButton
                onClick={() => onSelect(t.test_id)}
                style={{
                  width: '100%',
                  padding: '3px 8px',
                  borderRadius: 4,
                  background: active ? 'var(--mantine-color-blue-1)' : 'transparent',
                  textAlign: 'left',
                }}
              >
                <Group justify="space-between" wrap="nowrap" gap={6} align="center">
                  <Text size="sm" fw={500} lineClamp={1} style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                    {name ?? t.test_id}
                  </Text>
                  <Badge
                    color={complete ? 'green' : reviewed > 0 ? 'yellow' : 'gray'}
                    variant={complete ? 'filled' : 'light'}
                    size="xs"
                  >
                    {reviewed}/{total}
                  </Badge>
                </Group>
              </UnstyledButton>
            </Tooltip>
          );
        })}
      </Stack>
    </Stack>
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
          <Text size="sm">Next test</Text>
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
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      // Default-select the first test on first load.
      setSelectedTestId((current) => {
        if (current && query.data!.runLog.tests.some((t) => t.test_id === current)) {
          return current;
        }
        return query.data!.runLog.tests[0]?.test_id ?? null;
      });
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

  const clearFocusedDim = useCallback(() => setFocusedDim(null), []);

  const selectNextTest = useCallback(() => {
    if (!query.data) return;
    const tests = query.data.runLog.tests;
    if (tests.length === 0) return;
    const currentIdx = selectedTestId
      ? tests.findIndex((t) => t.test_id === selectedTestId)
      : -1;
    const nextIdx = currentIdx >= 0 && currentIdx < tests.length - 1 ? currentIdx + 1 : 0;
    setSelectedTestId(tests[nextIdx].test_id);
  }, [query.data, selectedTestId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inTypingField =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') &&
        !target.hasAttribute('readonly');

      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }

      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        selectNextTest();
        return;
      }

      if (inTypingField) return;

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
            dimension_source: focusedDim.source as 'base' | 'rubric',
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
  }, [focusedDim, query.data, selectNextTest, setCorrection]);

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

  const selectedEntry = log.tests.find((t) => t.test_id === selectedTestId) ?? log.tests[0] ?? null;
  const currentIdx = selectedEntry ? log.tests.findIndex((t) => t.test_id === selectedEntry.test_id) : -1;
  const isLast = currentIdx >= 0 && currentIdx === log.tests.length - 1;

  // Action visibility. Delete is offered only for "current" candidates —
  // those whose version is above the latest released version (or when no
  // release exists yet). Historical candidates can still be removed by
  // hand from the filesystem.
  const isCurrentCandidate =
    log.version != null &&
    !log.released &&
    (query.data.latestReleasedVersion == null || log.version > query.data.latestReleasedVersion);
  const showActivate = log.releasable;
  const showRelease = log.version != null && !log.released && log.releasable;
  const showDelete = isCurrentCandidate;

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

  // Fill the viewport below the AppShell header (56px) and account for AppShell.Main
  // padding ("md" = 16px top + 16px bottom = 32px).
  const containerHeight = 'calc(100vh - 56px - 32px)';

  return (
    <Stack gap="sm" h={containerHeight} style={{ minHeight: 0 }}>
      <Group justify="space-between" align="flex-end" wrap="nowrap">
        <Stack gap={2}>
          <Title order={3}>{log.skill}</Title>
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
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            {saving === 'saving' ? 'saving…' : saving === 'saved' ? 'saved' : saving === 'error' ? '⚠ save failed' : ''}
          </Text>
          <Tooltip label="Keyboard shortcuts (?)">
            <Button size="xs" variant="subtle" onClick={() => setHelpOpen(true)}>?</Button>
          </Tooltip>
          {showActivate || showRelease || showDelete ? (
            <Menu shadow="md" position="bottom-end" width={220}>
              <Menu.Target>
                <Button size="xs" variant="default">Actions ▾</Button>
              </Menu.Target>
              <Menu.Dropdown>
                {showActivate ? (
                  <Menu.Item onClick={activate}>Activate</Menu.Item>
                ) : null}
                {showRelease ? (
                  <Menu.Item
                    disabled={!complete}
                    onClick={release}
                    color="green"
                  >
                    Release v{log.version}
                    {!complete ? (
                      <Text size="xs" c="dimmed">review every dimension first</Text>
                    ) : null}
                  </Menu.Item>
                ) : null}
                {(showActivate || showRelease) && showDelete ? <Menu.Divider /> : null}
                {showDelete ? (
                  <Menu.Item color="red" onClick={deleteCandidate}>
                    Delete candidate
                  </Menu.Item>
                ) : null}
              </Menu.Dropdown>
            </Menu>
          ) : null}
        </Group>
      </Group>
      <Divider />
      <Box
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          border: '1px solid var(--mantine-color-gray-3)',
          borderRadius: 'var(--mantine-radius-sm)',
          overflow: 'hidden',
          background: 'var(--mantine-color-body)',
        }}
      >
        <HSplit storageKey="results-detail-hsplit" defaultWidths={[240, 520]} minWidths={[180, 320, 320]}>
          <TestsPane
            tests={log.tests}
            annotation={localAnn}
            selectedTestId={selectedEntry?.test_id ?? null}
            onSelect={(id) => setSelectedTestId(id)}
          />
          {selectedEntry ? (
            <GradesPane
              entry={selectedEntry}
              annotation={localAnn}
              onSetCorrection={setCorrection}
              onAgreeAll={agreeAll}
              onDimensionFocus={setFocusedDim}
              onDimensionBlur={clearFocusedDim}
              onNextTest={selectNextTest}
              nextDisabled={log.tests.length <= 1 && isLast}
            />
          ) : (
            <Box p="md"><Text c="dimmed">no test selected</Text></Box>
          )}
          {selectedEntry ? (
            <EvidencePane entry={selectedEntry} skill={log.skill} snapshot={log.snapshot} />
          ) : (
            <Box p="md"><Text c="dimmed">no test selected</Text></Box>
          )}
        </HSplit>
      </Box>
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </Stack>
  );
}
