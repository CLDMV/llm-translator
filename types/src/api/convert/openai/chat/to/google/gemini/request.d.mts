/**
 * Convert a Chat Completions request to a `generateContent` body (see `chatBody`). The upstream's `sampling` setting becomes further
 * `generationConfig` fields and its `gemini` setting the safety settings, built-in tools and the rest it names. A GIF image becomes a PNG first.
 * @param {any} body - Chat Completions request body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @param {any} [context] - `{ model, signal, report }`: the model the request goes to (the body's `model` is the client's name for it), the caller's abort signal and a function that receives one event per image fetched.
 * @returns {Promise<{body: any, state: any}>} The Gemini body and the conversion state the response converters read.
 * @throws {TranslatorError} `invalid_request` when `messages` is missing.
 */
export function request(body: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>, context?: any): Promise<{
    body: any;
    state: any;
}>;
