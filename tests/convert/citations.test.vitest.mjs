/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/convert/citations.test.vitest.mjs
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
 * @fileoverview Citations through the converters: Anthropic citations and Chat Completions annotations in replies and streams (both directions), the Responses API's annotations (upstream and front, whole and streamed), request source tags, document citations for `file` parts, and `citations: "none"`.
 */
import { describe, expect, it } from "vitest";
import { request as anthropicRequest } from "../../src/api/convert/anthropic/messages/to/openai/chat/request.mjs";
import { request as chatToAnthropic } from "../../src/api/convert/openai/chat/to/anthropic/messages/request.mjs";
import { response as anthropicToChat } from "../../src/api/convert/anthropic/messages/to/openai/chat/response.mjs";
import { response as chatToAnthropicResponse } from "../../src/api/convert/openai/chat/to/anthropic/messages/response.mjs";
import { stream as anthropicToChatStream } from "../../src/api/convert/anthropic/messages/to/openai/chat/stream.mjs";
import { stream as chatToAnthropicStream } from "../../src/api/convert/openai/chat/to/anthropic/messages/stream.mjs";
import { response as chatToResponses } from "../../src/api/convert/openai/chat/to/openai/responses/response.mjs";
import { stream as chatToResponsesStream } from "../../src/api/convert/openai/chat/to/openai/responses/stream.mjs";
import { response as responsesToChat, stream as responsesToChatStream } from "../../src/lib/responses-upstream.mjs";
import { sourceOf } from "../../src/lib/citations.mjs";
import { collect } from "../helpers/streams.mjs";

const web = (text, extra = {}) => ({
	type: "web_search_result_location",
	cited_text: text,
	url: "https://a.test/x",
	title: "A",
	encrypted_index: "enc",
	...extra
});
const doc = {
	type: "char_location",
	cited_text: "quote",
	document_index: 0,
	document_title: "Doc",
	start_char_index: 4,
	end_char_index: 9
};
const message = (content) => ({
	id: "msg_1",
	type: "message",
	role: "assistant",
	model: "claude",
	content,
	stop_reason: "end_turn",
	stop_sequence: null,
	usage: { input_tokens: 1, output_tokens: 2 }
});
const completion = (extra, content = "Hello big world") => ({
	id: "c",
	object: "chat.completion",
	model: "m",
	choices: [{ index: 0, message: { role: "assistant", content, ...extra }, finish_reason: "stop" }]
});
const urlAnnotation = (start, end, url = "https://a.test/x") => ({
	type: "url_citation",
	url_citation: { start_index: start, end_index: end, title: "A", url }
});

describe("Anthropic reply to Chat Completions", () => {
	it("gives each citation the span of its text block in the joined content", () => {
		const out = anthropicToChat(
			message([
				{ type: "text", text: "Hello " },
				{ type: "text", text: "big", citations: [web("w"), doc] },
				{ type: "text", text: " world" }
			])
		);
		const { annotations } = out.choices[0].message;
		expect(out.choices[0].message.content).toBe("Hello big world");
		expect(annotations).toHaveLength(2);
		expect(annotations[0]).toMatchObject({
			type: "url_citation",
			url_citation: { start_index: 6, end_index: 9, title: "A", url: "https://a.test/x" }
		});
		expect(annotations[1]).toMatchObject({ type: "citation", citation: { kind: "document", index: 0, span: { start: 6, end: 9 } } });
	});

	it("has no annotations without citations, and none with citations: none", () => {
		expect(anthropicToChat(message([{ type: "text", text: "plain" }])).choices[0].message).not.toHaveProperty("annotations");
		const cited = message([{ type: "text", text: "x", citations: [web("w")] }]);
		expect(anthropicToChat(cited, undefined, { citations: "none" }).choices[0].message).not.toHaveProperty("annotations");
		expect(anthropicToChat(cited).choices[0].message.annotations).toHaveLength(1);
	});
});

