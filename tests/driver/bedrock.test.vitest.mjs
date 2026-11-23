/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/bedrock.test.vitest.mjs
 *	@Date: 2026-11-19T09:00:00-08:00 (1795107600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-19T09:00:00-08:00 (1795107600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Amazon Bedrock driver: detection by host, URL and region, authentication (SigV4 checked on the wire, Bedrock API keys, the AWS_* environment), InvokeModel for Claude and Converse for every other model, both fronts, streaming through binary event stream frames, errors and exception frames, the model list. Every upstream is a local stand-in or a mocked transport.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { bedrock, keys, reply, stream } from "../helpers/bedrock.mjs";
import { chunk, event, exception } from "../helpers/eventstream.mjs";

const CLAUDE = "anthropic.claude-sonnet-4-5-20250929-v1:0";
const CLAUDE_PATH = "/model/anthropic.claude-sonnet-4-5-20250929-v1%3A0";
const NOVA = "amazon.nova-pro-v1:0";
const NOVA_PATH = "/model/amazon.nova-pro-v1%3A0";
const user = [{ role: "user", content: "hi" }];
const tool = { name: "Read", description: "read a file", input_schema: { type: "object", properties: { path: { type: "string" } } } };
const chatTool = { type: "function", function: { name: "Read", description: "read a file", parameters: tool.input_schema } };

let aws;
// The chain of AWS credential sources finds nothing here unless a test gives it something: no shared files, no metadata service.
const isolated = {
	AWS_CONFIG_FILE: "/nonexistent/aws/config",
	AWS_SHARED_CREDENTIALS_FILE: "/nonexistent/aws/credentials",
	AWS_EC2_METADATA_DISABLED: "true"
};
beforeAll(async () => {
	aws = await bedrock("us-east-1");
	Object.assign(process.env, isolated);
});
afterAll(async () => {
	await closeAll();
	await aws.close();
	for (const name of Object.keys(isolated)) delete process.env[name];
});
afterEach(() => {
	for (const name of [
		"AWS_ACCESS_KEY_ID",
		"AWS_SECRET_ACCESS_KEY",
		"AWS_SESSION_TOKEN",
		"AWS_BEARER_TOKEN_BEDROCK",
		"AWS_REGION",
		"AWS_DEFAULT_REGION"
	]) {
		delete process.env[name];
	}
});

const claudeMessage = {
	id: "msg_01",
	type: "message",
	role: "assistant",
	model: "claude-sonnet-4-5-20250929",
	content: [{ type: "text", text: "Hello from Bedrock" }],
	stop_reason: "end_turn",
	stop_sequence: null,
	usage: { input_tokens: 12, output_tokens: 5 }
};
const claudeEvents = [
	{ type: "message_start", message: { ...claudeMessage, content: [], stop_reason: null, usage: { input_tokens: 12, output_tokens: 1 } } },
	{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
	{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
	{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " Bedrock" } },
	{ type: "content_block_stop", index: 0 },
	{ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } },
	{ type: "message_stop", "amazon-bedrock-invocationMetrics": { inputTokenCount: 12, outputTokenCount: 5, invocationLatency: 90 } }
];
const converseReply = (content, stopReason = "end_turn") => ({
	output: { message: { role: "assistant", content } },
	stopReason,
	usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
	metrics: { latencyMs: 80 }
});
const converseText = [
	event("messageStart", { role: "assistant" }),
	event("contentBlockDelta", { contentBlockIndex: 0, delta: { text: "Hello" } }),
	event("contentBlockDelta", { contentBlockIndex: 0, delta: { text: " Converse" } }),
	event("contentBlockStop", { contentBlockIndex: 0 }),
	event("messageStop", { stopReason: "end_turn" }),
	event("metadata", { usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 }, metrics: { latencyMs: 80 } })
];
const converseTool = [
	event("messageStart", { role: "assistant" }),
	event("contentBlockDelta", { contentBlockIndex: 0, delta: { reasoningContent: { text: "Let me look." } } }),
	event("contentBlockStart", { contentBlockIndex: 1, start: { toolUse: { toolUseId: "tooluse_1", name: "Read" } } }),
	event("contentBlockDelta", { contentBlockIndex: 1, delta: { toolUse: { input: '{"path"' } } }),
	event("contentBlockDelta", { contentBlockIndex: 1, delta: { toolUse: { input: ':"a.txt"}' } } }),
	event("contentBlockStop", { contentBlockIndex: 1 }),
	event("messageStop", { stopReason: "tool_use" }),
	event("metadata", { usage: { inputTokens: 20, outputTokens: 9, cacheReadInputTokens: 8 }, metrics: { latencyMs: 80 } })
];

// Composing a translator is slow, so each (front, upstream settings) pair is made once.
const made = new Map();
const apiFor = (front, extra = {}, id = "") => {
	const key = `${front}|${id}|${JSON.stringify(extra)}`;
	if (!made.has(key)) {
		made.set(
			key,
			make({ front, upstreams: [{ url: aws.url, backend: "bedrock", region: "us-east-1", ...keys, ...extra }], detect: false })
		);
	}
	return made.get(key);
};
const run = async (front, body, handler, extra, id) => {
	const api = await apiFor(front, extra, id);
	aws.use(handler);
	const out = await api.send(body);
	return { api, out, call: aws.seen[0] };
};
const textOf = (events) =>
	events
		.filter((entry) => entry.event === "content_block_delta")
		.map((entry) => entry.data.delta.text ?? "")
		.join("");

describe("detection, URL and region", () => {
	it("matches the Bedrock runtime hosts by name, with no request, and nothing else under amazonaws.com", async () => {
		const transport = fakeTransport(() => ({ body: {} }));
		const api = await make({ upstreams: ["https://bedrock-runtime.us-east-1.amazonaws.com"], transport });
		expect(api.status().upstreams[0]).toMatchObject({ driver: "bedrock", protocol: "anthropic.messages", facts: { region: "us-east-1" } });
		expect(api.status().upstreams[0].protocols).toEqual(["anthropic.messages", "bedrock.converse"]);
		expect(transport.calls).toEqual([]);
		const { detect } = api.driver.bedrock;
		expect(detect({ endpoint: { url: "https://bedrock-runtime-fips.us-gov-west-1.amazonaws.com" } })).toEqual({
			host: "bedrock-runtime-fips.us-gov-west-1.amazonaws.com",
			region: "us-gov-west-1"
		});
		expect(detect({ endpoint: { url: "https://s3.us-east-1.amazonaws.com" } })).toBeNull();
		expect(detect({ endpoint: { url: "https://bedrock.us-east-1.amazonaws.com" } })).toBeNull();
		expect(detect({ endpoint: { url: "not a url" } })).toBeNull();
		expect(api.driver.bedrock.info()).toMatchObject({ name: "bedrock", order: 33, auth: "bearer", frames: "eventstream" });
	});

	it("a bedrock upstream without a url gets the runtime URL of its region, from the setting or the environment", async () => {
		const set = await make({ upstreams: [{ backend: "bedrock", region: "eu-west-1" }], detect: false });
		expect(set.status().upstreams[0].url).toBe("https://bedrock-runtime.eu-west-1.amazonaws.com");
		process.env.AWS_REGION = "ap-south-1";
		const env = await make({ upstreams: [{ backend: "bedrock" }], detect: false });
		expect(env.status().upstreams[0].url).toBe("https://bedrock-runtime.ap-south-1.amazonaws.com");
		delete process.env.AWS_REGION;
		await expect(make({ upstreams: [{ backend: "bedrock" }], detect: false })).rejects.toMatchObject({ code: "INVALID_CONFIG" });
		await expect(make({ upstreams: [{ backend: "vllm" }], detect: false })).rejects.toMatchObject({ code: "INVALID_CONFIG" });
	});

	it("rejects an empty region or credential setting", async () => {
		for (const key of ["region", "accessKeyId", "secretAccessKey", "sessionToken", "profile"]) {
			await expect(make({ upstreams: [{ url: aws.url, backend: "bedrock", [key]: "" }], detect: false })).rejects.toThrow(
				new RegExp(`${key} must be a non-empty string`)
			);
		}
	});
});

describe("choosing the protocol by model", () => {
	it("auto: Claude ids and inference profiles use InvokeModel, every other model Converse", async () => {
		const api = await apiFor("anthropic");
		const proto = (model) => api.route({ model, max_tokens: 8, messages: user }).protocol;
		for (const id of [CLAUDE, `us.${CLAUDE}`, `arn:aws:bedrock:us-east-1:1:inference-profile/us.${CLAUDE}`])
			expect(proto(id)).toBe("anthropic.messages");
		for (const id of [NOVA, "meta.llama3-1-70b-instruct-v1:0", "arn:aws:bedrock:us-east-1:1:application-inference-profile/abc"]) {
			expect(proto(id)).toBe("bedrock.converse");
		}
		const chat = await apiFor("openai");
		expect(chat.route({ model: CLAUDE, messages: user }, { front: "openai" }).protocol).toBe("anthropic.messages");
		expect(chat.route({ model: NOVA, messages: user }, { front: "openai" }).protocol).toBe("bedrock.converse");
		expect(api.status().upstreams[0].protocol).toBe("anthropic.messages");
		expect(chat.status().upstreams[0].protocol).toBe("anthropic.messages");
	});

	it("an explicit api wins; converse has an alias; chat is not something Bedrock speaks", async () => {
		const converse = await apiFor("anthropic", { api: "converse" }, "converse");
		expect(converse.route({ model: CLAUDE, max_tokens: 8, messages: user }).protocol).toBe("bedrock.converse");
		const messages = await apiFor("anthropic", { api: "anthropic.messages" }, "messages");
		expect(messages.route({ model: NOVA, max_tokens: 8, messages: user }).protocol).toBe("anthropic.messages");
		await expect(
			make({ upstreams: [{ url: aws.url, backend: "bedrock", api: "chat", region: "us-east-1" }], detect: false })
		).rejects.toMatchObject({
			code: "unsupported_api"
		});
	});
});

describe("InvokeModel for Claude: Anthropic front", () => {
	it("sends the Anthropic body without model, stream and metadata, with anthropic_version, to the encoded model path, signed", async () => {
		const { out, call } = await run(
			"anthropic",
			{ model: CLAUDE, max_tokens: 64, metadata: { user_id: "u" }, system: "be brief", messages: user },
			(_call, res) => reply(res, 200, claudeMessage)
		);
		expect(call.method).toBe("POST");
		expect(call.url).toBe(`${CLAUDE_PATH}/invoke`);
		expect(call.auth).toBe("signature ok");
		expect(call.headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
		expect(call.headers.accept).toBe("application/json");
		expect(call.body).toEqual({ anthropic_version: "bedrock-2023-05-31", max_tokens: 64, system: "be brief", messages: user });
		expect(out.status).toBe(200);
		expect(out.body).toMatchObject({
			type: "message",
			model: CLAUDE,
			content: [{ type: "text", text: "Hello from Bedrock" }],
			usage: { input_tokens: 12, output_tokens: 5 }
		});
		expect(await out.usage).toMatchObject({ input_tokens: 12, output_tokens: 5, reported: true, complete: true });
	});

	it("streams: event stream frames split anywhere become the Anthropic events, and the invocation metrics are not shown", async () => {
		const { out, call } = await run("anthropic", { model: CLAUDE, max_tokens: 64, stream: true, messages: user }, (_call, res) =>
			stream(res, claudeEvents.map(chunk), 7)
		);
		expect(call.url).toBe(`${CLAUDE_PATH}/invoke-with-response-stream`);
		expect(call.headers.accept).toBe("application/vnd.amazon.eventstream");
		expect(call.body.stream).toBeUndefined();
		expect(call.auth).toBe("signature ok");
		const events = await collect(out.stream);
		expect(events.map((entry) => entry.event)).toEqual(claudeEvents.map((entry) => entry.type));
		expect(textOf(events)).toBe("Hello Bedrock");
		expect(events.at(-1).data).toEqual({ type: "message_stop" });
		expect(events[0].data.message.model).toBe(CLAUDE);
		expect(await out.usage).toMatchObject({ input_tokens: 12, output_tokens: 5, complete: true });
	});

	it("an exception frame ends the stream with an Anthropic error event", async () => {
		const { out } = await run("anthropic", { model: CLAUDE, max_tokens: 64, stream: true, messages: user }, (_call, res) =>
			stream(res, [chunk(claudeEvents[0]), exception("throttlingException", "Too many requests")])
		);
		const events = await collect(out.stream);
		expect(events.at(-1)).toMatchObject({
			event: "error",
			data: { type: "error", error: { type: "rate_limit_error", message: "Too many requests" } }
		});
	});

	it("a corrupted frame fails the stream", async () => {
		const bad = Buffer.from(chunk(claudeEvents[0]));
		bad[bad.length - 6] ^= 0xff;
		const { out } = await run("anthropic", { model: CLAUDE, max_tokens: 64, stream: true, messages: user }, (_call, res) =>
			stream(res, [bad])
		);
		const events = await collect(out.stream);
		expect(events.at(-1)).toMatchObject({ event: "error", data: { error: { message: expect.stringMatching(/bad message checksum/) } } });
	});
});

describe("InvokeModel for Claude: OpenAI front", () => {
	it("converts the Chat Completions request to an Anthropic body and the reply back", async () => {
		const { out, call } = await run(
			"openai",
			{ model: CLAUDE, max_tokens: 64, messages: [{ role: "system", content: "be brief" }, ...user], tools: [chatTool] },
			(_call, res) =>
				reply(res, 200, {
					...claudeMessage,
					content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { path: "a" } }],
					stop_reason: "tool_use"
				})
		);
		expect(call.url).toBe(`${CLAUDE_PATH}/invoke`);
		expect(call.auth).toBe("signature ok");
		expect(call.body).toMatchObject({ anthropic_version: "bedrock-2023-05-31", system: "be brief", tools: [{ name: "Read" }] });
		expect(call.body.model).toBeUndefined();
		expect(out.body.choices[0]).toMatchObject({
			finish_reason: "tool_calls",
			message: { tool_calls: [{ id: "toolu_1", type: "function", function: { name: "Read", arguments: '{"path":"a"}' } }] }
		});
	});

	it("streams Chat Completions chunks from the decoded Anthropic events", async () => {
		const { out, call } = await run(
			"openai",
			{ model: CLAUDE, max_tokens: 64, stream: true, stream_options: { include_usage: true }, messages: user },
			(_call, res) => stream(res, claudeEvents.map(chunk))
		);
		expect(call.url).toBe(`${CLAUDE_PATH}/invoke-with-response-stream`);
		const data = (await collect(out.stream)).map((entry) => entry.data);
		expect(
			data
				.filter((entry) => entry !== "[DONE]" && entry.choices[0]?.delta?.content)
				.map((entry) => entry.choices[0].delta.content)
				.join("")
		).toBe("Hello Bedrock");
		expect(data.at(-1)).toBe("[DONE]");
		expect(data.find((entry) => entry.usage)).toMatchObject({ usage: { prompt_tokens: 12, completion_tokens: 5 } });
	});
});

