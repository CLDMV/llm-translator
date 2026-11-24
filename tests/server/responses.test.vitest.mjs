/**
 * @fileoverview The Responses API front (`POST /v1/responses`, `POST /v1/responses/input_tokens`) against vLLM-like, Anthropic and Ollama upstreams.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, fakeTransport, make } from "../helpers/translator.mjs";
import { completion, fakeVllm, json, sse, textChunks } from "../helpers/fake-server.mjs";
import { anthropicSse } from "../helpers/streams.mjs";
import { unpack } from "../../src/lib/responses.mjs";

afterEach(closeAll);

const post = (url, body, headers = {}, signal) =>
	fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frames = (text) =>
	text
		.split("\n\n")
		.filter(Boolean)
		.map((block) => {
			const out = {};
			for (const line of block.split("\n")) {
				if (line.startsWith(":")) out.comment = line.slice(2);
				else if (line.startsWith("event: ")) out.event = line.slice(7);
				else if (line.startsWith("data: ")) out.data = JSON.parse(line.slice(6));
			}
			return out;
		});
const events = (list) => list.filter((frame) => frame.event).map((frame) => frame.event);
const chat = (upstream) => upstream.requests.filter((entry) => entry.url === "/v1/chat/completions").at(-1).body;
const hello = { model: "qwen3-coder", input: "hi" };
const toolCall = (id, name, args) => ({ id, type: "function", function: { name, arguments: args } });
const weather = {
	type: "function",
	name: "weather",
	description: "get it",
	parameters: { type: "object", properties: { city: { type: "string" } } }
};

describe("responses front, vLLM-like upstream", () => {
	it("answers a non-streaming request and sends the converted chat body", async () => {
		const upstream = await fakeVllm();
		try {
			const api = await make({ front: "openai", upstreams: [upstream.url] });
			const server = await api.server.start({ port: 0 });
			const reply = await post(`${server.url}/v1/responses`, {
				...hello,
				instructions: "be brief",
				max_output_tokens: 50,
				temperature: 0.5,
				reasoning: { effort: "low" },
				text: { format: { type: "json_schema", name: "out", schema: { type: "object" }, strict: true } },
				tools: [weather],
				tool_choice: { type: "function", name: "weather" },
				parallel_tool_calls: false,
				metadata: { a: "b" }
			});
			expect(reply.status).toBe(200);
			const body = await reply.json();
			expect(body).toMatchObject({
				object: "response",
				status: "completed",
				model: "qwen3-coder",
				instructions: "be brief",
				max_output_tokens: 50,
				store: true,
				previous_response_id: null,
				reasoning: { effort: "low" },
				tool_choice: { type: "function", name: "weather" },
				parallel_tool_calls: false,
				output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello world" }] }]
			});
			expect(body.usage).toMatchObject({ input_tokens: expect.any(Number), output_tokens: expect.any(Number) });
			const sent = chat(upstream);
			expect(sent).toMatchObject({
				model: "qwen3-coder",
				messages: [
					{ role: "system", content: "be brief" },
					{ role: "user", content: "hi" }
				],
				max_completion_tokens: 50,
				temperature: 0.5,
				reasoning_effort: "low",
				response_format: { type: "json_schema", json_schema: { name: "out", strict: true, schema: { type: "object" } } },
				tools: [{ type: "function", function: { name: "weather", description: "get it" } }],
				tool_choice: { type: "function", function: { name: "weather" } },
				parallel_tool_calls: false
			});
			expect(sent.stream).toBeUndefined();
		} finally {
			await upstream.close();
		}
	});

	it("streams the semantic events with no [DONE], reasoning first", async () => {
		const upstream = await fakeVllm({ chat: (_req, _body, res) => sse(res, textChunks(["Hi", "!"], { reasoning: ["hm"] })) });
		try {
			const api = await make({ front: "openai", upstreams: [upstream.url] });
			const server = await api.server.start({ port: 0 });
			const reply = await post(`${server.url}/v1/responses`, { ...hello, stream: true });
			expect(reply.status).toBe(200);
			expect(reply.headers.get("content-type")).toMatch(/^text\/event-stream/);
			const text = await reply.text();
			expect(text).not.toContain("[DONE]");
			const out = frames(text);
			expect(events(out)).toEqual([
				"response.created",
				"response.in_progress",
				"response.output_item.added",
				"response.reasoning_summary_part.added",
				"response.reasoning_summary_text.delta",
				"response.reasoning_summary_text.done",
				"response.reasoning_summary_part.done",
				"response.output_item.done",
				"response.output_item.added",
				"response.content_part.added",
				"response.output_text.delta",
				"response.output_text.delta",
				"response.output_text.done",
				"response.content_part.done",
				"response.output_item.done",
				"response.completed"
			]);
			expect(out.at(-1).data.response).toMatchObject({ status: "completed", model: "qwen3-coder", usage: { input_tokens: 12 } });
			expect(chat(upstream)).toMatchObject({ stream: true, stream_options: { include_usage: true } });
		} finally {
			await upstream.close();
		}
	});

	it("sends keep-alive comments while the upstream is silent, then streams its events", async () => {
		const upstream = await fakeVllm({ chat: (_req, _body, res) => sse(res, textChunks(["late"]), { stallFirst: 150 }) });
		try {
			const api = await make({ front: "openai", upstreams: [upstream.url], settings: { pingInterval: 30 } });
			const server = await api.server.start({ port: 0 });
			const out = frames(await (await post(`${server.url}/v1/responses`, { ...hello, stream: true })).text());
			expect(out.filter((frame) => frame.comment === "ping").length).toBeGreaterThanOrEqual(2);
			expect(events(out).at(-1)).toBe("response.completed");
			expect(events(out)).toContain("response.output_text.delta");
		} finally {
			await upstream.close();
		}
	});

	it("ends a stalled stream with an error event when the upstream then fails", async () => {
		const upstream = await fakeVllm({
			chat: async (_req, _body, res) => {
				await pause(120);
				json(res, 400, { error: { message: "bad model", type: "BadRequestError", code: 400 } });
			}
		});
		try {
			const api = await make({ front: "openai", upstreams: [upstream.url], settings: { pingInterval: 30 } });
			const server = await api.server.start({ port: 0 });
			const text = await (await post(`${server.url}/v1/responses`, { ...hello, stream: true })).text();
			expect(text).not.toContain("[DONE]");
			const out = frames(text);
			expect(out.at(-1)).toMatchObject({ event: "error", data: { type: "error", message: "bad model" } });
		} finally {
			await upstream.close();
		}
	});

	it("writes an error event when a stream breaks, and keeps the status 200", async () => {
		const upstream = await fakeVllm({
			chat: (_req, _body, res) => {
				res.writeHead(200, { "content-type": "text/event-stream" });
				res.write(`data: ${JSON.stringify(textChunks(["a"])[0])}\n\n`);
				res.write("data: {broken\n\n");
				res.end();
			}
		});
		try {
			const api = await make({ front: "openai", upstreams: [upstream.url] });
			const server = await api.server.start({ port: 0 });
			const reply = await post(`${server.url}/v1/responses`, { ...hello, stream: true });
			expect(reply.status).toBe(200);
			const out = frames(await reply.text());
			expect(out.at(-1)).toMatchObject({
				event: "response.failed",
				data: { response: { status: "failed", error: { code: "invalid_stream_data" } } }
			});
			expect(JSON.stringify(out)).not.toContain("[DONE]");
		} finally {
			await upstream.close();
		}
	});

	it("round-trips a tool call: function_call out, function_call_output back in", async () => {
		const upstream = await fakeVllm({
			chat: (_req, body, res) => {
				if (JSON.stringify(body).includes("image_url")) return json(res, 200, completion("ok"));
				if (!body.messages.some((entry) => entry.role === "tool")) {
					return json(res, 200, {
						id: "c",
						object: "chat.completion",
						created: 1,
						model: "qwen3-coder",
						choices: [
							{
								index: 0,
								message: { role: "assistant", content: null, tool_calls: [toolCall("call_1", "weather", '{"city":"Oslo"}')] },
								finish_reason: "tool_calls"
							}
						],
						usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 }
					});
				}
				return json(res, 200, completion("Rainy."));
			}
		});
		try {
			const api = await make({ front: "openai", upstreams: [upstream.url] });
			const server = await api.server.start({ port: 0 });
			const first = await (await post(`${server.url}/v1/responses`, { ...hello, tools: [weather] })).json();
			expect(first.output).toEqual([
				{
					type: "function_call",
					id: expect.stringMatching(/^fc_/),
					call_id: "call_1",
					name: "weather",
					arguments: '{"city":"Oslo"}',
					status: "completed"
				}
			]);
			const second = await (
				await post(`${server.url}/v1/responses`, {
					...hello,
					tools: [weather],
					input: [{ role: "user", content: "hi" }, ...first.output, { type: "function_call_output", call_id: "call_1", output: "rain" }]
				})
			).json();
			expect(second.output[0].content[0].text).toBe("Rainy.");
			expect(chat(upstream).messages).toEqual([
				{ role: "user", content: "hi" },
				{ role: "assistant", content: null, tool_calls: [toolCall("call_1", "weather", '{"city":"Oslo"}')] },
				{ role: "tool", tool_call_id: "call_1", content: "rain" }
			]);
		} finally {
			await upstream.close();
		}
	});

	it("streams a tool call as function_call_arguments events", async () => {
		const base = { id: "c", object: "chat.completion.chunk", created: 1, model: "qwen3-coder" };
		const frame = (delta, finish = null) => ({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] });
		const upstream = await fakeVllm({
			chat: (_req, _body, res) =>
				sse(res, [
					frame({ role: "assistant", content: "" }),
					frame({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "weather", arguments: "" } }] }),
					frame({ tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] }),
					frame({ tool_calls: [{ index: 0, function: { arguments: '"Oslo"}' } }] }),
					frame({}, "tool_calls"),
					{ ...base, choices: [], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } },
					"[DONE]"
				])
		});
		try {
			const api = await make({ front: "openai", upstreams: [upstream.url] });
			const server = await api.server.start({ port: 0 });
			const out = frames(await (await post(`${server.url}/v1/responses`, { ...hello, tools: [weather], stream: true })).text());
			const deltas = out.filter((frame) => frame.event === "response.function_call_arguments.delta").map((frame) => frame.data.delta);
			expect(deltas).toEqual(['{"city":', '"Oslo"}']);
			expect(out.at(-1).data.response.output[0]).toMatchObject({
				type: "function_call",
				call_id: "call_1",
				name: "weather",
				arguments: '{"city":"Oslo"}'
			});
		} finally {
			await upstream.close();
		}
	});

	it("reports a length stop as incomplete", async () => {
		const upstream = await fakeVllm({
			chat: (_req, _body, res) =>
				json(res, 200, {
					...completion("cut"),
					choices: [{ index: 0, message: { role: "assistant", content: "cut" }, finish_reason: "length" }]
				})
		});
		try {
			const api = await make({ front: "openai", upstreams: [upstream.url] });
			const server = await api.server.start({ port: 0 });
			const body = await (await post(`${server.url}/v1/responses`, hello)).json();
			expect(body).toMatchObject({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } });
		} finally {
			await upstream.close();
		}
	});

	it("passes the upstream's error through in the OpenAI error format", async () => {
		const upstream = await fakeVllm({
			chat: (_req, _body, res) => json(res, 400, { error: { message: "nope", type: "BadRequestError", code: 400, param: null } })
		});
		try {
			const api = await make({ front: "openai", upstreams: [upstream.url] });
			const server = await api.server.start({ port: 0 });
			const reply = await post(`${server.url}/v1/responses`, hello);
			expect(reply.status).toBe(400);
			expect((await reply.json()).error).toMatchObject({ message: "nope" });
		} finally {
			await upstream.close();
		}
	});

	it("refuses stateful parameters when the responses setting is null, as the stateless core always did", async () => {
		const upstream = await fakeVllm();
		try {
			const api = await make({ front: "openai", upstreams: [upstream.url], settings: { responses: null } });
			const server = await api.server.start({ port: 0 });
			const cases = [
				[{ ...hello, previous_response_id: "resp_1" }, "unsupported_field", "previous_response_id"],
				[{ ...hello, store: true }, "unsupported_field", "store"],
				[{ ...hello, conversation: "conv_1" }, "unsupported_field", "conversation"],
				[{ ...hello, background: true }, "unsupported_field", "background"]
			];
			for (const [body, code, param] of cases) {
				const reply = await post(`${server.url}/v1/responses`, body);
				expect(reply.status).toBe(400);
				expect((await reply.json()).error).toEqual({ message: expect.any(String), type: "invalid_request_error", param, code });
			}
			const text = await post(`${server.url}/v1/responses`, { ...hello, stream: true, store: true });
			expect(text.status).toBe(400);
			const plain = await (await post(`${server.url}/v1/responses`, hello)).json();
			expect(plain).toMatchObject({ store: false, previous_response_id: null });
			expect(plain).not.toHaveProperty("conversation");
			expect((await fetch(`${server.url}/v1/responses/${plain.id}`)).status).toBe(404);
		} finally {
			await upstream.close();
		}
	});

	it("refuses hosted tools and unsupported items in the Responses error format", async () => {
		const upstream = await fakeVllm();
		try {
			const api = await make({ front: "openai", upstreams: [upstream.url] });
			const server = await api.server.start({ port: 0 });
			const cases = [
				[{ ...hello, tools: [{ type: "web_search" }] }, "unsupported_tool", "tools[0]"],
				[{ ...hello, input: [{ type: "item_reference", id: "msg_1" }] }, "unsupported_content", "input[0]"],
				[{ model: "qwen3-coder" }, "invalid_request", "input"]
			];
			for (const [body, code, param] of cases) {
				const reply = await post(`${server.url}/v1/responses`, body);
				expect(reply.status).toBe(400);
				expect((await reply.json()).error).toEqual({ message: expect.any(String), type: "invalid_request_error", param, code });
			}
			expect(
				upstream.requests.filter((entry) => entry.url === "/v1/chat/completions" && !JSON.stringify(entry.body).includes("image_url"))
			).toHaveLength(0);
		} finally {
			await upstream.close();
		}
	});

	it("drops unmapped parameters and reports them as a dropped event", async () => {
		const upstream = await fakeVllm();
		const seen = [];
		try {
			const api = await make({
				front: "openai",
				upstreams: [upstream.url],
				events: true,
				onEvent: (event) => event.type === "dropped" && seen.push(event)
			});
			const server = await api.server.start({ port: 0 });
			const reply = await post(`${server.url}/v1/responses`, { ...hello, top_logprobs: 2 });
			expect(reply.status).toBe(200);
			expect(seen.at(-1)).toMatchObject({ fields: ["top_logprobs"] });
			expect(chat(upstream)).not.toHaveProperty("top_logprobs");
		} finally {
			await upstream.close();
		}
	});

	it("counts input tokens", async () => {
		const upstream = await fakeVllm();
		try {
			const api = await make({ front: "openai", upstreams: [upstream.url] });
			const server = await api.server.start({ port: 0 });
			const reply = await post(`${server.url}/v1/responses/input_tokens`, { ...hello, instructions: "x", tools: [weather] });
			expect(reply.status).toBe(200);
			expect(await reply.json()).toEqual({ object: "response.input_tokens", input_tokens: 42 });
			const bad = await post(`${server.url}/v1/responses/input_tokens`, { ...hello, previous_response_id: "r" });
			expect(bad.status).toBe(400);
			// A body that cannot be routed is refused by the converter, with the global settings standing in.
			const array = await post(`${server.url}/v1/responses`, []);
			expect(array.status).toBe(400);
			expect((await array.json()).error.code).toBe("invalid_request");
		} finally {
			await upstream.close();
		}
	});

	it("applies apiKey, authorize and onUsage like the other routes, and exists only on the openai front", async () => {
		const upstream = await fakeVllm();
		try {
			const api = await make({ front: "openai", upstreams: [upstream.url] });
			const seen = [];
			const usage = [];
			const server = await api.server.start({
				port: 0,
				apiKey: "k",
				authorize: (request) => {
					seen.push(request.body);
					return request.body.model === "qwen3-coder";
				},
				onUsage: (report) => usage.push(report)
			});
			expect((await post(`${server.url}/v1/responses`, hello)).status).toBe(401);
			const ok = await post(`${server.url}/v1/responses`, hello, { authorization: "Bearer k" });
			expect(ok.status).toBe(200);
			expect(seen.at(-1)).toMatchObject({ input: "hi" });
			expect(usage.at(-1)).toMatchObject({ front: "openai", complete: true });
			expect((await post(`${server.url}/v1/responses`, { ...hello, model: "other" }, { authorization: "Bearer k" })).status).toBe(401);
			const anthropic = await api.server.start({ port: 0, front: "anthropic" });
			expect((await post(`${anthropic.url}/v1/responses`, hello)).status).toBe(404);
			expect((await post(`${anthropic.url}/v1/responses/input_tokens`, hello)).status).toBe(404);
		} finally {
			await upstream.close();
		}
	});

	it("aborts the upstream request when the client leaves", async () => {
		let closed;
		const gone = new Promise((resolve) => (closed = resolve));
		const upstream = await fakeVllm({
			chat: (_req, _body, res) => {
				res.on("close", closed);
			}
		});
		try {
			const api = await make({ front: "openai", upstreams: [upstream.url] });
			const server = await api.server.start({ port: 0 });
			const controller = new AbortController();
			const pending = post(`${server.url}/v1/responses`, hello, {}, controller.signal).catch((error) => error);
			await pause(100);
			controller.abort();
			await pending;
			await gone;
		} finally {
			await upstream.close();
		}
	});
});

const claude = { url: "https://api.anthropic.com", backend: "anthropic" };
const message = (content, extra = {}) => ({
	id: "msg_01",
	type: "message",
	role: "assistant",
	model: "claude-x",
	content,
	stop_reason: "end_turn",
	stop_sequence: null,
	usage: { input_tokens: 10, output_tokens: 5 },
	...extra
});
const anthropicApi = async (handler, settings = {}) => {
	const transport = fakeTransport((url, init) => handler(JSON.parse(init.body ?? "null"), url, init));
	const api = await make({ front: "openai", upstreams: [claude], detect: false, transport, settings });
	return { api, transport, server: await api.server.start({ port: 0 }) };
};
const sent = (transport) => JSON.parse(transport.calls.at(-1).init.body);

describe("responses front, Anthropic upstream", () => {
	it("converts a request to Messages and the reply back", async () => {
		const { transport, server } = await anthropicApi(() => ({ body: message([{ type: "text", text: "Bonjour" }]) }));
		const reply = await post(`${server.url}/v1/responses`, {
			model: "claude-x",
			instructions: "speak french",
			input: [
				{
					role: "user",
					content: [
						{ type: "input_text", text: "hi" },
						{ type: "input_image", image_url: "data:image/png;base64,AAAA" }
					]
				}
			],
			max_output_tokens: 100,
			reasoning: { effort: "medium" },
			text: { format: { type: "json_schema", name: "o", schema: { type: "object" } } },
			tools: [weather],
			tool_choice: "required",
			parallel_tool_calls: false
		});
		expect(reply.status).toBe(200);
		const body = await reply.json();
		expect(body).toMatchObject({
			status: "completed",
			model: "claude-x",
			output: [{ type: "message", content: [{ type: "output_text", text: "Bonjour" }] }],
			usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
		});
		expect(sent(transport)).toMatchObject({
			model: "claude-x",
			max_tokens: 100,
			system: "speak french",
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "hi" },
						{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }
					]
				}
			],
			tools: [{ name: "weather", description: "get it", input_schema: { type: "object", properties: { city: { type: "string" } } } }],
			tool_choice: { type: "any", disable_parallel_tool_use: true },
			thinking: { type: "adaptive" },
			output_config: { effort: "medium", format: { type: "json_schema", schema: { type: "object" } } }
		});
	});

	it("returns tool_use as function_call, and takes the function_call_output back as tool_result", async () => {
		let turn = 0;
		const { transport, server } = await anthropicApi(() => {
			turn++;
			return turn === 1
				? { body: message([{ type: "tool_use", id: "toolu_1", name: "weather", input: { city: "Oslo" } }], { stop_reason: "tool_use" }) }
				: { body: message([{ type: "text", text: "Rainy" }]) };
		});
		const first = await (await post(`${server.url}/v1/responses`, { model: "claude-x", input: "weather?", tools: [weather] })).json();
		expect(first.output).toEqual([
			{
				type: "function_call",
				id: expect.any(String),
				call_id: "toolu_1",
				name: "weather",
				arguments: '{"city":"Oslo"}',
				status: "completed"
			}
		]);
		const second = await (
			await post(`${server.url}/v1/responses`, {
				model: "claude-x",
				tools: [weather],
				input: [
					{ role: "user", content: "weather?" },
					...first.output,
					{ type: "function_call_output", call_id: "toolu_1", output: "rain" }
				]
			})
		).json();
		expect(second.output[0].content[0].text).toBe("Rainy");
		expect(sent(transport).messages).toEqual([
			{ role: "user", content: [{ type: "text", text: "weather?" }] },
			{ role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "weather", input: { city: "Oslo" } }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "rain" }] }
		]);
	});

	it("round-trips a thinking block through a reasoning item's encrypted_content", async () => {
		let turn = 0;
		const { transport, server } = await anthropicApi(
			() => {
				turn++;
				return turn === 1
					? {
							body: message(
								[
									{ type: "thinking", thinking: "pondering", signature: "sig-1" },
									{ type: "tool_use", id: "toolu_1", name: "weather", input: {} }
								],
								{ stop_reason: "tool_use" }
							)
						}
					: { body: message([{ type: "text", text: "done" }]) };
			},
			{ reasoningRoundTrip: true }
		);
		const first = await (
			await post(`${server.url}/v1/responses`, { model: "claude-x", input: "go", tools: [weather], reasoning: { effort: "high" } })
		).json();
		expect(first.output.map((item) => item.type)).toEqual(["reasoning", "function_call"]);
		expect(first.output[0].summary).toEqual([{ type: "summary_text", text: "pondering" }]);
		expect(unpack(first.output[0].encrypted_content)).toHaveLength(1);
		await post(`${server.url}/v1/responses`, {
			model: "claude-x",
			tools: [weather],
			reasoning: { effort: "high" },
			input: [{ role: "user", content: "go" }, ...first.output, { type: "function_call_output", call_id: "toolu_1", output: "ok" }]
		});
		expect(sent(transport).messages[1].content[0]).toEqual({ type: "thinking", thinking: "pondering", signature: "sig-1" });
	});

	it("streams Anthropic events as Responses events, with reasoning, text and a tool call", async () => {
		const { server } = await anthropicApi(
			() =>
				new Response(
					anthropicSse([
						{
							data: {
								type: "message_start",
								message: {
									id: "msg_1",
									type: "message",
									role: "assistant",
									model: "claude-x",
									content: [],
									usage: { input_tokens: 20, output_tokens: 1 }
								}
							}
						},
						{ data: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } } },
						{ data: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } } },
						{ data: { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } } },
						{ data: { type: "content_block_stop", index: 0 } },
						{ data: { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } } },
						{ data: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "ok" } } },
						{ data: { type: "content_block_stop", index: 1 } },
						{
							data: {
								type: "content_block_start",
								index: 2,
								content_block: { type: "tool_use", id: "toolu_9", name: "weather", input: {} }
							}
						},
						{ data: { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"city":"Rome"}' } } },
						{ data: { type: "content_block_stop", index: 2 } },
						{ data: { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 9 } } },
						{ data: { type: "message_stop" } }
					]),
					{ status: 200, headers: { "content-type": "text/event-stream" } }
				),
			{ reasoningRoundTrip: true }
		);
		const out = frames(
			await (await post(`${server.url}/v1/responses`, { model: "claude-x", input: "go", tools: [weather], stream: true })).text()
		);
		expect(events(out).at(-1)).toBe("response.completed");
		const final = out.at(-1).data.response;
		expect(final.output.map((item) => item.type)).toEqual(["reasoning", "message", "function_call"]);
		expect(final.output[0]).toMatchObject({ summary: [{ text: "hmm" }] });
		expect(unpack(final.output[0].encrypted_content)[0]).toMatchObject({ signature: "sig" });
		expect(final.output[2]).toMatchObject({ call_id: "toolu_9", arguments: '{"city":"Rome"}' });
		expect(final.usage).toMatchObject({ input_tokens: 20, output_tokens: 9 });
	});

	it("reports an Anthropic max_tokens stop as incomplete and an upstream error in the OpenAI error format", async () => {
		const { server } = await anthropicApi((body) =>
			body.max_tokens === 1
				? { body: message([{ type: "text", text: "x" }], { stop_reason: "max_tokens" }) }
				: { status: 429, body: { type: "error", error: { type: "rate_limit_error", message: "slow down" } } }
		);
		const cut = await (await post(`${server.url}/v1/responses`, { model: "claude-x", input: "x", max_output_tokens: 1 })).json();
		expect(cut).toMatchObject({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } });
		const limited = await post(`${server.url}/v1/responses`, { model: "claude-x", input: "x" });
		expect(limited.status).toBe(429);
		expect((await limited.json()).error).toMatchObject({ message: "slow down", type: "rate_limit_error" });
	});

	it("counts input tokens with an estimate when the upstream has no tokenizer", async () => {
		const { server } = await anthropicApi(() => ({ body: { input_tokens: 77 } }));
		const reply = await post(`${server.url}/v1/responses/input_tokens`, { model: "claude-x", input: "hello there" });
		expect(reply.status).toBe(200);
		expect(await reply.json()).toMatchObject({ object: "response.input_tokens", input_tokens: expect.any(Number) });
	});
});

describe("responses front, Ollama native upstream", () => {
	it("reaches /api/chat through the same pivot", async () => {
		const transport = fakeTransport((_url, init) => ({
			body: {
				model: "qwen3",
				created_at: "2026-11-13T10:00:00Z",
				message: { role: "assistant", content: "hi from ollama", thinking: "um" },
				done: true,
				done_reason: "stop",
				prompt_eval_count: 11,
				eval_count: 5,
				seen: JSON.parse(init.body)
			}
		}));
		const api = await make({
			front: "openai",
			upstreams: [{ url: "http://ollama.test", backend: "ollama", api: "native", models: ["qwen3"] }],
			detect: false,
			transport
		});
		const server = await api.server.start({ port: 0 });
		const body = await (await post(`${server.url}/v1/responses`, { model: "qwen3", input: "hi", instructions: "sys" })).json();
		expect(body.output.map((item) => item.type)).toEqual(["reasoning", "message"]);
		expect(body.output[1].content[0].text).toBe("hi from ollama");
		expect(body.usage).toMatchObject({ input_tokens: 11, output_tokens: 5 });
		const call = transport.calls.at(-1);
		expect(new URL(call.url).pathname).toBe("/api/chat");
		expect(JSON.parse(call.init.body).messages).toMatchObject([
			{ role: "system", content: "sys" },
			{ role: "user", content: "hi" }
		]);
	});
});
