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
	createBudget,
	createThinkSplitter,
	detailOf,
	detailsText,
	isOurs,
	mergeDetail,
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
		const big = {
			reasoning_content: Array.from(
				{ length: 4000 },
				(_, i) => `step ${(i * 7919) % 1000} weighs option ${i % 13} against ${(i * 31) % 97}`
			).join(". ")
		};
		const packed = sign(big);
		expect(packed.startsWith("llmt:~")).toBe(true);
		expect(packed.length).toBeLessThan(big.reasoning_content.length / 2);
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
		expect(blocksOf([detailOf(thinking, 0), detailOf(redacted, 3)])).toEqual([
			{ at: 0, block: thinking },
			{ at: 3, block: redacted }
		]);
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
		expect(blocksOf(hostile)).toEqual([{ at: 0, block: { type: "thinking", thinking: "keep", signature: "s" } }]);
		expect(blocksOf([{ type: "reasoning.text", format: ANTHROPIC_FORMAT, text: "t", signature: "s", index: -1 }])[0].at).toBe(0);
		expect(blocksOf("nope")).toEqual([]);
		expect(blocksOf(Array.from({ length: 100 }, () => detailOf(thinking, 0)))).toHaveLength(64);
		const huge = { type: "reasoning.text", format: ANTHROPIC_FORMAT, text: "x".repeat(1024 * 1024), signature: "s" };
		expect(blocksOf([huge, { type: "reasoning.encrypted", format: ANTHROPIC_FORMAT, data: "d" }])).toEqual([]);
	});
});