describe("Chat Completions reply to Anthropic", () => {
	it("cuts the text into blocks at the annotations' spans, with the citations on the cited blocks", () => {
		const out = chatToAnthropicResponse(completion({ annotations: [urlAnnotation(6, 9)] }));
		expect(out.content).toEqual([
			{ type: "text", text: "Hello " },
			{
				type: "text",
				text: "big",
				citations: [{ type: "web_search_result_location", cited_text: "", url: "https://a.test/x", title: "A", encrypted_index: "" }]
			},
			{ type: "text", text: " world" }
		]);
	});

	it("keeps one text block when nothing is cited, and reads the neutral citation a converter put on an annotation", () => {
		expect(chatToAnthropicResponse(completion({})).content).toEqual([{ type: "text", text: "Hello big world" }]);
		const neutral = {
			type: "citation",
			citation: {
				kind: "document",
				index: 1,
				title: "D",
				text: "t",
				location: { type: "page", start: 2, end: 3 },
				span: { start: 0, end: 5 }
			}
		};
		const out = chatToAnthropicResponse(completion({ annotations: [neutral, { type: "other" }] }));
		expect(out.content[0]).toEqual({
			type: "text",
			text: "Hello",
			citations: [
				{ type: "page_location", cited_text: "t", document_index: 1, document_title: "D", start_page_number: 2, end_page_number: 3 }
			]
		});
		expect(out.content[1].text).toBe(" big world");
		const bare = chatToAnthropicResponse(completion({ annotations: [{ type: "citation", citation: { kind: "document", index: 4 } }] }));
		expect(bare.content).toEqual([
			{
				type: "text",
				text: "Hello big world",
				citations: [
					{ type: "char_location", cited_text: "", document_index: 4, document_title: null, start_char_index: 0, end_char_index: 0 }
				]
			}
		]);
	});

	it("moves the spans when reasoning was taken off the front of the content", () => {
		const out = chatToAnthropicResponse(completion({ reasoning: "hm", annotations: [urlAnnotation(9, 12)] }, "  \nHello big world"));
		expect(out.content.map((block) => block.type)).toEqual(["thinking", "text", "text", "text"]);
		expect(out.content[2]).toMatchObject({ text: "big", citations: [{ type: "web_search_result_location" }] });
		const tagged = chatToAnthropicResponse(completion({ annotations: [urlAnnotation(28, 33)] }, "<think>why</think>Hello big world"));
		expect(tagged.content.find((block) => block.citations).text).toBe("world");
	});

	it("leaves the citations out with citations: none, and for a refusal that replaces the text", () => {
		const cited = completion({ annotations: [urlAnnotation(6, 9)] });
		expect(chatToAnthropicResponse(cited, undefined, { citations: "none" }).content).toEqual([{ type: "text", text: "Hello big world" }]);
		const refused = chatToAnthropicResponse(completion({ refusal: "No." }, ""));
		expect(refused.content).toEqual([{ type: "text", text: "No." }]);
	});
});

describe("Anthropic stream to Chat Completions chunks", () => {
	const events = (extra = []) => [
		{ type: "message_start", message: { id: "msg_1", model: "claude", usage: { input_tokens: 1 } } },
		{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
		{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } },
		{ type: "content_block_stop", index: 0 },
		{ type: "content_block_start", index: 1, content_block: { type: "text", text: "", citations: [] } },
		{ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "big" } },
		{ type: "content_block_delta", index: 1, delta: { type: "citations_delta", citation: web("w") } },
		{ type: "content_block_delta", index: 1, delta: { type: "citations_delta", citation: { type: "unknown" } } },
		{ type: "content_block_delta", index: 1, delta: { type: "citations_delta", citation: doc } },
		{ type: "content_block_stop", index: 1 },
		...extra,
		{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
		{ type: "message_stop" }
	];
	const run = async (list, state, settings) => (await collect(anthropicToChatStream(list, state, settings))).map((entry) => entry.data);

	it("sends a block's citations as one annotations chunk when the block stops, spanning the block's text", async () => {
		const out = await run(events());
		const annotated = out.filter((chunk) => chunk.choices?.[0]?.delta?.annotations);
		expect(annotated).toHaveLength(1);
		const [first, second] = annotated[0].choices[0].delta.annotations;
		expect(first).toMatchObject({ type: "url_citation", url_citation: { start_index: 6, end_index: 9 } });
		expect(second).toMatchObject({ type: "citation", citation: { kind: "document", span: { start: 6, end: 9 } } });
		expect(out.at(-1)).toBe("[DONE]");
	});

	it("sends no annotations for uncited blocks, citations: none, or a citation that comes with no text block open", async () => {
		const plain = await run([
			{ type: "message_start", message: { id: "msg_1", model: "claude", usage: {} } },
			{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
			{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "x" } },
			{ type: "content_block_stop", index: 0 },
			{ type: "content_block_delta", index: 0, delta: { type: "citations_delta", citation: web("late") } },
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: {} },
			{ type: "message_stop" }
		]);
		expect(plain.some((chunk) => chunk.choices?.[0]?.delta?.annotations)).toBe(false);
		const none = await run(events(), undefined, { citations: "none" });
		expect(none.some((chunk) => chunk.choices?.[0]?.delta?.annotations)).toBe(false);
	});
});

