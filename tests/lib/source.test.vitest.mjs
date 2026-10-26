/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/source.test.vitest.mjs
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
import { items, text } from "../../src/lib/source.mjs";
import { asyncOf, collect, readable } from "../helpers/streams.mjs";

describe("source.items", () => {
	test("ReadableStream", async () => {
		expect(await collect(items(readable(["a", "b"])))).toEqual(["a", "b"]);
	});

	test("closing early cancels a ReadableStream", async () => {
		let cancelled = false;
		const stream = new ReadableStream({
			pull(controller) {
				controller.enqueue("x");
			},
			cancel() {
				cancelled = true;
			}
		});
		for await (const value of items(stream)) {
			expect(value).toBe("x");
			break;
		}
		expect(cancelled).toBe(true);
	});

	test("a failing cancel() does not mask the outcome", async () => {
		const stream = new ReadableStream({
			pull(controller) {
				controller.enqueue("x");
			},
			cancel() {
				throw new Error("cancel failed");
			}
		});
		for await (const value of items(stream)) {
			expect(value).toBe("x");
			break;
		}
	});

	test("async iterable, iterable, string, bytes and objects", async () => {
		expect(await collect(items(asyncOf([1, 2])))).toEqual([1, 2]);
		expect(await collect(items([1, 2]))).toEqual([1, 2]);
		expect(await collect(items("abc"))).toEqual(["abc"]);
		const bytes = new Uint8Array([1, 2]);
		expect(await collect(items(bytes))).toEqual([bytes]);
		const object = { a: 1 };
		expect(await collect(items(object))).toEqual([object]);
	});

	test("closing early closes an async iterator", async () => {
		let closed = false;
		async function* gen() {
			try {
				yield 1;
				yield 2;
			} finally {
				closed = true;
			}
		}
		for await (const value of items(gen())) {
			expect(value).toBe(1);
			break;
		}
		expect(closed).toBe(true);
	});
});

describe("source.text", () => {
	test("strings pass through and bytes are decoded across multi-byte boundaries", async () => {
		const bytes = new TextEncoder().encode("héllo €");
		const parts = [bytes.slice(0, 2), bytes.slice(2, 9), bytes.slice(9)];
		expect((await collect(text(["a", ...parts]))).join("")).toBe("ahéllo €");
	});

	test("a dangling partial character is flushed as a replacement character", async () => {
		const bytes = new TextEncoder().encode("€").slice(0, 2);
		expect((await collect(text(bytes))).join("")).toBe("�");
	});
});
