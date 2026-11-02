/**
 * Remove `tool_choice`, `n` and `logit_bias` (recorded in `state.dropped`; with `tool_choice: "none"` the tools are removed too, so a forbidden tool call cannot happen), replace images given by URL with a note, and warn once per
 * upstream when the prompt is estimated to exceed `contextWindow` (Ollama truncates silently).
 * @param {any} body - Chat Completions request body.
 * @param {any} [ctx] - `{ endpoint, settings, state, warn }`.
 * @returns {any} Normalized body.
 */
export function request(body: any, ctx?: any): any;
