'use client';

/**
 * Annotation grid.
 *
 * One row per aggregated dimension. The LLM score is read straight
 * from the run log (1, 2, or 3); the junior overrides via a 1-3
 * segmented control. Comments are optional and expected on
 * disagreement.
 *
 * Save model: 500ms debounced — after the last change the entire
 * .ann.json is rewritten atomically. Identity is resolved server-side
 * on first save; if unresolved, we surface a modal to collect it,
 * then retry.
 *
 * `refetchOnWindowFocus` is DISABLED at the grid level: alt-tabbing
 * back from a terminal must not stomp on in-progress local edits.
 * The parent page's run-log query still refetches on focus — that's
 * the "did a new annotation arrive from another tab" path.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import type { AnnotationCorrection, AnnotationFile, RunLogDimension, RunLogFile, Score } from '@/lib/types';

interface AnnotationGridProps {
  runLogId: string;
  runLog: RunLogFile;
  initialAnnotation: AnnotationFile | null;
}

interface RowState {
  corrected: Score;
  comment: string;
}

function keyOf(d: { source: string; name: string }): string {
  return `${d.source}::${d.name}`;
}

function buildInitialState(
  dimensions: RunLogDimension[],
  testId: string,
  ann: AnnotationFile | null,
): Map<string, RowState> {
  const map = new Map<string, RowState>();
  const byKey = new Map<string, AnnotationCorrection>();
  if (ann) {
    for (const c of ann.corrections) {
      if (c.test_id === testId) byKey.set(keyOf({ source: c.dimension_source, name: c.dimension_name }), c);
    }
  }
  for (const d of dimensions) {
    const k = keyOf(d);
    const prior = byKey.get(k);
    map.set(k, {
      corrected: (prior?.corrected_score ?? d.score) as Score,
      comment: prior?.comment ?? '',
    });
  }
  return map;
}

const SAVE_DEBOUNCE_MS = 500;
const SCORE_OPTIONS = [
  { value: '3', label: '3 · pass' },
  { value: '2', label: '2 · partial' },
  { value: '1', label: '1 · fail' },
];

export function AnnotationGrid({ runLogId, runLog, initialAnnotation }: AnnotationGridProps) {
  const dimensions = runLog.outcome_summary.aggregated_dimensions;
  const [state, setState] = useState<Map<string, RowState>>(() => buildInitialState(dimensions, runLog.test_id, initialAnnotation));
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>(initialAnnotation ? 'saved' : 'idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(initialAnnotation ? Date.now() : null);
  const [identityModalOpen, setIdentityModalOpen] = useState(false);
  const [identityDraft, setIdentityDraft] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavePromiseRef = useRef<Promise<void> | null>(null);

  const corrections: AnnotationCorrection[] = useMemo(
    () =>
      dimensions.map((d) => {
        const row = state.get(keyOf(d))!;
        const correction: AnnotationCorrection = {
          test_id: runLog.test_id,
          dimension_source: d.source,
          dimension_name: d.name,
          llm_score: d.score,
          corrected_score: row.corrected,
        };
        if (row.comment.trim()) correction.comment = row.comment.trim();
        return correction;
      }),
    [dimensions, state, runLog.test_id],
  );

  // The save callback (called from setTimeout) needs the LATEST corrections,
  // not the closure capture from when the schedule was set. Mirror to a ref.
  const correctionsRef = useRef<AnnotationCorrection[]>(corrections);
  useEffect(() => {
    correctionsRef.current = corrections;
  }, [corrections]);

  async function save(): Promise<void> {
    setStatus('saving');
    const body = { corrections: correctionsRef.current };
    // runLogId is already URL-encoded path-safe (timestamps include `+`
    // which we keep encoded in the URL). Pass through unmodified.
    const res = await fetch(`/api/runlogs/annotation/${runLogId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 409) {
      setStatus('idle');
      setIdentityModalOpen(true);
      return;
    }
    if (!res.ok) {
      setStatus('idle');
      notifications.show({ color: 'red', title: 'Save failed', message: await res.text() });
      return;
    }
    setStatus('saved');
    setLastSavedAt(Date.now());
  }

  function scheduleSave(): void {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      lastSavePromiseRef.current = save();
    }, SAVE_DEBOUNCE_MS);
  }

  function setScore(d: RunLogDimension, value: Score): void {
    setState((prev) => {
      const next = new Map(prev);
      const row = next.get(keyOf(d))!;
      next.set(keyOf(d), { ...row, corrected: value });
      return next;
    });
    scheduleSave();
  }

  function setComment(d: RunLogDimension, comment: string): void {
    setState((prev) => {
      const next = new Map(prev);
      const row = next.get(keyOf(d))!;
      next.set(keyOf(d), { ...row, comment });
      return next;
    });
    scheduleSave();
  }

  async function submitIdentity(): Promise<void> {
    const v = identityDraft.trim();
    if (!v) return;
    const res = await fetch('/api/identity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ annotator: v }),
    });
    if (!res.ok) {
      notifications.show({ color: 'red', title: 'Could not set identity', message: await res.text() });
      return;
    }
    setIdentityModalOpen(false);
    setIdentityDraft('');
    // Retry the save.
    await save();
  }

  // Render
  const total = dimensions.length;
  const agreements = corrections.filter((c) => c.corrected_score === c.llm_score).length;

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={4}>Annotations</Title>
        <Group gap="sm">
          <SaveStatus status={status} lastSavedAt={lastSavedAt} />
          <Badge variant="light" color={agreements === total ? 'green' : 'blue'}>
            {agreements}/{total} agree with LLM
          </Badge>
        </Group>
      </Group>

      {dimensions.length === 0 ? (
        <Alert color="gray">No aggregated dimensions on this run log.</Alert>
      ) : (
        <Card withBorder p={0}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Source</Table.Th>
                <Table.Th>Dimension</Table.Th>
                <Table.Th>LLM</Table.Th>
                <Table.Th>Corrected</Table.Th>
                <Table.Th>Comment</Table.Th>
                <Table.Th>Rationale</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {dimensions.map((d) => {
                const row = state.get(keyOf(d))!;
                const agrees = row.corrected === d.score;
                return (
                  <Table.Tr key={keyOf(d)} bg={agrees ? undefined : 'var(--mantine-color-yellow-0)'}>
                    <Table.Td>
                      <Badge size="xs" variant="light" color="gray">
                        {d.source}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text fw={500}>{d.name}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={d.score === 3 ? 'green' : d.score === 2 ? 'yellow' : 'red'}>{d.score}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <SegmentedControl
                        size="xs"
                        value={String(row.corrected)}
                        onChange={(v) => setScore(d, Number(v) as Score)}
                        data={SCORE_OPTIONS}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Textarea
                        autosize
                        minRows={1}
                        size="xs"
                        placeholder={agrees ? '(optional)' : 'Why do you disagree?'}
                        value={row.comment}
                        onChange={(e) => setComment(d, e.currentTarget.value)}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed" style={{ maxWidth: 320 }}>
                        {d.rationale}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      <Modal opened={identityModalOpen} onClose={() => setIdentityModalOpen(false)} title="Who's annotating?">
        <Stack gap="sm">
          <Text size="sm">
            We couldn&apos;t resolve your identity from <Code>git config user.email</Code>. Enter your team identifier or
            GitHub username — it&apos;s embedded in every <Code>.ann.json</Code> you write.
          </Text>
          <TextInput
            placeholder="team-a / alice@example.com"
            value={identityDraft}
            onChange={(e) => setIdentityDraft(e.currentTarget.value)}
            autoFocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setIdentityModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitIdentity}>Save identity</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

function SaveStatus({ status, lastSavedAt }: { status: 'idle' | 'saving' | 'saved'; lastSavedAt: number | null }) {
  // Force re-render every 30s so "Saved 1m ago" stays accurate.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (status !== 'saved' || lastSavedAt === null) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [status, lastSavedAt]);

  if (status === 'saving') {
    return (
      <Text size="xs" c="dimmed">
        Saving…
      </Text>
    );
  }
  if (status === 'saved' && lastSavedAt !== null) {
    const secs = Math.max(0, Math.floor((Date.now() - lastSavedAt) / 1000));
    const ago = secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`;
    return (
      <Text size="xs" c="dimmed">
        Saved · {ago}
      </Text>
    );
  }
  return null;
}

// Empty Box import so the bundler keeps it for the unused-but-may-appear-later
// header. Removing the export to keep the linter quiet.
export const _AnnotationGridBox = Box;
