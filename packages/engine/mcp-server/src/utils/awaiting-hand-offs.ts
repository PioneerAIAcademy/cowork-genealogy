/**
 * Hand-offs still waiting on the researcher: one rule, one copy.
 *
 * An external-site search is an errand. We generate a URL, the researcher runs
 * it and brings back a capture. Between those the plan item is open but is NOT
 * work the agent can do, and several callers need that distinction:
 *
 *   - `project_context` reports them as `awaitingUser`, so a skill does not
 *     hand the same URL out twice;
 *   - the step boundary excludes them from `open_items`, so one does not hold a
 *     turn's boundary open (`plugin/hooks/step_boundary.py`).
 *
 * It lived inside `project-context.ts` until the step boundary needed the same
 * answer. The Python mirror in `step_boundary.py` cannot import this one (it
 * ships into a different artifact), so `test_awaiting_hand_offs_parity.py` runs
 * both over one shared fixture — the write-lockdown copies drifted exactly this
 * way, and were silently a no-op on Windows for two releases (issue #1228).
 */

export interface AwaitingHandOff {
  logId: string;
  site: string;
  urlGenerated: string;
  planItemId: string | null;
  performed: string | null;
}

/** The `external_site` payload of a log entry, or null when it is not one. */
export function externalSiteOf(entry: any): any | null {
  if (!entry || typeof entry !== "object" || entry.tool !== "external_site") return null;
  const ext = entry.external_site;
  return ext && typeof ext === "object" && typeof ext.url_generated === "string" ? ext : null;
}

/**
 * Whether a later log entry ends the hand-off at `url` (spec §2.3): any entry
 * for the same URL whose outcome is not `partial`, whether or not a capture
 * came back. "I have no access" is logged as `error` with no capture, and after
 * it the user is not holding a link from us.
 */
export function closesHandOff(entry: any, url: string): boolean {
  const ext = externalSiteOf(entry);
  return ext !== null && ext.url_generated === url && entry.outcome !== "partial";
}

/**
 * Every in-flight hand-off still waiting on the user: an `external_site` entry
 * with `outcome: "partial"` and `capture_received: false` that no LATER entry
 * closes. Keyed on `partial`, not on `capture_received` alone: a `positive`
 * entry logged with `capture_received: false` already had its results in hand
 * (alpha feedback #2864, `log_012`/`log_013`) and is not waiting on anyone.
 */
export function awaitingUserHandOffs(log: unknown): AwaitingHandOff[] {
  const entries: any[] = Array.isArray(log) ? log : [];
  const open: AwaitingHandOff[] = [];
  entries.forEach((entry, i) => {
    const ext = externalSiteOf(entry);
    if (ext === null || entry.outcome !== "partial" || ext.capture_received !== false) return;
    if (typeof entry.id !== "string") return;
    if (entries.slice(i + 1).some((later) => closesHandOff(later, ext.url_generated))) return;
    open.push({
      logId: entry.id,
      site: typeof ext.site === "string" ? ext.site : "",
      urlGenerated: ext.url_generated,
      planItemId: typeof entry.plan_item_id === "string" ? entry.plan_item_id : null,
      performed: typeof entry.performed === "string" ? entry.performed : null,
    });
  });
  return open;
}

/** The plan items those hand-offs belong to -- what `step_ctx` excludes. */
export function awaitingUploadItemIds(log: unknown): Set<string> {
  const ids = new Set<string>();
  for (const handOff of awaitingUserHandOffs(log)) {
    if (handOff.planItemId !== null) ids.add(handOff.planItemId);
  }
  return ids;
}
