# `place_distance` — great-circle distance between two places — Spec

> **Status:** New (2026-09-22, issue #1119). First behavioral contract for
> this tool; previously documented only by consumer-side mentions.

```
place_distance({ standardPlace1, standardPlace2 }) -> { standardPlace1, standardPlace2, miles, kilometers }
```

---

## 1. Purpose

Returns the approximate straight-line (great-circle) distance between two
places, in both miles and kilometers. The caller supplies two standard
place names (the `standardPlace` field from `place_search`); the tool
resolves each to coordinates internally and computes the haversine
distance. No travel routing, no road distances.

## 2. Input

```typescript
{
  standardPlace1: string;   // required
  standardPlace2: string;   // required
}
```

Both values are standard place names as returned by `place_search`'s
`standardPlace` field (e.g. `"Paris, Bear Lake, Idaho, United States"`).
The tool resolves each to coordinates via `standardPlaceToCoords`
(`src/utils/place-resolver.ts`); the caller never supplies coordinates
directly.

## 3. Output

```typescript
{
  standardPlace1: string;   // echoed verbatim from input
  standardPlace2: string;   // echoed verbatim from input
  miles: number;            // whole integer, Math.round
  kilometers: number;       // whole integer, Math.round
}
```

- `standardPlace1` and `standardPlace2` are the **input names echoed
  verbatim** — not the resolved or canonical place names.
- Both distances are `Math.round`ed to whole numbers (no decimals).
- The computation is haversine great-circle on a sphere of radius
  6,371 km, converted at 0.621371 km-to-miles.

## 4. Errors

The tool throws on failure. `src/server.ts` catches the throw and returns
`{ error: "<message>" }` with `isError: true` — that envelope is what the
model sees.

| Condition | Message |
|-----------|---------|
| First place cannot be resolved | `Could not resolve coordinates for "<standardPlace1>". Use place_search to get a standard place name first.` |
| Second place cannot be resolved | `Could not resolve coordinates for "<standardPlace2>". Use place_search to get a standard place name first.` |

The first-place guard runs before the second (`distance.ts:51-62`), so
when both names fail only the first error appears.

**What the error does not distinguish.** `standardPlaceToCoords` swallows
every upstream failure and returns `null` (`place-resolver.ts:669-673`),
so one message covers three cases: an unknown place name, a Places API
outage, and a `fetchWithTimeout` timeout. The error text says "could not
resolve," not "is not a standard place."

## 5. Authentication and network

- **No FamilySearch token required.** `src/utils/place-api.ts` sends no
  `Authorization` header, so `place_distance` works before `login`.
- **No retry.** Uses `fetchWithTimeout` (not `fetchWithRetry`);
  `place-api.ts` is one of the named retry exclusions. A transient
  upstream failure is not retried.
- Both places are resolved concurrently (`Promise.all`).

## 6. Consumers

- **Skills:** `timeline/SKILL.md`, `conflict-resolution/SKILL.md`.
- **Agents:** `gps-mentor.md`, `person-evidence.md`.
- **Shared reference:** `references/places-guidance.md` (carried by 9
  skills).
- **Persisted field:** `distance_from_previous_km` in timeline events
  (`research-schema-spec.md`): great-circle distance in km from the
  previous event's place, via `place_distance` on the two
  `standard_place` names.

## 7. Implementation

Source: `packages/engine/mcp-server/src/tools/distance.ts` (exports
`placeDistanceTool` and `placeDistanceToolSchema`). Schema registered in
`allToolSchemas` (`src/tool-schemas.ts`), dispatch in `src/server.ts`.
Smoke test: `dev/try-place-distance.ts`.

Tests: `tests/tools/distance.test.ts` — 6 cases covering haversine
accuracy (London-New York), zero distance (same point), integer rounding,
successful tool call, and both single-place resolution failures.
