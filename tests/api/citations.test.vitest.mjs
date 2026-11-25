/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/citations.test.vitest.mjs
 *	@Date: 2026-11-25T01:30:00-08:00 (1795599000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-25T01:30:00-08:00 (1795599000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview `web_search` citations: the `[[cite:N]]` marker reader, and the numbered results, the answer's `web_search_result_location`
 * citations (not streamed and streamed), the sources of a replayed history and the executor option that turns it on.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import { match, split, streamer } from "../../src/lib/citemarks.mjs";
import { locate, seal, webSearch } from "../../src/lib/websearch.mjs";
import { history, normalize, sources } from "../../src/lib/servertools.mjs";

afterEach(closeAll);

const src = (n) => ({
	type: "web_search_result_location",
	url: `https://s${n}.test`,
	title: `S${n}`,
	encrypted_index: `i${n}`,
	cited_text: `t${n}`
});
const known = [src(1), src(2), src(3)];

describe("match", () => {
	it("reads a complete marker and its number", () => {
		expect(match("a[[cite:12]]b", 1)).toEqual({ kind: "full", length: 11, id: 12 });
	});
	it("reports a text that ends inside a marker as partial", () => {
		for (const tail of ["[", "[[", "[[ci", "[[cite:", "[[cite:1", "[[cite:123456", "[[cite:1]"]) {
			expect(match(tail, 0).kind).toBe("partial");
		}
	});
	it("rejects what can no longer become a marker", () => {
		for (const text of ["[x", "[[cite]]", "[[cite:]]", "[[cite:a]]", "[[cite:1]x", "[[cite:1234567]]", "[[cite:12 ]]"]) {
			expect(match(text, 0).kind).toBe("none");
		}
	});
});

describe("split", () => {
	it("returns a text with no marker as one plain block", () => {
		expect(split("Nothing here.", known)).toEqual([{ text: "Nothing here.", citations: [] }]);
		expect(split("", known)).toEqual([]);
	});
	it("makes the span since the last sentence boundary a block with the citation, and keeps the rest plain", () => {
		expect(split("First one. Second claim[[cite:2]] and more", known)).toEqual([
			{ text: "First one. ", citations: [] },
			{ text: "Second claim", citations: [known[1]] },
			{ text: " and more", citations: [] }
		]);
	});
	it("uses ! ? and line breaks as sentence boundaries, and a marker after the full stop cites its sentence", () => {
		expect(split("Wow! Really? Yes. [[cite:1]]", known)).toEqual([
			{ text: "Wow! Really? ", citations: [] },
			{ text: "Yes. ", citations: [known[0]] }
		]);
		expect(split("Line one\nLine two[[cite:3]]", known)).toEqual([
			{ text: "Line one\n", citations: [] },
			{ text: "Line two", citations: [known[2]] }
		]);
		expect(split("Version 3.5 is out[[cite:1]]", known)).toEqual([{ text: "Version 3.5 is out", citations: [known[0]] }]);
	});
	it("gives markers that follow each other one block, and the same source once", () => {
		expect(split("Claim[[cite:1]][[cite:2]] [[cite:3]]\n\n[[cite:1]] Next", known)).toEqual([
			{ text: "Claim", citations: [known[0], known[1], known[2]] },
			{ text: " Next", citations: [] }
		]);
	});
	it("drops white space after the last marker and a marker that has nothing before it", () => {
		expect(split("[[cite:1]]Text[[cite:2]]  ", known)).toEqual([{ text: "Text", citations: [known[1]] }]);
		expect(split("  [[cite:1]]", known)).toEqual([{ text: "  ", citations: [] }]);
	});
	it("leaves a marker that names no source, and text that only looks like one, in the text", () => {
		expect(split("A[[cite:9]] b [[cite:0]] [x [[cite: [[cite:1", known)).toEqual([
			{ text: "A[[cite:9]] b [[cite:0]] [x [[cite: [[cite:1", citations: [] }
		]);
		expect(split("A[[cite:9]] then B[[cite:1]]", known)).toEqual([{ text: "A[[cite:9]] then B", citations: [known[0]] }]);
	});
});

describe("streamer", () => {
	it("passes text through and reads a marker that arrives in pieces", () => {
		const reader = streamer(known);
		expect(reader.feed("Sky [[ci")).toEqual([{ text: "Sky " }]);
		expect(reader.feed("te:1")).toEqual([]);
		expect(reader.feed("]]")).toEqual([{ mark: known[0] }]);
		expect(reader.feed(" more [")).toEqual([{ text: " more " }]);
		expect(reader.feed("x")).toEqual([{ text: "[x" }]);
		expect(reader.feed("[[cite:9]]ok")).toEqual([{ text: "[[cite:9]]ok" }]);
	});
	it("releases a held tail at the end when it never became a marker", () => {
		const reader = streamer(known);
		expect(reader.feed("a [[cite:")).toEqual([{ text: "a " }]);
		expect(reader.end()).toEqual([{ text: "[[cite:" }]);
		expect(reader.end()).toEqual([]);
	});
});

describe("webSearch citations", () => {
	it("cites a result with a decodable index and at most 150 characters of its snippet", () => {
		const executor = webSearch({ provider: { search: async () => [] } });
		const long = "x".repeat(400);
		const citation = executor.cite({ type: "web_search_result", url: "https://a.test/p", title: "A", encrypted_content: seal(long) });
		expect(citation).toEqual({
			type: "web_search_result_location",
			url: "https://a.test/p",
			title: "A",
			encrypted_index: locate("https://a.test/p"),
			cited_text: "x".repeat(150)
		});
		expect(JSON.parse(Buffer.from(citation.encrypted_index, "base64url").toString())).toEqual({ url: "https://a.test/p" });
		expect(executor.cite({ url: "https://b.test" }).title).toBe("https://b.test");
		expect(executor.cite({ url: "https://b.test" }).cited_text).toBe("");
	});
	it("numbers the results it reads from an offset and tells the model how to cite", () => {
		const executor = webSearch({ provider: { search: async () => [] } });
		const content = [{ type: "web_search_result", url: "https://a.test", title: "A", encrypted_content: seal("about a") }];
		expect(executor.read(content)).toBe("1. A\nhttps://a.test\nabout a");
		expect(executor.read(content, 4)).toBe("5. A\nhttps://a.test\nabout a");
		expect(executor.description).toMatch(/\[\[cite:N\]\]/);
	});
});

describe("normalize", () => {
	it("accepts a cite function and rejects anything else", () => {
		const base = { type: "x_", schema: () => ({}), run: async () => ({ content: [] }) };
		expect(normalize([{ ...base, cite: () => ({}) }]).executors).toHaveLength(1);
		expect(() => normalize([{ ...base, cite: 1 }])).toThrow(/cite must be a function/);
	});
});

const chat = { url: "http://vllm.test", backend: "vllm", api: "chat", models: ["qwen3-coder"] };
const tool = { type: "web_search_20250305", name: "web_search" };
const ask = { model: "qwen3-coder", max_tokens: 64, messages: [{ role: "user", content: "find it" }], tools: [tool] };
const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
const long = "L".repeat(300);

/** A provider that answers each search with the results of `pages`, in turn. */
function provider(pages) {
	let turn = 0;
	return { name: "fake", search: async () => pages[turn++] };
}
const page = (...names) => names.map((n) => ({ url: `https://${n}.test/page`, title: n.toUpperCase(), snippet: `about ${n} ${long}` }));

const completion = (message, finish) => ({
	id: "c1",
	object: "chat.completion",
	created: 1,
	model: "qwen3-coder",
	choices: [{ index: 0, message: { role: "assistant", content: null, ...message }, finish_reason: finish }],
	usage
});
const callsSearch = (id, query, content = null) =>
	completion(
		{ content, tool_calls: [{ id, type: "function", function: { name: "web_search", arguments: JSON.stringify({ query }) } }] },
		"tool_calls"
	);
const says = (content, extra = {}) => completion({ content, ...extra }, "stop");

const base = { id: "chatcmpl-s", object: "chat.completion.chunk", created: 1, model: "qwen3-coder" };
const streamed = (parts, finish) => [
	{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
	...parts.map((delta) => ({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })),
	{ ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }] },
	{ ...base, choices: [], usage },
	"[DONE]"
];
const sse = (list) => ({ status: 200, body: openaiSse(list), headers: { "content-type": "text/event-stream" } });
const json = (body) => ({ status: 200, body });
const streamCall = (id, query) => [
	{ tool_calls: [{ index: 0, id, type: "function", function: { name: "web_search", arguments: JSON.stringify({ query }) } }] }
];

function script(replies) {
	let turn = 0;
	const transport = fakeTransport(() => replies[turn++]);
	transport.bodies = () => transport.calls.map((call) => JSON.parse(call.init.body));
	return transport;
}

/** The text blocks of a streamed reply as `{ text, citations }`, rebuilt from its events. */
function rebuilt(events) {
	const blocks = new Map();
	for (const { data } of events) {
		if (data.type === "content_block_start") blocks.set(data.index, { type: data.content_block.type, text: "", citations: [], open: true });
		if (data.type === "content_block_delta" && data.delta.type === "text_delta") blocks.get(data.index).text += data.delta.text;
		if (data.type === "content_block_delta" && data.delta.type === "citations_delta")
			blocks.get(data.index).citations.push(data.delta.citation);
		if (data.type === "content_block_stop") blocks.get(data.index).open = false;
	}
	return [...blocks.entries()].map(([index, { open, ...block }]) => ({ index, open, ...block }));
}

describe("an answer with citations, not streamed", () => {
	it("numbers results across searches and turns markers into web_search_result_location blocks", async () => {
		const transport = script([
			json(callsSearch("c1", "a")),
			json(callsSearch("c2", "b", "Looking again [[cite:1]].")),
			json(says("Alpha is old[[cite:1]]. Gamma is new [[cite:3]][[cite:2]]. Unknown[[cite:7]] and the end."))
		]);
		const serverTools = [webSearch({ provider: provider([page("a", "b"), page("c")]) })];
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools });
		const reply = await api.send(ask);
		const bodies = transport.bodies();
		expect(bodies[0].tools[0].function.description).toMatch(/\[\[cite:N\]\]/);
		expect(bodies[1].messages.at(-1).content).toMatch(/^1\. A\nhttps:\/\/a\.test\/page\nabout a L+\n\n2\. B\n/);
		expect(bodies[2].messages.at(-1).content).toMatch(/^3\. C\nhttps:\/\/c\.test\/page\nabout c /);
		const content = reply.body.content;
		const shape = content.map((block) => [block.type, block.text, block.citations?.map((c) => c.title)]);
		expect(shape).toEqual([
			["server_tool_use", undefined, undefined],
			["web_search_tool_result", undefined, undefined],
			// The round that called the second search could name only the results read before it.
			["text", "Looking again ", ["A"]],
			["text", ".", undefined],
			["server_tool_use", undefined, undefined],
			["web_search_tool_result", undefined, undefined],
			["text", "Alpha is old", ["A"]],
			["text", ". ", undefined],
			["text", "Gamma is new ", ["C", "B"]],
			["text", ". Unknown[[cite:7]] and the end.", undefined]
		]);
		expect(content[6].citations[0]).toEqual({
			type: "web_search_result_location",
			url: "https://a.test/page",
			title: "A",
			encrypted_index: locate("https://a.test/page"),
			cited_text: `about a ${long}`.slice(0, 150)
		});
	});

	it("leaves the answer alone when no search ran or the text has no marker", async () => {
		const serverTools = [webSearch({ provider: provider([page("a")]) })];
		const transport = script([json(says("No search, but [[cite:1]] here.")), json(callsSearch("c1", "a")), json(says("Plain answer."))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools });
		expect((await api.send(ask)).body.content).toEqual([{ type: "text", text: "No search, but [[cite:1]] here." }]);
		expect((await api.send(ask)).body.content.at(-1)).toEqual({ type: "text", text: "Plain answer." });
	});

	it("does not touch a text block that already has citations", async () => {
		const serverTools = [webSearch({ provider: provider([page("a")]) })];
		const annotation = { type: "url_citation", url_citation: { url: "https://z.test", title: "Z", start_index: 0, end_index: 15 } };
		const transport = script([json(callsSearch("c1", "a")), json(says("Text [[cite:1]]", { annotations: [annotation] }))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools });
		const text = (await api.send(ask)).body.content.at(-1);
		expect(text.text).toBe("Text [[cite:1]]");
		expect(text.citations).toHaveLength(1);
	});
});

