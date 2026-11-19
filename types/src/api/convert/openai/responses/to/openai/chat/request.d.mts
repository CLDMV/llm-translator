/**
 * Convert an OpenAI Responses request body into a Chat Completions request body, the pivot every upstream is reached through.
 *
 * The core is stateless: `previous_response_id`, `conversation`, `store: true`, `background: true` and stored prompts are refused, and so are hosted tools,
 * non-function `tool_choice` values and input items other than messages, function calls, function call outputs and reasoning items.
 * `instructions` becomes the first system message. Reasoning items are replayed to the upstream only with `reasoningRoundTrip` (their
 * `encrypted_content` carries the `reasoning_details` the converter put there); otherwise they are dropped. Fields without a mapping are
 * dropped and listed in `state.dropped`, or refused when `unknownFields` is `"error"`.
 * @param {any} body - OpenAI `POST /v1/responses` body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {{ body: any, state: any }} Chat Completions body and the state the reply converters need (`model`, `stream`, `echo`, `dropped`).
 * @throws {TranslatorError} `invalid_request` for a malformed body, `unsupported_field` for stateful parameters and unmapped fields under `unknownFields: "error"`, `unsupported_tool` and `unsupported_content` for what has no counterpart.
 */
export function request(body: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): {
    body: any;
    state: any;
};
