/**
 * Compact a conversation (`POST /v1/responses/compact`). The conversation is sent to the model through one ordinary `send` with a request to summarise it, and the
 * result is the window to continue from: the conversation's user messages as they were, and a `compaction` item whose `encrypted_content` carries the summary
 * (written by this translator; see `lib/responses.mjs`). A later request that sends the item has it turned into a user message with the summary. UNSURE: the
 * shape follows OpenAI's documented `response.compaction` object (`id`, `object`, `output`, `usage`, `created_at`); whether OpenAI keeps every user message or
 * only the recent ones is not known here, and the translator keeps all of them.
 * @param {any} body - `{ model, input, instructions? }`: the conversation to compact (the route has already resolved `previous_response_id` and `conversation` into `input`).
 * @param {any} [options] - `{ signal, onUsage, log, clientHeaders }`, as for `send`.
 * @returns {Promise<any>} The reply: `{ status: 200, body: { id, object: "response.compaction", created_at, output, usage } }`, or the upstream's error reply.
 * @throws {TranslatorError} `invalid_request` for a body without a model or an input, `unsupported_field` for `previous_response_id` or `conversation` (no response store), and the request converter's errors for an input it cannot convert (`unsupported_content` for a `compaction` item this translator did not write).
 */
export function compact(body: any, options?: any): Promise<any>;
