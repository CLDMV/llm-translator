/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/eventstream.test.vitest.mjs
 *	@Date: 2026-11-19T09:00:00-08:00 (1795107600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-19T09:00:00-08:00 (1795107600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The `application/vnd.amazon.eventstream` parser (both CRCs, split frames, every header type, malformed streams) and its conversion to `{ event, data }` messages.
 */
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createParser, events, frames } from "../../src/lib/eventstream.mjs";
import { chunk, event, exception, frame, header, pieces } from "../helpers/eventstream.mjs";
import { collect, readable } from "../helpers/streams.mjs";

const all = (parser, parts) => parts.flatMap((part) => parser.push(part));

describe("eventstream parser", () => {
	it("reads a frame: headers and payload", () => {
		const [one] = createParser().push(event("messageStart", { role: "assistant" }));
		expect(one.headers).toEqual({ ":event-type": "messageStart", ":content-type": "application/json", ":message-type": "event" });
		expect(JSON.parse(one.payload.toString())).toEqual({ role: "assistant" });
	});

	it("reads several frames from one chunk", () => {
		const bytes = Buffer.concat([event("a", {}), event("b", {}), event("c", {})]);
		expect(
			createParser()
				.push(bytes)
				.map((entry) => entry.headers[":event-type"])
		).toEqual(["a", "b", "c"]);
	});

	it("reads frames split at every byte offset, and one byte at a time", () => {
		const bytes = Buffer.concat([event("a", { text: "héllo" }), event("b", { text: "x".repeat(300) })]);
		for (let cut = 1; cut < bytes.length; cut += 7) {
			const parser = createParser();
			const out = all(parser, [bytes.subarray(0, cut), bytes.subarray(cut)]);
			parser.flush();
			expect(out.map((entry) => entry.headers[":event-type"])).toEqual(["a", "b"]);
		}
		const parser = createParser();
		expect(all(parser, pieces(bytes, 1))).toHaveLength(2);
		expect(() => parser.flush()).not.toThrow();
	});

	it("reads every header type", () => {
		const uuid = "123e4567-e89b-12d3-a456-426614174000";
		const section = Buffer.concat([
			header("yes", 0),
			header("no", 1),
			header("byte", 2, -5),
			header("short", 3, 300),
			header("int", 4, -70000),
			header("long", 5, 2 ** 40),
			header("bytes", 6, Buffer.from([1, 2, 3])),
			header("text", 7, "héllo"),
			header("time", 8, 1795107600000),
			header("id", 9, uuid)
		]);
		const [one] = createParser().push(frame(section, "{}"));
		expect(one.headers).toEqual({
			yes: true,
			no: false,
			byte: -5,
			short: 300,
			int: -70000,
			long: 2 ** 40,
			bytes: Buffer.from([1, 2, 3]),
			text: "héllo",
			time: new Date(1795107600000),
			id: uuid
		});
	});

	it("rejects a frame with a bad prelude checksum as soon as twelve bytes are in", () => {
		const bytes = Buffer.from(event("a", {}));
		bytes[9] ^= 0xff;
		expect(() => createParser().push(bytes.subarray(0, 12))).toThrow(/bad prelude checksum/);
		let caught;
		try {
			createParser().push(bytes.subarray(0, 12));
		} catch (error) {
			caught = error;
		}
		expect(caught).toMatchObject({ code: "invalid_stream_data", status: 502 });
	});

	it("rejects a frame with a bad message checksum", () => {
		const bytes = Buffer.from(event("a", { text: "hi" }));
		bytes[bytes.length - 6] ^= 0xff;
		expect(() => createParser().push(bytes)).toThrow(/bad message checksum/);
	});

	it("rejects impossible lengths even when the prelude checksum is right", () => {
		const prelude = (total, headers) => {
			const out = Buffer.alloc(12);
			out.writeUInt32BE(total, 0);
			out.writeUInt32BE(headers, 4);
			out.writeUInt32BE(crc32(out.subarray(0, 8)), 8);
			return out;
		};
		expect(() => createParser().push(prelude(10, 0))).toThrow(/impossible length/);
		expect(() => createParser().push(prelude(64 * 1024 * 1024, 0))).toThrow(/impossible length/);
		expect(() => createParser().push(prelude(40, 100))).toThrow(/impossible length/);
	});

	it("rejects a header that runs past its section and a header of unknown type", () => {
		const run = Buffer.concat([Buffer.from([4]), Buffer.from("name"), Buffer.from([7, 0, 50]), Buffer.from("short")]);
		expect(() => createParser().push(frame(run))).toThrow(/runs past its section/);
		const unknown = Buffer.concat([Buffer.from([1]), Buffer.from("x"), Buffer.from([42])]);
		expect(() => createParser().push(frame(unknown))).toThrow(/unknown type 42/);
	});

	it("delivers the frames read before a bad one, and raises the error on the next call", () => {
		const bad = Buffer.from(event("b", { text: "hi" }));
		bad[bad.length - 6] ^= 0xff;
		const parser = createParser();
		const good = parser.push(Buffer.concat([event("a", {}), bad]));
		expect(good.map((entry) => entry.headers[":event-type"])).toEqual(["a"]);
		expect(() => parser.push(event("c", {}))).toThrow(/bad message checksum/);
		expect(() => parser.flush()).toThrow(/bad message checksum/);
	});

	it("flush throws when the stream ended inside a frame, and not otherwise", () => {
		const parser = createParser();
		parser.push(event("a", {}).subarray(0, 20));
		expect(() => parser.flush()).toThrow(/ended inside a frame/);
		const clean = createParser();
		clean.push(event("a", {}));
		expect(() => clean.flush()).not.toThrow();
	});

	it("frames() reads a web stream and an async iterable, and fails on a truncated stream", async () => {
		const bytes = Buffer.concat([event("a", {}), event("b", {})]);
		expect((await collect(frames(readable(pieces(bytes, 5))))).length).toBe(2);
		expect((await collect(frames(bytes))).length).toBe(2);
		await expect(collect(frames(readable([bytes.subarray(0, bytes.length - 3)])))).rejects.toThrow(/ended inside a frame/);
	});
});

describe("eventstream messages", () => {
	it("invoke: decodes each chunk to its Anthropic event and removes Bedrock's invocation metrics", async () => {
		const start = { type: "message_start", message: { id: "m", role: "assistant", content: [] } };
		const stop = { type: "message_stop", "amazon-bedrock-invocationMetrics": { inputTokenCount: 3, outputTokenCount: 4 } };
		const out = await collect(events(readable(pieces(Buffer.concat([chunk(start), chunk(stop)]), 11)), "invoke"));
		expect(out).toEqual([
			{ event: "message_start", data: start },
			{ event: "message_stop", data: { type: "message_stop" } }
		]);
	});

	it("converse: the event name is the :event-type header and the payload is the data", async () => {
		const out = await collect(
			events(
				Buffer.concat([event("messageStart", { role: "assistant" }), event("contentBlockDelta", { delta: { text: "hi" } })]),
				"converse"
			)
		);
		expect(out).toEqual([
			{ event: "messageStart", data: { role: "assistant" } },
			{ event: "contentBlockDelta", data: { delta: { text: "hi" } } }
		]);
	});

	it("an exception frame becomes an Anthropic error event with the status of the exception", async () => {
		const cases = [
			["throttlingException", "rate_limit_error"],
			["validationException", "invalid_request_error"],
			["accessDeniedException", "permission_error"],
			["serviceUnavailableException", "overloaded_error"],
			["modelStreamErrorException", "invalid_request_error"],
			["somethingNew", "api_error"]
		];
		for (const [name, type] of cases) {
			const [out] = await collect(events(exception(name, `${name} happened`), "invoke"));
			expect(out).toEqual({ event: "error", data: { type: "error", error: { type, message: `${name} happened` } } });
		}
	});

	it("an exception whose payload is not a JSON message gives the text, and an error frame its headers", async () => {
		const plain = frame({ ":message-type": "exception", ":exception-type": "internalServerException" }, "boom");
		expect((await collect(events(plain, "converse")))[0].data.error).toEqual({ type: "api_error", message: "boom" });
		const noMessage = frame({ ":message-type": "exception", ":exception-type": "internalServerException" }, '{"other":1}');
		expect((await collect(events(noMessage, "converse")))[0].data.error.message).toBe('{"other":1}');
		const wrong = frame({ ":message-type": "error", ":error-code": "InternalError", ":error-message": "frame failed" }, "");
		expect((await collect(events(wrong, "invoke")))[0].data.error).toEqual({ type: "api_error", message: "frame failed" });
	});

	it("a stream that cannot be read ends with an error message", async () => {
		const bad = frame({ ":message-type": "event", ":event-type": "chunk" }, "not json");
		for (const kind of ["invoke", "converse"]) {
			expect(await collect(events(bad, kind))).toEqual([
				{
					event: "error",
					data: { type: "error", error: { type: "api_error", message: expect.stringMatching(/payload is not valid JSON/) } }
				}
			]);
		}
		const badBytes = event("chunk", { bytes: Buffer.from("not json").toString("base64") });
		expect((await collect(events(badBytes, "invoke")))[0].event).toBe("error");
		const corrupt = Buffer.from(event("a", { text: "hi" }));
		corrupt[corrupt.length - 6] ^= 0xff;
		const afterGood = await collect(events(Buffer.concat([event("a", {}), corrupt]), "converse"));
		expect(afterGood.map((entry) => entry.event)).toEqual(["a", "error"]);
		expect(afterGood[1].data.error.message).toMatch(/bad message checksum/);
		const cut = await collect(events(event("a", {}).subarray(0, 20), "converse"));
		expect(cut[0].data.error.message).toMatch(/ended inside a frame/);
	});

	it("a failing source ends with an error message too", async () => {
		const source = (async function* () {
			yield event("a", {});
			throw new Error("socket hang up");
		})();
		const out = await collect(events(source, "converse"));
		expect(out.map((entry) => entry.event)).toEqual(["a", "error"]);
		expect(out[1].data.error).toEqual({ type: "api_error", message: "socket hang up" });
	});
});
