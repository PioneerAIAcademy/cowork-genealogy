'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface HSplitProps {
  /** Exactly three panes, left → right. */
  children: [ReactNode, ReactNode, ReactNode];
  /** Default widths in px for the first two panes. The third pane fills the rest. */
  defaultWidths?: [number, number];
  /** Minimum widths in px for each of the three panes. */
  minWidths?: [number, number, number];
  /** Optional localStorage key — when set, widths are persisted across reloads. */
  storageKey?: string;
}

const DIVIDER_WIDTH = 6;

/**
 * Horizontal 3-pane split with two draggable vertical dividers.
 *
 * - First two pane widths are stateful; the third fills remaining space.
 * - On window resize, widths are clamped so the third pane keeps its min width.
 * - Drag updates widths live; widths persist to localStorage when `storageKey` is set.
 */
export function HSplit({
  children,
  defaultWidths = [260, 520],
  minWidths = [180, 280, 280],
  storageKey,
}: HSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<[number, number]>(defaultWidths);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!storageKey) {
      setHydrated(true);
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          Array.isArray(parsed) &&
          parsed.length === 2 &&
          typeof parsed[0] === 'number' &&
          typeof parsed[1] === 'number'
        ) {
          setWidths([parsed[0], parsed[1]]);
        }
      }
    } catch {
      // ignore malformed entries
    }
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !hydrated) return;
    const id = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(widths));
      } catch {
        // ignore quota errors
      }
    }, 200);
    return () => clearTimeout(id);
  }, [widths, storageKey, hydrated]);

  const clampForContainer = useCallback(
    (next: [number, number]): [number, number] => {
      const total = containerRef.current?.clientWidth ?? 0;
      if (total === 0) return next;
      const available = total - 2 * DIVIDER_WIDTH;
      let [a, b] = next;
      a = Math.max(minWidths[0], a);
      b = Math.max(minWidths[1], b);
      const maxA = available - minWidths[1] - minWidths[2];
      if (a > maxA) a = Math.max(minWidths[0], maxA);
      const maxB = available - a - minWidths[2];
      if (b > maxB) b = Math.max(minWidths[1], maxB);
      return [a, b];
    },
    [minWidths],
  );

  useEffect(() => {
    const onResize = () => {
      setWidths((w) => clampForContainer(w));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampForContainer]);

  const startDrag = (which: 0 | 1) => (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const start: [number, number] = [widths[0], widths[1]];
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const next: [number, number] = [start[0], start[1]];
      if (which === 0) next[0] = start[0] + dx;
      else next[1] = start[1] + dx;
      setWidths(clampForContainer(next));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        width: '100%',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: widths[0],
          minWidth: minWidths[0],
          flexShrink: 0,
          overflow: 'auto',
          minHeight: 0,
        }}
      >
        {children[0]}
      </div>
      <Divider onMouseDown={startDrag(0)} />
      <div
        style={{
          width: widths[1],
          minWidth: minWidths[1],
          flexShrink: 0,
          overflow: 'auto',
          minHeight: 0,
        }}
      >
        {children[1]}
      </div>
      <Divider onMouseDown={startDrag(1)} />
      <div
        style={{
          flex: 1,
          minWidth: minWidths[2],
          overflow: 'auto',
          minHeight: 0,
        }}
      >
        {children[2]}
      </div>
    </div>
  );
}

function Divider({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation="vertical"
      style={{
        width: DIVIDER_WIDTH,
        cursor: 'col-resize',
        background: 'var(--mantine-color-gray-2)',
        flexShrink: 0,
        position: 'relative',
        transition: 'background 120ms',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'var(--mantine-color-blue-3)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'var(--mantine-color-gray-2)';
      }}
    />
  );
}
