/**
 * Convert an Anthropic Messages request to a `generateContent` body. The Anthropic conversion to Chat Completions does the work (system, tool
 * blocks, images, tool names, dropped fields, the thought signatures a client sent back); `chatBody` then puts the result in Gemini's shape (see
 * there). `thinking: { type: "enabled", budget_tokens }` is sent as `thinkingConfig.thinkingBudget`; an effort or `thinking: { type:
 * "disabled" }` becomes a budget too (a level on a Gemini 3 model, chosen by the model sent). Base64 PDFs are sent as they are, for Gemini to read. The upstream's `sampling` setting and `metadata.sampling` become further `generationConfig` fields.
 * @param {any} body - Anthropic request body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @param {any} [context] - `{ producer, budget, listed, toolCallIds, model }`, as for the Chat Completions conversion; `model` is the model the request goes to, which decides between a thinking budget and a level.
 * @returns {Promise<{body: any, state: any}>} The Gemini body and the conversion state the response converters read.
 */
export function request(body: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>, context?: any): Promise<{
    body: any;
    state: any;
}>;