describe("Converse: Anthropic front", () => {
	it("sends system, inferenceConfig and toolConfig to /converse and reads text, tool use and usage back", async () => {
		const { out, call } = await run(
			"anthropic",
			{
				model: NOVA,
				max_tokens: 100,
				temperature: 0.3,
				stop_sequences: ["END"],
				system: "be brief",
				tools: [tool],
				tool_choice: { type: "any" },
				metadata: { user_id: "u" },
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: "read it" },
							{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }
						]
					},
					{ role: "assistant", content: [{ type: "tool_use", id: "toolu_0", name: "Read", input: { path: "x" } }] },
					{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_0", content: "boom", is_error: true }] }
				]
			},
			(_call, res) =>
				reply(
					res,
					200,
					converseReply([{ text: "On it." }, { toolUse: { toolUseId: "tooluse_9", name: "Read", input: { path: "a.txt" } } }], "tool_use")
				)
		);
		expect(call.url).toBe(`${NOVA_PATH}/converse`);
		expect(call.auth).toBe("signature ok");
		expect(call.body.model).toBeUndefined();
		expect(call.body.stream).toBeUndefined();
		expect(call.body).toEqual({
			system: [{ text: "be brief" }],
			messages: [
				{ role: "user", content: [{ text: "read it" }, { image: { format: "png", source: { bytes: "iVBORw0KGgo=" } } }] },
				{ role: "assistant", content: [{ toolUse: { toolUseId: "toolu_0", name: "Read", input: { path: "x" } } }] },
				{ role: "user", content: [{ toolResult: { toolUseId: "toolu_0", content: [{ text: "boom" }], status: "error" } }] }
			],
			inferenceConfig: { maxTokens: 100, temperature: 0.3, stopSequences: ["END"] },
			toolConfig: {
				tools: [{ toolSpec: { name: "Read", description: "read a file", inputSchema: { json: tool.input_schema } } }],
				toolChoice: { any: {} }
			}
		});
		expect(out.body).toMatchObject({
			type: "message",
			model: NOVA,
			stop_reason: "tool_use",
			content: [
				{ type: "text", text: "On it." },
				{ type: "tool_use", id: "tooluse_9", name: "Read", input: { path: "a.txt" } }
			],
			usage: { input_tokens: 12, output_tokens: 5 }
		});
		expect(await out.usage).toMatchObject({ input_tokens: 12, output_tokens: 5, reported: true });
	});

	it("maps a thinking budget to the Claude field, and names the thinking it cannot map", async () => {
		const api = await apiFor("anthropic");
		const budget = await api.request({
			model: NOVA,
			max_tokens: 4096,
			thinking: { type: "enabled", budget_tokens: 2048 },
			top_k: 20,
			messages: user
		});
		expect(budget.body.additionalModelRequestFields).toEqual({ top_k: 20, thinking: { type: "enabled", budget_tokens: 2048 } });
		const adaptive = await api.request({ model: NOVA, max_tokens: 4096, thinking: { type: "adaptive" }, messages: user });
		expect(adaptive.state.convert.dropped).toContain("thinking");
		const off = await api.request({ model: NOVA, max_tokens: 4096, thinking: { type: "disabled" }, messages: user });
		expect(off.state.convert.dropped).not.toContain("thinking");
		const sampled = await api.request({ model: NOVA, max_tokens: 8, metadata: { sampling: { min_p: 0.1 } }, messages: user });
		expect(sampled.body.additionalModelRequestFields).toEqual({ min_p: 0.1 });
		const plain = await api.request({ model: NOVA, max_tokens: 8, metadata: { sampling: "nope" }, messages: user });
		expect(plain.body.additionalModelRequestFields).toBeUndefined();
	});

	it("streams text through ConverseStream frames", async () => {
		const { out, call } = await run("anthropic", { model: NOVA, max_tokens: 64, stream: true, messages: user }, (_call, res) =>
			stream(res, converseText)
		);
		expect(call.url).toBe(`${NOVA_PATH}/converse-stream`);
		expect(call.headers.accept).toBe("application/vnd.amazon.eventstream");
		expect(call.auth).toBe("signature ok");
		const events = await collect(out.stream);
		expect(events.map((entry) => entry.event)).toEqual([
			"message_start",
			"content_block_start",
			"content_block_delta",
			"content_block_delta",
			"content_block_stop",
			"message_delta",
			"message_stop"
		]);
		expect(textOf(events)).toBe("Hello Converse");
		expect(events.find((entry) => entry.event === "message_delta").data).toMatchObject({
			delta: { stop_reason: "end_turn" },
			usage: { output_tokens: 5 }
		});
		expect(await out.usage).toMatchObject({ input_tokens: 12, output_tokens: 5, complete: true });
	});

	it("streams reasoning and a tool call", async () => {
		const { out } = await run("anthropic", { model: NOVA, max_tokens: 64, stream: true, tools: [tool], messages: user }, (_call, res) =>
			stream(res, converseTool)
		);
		const events = await collect(out.stream);
		const thinking = events.filter((entry) => entry.event === "content_block_delta" && entry.data.delta.type === "thinking_delta");
		expect(thinking.map((entry) => entry.data.delta.thinking).join("")).toBe("Let me look.");
		const json = events
			.filter((entry) => entry.data.delta?.type === "input_json_delta")
			.map((entry) => entry.data.delta.partial_json)
			.join("");
		expect(JSON.parse(json)).toEqual({ path: "a.txt" });
		expect(
			events.find((entry) => entry.event === "content_block_start" && entry.data.content_block.type === "tool_use").data.content_block
		).toMatchObject({
			id: "tooluse_1",
			name: "Read"
		});
		expect(events.find((entry) => entry.event === "message_delta").data.delta.stop_reason).toBe("tool_use");
		expect(await out.usage).toMatchObject({ output_tokens: 9, cache_read_input_tokens: 8 });
	});

	it("an exception frame and a stream cut before messageStop each end with an error event", async () => {
		const failed = await run("anthropic", { model: NOVA, max_tokens: 64, stream: true, messages: user }, (_call, res) =>
			stream(res, [converseText[0], converseText[1], exception("validationException", "Malformed input request")])
		);
		expect((await collect(failed.out.stream)).at(-1)).toMatchObject({
			event: "error",
			data: { error: { type: "invalid_request_error", message: "Malformed input request" } }
		});
		const cut = await run("anthropic", { model: NOVA, max_tokens: 64, stream: true, messages: user }, (_call, res) =>
			stream(res, converseText.slice(0, 3))
		);
		expect((await collect(cut.out.stream)).at(-1)).toMatchObject({
			event: "error",
			data: { error: { message: "Upstream stream ended before completion" } }
		});
	});
});

