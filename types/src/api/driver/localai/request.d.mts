/**
 * Drop tool fields when there are no tools; rename vLLM's `repetition_penalty` to LocalAI's `repeat_penalty`; and take over
 * `parallel_tool_calls: false`. LocalAI does not read that field: whether a model may call several tools in one turn is its YAML
 * `function.parallel_calls`. When the client asked for one call at a time (the Anthropic front's `disable_parallel_tool_use`), the field
 * is removed and `state.localaiSingleCall` makes the response normalizers keep only the first call.
 * @param {any} body - Chat Completions request body.
 * @param {any} [ctx] - `{ state }`.
 * @returns {any} Normalized body.
 */
export function request(body: any, ctx?: any): any;
