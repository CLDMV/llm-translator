/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/gemini.test.vitest.mjs
 *	@Date: 2026-11-21T10:00:00-08:00 (1795284000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-21T10:00:00-08:00 (1795284000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Gemini driver on the native generateContent API: selection with `api`, the API key header, both fronts, tools, images, thinking, thought signatures sent back, streaming, errors, the model list and token counts. Every upstream is a local stand-in or a mocked transport.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { completion as chatCompletion, json, sse } from "../helpers/fake-server.mjs";
import { content, gemini } from "../helpers/gemini.mjs";

const MODEL = "gemini-2.5-flash";
const PATH = `/v1beta/models/${MODEL}`;
const PNG = "iVBORw0KGgo=";
const user = [{ role: "user", content: "hi" }];
const tool = { name: "Read", description: "read a file", input_schema: { type: "object", properties: { path: { type: "string" } } } };
const chatTool = { type: "function", function: { name: "Read", description: "read a file", parameters: tool.input_schema } };
const toolReply = content(
	[
		{ text: "Let me look.", thought: true },
		{ functionCall: { id: "fc_1", name: "Read", args: { path: "a.txt" } }, thoughtSignature: "SIG-CALL" }
	],
	{},
	{ promptTokenCount: 20, candidatesTokenCount: 4, thoughtsTokenCount: 5, cachedContentTokenCount: 8 }
);

let google;
beforeAll(async () => {
	google = await gemini();
});
afterAll(async () => {
	await closeAll();
	await google.close();
});

// Composing a translator is slow, so each (front, upstream settings) pair is made once.
const made = new Map();
const apiFor = (front, extra = {}, id = "") => {
	const key = `${front}|${id}|${JSON.stringify(extra)}`;
	if (!made.has(key)) {
		made.set(
			key,
			make({ front, upstreams: [{ url: google.url, backend: "gemini", api: "gemini", apiKey: "key-1", ...extra }], detect: false })
		);
	}
	return made.get(key);
};
const run = async (front, body, handler, extra, id) => {
	const api = await apiFor(front, extra, id);
	google.use(handler);
	const out = await api.send(body);
	return { api, out, call: google.seen[0] };
};
const ok = (reply) => (_call, res) => json(res, 200, reply);
const streamOf = (frames) => (_call, res) => sse(res, frames);
const delta = (events, type, field) =>
	events
		.filter((entry) => entry.event === "content_block_delta" && entry.data.delta.type === type)
		.map((entry) => entry.data.delta[field])
		.join("");

describe("selection, URL and key", () => {
	it("lists the native protocol for the driver, and `api: gemini` or `google` selects it", async () => {
		const transport = fakeTransport(() => ({ body: {} }));
		const api = await make({ upstreams: ["https://generativelanguage.googleapis.com"], transport });
		expect(api.status().upstreams[0]).toMatchObject({
			driver: "gemini",
			protocol: "openai.chat",
			protocols: ["openai.chat", "google.gemini"]
		});
		expect(transport.calls).toEqual([]);
		for (const name of ["gemini", "google", "google.gemini"]) {
			const named = await make({ upstreams: [{ url: google.url, backend: "gemini", api: name }], detect: false });
			expect(named.status().upstreams[0].api).toBe("google.gemini");
		}
	});

	it("under api auto nothing changes: the OpenAI-compatible endpoint is used, with a bearer key", async () => {
		const { out, call } = await run(
			"openai",
			{ model: MODEL, messages: user },
			(_call, res) => json(res, 200, chatCompletion("hello")),
			{ api: "auto" },
			"auto"
		);
		expect(call.url).toBe("/v1beta/openai/chat/completions");
		expect(call.headers.authorization).toBe("Bearer key-1");
		expect(call.headers["x-goog-api-key"]).toBeUndefined();
		expect(out.status).toBe(200);
	});

	it("posts to models/<model>:generateContent with the key in x-goog-api-key and no bearer header", async () => {
		const { out, call } = await run("openai", { model: MODEL, messages: user }, ok(content([{ text: "Hello from Gemini" }])));
		expect(call.method).toBe("POST");
		expect(call.url).toBe(`${PATH}:generateContent`);
		expect(call.headers["x-goog-api-key"]).toBe("key-1");
		expect(call.headers.authorization).toBeUndefined();
		expect(call.body).toEqual({ contents: [{ role: "user", parts: [{ text: "hi" }] }] });
		expect(out.body).toMatchObject({
			object: "chat.completion",
			model: MODEL,
			choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Hello from Gemini" } }],
			usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 }
		});
		expect(await out.usage).toMatchObject({ input_tokens: 12, output_tokens: 5, reported: true });
	});

	it("a URL that ends in /v1beta and a model with the models/ prefix reach the same call", async () => {
		const { call } = await run(
			"openai",
			{ model: `models/${MODEL}`, messages: user },
			ok(content([{ text: "x" }])),
			{ url: `${google.url}/v1beta` },
			"v1beta"
		);
		expect(call.url).toBe(`${PATH}:generateContent`);
	});

	it("without a key no key header is sent", async () => {
		const { call } = await run("openai", { model: MODEL, messages: user }, ok(content([{ text: "x" }])), { apiKey: undefined }, "nokey");
		expect(call.headers["x-goog-api-key"]).toBeUndefined();
		expect(call.headers.authorization).toBeUndefined();
	});
});

describe("OpenAI front", () => {
	it("converts the request: system, sampling, stop, structured output, thinking, tools and images", async () => {
		const { out, call } = await run(
			"openai",
			{
				model: MODEL,
				max_completion_tokens: 50,
				top_p: 0.8,
				temperature: 0.2,
				seed: 3,
				stop: "END",
				reasoning_effort: "low",
				response_format: { type: "json_schema", json_schema: { name: "o", schema: { type: "object" } } },
				messages: [
					{ role: "system", content: "be brief" },
					{
						role: "user",
						content: [
							{ type: "text", text: "what is this" },
							{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } }
						]
					}
				],
				tools: [chatTool],
				tool_choice: { type: "function", function: { name: "Read" } }
			},
			ok(content([{ text: "a" }]))
		);
		expect(call.body).toEqual({
			contents: [
				{
					role: "user",
					parts: [{ text: "what is this" }, { inlineData: { mimeType: "image/png", data: PNG } }]
				}
			],
			systemInstruction: { parts: [{ text: "be brief" }] },
			generationConfig: {
				maxOutputTokens: 50,
				topP: 0.8,
				temperature: 0.2,
				seed: 3,
				stopSequences: ["END"],
				responseMimeType: "application/json",
				responseJsonSchema: { type: "object" },
				thinkingConfig: { includeThoughts: true, thinkingBudget: 1024 }
			},
			tools: [{ functionDeclarations: [{ name: "Read", description: "read a file", parametersJsonSchema: tool.input_schema }] }],
			toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["Read"] } }
		});
		expect(out.body.choices.map((choice) => [choice.index, choice.message.content, choice.finish_reason])).toEqual([[0, "a", "stop"]]);
	});

	it("n above 1 is answered by fan-out, one request per choice, with no candidateCount", async () => {
		const { out } = await run("openai", { model: MODEL, n: 2, messages: user }, ok(content([{ text: "a" }])));
		expect(google.seen).toHaveLength(2);
		for (const call of google.seen) expect(call.body.generationConfig?.candidateCount).toBeUndefined();
		expect(out.body.choices.map((choice) => choice.index)).toEqual([0, 1]);
	});

	it("sends thought signatures back through reasoning_details, tool calls and tool results", async () => {
		const first = await run("openai", { model: MODEL, tools: [chatTool], messages: user }, ok(toolReply));
		const message = first.out.body.choices[0].message;
		expect(message).toMatchObject({
			reasoning: "Let me look.",
			tool_calls: [{ id: "fc_1", function: { name: "Read", arguments: '{"path":"a.txt"}' } }]
		});
		expect(message.reasoning_details).toEqual([
			{ type: "reasoning.encrypted", format: "google-gemini-v1", index: 0, data: "SIG-CALL", for: "call", id: "fc_1" }
		]);
		expect(first.out.body.choices[0].finish_reason).toBe("tool_calls");
		expect(first.out.body.usage).toMatchObject({
			prompt_tokens: 20,
			completion_tokens: 9,
			prompt_tokens_details: { cached_tokens: 8 }
		});
		const second = await run(
			"openai",
			{
				model: MODEL,
				tools: [chatTool],
				messages: [...user, message, { role: "tool", tool_call_id: "fc_1", content: "file a" }]
			},
			ok(content([{ text: "done", thoughtSignature: "SIG-TEXT" }]))
		);
		expect(second.call.body.contents).toEqual([
			{ role: "user", parts: [{ text: "hi" }] },
			{ role: "model", parts: [{ functionCall: { id: "fc_1", name: "Read", args: { path: "a.txt" } }, thoughtSignature: "SIG-CALL" }] },
			{ role: "user", parts: [{ functionResponse: { id: "fc_1", name: "Read", response: { output: "file a" } } }] }
		]);
		expect(second.out.body.choices[0].message.reasoning_details).toEqual([
			{ type: "reasoning.encrypted", format: "google-gemini-v1", index: 0, data: "SIG-TEXT", for: "text" }
		]);
	});

	it("streams chunks with one id, a whole tool call, signatures and, when asked, the usage chunk", async () => {
		const { out, call } = await run(
			"openai",
			{ model: MODEL, stream: true, stream_options: { include_usage: true }, tools: [chatTool], messages: user },
			streamOf([
				content([{ text: "Let me ", thought: true }], { finishReason: undefined }, null),
				content([{ text: "look.", thought: true }, { text: "Ok " }], { finishReason: undefined }, null),
				content(
					[{ functionCall: { name: "Read", args: { path: "a.txt" } }, thoughtSignature: "SIG" }],
					{},
					{ promptTokenCount: 20, candidatesTokenCount: 9, cachedContentTokenCount: 8 }
				)
			])
		);
		expect(call.url).toBe(`${PATH}:streamGenerateContent?alt=sse`);
		expect(call.headers.accept).toBe("text/event-stream");
		expect(call.body.stream).toBeUndefined();
		const data = (await collect(out.stream)).map((entry) => entry.data);
		expect(data.at(-1)).toBe("[DONE]");
		const chunks = data.slice(0, -1);
		expect(new Set(chunks.map((entry) => entry.id)).size).toBe(1);
		expect(chunks.flatMap((entry) => entry.choices[0]?.delta?.reasoning ?? []).join("")).toBe("Let me look.");
		expect(chunks.flatMap((entry) => entry.choices[0]?.delta?.content ?? []).join("")).toBe("Ok ");
		const calls = chunks.flatMap((entry) => entry.choices[0]?.delta?.tool_calls ?? []);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ index: 0, function: { name: "Read", arguments: '{"path":"a.txt"}' } });
		expect(chunks.flatMap((entry) => entry.choices[0]?.delta?.reasoning_details ?? [])[0]).toMatchObject({
			data: "SIG",
			for: "call",
			id: calls[0].id
		});
		expect(chunks.find((entry) => entry.choices[0]?.finish_reason)?.choices[0].finish_reason).toBe("tool_calls");
		expect(chunks.at(-1)).toMatchObject({
			choices: [],
			usage: { prompt_tokens: 20, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 8 } }
		});
		expect(await out.usage).toMatchObject({ input_tokens: 12, output_tokens: 9, cache_read_input_tokens: 8 });
	});

	it("an error in the stream, a blocked prompt and a stream cut before the finish each end the stream", async () => {
		const failed = await run(
			"openai",
			{ model: MODEL, stream: true, messages: user },
			streamOf([
				content([{ text: "a" }], { finishReason: undefined }, null),
				{ error: { code: 429, message: "slow", status: "RESOURCE_EXHAUSTED" } }
			])
		);
		const data = (await collect(failed.out.stream)).map((entry) => entry.data);
		expect(data.at(-2)).toMatchObject({ error: { message: "slow", type: "invalid_request_error", code: 429 } });
		expect(data.at(-1)).toBe("[DONE]");
		const blocked = await run(
			"openai",
			{ model: MODEL, stream: true, messages: user },
			streamOf([{ promptFeedback: { blockReason: "SAFETY" } }])
		);
		const filtered = (await collect(blocked.out.stream)).map((entry) => entry.data);
		expect(filtered.find((chunk) => chunk.choices?.[0]?.finish_reason)?.choices[0].finish_reason).toBe("content_filter");
		const cut = await run(
			"openai",
			{ model: MODEL, stream: true, messages: user },
			streamOf([content([{ text: "a" }], { finishReason: undefined }, null)])
		);
		const ended = (await collect(cut.out.stream)).map((entry) => entry.data);
		expect(ended.at(-2).error.message).toBe("Upstream stream ended before completion");
		const broken = await run("openai", { model: MODEL, stream: true, messages: user }, streamOf(["{not json"]));
		expect((await collect(broken.out.stream)).map((entry) => entry.data).at(-2).error.message).toMatch(/not valid JSON/);
	});

	it("finish reasons: length, a filtered reply with its refusal, a blocked prompt, a failure and an empty reply", async () => {
		const finish = async (reply) => (await run("openai", { model: MODEL, messages: user }, ok(reply))).out;
		expect((await finish(content([{ text: "x" }], { finishReason: "MAX_TOKENS" }))).body.choices[0].finish_reason).toBe("length");
		expect((await finish(content([], { finishReason: "SAFETY", finishMessage: "blocked here" }))).body.choices[0]).toMatchObject({
			finish_reason: "content_filter",
			message: { refusal: "blocked here" }
		});
		expect((await finish({ promptFeedback: { blockReason: "OTHER" } })).body.choices[0].finish_reason).toBe("content_filter");
		expect((await finish(content([{ text: "x" }], { finishReason: "MALFORMED_FUNCTION_CALL" }))).body.choices[0].finish_reason).toBe(
			"error"
		);
		const empty = await finish({});
		expect(empty.status).toBe(502);
		expect(empty.body.error.message).toMatch(/no message/);
	});
});

