/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/azure/error.mjs
 *	@Date: 2026-11-13T09:00:00-08:00 (1794589200)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T09:00:00-08:00 (1794589200)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Azure OpenAI driver: error normalizer.
 * @module @cldmv/llm-translator/driver/azure
 */
import * as upstream from "../../../lib/upstream-error.mjs";

/**
 * Names of the harm categories whose filter result in `innererror.content_filter_result` has `filtered: true`, with their severity.
 * @param {any} results - `content_filter_result` of an error's `innererror`.
 * @returns {string[]} For example `["hate (high)", "violence (medium)"]`.
 */
function filtered(results) {
	if (!results || typeof results !== "object") return [];
	return Object.entries(results)
		.filter(([, value]) => value?.filtered === true)
		.map(([name, value]) => (typeof value.severity === "string" ? `${name} (${value.severity})` : name));
}

/**
 * Normalize to the nested OpenAI shape. A prompt refused by Azure's content filter (HTTP 400, `error.code: "content_filter"`) keeps its code and
 * `param`, and its message names the categories that were filtered when `innererror.content_filter_result` says so.
 * @param {number} status - HTTP status.
 * @param {*} body - Parsed upstream error body.
 * @returns {{error: {message: string, type: string | undefined, param: *, code: *}}} Nested error body.
 */
export function error(status, body) {
	const info = upstream.parse(body, status);
	let message = info.message;
	if (info.code === "content_filter") {
		const names = filtered(body?.error?.innererror?.content_filter_result);
		if (names.length > 0) message += ` Filtered categories: ${names.join(", ")}.`;
	}
	return { error: { message, type: info.type, param: info.param ?? null, code: info.code ?? status } };
}