describe("Converse: OpenAI front", () => {
	it("converts the request and the reply", async () => {
		const { out, call } = await run(
			"openai",
			{
				model: NOVA,
				max_completion_tokens: 50,
				top_p: 0.8,
				response_format: { type: "json_object" },
				messages: [{ role: "system", content: "be brief" }, ...user],
				tools: [chatTool],
				tool_choice: { type: "function", function: { name: "Read" } }
			},
			(_call, res) => reply(res, 200, converseReply([{ reasoningContent: { reasoningText: { text: "hmm" } } }, { text: "Hi there" }]))
		);
		expect(call.url).toBe(`${NOVA_PATH}/converse`);
		expect(call.auth).toBe("signature ok");
		expect(call.body).toMatchObject({
			system: [{ text: "be brief" }],
			messages: [{ role: "user", content: [{ text: "hi" }] }],
			inferenceConfig: { maxTokens: 50, topP: 0.8 },
			toolConfig: { toolChoice: { tool: { name: "Read" } } }
		});
		expect(call.body.response_format).toBeUndefined();
		expect(out.body).toMatchObject({
			object: "chat.completion",
			model: NOVA,
			choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Hi there", reasoning: "hmm" } }],
			usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 }
		});
		expect(await out.usage).toMatchObject({ input_tokens: 12, output_tokens: 5, reported: true });
	});

	it("streams chunks with one id, tool calls in pieces and, when asked, the usage chunk", async () => {
		const { out } = await run(
			"openai",
			{ model: NOVA, stream: true, stream_options: { include_usage: true }, tools: [chatTool], messages: user },
			(_call, res) => stream(res, converseTool, 9)
		);
		const data = (await collect(out.stream)).map((entry) => entry.data);
		expect(data.at(-1)).toBe("[DONE]");
		const chunks = data.slice(0, -1);
		expect(new Set(chunks.map((entry) => entry.id)).size).toBe(1);
		const calls = chunks.flatMap((entry) => entry.choices[0]?.delta?.tool_calls ?? []);
		expect(calls[0]).toMatchObject({ index: 0, id: "tooluse_1", function: { name: "Read" } });
		expect(calls.map((entry) => entry.function.arguments).join("")).toBe('{"path":"a.txt"}');
		expect(chunks.flatMap((entry) => entry.choices[0]?.delta?.reasoning ?? []).join("")).toBe("Let me look.");
		expect(chunks.find((entry) => entry.choices[0]?.finish_reason)?.choices[0].finish_reason).toBe("tool_calls");
		expect(chunks.at(-1)).toMatchObject({
			choices: [],
			usage: { prompt_tokens: 28, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 8 } }
		});
		const quiet = await run("openai", { model: NOVA, stream: true, messages: user }, (_call, res) => stream(res, converseText));
		const plain = (await collect(quiet.out.stream)).map((entry) => entry.data);
		expect(plain.some((entry) => entry !== "[DONE]" && entry.usage)).toBe(false);
		expect(await quiet.out.usage).toMatchObject({ input_tokens: 12, output_tokens: 5 });
	});

	it("an exception frame ends the stream with an error chunk", async () => {
		const { out } = await run("openai", { model: NOVA, stream: true, messages: user }, (_call, res) =>
			stream(res, [converseText[0], exception("throttlingException", "Too many requests")])
		);
		const data = (await collect(out.stream)).map((entry) => entry.data);
		expect(data.at(-2)).toMatchObject({ error: { message: "Too many requests", type: "rate_limit_error" } });
		expect(data.at(-1)).toBe("[DONE]");
	});

	it("a message-less reply is a bad upstream reply", async () => {
		const { out } = await run("openai", { model: NOVA, messages: user }, (_call, res) =>
			reply(res, 200, { output: {}, stopReason: "end_turn" })
		);
		expect(out.status).toBe(502);
		expect(out.body.error.message).toMatch(/no message/);
	});
});

