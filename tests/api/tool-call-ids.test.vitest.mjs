/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/tool-call-ids.test.vitest.mjs
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
 * @fileoverview Tool-call id policy through the whole `send` path with test-only drivers mounted the way third-party drivers are.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { anthropicSse, openaiSse } from "../helpers/streams.mjs";

afterEach(closeAll);

const fixture = (name) => new URL(`../fixtures/driver/${name}`, import.meta.url).pathname;
const mount = async (config, name) => {
	const api = await make({ detect: false, ...config });
	await api.slothlet.api.add(["driver", name], fixture(name));
	await api.detect();
	return api;
};
const sent = (transport) => JSON.parse(transport.calls.at(-1).init.body);

describe("driver toolCallIds validation", () => {
	it("rejects an unusable policy at detection with invalid_driver", async () => {
		const api = await make({ upstreams: ["http://a.test"], detect: false });
		await api.slothlet.api.add(["driver", "idsbad"], fixture("idsbad"));
		await expect(api.detect()).rejects.toMatchObject({ code: "invalid_driver", message: expect.stringContaining("Driver idsbad") });
	});

	it("accepts a valid policy and binds the driver", async () => {
		const api = await mount({ upstreams: ["http://a.test"], transport: fakeTransport(() => ({ body: {} })) }, "idsmistral");
		expect(api.status().upstreams[0].driver).toBe("idsmistral");
		expect(api.driver.idsmistral.info().toolCallIds).toEqual({ alphabet: "a-zA-Z0-9", min: 9, max: 9 });
	});
});

describe("Anthropic client to an OpenAI-style upstream with strict ids", () => {
	const history = [
		{ role: "user", content: "weather?" },
		{ role: "assistant", content: [{ type: "tool_use", id: "toolu_01ABC", name: "weather", input: { city: "Oslo" } }] },
		{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01ABC", content: "rain" }] }
	];
	const body = { model: "m", max_tokens: 50, messages: history };
	const reply = (id) => ({
		id: "c1",
		model: "m",
		choices: [
			{
				index: 0,
				finish_reason: "tool_calls",
				message: {
					role: "assistant",
					content: null,
					tool_calls: [{ id, type: "function", function: { name: "weather", arguments: "{}" } }]
				}
			}
		],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
	});
	const setup = async (answer) => {
		const transport = fakeTransport(() => answer());
		const api = await mount({ upstreams: ["http://a.test"], transport }, "idsmistral");
		return { api, transport };
	};

	it("sends valid ids upstream, the same for the call and its result, on every request", async () => {
		const { api, transport } = await setup(() => ({ body: reply("Zx9Qm2Lp1") }));
		await api.send(body);
		const first = sent(transport);
		const callId = first.messages.find((m) => m.role === "assistant").tool_calls[0].id;
		expect(callId).toMatch(/^[a-zA-Z0-9]{9}$/);
		expect(first.messages.find((m) => m.role === "tool").tool_call_id).toBe(callId);
		await api.send(body);
		expect(sent(transport).messages.find((m) => m.role === "assistant").tool_calls[0].id).toBe(callId);
	});

	it("restores an echoed id and passes the upstream's own ids through, not streaming", async () => {
		let answer = reply("Zx9Qm2Lp1");
		const { api, transport } = await setup(() => ({ body: answer }));
		const own = await api.send(body);
		expect(own.body.content.find((b) => b.type === "tool_use").id).toBe("Zx9Qm2Lp1");
		answer = reply(sent(transport).messages.find((m) => m.role === "assistant").tool_calls[0].id);
		const echoed = await api.send(body);
		expect(echoed.body.content.find((b) => b.type === "tool_use").id).toBe("toolu_01ABC");
	});

	it("restores an echoed id in a stream", async () => {
		const chunk = (delta, finish = null) => ({ id: "c1", model: "m", choices: [{ index: 0, delta, finish_reason: finish }] });
		let id = "Zx9Qm2Lp1";
		const { api, transport } = await setup(() => ({
			headers: { "content-type": "text/event-stream" },
			body: openaiSse([
				chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name: "weather", arguments: "{}" } }] }),
				chunk({}, "tool_calls"),
				"[DONE]"
			])
		}));
		const ids = async () => {
			const reply = await api.send({ ...body, stream: true });
			return (await collect(reply.stream)).filter((e) => e.event === "content_block_start").map((e) => e.data.content_block.id);
		};
		expect(await ids()).toEqual(["Zx9Qm2Lp1"]);
		id = sent(transport).messages.find((m) => m.role === "assistant").tool_calls[0].id;
		expect(await ids()).toEqual(["toolu_01ABC"]);
	});
});

describe("OpenAI client to an Anthropic upstream with a strict id format", () => {
	const history = [
		{ role: "user", content: "weather?" },
		{
			role: "assistant",
			content: null,
			tool_calls: [{ id: "call_ABC", type: "function", function: { name: "weather", arguments: "{}" } }]
		},
		{ role: "tool", tool_call_id: "call_ABC", content: "rain" }
	];
	const body = { model: "claude", messages: history };
	const reply = (id) => ({
		id: "msg_1",
		type: "message",
		role: "assistant",
		model: "claude",
		stop_reason: "tool_use",
		content: [{ type: "tool_use", id, name: "weather", input: {} }],
		usage: { input_tokens: 1, output_tokens: 1 }
	});
	const setup = async (answer) => {
		const transport = fakeTransport(() => answer());
		const api = await mount({ front: "openai", upstreams: ["http://a.test"], transport }, "idsanthropic");
		return { api, transport };
	};
	const upstreamId = (transport) => sent(transport).messages.find((m) => m.role === "assistant").content[0].id;

	it("sends valid ids upstream and restores an echoed one, not streaming", async () => {
		let answer = reply("abc123");
		const { api, transport } = await setup(() => ({ body: answer }));
		const own = await api.send(body);
		expect(own.body.choices[0].message.tool_calls[0].id).toBe("abc123");
		const id = upstreamId(transport);
		expect(id).toMatch(/^[a-z0-9]{12}$/);
		expect(sent(transport).messages.find((m) => m.role === "user" && m.content[0]?.type === "tool_result").content[0].tool_use_id).toBe(id);
		answer = reply(id);
		const echoed = await api.send(body);
		expect(echoed.body.choices[0].message.tool_calls[0].id).toBe("call_ABC");
	});

	it("restores an echoed id in a stream", async () => {
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
			{ data: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name: "weather", input: {} } } },
			{ data: { type: "content_block_stop", index: 0 } },
			{ data: { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } } },
			{ data: { type: "message_stop" } }
		];
		let id = "abc123";
		const { api, transport } = await setup(() => ({ headers: { "content-type": "text/event-stream" }, body: anthropicSse(events(id)) }));
		const ids = async () => {
			const reply = await api.send({ ...body, stream: true });
			return (await collect(reply.stream)).flatMap((e) => e.data?.choices?.[0]?.delta?.tool_calls ?? []).map((call) => call.id);
		};
		expect(await ids()).toEqual(["abc123"]);
		id = upstreamId(transport);
		expect(await ids()).toEqual(["call_ABC"]);
	});
});