describe("Anthropic front", () => {
	const body = { model: MODEL, max_tokens: 64, tools: [tool], messages: user };

	it("converts the request: system, sampling, thinking budget, tool choice and images", async () => {
		const { out, call } = await run(
			"anthropic",
			{
				model: MODEL,
				max_tokens: 100,
				system: "be brief",
				temperature: 0.3,
				top_k: 20,
				stop_sequences: ["END"],
				thinking: { type: "enabled", budget_tokens: 2048 },
				tools: [tool],
				tool_choice: { type: "any" },
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: "see" },
							{ type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
							{ type: "image", source: { type: "url", url: "https://example.com/a.png" } }
						]
					}
				]
			},
			ok(content([{ text: "Hi there" }]))
		);
		expect(call.url).toBe(`${PATH}:generateContent`);
		expect(call.body.systemInstruction).toEqual({ parts: [{ text: "be brief" }] });
		expect(call.body.generationConfig).toEqual({
			maxOutputTokens: 100,
			temperature: 0.3,
			topK: 20,
			stopSequences: ["END"],
			thinkingConfig: { includeThoughts: true, thinkingBudget: 2048 }
		});
		expect(call.body.toolConfig).toEqual({ functionCallingConfig: { mode: "ANY" } });
		expect(call.body.contents[0].parts.map((part) => Object.keys(part)[0])).toEqual(["text", "inlineData", "text"]);
		expect(call.body.model).toBeUndefined();
		expect(out.body).toMatchObject({
			type: "message",
			model: MODEL,
			stop_reason: "end_turn",
			content: [{ type: "text", text: "Hi there" }]
		});
		expect(out.body.usage).toMatchObject({ input_tokens: 12, output_tokens: 5 });
	});

	it("a Gemini 3 model gets a thinking level, chosen by the model sent upstream (an alias too), not a budget", async () => {
		const flash = "gemini-3-flash-preview";
		const level = async (extra, model = flash) =>
			(await run("anthropic", { ...body, model, ...extra }, ok(content([{ text: "x" }])), undefined, "level")).call.body.generationConfig
				.thinkingConfig;
		expect(await level({ output_config: { effort: "low" } })).toEqual({ includeThoughts: true, thinkingLevel: "LOW" });
		expect(await level({ thinking: { type: "enabled", budget_tokens: 8000 } })).toEqual({ includeThoughts: true, thinkingLevel: "MEDIUM" });
		expect(await level({ thinking: { type: "disabled" } })).toEqual({ thinkingLevel: "MINIMAL" });
		expect(google.seen[0].url).toBe(`/v1beta/models/${flash}:generateContent`);
		const aliased = await make({
			front: "anthropic",
			aliases: { fast: flash },
			upstreams: [{ url: google.url, backend: "gemini", api: "gemini", apiKey: "key-1" }],
			detect: false
		});
		google.use(ok(content([{ text: "x" }])));
		await aliased.send({ ...body, model: "fast", output_config: { effort: "high" } });
		expect(google.seen[0].url).toBe(`/v1beta/models/${flash}:generateContent`);
		expect(google.seen[0].body.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: "HIGH" });
	});

	it("a tool call whose signature was lost is sent with Google's placeholder", async () => {
		const { call } = await run(
			"anthropic",
			{
				...body,
				messages: [
					...user,
					{
						role: "assistant",
						content: [
							{ type: "tool_use", id: "t1", name: "Read", input: { path: "a" } },
							{ type: "tool_use", id: "t2", name: "Read", input: {} }
						]
					},
					{
						role: "user",
						content: [
							{ type: "tool_result", tool_use_id: "t1", content: "a" },
							{ type: "tool_result", tool_use_id: "t2", content: "b" }
						]
					}
				]
			},
			ok(content([{ text: "x" }]))
		);
		expect(call.body.contents[1].parts).toEqual([
			{ functionCall: { id: "t1", name: "Read", args: { path: "a" } }, thoughtSignature: "skip_thought_signature_validator" },
			{ functionCall: { id: "t2", name: "Read", args: {} } }
		]);
	});

	it("a base64 PDF is sent whole for Gemini to read; other documents are expanded as always", async () => {
		const pdf = { type: "document", title: "T", source: { type: "base64", media_type: "application/pdf", data: PNG } };
		const text = {
			type: "document",
			source: { type: "base64", media_type: "text/plain", data: Buffer.from("plain words").toString("base64") }
		};
		const ask = (extra, id) =>
			run(
				"anthropic",
				{ ...body, messages: [{ role: "user", content: [{ type: "text", text: "read" }, pdf, text] }] },
				ok(content([{ text: "x" }])),
				extra,
				id
			);
		const sent = (await ask(undefined, "pdf")).call.body.contents[0].parts;
		expect(sent).toEqual([
			{ text: "read" },
			{ inlineData: { mimeType: "application/pdf", data: PNG } },
			{ text: "<document>\nplain words\n</document>" }
		]);
		const noted = (await ask({ settings: { documents: "note" } }, "pdf-note")).call.body.contents[0].parts;
		expect(JSON.stringify(noted)).not.toContain("inlineData");
		expect(JSON.stringify(noted)).toContain("document conversion is disabled");
		const own = (await ask({ settings: { documentConverter: () => [{ type: "text", text: "converted" }] } }, "pdf-own")).call.body
			.contents[0].parts;
		expect(own.map((part) => part.text)).toEqual(["read\n\nconverted\n\nconverted"]);
		const imageless = (await ask({ settings: { images: false } }, "pdf-noimg")).call.body.contents[0].parts;
		expect(JSON.stringify(imageless)).not.toContain("inlineData");
	});

	it("an effort, or thinking switched off, is a budget too, and metadata.sampling is merged", async () => {
		const asks = async (extra, upstream) =>
			(await run("anthropic", { ...body, ...extra }, ok(content([{ text: "x" }])), upstream, JSON.stringify(upstream ?? {}))).call.body
				.generationConfig;
		expect((await asks({ output_config: { effort: "high" } })).thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: 24576 });
		expect((await asks({ thinking: { type: "disabled" } })).thinkingConfig).toEqual({ thinkingBudget: 0 });
		expect(
			await asks({ metadata: { sampling: { frequencyPenalty: 0.5 } } }, { settings: { sampling: { presencePenalty: 0.1 } } })
		).toMatchObject({
			frequencyPenalty: 0.5,
			presencePenalty: 0.1
		});
	});

	it("gives a thinking block with a signature and a tool_use, and takes both back on the next turn", async () => {
		const first = await run("anthropic", body, ok(toolReply));
		const [thinking, toolUse] = first.out.body.content;
		expect(thinking).toMatchObject({ type: "thinking", thinking: "Let me look." });
		expect(thinking.signature).toMatch(/^llmt:/);
		expect(toolUse).toEqual({ type: "tool_use", id: "fc_1", name: "Read", input: { path: "a.txt" } });
		expect(first.out.body.stop_reason).toBe("tool_use");
		expect(first.out.body.usage).toMatchObject({ input_tokens: 12, output_tokens: 9, cache_read_input_tokens: 8 });
		const second = await run(
			"anthropic",
			{
				...body,
				messages: [
					...user,
					{ role: "assistant", content: first.out.body.content },
					{ role: "user", content: [{ type: "tool_result", tool_use_id: "fc_1", content: "file a" }] }
				]
			},
			ok(content([{ text: "done" }]))
		);
		expect(second.call.body.contents.slice(1)).toEqual([
			{ role: "model", parts: [{ functionCall: { id: "fc_1", name: "Read", args: { path: "a.txt" } }, thoughtSignature: "SIG-CALL" }] },
			{ role: "user", parts: [{ functionResponse: { id: "fc_1", name: "Read", response: { output: "file a" } } }] }
		]);
		const failed = await run(
			"anthropic",
			{
				...body,
				messages: [
					...user,
					{ role: "assistant", content: first.out.body.content },
					{ role: "user", content: [{ type: "tool_result", tool_use_id: "fc_1", content: "no such file", is_error: true }] }
				]
			},
			ok(content([{ text: "sorry" }]))
		);
		expect(failed.call.body.contents.at(-1).parts[0].functionResponse.response).toEqual({ error: "no such file" });
	});

	it("streams thinking, text and a tool call, with the signature on the thinking block", async () => {
		const { out } = await run(
			"anthropic",
			{ ...body, stream: true },
			streamOf([
				content([{ text: "Let me ", thought: true }], { finishReason: undefined }, null),
				content([{ text: "look.", thought: true }], { finishReason: undefined }, null),
				content([{ text: "Reading." }], { finishReason: undefined }, null),
				content(
					[{ functionCall: { id: "fc_9", name: "Read", args: { path: "a.txt" } }, thoughtSignature: "SIG" }],
					{},
					{ promptTokenCount: 20, candidatesTokenCount: 9, cachedContentTokenCount: 8 }
				)
			])
		);
		const events = await collect(out.stream);
		expect(delta(events, "thinking_delta", "thinking")).toBe("Let me look.");
		expect(delta(events, "text_delta", "text")).toBe("Reading.");
		expect(delta(events, "signature_delta", "signature")).toMatch(/^llmt:/);
		expect(
			events.find((entry) => entry.event === "content_block_start" && entry.data.content_block.type === "tool_use").data.content_block
		).toMatchObject({ id: "fc_9", name: "Read" });
		expect(JSON.parse(delta(events, "input_json_delta", "partial_json"))).toEqual({ path: "a.txt" });
		expect(events.find((entry) => entry.event === "message_delta").data.delta.stop_reason).toBe("tool_use");
		expect(await out.usage).toMatchObject({ input_tokens: 12, output_tokens: 9, cache_read_input_tokens: 8, complete: true });
	});

	it("an error in the stream, a malformed finish and a stream cut short each end with an error event", async () => {
		const failed = await run(
			"anthropic",
			{ ...body, stream: true },
			streamOf([{ error: { code: 400, message: "bad request", status: "INVALID_ARGUMENT" } }])
		);
		expect((await collect(failed.out.stream)).at(-1)).toMatchObject({
			event: "error",
			data: { error: { type: "invalid_request_error", message: "bad request" } }
		});
		const malformed = await run(
			"anthropic",
			{ ...body, stream: true },
			streamOf([content([], { finishReason: "MALFORMED_FUNCTION_CALL" }, null)])
		);
		expect((await collect(malformed.out.stream)).at(-1)).toMatchObject({ event: "error" });
		const cut = await run("anthropic", { ...body, stream: true }, streamOf([content([{ text: "a" }], { finishReason: undefined }, null)]));
		expect((await collect(cut.out.stream)).at(-1)).toMatchObject({
			event: "error",
			data: { error: { message: "Upstream stream ended before completion" } }
		});
	});

	it("a filtered reply is a refusal, and a failure finish is an error", async () => {
		const refused = await run("anthropic", body, ok(content([], { finishReason: "SAFETY", finishMessage: "not allowed" })));
		expect(refused.out.body).toMatchObject({ stop_reason: "refusal", stop_details: { type: "refusal", explanation: "not allowed" } });
		const failed = await run("anthropic", body, ok(content([], { finishReason: "OTHER" })));
		expect(failed.out.status).toBe(502);
	});
});

