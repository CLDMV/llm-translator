/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/sampling.test.vitest.mjs
 *	@Date: 2026-11-06T12:00:00-07:00 (1794078000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-06T12:00:00-07:00 (1794078000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, make } from "../helpers/translator.mjs";
import { addSampling } from "../../src/lib/sampling.mjs";
import { resolve } from "../../src/lib/settings.mjs";

afterEach(closeAll);

const hello = { model: "m", max_tokens: 64, messages: [{ role: "user", content: "hi" }] };
const build = (backend, settings, extra = {}) =>
	make({ upstreams: [{ url: `http://${backend}.test`, backend, settings }], detect: false, ...extra });

describe("sampling settings", () => {
	it("merge key by key and must be an object", () => {
		expect(resolve({ sampling: { min_p: 0.1 } }, { sampling: { seed: 1 } }).sampling).toEqual({ min_p: 0.1, seed: 1 });
		expect(resolve().sampling).toEqual({});
		expect(() => resolve({ sampling: [] })).toThrow(/Invalid setting sampling/);
		expect(() => resolve({ sampling: null })).toThrow(/Invalid setting sampling/);
	});
});

describe("addSampling", () => {
	it("keeps what the body has, skips empty values and returns the same body when nothing is added", () => {
		const body = { seed: 1 };
		expect(addSampling(body, { seed: 2, min_p: null }, resolve({}), ["min_p"])).toBe(body);
		expect(addSampling(body, [], resolve({}))).toBe(body);
	});

	it("lists unsupported fields once, or rejects them with unknownFields: error", () => {
		const dropped = ["min_p"];
		expect(addSampling({}, { min_p: 0.1, other: 1 }, resolve({ sampling: { other: 2 } }), [], dropped)).toEqual({});
		expect(dropped).toEqual(["min_p", "other"]);
		expect(() => addSampling({}, { min_p: 0.1 }, resolve({ unknownFields: "error" }), [])).toThrow(/sampling.min_p/);
	});
});

describe("sampling fields on a request", () => {
	it("takes per-upstream defaults and metadata.sampling, with the driver's names", async () => {
		const llama = await build("llamacpp", { sampling: { repetition_penalty: 1.1, min_p: 0.05 } });
		const result = await llama.request({ ...hello, metadata: { user_id: "u", sampling: { min_p: 0.2, seed: 7 } } });
		expect(result.body).toMatchObject({ repeat_penalty: 1.1, min_p: 0.2, seed: 7 });
		expect(result.body.repetition_penalty).toBeUndefined();
		expect(result.body.metadata).toBeUndefined();

		const vllm = await build("vllm", { sampling: { repetition_penalty: 1.1 } });
		expect((await vllm.request(hello)).body.repetition_penalty).toBe(1.1);
	});

	it("keeps a field the request carries itself over the default", async () => {
		const api = await build("vllm", { sampling: { min_p: 0.5 } });
		const result = await api.request({ ...hello, metadata: { sampling: { min_p: 0.3 } } });
		expect(result.body.min_p).toBe(0.3);
	});

	it("drops a field the driver does not accept and lists it, or rejects it", async () => {
		const ollama = await build("ollama", { sampling: { min_p: 0.1, seed: 3 } });
		const result = await ollama.request(hello);
		expect(result.body.seed).toBe(3);
		expect(result.body.min_p).toBeUndefined();
		expect(result.state.convert.dropped).toContain("min_p");

		const strict = await build("ollama", { unknownFields: "error", sampling: { min_p: 0.1 } });
		await expect(strict.request(hello)).rejects.toMatchObject({ code: "unsupported_field" });
	});

	it("adds nothing for an Anthropic-protocol upstream and strips metadata.sampling from a native request", async () => {
		const api = await build("anthropic", { sampling: { seed: 3 } });
		const result = await api.request({ ...hello, metadata: { user_id: "u", sampling: { seed: 1 } } });
		expect(result.body.seed).toBeUndefined();
		expect(result.body.metadata).toEqual({ user_id: "u" });
	});

	it("forwards an OpenAI-front body with the defaults added, and leaves an unaccepted field out", async () => {
		const api = await build("ollama", { sampling: { min_p: 0.1, seed: 3 } }, { front: "openai" });
		const result = await api.request({ ...hello, temperature: 0.5 });
		expect(result.body).toMatchObject({ temperature: 0.5, seed: 3 });
		expect(result.body.min_p).toBeUndefined();
	});

	it("does not list a field twice when the conversion already dropped it", async () => {
		const api = await build("ollama", { topK: false, sampling: { top_k: 5 } });
		const result = await api.request({ ...hello, top_k: 9 });
		expect(result.state.convert.dropped.filter((name) => name === "top_k")).toHaveLength(1);
	});
});
