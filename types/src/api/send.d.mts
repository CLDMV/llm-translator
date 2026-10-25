/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/send.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:01-07:00 (1792958341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * Send a client request to the routed upstream and return the client-protocol reply.
 * @param {any} body - Client request body (per `front`).
 * @param {any} [options] - `{ signal, front, headers, clientHeaders, filter }`: abort signal for the upstream call, per-call front, extra upstream headers, client headers forwarded to a native Anthropic upstream, and the pass-through body filter (see `request`).
 * @returns {Promise<{status: number, headers: Record<string,string>, body: any} | {status: number, headers: Record<string,string>, stream: AsyncIterable<{event?: string, data: *}>}>} A JSON reply, or a stream reply when the client asked for streaming and the upstream accepted.
 */
export declare function send(body: any, options?: any): Promise<{
    status: number;
    headers: Record<string, string>;
    body: any;
} | {
    status: number;
    headers: Record<string, string>;
    stream: AsyncIterable<{
        event?: string;
        data: any;
    }>;
}>;
