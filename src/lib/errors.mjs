/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/errors.mjs
 *	@Date: 2026-10-25T12:29:30-07:00 (1792956570)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T13:31:30-07:00 (1792960290)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Error type shared by every converter, plus helpers that render an error in either wire protocol.
 */

/**
 * Error raised for requests or upstream replies the translator cannot (or will not) convert. Carries enough
 * information to be rendered as an Anthropic or an OpenAI error body.
 */
export class TranslatorError extends Error {
	/**
	 * @param {string} message - Human readable message (sent to the client).
	 * @param {object} [options] - Error metadata.
	 * @param {string} [options.code] - Stable machine readable code (for example `"unsupported_field"`).
	 * @param {number} [options.status] - HTTP status to answer with.
	 * @param {string} [options.type] - Anthropic style error type.
	 * @param {string|null} [options.param] - Offending request parameter, when known.
	 * @param {unknown} [options.details] - Extra data for logs and tests.
	 */
	constructor(message, options = {}) {
		super(message);
		const { code = "translator_error", status = 400, type = statusToAnthropicType(status), param = null, details } = options;
		this.name = "TranslatorError";
		this.code = code;
		this.status = status;
		this.type = type;
		this.param = param;
		this.details = details;
	}

	/**
	 * Render as an Anthropic error body.
	 * @returns {{ type: "error", error: { type: string, message: string } }} Anthropic error body.
	 */
	toAnthropic() {
		return anthropicError(this.type, this.message);
	}

	/**
	 * Render as an OpenAI error body.
	 * @returns {{ error: { message: string, type: string, param: string|null, code: string|number|null } }} OpenAI error body.
	 */
	toOpenAI() {
		return openaiError(this.message, { type: anthropicToOpenAIType(this.type), param: this.param, code: this.code });
	}
}

/**
 * Anthropic error type for an HTTP status.
 * @param {number} status - HTTP status code.
 * @returns {string} Anthropic error type.
 */
export function statusToAnthropicType(status) {
	switch (status) {
		case 400:
			return "invalid_request_error";
		case 401:
			return "authentication_error";
		case 403:
			return "permission_error";
		case 404:
			return "not_found_error";
		case 413:
			return "request_too_large";
		case 429:
			return "rate_limit_error";
		case 503:
		case 529:
			return "overloaded_error";
		default:
			return "api_error";
	}
}

/**
 * HTTP status for an Anthropic error type.
 * @param {string} type - Anthropic error type.
 * @returns {number} HTTP status code.
 */
export function anthropicTypeToStatus(type) {
	switch (type) {
		case "invalid_request_error":
			return 400;
		case "authentication_error":
			return 401;
		case "permission_error":
			return 403;
		case "not_found_error":
			return 404;
		case "request_too_large":
			return 413;
		case "rate_limit_error":
			return 429;
		case "overloaded_error":
			return 529;
		default:
			return 500;
	}
}

/**
 * OpenAI style error type for an Anthropic error type.
 * @param {string} type - Anthropic error type.
 * @returns {string} OpenAI error type.
 */
export function anthropicToOpenAIType(type) {
	switch (type) {
		case "invalid_request_error":
		case "not_found_error":
		case "request_too_large":
			return "invalid_request_error";
		case "authentication_error":
			return "authentication_error";
		case "permission_error":
			return "permission_error";
		case "rate_limit_error":
			return "rate_limit_error";
		default:
			return "server_error";
	}
}

/**
 * Anthropic error type for an OpenAI style error object (type and/or numeric code and/or HTTP status).
 * @param {{ type?: string|null, code?: string|number|null }} error - OpenAI error object.
 * @param {number} [status] - HTTP status of the reply, when known.
 * @returns {string} Anthropic error type.
 */
export function openaiToAnthropicType(error, status) {
	if (typeof status === "number") return statusToAnthropicType(status);
	const numeric = Number(error.code);
	if (Number.isInteger(numeric) && numeric >= 400) return statusToAnthropicType(numeric);
	switch (error.type) {
		case "invalid_request_error":
		case "BadRequestError":
			return "invalid_request_error";
		case "authentication_error":
			return "authentication_error";
		case "rate_limit_error":
			return "rate_limit_error";
		default:
			return "api_error";
	}
}

/**
 * Build an Anthropic error body.
 * @param {string} type - Anthropic error type.
 * @param {string} message - Error message.
 * @returns {{ type: "error", error: { type: string, message: string } }} Anthropic error body.
 */
export function anthropicError(type, message) {
	return { type: "error", error: { type, message } };
}

/**
 * Build an OpenAI error body.
 * @param {string} message - Error message.
 * @param {{ type?: string, param?: string|null, code?: string|number|null }} [fields] - Optional fields.
 * @returns {{ error: { message: string, type: string, param: string|null, code: string|number|null } }} OpenAI error body.
 */
export function openaiError(message, { type = "server_error", param = null, code = null } = {}) {
	return { error: { message, type, param, code } };
}

const CONTEXT_MAX = /(?:maximum context length is|context length is only) (\d+) tokens/i;
const CONTEXT_REQUESTED = /you requested (\d+) tokens/i;
const CONTEXT_PASSED = /you passed (\d+) input tokens and requested (\d+) output tokens/i;
const CONTEXT_PROMPT = /(?:prompt contains|request has|your request contains) (\d+) (?:input )?tokens/i;
const CONTEXT_MESSAGES = /(\d+) in the messages/i;

/**
 * Detect an OpenAI/vLLM "context length exceeded" message and rewrite it in Anthropic's wording
 * (`prompt is too long: <n> tokens > <max> maximum`), which Claude Code recognises and answers with
 * auto-compaction. `n` is the total the request asked for (prompt plus requested completion) when the message
 * reports it, otherwise the prompt size, and `max + 1` when the message gives no size, so `n` always exceeds the maximum.
 * @param {string} message - Upstream error message.
 * @returns {string|null} Rewritten message, or null when the message is not a context overflow.
 */
export function rewriteContextOverflow(message) {
	const counts = contextOverflow(message);
	return counts === null ? null : `prompt is too long: ${counts.prompt} tokens > ${counts.max} maximum`;
}

/**
 * Token counts from a context-overflow message.
 * @param {string} message - Upstream error message.
 * @returns {{ prompt: number, max: number }|null} Counts (`prompt` is the requested total, or the prompt size, or `max + 1`), or null when not an overflow.
 */
export function contextOverflow(message) {
	if (typeof message !== "string") return null;
	const max = CONTEXT_MAX.exec(message);
	if (!max) return null;
	const limit = Number(max[1]);
	const passed = CONTEXT_PASSED.exec(message);
	if (passed) return { prompt: Number(passed[1]) + Number(passed[2]), max: limit };
	const size = CONTEXT_REQUESTED.exec(message) ?? CONTEXT_PROMPT.exec(message) ?? CONTEXT_MESSAGES.exec(message);
	return { prompt: size ? Number(size[1]) : limit + 1, max: limit };
}
