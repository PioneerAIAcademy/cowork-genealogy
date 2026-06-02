// Reverse-lookup helper: replaces the removed LogEntry.captured_source_ids /
// produced_assertion_ids fields. Sources and assertions now carry log_entry_id
// and we derive the per-log groupings from that pointer.

export function indexByLogEntry<T extends { log_entry_id?: string | null }>(
  items: T[]
): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    if (!item.log_entry_id) continue
    const list = map.get(item.log_entry_id) ?? []
    list.push(item)
    map.set(item.log_entry_id, list)
  }
  return map
}
