/**
 * Put a streamed TGI chunk into the OpenAI shape: `delta.tool_calls` as one object becomes a list, numeric ids become strings, object
 * `arguments` become a JSON string, an empty id (TGI repeats the field on every fragment) is removed so the fragment continues the open
 * call, and `eos_token` / `stop_sequence` finish reasons become `stop` (or `tool_calls` once the stream carried calls).
 * @param {any} chunk - Parsed `chat.completion.chunk`.
 * @param {any} [ctx] - `{ state }`; remembers whether the stream carried tool calls.
 * @returns {any} Normalized chunk.
 */
export function chunk(chunk: any, ctx?: any): any;