describe("Chat Completions stream to Anthropic events", () => {
	const chunk = (delta, finish = null) => ({
		id: "c",
		object: "chat.completion.chunk",
		model: "m",
		choices: [{ index: 0, delta, finish_reason: finish }]
	});
	const run = async (list, settings) => (await collect(chatToAnthropicStream(list, undefined, settings))).map((entry) => entry.data);
	const citations = (events) => events.filter((event) => event.delta?.type === "citations_delta");

	it("puts citations on the text block that is open when they arrive", async () => {
		const events = await run([
			chunk({ role: "assistant", content: "" }),
			chunk({ content: "Hello big world" }),
			chunk({ annotations: [urlAnnotation(6, 9)] }),
			chunk({ annotations: [{ type: "other" }] }),
			chunk({}, "stop")
		]);
		const found = citations(events);
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ index: 0, delta: { citation: { type: "web_search_result_location", url: "https://a.test/x" } } });
		const names = events.map((event) => event.type);
		expect(names.indexOf("content_block_delta", names.lastIndexOf("content_block_delta") - 1)).toBeGreaterThan(0);
		expect(names.at(-1)).toBe("message_stop");
	});

	it("holds citations that come before any text for the text block that opens, and flushes them when it closes", async () => {
		const events = await run([
			chunk({ role: "assistant", annotations: [urlAnnotation(0, 2)] }),
			chunk({ content: "Hi" }),
			chunk({}, "stop")
		]);
		expect(citations(events)).toHaveLength(1);
		const stop = events.findIndex((event) => event.type === "content_block_stop");
		expect(events.findIndex((event) => event.delta?.type === "citations_delta")).toBeLessThan(stop);
	});

	it("gives citations that arrive with no text at all a text block of their own", async () => {
		const events = await run([
			chunk({ role: "assistant", tool_calls: [{ index: 0, id: "t1", type: "function", function: { name: "f", arguments: "{}" } }] }),
			chunk({ annotations: [urlAnnotation(0, 0)] }),
			chunk({}, "tool_calls")
		]);
		const starts = events.filter((event) => event.type === "content_block_start").map((event) => event.content_block.type);
		expect(starts).toEqual(["tool_use", "text"]);
		expect(citations(events)).toHaveLength(1);
	});

	it("leaves citations out with citations: none", async () => {
		const events = await run([chunk({ content: "x" }), chunk({ annotations: [urlAnnotation(0, 1)] }), chunk({}, "stop")], {
			citations: "none"
		});
		expect(citations(events)).toEqual([]);
	});
});