describe("errors", () => {
	it("an HTTP error comes back in the client's shape", async () => {
		const throttled = await run("anthropic", { model: CLAUDE, max_tokens: 8, messages: user }, (_call, res) =>
			reply(res, 429, { message: "Too many requests, please wait before trying again." })
		);
		expect(throttled.out.status).toBe(429);
		expect(throttled.out.body).toMatchObject({
			type: "error",
			error: { type: "rate_limit_error", message: "Too many requests, please wait before trying again." }
		});
		const denied = await run("openai", { model: NOVA, messages: user }, (_call, res) =>
			reply(res, 403, { message: "The security token included in the request is invalid." })
		);
		expect(denied.out.status).toBe(403);
		expect(denied.out.body.error).toMatchObject({
			message: "The security token included in the request is invalid.",
			type: "permission_denied_error"
		});
	});

	it("a call without any credential fails before it is sent", async () => {
		const api = await make({ upstreams: [{ url: aws.url, backend: "bedrock", region: "us-east-1" }], detect: false });
		aws.use((_call, res) => reply(res, 200, claudeMessage));
		const out = await api.send({ model: CLAUDE, max_tokens: 8, messages: user });
		expect(out.status).toBe(500);
		expect(out.body.error.message).toMatch(/no AWS credentials/);
		expect(aws.seen).toEqual([]);
	});

	it("a SigV4 call without a region fails before it is sent", async () => {
		const api = await make({ upstreams: [{ url: aws.url, backend: "bedrock", ...keys }], detect: false });
		aws.use((_call, res) => reply(res, 200, claudeMessage));
		const out = await api.send({ model: CLAUDE, max_tokens: 8, messages: user });
		expect(out.body.error.message).toMatch(/no AWS region/);
		expect(aws.seen).toEqual([]);
	});

	it("the driver has no embeddings", async () => {
		const api = await apiFor("openai");
		expect(() => api.driver.bedrock.path("embeddings", { model: "x" })).toThrow(/no embeddings call/);
	});
});

