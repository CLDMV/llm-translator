/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/bedrock-settings.test.vitest.mjs
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
 * @fileoverview The `bedrock` setting: its check, and the merge of the layers through resolve.
 */
import { describe, expect, it } from "vitest";
import { check } from "../../src/lib/bedrock-settings.mjs";
import { resolve } from "../../src/lib/settings.mjs";

describe("check", () => {
	it("accepts nothing set and a boolean cache", () => {
		expect(check({})).toBeNull();
		expect(check({ cache: false })).toBeNull();
		expect(check({ cache: true })).toBeNull();
	});

	it("refuses what is not an object, an unknown key and a cache that is not a boolean", () => {
		for (const value of [null, "x", 1, [], undefined]) expect(check(value)).toBe("expected an object");
		expect(check({ speed: 1 })).toBe("unknown key speed");
		expect(check({ cache: "no" })).toBe("cache must be true or false");
	});
});

describe("resolve", () => {
	it("merges the bedrock layers key by key and refuses a bad one", () => {
		expect(resolve({ bedrock: { cache: false } }, { bedrock: {} }).bedrock).toEqual({ cache: false });
		expect(resolve().bedrock).toEqual({});
		expect(() => resolve({ bedrock: { cache: 1 } })).toThrow(/Invalid setting bedrock/);
		expect(() => resolve({ bedrock: "x" })).toThrow(/expected an object/);
	});
});
