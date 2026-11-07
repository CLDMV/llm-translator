/**
 * Sampling fields to add to an OpenAI-protocol request: the `sampling` setting for the upstream, overridden by `metadata.sampling` of an
 * Anthropic request. Fields the body already carries are kept. A field the upstream's driver does not accept follows `unknownFields`:
 * dropped (listed in `dropped`) or rejected. Names are the canonical vLLM ones; a driver such as llama.cpp renames them in its `request`.
 * @param {any} body - Converted or forwarded Chat Completions body.
 * @param {any} extras - `metadata.sampling` of the client request (ignored unless a plain object).
 * @param {any} settings - Resolved settings (`sampling`, `unknownFields`).
 * @param {string[]} [fields] - Extension fields the upstream's driver accepts.
 * @param {string[]} [dropped] - Receives the names that were left out.
 * @returns {any} The body, with the fields added (a copy when anything was added).
 * @throws {TranslatorError} When a field is not accepted and `unknownFields` is `"error"`.
 */
export function addSampling(body: any, extras: any, settings: any, fields?: string[], dropped?: string[]): any;
