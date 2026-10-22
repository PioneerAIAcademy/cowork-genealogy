// Recover a nested object/array tool argument that the model serialized as a
// JSON *string* instead of inline JSON.
//
// LLMs occasionally emit a structured tool argument as an opaque JSON string,
// most often when the argument is large or deeply nested — a record's full
// `research_append` / `tree_edit` `ops` batch can be ~25 KB, which is exactly
// the size that pushes the model toward stringifying. The MCP input schema
// declares these fields as `array`/`object`, so a string value is
// unambiguously a mis-serialization of the intended structure, not a legal
// input. Left unhandled it fails the tool's `Array.isArray` / shape checks
// ("`ops` must be a non-empty array"), and the model — seeing the rejection —
// falls back to one entry per call, exploding a single batched write into
// dozens of sequential turns (the root cause of the record-extraction eval
// wall-clock timeouts).
//
// This helper is deliberately conservative: it only touches strings, and only
// substitutes the parsed value when the string parses as JSON. A non-string
// passes through untouched, and an unparseable string is returned as-is so the
// tool's normal validation still emits the correct, specific error.
export function coerceJsonArg(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Why a string argument could not be parsed: the engine's own message, and where. */
export interface JsonParseFailure {
  message: string;
  offset: number | null;
}

// The reason `coerceJsonArg` swallowed, for the one caller that wants to give
// it back. A batch with a stray comma otherwise surfaces as "`ops` must be a
// non-empty array" and the model has nothing to fix. A sibling rather than a
// new return type on `coerceJsonArg`, which seven tools share.
//
// `undefined` unless `value` is a string that `JSON.parse` rejects. `offset` is
// V8's own `position N` when its message carries one, the length of the string
// for "Unexpected end of JSON input", and null otherwise: V8 gives no position
// in its "Unexpected token 'x', ..." message, but that message quotes the text
// around the token.
export function jsonParseFailure(value: unknown): JsonParseFailure | undefined {
  if (typeof value !== "string") return undefined;
  try {
    JSON.parse(value);
    return undefined;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const at = /\bposition (\d+)\b/.exec(message);
    if (at) return { message, offset: Number(at[1]) };
    if (message.startsWith("Unexpected end of JSON input")) return { message, offset: value.length };
    return { message, offset: null };
  }
}
