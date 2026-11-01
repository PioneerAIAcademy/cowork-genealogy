import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

// The SPA runs both at `/` and under an edge path prefix, so every request URL it
// builds must be document-relative. A literal starting `/api/`, `/auth/`,
// `/callback` or `/assets/` resolves at the host root and escapes the prefix.

const REPO = join(__dirname, '..', '..', '..', '..')
const ROOTS = [join(REPO, 'apps', 'web', 'src'), join(REPO, 'packages', 'viewer-ui', 'src')]
const ROOT_ABSOLUTE = /^\/(api\/|auth\/|callback|assets\/)/

function sources(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== '__tests__' && e.name !== 'node_modules') out.push(...sources(p))
    } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) {
      out.push(p)
    }
  }
  return out
}

function offenders(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const hits: string[] = []
  const visit = (node: ts.Node): void => {
    let literal: string | null = null
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literal = node.text
    else if (ts.isTemplateExpression(node)) literal = node.head.text
    if (literal !== null && ROOT_ABSOLUTE.test(literal)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
      hits.push(`${relative(REPO, file)}:${line + 1}: ${node.getText(sf)}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

describe('no root-absolute request URLs in the SPA sources', () => {
  const files = ROOTS.flatMap(sources)

  it('scans both trees — a zero-length scan proves nothing', () => {
    expect(files.some((f) => f.startsWith(ROOTS[0]))).toBe(true)
    expect(files.some((f) => f.startsWith(ROOTS[1]))).toBe(true)
  })

  it('has no literal starting /api/, /auth/, /callback or /assets/', () => {
    const hits = files.flatMap(offenders)
    expect(hits, `root-absolute URLs escape a path prefix; drop the leading slash:\n${hits.join('\n')}`).toEqual([])
  })
})
