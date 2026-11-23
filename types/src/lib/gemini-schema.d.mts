/**
 * A JSON Schema as Gemini takes it. Kept: `type` (a list too), `title`, `description`, `properties`, `required`, `additionalProperties`,
 * `enum`, `format` (`date-time`, `date`, `time`), `minimum`, `maximum`, `items`, `prefixItems`, `minItems`, `maxItems` and `anyOf`.
 * Rewritten: `oneOf` is `anyOf`, `const` is a one-value `enum`, `nullable: true` adds `"null"` to the type, `allOf` is merged into the node,
 * and a local `$ref` into `$defs` or `definitions` is replaced by its target (a recursive one is expanded once and then left out, since
 * Gemini's schemas are not recursive here). Removed: `$schema`, `$id`, `$comment`, `$defs`, `definitions`, `default`, `examples`,
 * `exclusiveMinimum`, `exclusiveMaximum`, `pattern`, `patternProperties`, `propertyNames`, `uniqueItems`, `not`, `if`, `then`, `else`,
 * unknown formats and every other keyword. The input is never changed.
 * @param {unknown} schema - JSON Schema.
 * @returns {any} The schema for Gemini.
 */
export function gemini(schema: unknown): any;
