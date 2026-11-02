/**
 * Return a sanitized deep copy of a JSON Schema: drops `$schema` and numeric bounds at or beyond +-(2^53 - 1)
 * (Claude Code emits `maximum: 9007199254740991` on integers, which strict grammar backends dislike). The input is
 * never mutated.
 * @param {unknown} schema - JSON Schema (or any JSON value found inside one).
 * @returns {unknown} Sanitized copy.
 */
export function sanitize(schema: unknown): unknown;
