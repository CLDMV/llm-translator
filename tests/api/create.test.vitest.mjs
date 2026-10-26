/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/create.test.vitest.mjs
 *	@Date: 2026-10-25T12:18:46-07:00 (1792955926)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:02-07:00 (1792958342)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeVllm, json } from "../helpers/fake-server.mjs";
import { closeAll, fakeTransport, make } from "../helpers/translator.mjs";
import { createTranslator, TranslatorError } from "../../src/index.mjs";
import defaultExport from "../../src/index.mjs";

afterEach(closeAll);

describe("createTranslator config validation", () => {
	it("is the default export too", () => {
		expect(defaultExport).toBe(createTranslator);
	});

	it("rejects a missing upstream list", async () => {
		await expect(createTranslator({})).rejects.toBeInstanceOf(TranslatorError);
		await expect(createTranslator({ upstreams: [] })).rejects.toThrow(/at least one upstream/);
		await expect(createTranslator()).rejects.toThrow(/at least one upstream/);
	});

	it("rejects an unknown front", async () => {
		await expect(createTranslator({ front: "gemini", upstreams: ["http://x"] })).rejects.toThrow(/front must be/);
	});

	it("rejects an upstream without a url", async () => {
		await expect(createTranslator({ upstreams: [{ name: "a" }] })).rejects.toThrow(/upstreams\[0\] needs a "url"/);
		await expect(createTranslator({ upstreams: [null] })).rejects.toThrow(/needs a "url"/);
		await expect(createTranslator({ upstreams: [{ url: "" }] })).rejects.toThrow(/needs a "url"/);
	});

	it("accepts the single `upstream` shorthand (string or object) and trims trailing slashes", async () => {
		const one = await make({ upstream: "http://a.test///", detect: false });
		expect(one.status().upstreams[0]).toMatchObject({ name: "upstream-0", url: "http://a.test" });
		const two = await make({ upstream: { name: "named", url: "http://b.test", models: ["m"], default: true }, detect: false });
		expect(two.status().upstreams[0]).toMatchObject({ name: "named", models: ["m"], default: true });
	});

	it("rejects an unknown explicit backend", async () => {
		await expect(make({ upstreams: [{ url: "http://a.test", backend: "nope" }], detect: false })).rejects.toThrow(/Unknown backend "nope"/);
	});
});

