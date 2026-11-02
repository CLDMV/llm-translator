/**
 * Convert an Anthropic message into an OpenAI `chat.completion`. Text blocks are concatenated, `thinking` blocks
 * become the reasoning field named by `reasoningField`, `tool_use` blocks become `tool_calls` (tool names restored
 * through `state.toolNames`), and other block types (server tool results) are skipped. With `reasoningRoundTrip`, thinking and redacted thinking
 * blocks are also returned as `reasoning_details` items that carry their signatures.
 * @param {any} message - Anthropic message.
 * @param {any} [state] - State from the request converter (original model, tool-name map).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} OpenAI chat completion.
 */
export function response(message: any, state?: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): any;
