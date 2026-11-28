/**
 * Convert an OpenAI Responses request body into a Chat Completions request body, the pivot every upstream is reached through.
 *
 * The core is stateless: `previous_response_id`, `conversation`, `store: true`, `background: true` and stored prompts are refused (the routes resolve
 * them first when a response store is on). Tools are classified by the table in `lib/responses-tools.mjs`: function and custom tools map, `web_search`,
 * `code_interpreter` and `tool_search` become function tools marked for the hosted tool runner (`lib/hostedtools.mjs`, which needs a `serverTools`
 * executor and refuses the request without one), `shell` and `apply_patch` become functions whose calls the reply converters return as their client-executed
 * items, and every other type is refused with `unsupported_tool`. Input items other than messages, function and custom calls and their outputs, `shell` and
 * `apply_patch` calls and outputs, hosted `web_search_call`, `code_interpreter_call` and `tool_search` items, `compaction` items and reasoning items are refused.
 * `instructions` becomes the first system message. Reasoning items are replayed to the upstream only with `reasoningRoundTrip` (their
 * `encrypted_content` carries the `reasoning_details` the converter put there); otherwise they are dropped. Fields without a mapping are
 * dropped and listed in `state.dropped`, or refused when `unknownFields` is `"error"`.
 * @param {any} body - OpenAI `POST /v1/responses` body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {{ body: any, state: any }} Chat Completions body and the state the reply converters need (`model`, `stream`, `echo`, `dropped`).
 * @throws {TranslatorError} `invalid_request` for a malformed body, `unsupported_field` for stateful parameters, a `context_management` entry that is not a compaction and unmapped fields under `unknownFields: "error"`, `unsupported_tool` and `unsupported_content` for what has no counterpart.
 */
export function request(body: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): {
    body: any;
    state: any;
};
