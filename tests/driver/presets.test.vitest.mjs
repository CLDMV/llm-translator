/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/presets.test.vitest.mjs
 *	@Date: 2026-11-13T10:00:00-08:00 (1794592800)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T10:00:00-08:00 (1794592800)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Hosted OpenAI-compatible presets (Groq, Together, Fireworks, xAI, Gemini): host detection, URL layout, generated settings and the fields each provider rejects.
 */
import { afterAll, describe, expect, it } from "vitest";
import { closeAll, fakeTransport, make } from "../helpers/translator.mjs";
import { PRESETS, describe as facts, match, route, settingsOf, trim } from "../../src/lib/presets.mjs";

afterAll(closeAll);

const user = [{ role: "user", content: "hi" }];

// Composing a translator is slow, so each backend and front is made once.
const made = new Map();
const apiOf = (name, url, front = "anthropic") => {
	const key = `${name}|${url}|${front}`;
	if (!made.has(key)) made.set(key, make({ upstreams: [{ url, backend: name, apiKey: "k" }], detect: false, front }));
	return made.get(key);
};

// Preset name, a host it answers on, the base URL a user gives, and the chat URL the translator must build from it.
const cases = [
	["groq", "https://api.groq.com", "https://api.groq.com/openai/v1/chat/completions"],
	["together", "https://api.together.ai", "https://api.together.ai/v1/chat/completions"],
	["fireworks", "https://api.fireworks.ai", "https://api.fireworks.ai/inference/v1/chat/completions"],
	["xai", "https://api.x.ai", "https://api.x.ai/v1/chat/completions"],
	["gemini", "https://generativelanguage.googleapis.com", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"]
];

describe.each(cases)("%s preset", (name, base, chat) => {
	it("is bound by host name with no request of its own, and by name with backend", async () => {
		const transport = fakeTransport(() => ({ body: {} }));
		const api = await make({ upstreams: [{ url: base, apiKey: "k" }], transport });
		expect(api.status().upstreams[0]).toMatchObject({ driver: name, protocol: "openai.chat" });
		const named = await apiOf(name, "http://proxy.test");
		expect(named.status().upstreams[0].driver).toBe(name);
		expect(api.driver[name].info()).toMatchObject({ name, order: PRESETS[name].order, auth: "bearer", strict: false });
		expect(api.driver[name].detect({ endpoint: { url: "https://elsewhere.example.com" } })).toBeNull();
		expect(api.driver[name].detect({ endpoint: { url: "not a url" } })).toBeNull();
	});

	it("builds the chat URL from the bare host, and the path root", async () => {
		const root = PRESETS[name].root ?? "";
		for (const url of [base, `${base}${root}/`]) {
			const api = await apiOf(name, url);
			const sent = await api.request({ model: "m", max_tokens: 5, messages: user });
			expect(sent.url).toBe(chat);
			expect(sent.headers.authorization).toBe("Bearer k");
		}
	});

	it("generates the documented settings", async () => {
		const api = await apiOf(name, base);
		expect(api.driver[name].settings()).toEqual(PRESETS[name].settings);
		expect(settingsOf(name)).not.toBe(PRESETS[name].settings);
	});
});

describe("preset settings", () => {
	it("Groq: max_completion_tokens, reasoning field, explicit effort only", () => {
		expect(settingsOf("groq")).toEqual({
			reasoningField: "reasoning",
			maxTokensField: "max_completion_tokens",
			thinking: "none",
			thinkingBudget: false,
			effort: true,
			topK: false,
			prefill: "none",
			streamUsage: true,
			continuousUsage: false
		});
	});

	it("Together: max_tokens, top_k, no stream_options and no parallel_tool_calls, reasoning round trip", () => {
		expect(settingsOf("together")).toMatchObject({
			maxTokensField: "max_tokens",
			topK: true,
			streamUsage: false,
			parallelToolCalls: false,
			reasoningRoundTrip: true
		});
		expect(facts("together").fields).toEqual(["top_k", "min_p", "repetition_penalty"]);
		expect(facts("fireworks").fields).toEqual(["top_k", "min_p", "repetition_penalty"]);
		expect(facts("groq")).not.toHaveProperty("fields");
	});

	it("Fireworks: reasoning_content, reasoning_effort for thinking, max_tokens", () => {
		expect(settingsOf("fireworks")).toMatchObject({
			reasoningField: "reasoning_content",
			reasoningRoundTrip: true,
			maxTokensField: "max_tokens",
			thinking: "reasoning_effort",
			topK: true
		});
	});

	it("xAI: max_completion_tokens, reasoning_content, thinking cannot be switched off", () => {
		expect(settingsOf("xai")).toMatchObject({
			reasoningField: "reasoning_content",
			maxTokensField: "max_completion_tokens",
			thinking: "none"
		});
	});

	it("Gemini: max_tokens, effort only when asked", () => {
		expect(settingsOf("gemini")).toMatchObject({ maxTokensField: "max_tokens", thinking: "none", effort: true, streamUsage: true });
	});
});

describe("generated request bodies", () => {
	const ask = async (name, body) => {
		const api = await apiOf(name, "http://x.test");
		return (await api.request({ model: "m", max_tokens: 64, messages: user, ...body })).body;
	};

	it("uses each provider's token field", async () => {
		expect(await ask("groq", {})).toMatchObject({ max_completion_tokens: 64 });
		expect(await ask("xai", {})).toMatchObject({ max_completion_tokens: 64 });
		for (const name of ["together", "fireworks", "gemini"]) expect(await ask(name, {})).toMatchObject({ max_tokens: 64 });
	});

	it("sends an explicit effort and nothing for thinking on the providers whose models differ", async () => {
		for (const name of ["groq", "together", "xai", "gemini"]) {
			expect((await ask(name, { output_config: { effort: "high" } })).reasoning_effort).toBe("high");
			expect(await ask(name, { thinking: { type: "disabled" } })).not.toHaveProperty("reasoning_effort");
			expect(await ask(name, { thinking: { type: "enabled", budget_tokens: 2000 } })).not.toHaveProperty("reasoning_effort");
		}
		expect((await ask("fireworks", { thinking: { type: "disabled" } })).reasoning_effort).toBe("none");
		expect((await ask("fireworks", { thinking: { type: "enabled", budget_tokens: 2000 } })).reasoning_effort).toBe("medium");
	});

	it("does not send top_k where the provider does not document it, and sends it where it does", async () => {
		for (const name of ["groq", "xai", "gemini"]) expect(await ask(name, { top_k: 5 })).not.toHaveProperty("top_k");
		for (const name of ["together", "fireworks"]) expect((await ask(name, { top_k: 5 })).top_k).toBe(5);
	});

	it("streams ask for usage except on Together", async () => {
		for (const name of ["groq", "fireworks", "xai", "gemini"]) {
			expect((await ask(name, { stream: true })).stream_options).toEqual({ include_usage: true });
		}
		expect(await ask("together", { stream: true })).not.toHaveProperty("stream_options");
	});

	it("routes embeddings and the model list through the same root", async () => {
		const endpoint = (url) => ({ url });
		expect(route("groq", "embeddings", endpoint("https://api.groq.com"))).toBe("/openai/v1/embeddings");
		expect(route("groq", "models", endpoint("https://api.groq.com/openai"))).toBe("/v1/models");
		expect(route("fireworks", "models", endpoint("https://api.fireworks.ai"))).toBe("/inference/v1/models");
		expect(route("gemini", "models", endpoint("https://generativelanguage.googleapis.com"))).toBe("/v1beta/openai/models");
		expect(route("gemini", "embeddings", endpoint("https://generativelanguage.googleapis.com/v1beta/openai"))).toBe("/embeddings");
		expect(route("together", "chat", endpoint("https://api.together.ai"))).toBe("/v1/chat/completions");
		const api = await apiOf("groq", "https://api.groq.com");
		expect(api.driver.groq.path("models", { endpoint: { url: "https://api.groq.com" } })).toBe("/openai/v1/models");
	});
});

describe("fields a provider rejects", () => {
	it("Groq drops logprobs, top_logprobs, logit_bias and message names and records them", () => {
		const state = { dropped: [] };
		const body = {
			model: "m",
			logprobs: true,
			top_logprobs: 2,
			logit_bias: { 1: 1 },
			messages: [
				{ role: "user", name: "ann", content: "hi" },
				{ role: "assistant", content: "ok" }
			]
		};
		expect(trim("groq", body, { state })).toEqual({
			model: "m",
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "ok" }
			]
		});
		expect(state.dropped).toEqual(["logprobs", "top_logprobs", "logit_bias", "messages[].name"]);
		// Recorded once, and the body without those fields passes untouched.
		trim("groq", body, { state });
		expect(state.dropped).toHaveLength(4);
		const clean = { model: "m", messages: user };
		expect(trim("groq", clean)).toEqual(clean);
		expect(trim("groq", { model: "m", messages: "text" })).toEqual({ model: "m", messages: "text" });
		expect(trim("groq", { model: "m", messages: [null, { role: "user", content: "x" }] })).toEqual({
			model: "m",
			messages: [null, { role: "user", content: "x" }]
		});
	});

	it("xAI drops stop and the penalties for reasoning models only", () => {
		const body = { messages: user, stop: ["x"], presence_penalty: 0.1, frequency_penalty: 0.2, temperature: 0.5 };
		for (const model of ["grok-4", "grok-4.20", "grok-4-fast-reasoning", "grok-3-mini", "grok-code-fast-1"]) {
			const state = { dropped: [] };
			expect(trim("xai", { model, ...body }, { state })).toEqual({ model, messages: user, temperature: 0.5 });
			expect(state.dropped).toEqual(["stop", "presence_penalty", "frequency_penalty"]);
		}
		for (const model of ["grok-3", "grok-4-fast-non-reasoning", "other"]) {
			expect(trim("xai", { model, ...body })).toEqual({ model, ...body });
		}
		expect(trim("xai", { messages: user, stop: ["x"] })).toEqual({ messages: user, stop: ["x"] });
	});

	it("tool fields are dropped when there are no tools, for every provider", () => {
		for (const name of Object.keys(PRESETS)) {
			expect(trim(name, { model: "m", messages: user, tools: [], tool_choice: "auto" })).toEqual({ model: "m", messages: user });
		}
	});

	it("an end-to-end request keeps the drops out of the sent body", async () => {
		const api = await apiOf("groq", "https://api.groq.com", "openai");
		const sent = await api.request({ model: "m", messages: [{ role: "user", name: "a", content: "x" }], logprobs: true, max_tokens: 3 });
		expect(sent.body.logprobs).toBeUndefined();
		expect(sent.body.messages).toEqual([{ role: "user", content: "x" }]);
		expect(match("groq", { url: "https://api.groq.com/openai" })).toEqual({ host: "api.groq.com" });
		for (const host of ["api.together.xyz", "us-api.together.ai"]) expect(match("together", { url: `https://${host}` })).toEqual({ host });
	});
});
