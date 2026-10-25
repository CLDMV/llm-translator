/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/errors.test.vitest.mjs
 *	@Date: 2026-10-25T12:18:47-07:00 (1792955927)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T13:31:33-07:00 (1792960293)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { describe, expect, test } from "vitest";
import {
	TranslatorError,
	anthropicError,
	anthropicToOpenAIType,
	anthropicTypeToStatus,
	openaiError,
	openaiToAnthropicType,
	contextOverflow,
	rewriteContextOverflow,
	statusToAnthropicType
} from "../../src/lib/errors.mjs";

describe("TranslatorError", () => {
	test("defaults to a 400 invalid_request_error", () => {
		const error = new TranslatorError("bad");
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe("TranslatorError");
		expect(error).toMatchObject({ code: "translator_error", status: 400, type: "invalid_request_error", param: null });
		expect(error.details).toBeUndefined();
	});

	test("renders in both protocols", () => {
		const error = new TranslatorError("nope", { code: "x", status: 429, param: "messages", details: { a: 1 } });
		expect(error.details).toEqual({ a: 1 });
		expect(error.toAnthropic()).toEqual({ type: "error", error: { type: "rate_limit_error", message: "nope" } });
		expect(error.toOpenAI()).toEqual({ error: { message: "nope", type: "rate_limit_error", param: "messages", code: "x" } });
	});

	test("explicit type wins over the status-derived type", () => {
		expect(new TranslatorError("big", { status: 413, type: "request_too_large" }).type).toBe("request_too_large");
	});
});

describe("type mapping", () => {
	test("status to anthropic type", () => {
		const table = {
			400: "invalid_request_error",
			401: "authentication_error",
			403: "permission_error",
			404: "not_found_error",
			413: "request_too_large",
			429: "rate_limit_error",
			529: "overloaded_error",
			502: "api_error",
			503: "overloaded_error",
			504: "api_error",
			500: "api_error"
		};
		for (const [status, type] of Object.entries(table)) expect(statusToAnthropicType(Number(status))).toBe(type);
	});

	test("anthropic type to status", () => {
		const table = {
			invalid_request_error: 400,
			authentication_error: 401,
			permission_error: 403,
			not_found_error: 404,
			request_too_large: 413,
			rate_limit_error: 429,
			overloaded_error: 529,
			api_error: 500,
			whatever: 500
		};
		for (const [type, status] of Object.entries(table)) expect(anthropicTypeToStatus(type)).toBe(status);
	});

	test("anthropic type to openai type", () => {
		expect(anthropicToOpenAIType("invalid_request_error")).toBe("invalid_request_error");
		expect(anthropicToOpenAIType("not_found_error")).toBe("invalid_request_error");
		expect(anthropicToOpenAIType("request_too_large")).toBe("invalid_request_error");
		expect(anthropicToOpenAIType("authentication_error")).toBe("authentication_error");
		expect(anthropicToOpenAIType("permission_error")).toBe("permission_error");
		expect(anthropicToOpenAIType("rate_limit_error")).toBe("rate_limit_error");
		expect(anthropicToOpenAIType("overloaded_error")).toBe("server_error");
		expect(anthropicToOpenAIType("api_error")).toBe("server_error");
	});

	test("openai error to anthropic type", () => {
		expect(openaiToAnthropicType({ type: "x" }, 429)).toBe("rate_limit_error");
		expect(openaiToAnthropicType({ code: 400 })).toBe("invalid_request_error");
		expect(openaiToAnthropicType({ code: "503" })).toBe("overloaded_error");
		expect(openaiToAnthropicType({ code: 500 })).toBe("api_error");
		expect(openaiToAnthropicType({ code: "string_code", type: "invalid_request_error" })).toBe("invalid_request_error");
		expect(openaiToAnthropicType({ type: "BadRequestError" })).toBe("invalid_request_error");
		expect(openaiToAnthropicType({ type: "authentication_error" })).toBe("authentication_error");
		expect(openaiToAnthropicType({ type: "rate_limit_error" })).toBe("rate_limit_error");
		expect(openaiToAnthropicType({ type: "server_error" })).toBe("api_error");
		expect(openaiToAnthropicType({ code: 200 })).toBe("api_error");
	});

	test("body builders", () => {
		expect(anthropicError("api_error", "m")).toEqual({ type: "error", error: { type: "api_error", message: "m" } });
		expect(openaiError("m")).toEqual({ error: { message: "m", type: "server_error", param: null, code: null } });
		expect(openaiError("m", { type: "t", param: "p", code: 7 })).toEqual({ error: { message: "m", type: "t", param: "p", code: 7 } });
	});
});

describe("rewriteContextOverflow", () => {
	test("classic vLLM wording", () => {
		const message =
			"This model's maximum context length is 32768 tokens. However, you requested 40000 tokens (35000 in the messages, 5000 in the completion). Please reduce the length of the messages or completion.";
		expect(rewriteContextOverflow(message)).toBe("prompt is too long: 40000 tokens > 32768 maximum");
	});

	test("input/output wording", () => {
		const message =
			"You passed 35001 input tokens and requested 5000 output tokens. However, the model's context length is only 32768 tokens, resulting in a maximum input length of 27768 tokens.";
		expect(rewriteContextOverflow(message)).toBe("prompt is too long: 40001 tokens > 32768 maximum");
	});

	test("current vLLM wording reports the prompt size", () => {
		expect(
			rewriteContextOverflow("This model's maximum context length is 4096 tokens. However, your prompt contains 5000 input tokens.")
		).toBe("prompt is too long: 5000 tokens > 4096 maximum");
		expect(rewriteContextOverflow("maximum context length is 4096 tokens, your request has 4100 tokens")).toBe(
			"prompt is too long: 4100 tokens > 4096 maximum"
		);
		expect(rewriteContextOverflow("maximum context length is 4096 tokens (4200 in the messages)")).toBe(
			"prompt is too long: 4200 tokens > 4096 maximum"
		);
	});

	test("a message without sizes reports max + 1", () => {
		expect(rewriteContextOverflow("maximum context length is 10 tokens")).toBe("prompt is too long: 11 tokens > 10 maximum");
	});

	test("contextOverflow exposes the counts", () => {
		expect(contextOverflow("maximum context length is 10 tokens, you requested 30 tokens")).toEqual({ prompt: 30, max: 10 });
		expect(contextOverflow("nothing")).toBeNull();
	});

	test("no match", () => {
		expect(rewriteContextOverflow("something else")).toBeNull();
		expect(rewriteContextOverflow(undefined)).toBeNull();
	});
});
