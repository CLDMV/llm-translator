/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/sse.test.vitest.mjs
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
import { createParser, encode, messages, parse } from "../../src/lib/sse.mjs";
import { asyncOf, collect, readable, slices } from "../helpers/streams.mjs";

const SAMPLE = 'event: message_start\ndata: {"a":1}\n\n: comment\nid: 7\ndata: line1\ndata: line2\n\ndata\n\ndata: [DONE]\n\n';

describe("createParser", () => {
	test("parses events, comments, ids, multi-line data and bare fields", () => {
		const parser = createParser();
		expect([...parser.push(SAMPLE), ...parser.flush()]).toEqual([
			{ event: "message_start", data: '{"a":1}' },
			{ id: "7", data: "line1\nline2" },
			{ data: "" },
			{ data: "[DONE]" }
		]);
	});

	test("is chunk-boundary independent, including CRLF and lone CR terminators", () => {
		for (const eol of ["\n", "\r\n", "\r"]) {
			const sample = SAMPLE.replaceAll("\n", eol);
			for (let size = 1; size <= 7; size++) {
				const parser = createParser();
				const out = slices(sample, size).flatMap((c) => parser.push(c));
				out.push(...parser.flush());
				expect(out.map((e) => e.data)).toEqual(['{"a":1}', "line1\nline2", "", "[DONE]"]);
			}
		}
	});

	test("strips a BOM and ignores unknown fields and empty first chunks", () => {
		const parser = createParser();
		expect(parser.push("")).toEqual([]);
		expect(parser.push("﻿retry: 5\ndata: x\n\n")).toEqual([{ data: "x" }]);
	});

	test("flush handles an unterminated final line", () => {
		const parser = createParser();
		expect(parser.push("data: tail\r")).toEqual([]);
		expect(parser.flush()).toEqual([{ data: "tail" }]);
		expect(parser.flush()).toEqual([]);
	});

	test("an event with only an event name is not dispatched", () => {
		const parser = createParser();
		expect(parser.push("event: lonely\n\n")).toEqual([]);
	});
});

describe("parse", () => {
	test("accepts strings, bytes and streams", async () => {
		const expected = [{ event: "message_start", data: '{"a":1}' }, { id: "7", data: "line1\nline2" }, { data: "" }, { data: "[DONE]" }];
		expect(await collect(parse(SAMPLE))).toEqual(expected);
		const bytes = new TextEncoder().encode(SAMPLE);
		expect(await collect(parse(readable([bytes.slice(0, 5), bytes.slice(5)])))).toEqual(expected);
		expect(await collect(parse(asyncOf(slices(SAMPLE, 3))))).toEqual(expected);
	});

	test("flushes a final event that lacks its blank line", async () => {
		expect(await collect(parse("data: x"))).toEqual([{ data: "x" }]);
	});
});

describe("encode", () => {
	test("objects are JSON, strings raw, multi-line strings split", () => {
		expect(encode({ event: "ping", data: { type: "ping" } })).toBe('event: ping\ndata: {"type":"ping"}\n\n');
		expect(encode({ data: "[DONE]" })).toBe("data: [DONE]\n\n");
		expect(encode({ id: "3", data: "a\nb" })).toBe("id: 3\ndata: a\ndata: b\n\n");
	});

	test("round trips through the parser", async () => {
		const text = encode({ event: "x", data: { n: 1 } }) + encode({ data: "[DONE]" });
		expect(await collect(parse(text))).toEqual([{ event: "x", data: '{"n":1}' }, { data: "[DONE]" }]);
	});
});

describe("messages", () => {
	test("decodes SSE text, bytes, and keeps [DONE]", async () => {
		const sse = 'event: a\ndata: {"type":"a"}\n\ndata: [DONE]\n\n';
		const expected = [{ event: "a", data: { type: "a" } }, { data: "[DONE]" }];
		expect(await collect(messages(sse))).toEqual(expected);
		expect(await collect(messages(new TextEncoder().encode(sse)))).toEqual(expected);
		expect(await collect(messages(readable(slices(sse, 4))))).toEqual(expected);
	});

	test("accepts parsed {event,data} pairs and bare payload objects", async () => {
		const out = await collect(
			messages([
				{ event: "e", data: { x: 1 } },
				{ event: "e2", data: '{"y":2}' },
				{ data: "[DONE]" },
				{ type: "message_stop" },
				{ choices: [] }
			])
		);
		expect(out).toEqual([
			{ event: "e", data: { x: 1 } },
			{ event: "e2", data: { y: 2 } },
			{ data: "[DONE]" },
			{ event: "message_stop", data: { type: "message_stop" } },
			{ data: { choices: [] } }
		]);
	});

	test("invalid JSON in SSE data raises a 502 TranslatorError", async () => {
		await expect(collect(messages("data: {oops\n\n"))).rejects.toMatchObject({ code: "invalid_stream_data", status: 502 });
	});

	test("trailing data without a blank line is still delivered", async () => {
		expect(await collect(messages('data: {"z":1}'))).toEqual([{ data: { z: 1 } }]);
	});
});
