'use client';

/**
 * Lightweight markdown renderer — internal tool, low surface area.
 * Supports headings, paragraphs, bullets, inline code, links.
 * For full markdown we'd pull react-markdown; the README files we
 * render here only use a small subset.
 */
import { Anchor, Code, List, Text, Title } from '@mantine/core';

interface Token {
  kind: 'h1' | 'h2' | 'h3' | 'p' | 'ul';
  text?: string;
  items?: string[];
}

function tokenize(md: string): Token[] {
  const lines = md.split(/\r?\n/);
  const out: Token[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^#{1,3}\s+/.test(line)) {
      const level = line.match(/^(#+)/)![1].length as 1 | 2 | 3;
      out.push({ kind: `h${level}` as Token['kind'], text: line.replace(/^#+\s+/, '') });
      i++;
      continue;
    }
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      out.push({ kind: 'ul', items });
      continue;
    }
    // Paragraph: collect lines until blank.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^#{1,3}\s+/.test(lines[i]) && !/^[-*]\s+/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    out.push({ kind: 'p', text: para.join(' ') });
  }
  return out;
}

function renderInline(text: string): React.ReactNode[] {
  // Handle **bold**, `code`, and [link](url) — minimal viable.
  const parts: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/;
  while (rest.length) {
    const m = rest.match(re);
    if (!m) {
      parts.push(rest);
      break;
    }
    const idx = m.index ?? 0;
    if (idx > 0) parts.push(rest.slice(0, idx));
    const token = m[0];
    if (token.startsWith('**')) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      parts.push(
        <Code key={key++}>{token.slice(1, -1)}</Code>,
      );
    } else if (token.startsWith('[')) {
      const m2 = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (m2) {
        parts.push(
          <Anchor key={key++} href={m2[2]} target="_blank" rel="noreferrer">
            {m2[1]}
          </Anchor>,
        );
      } else {
        parts.push(token);
      }
    }
    rest = rest.slice(idx + token.length);
  }
  return parts;
}

export function MarkdownViewer({ content }: { content: string }) {
  const tokens = tokenize(content);
  return (
    <>
      {tokens.map((t, idx) => {
        if (t.kind === 'h1') return <Title key={idx} order={2} mb="xs">{renderInline(t.text!)}</Title>;
        if (t.kind === 'h2') return <Title key={idx} order={3} mt="md" mb="xs">{renderInline(t.text!)}</Title>;
        if (t.kind === 'h3') return <Title key={idx} order={4} mt="sm" mb="xs">{renderInline(t.text!)}</Title>;
        if (t.kind === 'ul')
          return (
            <List key={idx} mb="sm">
              {t.items!.map((item, jdx) => (
                <List.Item key={jdx}>{renderInline(item)}</List.Item>
              ))}
            </List>
          );
        return (
          <Text key={idx} mb="sm">
            {renderInline(t.text!)}
          </Text>
        );
      })}
    </>
  );
}
