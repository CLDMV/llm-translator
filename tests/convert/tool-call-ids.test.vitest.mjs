/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/convert/tool-call-ids.test.vitest.mjs
 *	@Date: 2026-10-25T12:18:46-07:00 (1792955926)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:03-07:00 (1792958343)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Tool-call id policy: the deterministic id fitter and both conversion directions, request and reply, streaming and not.
 */
import { describe, expect, test } from "vitest";
import { anthropicToolId, createIdFitter, restoreId, validToolIdPolicy } from "../../src/lib/ids.mjs";
import { request as toOpenai } from "../../src/api/convert/anthropic/messages/to/openai/chat/request.mjs";
import { response as fromOpenai } from "../../src/api/convert/openai/chat/to/anthropic/messages/response.mjs";
import { stream as streamFromOpenai } from "../../src/api/convert/openai/chat/to/anthropic/messages/stream.mjs";
import { request as toAnthropic } from "../../src/api/convert/openai/chat/to/anthropic/messages/request.mjs";
import { response as fromAnthropic } from "../../src/api/convert/anthropic/messages/to/openai/chat/response.mjs";
import { stream as streamFromAnthropic } from "../../src/api/convert/anthropic/messages/to/openai/chat/stream.mjs";
import { anthropicSse, collect, openaiSse } from "../helpers/streams.mjs";

const MISTRAL = { alphabet: "a-zA-Z0-9", min: 9, max: 9 };

describe("validToolIdPolicy", () => {
	test("accepts a character class with optional positive integer bounds", () => {
		expect(validToolIdPolicy(MISTRAL)).toBe(true);
		expect(validToolIdPolicy({ alphabet: "a-z" })).toBe(true);
		expect(validToolIdPolicy({ alphabet: "a-z_-", min: 1 })).toBe(true);
		expect(validToolIdPolicy({ alphabet: "a-z", max: 64 })).toBe(true);
	});

	test.each([
		["not an object", "a-z"],
		["null", null],
		["an array", ["a-z"]],
		["no alphabet", {}],
		["a non-string alphabet", { alphabet: 5 }],
		["an invalid class", { alphabet: "z-a" }],
		["a class with no printable ASCII", { alphabet: "\\u0080-\\u00ff" }],
		["min below 1", { alphabet: "a-z", min: 0 }],
		["a fractional min", { alphabet: "a-z", min: 1.5 }],
		["a non-number max", { alphabet: "a-z", max: "9" }],
		["max below min", { alphabet: "a-z", min: 5, max: 4 }]
	])("rejects %s", (_name, policy) => {
		expect(validToolIdPolicy(policy)).toBe(false);
	});
});

