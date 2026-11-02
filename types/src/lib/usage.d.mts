/**
 * Normalize a usage object. Fields the source did not carry stay null: unknown is never reported as 0.
 * @param {"anthropic" | "openai" | "folded"} protocol - Shape of `usage`: Anthropic (`input_tokens`, ...), OpenAI (`prompt_tokens`, ...) or `folded` (Anthropic, reported the way the OpenAI front does).
 * @param {any} usage - A `usage` object.
 * @returns {Record<string, number | null> | null} Normalized counts, or null when there is no usage (an absent object, or all zeros, which a
 * converter writes when the upstream reported nothing and no real reply has).
 */
export function normalize(protocol: "anthropic" | "openai" | "folded", usage: any): Record<string, number | null> | null;
/**
 * Create the meter for one request.
 * @param {{front: "anthropic" | "openai", requested: string | null, model: string | null, upstream: string | null, stream: boolean}} meta - Request facts; `model` and `upstream` may be filled in later.
 * @param {((report: UsageReport) => any) | undefined} onUsage - Caller's callback.
 * @param {(message: string) => void} warn - Receives a message when `onUsage` throws or rejects.
 * @returns {{meta: any, usage: Promise<UsageReport>, json: (body: any) => void, event: (data: any) => void, finish: (reason: UsageReport["reason"]) => void, estimate: (counts: {input_tokens: number | null, output_tokens: number | null}) => void, source: (read: (() => any) | null, protocol?: "openai" | "folded") => void, track: (source: AsyncIterable<any>, signal?: AbortSignal, hide?: boolean) => any}} Meter.
 */
export function meter(meta: {
    front: "anthropic" | "openai";
    requested: string | null;
    model: string | null;
    upstream: string | null;
    stream: boolean;
}, onUsage: ((report: UsageReport) => any) | undefined, warn: (message: string) => void): {
    meta: any;
    usage: Promise<UsageReport>;
    json: (body: any) => void;
    event: (data: any) => void;
    finish: (reason: UsageReport["reason"]) => void;
    estimate: (counts: {
        input_tokens: number | null;
        output_tokens: number | null;
    }) => void;
    source: (read: (() => any) | null, protocol?: "openai" | "folded") => void;
    track: (source: AsyncIterable<any>, signal?: AbortSignal, hide?: boolean) => any;
};
export type UsageReport = {
    /**
     * - Prompt tokens that were not served from cache, or null when unknown.
     */
    input_tokens: number | null;
    /**
     * - Completion tokens, or null when unknown.
     */
    output_tokens: number | null;
    /**
     * - Prompt tokens served from cache, or null when unknown.
     */
    cache_read_input_tokens: number | null;
    /**
     * - Prompt tokens written to cache, or null when unknown.
     */
    cache_creation_input_tokens: number | null;
    /**
     * - True when the reply carried usage; false means every token field is null.
     */
    reported: boolean;
    /**
     * - The estimates written into the client reply for the sides the upstream did not report (a side the upstream did report is null here); null when nothing was estimated (the upstream reported both sides, a pass-through reply, a reply that failed first). Never mixed into the token fields.
     */
    estimated: {
        input_tokens: number | null;
        output_tokens: number | null;
    } | null;
    /**
     * - True only when the reply finished normally.
     */
    complete: boolean;
    /**
     * - Why the report was produced.
     */
    reason: "done" | "aborted" | "error" | "upstream_error";
    /**
     * - Model name sent upstream.
     */
    model: string | null;
    /**
     * - Model the client asked for.
     */
    requested: string | null;
    /**
     * - Upstream endpoint name.
     */
    upstream: string | null;
    /**
     * - Client protocol.
     */
    front: "anthropic" | "openai";
    /**
     * - Whether the client asked for a stream.
     */
    stream: boolean;
};
