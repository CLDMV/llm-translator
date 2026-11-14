/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/model/list.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:00-07:00 (1792958340)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Root api: client-shaped model list across all upstreams.
 * @module @cldmv/llm-translator/model
 */
import { context, self } from "../../lib/runtime.mjs";
import { capture } from "../../lib/capture.mjs";
import { defaultOf, nearest } from "../../lib/effort.mjs";
import { knownModels } from "../../lib/models.mjs";

/**
 * List the models the upstreams serve (live when the driver can, else detection/config data), plus the configured aliases,
 * in the client protocol's list shape (Anthropic `{data:[{type:"model",...}]}` or OpenAI `{object:"list",data:[...]}`).
 * @param {any} [options] - `{ signal, front }`.
 * @returns {Promise<any>} Model list.
 */
export async function list(options = {}) {
	const c = capture(self, context, options.front);
	const found = new Map();
	await Promise.all(
		c.state.endpoints.map(async (endpoint) => {
			const driver = c.driver(endpoint);
			const live = driver.list
				? await driver.list({ endpoint, transport: c.state.transport, signal: options.signal, timeout: c.config.detectTimeout })
				: null;
			const entries = live ?? knownModels(endpoint);
			for (const entry of entries) found.set(entry.id, { ...entry, upstream: endpoint.name });
		})
	);
	for (const alias of Object.keys(c.config.aliases)) {
		const target = found.get(c.config.aliases[alias]);
		found.set(alias, { ...target, id: alias, alias_of: c.config.aliases[alias] });
	}
	const models = [...found.values()].map((entry) => ({ ...entry, ...levelsOf(c.config, entry) }));
	if (c.front === "openai") {
		return {
			object: "list",
			data: models.map((entry) => ({
				id: entry.id,
				object: "model",
				created: entry.created ?? 0,
				owned_by: entry.owned_by ?? entry.upstream ?? "llm-translator",
				...(entry.max_model_len === undefined ? {} : { max_model_len: entry.max_model_len }),
				...extras(entry)
			}))
		};
	}
	const data = models.map((entry) => ({
		type: "model",
		id: entry.id,
		display_name: entry.id,
		created_at: new Date((entry.created ?? 0) * 1000).toISOString(),
		...(entry.max_model_len === undefined ? {} : { max_input_tokens: entry.max_model_len }),
		...extras(entry)
	}));
	return { data, has_more: false, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null };
}

/**
 * The effort levels a list entry offers: the configured levels of its model, or for an alias that pins settings, the one effort it pins
 * (snapped to the model's levels), or none when it turns thinking off.
 * @param {any} config - Normalized config (`efforts`, `pins`).
 * @param {any} entry - List entry (`id`, `alias_of`).
 * @returns {{levels?: string[], default_effort?: string | null, effort?: string, thinking?: boolean}} Fields to add to the entry (internal names).
 */
function levelsOf(config, entry) {
	const model = entry.alias_of ?? entry.id;
	const configured = Object.hasOwn(config.efforts, model) ? config.efforts[model] : undefined;
	const pin = entry.alias_of !== undefined && Object.hasOwn(config.pins, entry.id) ? config.pins[entry.id] : {};
	const out = {};
	if (pin.thinking !== undefined) out.thinking = pin.thinking;
	if (pin.thinking === false) return out;
	if (pin.effort !== undefined) {
		out.effort = configured ? nearest(configured.levels, pin.effort) : pin.effort;
		out.levels = [out.effort];
		out.default_effort = out.effort;
	} else if (configured) {
		out.levels = configured.levels;
		out.default_effort = defaultOf(configured);
	}
	return out;
}

/**
 * Translator fields of a list entry in the client shape: `parent` (the base model) for a LoRA adapter, `efforts` and `default_effort` for a model with configured levels, and for an alias
 * `alias_of` plus the `effort` and `thinking` it pins.
 * @param {any} entry - List entry.
 * @returns {object} Fields to merge into the model object.
 */
function extras(entry) {
	return {
		...(typeof entry.parent === "string" && entry.parent !== "" ? { parent: entry.parent } : {}),
		...(entry.alias_of === undefined ? {} : { alias_of: entry.alias_of }),
		...(entry.levels === undefined ? {} : { efforts: entry.levels, default_effort: entry.default_effort }),
		...(entry.effort === undefined ? {} : { effort: entry.effort }),
		...(entry.thinking === undefined ? {} : { thinking: entry.thinking })
	};
}