describe("limits on signatures", () => {
	const wrap = (json) => `llmt:${Buffer.from(json).toString("base64url")}`;
	const packedOf = (obj) => `llmt:~${deflateRawSync(Buffer.from(JSON.stringify(obj))).toString("base64url")}`;

	test("sign() applies the limits unsign() enforces, and writes the plain marker when they are exceeded", () => {
		const marker = sign();
		expect(sign({ reasoning_content: "x".repeat(600 * 1024) })).toBe(marker);
		expect(sign({ reasoning_details: Array.from({ length: 300 }, () => ({ a: 1 })) })).toBe(marker);
		expect(sign({ reasoning_details: [{ a: { b: { c: { d: { e: { f: 1 } } } } } }] })).toBe(marker);
		expect(sign({ reasoning_details: [{ "bad key": 1 }] })).toBe(marker);
		expect(sign({ reasoning_details: ["no"] })).toBe(marker);
		expect(sign({ reasoning_content: "a", reasoning: "b" })).toBe(marker);
		expect(sign({ reasoning_content: 5 })).toBe(marker);
		expect(sign({ role: "system" })).toBe(marker);
		expect(sign([])).toBe(marker);
		expect(sign({ reasoning_content: "x" }, "p:q")).not.toBe(marker);
		// Several 500 KiB strings together exceed the 1 MiB JSON limit.
		const half = "y".repeat(500 * 1024);
		expect(sign({ reasoning_details: [{ text: half }, { text: half }, { text: half }] })).toBe(marker);
	});

	test("text that compresses more than 30 to 1 is written unpacked, and still round-trips", async () => {
		const flat = { reasoning_content: "a".repeat(100000) };
		const signature = sign(flat);
		expect(signature.startsWith("llmt:~")).toBe(false);
		expect(await unsign(signature)).toEqual(flat);
	});

	test("a signature inflating beyond 30 to 1 is refused while it inflates", async () => {
		const bomb = packedOf({ v: 1, d: { reasoning_content: "a".repeat(200000) } });
		expect(await unsign(bomb)).toBeNull();
	});

	test("the per-request budget caps the bytes inflated and the signatures decoded", async () => {
		const text = (n) => Array.from({ length: n }, (_, i) => `thought ${(i * 7919) % 1000} about ${i % 13}`).join(" ");
		const budget = { ...createBudget(), bytes: 200000, signatures: 100 };
		const results = [];
		for (let i = 0; i < 5; i++) results.push(await unsign(sign({ reasoning_content: `${i} ${text(9000)}` }), { budget }));
		const accepted = results.filter(Boolean).length;
		expect(accepted).toBeGreaterThan(0);
		expect(accepted).toBeLessThan(5);
		expect(results.slice(accepted).every((entry) => entry === null)).toBe(true);
		const few = { ...createBudget(), signatures: 2 };
		const small = sign({ reasoning_content: "x" });
		expect(
			[
				await unsign(small, { budget: few }),
				await unsign(sign({ reasoning_content: "y" }), { budget: few }),
				await unsign(sign({ reasoning_content: "z" }), { budget: few })
			].map(Boolean)
		).toEqual([true, true, false]);
		expect(await unsign(small, { budget: { ...createBudget(), bytes: 0, signatures: 5 } })).toBeNull();
		expect(
			await unsign(sign({ reasoning_content: "x".repeat(100) }), { budget: { ...createBudget(), bytes: 10, signatures: 5 } })
		).toBeNull();
		// Many small bombs share one budget and are all refused by the ratio, so none of them inflates a megabyte.
		const bombs = Array.from({ length: 200 }, (_, i) => packedOf({ v: 1, d: { reasoning_content: `${i}${"a".repeat(400000)}` } }));
		const shared = createBudget();
		const decoded = [];
		for (const entry of bombs) decoded.push(await unsign(entry, { budget: shared }));
		expect(decoded.every((entry) => entry === null)).toBe(true);
		// Each refusal was charged, and after eight of them nothing more was decoded.
		expect(shared.failures).toBe(0);
		expect(shared.signatures).toBe(1024 - 8);
		expect(shared.bytes).toBeGreaterThanOrEqual(0);
	});

	test("data is bound to the producer that signed it", async () => {
		const bound = sign({ reasoning_content: "x" }, "deepseek:openai.chat");
		expect(await unsign(bound, { producer: "deepseek:openai.chat" })).toEqual({ reasoning_content: "x" });
		expect(await unsign(bound, { producer: "compatible:openai.chat" })).toBeNull();
		expect(await unsign(bound)).toBeNull();
		// A payload with no producer is only for a caller with no producer, and the other way round.
		expect(await unsign(sign({ reasoning_content: "x" }), { producer: "deepseek:openai.chat" })).toBeNull();
		expect(await unsign(sign({ reasoning_content: "x" }))).toEqual({ reasoning_content: "x" });
		expect(await unsign(wrap(JSON.stringify({ v: 1, p: 5, d: { reasoning: "x" } })), { producer: "5" })).toBeNull();
	});

	test("a signature with both text fields is not one this translator wrote", async () => {
		expect(await unsign(wrap(JSON.stringify({ v: 1, d: { reasoning_content: "a", reasoning: "b" } })))).toBeNull();
	});
});

describe("mergeDetail", () => {
	test("fragments with the same index and type become one item", () => {
		const list = [];
		for (const fragment of [
			{ type: "reasoning.text", index: 0, text: "ab", format: "f" },
			{ type: "reasoning.text", index: 0, text: "cd" },
			{ type: "reasoning.text", index: 0, signature: "sig" },
			{ type: "reasoning.summary", index: 0, summary: "s1" },
			{ type: "reasoning.summary", index: 0, summary: "s2" },
			{ type: "reasoning.encrypted", index: 1, id: "e1" },
			{ type: "reasoning.encrypted", index: 1, data: "AA" },
			{ type: "reasoning.encrypted", index: 1, data: "" },
			{ type: "reasoning.text", text: "no index" },
			{ type: "reasoning.text", text: "no index either" },
			null,
			"x",
			[]
		]) {
			mergeDetail(list, fragment);
		}
		expect(list).toEqual([
			{ type: "reasoning.text", index: 0, text: "abcd", format: "f", signature: "sig" },
			{ type: "reasoning.summary", index: 0, summary: "s1s2" },
			{ type: "reasoning.encrypted", index: 1, id: "e1", data: "AA" },
			{ type: "reasoning.text", text: "no index" },
			{ type: "reasoning.text", text: "no index either" }
		]);
		const odd = [{ type: "reasoning.text", index: 0 }];
		mergeDetail(odd, { type: "reasoning.text", index: 0, text: "x" });
		expect(odd[0].text).toBe("x");
	});
});