describe("createIdFitter", () => {
	test("ids that satisfy the policy pass through; others become a stable hash in the alphabet", () => {
		const map = {};
		const fit = createIdFitter({ policy: MISTRAL, ids: ["abcDEF123", "toolu_01ABC", "call-2"], map });
		expect(fit("abcDEF123")).toBe("abcDEF123");
		const a = fit("toolu_01ABC");
		const b = fit("call-2");
		expect(a).toMatch(/^[a-zA-Z0-9]{9}$/);
		expect(b).toMatch(/^[a-zA-Z0-9]{9}$/);
		expect(a).not.toBe(b);
		expect(map).toEqual({ [a]: "toolu_01ABC", [b]: "call-2" });
		// The same request again, and another request that only shares one id, give the same value.
		const again = createIdFitter({ policy: MISTRAL, ids: ["x", "toolu_01ABC"] });
		expect(again("toolu_01ABC")).toBe(a);
		expect(createIdFitter({ policy: MISTRAL, ids: ["toolu_01ABC"] })("toolu_01ABC")).toBe(a);
	});

	test("the same original always gets the same value, wherever it appears", () => {
		const fit = createIdFitter({ policy: MISTRAL, ids: ["toolu_1", "toolu_1", "toolu_2"] });
		expect(fit("toolu_1")).toBe(fit("toolu_1"));
		expect(fit("toolu_1")).not.toBe(fit("toolu_2"));
	});

	test("ids outside the list are fitted when first asked for, and a missing id maps like an empty one", () => {
		const map = {};
		const fit = createIdFitter({ policy: MISTRAL, ids: [], map });
		expect(fit("exactly09")).toBe("exactly09");
		expect(fit("toolu_late")).toMatch(/^[a-zA-Z0-9]{9}$/);
		expect(fit(undefined)).toBe(fit(""));
		expect(fit(7)).toBe(fit(""));
		expect(Object.values(map)).toEqual(["toolu_late", ""]);
	});

	test("length bounds: a range gets a hash of at most the maximum, a long minimum a longer one", () => {
		const open = createIdFitter({ policy: { alphabet: "a-z0-9" }, ids: ["Has Spaces", "ok"] });
		expect(open("ok")).toBe("ok");
		expect(open("Has Spaces")).toMatch(/^[a-z0-9]{16}$/);
		const capped = createIdFitter({ policy: { alphabet: "a-z0-9", max: 5 }, ids: ["toolu_0123456789"] });
		expect(capped("toolu_0123456789")).toMatch(/^[a-z0-9]{5}$/);
		const long = createIdFitter({ policy: { alphabet: "a-z0-9", min: 40, max: 48 }, ids: ["short"] });
		expect(long("short")).toMatch(/^[a-z0-9]{40}$/);
		const tooShort = createIdFitter({ policy: { alphabet: "a-z0-9", min: 6 }, ids: ["abc"] });
		expect(tooShort("abc")).toMatch(/^[a-z0-9]{16}$/);
	});

	test("different originals never collide: a hash that lands on a conforming id or an earlier hash is taken again", () => {
		const policy = { alphabet: "a-c", min: 1, max: 1 };
		const alone = (id) => createIdFitter({ policy, ids: [id] })(id);
		// A non-conforming original whose own hash is "a", next to the conforming id "a".
		const onA = Array.from({ length: 200 }, (_, i) => `x${i}`).find((id) => alone(id) === "a");
		const fit = createIdFitter({ policy, ids: [onA, "a"] });
		expect(fit("a")).toBe("a");
		expect(fit(onA)).not.toBe("a");
		expect(["b", "c"]).toContain(fit(onA));
		// Two non-conforming originals with the same hash.
		const pool = Array.from({ length: 200 }, (_, i) => `y${i}`);
		const first = pool.find((id) => pool.some((other) => other !== id && alone(other) === alone(id)));
		const second = pool.find((id) => id !== first && alone(id) === alone(first));
		const map = {};
		const both = createIdFitter({ policy, ids: [first, second], map });
		expect(both(first)).toBe(alone(first));
		expect(both(second)).not.toBe(both(first));
		expect(Object.values(map).sort()).toEqual([first, second].sort());
		// The result is a function of the request alone.
		expect(createIdFitter({ policy, ids: [first, second] })(second)).toBe(both(second));
	});

	test("fails with a clear error when the format has no free id left", () => {
		const policy = { alphabet: "a-b", min: 1, max: 1 };
		const ids = Array.from({ length: 12 }, (_, i) => `z${i}`);
		expect(() => createIdFitter({ policy, ids })).toThrow(expect.objectContaining({ code: "invalid_request", status: 400 }));
	});
});

describe("restoreId and anthropicToolId with a map", () => {
	test("a mapped id is restored, anything else is left as it was", () => {
		expect(restoreId({ abc123XYZ: "toolu_01" }, "abc123XYZ")).toBe("toolu_01");
		expect(restoreId({ abc123XYZ: "toolu_01" }, "other")).toBe("other");
		expect(anthropicToolId("abc123XYZ", { abc123XYZ: "call.1:0" })).toBe("call.1:0");
		expect(anthropicToolId("fresh.id", { abc123XYZ: "call.1:0" })).toBe("fresh_id");
	});
});

