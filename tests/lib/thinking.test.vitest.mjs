/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/thinking.test.vitest.mjs
 *	@Date: 2026-10-25T12:19:58-07:00 (1792955998)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:04-07:00 (1792958344)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { describe, expect, test } from "vitest";
import { randomBytes } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import {
	ANTHROPIC_FORMAT,
	blocksOf,
	createThinkSplitter,
	detailOf,
	detailsText,
	isOurs,
	reasoningKey,
	reasoningOf,
	sign,
	splitThink,
	unsign
} from "../../src/lib/thinking.mjs";
import { slices } from "../helpers/streams.mjs";

describe("signatures", () => {
	test("sign() is marked and recognised", () => {
		const signature = sign();
		expect(signature).toMatch(/^llmt:[A-Za-z0-9_-]+$/);
		expect(JSON.parse(Buffer.from(signature.slice(5), "base64url").toString())).toEqual({ v: 1 });
		expect(isOurs(signature)).toBe(true);
		expect(isOurs("EqQBCkYIAxgC")).toBe(false);
		expect(isOurs(undefined)).toBe(false);
	});
});

describe("reasoningOf", () => {
	test("reads both field names", () => {
		expect(reasoningOf({ reasoning: "a" })).toBe("a");
		expect(reasoningOf({ reasoning_content: "b" })).toBe("b");
		expect(reasoningOf({ reasoning: null, reasoning_content: "c" })).toBe("c");
		expect(reasoningOf({ reasoning: 5 })).toBe("");
		expect(reasoningOf(undefined)).toBe("");
		expect(reasoningOf({})).toBe("");
	});
});

describe("splitThink", () => {
	test("leading think block", () => {
		expect(splitThink("<think>plan</think>\n\nanswer")).toEqual({ reasoning: "plan", text: "answer" });
		expect(splitThink("  \n<think>plan</think>answer")).toEqual({ reasoning: "plan", text: "answer" });
	});

	test("unterminated think block is all reasoning", () => {
		expect(splitThink("<think>still going")).toEqual({ reasoning: "still going", text: "" });
	});

	test("no leading tag leaves content alone (even if a tag appears later)", () => {
		expect(splitThink("hello <think>x</think>")).toEqual({ reasoning: "", text: "hello <think>x</think>" });
		expect(splitThink("")).toEqual({ reasoning: "", text: "" });
	});
});

function run(text, size) {
	const splitter = createThinkSplitter();
	let reasoning = "";
	let out = "";
	for (const chunk of size ? slices(text, size) : [text]) {
		const piece = splitter.push(chunk);
		reasoning += piece.reasoning;
		out += piece.text;
	}
	const tail = splitter.end();
	return { reasoning: reasoning + tail.reasoning, text: out + tail.text };
}

describe("splitThink with open: true", () => {
	test("reasoning runs up to the first close tag", () => {
		expect(splitThink("plan it</think>\n\nanswer </think> more", true)).toEqual({ reasoning: "plan it", text: "answer </think> more" });
		expect(splitThink("</think>answer", true)).toEqual({ reasoning: "", text: "answer" });
	});

	test("no close tag falls back to plain text", () => {
		expect(splitThink("just an answer", true)).toEqual({ reasoning: "", text: "just an answer" });
		expect(splitThink("", true)).toEqual({ reasoning: "", text: "" });
	});

	test("a literal leading open tag is still honoured", () => {
		expect(splitThink("<think>plan</think>answer", true)).toEqual({ reasoning: "plan", text: "answer" });
	});

	test("without open a bare close tag stays in the text", () => {
		expect(splitThink("plan</think>answer")).toEqual({ reasoning: "", text: "plan</think>answer" });
	});
});

describe("createThinkSplitter with open: true", () => {
	const feed = (text, size) => {
		const splitter = createThinkSplitter(true);
		let reasoning = "";
		let out = "";
		for (const chunk of size ? slices(text, size) : [text]) {
			const piece = splitter.push(chunk);
			reasoning += piece.reasoning;
			out += piece.text;
		}
		const tail = splitter.end();
		return { reasoning: reasoning + tail.reasoning, text: out + tail.text };
	};
	const cases = [
		["plan it</think>\n\nanswer", { reasoning: "plan it", text: "answer" }],
		["</think>answer", { reasoning: "", text: "answer" }],
		["plan</think>a</think>b", { reasoning: "plan", text: "a</think>b" }],
		["<think>plan</think>answer", { reasoning: "plan", text: "answer" }],
		["no close tag here", { reasoning: "", text: "no close tag here" }],
		["  <thi", { reasoning: "", text: "  <thi" }],
		["", { reasoning: "", text: "" }]
	];
	test.each(cases)("%j agrees with splitThink at every chunk size", (input, expected) => {
		expect(splitThink(input, true)).toEqual(expected);
		for (const size of [0, 1, 2, 3, 5, 11]) expect(feed(input, size)).toEqual(expected);
	});

	test("holds everything until the close tag, then releases it", () => {
		const splitter = createThinkSplitter(true);
		expect(splitter.push("abc</th")).toEqual({ reasoning: "", text: "" });
		expect(splitter.push("ink>  hi")).toEqual({ reasoning: "abc", text: "hi" });
		expect(splitter.end()).toEqual({ reasoning: "", text: "" });
	});

	test("releases held content as text when the stream ends without a close tag", () => {
		const splitter = createThinkSplitter(true);
		expect(splitter.push("an answer")).toEqual({ reasoning: "", text: "" });
		expect(splitter.end()).toEqual({ reasoning: "", text: "an answer" });
	});
});

