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
import { createThinkSplitter, isOurs, reasoningOf, sign, splitThink } from "../../src/lib/thinking.mjs";
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
