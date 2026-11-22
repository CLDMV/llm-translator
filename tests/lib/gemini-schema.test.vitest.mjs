/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/gemini-schema.test.vitest.mjs
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
 * @fileoverview JSON Schema as Gemini takes it: kept, rewritten and removed keywords, references, and a schema that cannot be followed.
 */
import { describe, expect, it } from "vitest";
import { gemini } from "../../src/lib/gemini-schema.mjs";

describe("gemini schema", () => {
	it("keeps what Gemini reads and removes what it does not", () => {
		const out = gemini({
			$schema: "http://json-schema.org/draft-07/schema#",
			$id: "x",
			title: "T",
			description: "D",
			type: "object",
			properties: {
				a: { type: "string", format: "date-time", pattern: "^x", default: "d", examples: ["e"], minLength: 1 },
				b: { type: "integer", minimum: 1, maximum: 5, exclusiveMinimum: 0, multipleOf: 2 },
				c: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3, uniqueItems: true },
				d: { type: "string", format: "uri" },
				e: { type: "string", enum: ["x", "y"] },
				f: { type: "array", prefixItems: [{ type: "string" }, { type: "number" }], items: false }
			},
			required: ["a"],
			additionalProperties: false,
			patternProperties: { "^x": { type: "string" } },
			not: { type: "null" }
		});
		expect(out).toEqual({
			title: "T",
			description: "D",
			type: "object",
			properties: {
				a: { type: "string", format: "date-time" },
				b: { type: "integer", minimum: 1, maximum: 5 },
				c: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
				d: { type: "string" },
				e: { type: "string", enum: ["x", "y"] },
				f: { type: "array", prefixItems: [{ type: "string" }, { type: "number" }], items: false }
			},
			required: ["a"],
			additionalProperties: false
		});
	});

	it("rewrites oneOf, const, nullable, type lists and allOf", () => {
		expect(gemini({ oneOf: [{ type: "string" }, { type: "number" }] })).toEqual({ anyOf: [{ type: "string" }, { type: "number" }] });
		expect(gemini({ oneOf: [{ type: "string" }], anyOf: [{ type: "number" }] })).toEqual({ anyOf: [{ type: "number" }] });
		expect(gemini({ const: "x", type: "string" })).toEqual({ type: "string", enum: ["x"] });
		expect(gemini({ type: "string", nullable: true })).toEqual({ type: ["string", "null"] });
		expect(gemini({ nullable: true })).toEqual({ type: ["null"] });
		expect(gemini({ type: ["string", "null"], nullable: true })).toEqual({ type: ["string", "null"] });
		expect(
			gemini({
				type: "object",
				required: ["a"],
				properties: { a: { type: "string" } },
				allOf: [
					{ properties: { b: { type: "number" } }, required: ["b"], description: "from the part" },
					{ properties: { a: { type: "integer" } }, required: ["a"] }
				]
			})
		).toEqual({
			type: "object",
			description: "from the part",
			required: ["a", "b"],
			properties: { a: { type: "string" }, b: { type: "number" } }
		});
	});

	it("merges allOf parts that name the same things: the node's own values and the first part win", () => {
		expect(
			gemini({
				type: "object",
				allOf: [
					{ required: ["a"], description: "first" },
					{ description: "second", type: "string" }
				]
			})
		).toEqual({
			type: "object",
			description: "first",
			required: ["a"]
		});
	});

	it("replaces local references, expands a recursive one once and leaves an unknown one out", () => {
		const out = gemini({
			type: "object",
			$defs: {
				Node: { type: "object", properties: { child: { $ref: "#/$defs/Node" }, name: { type: "string" } } },
				Name: { type: "string", description: "own" }
			},
			definitions: { Old: { type: "number" } },
			properties: {
				root: { $ref: "#/$defs/Node", description: "the root" },
				name: { $ref: "#/$defs/Name" },
				old: { $ref: "#/definitions/Old" },
				missing: { $ref: "#/$defs/Nope", description: "gone" },
				remote: { $ref: "http://example.com/x.json" },
				tilde: { $ref: "#/$defs/a~1b" }
			}
		});
		expect(out.properties.root).toEqual({
			type: "object",
			description: "the root",
			properties: { child: {}, name: { type: "string" } }
		});
		expect(out.properties.name).toEqual({ type: "string", description: "own" });
		expect(out.properties.old).toEqual({ type: "number" });
		expect(out.properties.missing).toEqual({ description: "gone" });
		expect(out.properties.remote).toEqual({});
		expect(out.properties.tilde).toEqual({});
		expect(out.$defs).toBeUndefined();
	});

	it("ignores a keyword whose value is of the wrong kind", () => {
		expect(gemini({ type: "string", allOf: "x", enum: "x", required: "x", format: 1, properties: null })).toEqual({ type: "string" });
	});

	it("takes anything that is not a schema as an empty one, and stops at a depth", () => {
		expect(gemini(true)).toEqual({});
		expect(gemini(null)).toEqual({});
		expect(gemini("x")).toEqual({});
		expect(gemini([1])).toEqual({});
		expect(gemini({ properties: [1], additionalProperties: true, items: true, anyOf: "x" })).toEqual({
			additionalProperties: true,
			items: true
		});
		let deep = { type: "string" };
		for (let at = 0; at < 40; at++) deep = { type: "array", items: deep };
		let walk = gemini(deep);
		let levels = 0;
		while (walk.items !== undefined && walk.type === "array") {
			walk = walk.items;
			levels++;
		}
		expect(levels).toBeLessThan(40);
		expect(walk).toEqual({});
		const input = { type: "object", properties: { a: { $ref: "#/$defs/A" } }, $defs: { A: { type: "string" } } };
		const before = JSON.stringify(input);
		gemini(input);
		expect(JSON.stringify(input)).toBe(before);
	});
});
