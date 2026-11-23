/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/eventstream-decoder.test.vitest.mjs
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
 * @fileoverview The incremental event stream decoder (`createDecoder`) and its capture use: `{ event, data }` messages from bytes that arrive in pieces, for both kinds of stream, and the errors.
 */
import { describe, expect, it } from "vitest";
import { createDecoder } from "../../src/lib/eventstream.mjs";
import { chunk, event, exception, frame, pieces } from "../helpers/eventstream.mjs";

describe("createDecoder", () => {
	it("decodes Converse frames that arrive in pieces", () => {
		const decoder = createDecoder("converse");
		const bytes = Buffer.concat([event("messageStart", { role: "assistant" }), event("messageStop", { stopReason: "end_turn" })]);
		const out = pieces(bytes, 5).flatMap((part) => decoder.push(part));
		decoder.flush();
		expect(out).toEqual([
			{ event: "messageStart", data: { role: "assistant" } },
			{ event: "messageStop", data: { stopReason: "end_turn" } }
		]);
	});

	it("decodes InvokeModel chunks to the Anthropic events, without the invocation metrics", () => {
		const decoder = createDecoder("invoke");
		const out = decoder.push(chunk({ type: "message_stop", "amazon-bedrock-invocationMetrics": { inputTokenCount: 1 } }));
		expect(out).toEqual([{ event: "message_stop", data: { type: "message_stop" } }]);
	});

	it("turns an exception frame into an error message", () => {
		const [out] = createDecoder("converse").push(exception("throttlingException", "slow down"));
		expect(out).toMatchObject({ event: "error", data: { error: { type: "rate_limit_error", message: "slow down" } } });
	});

	it("throws for a payload that is not JSON, a bad checksum and a stream cut inside a frame", () => {
		const text = frame({ ":message-type": "event", ":event-type": "x" }, "not json");
		expect(() => createDecoder("converse").push(text)).toThrow(/not valid JSON/);
		const bad = Buffer.from(event("a", {}));
		bad[bad.length - 6] ^= 0xff;
		expect(() => createDecoder("converse").push(bad)).toThrow(/bad message checksum/);
		const cut = createDecoder("converse");
		cut.push(event("a", {}).subarray(0, 20));
		expect(() => cut.flush()).toThrow(/ended inside a frame/);
	});
});