const thread = (id) => [
	{ role: "user", content: "weather?" },
	{ role: "assistant", content: [{ type: "tool_use", id, name: "weather", input: { city: "Oslo" } }] },
	{ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "rain" }] }
];
const openaiThread = (id) => [
	{ role: "user", content: "weather?" },
	{ role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: "weather", arguments: '{"city":"Oslo"}' } }] },
	{ role: "tool", tool_call_id: id, content: "rain" }
];

describe("Anthropic client to an upstream with a strict id format", () => {
	const convert = (messages, toolCallIds) => toOpenai({ model: "m", max_tokens: 10, messages }, undefined, { toolCallIds });

	test("without a policy ids pass through and nothing is recorded", async () => {
		const { body, state } = await convert(thread("toolu_01ABC"));
		expect(body.messages[1].tool_calls[0].id).toBe("toolu_01ABC");
		expect(body.messages[2].tool_call_id).toBe("toolu_01ABC");
		expect(state.toolIds).toEqual({});
	});

	test("replayed history gets valid ids, and a call and its result agree", async () => {
		const { body, state } = await convert(thread("toolu_01ABC"), MISTRAL);
		const callId = body.messages[1].tool_calls[0].id;
		expect(callId).toMatch(/^[a-zA-Z0-9]{9}$/);
		expect(body.messages[2].tool_call_id).toBe(callId);
		expect(state.toolIds).toEqual({ [callId]: "toolu_01ABC" });
		expect(() => JSON.stringify(state)).not.toThrow();
		const again = await convert(thread("toolu_01ABC"), MISTRAL);
		expect(again.body.messages[1].tool_calls[0].id).toBe(callId);
	});

	test("an id the upstream made itself comes back unchanged and is not recorded", async () => {
		const { body, state } = await convert(thread("Zx9Qm2Lp1"), MISTRAL);
		expect(body.messages[1].tool_calls[0].id).toBe("Zx9Qm2Lp1");
		expect(state.toolIds).toEqual({});
	});

	test("a result that comes before its call in the list still maps to the same value, and a tool result with an image names the fitted id", async () => {
		const messages = [
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_9", content: "first" }] },
			{ role: "assistant", content: [{ type: "tool_use", id: "toolu_9", name: "t", input: {} }] },
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_9",
						content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }]
					}
				]
			}
		];
		const { body, state } = await convert(messages, MISTRAL);
		const [fitted] = Object.keys(state.toolIds);
		expect(body.messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id)).toEqual([fitted, fitted]);
		expect(body.messages.find((m) => m.role === "assistant").tool_calls[0].id).toBe(fitted);
		expect(JSON.stringify(body.messages)).toContain(`Image output of tool call ${fitted}:`);
	});

	test("a reply that echoes a fitted id gets the client's original; other ids are sanitized as before", () => {
		const state = { toolIds: { abc123XYZ: "toolu_01ABC" }, toolNames: {} };
		const reply = {
			id: "c",
			model: "m",
			choices: [
				{
					index: 0,
					finish_reason: "tool_calls",
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{ id: "abc123XYZ", type: "function", function: { name: "a", arguments: "{}" } },
							{ id: "fresh.id:0", type: "function", function: { name: "b", arguments: "{}" } }
						]
					}
				}
			]
		};
		expect(fromOpenai(reply, state).content.map((block) => block.id)).toEqual(["toolu_01ABC", "fresh_id_0"]);
		expect(fromOpenai(reply, { toolNames: {} }).content.map((block) => block.id)).toEqual(["abc123XYZ", "fresh_id_0"]);
	});

	test("a stream restores the same way", async () => {
		const state = { toolIds: { abc123XYZ: "toolu_01ABC" }, toolNames: {} };
		const chunk = (delta, finish = null) => ({ id: "c", model: "m", choices: [{ index: 0, delta, finish_reason: finish }] });
		const call = (id) => chunk({ tool_calls: [{ index: 0, id, type: "function", function: { name: "a", arguments: "{}" } }] });
		const ids = async (id, withState) => {
			const events = await collect(streamFromOpenai(openaiSse([call(id), chunk({}, "tool_calls"), "[DONE]"]), withState));
			return events.filter((e) => e.event === "content_block_start").map((e) => e.data.content_block.id);
		};
		expect(await ids("abc123XYZ", state)).toEqual(["toolu_01ABC"]);
		expect(await ids("fresh.id", state)).toEqual(["fresh_id"]);
		expect(await ids("abc123XYZ", undefined)).toEqual(["abc123XYZ"]);
	});
});