describe("errors", () => {
	it("a Google error envelope comes back in the client's shape, with its status as the code", async () => {
		const envelope = { error: { code: 400, message: "API key not valid.", status: "INVALID_ARGUMENT" } };
		const bad = await run("openai", { model: MODEL, messages: user }, (_call, res) => json(res, 400, envelope));
		expect(bad.out.status).toBe(400);
		expect(bad.out.body.error).toMatchObject({ message: "API key not valid.", code: "INVALID_ARGUMENT" });
		const limited = await run("anthropic", { model: MODEL, max_tokens: 8, messages: user }, (_call, res) =>
			json(res, 429, [{ error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } }])
		);
		expect(limited.out.status).toBe(429);
		expect(limited.out.body).toMatchObject({ type: "error", error: { type: "rate_limit_error", message: "Quota exceeded" } });
	});

	it("an error of the OpenAI-compatible endpoint is left as it is", async () => {
		const api = await apiFor("openai", { api: "auto" }, "auto");
		google.use((_call, res) => json(res, 400, { error: { message: "compat says no", type: "invalid_request_error", code: 400 } }));
		const out = await api.send({ model: MODEL, messages: user });
		expect(out.status).toBe(400);
		expect(out.body.error).toMatchObject({ message: "compat says no", code: 400 });
	});
});

