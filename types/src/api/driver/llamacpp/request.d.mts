/**
 * Drop tool fields when there are no tools; send `parallel_tool_calls: true` with tools (llama-server leaves parallel calls off unless
 * asked, and the converter only ever sends `false`); and rename vLLM's `repetition_penalty` to llama.cpp's `repeat_penalty`.
 * @param {any} body - Chat Completions request body.
 * @param {any} [ctx] - `{ settings }`.
 * @returns {any} Normalized body.
 */
export function request(body: any, ctx?: any): any;
