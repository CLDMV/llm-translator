/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/ndjson.test.vitest.mjs
 *	@Date: 2026-11-13T11:00:00-08:00 (1794596400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T11:00:00-08:00 (1794596400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview NDJSON parser: lines split across chunks, CRLF, blank lines, multi-byte characters, parsed objects and invalid lines.
 */
import { describe, expect, it } from "vitest";
import { createParser, parse } from "../../src/lib/ndjson.mjs";
import { asyncOf, collect, readable, slices } from "../helpers/streams.mjs";

const text = '{"a":1}\n{"b":"two"}\r\n\n{"c":[3]}\n';

describe("createParser", () => {
	it("gives each complete line and holds the part after the last newline", () => {
		const parser = createParser();
		expect(parser.push('{"a":1}\n{"b":')).toEqual([{ a: 1 }]);
		expect(parser.push('2}\n{"c"')).toEqual([{ b: 2 }]);
		expect(parser.push(":3}")).toEqual([]);
		expect(parser.flush()).toEqual([{ c: 3 }]);
		expect(parser.flush()).toEqual([]);
	});

	it("skips blank lines and removes a carriage return", () => {
		const parser = createParser();
		expect(parser.push('\n  \n{"a":1}\r\n\r\n')).toEqual([{ a: 1 }]);
	});

	it("rejects a line that is not JSON with invalid_stream_data", () => {
		const parser = createParser();
		expect(() => parser.push("nope\n")).toThrow(
			expect.objectContaining({ code: "invalid_stream_data", status: 502, details: { data: "nope" } })
		);
	});
});

describe("parse", () => {
	const want = [{ a: 1 }, { b: "two" }, { c: [3] }];

	it("parses a string, split strings and any slice size", async () => {
		expect(await collect(parse(text))).toEqual(want);
		for (const size of [1, 2, 3, 5, 100]) expect(await collect(parse(slices(text, size)))).toEqual(want);
		expect(await collect(parse(asyncOf(slices(text, 4))))).toEqual(want);
	});

	it("decodes bytes, including a multi-byte character split across chunks", async () => {
		const bytes = new TextEncoder().encode('{"t":"h\u00e9llo \ud83d\ude00"}\n{"t":"h\u00e9llo \ud83d\ude00"}');
		const parts = [];
		for (let at = 0; at < bytes.length; at += 3) parts.push(bytes.slice(at, at + 3));
		expect(await collect(parse(readable(parts)))).toEqual([{ t: "h\u00e9llo \ud83d\ude00" }, { t: "h\u00e9llo \ud83d\ude00" }]);
	});

	it("passes objects through and mixes them with text", async () => {
		expect(await collect(parse([{ x: 1 }, '{"y":2}\n']))).toEqual([{ x: 1 }, { y: 2 }]);
	});

	it("fails on an invalid line, also the unterminated last one", async () => {
		await expect(collect(parse('{"a":1}\n{bad}\n'))).rejects.toMatchObject({ code: "invalid_stream_data" });
		await expect(collect(parse('{"a":1}\n{"b"'))).rejects.toMatchObject({ code: "invalid_stream_data" });
	});
});
