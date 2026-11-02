/**
 * Settings for Ollama: no `top_k` (not accepted on `/v1`), `max_tokens` as the output cap, no `parallel_tool_calls`, and a
 * `contextWindow` of Ollama's default so a prompt that will be truncated is warned about. Raise `contextWindow` to the value the
 * server really runs with (`OLLAMA_CONTEXT_LENGTH` or a Modelfile `num_ctx`).
 * @returns {any} Partial settings.
 */
export function settings(): any;