describe("authentication", () => {
	const ok = (_call, res) => reply(res, 200, claudeMessage);
	const body = { model: CLAUDE, max_tokens: 8, messages: user };

	it("a Bedrock API key in the apiKey setting is a bearer token, with no signature", async () => {
		const { call } = await run(
			"anthropic",
			body,
			ok,
			{ apiKey: "bedrock-api-key-1", accessKeyId: undefined, secretAccessKey: undefined },
			"key"
		);
		expect(call.auth).toBe("Bearer bedrock-api-key-1");
		expect(call.headers["x-amz-date"]).toBeUndefined();
	});

	it("AWS_BEARER_TOKEN_BEDROCK is used when the upstream sets no credential", async () => {
		process.env.AWS_BEARER_TOKEN_BEDROCK = "env-token";
		const api = await make({ upstreams: [{ url: aws.url, backend: "bedrock" }], detect: false });
		aws.use(ok);
		await api.send(body);
		expect(aws.seen[0].auth).toBe("Bearer env-token");
	});

	it("access keys and the region come from the AWS_* variables, a session token is signed and sent", async () => {
		Object.assign(process.env, {
			...{ AWS_ACCESS_KEY_ID: keys.accessKeyId, AWS_SECRET_ACCESS_KEY: keys.secretAccessKey },
			AWS_SESSION_TOKEN: "session-1",
			AWS_REGION: "us-east-1"
		});
		const api = await make({ upstreams: [{ url: aws.url, backend: "bedrock" }], detect: false });
		aws.use(ok);
		await api.send(body);
		expect(aws.seen[0].auth).toBe("signature ok");
		expect(aws.seen[0].headers["x-amz-security-token"]).toBe("session-1");
	});

	it("a sessionToken setting is signed and sent too", async () => {
		const api = await make({
			upstreams: [{ url: aws.url, backend: "bedrock", region: "us-east-1", ...keys, sessionToken: "session-2" }],
			detect: false
		});
		aws.use(ok);
		await api.send(body);
		expect(aws.seen[0].auth).toBe("signature ok");
		expect(aws.seen[0].headers["x-amz-security-token"]).toBe("session-2");
	});
});

