/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/convert/bedrock-converse-gaps.test.vitest.mjs
 *	@Date: 2026-11-22T09:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T09:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The Converse converters for the three pieces added to the Bedrock driver: `cache_control` as cache points, signed reasoning sent back, and `response_format` as a tool.
 */
import { describe, expect, it } from "vitest";
import { request as fromAnthropic } from "../../src/api/convert/anthropic/messages/to/bedrock/converse/request.mjs";
import { request as fromChat } from "../../src/api/convert/openai/chat/to/bedrock/converse/request.mjs";
import { response as toChat } from "../../src/api/convert/bedrock/converse/to/openai/chat/response.mjs";
import { response as toAnthropic } from "../../src/api/convert/bedrock/converse/to/anthropic/messages/response.mjs";
import { stream as chatStream } from "../../src/api/convert/bedrock/converse/to/openai/chat/stream.mjs";
import { stream as anthropicStream } from "../../src/api/convert/bedrock/converse/to/anthropic/messages/stream.mjs";
import { unsign } from "../../src/lib/thinking.mjs";
import { collect } from "../helpers/streams.mjs";

const eph = { type: "ephemeral" };
const hour = { type: "ephemeral", ttl: "1h" };
const kinds = (blocks) => blocks.map((block) => Object.keys(block)[0]);
const send = (body, settings, context) => fromAnthropic({ model: "m", max_tokens: 100, ...body }, settings, context);
const events = (list) => list.map(([event, data]) => ({ event, data }));
const producer = "bedrock:bedrock.converse:example";

describe("cache_control as cache points", () => {
	const tools = [
		{ name: "R", input_schema: { type: "object" }, cache_control: eph },
		{ name: "S", input_schema: { type: "object" } }
	];

	it("marks a tool, the system prompt and a content block", async () => {
		const { body } = await send({
			tools,
			system: [
				{ type: "text", text: "s1" },
				{ type: "text", text: "s2", cache_control: hour }
			],
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "a", cache_control: eph },
						{ type: "text", text: "b" }
					]
				}
			]
		});
		expect(kinds(body.toolConfig.tools)).toEqual(["toolSpec", "cachePoint", "toolSpec"]);
		expect(body.system).toEqual([{ text: "s1\n\ns2" }, { cachePoint: { type: "default", ttl: "1h" } }]);
		expect(body.messages[0].content).toEqual([{ text: "a" }, { cachePoint: { type: "default" } }, { text: "b" }]);
	});

	it("marks an assistant turn and a tool result, and keeps the mark when assistant messages follow each other", async () => {
		const { body } = await send({
			tools,
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: [{ type: "text", text: "looking", cache_control: eph }] },
				{ role: "assistant", content: [{ type: "tool_use", id: "t", name: "R", input: {} }] },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "done", cache_control: eph }] }
			]
		});
		expect(kinds(body.messages[1].content)).toEqual(["text", "toolUse", "cachePoint"]);
		expect(kinds(body.messages[2].content)).toEqual(["toolResult", "cachePoint"]);
	});

	it("marks the last message for the request's own cache_control, and does nothing for an empty conversation", async () => {
		const { body } = await send({ cache_control: hour, messages: [{ role: "user", content: "hi" }] });
		expect(body.messages[0].content).toEqual([{ text: "hi" }, { cachePoint: { type: "default", ttl: "1h" } }]);
		const none = await send({ cache_control: eph, messages: [] });
		expect(none.body.messages).toEqual([]);
	});

	it("has no system point when there is no system prompt, and none at all when the bedrock setting turns caching off", async () => {
		const blank = await send({ system: [{ type: "text", text: "", cache_control: eph }], messages: [{ role: "user", content: "hi" }] });
		expect(blank.body.system).toBeUndefined();
		const off = await send(
			{
				tools,
				system: [{ type: "text", text: "s", cache_control: eph }],
				cache_control: eph,
				messages: [{ role: "user", content: [{ type: "text", text: "a", cache_control: eph }] }]
			},
			{ bedrock: { cache: false } }
		);
		expect(JSON.stringify(off.body)).not.toContain("cachePoint");
	});

	it("keeps four points and names cache_control when there were more", async () => {
		const mark = (text) => ({ type: "text", text, cache_control: eph });
		const { body, state } = await send({
			tools,
			system: [mark("s")],
			messages: [
				{ role: "user", content: [mark("a")] },
				{ role: "assistant", content: [mark("b")] },
				{ role: "user", content: [mark("c")] }
			]
		});
		const all = [body.toolConfig.tools, body.system, ...body.messages.map((message) => message.content)].flat();
		expect(all.filter((block) => block.cachePoint)).toHaveLength(4);
		expect(state.dropped).toContain("cache_control");
	});

	it("the Chat Completions front has no cache_control to map", () => {
		const { body } = fromChat({ model: "m", messages: [{ role: "user", content: "hi", cache_control: { type: "ephemeral" } }] });
		expect(JSON.stringify(body)).not.toContain("cachePoint");
	});
});