describe("failed decodes still cost", () => {
	const bomb = (n) =>
		`llmt:~${deflateRawSync(Buffer.from(JSON.stringify({ v: 1, d: { reasoning_content: `${n}${"a".repeat(300000)}` } }))).toString("base64url")}`;

	test("over-limit signatures are charged before inflating and stop decoding after a few failures", async () => {
		const budget = createBudget();
		const results = [];
		for (let i = 0; i < 100; i++) results.push(await unsign(bomb(i), { budget }));
		expect(results.every((entry) => entry === null)).toBe(true);
		// Eight failures, then nothing more is decoded, so the rest cost nothing at all.
		expect(budget.failures).toBe(0);
		expect(budget.signatures).toBe(1024 - 8);
		expect(budget.bytes).toBeLessThan(8 * 1024 * 1024);
		const good = sign({ reasoning_content: "still fine" });
		expect(await unsign(good, { budget })).toBeNull();
	});

	test("an attempt is charged up front: signatures that would inflate a lot exhaust the byte budget", async () => {
		const budget = { ...createBudget(), bytes: 100000, failures: 100 };
		const filler = Array.from({ length: 6000 }, (_, i) => `n${(i * 7919) % 9973}`).join(" ");
		const large = sign({ reasoning_content: filler });
		expect(large.startsWith("llmt:~")).toBe(true);
		expect(await unsign(large, { budget })).not.toBeNull();
		const spent = 100000 - budget.bytes;
		expect(spent).toBeGreaterThan(0);
		expect(spent).toBeLessThan(80000);
		// A flood of different signatures that each could expand to the limit drains what is left, then fails.
		const outcomes = [];
		for (let i = 0; i < 20; i++) outcomes.push(await unsign(sign({ reasoning_content: `${i} ${filler}` }), { budget }));
		expect(outcomes.some((entry) => entry === null)).toBe(true);
		expect(budget.bytes).toBeGreaterThanOrEqual(0);
	});

	test("results are cached per producer and signature, so converting a request again is free", async () => {
		const budget = createBudget();
		const signature = sign({ reasoning_content: "x" }, "p:q:h");
		expect(await unsign(signature, { producer: "p:q:h", budget })).toEqual({ reasoning_content: "x" });
		const before = { ...budget, cache: undefined };
		expect(await unsign(signature, { producer: "p:q:h", budget })).toEqual({ reasoning_content: "x" });
		expect({ ...budget, cache: undefined }).toEqual(before);
		// The same signature for another producer is a separate (refused) decode.
		expect(await unsign(signature, { producer: "p:q:other", budget })).toBeNull();
		expect(budget.signatures).toBe(before.signatures - 1);
	});

	test("concurrent decodes on one budget queue, stop at the failure limit and never go negative", async () => {
		const budget = createBudget();
		const bombs = Array.from({ length: 200 }, (_, i) => bomb(i));
		const outcomes = await Promise.all(bombs.map((entry) => unsign(entry, { budget })));
		expect(outcomes.every((entry) => entry === null)).toBe(true);
		expect(budget.failures).toBe(0);
		expect(budget.signatures).toBe(1024 - 8);
		expect(budget.bytes).toBeGreaterThanOrEqual(0);
		const mixed = createBudget();
		const good = Array.from({ length: 5 }, (_, i) => sign({ reasoning_content: `part ${i}` }));
		const results = await Promise.all([...good, good[0], good[1]].map((entry) => unsign(entry, { budget: mixed })));
		expect(results.map((entry) => entry?.reasoning_content)).toEqual([
			"part 0",
			"part 1",
			"part 2",
			"part 3",
			"part 4",
			"part 0",
			"part 1"
		]);
		// The two repeated signatures were answered from the cache, not decoded again.
		expect(mixed.signatures).toBe(1024 - 5);
	});

	test("sign measures its limits in bytes", () => {
		const wide = "\u00e9".repeat(300000);
		expect(Buffer.byteLength(wide)).toBe(600000);
		expect(sign({ reasoning_details: [{ text: wide }, { text: wide }, { text: wide }] })).toBe(sign());
	});
});
