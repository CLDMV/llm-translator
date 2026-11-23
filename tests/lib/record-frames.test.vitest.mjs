/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/record-frames.test.vitest.mjs
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
 * @fileoverview The capture of a stream of event stream frames (`raw(source, kind)`): decoded events as Server-Sent Events text, from byte chunks and from text chunks.
 */
import { describe, expect, it } from "vitest";
import { start } from "../../src/lib/record.mjs";
import { event } from "../helpers/eventstream.mjs";

const records = [];
const recorder = () => {
	records.length = 0;
	return start(
		{ config: { capture: (entry) => records.push(entry) }, state: { warned: new Set() } },
		{
			body: {},
			sent: { upstream: "u", url: "http://x", headers: {}, body: {}, state: { stream: true } },
			front: "anthropic",
			requested: null,
			headers: {},
			attempt: 1
		}
	);
};
const drain = async (iterable) => {
	for await (const item of iterable) void item;
};
const finish = async (rec, source, kind) => {
	await drain(rec.events(rec.raw(source, kind)));
	return records[0].response.raw;
};

describe("raw capture of frames", () => {
	it("records the decoded events of byte chunks, and passes the bytes on untouched", async () => {
		const rec = recorder();
		const bytes = Buffer.concat([event("messageStart", { role: "assistant" }), event("messageStop", { stopReason: "end_turn" })]);
		const seen = [];
		for await (const part of rec.events(rec.raw([bytes.subarray(0, 30), bytes.subarray(30)], "converse"))) seen.push(part);
		expect(Buffer.concat(seen).equals(bytes)).toBe(true);
		expect(records[0].response.raw).toBe(
			'event: messageStart\ndata: {"role":"assistant"}\n\nevent: messageStop\ndata: {"stopReason":"end_turn"}\n\n'
		);
	});

	it("takes text chunks as bytes: what is not a frame is recorded as one error, and nothing after it", async () => {
		const raw = await finish(recorder(), ["this is not an event stream at all", "and neither is this"], "converse");
		expect(raw).toMatch(
			/^event: error\ndata: \{"type":"error","error":\{"type":"api_error","message":"The event stream has a frame with a bad prelude checksum"\}\}\n\n$/
		);
	});

	it("a text chunk too short to hold a frame adds nothing", async () => {
		expect(await finish(recorder(), ["short"], "converse")).toBe("");
	});

	it("without a kind the bytes are recorded as text, as before", async () => {
		expect(await finish(recorder(), [Buffer.from("event: x\n\n")])).toBe("event: x\n\n");
	});
});