describe("signed reasoning, Anthropic front", () => {
	const signed = {
		output: { message: { content: [{ reasoningContent: { reasoningText: { text: "hmm", signature: "sig-1" } } }, { text: "hello" }] } },
		stopReason: "end_turn"
	};
	const redacted = {
		output: { message: { content: [{ reasoningContent: { redactedContent: "QUJD" } }, { text: "hello" }] } },
		stopReason: "end_turn"
	};
	const settings = { reasoningRoundTrip: true };
	const replay = async (reply, as = producer) => {
		const message = toAnthropic(reply, { model: "m", producer }, settings);
		const { body, state } = await send(
			{
				messages: [
					{ role: "user", content: "hi" },
					{ role: "assistant", content: message.content },
					{ role: "user", content: "again" }
				]
			},
			undefined,
			{ producer: as }
		);
		return { message, body, state };
	};

	it("gives the thinking block a signature that brings the Converse signature back on the next turn", async () => {
		const { message, body } = await replay(signed);
		expect(message.content[0]).toMatchObject({ type: "thinking", thinking: "hmm", signature: expect.stringMatching(/^llmt:/) });
		expect(body.messages[1].content[0]).toEqual({ reasoningContent: { reasoningText: { text: "hmm", signature: "sig-1" } } });
		expect(body.messages[1].content.at(-1)).toEqual({ text: "hello" });
	});

	it("does the same for redacted reasoning", async () => {
		const { message, body } = await replay(redacted);
		expect(message.content[0]).toMatchObject({ type: "thinking", thinking: "" });
		expect(body.messages[1].content[0]).toEqual({ reasoningContent: { redactedContent: "QUJD" } });
	});

	it("sends only the text, and so nothing, for a signature another upstream made", async () => {
		const { body, state } = await replay(signed, "other:other:host");
		expect(JSON.stringify(body.messages[1])).not.toContain("reasoningContent");
		expect(state.dropped).toContain("reasoning");
	});

	it("streams the thinking signature as the signature of the block", async () => {
		const state = { model: "m", producer };
		const out = await collect(
			anthropicStream(
				events([
					["messageStart", { role: "assistant" }],
					["contentBlockDelta", { contentBlockIndex: 0, delta: { reasoningContent: { text: "hm" } } }],
					["contentBlockDelta", { contentBlockIndex: 0, delta: { reasoningContent: { text: "m" } } }],
					["contentBlockDelta", { contentBlockIndex: 0, delta: { reasoningContent: { signature: "sig-2" } } }],
					["contentBlockDelta", { contentBlockIndex: 1, delta: { text: "hello" } }],
					["messageStop", { stopReason: "end_turn" }],
					["metadata", { usage: { inputTokens: 1, outputTokens: 1 } }]
				]),
				state,
				settings
			)
		);
		const signature = out.find((entry) => entry.data.delta?.type === "signature_delta").data.delta.signature;
		expect(await unsign(signature, { producer })).toEqual({
			reasoning: "hmm",
			reasoning_details: [{ type: "reasoning.text", text: "hmm", signature: "sig-2", format: "anthropic-claude-v1", index: 0 }]
		});
	});
});