describe("model list and token counts", () => {
	it("lists the foundation models of the region from the control plane, signed, text models only", async () => {
		const api = await apiFor("openai");
		aws.use((_call, res) =>
			reply(res, 200, {
				modelSummaries: [
					{ modelId: CLAUDE, providerName: "Anthropic", outputModalities: ["TEXT"] },
					{ modelId: NOVA, outputModalities: ["TEXT", "IMAGE"] },
					{ modelId: "amazon.titan-image-generator-v2:0", providerName: "Amazon", outputModalities: ["IMAGE"] },
					{ modelId: "legacy-model" },
					{ providerName: "nameless" }
				]
			})
		);
		const out = await api.model.list();
		expect(aws.seen[0]).toMatchObject({ method: "GET", url: "/foundation-models", auth: "signature ok" });
		expect(out.data.map((entry) => [entry.id, entry.owned_by])).toEqual([
			[CLAUDE, "Anthropic"],
			[NOVA, "bedrock"],
			["legacy-model", "bedrock"]
		]);
	});

	it("asks the bedrock host, not the runtime host, and falls back to the configured models when it cannot", async () => {
		const transport = fakeTransport(() => ({ body: { modelSummaries: [{ modelId: NOVA }] } }));
		const api = await make({
			front: "openai",
			upstreams: [{ url: "https://bedrock-runtime.us-east-1.amazonaws.com", ...keys, models: ["configured"] }],
			transport
		});
		const out = await api.model.list();
		expect(transport.calls[0].url).toBe("https://bedrock.us-east-1.amazonaws.com/foundation-models");
		expect(out.data.map((entry) => entry.id)).toEqual([NOVA]);
		const failing = fakeTransport(() => ({ status: 403, body: { message: "denied" } }));
		const failed = await make({
			front: "openai",
			upstreams: [{ url: "https://bedrock-runtime.us-east-1.amazonaws.com", ...keys, models: ["configured"] }],
			transport: failing
		});
		expect((await failed.model.list()).data.map((entry) => entry.id)).toEqual(["configured"]);
		const noKey = await make({
			front: "openai",
			upstreams: [{ url: "https://bedrock-runtime.us-east-1.amazonaws.com", models: ["configured"] }],
			transport
		});
		expect((await noKey.model.list()).data.map((entry) => entry.id)).toEqual(["configured"]);
		const noList = await make({
			front: "openai",
			upstreams: [{ url: "https://bedrock-runtime.us-east-1.amazonaws.com", ...keys, models: ["configured"] }],
			transport: fakeTransport(() => ({ body: { nope: 1 } }))
		});
		expect((await noList.model.list()).data.map((entry) => entry.id)).toEqual(["configured"]);
		const unparsable = await make({
			front: "openai",
			upstreams: [{ url: "not a url", backend: "bedrock", ...keys, models: ["configured"] }],
			detect: false
		});
		expect((await unparsable.model.list()).data.map((entry) => entry.id)).toEqual(["configured"]);
	});

	it("estimates token counts when Bedrock does not count them", async () => {
		const api = await apiFor("anthropic");
		aws.use((_call, res) => reply(res, 500, { message: "no" }));
		const count = await api.token.count({ model: CLAUDE, max_tokens: 8, messages: [{ role: "user", content: "x".repeat(400) }] });
		expect(count.input_tokens).toBeGreaterThan(90);
	});
});

