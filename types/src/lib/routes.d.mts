/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/routes.mjs
 *	@Date: 2026-10-25T12:56:43-07:00 (1792958203)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:45:55-07:00 (1793483155)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * Events for a stream reply committed before the upstream answered: the upstream's stream when it accepted, else its error
 * as a final error event (the HTTP status is already 200, so the error travels in-band).
 * @param {Promise<any>} sending - Pending `send` result.
 * @param {any} api - Captured translator parts.
 * @param {string} [model] - Model the client asked for (used in the early `message_start`).
 * @returns {AsyncGenerator<any>} Client events.
 */
export declare function late(sending: Promise<any>, api: any, model?: string): AsyncGenerator<any>;
/**
 * Register the routes for one front on a Fastify instance.
 * @param {any} fastify - Fastify instance (usually an encapsulated plugin scope).
 * @param {any} options - `{ apiKey, bodyLimit, authorize, onUsage }`.
 * @param {any} captured - Captured translator parts `{ front, interval, filter, send, route, count, list, get, build, encode, write }`; `front` applies to this instance only.
 * @returns {void}
 */
export declare function register(fastify: any, options: any, captured: any): void;
