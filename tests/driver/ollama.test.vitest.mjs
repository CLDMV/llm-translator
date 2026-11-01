/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/ollama.test.vitest.mjs
 *	@Date: 2026-10-31T14:00:00-07:00 (1793480400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:00:00-07:00 (1793480400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Ollama driver: detection against a fake `/api/version`, field drops, image URLs and the context-size warning.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeAll, fakeTransport, make } from "../helpers/translator.mjs";

afterEach(closeAll);

const server = (paths, chat = () => ({ body: completion() })) =>
	fakeTransport((url, init) => {
		const path = new URL(url).pathname;
		if (path === "/v1/chat/completions") return chat(init);
		return path in paths ? { body: paths[path] } : { status: 404, body: { error: "not found" } };
	});
const completion = () => ({
	id: "c",
	object: "chat.completion",
	model: "llama3",
	choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
	usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 }
});
const models = { object: "list", data: [{ id: "llama3", object: "model", owned_by: "library" }] };
const jpeg = "data:image/jpeg;base64,/9j/4AAQ";

describe("ollama detection", () => {
	it("is bound through /api/version and takes the model list from /v1/models", async () => {
		const api = await make({
			upstreams: ["http://ollama.test"],
			transport: server({ "/api/version": { version: "0.12.3" }, "/v1/models": models })
		});
		const [upstream] = api.status().upstreams;
		expect(upstream).toMatchObject({ driver: "ollama", version: "0.12.3", models: ["llama3"] });
		expect(api.driver.ollama.settings()).toMatchObject({ topK: false, maxTokensField: "max_tokens", contextWindow: 4096 });
	});

	it("works without a model list, and is not matched by a body without a version", async () => {
		const bare = await make({ upstreams: ["http://ollama.test"], transport: server({ "/api/version": { version: "0.1.0" } }) });
		expect(bare.status().upstreams[0]).toMatchObject({ driver: "ollama", models: [] });
		const other = await make({ upstreams: ["http://x.test"], transport: server({ "/api/version": { version: 3 }, "/v1/models": models }) });
		expect(other.status().upstreams[0].driver).toBe("compatible");
	});

	it("an explicit backend wins and skips detection", async () => {
		const transport = server({ "/api/version": { version: "0.12.3" } });
		const api = await make({ upstreams: [{ url: "http://x.test", backend: "compatible" }], transport });
		expect(api.status().upstreams[0].driver).toBe("compatible");
		expect(transport.calls).toHaveLength(0);
	});
});

describe("ollama.request", () => {
	const messages = [{ role: "user", content: "hi" }];
	const ctx = (extra = {}) => ({ endpoint: { name: "box" }, settings: { contextWindow: 0 }, state: { dropped: [] }, ...extra });

	it("removes tool_choice, n and logit_bias and records each drop once", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const state = { dropped: ["n"] };
		const tool = [{ type: "function", function: { name: "f", parameters: {} } }];
		const out = api.driver.ollama.request(
			{ model: "m", messages, tools: tool, tool_choice: "auto", n: 2, logit_bias: { 1: 5 }, temperature: 0.2 },
			ctx({ state })
		);
		expect(out).toEqual({ model: "m", messages, tools: tool, temperature: 0.2 });
		expect(state.dropped).toEqual(["n", "tool_choice", "logit_bias"]);
		expect(api.driver.ollama.request({ model: "m", messages, n: 1 })).toEqual({ model: "m", messages });
		expect(api.driver.ollama.request({ model: "m", messages }, ctx())).toEqual({ model: "m", messages });
	});

	it("keeps data URLs and replaces URL images with a note, recorded as a drop", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const state = { dropped: [] };
		const body = {
			model: "m",
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "look" },
						{ type: "image_url", image_url: { url: jpeg } },
						{ type: "image_url", image_url: { url: "https://a.test/x.png" } }
					]
				},
				{ role: "assistant", content: "ok" }
			]
		};
		const out = api.driver.ollama.request(body, ctx({ state }));
		expect(out.messages[0].content).toEqual([
			{ type: "text", text: "look" },
			{ type: "image_url", image_url: { url: jpeg } },
			{ type: "text", text: "[An image was omitted because Ollama accepts base64 images only and the translator does not fetch URLs.]" }
		]);
		expect(out.messages[1]).toBe(body.messages[1]);
		// A second request on the same state, and a call without any state, both still replace the image.
		api.driver.ollama.request(body, ctx({ state }));
		expect(api.driver.ollama.request(body).messages[0].content[2].type).toBe("text");
		expect(state.dropped).toEqual(["image_url"]);
		const clean = { model: "m", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: jpeg } }] }] };
		expect(api.driver.ollama.request(clean, ctx({ state })).messages).toBe(clean.messages);
		expect(api.driver.ollama.request({ model: "m" }, ctx())).toEqual({ model: "m" });
	});

	it("warns when the prompt exceeds the context window, once per upstream", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const warn = vi.fn();
		const long = [{ role: "user", content: "x".repeat(40000) }];
		api.driver.ollama.request({ model: "m", messages: long }, ctx({ settings: { contextWindow: 4096 }, warn }));
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toMatch(/box.*more than 4096 tokens.*truncates/);
		api.driver.ollama.request({ model: "m", messages }, ctx({ settings: { contextWindow: 4096 }, warn }));
		expect(warn).toHaveBeenCalledTimes(1);
		api.driver.ollama.request({ model: "m", messages: long }, ctx({ settings: { contextWindow: 4096 } }));
		api.driver.ollama.request({ model: "m", messages: long }, { settings: { contextWindow: 4096 }, warn });
		expect(warn).toHaveBeenCalledTimes(2);
		api.driver.ollama.request({ model: "m", messages: long });
	});
});

describe("ollama through send", () => {
	it("sends the converted request without the unsupported fields and prints the warning once", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const transport = server({});
			const api = await make({ upstreams: [{ url: "http://ollama.test", backend: "ollama" }], transport, silent: false });
			const ask = {
				model: "llama3",
				max_tokens: 8,
				messages: [{ role: "user", content: "x".repeat(40000) }],
				tools: [{ name: "t", description: "d", input_schema: { type: "object" } }],
				tool_choice: { type: "any" }
			};
			await api.send(ask);
			await api.send(ask);
			const sent = JSON.parse(transport.calls[0].init.body);
			expect(sent.tool_choice).toBeUndefined();
			expect(sent.max_tokens).toBe(8);
			expect(warn.mock.calls.filter((call) => /truncates/.test(call[0]))).toHaveLength(1);
		} finally {
			warn.mockRestore();
		}
	});

	it("a contextWindow of 0 turns the warning off", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const api = await make({
				upstreams: [{ url: "http://ollama.test", backend: "ollama", settings: { contextWindow: 0 } }],
				transport: server({}),
				silent: false
			});
			await api.send({ model: "llama3", max_tokens: 8, messages: [{ role: "user", content: "x".repeat(40000) }] });
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});
});