describe("driver leaves", () => {
	it("request(): InvokeModel gets the version, Converse does not, and neither keeps Anthropic API fields", async () => {
		const api = await apiFor("anthropic");
		const { request } = api.driver.bedrock;
		const input = { model: "m", stream: true, metadata: {}, service_tier: "auto", container: "c", mcp_servers: [], max_tokens: 1 };
		expect(request(input, { protocol: "anthropic.messages" })).toEqual({ anthropic_version: "bedrock-2023-05-31", max_tokens: 1 });
		expect(request(input, { protocol: "bedrock.converse" })).toEqual({ max_tokens: 1 });
		expect(request(input)).toEqual({ max_tokens: 1 });
	});

	it("path(): the operation follows the protocol and the stream flag, and the model id is encoded", async () => {
		const api = await apiFor("anthropic");
		const { path } = api.driver.bedrock;
		expect(path("messages", { model: CLAUDE })).toBe(`${CLAUDE_PATH}/invoke`);
		expect(path("messages", { model: CLAUDE, stream: true })).toBe(`${CLAUDE_PATH}/invoke-with-response-stream`);
		expect(path("converse", { model: NOVA })).toBe(`${NOVA_PATH}/converse`);
		expect(path("converse", { model: NOVA, stream: true })).toBe(`${NOVA_PATH}/converse-stream`);
		const arn = "arn:aws:bedrock:us-east-1:1:inference-profile/us.amazon.nova-pro-v1:0";
		expect(path("converse", { model: arn })).toBe(
			"/model/arn%3Aaws%3Abedrock%3Aus-east-1%3A1%3Ainference-profile%2Fus.amazon.nova-pro-v1%3A0/converse"
		);
	});
});
