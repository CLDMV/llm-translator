/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/usage.mjs
 *	@Date: 2026-10-31T14:00:00-07:00 (1793480400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:00:00-07:00 (1793480400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
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
/**
 * Normalize a usage object of the client protocol.
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @param {any} usage - `usage` as carried by a reply or event.
 * @returns {Record<string, number | null> | null} Normalized counts, or null when there is no usage (an absent object, or all zeros, which a
 * converter writes when the upstream reported nothing and no real reply has).
 */
export declare function normalize(front: "anthropic" | "openai", usage: any): Record<string, number | null> | null;
/**
 * Create the meter for one request.
 * @param {{front: "anthropic" | "openai", requested: string | null, model: string | null, upstream: string | null, stream: boolean}} meta - Request facts; `model` and `upstream` may be filled in later.
 * @param {((report: UsageReport) => any) | undefined} onUsage - Caller's callback.
 * @param {(message: string) => void} warn - Receives a message when `onUsage` throws or rejects.
 * @returns {{meta: any, usage: Promise<UsageReport>, json: (body: any) => void, event: (data: any) => void, finish: (reason: UsageReport["reason"]) => void, track: (source: AsyncIterable<any>, signal?: AbortSignal) => any}} Meter.
 */
export declare function meter(meta: {
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
    track: (source: AsyncIterable<any>, signal?: AbortSignal) => any;
};
