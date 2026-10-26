/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/route.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:02-07:00 (1792958342)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * @fileoverview Chooses the upstream endpoint for a requested model.
 * @module @cldmv/llm-translator/lib/route
 */
/**
 * Does the endpoint serve the model?
 * @param {any} endpoint - Runtime endpoint.
 * @param {string} model - Upstream model name.
 * @returns {boolean} True when the endpoint lists the model, or is an Anthropic upstream and the model is a `claude-*` id.
 */
export declare function serves(endpoint: any, model: string): boolean;
/**
 * Pick the endpoint for a model: alias map, then an endpoint serving the model, then the default endpoint, then the first.
 * @param {any} config - Normalized config (`aliases`).
 * @param {any[]} endpoints - Runtime endpoints.
 * @param {string | undefined} model - Model named by the client.
 * @returns {{endpoint: any, model: string | undefined, unserved: boolean}} Chosen endpoint, the model name to send upstream and whether
 * no endpoint serves the model. When nothing serves it and the fallback endpoint knows exactly one model, that model is sent instead.
 */
export declare function pick(config: any, endpoints: any[], model: string | undefined): {
    endpoint: any;
    model: string | undefined;
    unserved: boolean;
};
