/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/gemini-cache.test.vitest.mjs
 *	@Date: 2026-11-22T10:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T10:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Cached contents for Gemini: where the last cache_control breakpoint is, the request up to it, the plan from two Gemini bodies, and making a request use a cache (create once, reuse, back off, and send whole when it cannot be made).
 */
import { describe, expect, it } from "vitest";
import { apply, breakpoint, planOf, upTo } from "../../src/lib/gemini-cache.mjs";
import { fakeTransport } from "../helpers/translator.mjs";

const big = "x".repeat(5000);
const control = { type: "ephemeral" };

describe("breakpoint", () => {
	it("finds the last cache_control in the order tools, system, messages, with its ttl", () => {
		expect(breakpoint({})).toBeNull();
		expect(breakpoint(null)).toBeNull();
		expect(breakpoint({ tools: "x", system: "x", messages: [{ content: "x" }, null, { content: [null] }] })).toBeNull();
		expect(breakpoint({ tools: [{ name: "a", cache_control: control }] })).toEqual({ where: "tools", ttl: 300 });
		expect(breakpoint({ tools: [{ name: "a" }], system: [{ type: "text" }, null] })).toBeNull();
		expect(
			breakpoint({ tools: [{ cache_control: control }], system: [{ type: "text", cache_control: { type: "ephemeral", ttl: "1h" } }] })
		).toEqual({
			where: "system",
			ttl: 3600
		});
		expect(
			breakpoint({
				system: [{ cache_control: control }],
				messages: [
					{
						content: [
							{ type: "text", text: "a", cache_control: { ttl: "5m" } },
							{ type: "text", text: "b" }
						]
					},
					{
						content: [
							{ type: "text", text: "c" },
							{ type: "text", text: "d", cache_control: { ttl: "odd" } }
						]
					},
					{ content: "plain" }
				]
			})
		).toEqual({ where: "messages", message: 1, block: 1, ttl: 300 });
	});
});

describe("upTo", () => {
	const body = {
		model: "m",
		system: "s",
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "a" },
					{ type: "text", text: "b" }
				]
			},
			{ role: "assistant", content: "c" },
			{ role: "user", content: [{ type: "text", text: "d" }] }
		]
	};

	it("keeps the messages up to the block, whole tools and system, and none for a breakpoint before them", () => {
		expect(upTo(body, { where: "messages", message: 0, block: 0 }).messages).toEqual([
			{ role: "user", content: [{ type: "text", text: "a" }] }
		]);
		expect(upTo(body, { where: "messages", message: 1, block: 0 }).messages).toHaveLength(2);
		expect(upTo(body, { where: "messages", message: 1, block: 0 }).messages[1].content).toBe("c");
		expect(upTo(body, { where: "messages" }).messages).toHaveLength(1);
		expect(upTo(body, { where: "system" })).toEqual({ ...body, messages: [] });
		expect(upTo(body, { where: "tools" }).system).toBe("s");
		expect(body.messages[0].content).toHaveLength(2);
	});
});

describe("planOf", () => {
	const turn = (role, text) => ({ role, parts: [{ text }] });
	const full = {
		contents: [turn("user", big), turn("model", "ok"), turn("user", "next")],
		systemInstruction: { parts: [{ text: "s" }] },
		tools: [{ functionDeclarations: [] }]
	};

	it("shares the leading messages and the system, tools and tool config", () => {
		const plan = planOf({ contents: full.contents.slice(0, 2), systemInstruction: full.systemInstruction, tools: full.tools }, full, 300);
		expect(plan).toEqual({
			contents: full.contents.slice(0, 2),
			count: 2,
			ttl: 300,
			systemInstruction: full.systemInstruction,
			tools: full.tools
		});
		const withConfig = { ...full, toolConfig: { functionCallingConfig: { mode: "ANY" } } };
		expect(
			planOf(
				{
					contents: full.contents.slice(0, 1),
					systemInstruction: full.systemInstruction,
					tools: full.tools,
					toolConfig: withConfig.toolConfig
				},
				withConfig,
				60
			)
		).toMatchObject({
			count: 1,
			toolConfig: withConfig.toolConfig
		});
	});

	it("rounds down to whole messages the two agree on, and gives up when they do not agree or there is little to cache", () => {
		const partial = planOf(
			{ contents: [full.contents[0], turn("model", "o")], systemInstruction: full.systemInstruction, tools: full.tools },
			full,
			300
		);
		expect(partial?.count).toBe(1);
		expect(planOf({ contents: full.contents.slice(0, 1), tools: full.tools }, full, 300)).toBeNull();
		expect(planOf({ contents: full.contents, systemInstruction: full.systemInstruction, tools: full.tools }, full, 300)).toBeNull();
		const small = { contents: [turn("user", "a"), turn("user", "b")] };
		expect(planOf({ contents: small.contents.slice(0, 1) }, small, 300)).toBeNull();
		const system = { contents: [turn("user", "q")], systemInstruction: { parts: [{ text: big }] } };
		expect(planOf({ contents: [], systemInstruction: system.systemInstruction }, system, 300)).toEqual({
			contents: [],
			count: 0,
			ttl: 300,
			systemInstruction: system.systemInstruction
		});
	});
});