describe("Responses upstream to Chat Completions", () => {
	const reply = (content) => ({
		id: "resp_1",
		status: "completed",
		output: [
			{ type: "message", id: "m1", role: "assistant", content },
			{
				type: "message",
				id: "m2",
				role: "assistant",
				content: [
					{
						type: "output_text",
						text: " More",
						annotations: [{ type: "url_citation", start_index: 1, end_index: 5, url: "https://b.test", title: "B" }]
					}
				]
			}
		],
		usage: { input_tokens: 1, output_tokens: 2 }
	});

	it("reads each part's annotations with their spans moved into the joined text", () => {
		const out = responsesToChat(
			reply([
				{
					type: "output_text",
					text: "Hello big",
					annotations: [
						{ type: "url_citation", start_index: 6, end_index: 9, url: "https://a.test", title: "A" },
						{ type: "file_path", file_id: "f", index: 0 }
					]
				},
				{ type: "output_text", text: "!" },
				{ type: "refusal", refusal: "r" }
			])
		);
		const message = out.choices[0].message;
		expect(message.content).toBe("Hello big! More");
		expect(message.annotations.map((a) => a.url_citation.start_index)).toEqual([6, 11]);
		expect(message.annotations[1].url_citation.end_index).toBe(15);
	});

	it("has no annotations without citations, and none with citations: none", () => {
		const plain = responsesToChat({
			id: "resp_2",
			status: "completed",
			output: [{ type: "message", content: [{ type: "output_text", text: "x" }] }]
		});
		expect(plain.choices[0].message).not.toHaveProperty("annotations");
		const cited = reply([
			{ type: "output_text", text: "Hello", annotations: [{ type: "url_citation", start_index: 0, end_index: 5, url: "u", title: "" }] }
		]);
		expect(responsesToChat(cited).choices[0].message.annotations).toHaveLength(2);
		expect(responsesToChat(cited, undefined, { citations: "none" }).choices[0].message).not.toHaveProperty("annotations");
		const bare = {
			id: "resp_3",
			status: "completed",
			output: [
				{
					type: "message",
					content: [{ type: "output_text", text: "Hello", annotations: [{ type: "file_citation", file_id: "f", filename: "a", index: 3 }] }]
				}
			]
		};
		expect(responsesToChat(bare, undefined, { citations: "none" }).choices[0].message).not.toHaveProperty("annotations");
		const spanless = {
			id: "resp_4",
			status: "completed",
			output: [
				{
					type: "message",
					content: [{ type: "output_text", text: "x", annotations: [{ type: "citation", citation: { kind: "document", index: 2 } }] }]
				}
			]
		};
		expect(responsesToChat(spanless).choices[0].message.annotations[0].citation).toEqual({ kind: "document", index: 2 });
		expect(responsesToChat(bare).choices[0].message.annotations[0]).toMatchObject({
			type: "citation",
			citation: { kind: "document", id: "f", span: { start: 3, end: 3 } }
		});
	});

	const events = (extra = {}) => [
		{ type: "response.created", response: { id: "resp_1", model: "gpt" } },
		{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: "m1" } },
		{ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "Hello " },
		{ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "big" },
		{
			type: "response.output_text.annotation.added",
			output_index: 0,
			content_index: 0,
			annotation_index: 0,
			annotation: { type: "url_citation", start_index: 6, end_index: 9, url: "https://a.test", title: "A" }
		},
		{ type: "response.output_text.delta", output_index: 1, content_index: 0, delta: " More" },
		{
			type: "response.output_text.annotation.added",
			output_index: 1,
			content_index: 0,
			annotation_index: 0,
			annotation: { type: "url_citation", start_index: 1, end_index: 5, url: "https://b.test", title: "B" }
		},
		{
			type: "response.output_item.done",
			output_index: 0,
			item: {
				type: "message",
				content: [
					{
						type: "output_text",
						text: "Hello big",
						annotations: [{ type: "url_citation", start_index: 6, end_index: 9, url: "https://a.test", title: "A" }]
					}
				]
			}
		},
		{ type: "response.completed", response: { status: "completed", usage: { input_tokens: 1, output_tokens: 2 } } },
		...Object.values(extra)
	];
	const run = async (list, settings) => (await collect(responsesToChatStream(list, undefined, settings))).map((entry) => entry.data);
	const annotations = (out) => out.flatMap((chunk) => chunk.choices?.[0]?.delta?.annotations ?? []);

	it("sends streamed annotations with their spans counted from the start of the content", async () => {
		const found = annotations(await run(events()));
		expect(found.map((a) => [a.url_citation.start_index, a.url_citation.end_index])).toEqual([
			[6, 9],
			[10, 14]
		]);
	});

	it("sends the annotations of a finished item that streamed no annotation events, and none with citations: none", async () => {
		const done = [
			{ type: "response.created", response: { id: "resp_1" } },
			{
				type: "response.output_item.done",
				output_index: 0,
				item: {
					type: "message",
					content: [
						{
							type: "output_text",
							text: "Hello big",
							annotations: [{ type: "url_citation", start_index: 6, end_index: 9, url: "u", title: "" }]
						},
						{ type: "output_text", text: "!", annotations: [{ type: "url_citation", start_index: 0, end_index: 1, url: "v", title: "" }] },
						{ type: "refusal", refusal: "r" }
					]
				}
			},
			{ type: "response.completed", response: {} }
		];
		expect(annotations(await run(done)).map((a) => [a.url_citation.start_index, a.url_citation.end_index])).toEqual([
			[6, 9],
			[9, 10]
		]);
		expect(annotations(await run(done, { citations: "none" }))).toEqual([]);
	});

	it("moves the spans of a part that streamed its text and has its annotations only in the finished item", async () => {
		const list = [
			{ type: "response.created", response: { id: "resp_1" } },
			{ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "Hello " },
			{ type: "response.output_text.delta", output_index: 0, content_index: 1, delta: "big" },
			{
				type: "response.output_item.done",
				output_index: 0,
				item: {
					type: "message",
					content: [
						{
							type: "output_text",
							text: "Hello ",
							annotations: [{ type: "url_citation", start_index: 0, end_index: 5, url: "u", title: "" }]
						},
						{
							type: "output_text",
							text: "big",
							annotations: [{ type: "url_citation", start_index: 0, end_index: 3, url: "v", title: "" }]
						},
						{ type: "output_text", text: "?", annotations: [{ type: "url_citation", start_index: 0, end_index: 1, url: "w", title: "" }] },
						{ type: "refusal", refusal: "r" }
					]
				}
			},
			{ type: "response.completed", response: {} }
		];
		expect(annotations(await run(list)).map((a) => [a.url_citation.start_index, a.url_citation.end_index])).toEqual([
			[0, 5],
			[6, 9],
			[9, 10]
		]);
		const lone = [
			{ type: "response.created", response: { id: "resp_1" } },
			{
				type: "response.output_text.annotation.added",
				output_index: 0,
				annotation: { type: "url_citation", start_index: 2, end_index: 4, url: "u", title: "" }
			},
			{ type: "response.completed", response: {} }
		];
		expect(annotations(await run(lone)).map((a) => a.url_citation.start_index)).toEqual([2]);
	});
});

