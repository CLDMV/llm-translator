/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/send.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:45:53-07:00 (1793483153)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * Send a client request to the routed upstream and return the client-protocol reply.
 *
 * Every reply, including error replies, carries a non-enumerable `usage` property: a `Promise` of the usage report that never rejects.
 * For JSON and error replies it is already settled. For a stream reply it settles when the stream ends, throws or is returned early
 * (`break` or `return()`); a stream nobody iterates never settles. `onUsage` is called with the same report exactly once, also when
 * `send` throws (for example when the caller aborted). The report is `{ input_tokens, output_tokens, cache_read_input_tokens,
 * cache_creation_input_tokens, reported, complete, reason, model, requested, upstream, front, stream }`: token fields are numbers or
 * `null` (never 0 for unknown), `reported` is false when the upstream carried no usage, `complete` is true only for a reply that finished
 * normally and `reason` is `"done"`, `"aborted"`, `"error"` or `"upstream_error"`. A stream that ends early reports the usage seen so far.
 *
 * When a converted reply's upstream sent no usage, the client-protocol reply carries estimates instead of zeros: the server tokenizer's
 * count when the driver has one, else one token per four characters (what `token.count` uses) for the input, and one token per four
 * characters of generated text for the output. The report never presents them as real counts: its token fields stay `null`,
 * `reported` stays false and the estimates are in `estimated: { input_tokens, output_tokens }` (null when the upstream reported usage).
 * On the Anthropic front a stream carries them in the final `message_delta`, because `message_start` is sent before the output is known.
 * Replies passed through without conversion are never altered.
 * @param {any} body - Client request body (per `front`).
 * @param {any} [options] - `{ signal, front, headers, clientHeaders, filter, onUsage }`: abort signal for the upstream call, per-call front, extra upstream headers, client headers forwarded to a native Anthropic upstream, the pass-through body filter (see `request`) and the usage callback (an exception in it is reported as a warning and never breaks the reply).
 * @returns {Promise<{status: number, headers: Record<string,string>, body: any, usage: Promise<any>} | {status: number, headers: Record<string,string>, stream: AsyncIterable<{event?: string, data: *}>, usage: Promise<any>}>} A JSON reply, or a stream reply when the client asked for streaming and the upstream accepted.
 */
export declare function send(body: any, options?: any): Promise<{
    status: number;
    headers: Record<string, string>;
    body: any;
    usage: Promise<any>;
} | {
    status: number;
    headers: Record<string, string>;
    stream: AsyncIterable<{
        event?: string;
        data: any;
    }>;
    usage: Promise<any>;
}>;
