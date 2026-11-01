/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/tool-fallback.test.vitest.mjs
 *	@Date: 2026-10-26T06:00:20-07:00 (1793019620)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-26T15:38:55-07:00 (1793054335)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, make } from "../helpers/translator.mjs";
import { completion, fakeVllm, json, sse, textChunks } from "../helpers/fake-server.mjs";
import { resolve } from "../../src/lib/settings.mjs";
import * as tools from "../../src/lib/tools.mjs";

afterEach(closeAll);

const VLLM = '"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set';
const refusal = (message = VLLM) => ({ error: { message, type: "BadRequestError", param: null, code: 400 } });
const withTools = {
	model: "qwen3-coder",
	max_tokens: 64,
	messages: [{ role: "user", content: "weather?" }],
	tools: [{ name: "weather", description: "Look up weather", input_schema: { type: "object", properties: {} } }]
};

/** A chat handler that refuses requests with tools (with `message`, or vLLM's wording) and answers everything else. */
const picky = (message) => (_req, body, res) => {
	if (body.tools) return json(res, 400, refusal(message));
	return body.stream ? sse(res, textChunks(["no tools"])) : json(res, 200, completion("no tools"));
};
const chats = (server) => server.requests.filter((entry) => entry.url === "/v1/chat/completions");
const upstreamOf = (server, settings) => make({ upstreams: [{ url: server.url, settings: { images: true, ...settings } }] });

describe("recognising a missing tool parser", () => {
	it.each([
		VLLM,
		"--enable-auto-tool-choice is required",
		"Set --tool-call-parser to use tools",
		'"auto" tool choice requires --Enable-Auto-Tool-Choice and --Tool-Call-Parser to be set'
	])("matches %j", (message) => expect(tools.refused(message)).toBe(true));

	it.each(["tool_choice must be a string", "Invalid tool schema", "tools is not supported", ""])("ignores %j", (message) =>
		expect(tools.refused(message)).toBe(false)
	);
});

describe("the hint", () => {
	it("suggests toolFallback only while it is off", () => {
		expect(tools.hint(false)).toBe(tools.HINT);
		expect(tools.HINT).toContain("toolFallback");
		expect(tools.hint(true)).not.toContain("toolFallback");
		expect(tools.hint(true)).toContain("--enable-auto-tool-choice");
	});
});

describe("the hint without request state", () => {
	it("falls back to the full hint", async () => {
		const api = await make({ upstreams: [{ url: "http://vllm.test" }], detect: false });
		const reply = await api.error(400, refusal());
		expect(reply.body.error.message).toContain(tools.HINT);
	});
});

describe("Chat Completions body helpers", () => {
	it("detects and removes tools", () => {
		const body = { model: "m", messages: [], tools: [{}], tool_choice: "auto", parallel_tool_calls: false, temperature: 1 };
		expect(tools.carries(body)).toBe(true);
		expect(tools.strip(body)).toEqual({ model: "m", messages: [], temperature: 1 });
		expect(body.tools).toHaveLength(1);
		expect(tools.carries({ tools: [] })).toBe(false);
		expect(tools.carries({})).toBe(false);
		expect(tools.carries(undefined)).toBe(false);
	});
});

describe("toolFallback setting", () => {
	it("defaults to off and must be a boolean", () => {
		expect(resolve().toolFallback).toBe(false);
		expect(resolve({ toolFallback: true }).toolFallback).toBe(true);
		expect(() => resolve({ toolFallback: "yes" })).toThrow(/Invalid setting toolFallback/);
	});
});

describe("hint on the client error", () => {
	it("names the missing flags in the Anthropic error and does not retry by default", async () => {
		const server = await fakeVllm({ chat: picky() });
		try {
			const api = await upstreamOf(server);
			const reply = await api.send(withTools);
			expect(reply.status).toBe(400);
			expect(reply.body.type).toBe("error");
			expect(reply.body.error.type).toBe("invalid_request_error");
			expect(reply.body.error.message).toContain(VLLM);
			expect(reply.body.error.message).toContain("--enable-auto-tool-choice and --tool-call-parser <parser>");
			expect(chats(server)).toHaveLength(1);
		} finally {
			await server.close();
		}
	});

	it("adds the hint on the OpenAI front too", async () => {
		const server = await fakeVllm({ chat: picky() });
		try {
			const api = await upstreamOf(server);
			const reply = await api.send(
				{
					model: "qwen3-coder",
					messages: [{ role: "user", content: "hi" }],
					tools: [{ type: "function", function: { name: "f", parameters: {} } }]
				},
				{ front: "openai" }
			);
			expect(reply.status).toBe(400);
			expect(reply.body.error.message).toContain(tools.HINT);
		} finally {
			await server.close();
		}
	});

	it("leaves other 400s and non-400 errors alone", async () => {
		const server = await fakeVllm({ chat: picky("max_tokens must be positive") });
		try {
			const api = await upstreamOf(server);
			const reply = await api.send(withTools);
			expect(reply.body.error.message).toBe("max_tokens must be positive");
		} finally {
			await server.close();
		}
		const other = await fakeVllm({ chat: (_req, _body, res) => json(res, 500, refusal()) });
		try {
			const api = await upstreamOf(other);
			const reply = await api.send(withTools);
			expect(reply.status).toBe(500);
			expect(reply.body.error.message).toBe(VLLM);
		} finally {
			await other.close();
		}
	});
});

