/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/error.test.vitest.mjs
 *	@Date: 2026-10-25T12:21:17-07:00 (1792956077)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T13:31:31-07:00 (1792960291)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { afterEach, describe, expect, it } from "vitest";
import { closeAll, fakeTransport, make } from "../helpers/translator.mjs";

afterEach(closeAll);

const hooks = new URL("../fixtures/driver/hooks", import.meta.url).pathname;

describe("error (anthropic front)", () => {
	it("renders nested, flat, string and empty upstream bodies", async () => {
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false });
		const message = async (status, body) => (await api.error(status, body)).body.error.message;
		expect(await message(400, { error: { message: "nested", type: "BadRequestError", param: null, code: 400 } })).toBe("nested");
		expect(await message(400, { message: "flat", type: "BadRequestError", code: 400 })).toBe("flat");
		expect(await message(401, { error: "Unauthorized" })).toBe("Unauthorized");
		expect(await message(502, "plain text")).toBe("plain text");
		expect(await message(502, "")).toBe("upstream returned HTTP 502");
		expect(await message(500, null)).toBe("upstream returned HTTP 500");
		expect(await message(500, { error: {} })).toBe("upstream returned HTTP 500");
		expect(await message(500, 7)).toBe("upstream returned HTTP 500");
	});

	it.each([
		[400, "invalid_request_error"],
		[401, "authentication_error"],
		[403, "permission_error"],
		[404, "not_found_error"],
		[413, "request_too_large"],
		[422, "invalid_request_error"],
		[429, "rate_limit_error"],
		[500, "api_error"],
		[502, "api_error"],
		[504, "api_error"],
		[503, "overloaded_error"],
		[529, "overloaded_error"]
	])("maps status %i to %s", async (status, type) => {
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false });
		const reply = await api.error(status, { error: { message: "m" } });
		expect(reply).toEqual({
			status,
			headers: { "content-type": "application/json" },
			body: { type: "error", error: { type, message: "m" } }
		});
	});

	it("keeps retry-after and x-should-retry only", async () => {
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false });
		const reply = await api.error(429, {}, { "retry-after": "3", "x-should-retry": "true", "x-other": "no" });
		expect(reply.headers).toEqual({ "content-type": "application/json", "retry-after": "3", "x-should-retry": "true" });
	});

	it.each([
		[
			"vLLM current wording",
			"This model's maximum context length is 4096 tokens. However, your prompt contains 5000 input tokens, which exceeds this limit even without any output tokens.",
			"prompt is too long: 5000 tokens > 4096 maximum"
		],
		[
			"older vLLM/OpenAI wording",
			"This model's maximum context length is 4096 tokens. However, you requested 5100 tokens (4900 in the messages, 200 in the completion). Please reduce the length.",
			"prompt is too long: 5100 tokens > 4096 maximum"
		],
		[
			"requested-only wording",
			"This model's maximum context length is 4096 tokens, you requested 5100 tokens.",
			"prompt is too long: 5100 tokens > 4096 maximum"
		],
		["no prompt size at all", "maximum context length is 4096 tokens", "prompt is too long: 4097 tokens > 4096 maximum"]
	])("rewrites a context overflow (%s)", async (_name, text, expected) => {
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false });
		const reply = await api.error(500, { error: { message: text } });
		expect(reply.status).toBe(400);
		expect(reply.body.error).toEqual({ type: "invalid_request_error", message: expected });
	});

	it("keeps the upstream error type for a native Anthropic upstream and falls back to the status mapping otherwise", async () => {
		const api = await make({ upstreams: [{ url: "https://api.anthropic.com", backend: "anthropic" }], detect: false });
		const { state } = await api.request({ model: "claude-sonnet-5-5", max_tokens: 5, messages: [{ role: "user", content: "x" }] });
		const native = await api.error(529, { type: "error", error: { type: "overloaded_error", message: "busy" } }, {}, state);
		expect(native.body.error).toEqual({ type: "overloaded_error", message: "busy" });
		const untyped = await api.error(500, { error: { message: "oops" } }, {}, state);
		expect(untyped.body.error.type).toBe("api_error");
	});

	it("does not trust an upstream type from a converted protocol", async () => {
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false });
		const { state } = await api.request({ model: "m", max_tokens: 5, messages: [{ role: "user", content: "x" }] });
		const reply = await api.error(400, { error: { message: "m", type: "BadRequestError" } }, {}, state);
		expect(reply.body.error.type).toBe("invalid_request_error");
	});

	it("runs the driver's error normalizer first", async () => {
		const api = await make({ upstreams: ["http://hooks.test"], transport: fakeTransport(() => ({ status: 500 })) });
		await api.slothlet.api.add(["driver", "hooks"], hooks);
		await api.detect();
		const { state } = await api.request({ model: "m", max_tokens: 5, messages: [{ role: "user", content: "x" }] });
		const reply = await api.error(418, { whatever: true }, {}, state);
		expect(reply.body.error.message).toBe("hooked 418");
	});

	it("normalizes through the vLLM driver's error hook", async () => {
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false });
		const { state } = await api.request({ model: "m", max_tokens: 5, messages: [{ role: "user", content: "x" }] });
		const reply = await api.error(400, { message: "flat vllm", type: "BadRequestError", code: 400 }, {}, state);
		expect(reply.body.error.message).toBe("flat vllm");
	});
});

describe("error (openai front)", () => {
	const make_ = () => make({ front: "openai", upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false });

	it("renders the OpenAI error shape", async () => {
		const api = await make_();
		const reply = await api.error(400, { error: { message: "bad", type: "BadRequestError", param: "tools", code: 400 } });
		expect(reply.body).toEqual({ error: { message: "bad", type: "invalid_request_error", param: "tools", code: 400 } });
		const bare = await api.error(500, "boom");
		expect(bare.body).toEqual({ error: { message: "boom", type: "server_error", param: null, code: null } });
	});

	it.each([
		[400, "invalid_request_error"],
		[401, "authentication_error"],
		[403, "permission_denied_error"],
		[404, "not_found_error"],
		[429, "rate_limit_error"],
		[500, "server_error"],
		[503, "server_error"]
	])("maps status %i to %s", async (status, type) => {
		const api = await make_();
		expect((await api.error(status, {})).body.error.type).toBe(type);
	});

	it("flags context overflow with the OpenAI error code and keeps native types", async () => {
		const api = await make_();
		const { state } = await api.request({ model: "m", messages: [{ role: "user", content: "x" }] });
		const over = await api.error(400, { error: { message: "maximum context length is 10 tokens, you requested 20 tokens" } }, {}, state);
		expect(over.body.error.code).toBe("context_length_exceeded");
		const native = await api.error(400, { error: { message: "no", type: "custom_error", code: "xyz" } }, {}, state);
		expect(native.body.error).toMatchObject({ type: "custom_error", code: "xyz" });
	});
});

describe("error.build", () => {
	it("builds errors for the anthropic front", async () => {
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false });
		expect(api.error.build(401, "invalid x-api-key")).toEqual({
			status: 401,
			headers: { "content-type": "application/json" },
			body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }
		});
		expect(api.error.build(400, "bad", { type: "invalid_request_error" }).body.error.type).toBe("invalid_request_error");
	});

	it("builds errors for the openai front and honors a front set by the server", async () => {
		const api = await make({ front: "openai", upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false });
		expect(api.error.build(404, "nope", { code: "model_not_found", param: "model" }).body).toEqual({
			error: { message: "nope", type: "not_found_error", param: "model", code: "model_not_found" }
		});
	});
});