describe("an answer with citations, streamed", () => {
	it("holds only a possible marker, cites on the open block and starts a new block after it", async () => {
		const parts = [
			{ content: "Alpha is old [[ci" },
			{ content: "te:1" },
			{ content: "]] and more [[cite:2]]" },
			{ content: " [[cite:" },
			{ content: "1]]" },
			{ content: " Then [x [[cite:9]] and [[cite:3]]" },
			{ content: "  " },
			{ content: "tail [[ci" }
		];
		const transport = script([sse(streamed(streamCall("c1", "a"), "tool_calls")), sse(streamed(parts, "stop"))]);
		const serverTools = [webSearch({ provider: provider([page("a", "b", "c")]) })];
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools });
		const reply = await api.send({ ...ask, stream: true });
		const events = await collect(reply.stream);
		const text = rebuilt(events).filter((block) => block.type === "text");
		expect(text.map(({ text: t, citations }) => [t, citations.map((c) => c.title)])).toEqual([
			["Alpha is old ", ["A"]],
			[" and more ", ["B", "A"]],
			[" Then [x [[cite:9]] and ", ["C"]],
			["  tail [[ci", []]
		]);
		expect(text.every((block) => block.open === false)).toBe(true);
		// Indexes run on from the tool blocks (0 and 1) without gaps.
		expect(text.map((block) => block.index)).toEqual([2, 3, 4, 5]);
		expect(events.at(-1).data.type).toBe("message_stop");
		expect(await reply.usage).toBeDefined();
	});

	it("drops a marker that has no text before it in its block and passes other deltas on", async () => {
		const annotation = { type: "url_citation", url_citation: { url: "https://z.test", title: "Z", start_index: 0, end_index: 3 } };
		const parts = [{ content: " " }, { content: "[[cite:1]]Fact" }, { content: "", annotations: [annotation] }, { content: "[[cite:1]]" }];
		const transport = script([sse(streamed(streamCall("c1", "a"), "tool_calls")), sse(streamed(parts, "stop"))]);
		const serverTools = [webSearch({ provider: provider([page("a")]) })];
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools });
		const reply = await api.send({ ...ask, stream: true });
		const events = await collect(reply.stream);
		const [block] = rebuilt(events).filter((b) => b.type === "text");
		expect(block.text).toBe(" Fact");
		expect(block.citations.map((c) => c.type)).toEqual(expect.arrayContaining(["web_search_result_location"]));
	});

	it("leaves the text of a round that ran before any search alone", async () => {
		const transport = script([
			sse(streamed([{ content: "Before [[cite:1]]" }, ...streamCall("c1", "a")], "tool_calls")),
			sse(streamed([{ content: "After" }], "stop"))
		]);
		const serverTools = [webSearch({ provider: provider([page("a")]) })];
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools });
		const events = await collect((await api.send({ ...ask, stream: true })).stream);
		expect(rebuilt(events).filter((b) => b.type === "text")).toMatchObject([
			{ text: "Before [[cite:1]]", citations: [] },
			{ text: "After", citations: [] }
		]);
	});
});

