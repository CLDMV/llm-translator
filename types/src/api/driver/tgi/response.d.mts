/**
 * Put TGI's historic deviations into the OpenAI shape: `tool_calls` as one object becomes a list, numeric tool-call ids become strings,
 * object `arguments` (or `parameters`) become a JSON string, `eos_token` and `stop_sequence` finish reasons become `stop` (or `tool_calls`
 * when the answer holds calls), and the `text_completion` object name becomes `chat.completion`. Current TGI already answers in the
 * standard shape, which passes through unchanged.
 * @param {any} body - Chat Completions response body.
 * @returns {any} Normalized body.
 */
export function response(body: any): any;