describe("retrying without tools", () => {
	it("retries a refused request once without tools when toolFallback is on", async () => {
		const server = await fakeVllm({ chat: picky() });
		try {
			const api = await upstreamOf(server, { toolFallback: true });
			const reply = await api.send(withTools);
			expect(reply.status).toBe(200);
			expect(reply.body.content[0].text).toBe("no tools");
			expect(chats(server)).toHaveLength(2);
			expect(chats(server)[0].body.tools).toHaveLength(1);
			expect(chats(server)[1].body.tools).toBeUndefined();
			expect(chats(server)[1].body.tool_choice).toBeUndefined();
			// Not remembered: the next request tries tools again.
			await api.send(withTools);
			expect(chats(server)).toHaveLength(4);
		} finally {
			await server.close();
		}
	});

	it("retries a streaming request", async () => {
		const server = await fakeVllm({ chat: picky() });
		try {
			const api = await upstreamOf(server, { toolFallback: true });
			const reply = await api.send({ ...withTools, stream: true });
			expect(reply.status).toBe(200);
			const events = await collect(reply.stream);
			expect(events.at(-1).event).toBe("message_stop");
			expect(chats(server)).toHaveLength(2);
		} finally {
			await server.close();
		}
	});

	it("retries an OpenAI-front request that was forwarded unchanged", async () => {
		const server = await fakeVllm({ chat: picky() });
		try {
			const api = await upstreamOf(server, { toolFallback: true });
			const reply = await api.send(
				{
					model: "qwen3-coder",
					messages: [{ role: "user", content: "hi" }],
					tools: [{ type: "function", function: { name: "f", parameters: {} } }],
					tool_choice: "auto"
				},
				{ front: "openai" }
			);
			expect(reply.status).toBe(200);
			expect(chats(server)[1].body.tools).toBeUndefined();
			expect(chats(server)[1].body.tool_choice).toBeUndefined();
		} finally {
			await server.close();
		}
	});

	it("returns the retry's own failure, once", async () => {
		const flagged = await fakeVllm({
			chat: (_req, body, res) => json(res, 400, body.tools ? refusal() : refusal("max_tokens must be positive"))
		});
		try {
			const api = await upstreamOf(flagged, { toolFallback: true });
			const reply = await api.send(withTools);
			expect(reply.status).toBe(400);
			expect(reply.body.error.message).toBe("max_tokens must be positive");
			expect(chats(flagged)).toHaveLength(2);
			// A server that keeps refusing in the same words after the retry is not retried again; the hint is added.
			const stubborn = await fakeVllm({ chat: (_req, _body, res) => json(res, 400, refusal()) });
			try {
				const again = await (await upstreamOf(stubborn, { toolFallback: true })).send(withTools);
				expect(again.status).toBe(400);
				expect(again.body.error.message).toContain(tools.hint(true));
				expect(again.body.error.message).not.toContain("toolFallback");
				expect(chats(stubborn)).toHaveLength(2);
			} finally {
				await stubborn.close();
			}
		} finally {
			await flagged.close();
		}
	});

	it("does not retry other 400s", async () => {
		const server = await fakeVllm({ chat: picky("max_tokens must be positive") });
		try {
			const api = await upstreamOf(server, { toolFallback: true });
			const reply = await api.send(withTools);
			expect(reply.status).toBe(400);
			expect(chats(server)).toHaveLength(1);
		} finally {
			await server.close();
		}
	});

	it("does not retry when the request had no tools", async () => {
		const server = await fakeVllm({ chat: (_req, _body, res) => json(res, 400, refusal()) });
		try {
			const api = await upstreamOf(server, { toolFallback: true });
			const reply = await api.send({ model: "qwen3-coder", max_tokens: 8, messages: [{ role: "user", content: "hi" }] });
			expect(reply.status).toBe(400);
			expect(chats(server)).toHaveLength(1);
		} finally {
			await server.close();
		}
	});

	it("retries once when images and tools are both sent and only the tools are refused", async () => {
		const server = await fakeVllm({ chat: picky() });
		try {
			const api = await upstreamOf(server, { toolFallback: true, images: true });
			const reply = await api.send({
				...withTools,
				messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://x/y.png" } }] }]
			});
			expect(reply.status).toBe(200);
			expect(chats(server)).toHaveLength(2);
			expect(JSON.stringify(chats(server)[1].body)).toContain("image_url");
		} finally {
			await server.close();
		}
	});
});
