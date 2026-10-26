/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/arguments.test.vitest.mjs
 *	@Date: 2026-10-25T12:50:33-07:00 (1792957833)
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
import { isComplete, parseArguments } from "../../src/lib/arguments.mjs";

describe("parseArguments", () => {
	test("empty values become {}", () => {
		expect(parseArguments(undefined)).toEqual({});
		expect(parseArguments(null)).toEqual({});
		expect(parseArguments("")).toEqual({});
	});

	test("JSON objects (string or object) are returned", () => {
		expect(parseArguments('{"a":1}')).toEqual({ a: 1 });
		const object = { b: 2 };
		expect(parseArguments(object)).toBe(object);
	});

	test("anything else is preserved under _raw_arguments", () => {
		expect(parseArguments('{"a":')).toEqual({ _raw_arguments: '{"a":' });
		expect(parseArguments("[1,2]")).toEqual({ _raw_arguments: "[1,2]" });
		expect(parseArguments("null")).toEqual({ _raw_arguments: "null" });
		expect(parseArguments([1])).toEqual({ _raw_arguments: "[1]" });
		expect(parseArguments(5)).toEqual({ _raw_arguments: "5" });
	});
});

describe("isComplete", () => {
	test("empty values and JSON objects are complete; truncated or non-object values are not", () => {
		for (const value of [undefined, null, "", '{"a":1}', {}]) expect(isComplete(value)).toBe(true);
		for (const value of ['{"a":', "[1]", "null", 5]) expect(isComplete(value)).toBe(false);
	});
});
