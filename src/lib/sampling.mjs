/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/sampling.mjs
 *	@Date: 2026-11-06T12:00:00-07:00 (1794078000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-06T12:00:00-07:00 (1794078000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Sampling extension fields (`min_p`, `repetition_penalty`, `seed` and friends) that Anthropic requests cannot carry.
 * @module @cldmv/llm-translator/lib/sampling
 */
import { TranslatorError } from "./errors.mjs";

/** Standard Chat Completions sampling fields every OpenAI-protocol server takes, beside the extension fields a driver lists in `info().fields`. */
const STANDARD = ["seed", "frequency_penalty", "presence_penalty"];

/**
 * Sampling fields to add to an OpenAI-protocol request: the `sampling` setting for the upstream, overridden by `metadata.sampling` of an
 * Anthropic request. Fields the body already carries are kept. A field the upstream's driver does not accept follows `unknownFields`:
 * dropped (listed in `dropped`) or rejected. Names are the canonical vLLM ones; a driver such as llama.cpp renames them in its `request`.
 * @param {any} body - Converted or forwarded Chat Completions body.
 * @param {any} extras - `metadata.sampling` of the client request (ignored unless a plain object).
 * @param {any} settings - Resolved settings (`sampling`, `unknownFields`).
 * @param {string[]} [fields] - Extension fields the upstream's driver accepts.
 * @param {string[]} [dropped] - Receives the names that were left out.
 * @returns {any} The body, with the fields added (a copy when anything was added).
 * @throws {TranslatorError} When a field is not accepted and `unknownFields` is `"error"`.
 */
export function addSampling(body, extras, settings, fields = [], dropped = []) {
	const asked = { ...settings.sampling, ...(extras !== null && typeof extras === "object" && !Array.isArray(extras) ? extras : {}) };
	let out = body;
	for (const [name, value] of Object.entries(asked)) {
		if (value === undefined || value === null || Object.hasOwn(body, name)) continue;
		if (!STANDARD.includes(name) && !fields.includes(name)) {
			if (settings.unknownFields === "error") {
				throw new TranslatorError(`sampling.${name}: is not accepted by this upstream`, {
					code: "unsupported_field",
					param: `sampling.${name}`
				});
			}
			if (!dropped.includes(name)) dropped.push(name);
			continue;
		}
		if (out === body) out = { ...body };
		out[name] = value;
	}
	return out;
}