describe("OpenAI client to an Anthropic upstream with a strict id format", () => {
	const policy = { alphabet: "a-z0-9", min: 6, max: 12 };
	const convert = (messages, toolCallIds) => toAnthropic({ model: "m", messages }, undefined, { toolCallIds });

	test("without a policy ids are only made Anthropic-valid, as before", async () => {
		const { body, state } = await convert(openaiThread("call.1:0"));
		expect(body.messages[1].content[0].id).toBe("call_1_0");
		expect(body.messages[2].content[0].tool_use_id).toBe("call_1_0");
		expect(state.toolIds).toEqual({});
	});

	test("with a policy a call and its result get the same stable value; conforming ids pass through", async () => {
		const { body, state } = await convert(openaiThread("call_ABC"), policy);
		const id = body.messages[1].content[0].id;
		expect(id).toMatch(/^[a-z0-9]{12}$/);
		expect(body.messages[2].content[0].tool_use_id).toBe(id);
		expect(state.toolIds).toEqual({ [id]: "call_ABC" });
		const same = await convert(openaiThread("call_ABC"), policy);
		expect(same.body.messages[1].content[0].id).toBe(id);
		const kept = await convert(openaiThread("abc123"), policy);
		expect(kept.body.messages[1].content[0].id).toBe("abc123");
		expect(kept.state.toolIds).toEqual({});
	});

	test("a reply that echoes a fitted id gets the client's original; an id the upstream made is passed as it is", () => {
		const state = { toolIds: { abcdef123456: "call_ABC" }, toolNames: {} };
		const reply = {
			id: "msg_1",
			type: "message",
			role: "assistant",
			model: "claude",
			stop_reason: "tool_use",
			content: [
				{ type: "tool_use", id: "abcdef123456", name: "a", input: {} },
				{ type: "tool_use", id: "toolu_0123", name: "b", input: {} }
			],
			usage: { input_tokens: 1, output_tokens: 1 }
		};
		expect(fromAnthropic(reply, state).choices[0].message.tool_calls.map((call) => call.id)).toEqual(["call_ABC", "toolu_0123"]);
		expect(fromAnthropic(reply, { toolNames: {} }).choices[0].message.tool_calls.map((call) => call.id)).toEqual([
			"abcdef123456",
			"toolu_0123"
		]);
	});

	test("a stream restores the same way", async () => {
		const state = { toolIds: { abcdef123456: "call_ABC" }, toolNames: {} };
		const events = (id) => [
			{
				data: {
					type: "message_start",
					message: {
						id: "msg_1",
						type: "message",
						role: "assistant",
						model: "claude",
						content: [],
						usage: { input_tokens: 1, output_tokens: 1 }
					}
				}
			},
			{ data: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name: "a", input: {} } } },
			{ data: { type: "content_block_stop", index: 0 } },
			{ data: { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } } },
			{ data: { type: "message_stop" } }
		];
		const ids = async (id, withState) => {
			const out = (await collect(streamFromAnthropic(anthropicSse(events(id)), withState))).map((e) => e.data);
			return out.flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls ?? []).map((call) => call.id);
		};
		expect(await ids("abcdef123456", state)).toEqual(["call_ABC"]);
		expect(await ids("toolu_0123", state)).toEqual(["toolu_0123"]);
		expect(await ids("abcdef123456", undefined)).toEqual(["abcdef123456"]);
	});
});