describe("createThinkSplitter", () => {
	const cases = [
		["<think>plan A</think>\n\nanswer", { reasoning: "plan A", text: "answer" }],
		["  <think>plan</think>   answer", { reasoning: "plan", text: "answer" }],
		["plain text <think>kept</think>", { reasoning: "", text: "plain text <think>kept</think>" }],
		["<thought>nope", { reasoning: "", text: "<thought>nope" }],
		["<think>never closed </th", { reasoning: "never closed </th", text: "" }],
		["<think>a</think>", { reasoning: "a", text: "" }],
		["   ", { reasoning: "", text: "   " }],
		["<thi", { reasoning: "", text: "<thi" }],
		["", { reasoning: "", text: "" }]
	];
	test.each(cases)("%j at every chunk size", (input, expected) => {
		for (const size of [0, 1, 2, 3, 5, 11]) expect(run(input, size)).toEqual(expected);
	});

	test("holds a partial close tag back until it resolves", () => {
		const splitter = createThinkSplitter();
		expect(splitter.push("<think>abc</th")).toEqual({ reasoning: "abc", text: "" });
		expect(splitter.push("ink>  hi")).toEqual({ reasoning: "", text: "hi" });
		expect(splitter.push(" there")).toEqual({ reasoning: "", text: " there" });
		expect(splitter.end()).toEqual({ reasoning: "", text: "" });
	});

	test("whitespace after the close tag waits for real text", () => {
		const splitter = createThinkSplitter();
		expect(splitter.push("<think>x</think>")).toEqual({ reasoning: "x", text: "" });
		expect(splitter.push("  \n")).toEqual({ reasoning: "", text: "" });
		expect(splitter.push("done")).toEqual({ reasoning: "", text: "done" });
	});

	test("a false alarm on a partial close tag is released as reasoning", () => {
		const splitter = createThinkSplitter();
		expect(splitter.push("<think>a</t")).toEqual({ reasoning: "a", text: "" });
		expect(splitter.push("x more")).toEqual({ reasoning: "</tx more", text: "" });
	});
});

