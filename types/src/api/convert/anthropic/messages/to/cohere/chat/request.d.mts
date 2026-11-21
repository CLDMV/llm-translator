/**
 * Convert an Anthropic Messages request to a Cohere `/v2/chat` body. The Anthropic conversion to Chat Completions does the work (system, tool
 * blocks, images, tool names, dropped fields); `chatBody` then puts the result in Cohere's shape (see there). `thinking` becomes Cohere's
 * `thinking` (`enabled` with `budget_tokens` as `token_budget`, or `disabled`), an `output_config.effort` turns it on, and `output_config.format`
 * becomes `response_format`. The upstream's `sampling` setting and `metadata.sampling` become further Cohere fields.
 * @param {any} body - Anthropic request body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @param {any} [context] - `{ producer, budget, listed, toolCallIds }`, as for the Chat Completions conversion.
 * @returns {Promise<{body: any, state: any}>} The Cohere body and the conversion state the response converters read.
 */
export function request(body: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>, context?: any): Promise<{
    body: any;
    state: any;
}>;
