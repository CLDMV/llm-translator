/**
 * Convert an Anthropic Messages request to a Converse body. The Anthropic conversion to Chat Completions does the work (system, tool blocks,
 * images, tool names, dropped fields); `chatBody` then puts the result in Converse's shape (see there). `thinking: { type: "enabled",
 * budget_tokens }` is sent as `additionalModelRequestFields.thinking` (the Claude form); other thinking modes and an effort are left out and
 * named in `dropped`. The upstream's `sampling` setting and `metadata.sampling` become further `additionalModelRequestFields`.
 * @param {any} body - Anthropic request body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @param {any} [context] - `{ producer, budget, listed, toolCallIds }`, as for the Chat Completions conversion.
 * @returns {Promise<{body: any, state: any}>} The Converse body and the conversion state the response converters read.
 */
export function request(body: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>, context?: any): Promise<{
    body: any;
    state: any;
}>;
