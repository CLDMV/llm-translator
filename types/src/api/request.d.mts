/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/request.mjs
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
 * Route a client request body (in the configured `front` protocol) to an upstream and convert it to that upstream's
 * protocol. Does no I/O.
 * @param {any} body - Client request body (Anthropic Messages or OpenAI Chat Completions, per `front`).
 * @param {any} [options] - `{ front, headers, clientHeaders, filter, images }`. `front` overrides the configured front for this call, `headers` are extra upstream headers, `clientHeaders` are client headers forwarded only to a native Anthropic upstream, `filter` restricts a forwarded OpenAI body to known fields (default: the `passthroughFilter` setting, off), `images: false` sends the request without images (used by the image fallback).
 * @returns {Promise<{upstream: string, method: string, url: string, path: string, headers: Record<string,string>, body: any, state: any, images: {sent: boolean, retry: boolean, key: string}}>} The upstream request and the state `response`/`stream`/`error` need. `images` tells `send` whether the body carries images, whether a refusal may be retried without them and the key under which a refusal is remembered.
 */
export declare function request(body: any, options?: any): Promise<{
    upstream: string;
    method: string;
    url: string;
    path: string;
    headers: Record<string, string>;
    body: any;
    state: any;
    images: {
        sent: boolean;
        retry: boolean;
        key: string;
    };
}>;
