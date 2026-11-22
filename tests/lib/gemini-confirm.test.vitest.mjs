/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/gemini-confirm.test.vitest.mjs
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
 * @fileoverview The confirmation of actions Gemini flags: canonical text and hashes, the line that names a call, the tool that asks, how an answer is read, and how the history is resolved.
 */
import { describe, expect, it } from "vitest";
import {
	DECLINED,
	MARK,
	allowed,
	canonical,
	hashOf,
	idOf,
	inputOf,
	lineOf,
	parseLine,
	plainText,
	questionOf,
	resolve,
	toolOf
} from "../../src/lib/gemini-confirm.mjs";

const asker = (name = "AskUserQuestion") => ({
	name,
	input_schema: { properties: { questions: { items: { properties: { question: {}, header: {}, options: {}, multiSelect: {} } } } } }
});
const args = { y: 2, x: [1, { b: null, a: true }] };
const id = idOf("g1", "click", args);
const ask = (line = lineOf("click", args), toolId = id) => ({
	role: "assistant",
	content: [
		{ type: "text", text: `Hello.\n\n${line}` },
		{ type: "tool_use", id: toolId, name: "AskUserQuestion", input: {} }
	]
});
const reply = (text, toolId = id) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: toolId, content: text }] });
const actions = new Set(["computer"]);

describe("the text of a call", () => {
	it("writes the same JSON for the same call whatever the order of its keys", () => {
		expect(canonical(args)).toBe('{"x":[1,{"a":true,"b":null}],"y":2}');
		expect(canonical(undefined)).toBe("null");
		expect(hashOf("click", { x: 1, y: 2 })).toBe(hashOf("click", { y: 2, x: 1 }));
		expect(hashOf("click", {})).not.toBe(hashOf("type", {}));
		expect(hashOf("click", {})).toMatch(/^[0-9a-f]{8}$/);
		expect(MARK.exec(id)[1]).toBe(hashOf("click", args));
	});

	it("finds the line that names a call in a text, and nothing in any other text", () => {
		const found = parseLine(`Looking.\n\n${lineOf("click", args)}\nmore`);
		expect(found).toEqual({ name: "click", args: { x: [1, { a: true, b: null }], y: 2 }, line: lineOf("click", args) });
		for (const text of [
			"nothing",
			"Gemini wants to run click",
			"Gemini wants to run  {}",
			"Gemini wants to run click {nope",
			"Gemini wants to run click [1]",
			"Gemini wants to run click 7"
		]) {
			expect(parseLine(text)).toBeNull();
		}
	});

	it("writes the question and the plain-text request with Gemini's explanation when there is one", () => {
		expect(questionOf("click", { x: 1 }, "Tick it")).toBe('Allow Gemini to run click {"x":1}? Gemini says: "Tick it"');
		expect(questionOf("click", { x: 1 }, "")).toBe('Allow Gemini to run click {"x":1}?');
		expect(questionOf("click", { x: 1 }, 3)).toBe('Allow Gemini to run click {"x":1}?');
		expect(plainText("click", { x: 1 }, "Tick it")).toMatch(
			/^Gemini wants to run click \{"x":1\}\n\nGemini says: Tick it\n\nReply to confirm/
		);
		expect(plainText("click", { x: 1 }, undefined)).not.toMatch(/Gemini says/);
		expect(inputOf("click", { x: 1 }, "Tick it").questions[0].options.map((option) => option.label)).toEqual(["Allow", "Deny"]);
	});
});

describe("the tool that asks", () => {
	it("is AskUserQuestion when the request declares it with its shape, else there is none", () => {
		expect(toolOf([asker()], undefined)).toEqual({ name: "AskUserQuestion" });
		expect(toolOf([{ name: "AskUserQuestion" }, asker("Other")], undefined)).toBeNull();
		expect(toolOf([], undefined)).toBeNull();
	});

	it("is the one the setting names, which has to be declared and take the shape", () => {
		expect(toolOf([asker("Ask")], "Ask")).toEqual({ name: "Ask" });
		expect(() => toolOf([asker()], "Ask")).toThrow(/names Ask, which the request does not declare/);
		expect(() => toolOf([{ name: "Ask" }], "Ask")).toThrow(/AskUserQuestion shape/);
	});
});

describe("reading the answer", () => {
	it("is a yes only for the one answer Allow", () => {
		expect(allowed('User has answered your questions: "Allow Gemini to run click?"="Allow". You can now continue.')).toBe(true);
		expect(allowed('"q"="Deny"')).toBe(false);
		expect(allowed('"q"="Allow" "r"="Allow"')).toBe(false);
		expect(allowed("Allow")).toBe(false);
		expect(allowed('{"answers":{"q":"Allow"}}')).toBe(true);
		expect(allowed('{"answers":{"q":"Deny"}}')).toBe(false);
		expect(allowed('{"answers":{"q":"Allow","r":"Allow"}}')).toBe(false);
		expect(allowed('{"other":1}')).toBe(false);
	});
});

