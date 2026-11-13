/**
 * Turn an error OpenRouter sent with HTTP 200 into an upstream error: `choices[i].error` on every choice, or a top-level `error` and no choices.
 * Any partial text of the failed choice is dropped. A reply with a choice that did not fail passes unchanged.
 * @param {any} body - Parsed `chat.completion`.
 * @returns {any} The body.
 * @throws {import("../../../lib/errors.mjs").TranslatorError} With the error's `message` and its `code` as the HTTP status.
 */
export function response(body: any): any;