describe("a replayed history", () => {
	const hit = (n, extra = {}) => ({
		type: "web_search_result",
		url: `https://h${n}.test`,
		title: `H${n}`,
		encrypted_content: seal(`snippet ${n}`),
		page_age: null,
		...extra
	});
	const turnOf = (id, results) => [
		{ type: "server_tool_use", id, name: "web_search", input: { query: id } },
		{ type: "web_search_tool_result", tool_use_id: id, content: results }
	];
	const past = [
		{ role: "user", content: "first" },
		{
			role: "assistant",
			content: [
				...turnOf("srvtoolu_1", [hit(1), hit(2)]),
				{
					type: "text",
					text: "It is so.",
					citations: [
						{ type: "web_search_result_location", url: "https://h1.test", title: "H1", encrypted_index: "x", cited_text: "s" },
						{ type: "char_location", cited_text: "c", document_index: 0, start_char_index: 0, end_char_index: 1 }
					]
				},
				{
					type: "text",
					text: "Also.",
					citations: [{ type: "web_search_result_location", url: "https://h2.test", title: "H2", cited_text: "s" }]
				},
				{ type: "text", text: "Plain." }
			]
		},
		{ role: "user", content: "second" },
		{
			role: "assistant",
			content: [
				...turnOf("srvtoolu_2", [{ type: "web_search_result", url: "https://f.test" }]),
				{ type: "tool_use", id: "tu", name: "mine", input: {} }
			]
		},
		{ role: "assistant", content: [...turnOf("srvtoolu_3", { type: "web_search_tool_result_error", error_code: "unavailable" })] },
		{ role: "user", content: "third" }
	];

	it("lists the sources of the history in order and numbers its results across messages", async () => {
		const executor = webSearch({ provider: { search: async () => [] } });
		const plan = { tools: new Map([["web_search", { tool, executor }]]) };
		const list = sources(past, plan);
		expect(list.map((c) => [c.url, c.title])).toEqual([
			["https://h1.test", "H1"],
			["https://h2.test", "H2"],
			["https://f.test", "https://f.test"]
		]);
		const out = history(past, plan);
		const results = out
			.flatMap((message) => (Array.isArray(message.content) ? message.content : []))
			.filter((b) => b.type === "tool_result");
		expect(results.map((r) => r.content.split("\n")[0])).toEqual(["1. H1", expect.stringMatching(/^3\. /), expect.stringMatching(/^\{/)]);
		const texts = out.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "text");
		expect(texts.map((b) => b.citations?.map((c) => c.type))).toEqual([["char_location"], undefined, undefined]);
		// Without a plan the blocks are left as they are.
		const plain = history(past).flatMap((m) => (Array.isArray(m.content) ? m.content : []));
		expect(plain.find((b) => b.text === "Also.").citations).toHaveLength(1);
	});

	it("lets a new answer cite results of the history and continues the numbering in new searches", async () => {
		const serverTools = [webSearch({ provider: provider([page("n")]) })];
		const messages = [...past.slice(0, 3), { role: "user", content: "again" }];
		const transport = script([json(callsSearch("c1", "n")), json(says("Old[[cite:2]] and new[[cite:3]]."))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools });
		const reply = await api.send({ ...ask, messages });
		expect(transport.bodies()[1].messages.at(-1).content).toMatch(/^3\. N\n/);
		const cited = reply.body.content.filter((b) => b.citations);
		expect(cited.map((b) => b.citations[0].title)).toEqual(["H2", "N"]);
	});

	it("reads markers in the first round of a streamed answer when the history has sources", async () => {
		const serverTools = [webSearch({ provider: provider([]) })];
		const transport = script([sse(streamed([{ content: "From before[[cite:1]]" }], "stop"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools });
		const events = await collect((await api.send({ ...ask, messages: past.slice(0, 3), stream: true })).stream);
		const [block] = rebuilt(events).filter((b) => b.type === "text");
		expect(block).toMatchObject({ text: "From before", citations: [{ title: "H1" }] });
	});
});
