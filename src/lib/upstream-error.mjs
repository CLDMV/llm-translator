/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/upstream-error.mjs
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
 * @fileoverview Parses upstream error bodies and renders errors in the client protocol's shape.
 * @module @cldmv/llm-translator/lib/upstream-error
 */
import { contextOverflow, rewriteContextOverflow, statusToAnthropicType } from "./errors.mjs";

/**
 * Message from a FastAPI-style `detail` (a string, or a list of `{ msg }` validation errors).
 * @param {any} value - `body.detail`.
 * @returns {string | undefined} Message, or undefined when `detail` carries none.
 */
function detail(value) {
	if (typeof value === "string" && value !== "") return value;
	if (!Array.isArray(value)) return undefined;
	const messages = value.map((entry) => entry?.msg).filter((msg) => typeof msg === "string" && msg !== "");
	return messages.length > 0 ? messages.join("; ") : undefined;
}

/**
 * Anthropic error type for an HTTP status.
 * @param {number} status - HTTP status.
 * @returns {string} Anthropic `error.type`.
 */
export function anthropicType(status) {
	const type = statusToAnthropicType(status);
	return type === "api_error" && status < 500 ? "invalid_request_error" : type;
}

/**
 * OpenAI error type for an HTTP status.
 * @param {number} status - HTTP status.
 * @returns {string} OpenAI `error.type`.
 */
export function openaiType(status) {
	if (status === 401) return "authentication_error";
	if (status === 403) return "permission_denied_error";
	if (status === 404) return "not_found_error";
	if (status === 429) return "rate_limit_error";
	if (status >= 500) return "server_error";
	return "invalid_request_error";
}

/**
 * Pull `{ message, type, code, param }` out of any known upstream error body shape: nested OpenAI/vLLM
 * (`{error:{message,type,param,code}}`), flat old vLLM (`{message,type,param,code}`), Anthropic
 * (`{type:"error",error:{type,message}}`), `{error:"text"}`, a bare string, or nothing.
 * @param {*} body - Parsed upstream body.
 * @param {number} status - HTTP status, used for the fallback message.
 * @returns {{message: string, type?: string, code?: *, param?: *}} Normalized error.
 */
export function parse(body, status) {
	const fallback = `upstream returned HTTP ${status}`;
	if (typeof body === "string") return { message: body || fallback };
	if (!body || typeof body !== "object") return { message: fallback };
	const inner = body.error;
	if (typeof inner === "string") return { message: inner };
	const source = inner && typeof inner === "object" ? inner : body;
	return {
		message: typeof source.message === "string" && source.message !== "" ? source.message : (detail(body.detail) ?? fallback),
		type: typeof source.type === "string" ? source.type : undefined,
		code: source.code,
		param: source.param
	};
}

/**
 * Render an error body in the client protocol.
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @param {number} status - HTTP status.
 * @param {{message: string, type?: string, code?: *, param?: *}} info - Normalized error.
 * @param {any} [options] - `{ native: boolean }`: keep the upstream `type` when it is already valid for this protocol.
 * @returns {{status: number, body: any}} Status and body in the client shape.
 */
export function render(front, status, info, options = {}) {
	if (front === "anthropic") {
		const rewritten = rewriteContextOverflow(info.message);
		if (rewritten !== null) {
			return {
				status: 400,
				body: {
					type: "error",
					error: { type: "invalid_request_error", message: rewritten }
				}
			};
		}
		const type = options.native && info.type ? info.type : anthropicType(status);
		return { status, body: { type: "error", error: { type, message: info.message } } };
	}
	const type = options.native && info.type ? info.type : openaiType(status);
	return {
		status,
		body: {
			error: {
				message: info.message,
				type,
				param: info.param ?? null,
				code: contextOverflow(info.message) ? "context_length_exceeded" : (info.code ?? null)
			}
		}
	};
}
