/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/prompts.test.vitest.mjs
 *	@Date: 2026-11-23T12:00:00-08:00 (1795550400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-23T12:00:00-08:00 (1795550400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Stored prompts: the `responses.prompts` setting, finding a prompt and filling in its variables.
 */

import { describe, expect, test } from "vitest";
import { apply, lookup, normalize } from "../../src/lib/prompts.mjs";

const prompts = {
	one: { instructions: "Be {{tone}}." },
	versions: { 1: { instructions: "v1" }, 2: { input: "v2 {{x}}" } }
};
const prompt = (reference) => lookup(prompts, reference);
const refused = (call, code) => expect(call).toThrow(expect.objectContaining({ status: 400, param: "prompt", code }));

describe("the prompts setting", () => {
	test("accepts a prompt or a map of versions", () => {
		expect(normalize({})).toEqual({});
		expect(normalize(prompts)).toBe(prompts);
		expect(normalize({ a: { input: [{ role: "user", content: "x" }] } })).toBeTruthy();
	});

	test.each([
		["not an object", null],
		["a list", []],
		["an entry that is a string", { a: "x" }],
		["an entry that is null", { a: null }],
		["a list as an entry", { a: [] }],
		["an empty map of versions", { a: {} }],
		["a version that is not a prompt", { a: { 1: "x" } }],
		["an unknown prompt field", { a: { instructions: "x", model: "m" } }],
		["instructions that are not a string", { a: { instructions: 5 } }],
		["input that is a number", { a: { input: 5 } }]
	])("%s is invalid_setting", (_name, value) => {
		expect(() => normalize(value)).toThrow(expect.objectContaining({ code: "invalid_setting", status: 500 }));
	});
});

describe("lookup", () => {
	test("finds a single prompt and the version of a map, the last one by default", () => {
		expect(prompt({ id: "one" })).toMatchObject({ id: "one", version: null, variables: {}, prompt: { instructions: "Be {{tone}}." } });
		expect(prompt({ id: "versions", version: 1 })).toMatchObject({ version: "1", prompt: { instructions: "v1" } });
		expect(prompt({ id: "versions", version: null }).version).toBe("2");
		expect(prompt({ id: "versions" }).prompt).toEqual({ input: "v2 {{x}}" });
		expect(
			prompt({
				id: "one",
				variables: { tone: "kind", part: { type: "input_image", image_url: "u" }, text: { type: "input_text", text: "t" } }
			}).variables.tone
		).toBe("kind");
	});

	test("refuses what does not exist or does not fit", () => {
		for (const reference of ["x", null, [], {}, { id: 5 }]) refused(() => prompt(reference), "invalid_prompt");
		refused(() => prompt({ id: "nope" }), "prompt_not_found");
		refused(() => prompt({ id: "toString" }), "prompt_not_found");
		refused(() => prompt({ id: "versions", version: "9" }), "prompt_version_not_found");
		refused(() => prompt({ id: "one", version: "1" }), "prompt_version_not_found");
		for (const variables of ["x", []]) refused(() => prompt({ id: "one", variables }), "invalid_prompt");
		for (const value of [5, null, { type: "input_audio" }, { type: "input_text" }, { type: "input_text", text: 5 }]) {
			refused(() => prompt({ id: "one", variables: { tone: value } }), "invalid_prompt");
		}
	});
});

describe("apply", () => {
	const image = { type: "input_image", image_url: "data:image/png;base64,AAAA" };

	test("fills strings into instructions and text, in a string input and in message parts", () => {
		expect(apply({ instructions: "Be {{ tone }} and {{tone}}." }, { tone: "kind" })).toEqual({
			instructions: "Be kind and kind.",
			items: []
		});
		expect(apply({ input: "Hi {{name}}" }, { name: "Ann" })).toEqual({
			instructions: null,
			items: [{ type: "message", role: "user", content: "Hi Ann" }]
		});
		const filled = apply(
			{
				input: [
					{
						role: "user",
						content: [
							{ type: "input_text", text: "a {{x}}" },
							{ type: "input_image", image_url: "u" }
						]
					},
					{ role: "assistant", content: "b {{x}}" },
					{ type: "function_call", call_id: "c", name: "f", arguments: "{}" },
					{ role: "assistant", content: null },
					{ type: "message", role: "user", content: [{ type: "output_text", text: "plain" }, { type: "refusal" }, { type: "input_text" }] }
				]
			},
			{ x: "1" }
		);
		expect(filled.items[0].content).toEqual([
			{ type: "input_text", text: "a 1" },
			{ type: "input_image", image_url: "u" }
		]);
		expect(filled.items[1].content).toBe("b 1");
		expect(filled.items[2]).toEqual({ type: "function_call", call_id: "c", name: "f", arguments: "{}" });
		expect(filled.items[3].content).toBeNull();
		expect(filled.items[4].content).toEqual([{ type: "output_text", text: "plain" }, { type: "refusal" }, { type: "input_text" }]);
	});

	test("a content part replaces a part whose whole text is the placeholder, or a whole string input", () => {
		const out = apply({ input: [{ role: "user", content: [{ type: "input_text", text: " {{pic}} " }] }] }, { pic: image });
		expect(out.items[0].content).toEqual([image]);
		expect(out.items[0].content[0]).not.toBe(image);
		expect(apply({ input: "{{pic}}" }, { pic: image }).items[0].content).toEqual([image]);
		expect(apply({ input: "{{t}}" }, { t: { type: "input_text", text: "from part" } }).items[0].content).toBe("from part");
	});

	test("refuses a variable that is missing, or a content part inside other text", () => {
		refused(() => apply({ instructions: "{{nope}}" }, {}), "prompt_variable_missing");
		refused(() => apply({ input: "{{nope}}" }, {}), "prompt_variable_missing");
		refused(() => apply({ input: [{ role: "user", content: [{ type: "input_text", text: "{{nope}}" }] }] }, {}), "prompt_variable_missing");
		refused(() => apply({ instructions: "see {{pic}}" }, { pic: image }), "invalid_prompt");
		refused(() => apply({ input: "look at {{pic}} now" }, { pic: image }), "invalid_prompt");
		expect(() => apply({ instructions: "toString {{toString}}" }, {})).toThrow(
			expect.objectContaining({ code: "prompt_variable_missing" })
		);
	});
});
