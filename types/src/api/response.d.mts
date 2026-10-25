/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/response.mjs
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
 * Convert an upstream response body to the client protocol (a no-op apart from driver normalization and restoring the
 * client's model name when front and upstream speak the same protocol).
 * @param {any} upstreamBody - Parsed upstream JSON body.
 * @param {any} state - The `state` returned by `request`.
 * @returns {Promise<any>} Response body in the client protocol.
 */
export declare function response(upstreamBody: any, state: any): Promise<any>;