describe("model list", () => {
	it("lists the models of every page that can generate content, without the models/ prefix", async () => {
		const api = await apiFor("openai");
		google.use((call, res) =>
			json(
				res,
				200,
				call.url.includes("pageToken=p2")
					? {
							models: [
								{ name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent", "countTokens"], inputTokenLimit: 1048576 }
							]
						}
					: {
							models: [
								{ name: `models/${MODEL}`, supportedGenerationMethods: ["generateContent"] },
								{ name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
								{ name: "models/legacy" },
								{ displayName: "nameless" }
							],
							nextPageToken: "p2"
						}
			)
		);
		const out = await api.model.list();
		expect(google.seen.map((call) => [call.method, call.url, call.headers["x-goog-api-key"]])).toEqual([
			["GET", "/v1beta/models?pageSize=1000", "key-1"],
			["GET", "/v1beta/models?pageSize=1000&pageToken=p2", "key-1"]
		]);
		expect(out.data.map((entry) => [entry.id, entry.owned_by, entry.max_model_len])).toEqual([
			[MODEL, "google", undefined],
			["gemini-2.5-pro", "google", 1048576]
		]);
	});

	it("stops following pages after a bound, and falls back to the configured models when it cannot list", async () => {
		const api = await apiFor("openai", { models: ["configured"] }, "listed");
		google.use((_call, res) =>
			json(res, 200, { models: [{ name: "models/a", supportedGenerationMethods: ["generateContent"] }], nextPageToken: "more" })
		);
		expect((await api.model.list()).data).toHaveLength(1);
		expect(google.seen).toHaveLength(20);
		google.use((_call, res) => json(res, 403, { error: { message: "denied" } }));
		expect((await api.model.list()).data.map((entry) => entry.id)).toEqual(["configured"]);
		google.use((_call, res) => json(res, 200, { nope: 1 }));
		expect((await api.model.list()).data.map((entry) => entry.id)).toEqual(["configured"]);
		google.use((_call, res) => json(res, 200, { models: [], nextPageToken: "" }));
		expect((await api.model.list()).data).toEqual([]);
	});

	it("without a key the list is asked with no key header", async () => {
		const api = await apiFor("openai", { apiKey: undefined, headers: { "x-extra": "1" } }, "keyless-list");
		google.use((_call, res) => json(res, 200, { models: [{ name: "models/a", supportedGenerationMethods: ["generateContent"] }] }));
		expect((await api.model.list()).data.map((entry) => entry.id)).toEqual(["a"]);
		expect(google.seen[0].headers["x-goog-api-key"]).toBeUndefined();
		expect(google.seen[0].headers["x-extra"]).toBe("1");
	});

	it("an upstream on the OpenAI-compatible endpoint is not asked", async () => {
		const api = await apiFor("openai", { api: "auto", models: ["configured"] }, "auto-list");
		google.use((_call, res) => json(res, 500, {}));
		expect((await api.model.list()).data.map((entry) => entry.id)).toEqual(["configured"]);
		expect(google.seen).toEqual([]);
	});
});

describe("token counts", () => {
	const ask = { model: MODEL, max_tokens: 8, system: "be brief", tools: [tool], messages: [{ role: "user", content: "x".repeat(400) }] };

	it("counts with countTokens on the native API, sending the prompt as a generateContentRequest", async () => {
		const api = await apiFor("anthropic");
		google.use((_call, res) => json(res, 200, { totalTokens: 123 }));
		expect(await api.token.count(ask)).toEqual({ input_tokens: 123 });
		expect(google.seen[0]).toMatchObject({ method: "POST", url: `${PATH}:countTokens` });
		expect(google.seen[0].headers["x-goog-api-key"]).toBe("key-1");
		expect(google.seen[0].body.generateContentRequest).toMatchObject({
			model: `models/${MODEL}`,
			systemInstruction: { parts: [{ text: "be brief" }] },
			tools: [{ functionDeclarations: [{ name: "Read" }] }]
		});
		expect(google.seen[0].body.generateContentRequest.contents[0].parts[0].text).toHaveLength(400);
		expect(google.seen[0].body.generateContentRequest.generationConfig).toBeUndefined();
	});

	it("estimates when countTokens fails, or when the upstream is on the OpenAI-compatible endpoint, or has no key", async () => {
		const api = await apiFor("anthropic");
		google.use((_call, res) => json(res, 500, { error: { message: "down" } }));
		expect((await api.token.count(ask)).input_tokens).toBeGreaterThan(90);
		google.use((_call, res) => json(res, 200, {}));
		expect((await api.token.count(ask)).input_tokens).toBeGreaterThan(90);
		const compat = await apiFor("anthropic", { api: "auto" }, "auto-count");
		google.use((_call, res) => json(res, 200, { totalTokens: 1 }));
		expect((await compat.token.count(ask)).input_tokens).toBeGreaterThan(90);
		expect(google.seen).toEqual([]);
		const keyless = await apiFor("anthropic", { apiKey: undefined, headers: { "x-extra": "1" } }, "keyless");
		google.use((_call, res) => json(res, 200, { totalTokens: 7 }));
		expect(await keyless.token.count(ask)).toEqual({ input_tokens: 7 });
		expect(google.seen[0].headers["x-goog-api-key"]).toBeUndefined();
		expect(google.seen[0].headers["x-extra"]).toBe("1");
	});

	it("a reply without usage is counted with countTokens for the report, and a count that fails is estimated", async () => {
		const handler = (counted) => (call, res) => {
			if (call.url.endsWith(":countTokens")) return counted(res);
			return json(res, 200, content([{ text: "x".repeat(40) }], {}, null));
		};
		const exact = await run(
			"openai",
			{ model: MODEL, messages: user },
			handler((res) => json(res, 200, { totalTokens: 33 })),
			undefined,
			"usage"
		);
		expect(await exact.out.usage).toMatchObject({ reported: false, estimated: { input_tokens: 33 } });
		const guessed = await run(
			"openai",
			{ model: MODEL, messages: user },
			handler((res) => json(res, 500, {})),
			undefined,
			"usage"
		);
		expect((await guessed.out.usage).estimated.input_tokens).toBeGreaterThan(0);
	});
});

describe("driver leaves", () => {
	it("path(): native calls follow the stream flag, anything else keeps the OpenAI-compatible paths", async () => {
		const api = await apiFor("openai");
		const { path } = api.driver.gemini;
		const endpoint = { url: "https://generativelanguage.googleapis.com" };
		expect(path("gemini", { endpoint, model: "gemini-x", protocol: "google.gemini" })).toBe("/v1beta/models/gemini-x:generateContent");
		expect(path("gemini", { endpoint, model: "gemini-x", protocol: "google.gemini", stream: true })).toBe(
			"/v1beta/models/gemini-x:streamGenerateContent?alt=sse"
		);
		expect(path("chat", { endpoint, model: "gemini-x", protocol: "openai.chat" })).toBe("/v1beta/openai/chat/completions");
		expect(path("models", { endpoint })).toBe("/v1beta/openai/models");
	});

	it("request(): a native body loses model and stream, a Chat Completions body is trimmed as before", async () => {
		const api = await apiFor("openai");
		const { request } = api.driver.gemini;
		expect(request({ model: "m", stream: true, contents: [] }, { protocol: "google.gemini" })).toEqual({ contents: [] });
		expect(request({ model: "m", messages: [], tools: [] }, { protocol: "openai.chat" })).toEqual({ model: "m", messages: [] });
	});

	it("sign(): a native call swaps the bearer key for x-goog-api-key and keeps an authorization of its own", async () => {
		const api = await apiFor("openai");
		const { sign } = api.driver.gemini;
		const endpoint = { apiKey: "k" };
		expect(sign({ endpoint, protocol: "google.gemini", headers: { authorization: "Bearer k", a: "1" } })).toEqual({
			a: "1",
			"x-goog-api-key": "k"
		});
		expect(sign({ endpoint, protocol: "google.gemini", headers: { authorization: "Bearer other" } })).toEqual({
			authorization: "Bearer other",
			"x-goog-api-key": "k"
		});
		const headers = { authorization: "Bearer k" };
		expect(sign({ endpoint, protocol: "openai.chat", headers })).toBe(headers);
		expect(sign({ endpoint: {}, protocol: "google.gemini", headers })).toBe(headers);
	});

	it("error(): only an error of the native API is normalized", async () => {
		const api = await apiFor("openai");
		const { error } = api.driver.gemini;
		const body = { error: { message: "m", status: "NOT_FOUND" } };
		expect(error(404, body, { state: { protocol: "google.gemini" } })).toEqual({
			error: { message: "m", type: undefined, param: null, code: "NOT_FOUND" }
		});
		expect(error(404, body, { state: { protocol: "openai.chat" } })).toBe(body);
		expect(error(404, body)).toBe(body);
	});
});