describe("Chat Completions reply to Responses", () => {
	const state = { model: "m" };

	it("puts the annotations on the output_text part", () => {
		const out = chatToResponses(completion({ annotations: [urlAnnotation(6, 9), toNeutral()] }), state);
		const part = out.output[0].content[0];
		expect(part.annotations).toHaveLength(2);
		expect(part.annotations[0]).toMatchObject({ type: "url_citation", start_index: 6, end_index: 9, url: "https://a.test/x", title: "A" });
		expect(part.annotations[1]).toMatchObject({ type: "file_citation", file_id: "file-1", filename: "a.pdf" });
	});

	it("has empty annotations without citations, and with citations: none", () => {
		expect(chatToResponses(completion({}), state).output[0].content[0].annotations).toEqual([]);
		expect(
			chatToResponses(completion({ annotations: [urlAnnotation(0, 1)] }), state, { citations: "none" }).output[0].content[0].annotations
		).toEqual([]);
	});

	const chunk = (delta, finish = null) => ({
		id: "c",
		object: "chat.completion.chunk",
		model: "m",
		choices: [{ index: 0, delta, finish_reason: finish }]
	});
	const run = async (list, settings) => (await collect(chatToResponsesStream(list, state, settings))).map((entry) => entry.data);

	it("streams annotation events and has the annotations in the closed part", async () => {
		const events = await run([
			chunk({ role: "assistant", content: "" }),
			chunk({ content: "Hello big" }),
			chunk({ annotations: [urlAnnotation(6, 9)] }),
			chunk({}, "stop")
		]);
		const added = events.filter((event) => event.type === "response.output_text.annotation.added");
		expect(added).toHaveLength(1);
		expect(added[0]).toMatchObject({
			output_index: 0,
			content_index: 0,
			annotation_index: 0,
			annotation: { type: "url_citation", start_index: 6 }
		});
		const done = events.find((event) => event.type === "response.content_part.done");
		expect(done.part.annotations).toHaveLength(1);
		expect(events.at(-1).type).toBe("response.completed");
	});

	it("holds annotations that come before the text, and gives ones with no text an empty message item", async () => {
		const early = await run([
			chunk({ role: "assistant", annotations: [urlAnnotation(0, 2)] }),
			chunk({ content: "Hi" }),
			chunk({}, "stop")
		]);
		expect(early.filter((event) => event.type === "response.output_text.annotation.added")).toHaveLength(1);
		const alone = await run([chunk({ role: "assistant", annotations: [urlAnnotation(0, 0)] }), chunk({}, "stop")]);
		expect(alone.filter((event) => event.type === "response.output_item.added").map((event) => event.item.type)).toEqual(["message"]);
		expect(alone.filter((event) => event.type === "response.output_text.annotation.added")).toHaveLength(1);
		const refusal = await run([
			chunk({ role: "assistant", refusal: "No" }),
			chunk({ annotations: [urlAnnotation(0, 0)] }),
			chunk({}, "stop")
		]);
		expect(refusal.filter((event) => event.type === "response.output_text.annotation.added")).toEqual([]);
	});

	it("leaves them out with citations: none", async () => {
		const events = await run([chunk({ content: "x" }), chunk({ annotations: [urlAnnotation(0, 1)] }), chunk({}, "stop")], {
			citations: "none"
		});
		expect(events.some((event) => event.type === "response.output_text.annotation.added")).toBe(false);
	});
});

