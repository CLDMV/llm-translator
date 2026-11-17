/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/cache.test.vitest.mjs
 *	@Date: 2026-11-14T12:00:00-08:00 (1794344400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-14T12:00:00-08:00 (1794344400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, make } from "../helpers/translator.mjs";
import { fakeVllm } from "../helpers/fake-server.mjs";
import { addCache, valid } from "../../src/lib/cache.mjs";
import { resolve } from "../../src/lib/settings.mjs";

afterEach(closeAll);

const hello = { model: "m", max_tokens: 64, messages: [{ role: "user", content: "hi" }] };
const build = (backend, settings, extra = {}, upstream = {}) =>
	make({ upstreams: [{ url: `http://${backend}.test`, backend, settings, ...upstream }], detect: false, ...extra });

describe("cache settings", () => {
	it("default to null, accept non-empty strings and reject the rest", () => {
		expect(resolve().cacheSalt).toBeNull();
		expect(resolve().promptCacheKey).toBeNull();
		expect(resolve({ cacheSalt: "a", promptCacheKey: "k" })).toMatchObject({ cacheSalt: "a", promptCacheKey: "k" });
		expect(() => resolve({ cacheSalt: "" })).toThrow(/Invalid setting cacheSalt/);
		expect(() => resolve({ promptCacheKey: 5 })).toThrow(/Invalid setting promptCacheKey/);
		expect(valid(undefined)).toBe(true);
		expect(valid(null)).toBe(true);
		expect(valid("x")).toBe(true);
		expect(valid("")).toBe(false);
	});
});

describe("addCache", () => {
	it("returns the same body when there is nothing to add", () => {
		const body = {};
		expect(addCache(body, {}, resolve(), "vllm")).toBe(body);
	});

	it("sends cache_salt to vLLM, replacing whatever the body carries and preferring the call's salt", () => {
		const settings = resolve({ cacheSalt: "upstream" });
		expect(addCache({ cache_salt: "client" }, {}, settings, "vllm").cache_salt).toBe("upstream");
		expect(addCache({}, { salt: "call" }, settings, "vllm").cache_salt).toBe("call");
	});

	it("sends prompt_cache_key to OpenAI, keeping a key the body has", () => {
		const settings = resolve({ promptCacheKey: "setting" });
		expect(addCache({}, {}, settings, "openai").prompt_cache_key).toBe("setting");
		expect(addCache({}, { key: "asked" }, settings, "openai").prompt_cache_key).toBe("asked");
		const own = { prompt_cache_key: "mine" };
		expect(addCache(own, {}, settings, "openai")).toBe(own);
	});

	it("drops what the backend lacks and records it once, or rejects it with unknownFields: error", () => {
		const dropped = [];
		const body = {};
		const settings = resolve({ cacheSalt: "s", promptCacheKey: "k" });
		expect(addCache(body, {}, settings, "groq", dropped)).toBe(body);
		addCache(body, {}, settings, "groq", dropped);
		expect(dropped).toEqual(["cache_salt", "prompt_cache_key"]);
		const strict = resolve({ unknownFields: "error", cacheSalt: "s" });
		expect(() => addCache(body, {}, strict, "openai")).toThrowError(
			expect.objectContaining({ code: "unsupported_field", param: "cache_salt" })
		);
	});

	it("rejects a malformed salt or key", () => {
		expect(() => addCache({}, { salt: "" }, resolve(), "vllm")).toThrowError(
			expect.objectContaining({ code: "invalid_request", param: "cacheSalt" })
		);
		expect(() => addCache({}, { key: 1 }, resolve(), "openai")).toThrowError(
			expect.objectContaining({ code: "invalid_request", param: "metadata.prompt_cache_key" })
		);
	});
});

describe("cache hints on a request", () => {
	it("sends the upstream's cacheSalt to vLLM and lets the call option replace it", async () => {
		const vllm = await build("vllm", { cacheSalt: "tenant" });
		expect((await vllm.request(hello)).body.cache_salt).toBe("tenant");
		expect((await vllm.request(hello, { cacheSalt: "key-7" })).body.cache_salt).toBe("key-7");
	});

	it("never takes the salt from the client", async () => {
		const vllm = await build("vllm", { passthroughFilter: true }, { front: "openai" });
		const result = await vllm.request({ ...hello, cache_salt: "chosen" });
		expect(result.body.cache_salt).toBeUndefined();
		const anthropic = await build("vllm");
		expect((await anthropic.request({ ...hello, metadata: { cache_salt: "chosen" } })).body.cache_salt).toBeUndefined();
	});

	it("sends prompt_cache_key to OpenAI from metadata.prompt_cache_key or the setting, and an OpenAI client's own key", async () => {
		const openai = await build("openai", { promptCacheKey: "setting" });
		expect((await openai.request(hello)).body.prompt_cache_key).toBe("setting");
		const asked = await openai.request({ ...hello, metadata: { user_id: "u", prompt_cache_key: "asked" } });
		expect(asked.body.prompt_cache_key).toBe("asked");
		expect(asked.body.metadata).toBeUndefined();
		const front = await build("openai", { passthroughFilter: true }, { front: "openai" });
		expect((await front.request({ ...hello, prompt_cache_key: "own" })).body.prompt_cache_key).toBe("own");
		const other = await build("vllm", { passthroughFilter: true }, { front: "openai" });
		expect((await other.request({ ...hello, prompt_cache_key: "own" })).body.prompt_cache_key).toBeUndefined();
	});

	it("records hints a converted request cannot carry, and strips the extension from a forwarded Anthropic body", async () => {
		const groq = await build("groq", { cacheSalt: "s", promptCacheKey: "k" });
		expect((await groq.request(hello)).state.convert.dropped).toEqual(expect.arrayContaining(["cache_salt", "prompt_cache_key"]));
		const ollama = await build("ollama", { cacheSalt: "s", promptCacheKey: "k" }, {}, { api: "native" });
		const dropped = (await ollama.request(hello)).state.convert.dropped;
		expect(dropped).toEqual(expect.arrayContaining(["cache_salt", "prompt_cache_key"]));
		const again = await ollama.request(hello);
		expect(again.state.convert.dropped.filter((name) => name === "cache_salt")).toHaveLength(1);
		const anthropic = await build("anthropic");
		const forwarded = await anthropic.request({ ...hello, metadata: { user_id: "u", prompt_cache_key: "k" } });
		expect(forwarded.body.metadata).toEqual({ user_id: "u" });
	});

	it("rejects a malformed key with a 400", async () => {
		const openai = await build("openai");
		await expect(openai.request({ ...hello, metadata: { prompt_cache_key: 5 } })).rejects.toMatchObject({ code: "invalid_request" });
	});
});

describe("cacheSalt from an authorize hook", () => {
	it("reaches vLLM as cache_salt, and an empty or missing salt sends none", async () => {
		const upstream = await fakeVllm();
		try {
			const api = await make({ upstreams: [upstream.url] });
			const salts = ["tenant-a", "", undefined];
			let turn = 0;
			const server = await api.server.start({ port: 0, authorize: () => ({ ok: true, cacheSalt: salts[turn++] }) });
			const hello2 = { model: "qwen3-coder", max_tokens: 8, messages: [{ role: "user", content: "salt-probe" }] };
			for (let index = 0; index < salts.length; index++) {
				const reply = await fetch(`${server.url}/v1/messages`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(hello2)
				});
				expect(reply.status).toBe(200);
			}
			const sent = upstream.requests
				.filter((entry) => entry.url === "/v1/chat/completions" && JSON.stringify(entry.body).includes("salt-probe"))
				.map((entry) => entry.body.cache_salt);
			expect(sent).toEqual(["tenant-a", undefined, undefined]);
		} finally {
			await upstream.close();
		}
	});
});