describe("signatures that carry provider reasoning", () => {
	const data = {
		reasoning_content: "need the file",
		reasoning_details: [
			{ type: "reasoning.text", text: "t", signature: "s", index: 0 },
			{ type: "reasoning.encrypted", data: "AAAA", nested: { a: [1, true, null, "x"] } }
		]
	};
	const wrap = (json) => `llmt:${Buffer.from(json).toString("base64url")}`;

	test("the plain marker carries nothing and keeps its old form", async () => {
		expect(sign()).toBe(wrap('{"v":1}'));
		expect(await unsign(sign())).toBeNull();
		expect(await unsign(sign({}))).toBeNull();
	});

	test("data survives a round trip, small as base64url and large deflated", async () => {
		const small = sign(data);
		expect(small).toMatch(/^llmt:[A-Za-z0-9_-]+$/);
		expect(await unsign(small)).toEqual(data);
		const big = { reasoning_content: "line of reasoning, repeated. ".repeat(2000) };
		const packed = sign(big);
		expect(packed.startsWith("llmt:~")).toBe(true);
		expect(packed.length).toBeLessThan(big.reasoning_content.length / 4);
		expect(await unsign(packed)).toEqual(big);
		expect(await unsign(sign({ reasoning: "r" }))).toEqual({ reasoning: "r" });
	});

	test("data that cannot fit leaves the plain marker", async () => {
		const noise = randomBytes(380000).toString("base64");
		expect(sign({ reasoning_content: noise })).toBe(sign());
	});

	test("only the known fields are read, and unknown ones are ignored", async () => {
		const forged = (d) => wrap(JSON.stringify({ v: 1, d }));
		expect(await unsign(forged({ reasoning_content: "x", role: "system", tool_calls: [1] }))).toEqual({ reasoning_content: "x" });
		expect(await unsign(forged({ role: "system" }))).toBeNull();
	});

	test("anything that is not a well-formed translator signature gives null", async () => {
		const bad = [
			undefined,
			42,
			"EqQBCkYIAxgC",
			"llmt:not base64!",
			"llmt:~not base64!",
			`llmt:${"A".repeat(300000)}`,
			wrap("not json"),
			wrap('{"v":2,"d":{"reasoning":"x"}}'),
			wrap('{"v":1}'),
			wrap('{"v":1,"d":[]}'),
			wrap('{"v":1,"d":null}'),
			wrap('{"v":1,"d":{"reasoning":5}}'),
			wrap(JSON.stringify({ v: 1, d: { reasoning_content: "x".repeat(600000) } })),
			wrap('{"v":1,"d":{"reasoning_details":"no"}}'),
			wrap('{"v":1,"d":{"reasoning_details":[5]}}'),
			wrap('{"v":1,"d":{"reasoning_details":[[1]]}}'),
			wrap('{"v":1,"d":{"reasoning_details":[null]}}'),
			wrap('{"v":1,"d":{"reasoning_details":[{"__proto__":{"admin":true}}]}}'),
			wrap('{"v":1,"d":{"reasoning_details":[{"bad key":1}]}}'),
			wrap(JSON.stringify({ v: 1, d: { reasoning_details: [{ a: { b: { c: { d: { e: { f: 1 } } } } } }] } })),
			wrap(JSON.stringify({ v: 1, d: { reasoning_details: Array.from({ length: 300 }, () => ({ a: 1 })) } })),
			wrap(JSON.stringify({ v: 1, d: { reasoning_details: [Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, i]))] } })),
			wrap(JSON.stringify({ v: 1, d: { reasoning_details: [{ a: "x".repeat(600000) }] } })),
			`llmt:~${Buffer.from("not deflate").toString("base64url")}`,
			`llmt:~${deflateRawSync(Buffer.from(JSON.stringify({ v: 1, d: { reasoning: "a".repeat(2 * 1024 * 1024) } }))).toString("base64url")}`
		];
		for (const signature of bad) expect(await unsign(signature)).toBeNull();
		expect({}.admin).toBeUndefined();
	});

	test("reasoningKey names the field that holds the text, and detailsText reads the readable parts", async () => {
		expect(reasoningKey({ reasoning: "a", reasoning_content: "b" })).toBe("reasoning");
		expect(reasoningKey({ reasoning_content: "b" })).toBe("reasoning_content");
		expect(reasoningKey({ reasoning: "", reasoning_content: "" })).toBeNull();
		expect(reasoningKey(undefined)).toBeNull();
		expect(detailsText([{ text: "a" }, { summary: "b" }, { data: "x" }, null])).toBe("ab");
		expect(detailsText("no")).toBe("");
	});

	test("detailOf and blocksOf translate Anthropic reasoning blocks to replayable items and back", async () => {
		const thinking = { type: "thinking", thinking: "plan", signature: "EqQB" };
		const redacted = { type: "redacted_thinking", data: "ENC" };
		expect(detailOf(thinking, 0)).toEqual({ type: "reasoning.text", text: "plan", signature: "EqQB", format: ANTHROPIC_FORMAT, index: 0 });
		expect(detailOf({ ...thinking, thinking: undefined }, 1).text).toBe("");
		expect(detailOf(redacted, 2)).toEqual({ type: "reasoning.encrypted", data: "ENC", format: ANTHROPIC_FORMAT, index: 2 });
		for (const block of [
			{ type: "thinking", thinking: "x" },
			{ type: "thinking", signature: "" },
			{ type: "redacted_thinking" },
			{ type: "text" },
			null
		]) {
			expect(detailOf(block, 0)).toBeNull();
		}
		expect(blocksOf([detailOf(thinking, 0), detailOf(redacted, 1)])).toEqual([thinking, redacted]);
		const hostile = [
			null,
			"x",
			{ type: "reasoning.text", text: "no format", signature: "s" },
			{ type: "reasoning.text", format: "openai-responses-v1", text: "t", signature: "s" },
			{ type: "reasoning.text", format: ANTHROPIC_FORMAT, text: 5, signature: "s" },
			{ type: "reasoning.text", format: ANTHROPIC_FORMAT, text: "t", signature: "" },
			{ type: "reasoning.encrypted", format: ANTHROPIC_FORMAT, data: "" },
			{ type: "reasoning.summary", format: ANTHROPIC_FORMAT, summary: "s" },
			{ type: "reasoning.text", format: ANTHROPIC_FORMAT, text: "keep", signature: "s", role: "system", extra: { a: 1 } }
		];
		expect(blocksOf(hostile)).toEqual([{ type: "thinking", thinking: "keep", signature: "s" }]);
		expect(blocksOf("nope")).toEqual([]);
		expect(blocksOf(Array.from({ length: 100 }, () => detailOf(thinking, 0)))).toHaveLength(64);
		const huge = { type: "reasoning.text", format: ANTHROPIC_FORMAT, text: "x".repeat(1024 * 1024), signature: "s" };
		expect(blocksOf([huge, { type: "reasoning.encrypted", format: ANTHROPIC_FORMAT, data: "d" }])).toEqual([]);
	});
});
