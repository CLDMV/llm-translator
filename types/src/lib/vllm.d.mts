/**
 * Is the native endpoint wanted for this upstream, going by the `nativeMessages` setting and the version?
 * @param {any} endpoint - Runtime endpoint.
 * @param {any} settings - Resolved settings for the endpoint.
 * @returns {boolean} True for a vLLM upstream with `nativeMessages: true`, or `"auto"` and a known version of 0.11.1 or later (an unknown version stays on conversion).
 */
export function wants(endpoint: any, settings: any): boolean;
/**
 * Why a request cannot go to the native endpoint, so it is converted instead.
 *
 * - `prefill`: the last message is from the assistant. The endpoint turns it into a finished assistant turn and starts a new one, where conversion continues it.
 * - `document`: the endpoint accepts no `document` blocks; conversion extracts their text and page images.
 * - `toolsearch`: deferred tools (`defer_loading`, `tool_reference` and `tool_addition` blocks) are expanded by the translator unless `toolSearch` is `native`.
 * @param {any} body - Anthropic request body.
 * @param {any} settings - Resolved settings for the endpoint.
 * @returns {"prefill" | "document" | "toolsearch" | null} The reason, or null when the endpoint can take the request.
 */
export function unsuited(body: any, settings: any): "prefill" | "document" | "toolsearch" | null;
/**
 * Normalise an Anthropic request for vLLM's `/v1/messages`: the system prompt becomes one string without the billing header, and failed
 * tool results carry the `toolErrors` marker when that setting is on. Everything else goes through unchanged (the endpoint ignores fields it does not know).
 * @param {any} body - Anthropic request body.
 * @param {any} settings - Resolved settings for the endpoint.
 * @returns {any} Body to send.
 */
export function request(body: any, settings: any): any;
/**
 * Give thinking blocks that have no signature the translator's own marker (vLLM before 0.17 sends none; clients expect the field).
 * @param {any} body - Anthropic reply body.
 * @returns {any} The reply, with every thinking block signed.
 */
export function response(body: any): any;
/**
 * Normalise the event stream of the native endpoint: a `ping` follows `message_start` (Anthropic sends one, vLLM does not), and a thinking block that ends without
 * a `signature_delta` gets one before its `content_block_stop`.
 * @param {AsyncIterable<{event?: string, data: any}>} source - Events of the endpoint.
 * @returns {AsyncGenerator<{event?: string, data: any}>} Events for the client.
 */
export function stream(source: AsyncIterable<{
    event?: string;
    data: any;
}>): AsyncGenerator<{
    event?: string;
    data: any;
}>;
/** First vLLM release that serves `/v1/messages` (vllm-project/vllm#22627). */
export const MIN_VERSION: "0.11.1";
