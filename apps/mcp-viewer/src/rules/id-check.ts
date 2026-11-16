const CHECKS: Array<[string, RegExp]> = [
  ['internal id', /\b(?:[SIRFN]\d+|(?:a|c|ev|h|loc|log|ns|p|pe|pl|pli|ps|q|rj|rp|src|t)_\d+)\b/g],
  ['raw ARK', /ark:\/61903\//g],
  ['bare ARK', /(?<![A-Za-z0-9/:])\d:\d:[A-Z0-9]+(?:-[A-Z0-9]+)+/g],
  ['id-shaped token', /(?<![\w-])(?=[A-Z0-9-]*[A-Z])[A-Z0-9]{4}(?:-[A-Z0-9]{3,4})+(?![\w-])/g],
  ['bracket left holding only separators', /[([][\s,;:/+&→–—-]*[)\]]/g]
]

/** Every id or id debris left in rendered text. A URL shown as written is not checked. */
export function leftoverIds(text: string): string[] {
  const prose = text.replace(/https?:\/\/[^\s<>]+/g, ' ')
  const found: string[] = []
  for (const [kind, re] of CHECKS) {
    for (const match of prose.matchAll(re)) found.push(`${kind}: ${match[0]}`)
  }
  return found
}