describe("detection", () => {
	it("binds a vLLM server through /version and /v1/models, with version-mapped settings", async () => {
		const server = await fakeVllm({ version: "0.15.2" });
		try {
			const api = await make({ upstreams: [server.url] });
			const [upstream] = api.status().upstreams;
			expect(upstream).toMatchObject({
				driver: "vllm",
				protocol: "openai.chat",
				version: "0.15.2",
				models: ["qwen3-coder"],
				facts: { version: "0.15.2", maxModelLen: 32768 }
			});
		} finally {
			await server.close();
		}
	});

	it("matches vLLM by owned_by when /version is missing, and probes /tokenize for inline system support", async () => {
		const server = await fakeVllm({ version: null });
		try {
			const api = await make({ upstreams: [server.url] });
			expect(api.status().upstreams[0]).toMatchObject({ driver: "vllm", version: undefined, probed: { inlineSystem: "keep" } });
			const tokenize = server.requests.find((entry) => entry.url === "/tokenize");
			expect(tokenize.body.model).toBe("qwen3-coder");
			expect(tokenize.body.messages.map((message) => message.role)).toEqual(["system", "user", "system", "user"]);
		} finally {
			await server.close();
		}
	});

	it("falls back to `user` inline system when the template rejects inline system messages", async () => {
		const server = await fakeVllm({ tokenizeRejectsInlineSystem: true });
		try {
			const api = await make({ upstreams: [server.url] });
			expect(api.status().upstreams[0].probed).toEqual({ inlineSystem: "user", images: true });
		} finally {
			await server.close();
		}
	});

	it("learns that a text-only model does not accept images and then replaces them with notes", async () => {
		const server = await fakeVllm({
			chat: (_req, body, res) =>
				JSON.stringify(body).includes("image_url")
					? json(res, 400, { error: { message: "qwen3-1.7b is not a multimodal model", type: "BadRequestError", code: 400 } })
					: json(res, 200, { id: "x", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] })
		});
		try {
			const api = await make({ upstreams: [server.url] });
			expect(api.status().upstreams[0].probed.images).toBe(false);
			const call = await api.request({
				model: "m",
				max_tokens: 5,
				messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://x/y.png" } }] }]
			});
			expect(JSON.stringify(call.body)).not.toContain("image_url");
			expect(JSON.stringify(call.body)).toContain("does not accept images");
		} finally {
			await server.close();
		}
	});

	it("leaves images on when the probe is inconclusive, and skips it when images is configured", async () => {
		const server = await fakeVllm({ chat: (_req, _body, res) => json(res, 400, { error: { message: "something else", code: 400 } }) });
		try {
			const api = await make({ upstreams: [server.url] });
			expect(api.status().upstreams[0].probed).not.toHaveProperty("images");
			const before = server.requests.filter((entry) => entry.url === "/v1/chat/completions").length;
			expect(before).toBe(1);
			await make({ upstreams: [{ url: server.url, settings: { images: true } }] });
			await make({ upstreams: [server.url], settings: { images: false } });
			expect(server.requests.filter((entry) => entry.url === "/v1/chat/completions").length).toBe(1);
		} finally {
			await server.close();
		}
	});

	it("does not probe when inlineSystem is configured", async () => {
		const server = await fakeVllm();
		try {
			await make({ upstreams: [{ url: server.url, settings: { inlineSystem: "hoist" } }] });
			expect(server.requests.some((entry) => entry.url === "/tokenize")).toBe(false);
			server.requests.length = 0;
			await make({ upstreams: [{ url: server.url, settings: { inlineSystem: "hoist", images: false } }] });
			expect(server.requests.some((entry) => entry.url === "/v1/chat/completions" || entry.url === "/tokenize")).toBe(false);
		} finally {
			await server.close();
		}
	});

	it("sends the upstream api key while probing", async () => {
		const server = await fakeVllm();
		try {
			await make({ upstreams: [{ url: server.url, apiKey: "sk-test", headers: { "x-extra": "1" } }] });
			expect(server.requests[0].headers).toMatchObject({ authorization: "Bearer sk-test", "x-extra": "1" });
		} finally {
			await server.close();
		}
	});

	it("falls back to the generic driver for a non-vLLM server and learns its models", async () => {
		const server = await fakeVllm({ version: null, ownedBy: "organization-owner", models: ["llama"] });
		try {
			const api = await make({ upstreams: [server.url] });
			expect(api.status().upstreams[0]).toMatchObject({ driver: "compatible", models: ["llama"], facts: { reachable: true } });
		} finally {
			await server.close();
		}
	});

	it("warns once and falls back to the generic driver when the upstream does not answer", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const transport = fakeTransport(() => {
				throw new Error("connection refused");
			});
			const api = await make({ upstreams: ["http://down.test"], transport, silent: false });
			expect(api.status().upstreams[0]).toMatchObject({ driver: "compatible", facts: { reachable: false } });
			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn.mock.calls[0][0]).toMatch(/did not answer detection/);
			await api.detect();
			expect(warn).toHaveBeenCalledTimes(1);
		} finally {
			warn.mockRestore();
		}
	});

	it("stays quiet when silent", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await make({ upstreams: ["http://down.test"], transport: fakeTransport(() => ({ status: 500 })) });
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	it("detect: false skips every request, and an explicit backend skips detection but keeps version-mapped settings", async () => {
		const transport = fakeTransport(() => ({ status: 500 }));
		const api = await make({
			upstreams: [
				{ url: "http://a.test", name: "plain" },
				{ url: "http://b.test", name: "pinned", backend: "vllm", version: "0.12.0" }
			],
			transport,
			detect: false
		});
		expect(transport.calls).toHaveLength(0);
		const [plain, pinned] = api.status().upstreams;
		expect(plain).toMatchObject({ driver: "compatible" });
		expect(pinned).toMatchObject({ driver: "vllm", version: "0.12.0", probed: {} });
	});

	it("explicit backends skip detection and probing even when the network is on", async () => {
		const transport = fakeTransport(() => ({ status: 500 }));
		await make({ upstreams: [{ url: "http://b.test", backend: "vllm" }], transport });
		expect(transport.calls).toHaveLength(0);
	});

	it("treats a throwing driver detect as no match", async () => {
		const transport = fakeTransport(() => ({ body: { data: [] } }));
		const api = await make({ upstreams: ["http://a.test"], transport });
		await api.slothlet.api.add(["driver", "boom"], new URL("../fixtures/driver/boom", import.meta.url).pathname);
		const status = await api.detect();
		expect(status.upstreams[0].driver).toBe("compatible");
	});

	it("detects the hosted OpenAI and Anthropic APIs by host without network access", async () => {
		const transport = fakeTransport(() => ({ status: 500 }));
		const api = await make({
			upstreams: [
				{ url: "https://api.openai.com", name: "oa" },
				{ url: "https://api.anthropic.com", name: "an" },
				{ url: "not a url", name: "bad" }
			],
			transport,
			detect: true
		});
		const byName = Object.fromEntries(api.status().upstreams.map((entry) => [entry.name, entry]));
		expect(byName.oa).toMatchObject({ driver: "openai", protocol: "openai.chat" });
		expect(byName.an).toMatchObject({ driver: "anthropic", protocol: "anthropic.messages" });
		expect(byName.bad.driver).toBe("compatible");
	});

	it("supports third-party drivers mounted with slothlet's api.add", async () => {
		const api = await make({ upstreams: [{ url: "http://a.test", name: "x" }], detect: false });
		await api.slothlet.api.add(["driver", "custom"], new URL("../fixtures/driver/custom", import.meta.url).pathname);
		const transport = api;
		expect(Object.keys(transport.driver)).toContain("custom");
	});
});

describe("PDF library warnings", () => {
	it("warns when canvas or unpdf fail to load", async () => {
		vi.resetModules();
		vi.doMock("../../src/lib/pdf.mjs", () => ({
			load: async () => ({ unpdf: false, canvas: false, errors: { canvas: "no canvas", unpdf: "no unpdf" } })
		}));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const { createTranslator: create } = await import("../../src/index.mjs");
			const api = await create({ upstreams: ["http://a.test"], detect: false, slothlet: { import: (url) => import(url) } });
			const messages = warn.mock.calls.map((call) => call[0]);
			expect(messages.some((message) => /@napi-rs\/canvas could not be loaded \(no canvas\)/.test(message))).toBe(true);
			expect(messages.some((message) => /unpdf could not be loaded \(no unpdf\)/.test(message))).toBe(true);
			await api.slothlet.shutdown();
		} finally {
			warn.mockRestore();
			vi.doUnmock("../../src/lib/pdf.mjs");
			vi.resetModules();
		}
	});
});