describe("the history", () => {
	it("is left as it is when it has no question and no plain-text request", () => {
		const messages = [
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "hello" }
		];
		expect(resolve(messages, actions)).toEqual({ messages, local: null, pending: new Set() });
		expect(
			resolve(
				[
					{ role: "assistant", content: "x" },
					{ role: "user", content: "y" }
				],
				actions
			).pending.size
		).toBe(0);
		expect(resolve([], actions).messages).toEqual([]);
	});

	it("keeps the plain-text requests of the last assistant turn as the calls that may be confirmed", () => {
		const messages = [
			{ role: "user", content: "go" },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "No line." },
					{ type: "text", text: plainText("click", args, "why") },
					{ type: "tool_use", id: "t", name: "x", input: {} }
				]
			},
			{ role: "user", content: "yes" }
		];
		expect([...resolve(messages, actions).pending]).toEqual([hashOf("click", args)]);
		expect(resolve([...messages, { role: "assistant", content: "x" }], actions).pending.size).toBe(0);
	});

	it("folds an allowed question and the action that followed it into one turn", () => {
		const done = { role: "assistant", content: [{ type: "tool_use", id, name: "computer", input: { action: "left_click" } }] };
		const result = { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "OK" }] };
		const out = resolve([{ role: "user", content: "go" }, ask(), reply('"q"="Allow"'), done, result], actions);
		expect(out.local).toBeNull();
		expect(out.messages).toHaveLength(3);
		expect(out.messages[1].content).toEqual([{ type: "text", text: "Hello." }, done.content[0]]);
		expect(out.messages[2].content).toEqual([result.content[0]]);
	});

	it("answers an allowed question that has not been run yet with that call, and takes a question nothing followed for a refusal", () => {
		const start = { role: "user", content: "go" };
		const last = resolve([start, ask(), reply('"q"="Allow"')], actions);
		expect(last.local).toEqual({ id, name: "click", args: { x: [1, { a: true, b: null }], y: 2 } });
		expect(last.messages[1].content.at(-1)).toEqual({ type: "tool_use", id, name: "click", input: last.local.args });
		expect(last.messages[2].content.at(-1)).toEqual({ type: "tool_result", tool_use_id: id, content: DECLINED, is_error: true });
		const stale = resolve([start, ask(), reply('"q"="Allow"'), { role: "user", content: "next" }], actions);
		expect(stale.local).toBeNull();
		const open = resolve(
			[start, ask(), reply('"q"="Allow"'), { role: "assistant", content: [{ type: "tool_use", id, name: "computer", input: {} }] }],
			actions
		);
		expect(open.local).toBeNull();
		expect(resolve([start, ask(), reply('"q"="Deny"')], actions).local).toBeNull();
	});

	it("takes the line out of its block and drops the block when nothing else is in it", () => {
		const alone = {
			role: "assistant",
			content: [
				{ type: "text", text: lineOf("click", args) },
				{ type: "tool_use", id, name: "AskUserQuestion", input: {} }
			]
		};
		const out = resolve([{ role: "user", content: "go" }, alone, reply('"q"="Deny"')], actions);
		expect(out.messages[1].content).toHaveLength(1);
		expect(out.messages[1].content[0].type).toBe("tool_use");
	});

	it("refuses a question whose line does not match its id, has no line, or has no answer", () => {
		const start = { role: "user", content: "go" };
		const refused = /nothing was run/;
		expect(() => resolve([start, ask(lineOf("click", { x: 1 })), reply("x")], actions)).toThrow(refused);
		expect(() => resolve([start, ask("no line"), reply("x")], actions)).toThrow(refused);
		expect(() =>
			resolve([start, { role: "assistant", content: [{ type: "tool_use", id, name: "Q", input: {} }] }, reply("x")], actions)
		).toThrow(refused);
		expect(() => resolve([start, ask(), { role: "user", content: "yes" }], actions)).toThrow(/no answer/);
		expect(() => resolve([start, ask()], actions)).toThrow(/no answer/);
		expect(
			resolve([start, { role: "assistant", content: [{ type: "tool_use", id, name: "computer", input: {} }] }], actions).local
		).toBeNull();
	});

	it("reads an answer given as text blocks", () => {
		const start = { role: "user", content: "go" };
		const blocks = {
			role: "user",
			content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: '"q"="Allow"' }, { type: "image" }] }]
		};
		expect(resolve([start, ask(), blocks], actions).local).not.toBeNull();
		const none = { role: "user", content: [{ type: "tool_result", tool_use_id: id }] };
		expect(resolve([start, ask(), none], actions).local).toBeNull();
	});
});
