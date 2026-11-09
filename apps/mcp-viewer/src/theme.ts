import { applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps'
import type { HostContext } from './hosts/host'

/** Applies what the host gave; the stylesheet stands on its own without it. */
export function applyHostTheme(context: HostContext): void {
  if (context.theme) applyDocumentTheme(context.theme)
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables)
}
