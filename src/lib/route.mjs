/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/route.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
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
 * @fileoverview Chooses the upstream endpoint for a requested model.
 * @module @cldmv/llm-translator/lib/route
 */
import { TranslatorError } from "./errors.mjs";
import { order } from "./pool.mjs";
import { baseModels } from "./models.mjs";

/**
 * Does the endpoint serve the model?
 * @param {any} endpoint - Runtime endpoint.
 * @param {string} model - Upstream model name.
 * @returns {boolean} True when the endpoint lists the model, or is an Anthropic upstream and the model is a `claude-*` id.
 */
export function serves(endpoint, model) {
	const listed = endpoint.models ?? endpoint.facts?.models ?? [];
	if (listed.includes(model)) return true;
	return endpoint.protocol === "anthropic.messages" && endpoint.models === undefined && /^claude-/.test(model);
}

/**
 * Pick the endpoint for a model: alias map, then the endpoints serving the model (a pool, ordered by the model's strategy and health;
 * the first is chosen), then the default endpoint, then the first.
 * @param {any} config - Normalized config (`aliases`, `pool`).
 * @param {any[]} endpoints - Runtime endpoints.
 * @param {string | undefined} model - Model named by the client.
 * @param {any} state - Translator state (`cursors`).
 * @param {boolean} [advance] - Move the round robin cursor (false to only look).
 * @returns {{endpoint: any, model: string | undefined, unserved: boolean, pool: any[], pin: {effort?: string, thinking?: boolean} | undefined}} Chosen endpoint, the model name to send upstream, whether
 * no endpoint serves the model and the endpoints to try in order (the chosen one first). When nothing serves it and the fallback endpoint knows
 * exactly one base model (adapters aside), that model is sent instead.
 */
export function pick(config, endpoints, model, state, advance = false) {
	const aliased = Object.hasOwn(config.aliases, model);
	const target = aliased ? config.aliases[model] : model;
	const pin = aliased && Object.hasOwn(config.pins, model) ? config.pins[model] : undefined;
	const matches = endpoints.filter((entry) => serves(entry, target));
	const fallback = endpoints.find((entry) => entry.default) ?? endpoints[0];
	if (matches.length > 0) {
		const pool = order(config, state, matches, target, advance);
		return { endpoint: pool[0], model: target, unserved: false, pool, pin };
	}
	// LoRA adapters do not count: a server with one base model and some adapters still has exactly one model to fall back to.
	const known = baseModels(fallback);
	if (known.length === 1) return { endpoint: fallback, model: known[0], unserved: false, pool: [fallback], pin };
	return { endpoint: fallback, model: target, unserved: true, pool: [fallback], pin };
}

/**
 * Validate a client request body and resolve where it goes. Shared by `request` and `route` so both always agree.
 * @param {any} c - Captured translator parts (`capture`).
 * @param {any} body - Client request body.
 * @param {{endpoint?: string, advance?: boolean}} [options] - `endpoint` forces one pool member by name (used for failover; it must still serve the model, else `endpoint_not_in_pool`); `advance` moves the round robin cursor (`request` does, `route` does not).
 * @returns {{endpoint: any, model: string, requested: string | undefined, unserved: boolean, pin: {effort?: string, thinking?: boolean} | undefined, convert: any, pool: any[]}} The chosen endpoint, the model name sent
 * upstream, the model the client asked for, whether no endpoint serves it, the settings its alias pins, the converters (null for a native pass-through) and the pool in try order.
 * @throws {TranslatorError} `invalid_body` when the body is not a JSON object, `endpoint_not_in_pool` when a forced endpoint no longer serves the model.
 */
export function resolve(c, body, options = {}) {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new TranslatorError("The request body must be a JSON object", { code: "invalid_body", status: 400 });
	}
	const picked = pick(c.config, c.state.endpoints, body.model, c.state, options.advance === true);
	if (options.endpoint !== undefined) {
		const forced = picked.pool.find((entry) => entry.name === options.endpoint);
		if (!forced) {
			throw new TranslatorError(`Endpoint ${options.endpoint} no longer serves ${picked.model}`, {
				code: "endpoint_not_in_pool",
				status: 500
			});
		}
		return {
			endpoint: forced,
			model: picked.model,
			requested: body.model,
			unserved: picked.unserved,
			pin: picked.pin,
			convert: c.converters(forced, body),
			pool: [forced]
		};
	}
	const { endpoint, pool } = picked;
	return {
		endpoint,
		model: picked.model,
		requested: body.model,
		unserved: picked.unserved,
		pin: picked.pin,
		convert: c.converters(endpoint, body),
		pool
	};
}