describe("apply", () => {
	const plan = {
		contents: [{ role: "user", parts: [{ text: big }] }],
		count: 1,
		ttl: 300,
		systemInstruction: { parts: [{ text: "s" }] },
		tools: [{ functionDeclarations: [{ name: "a" }] }]
	};
	const body = {
		contents: [plan.contents[0], { role: "user", parts: [{ text: "now" }] }],
		systemInstruction: plan.systemInstruction,
		tools: plan.tools,
		toolConfig: { functionCallingConfig: { mode: "AUTO" } },
		generationConfig: { maxOutputTokens: 5 }
	};
	const run = (endpoint, transport, extra = {}, cache = plan) =>
		apply({
			cache,
			body,
			endpoint,
			headers: { accept: "text/event-stream", "x-goog-api-key": "k" },
			transport,
			timeout: 1000,
			model: "gemini-2.5-flash",
			url: "https://g.example/v1beta/cachedContents",
			resource: "models/gemini-2.5-flash",
			warn: (message) => warnings.push(message),
			...extra
		});
	const warnings = [];

	it("creates the cache once, sends only what follows it, and reuses it until it is about to expire", async () => {
		const transport = fakeTransport(() => ({ body: { name: "cachedContents/abc" } }));
		const endpoint = { name: "g" };
		const sent = await run(endpoint, transport);
		expect(sent).toEqual({ contents: [body.contents[1]], generationConfig: { maxOutputTokens: 5 }, cachedContent: "cachedContents/abc" });
		expect(transport.calls).toHaveLength(1);
		expect(transport.calls[0].url).toBe("https://g.example/v1beta/cachedContents");
		const made = JSON.parse(transport.calls[0].init.body);
		expect(made).toEqual({
			model: "models/gemini-2.5-flash",
			contents: plan.contents,
			systemInstruction: plan.systemInstruction,
			tools: plan.tools,
			ttl: "300s"
		});
		expect(transport.calls[0].init.headers).toMatchObject({
			accept: "application/json",
			"content-type": "application/json",
			"x-goog-api-key": "k"
		});
		expect((await run(endpoint, transport)).cachedContent).toBe("cachedContents/abc");
		expect(transport.calls).toHaveLength(1);
		const [entry] = endpoint.geminiCaches.values();
		entry.until = Date.now() - 1;
		expect((await run(endpoint, transport)).cachedContent).toBe("cachedContents/abc");
		expect(transport.calls).toHaveLength(2);
	});

	it("keeps a tool config in the cache and creates a new one for another prefix", async () => {
		const transport = fakeTransport(() => ({ body: { name: "cachedContents/x" } }));
		const endpoint = { name: "g" };
		await run(
			endpoint,
			transport,
			{},
			{ ...plan, toolConfig: { functionCallingConfig: { mode: "ANY" } }, systemInstruction: undefined, tools: undefined }
		);
		expect(JSON.parse(transport.calls[0].init.body).toolConfig).toEqual({ functionCallingConfig: { mode: "ANY" } });
		expect(JSON.parse(transport.calls[0].init.body).systemInstruction).toBeUndefined();
		await run(endpoint, transport);
		expect(transport.calls).toHaveLength(2);
	});

	it("sends the request whole when the cache cannot be made, says so, and does not ask again for a while", async () => {
		warnings.length = 0;
		const failing = fakeTransport(() => ({ status: 400, body: { error: { message: "Cached content is too small" } } }));
		const endpoint = { name: "g" };
		expect(await run(endpoint, failing)).toBe(body);
		expect(warnings[0]).toMatch(/could not be cached \(HTTP 400\)/);
		expect(await run(endpoint, failing)).toBe(body);
		expect(failing.calls).toHaveLength(1);
		const [entry] = endpoint.geminiCaches.values();
		entry.retry = Date.now() - 1;
		await run(endpoint, failing);
		expect(failing.calls).toHaveLength(2);
		const odd = fakeTransport(() => ({ body: { nothing: 1 } }));
		warnings.length = 0;
		expect(await run({ name: "o" }, odd)).toBe(body);
		expect(warnings[0]).toMatch(/no name in the reply/);
		expect(await run({ name: "o2" }, odd, { warn: undefined })).toBe(body);
		const down = fakeTransport(() => {
			throw new Error("offline");
		});
		warnings.length = 0;
		expect(await run({ name: "d" }, down)).toBe(body);
		expect(warnings[0]).toMatch(/no name in the reply|HTTP 0/);
	});
});
