/**
 * Convert an Anthropic Messages request to an Ollama `/api/chat` body. The Anthropic conversion to Chat Completions does the work (system, tool
 * blocks, images, tool names, dropped fields); `chatBody` then puts the result in Ollama's shape: tool arguments as objects, tool results by tool
 * name, `images` as base64, the sampling fields and `max_tokens` in `options`, `thinking` and `output_config.effort` as `think`, and
 * `output_config.format` as `format`. The upstream's `sampling` setting and `metadata.sampling` become further `options`.
 * @param {any} body - Anthropic request body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @param {any} [context] - `{ producer, budget, listed, toolCallIds }`, as for the Chat Completions conversion.
 * @returns {Promise<{body: any, state: any}>} The Ollama body and the conversion state the response converters read.
 */
export function request(body: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>, context?: any): Promise<{
    body: any;
    state: any;
}>;