function toNeutral() {
	return { type: "citation", citation: { kind: "document", id: "file-1", title: "a.pdf", span: { start: 0, end: 5 } } };
}

describe("request sources and document citations", () => {
	const text = {
		type: "document",
		title: "Notes",
		source: { type: "text", media_type: "text/plain", data: "alpha beta" },
		citations: { enabled: true }
	};
	const found = {
		type: "search_result",
		source: "https://s.test",
		title: "S",
		content: [
			{ type: "text", text: "one" },
			{ type: "text", text: "two" }
		],
		citations: { enabled: true }
	};

	it("tags the parts of documents and search results with their position and what the block asked for", async () => {
		const { body } = await anthropicRequest(
			{
				model: "m",
				max_tokens: 5,
				messages: [
					{ role: "user", content: [text, { type: "text", text: "q" }, found, { ...text, citations: undefined, title: undefined }] }
				]
			},
			{},
			{ sources: true }
		);
		const parts = body.messages[0].content;
		expect(parts.map((part) => sourceOf(part))).toEqual([
			{ kind: "document", index: 0, title: "Notes", citations: true },
			undefined,
			{ kind: "search_result", index: 0, title: "S", source: "https://s.test", citations: true, blocks: 2, text: "one\ntwo" },
			{ kind: "document", index: 1, title: undefined, citations: false }
		]);
	});

	it("keeps the tagged parts of a tool result too, and joins text as before without the sources option", async () => {
		const request = (context) =>
			anthropicRequest(
				{
					model: "m",
					max_tokens: 5,
					tools: [{ name: "Search", input_schema: { type: "object" } }],
					messages: [
						{ role: "user", content: "find" },
						{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Search", input: {} }] },
						{
							role: "user",
							content: [
								{
									type: "tool_result",
									tool_use_id: "t1",
									content: [found, { ...found, source: undefined, title: undefined, content: undefined }]
								}
							]
						}
					]
				},
				{},
				context
			);
		const kept = (await request({ sources: true })).body.messages.at(-1);
		expect(kept.content.map((part) => sourceOf(part)?.index)).toEqual([0, 1]);
		expect(sourceOf(kept.content[1])).toMatchObject({ kind: "search_result", index: 1, blocks: 0, citations: true });
		const joined = (await request(undefined)).body.messages.at(-1);
		expect(typeof joined.content).toBe("string");
		expect(joined.content).toContain("[Search result: S (https://s.test)]");
	});

	it("asks Anthropic to cite a file part when the part or the documentCitations setting says so", async () => {
		const file = (extra = {}) => ({ type: "file", file: { file_data: "data:application/pdf;base64,AAAA" }, ...extra });
		const ask = async (parts, settings) =>
			(await chatToAnthropic({ model: "m", messages: [{ role: "user", content: parts }] }, settings)).body.messages[0].content;
		expect((await ask([file()]))[0]).toEqual({ type: "document", source: { type: "base64", media_type: "application/pdf", data: "AAAA" } });
		expect((await ask([file()], { documentCitations: true }))[0]).toMatchObject({ citations: { enabled: true } });
		expect((await ask([file({ citations: { enabled: true } })]))[0]).toMatchObject({ citations: { enabled: true } });
		expect((await ask([file({ citations: { enabled: false } })], { documentCitations: true }))[0]).not.toHaveProperty("citations");
	});
});