describe("signed reasoning, Chat Completions front", () => {
	it("returns the reasoning with its signature as reasoning_details, and sends them back from the history", () => {
		const reply = {
			output: { message: { content: [{ reasoningContent: { reasoningText: { text: "hmm", signature: "sig-3" } } }, { text: "hello" }] } },
			stopReason: "end_turn"
		};
		const message = toChat(reply, { model: "m" }, {}).choices[0].message;
		expect(message.reasoning).toBe("hmm");
		expect(message.reasoning_details).toHaveLength(1);
		const { body } = fromChat(
			{
				model: "m",
				messages: [
					{ role: "user", content: "hi" },
					{ role: "assistant", ...message },
					{ role: "user", content: "again" }
				]
			},
			{}
		);
		expect(body.messages[1].content[0]).toEqual({ reasoningContent: { reasoningText: { text: "hmm", signature: "sig-3" } } });
	});

	it("streams reasoning_details chunks", async () => {
		const out = (
			await collect(
				chatStream(
					events([
						["contentBlockDelta", { contentBlockIndex: 0, delta: { reasoningContent: { text: "hm" } } }],
						["contentBlockDelta", { contentBlockIndex: 0, delta: { reasoningContent: { signature: "sig-4" } } }],
						["messageStop", { stopReason: "end_turn" }]
					]),
					{ model: "m" },
					{}
				)
			)
		).map((entry) => entry.data);
		expect(out.flatMap((chunk) => chunk.choices?.[0]?.delta?.reasoning_details ?? [])).toHaveLength(2);
	});
});

describe("response_format as a tool", () => {
	const schema = { type: "object", properties: { n: { type: "number" } } };
	const reply = (input) => ({
		output: { message: { content: [{ toolUse: { toolUseId: "t", name: "json_response", input } }] } },
		stopReason: "tool_use",
		usage: { inputTokens: 1, outputTokens: 1 }
	});

	it("Chat Completions: sends the schema as the tool and reads the call back as the content", async () => {
		const { body, state } = fromChat({
			model: "m",
			messages: [{ role: "user", content: "hi" }],
			response_format: { type: "json_schema", json_schema: { name: "x", schema } }
		});
		expect(body.toolConfig.toolChoice).toEqual({ tool: { name: "json_response" } });
		expect(state.jsonTool).toBe("json_response");
		const choice = toChat(reply({ n: 1 }), state, {}).choices[0];
		expect(choice.message.content).toBe('{"n":1}');
		expect(choice.finish_reason).toBe("stop");
		const chunks = (
			await collect(
				chatStream(
					events([
						["contentBlockStart", { contentBlockIndex: 0, start: { toolUse: { toolUseId: "t", name: "json_response" } } }],
						["contentBlockDelta", { contentBlockIndex: 0, delta: { toolUse: { input: '{"n":1}' } } }],
						["messageStop", { stopReason: "tool_use" }]
					]),
					state,
					{}
				)
			)
		).map((entry) => entry.data);
		expect(chunks.map((chunk) => chunk.choices?.[0]?.delta?.content).join("")).toBe('{"n":1}');
		expect(chunks.at(-2).choices[0].finish_reason).toBe("stop");
	});

	it("Anthropic: output_config.format is sent as the tool and read back as a text block", async () => {
		const { body, state } = await send({
			messages: [{ role: "user", content: "hi" }],
			output_config: { format: { type: "json_schema", schema } }
		});
		expect(body.toolConfig.tools[0].toolSpec.inputSchema).toEqual({ json: schema });
		const message = toAnthropic(reply({ n: 2 }), state, {});
		expect(message.content).toEqual([{ type: "text", text: '{"n":2}' }]);
		expect(message.stop_reason).toBe("end_turn");
		const out = await collect(
			anthropicStream(
				events([
					["contentBlockStart", { contentBlockIndex: 0, start: { toolUse: { toolUseId: "t", name: "json_response" } } }],
					["contentBlockDelta", { contentBlockIndex: 0, delta: { toolUse: { input: '{"n":3}' } } }],
					["messageStop", { stopReason: "tool_use" }],
					["metadata", { usage: { inputTokens: 1, outputTokens: 1 } }]
				]),
				state,
				{}
			)
		);
		expect(
			out
				.filter((entry) => entry.data.delta?.type === "text_delta")
				.map((entry) => entry.data.delta.text)
				.join("")
		).toBe('{"n":3}');
		expect(out.find((entry) => entry.event === "message_delta").data.delta.stop_reason).toBe("end_turn");
	});
});
