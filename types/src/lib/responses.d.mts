/**
 * A Responses style id: `resp_`, `msg_`, `fc_`, `fco_`, `rs_` or `conv_` and 24 hex digits.
 * @param {"resp" | "msg" | "fc" | "fco" | "rs" | "conv"} prefix - Id family.
 * @returns {string} The id.
 */
export function itemId(prefix: "resp" | "msg" | "fc" | "fco" | "rs" | "conv"): string;
/**
 * Pack the `reasoning_details` of a reply into the `encrypted_content` of a reasoning item, so the client sends them back with the next turn.
 * @param {unknown} details - `reasoning_details` list.
 * @returns {string | undefined} The carrier string, or undefined when there is nothing to carry.
 */
export function pack(details: unknown): string | undefined;
/**
 * Read back what {@link pack} wrote. Anything else (another producer's data, a malformed or oversized value) gives null.
 * @param {unknown} value - `encrypted_content` of a reasoning item the client sent.
 * @returns {object[] | null} The `reasoning_details` items, or null.
 */
export function unpack(value: unknown): object[] | null;
/**
 * Responses usage for a Chat Completions usage object.
 * @param {any} usage - Chat `usage` (may be absent).
 * @returns {{input_tokens: number, input_tokens_details: {cached_tokens: number}, output_tokens: number, output_tokens_details: {reasoning_tokens: number}, total_tokens: number} | null} Usage, or null when the upstream sent none.
 */
export function usageOf(usage: any): {
    input_tokens: number;
    input_tokens_details: {
        cached_tokens: number;
    };
    output_tokens: number;
    output_tokens_details: {
        reasoning_tokens: number;
    };
    total_tokens: number;
} | null;
/**
 * Status and `incomplete_details` for a Chat Completions `finish_reason`: a length stop and a content filter end the response early.
 * @param {string | null | undefined} finish - `finish_reason`.
 * @returns {{status: "completed"} | {status: "incomplete", incomplete_details: {reason: string}}} Terminal status.
 */
export function endOf(finish: string | null | undefined): {
    status: "completed";
} | {
    status: "incomplete";
    incomplete_details: {
        reason: string;
    };
};
/**
 * The response object around a list of output items, echoing the request parameters the way the API does.
 * @param {any} state - State from the request converter (`model`, `echo`).
 * @param {{id: string, created: number, status: string, model?: string, output: any[], usage?: any, error?: any, incomplete_details?: any}} parts - Per-response parts.
 * @returns {any} Response object.
 */
export function envelope(state: any, parts: {
    id: string;
    created: number;
    status: string;
    model?: string;
    output: any[];
    usage?: any;
    error?: any;
    incomplete_details?: any;
}): any;
/**
 * A failure's `{ code, message }` for a response in the `failed` status.
 * @param {any} error - Chat error object (`{ message, type, code }`) or anything else thrown.
 * @returns {{code: string, message: string}} Error as a response carries it.
 */
export function failureOf(error: any): {
    code: string;
    message: string;
};
