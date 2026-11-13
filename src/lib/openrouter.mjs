/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/openrouter.mjs
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
 * @fileoverview OpenRouter error objects found inside a successful reply: on a choice, or on the reply or a stream chunk itself.
 * @module @cldmv/llm-translator/lib/openrouter
 */
import { TranslatorError } from "./errors.mjs";

/**
 * Is a value an OpenRouter error object (`{ code, message, metadata? }`)?
 * @param {any} value - Candidate.
 * @returns {boolean} True for an object with a string `message`.
 */
function isError(value) {
	return value !== null && typeof value === "object" && typeof value.message === "string";
}

/**
 * The error a reply that answered HTTP 200 carries: `choices[i].error` on every choice (the provider failed while generating; the choice's
 * `finish_reason` is `"error"` and any partial text is not used), or a top-level `error` with no choices.
 * @param {any} body - Parsed reply body.
 * @returns {{code: any, message: string, metadata?: any} | null} The error object, or null when the reply has none to report.
 */
export function found(body) {
	if (!body || typeof body !== "object") return null;
	if (Array.isArray(body.choices) && body.choices.length > 0) {
		return body.choices.every((choice) => isError(choice?.error)) ? body.choices[0].error : null;
	}
	return isError(body.error) ? body.error : null;
}

/**
 * The `TranslatorError` for an OpenRouter error object. Its numeric `code` is the HTTP status when it is a client or server error, else 502; the
 * `code` of the error is `metadata.error_type` when OpenRouter gives one, else `upstream_error`.
 * @param {{code?: any, message: string, metadata?: any}} error - Error object.
 * @returns {TranslatorError} Error to throw.
 */
export function failure(error) {
	const status = Number.isInteger(error.code) && error.code >= 400 && error.code <= 599 ? error.code : 502;
	const kind = typeof error.metadata?.error_type === "string" ? error.metadata.error_type : "upstream_error";
	const provider = typeof error.metadata?.provider_name === "string" ? ` (provider ${error.metadata.provider_name})` : "";
	return new TranslatorError(`${error.message}${provider}`, { code: kind, status });
}
