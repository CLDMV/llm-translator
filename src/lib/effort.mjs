/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/effort.mjs
 *	@Date: 2026-11-02T00:00:00-08:00 (1793606400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-02T00:00:00-08:00 (1793606400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Reasoning effort levels per model, and the settings an alias can pin.
 * @module @cldmv/llm-translator/lib/effort
 */
import { TranslatorError } from "./errors.mjs";

/** The effort levels a model can be configured with, lowest to highest. `none` is not one: it switches reasoning off and is never snapped. */
export const LEVELS = Object.freeze(["minimal", "low", "medium", "high", "xhigh", "max"]);

/**
 * @typedef {object} EffortConfig
 * @property {string[]} levels - Supported levels, lowest to highest.
 * @property {string | null | undefined} default - Level sent when the request names none; `null` sends nothing (the model has its own default); `undefined` picks the level nearest to `medium`.
 */

/**
 * @param {string} message - Error text.
 * @returns {TranslatorError} Config error.
 */
function invalid(message) {
	return new TranslatorError(message, { code: "INVALID_CONFIG", status: 500 });
}

/**
 * Validate and normalize the `efforts` config: model name to a list of levels, or `{ levels, default }`.
 * @param {any} [raw] - Raw `efforts` value.
 * @returns {Record<string, EffortConfig>} Normalized map.
 * @throws {TranslatorError} `INVALID_CONFIG` for an unknown level, an empty list or a default that is not in the list.
 */
export function normalizeEfforts(raw) {
	/** @type {Record<string, EffortConfig>} */
	const out = {};
	for (const [model, value] of Object.entries(raw ?? {})) {
		const list = Array.isArray(value) ? value : value?.levels;
		if (!Array.isArray(list) || list.length === 0)
			throw invalid(`efforts.${model} must be a non-empty list of levels or { levels, default }`);
		for (const level of list) {
			if (!LEVELS.includes(level))
				throw invalid(`efforts.${model}: unknown level ${JSON.stringify(level)} (expected ${LEVELS.join(", ")})`);
		}
		const levels = LEVELS.filter((level) => list.includes(level));
		const given = Array.isArray(value) ? undefined : value.default;
		if (given !== undefined && given !== null && !levels.includes(given)) {
			throw invalid(`efforts.${model}.default must be one of its levels or null (got ${JSON.stringify(given)})`);
		}
		out[model] = { levels, default: given };
	}
	return out;
}

/**
 * Split the `aliases` config into the plain name map and the pinned settings. An alias is a model name or `{ model, effort, thinking }`.
 * @param {any} [raw] - Raw `aliases` value.
 * @returns {{aliases: Record<string, string>, pins: Record<string, {effort?: string, thinking?: boolean}>}} Name map and pins.
 * @throws {TranslatorError} `INVALID_CONFIG` for an object alias without a `model`, an unknown `effort` or a non-boolean `thinking`.
 */
export function normalizeAliases(raw) {
	/** @type {Record<string, string>} */
	const aliases = {};
	/** @type {Record<string, {effort?: string, thinking?: boolean}>} */
	const pins = {};
	for (const [name, value] of Object.entries(raw ?? {})) {
		if (typeof value === "string") {
			aliases[name] = value;
			continue;
		}
		if (value === null || typeof value !== "object" || typeof value.model !== "string") {
			throw invalid(`aliases.${name} must be a model name or { model, effort, thinking }`);
		}
		if (value.effort !== undefined && !LEVELS.includes(value.effort)) {
			throw invalid(`aliases.${name}.effort must be one of ${LEVELS.join(", ")} (got ${JSON.stringify(value.effort)})`);
		}
		if (value.thinking !== undefined && typeof value.thinking !== "boolean") {
			throw invalid(`aliases.${name}.thinking must be true or false`);
		}
		aliases[name] = value.model;
		const pin = {};
		if (value.effort !== undefined) pin.effort = value.effort;
		if (value.thinking !== undefined) pin.thinking = value.thinking;
		if (Object.keys(pin).length > 0) pins[name] = pin;
	}
	return { aliases, pins };
}

/**
 * The supported level nearest to a wanted one on the scale; a tie goes to the higher level.
 * @param {string[]} levels - Supported levels.
 * @param {string} wanted - A level from {@link LEVELS}.
 * @returns {string} Supported level.
 */
export function nearest(levels, wanted) {
	const at = LEVELS.indexOf(wanted);
	let best = levels[0];
	for (const level of levels) {
		const gap = Math.abs(LEVELS.indexOf(level) - at);
		const bestGap = Math.abs(LEVELS.indexOf(best) - at);
		if (gap < bestGap || (gap === bestGap && LEVELS.indexOf(level) > LEVELS.indexOf(best))) best = level;
	}
	return best;
}

/**
 * The level sent when a request names none.
 * @param {EffortConfig} entry - Model's effort config.
 * @returns {string | null} Level, or null to send none.
 */
export function defaultOf(entry) {
	return entry.default === undefined ? nearest(entry.levels, "medium") : entry.default;
}

/**
 * Apply an alias's pinned settings to the client body (in the front protocol), before it is converted.
 * @param {any} body - Client body.
 * @param {{effort?: string, thinking?: boolean}} pin - Pinned settings.
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @returns {any} New body.
 */
export function pinBody(body, pin, front) {
	const out = { ...body };
	if (front === "openai") {
		if (pin.effort !== undefined) out.reasoning_effort = pin.effort;
		if (pin.thinking === false) out.reasoning_effort = "none";
		else if (pin.thinking === true && out.reasoning_effort === "none") delete out.reasoning_effort;
		return out;
	}
	if (pin.effort !== undefined) out.output_config = { ...body.output_config, effort: pin.effort };
	if (pin.thinking === false) out.thinking = { type: "disabled" };
	else if (pin.thinking === true && (body.thinking === undefined || body.thinking?.type === "disabled"))
		out.thinking = { type: "adaptive" };
	return out;
}

/**
 * Fit the `reasoning_effort` of an OpenAI Chat Completions body to a model's levels. A level in the list is kept, another one snaps to the
 * nearest (the message is passed to `warn`), a request with no effort gets the model's default, and a request that turns reasoning off is left alone.
 * @param {any} body - Upstream body (mutated).
 * @param {EffortConfig} entry - Model's effort config.
 * @param {string} model - Model name, for the message.
 * @param {(message: string) => void} warn - Warning sink.
 */
export function fit(body, entry, model, warn) {
	if (body.reasoning_effort === "none" || body.chat_template_kwargs?.enable_thinking === false) return;
	const wanted = body.reasoning_effort;
	if (wanted === undefined || wanted === null) {
		const fallback = defaultOf(entry);
		if (fallback !== null) body.reasoning_effort = fallback;
		return;
	}
	if (entry.levels.includes(wanted) || !LEVELS.includes(wanted)) return;
	const level = nearest(entry.levels, wanted);
	warn(`Effort "${wanted}" is not supported by ${model} (${entry.levels.join(", ")}); using "${level}".`);
	body.reasoning_effort = level;
}
