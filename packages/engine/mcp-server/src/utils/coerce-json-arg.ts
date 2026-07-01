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
