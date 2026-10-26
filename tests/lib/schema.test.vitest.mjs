/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/schema.test.vitest.mjs
 *	@Date: 2026-10-25T12:18:47-07:00 (1792955927)
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
import { sanitize } from "../../src/lib/schema.mjs";

describe("schema.sanitize", () => {
	test("drops $schema and unbounded integer limits recursively without mutating the input", () => {
		const input = {
			$schema: "https://json-schema.org/draft/2020-12/schema",
			type: "object",
			properties: {
				limit: {
					type: "integer",
					maximum: 9007199254740991,
					minimum: -9007199254740991,
					exclusiveMaximum: 1e300,
					exclusiveMinimum: -1e300
				},
				small: { type: "integer", maximum: 10, minimum: 1 },
				list: { type: "array", items: [{ type: "string", maximum: "text" }, null, 3] }
			},
			required: ["limit"]
		};
		const snapshot = JSON.stringify(input);
		expect(sanitize(input)).toEqual({
			type: "object",
			properties: {
				limit: { type: "integer" },
				small: { type: "integer", maximum: 10, minimum: 1 },
				list: { type: "array", items: [{ type: "string", maximum: "text" }, null, 3] }
			},
			required: ["limit"]
		});
		expect(JSON.stringify(input)).toBe(snapshot);
	});

	test("passes scalars through", () => {
		expect(sanitize(5)).toBe(5);
		expect(sanitize(null)).toBeNull();
		expect(sanitize("s")).toBe("s");
	});
});
