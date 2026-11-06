/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/effort.test.vitest.mjs
 *	@Date: 2026-11-02T00:00:00-08:00 (1793606400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-02T00:00:00-08:00 (1793606400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Per-model effort levels and aliases that pin settings.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultOf, fit, nearest, normalizeAliases, normalizeEfforts, pinBody } from "../../src/lib/effort.mjs";
import { closeAll, make } from "../helpers/translator.mjs";

afterEach(() => {
	closeAll();
	vi.restoreAllMocks();
});

const GLM = ["low", "high", "max"];
const upstream = { url: "http://vllm.test", backend: "vllm", version: "0.30.0" };
const base = { model: "GLM-5.3-Flash", max_tokens: 64, messages: [{ role: "user", content: "hi" }] };

/**
 * Translator over a vLLM upstream with a configured level list for GLM.
 * @param {object} [extra] - More config.
 * @returns {Promise<any>} Translator.
 */
function glm(extra = {}) {
	return make({ upstreams: [upstream], detect: false, efforts: { "GLM-5.3-Flash": GLM }, ...extra });
}

describe("effort config", () => {
	it("normalizes lists, sorts them and keeps an explicit default", () => {
		expect(normalizeEfforts()).toEqual({});
		expect(
			normalizeEfforts({ a: ["max", "low", "low"], b: { levels: ["low", "high"], default: null }, c: { levels: ["low"], default: "low" } })
		).toEqual({
			a: { levels: ["low", "max"], default: undefined },
			b: { levels: ["low", "high"], default: null },
			c: { levels: ["low"], default: "low" }
		});
	});

	it("rejects bad lists, unknown levels and a default outside the list", () => {
		expect(() => normalizeEfforts({ a: [] })).toThrow(/non-empty list/);
		expect(() => normalizeEfforts({ a: "low" })).toThrow(/non-empty list/);
		expect(() => normalizeEfforts({ a: ["none"] })).toThrow(/unknown level/);
		expect(() => normalizeEfforts({ a: { levels: ["low"], default: "high" } })).toThrow(/default/);
	});

	it("splits aliases into names and pins", () => {
		expect(normalizeAliases()).toEqual({ aliases: {}, pins: {} });
		expect(normalizeAliases({ a: "m", b: { model: "m", effort: "max" }, c: { model: "m", thinking: false }, d: { model: "m" } })).toEqual({
			aliases: { a: "m", b: "m", c: "m", d: "m" },
			pins: { b: { effort: "max" }, c: { thinking: false } }
		});
	});

	it("rejects bad aliases", () => {
		expect(() => normalizeAliases({ a: null })).toThrow(/aliases\.a/);
		expect(() => normalizeAliases({ a: { effort: "low" } })).toThrow(/aliases\.a/);
		expect(() => normalizeAliases({ a: { model: "m", effort: "none" } })).toThrow(/effort/);
		expect(() => normalizeAliases({ a: { model: "m", thinking: "no" } })).toThrow(/thinking/);
	});
});

describe("nearest and defaultOf", () => {
	it("snaps down, up and ties to the higher level", () => {
		expect(nearest(GLM, "low")).toBe("low");
		expect(nearest(GLM, "minimal")).toBe("low");
		expect(nearest(GLM, "medium")).toBe("high");
		expect(nearest(GLM, "xhigh")).toBe("max");
		expect(nearest(["low", "max"], "medium")).toBe("low");
		expect(nearest(["high", "low"], "medium")).toBe("high");
	});

	it("uses the level nearest to medium unless the entry says otherwise", () => {
		expect(defaultOf({ levels: GLM, default: undefined })).toBe("high");
		expect(defaultOf({ levels: GLM, default: "low" })).toBe("low");
		expect(defaultOf({ levels: GLM, default: null })).toBeNull();
	});
});

describe("pinBody", () => {
	it("pins effort and thinking on an Anthropic body", () => {
		expect(pinBody({ a: 1, output_config: { format: 1 } }, { effort: "max" }, "anthropic")).toEqual({
			a: 1,
			output_config: { format: 1, effort: "max" }
		});
		expect(pinBody({}, { thinking: false }, "anthropic")).toEqual({ thinking: { type: "disabled" } });
		expect(pinBody({}, { thinking: true }, "anthropic")).toEqual({ thinking: { type: "adaptive" } });
		expect(pinBody({ thinking: { type: "disabled" } }, { thinking: true }, "anthropic").thinking).toEqual({ type: "adaptive" });
		expect(pinBody({ thinking: { type: "enabled", budget_tokens: 5 } }, { thinking: true }, "anthropic").thinking).toEqual({
			type: "enabled",
			budget_tokens: 5
		});
	});

	it("pins effort and thinking on an OpenAI body", () => {
		expect(pinBody({ reasoning_effort: "low" }, { effort: "max" }, "openai")).toEqual({ reasoning_effort: "max" });
		expect(pinBody({ reasoning_effort: "low" }, { effort: "max", thinking: false }, "openai")).toEqual({ reasoning_effort: "none" });
		expect(pinBody({ reasoning_effort: "none" }, { thinking: true }, "openai")).toEqual({});
		expect(pinBody({ reasoning_effort: "low" }, { thinking: true }, "openai")).toEqual({ reasoning_effort: "low" });
	});
});

describe("fit", () => {
	const entry = { levels: GLM, default: undefined };

	it("keeps listed levels, snaps others with a message and leaves off and unknown values alone", () => {
		const warn = vi.fn();
		const run = (body) => {
			fit(body, entry, "m", warn);
			return body;
		};
		expect(run({ reasoning_effort: "max" }).reasoning_effort).toBe("max");
		expect(warn).not.toHaveBeenCalled();
		expect(run({ reasoning_effort: "medium" }).reasoning_effort).toBe("high");
		expect(warn).toHaveBeenCalledWith('Effort "medium" is not supported by m (low, high, max); using "high".', {
			requested: "medium",
			used: "high",
			levels: GLM
		});
		expect(run({ reasoning_effort: "none" }).reasoning_effort).toBe("none");
		expect(run({ chat_template_kwargs: { enable_thinking: false } }).reasoning_effort).toBeUndefined();
		expect(run({ reasoning_effort: "weird" }).reasoning_effort).toBe("weird");
		expect(run({}).reasoning_effort).toBe("high");
		expect(run({ reasoning_effort: null }).reasoning_effort).toBe("high");
	});

	it("sends nothing when the model has its own default", () => {
		const body = {};
		fit(body, { levels: GLM, default: null }, "m", vi.fn());
		expect(body).toEqual({});
	});
});

describe("request with a level list", () => {
	it("sends a listed level as is, including max, without effortPassthrough", async () => {
		const api = await glm();
		for (const level of GLM) {
			const prepared = await api.request({ ...base, output_config: { effort: level } });
			expect(prepared.body.reasoning_effort).toBe(level);
		}
	});

	it("snaps an unlisted level to the nearest in each direction and warns once", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const api = await make({ upstreams: [upstream], detect: false, logs: true, efforts: { "GLM-5.3-Flash": GLM } });
		const send = async (effort) => (await api.request({ ...base, output_config: { effort } })).body.reasoning_effort;
		expect(await send("minimal")).toBe("low");
		expect(await send("medium")).toBe("high");
		expect(await send("medium")).toBe("high");
		expect(await send("xhigh")).toBe("max");
		expect(warn).toHaveBeenCalledTimes(3);
		expect(warn.mock.calls[0][0]).toContain('Effort "minimal" is not supported by GLM-5.3-Flash');
	});

	it("sends the model's default, not medium, when thinking is on and no effort is given", async () => {
		const api = await glm({ upstreams: [{ ...upstream, settings: { thinking: "reasoning_effort" } }] });
		const prepared = await api.request({ ...base, thinking: { type: "enabled", budget_tokens: 100 } });
		expect(prepared.body.reasoning_effort).toBe("high");
		const plain = await api.request(base);
		expect(plain.body.reasoning_effort).toBe("high");
		const named = await glm({ efforts: { "GLM-5.3-Flash": { levels: GLM, default: "low" } } });
		expect((await named.request(base)).body.reasoning_effort).toBe("low");
	});

	it("sends no effort when the list says the model has its own default, and keeps thinking off alone", async () => {
		const own = await glm({ efforts: { "GLM-5.3-Flash": { levels: GLM, default: null } } });
		expect((await own.request(base)).body.reasoning_effort).toBeUndefined();
		const api = await glm();
		const off = await api.request({ ...base, thinking: { type: "disabled" } });
		expect(off.body.reasoning_effort).toBeUndefined();
		expect(off.body.chat_template_kwargs).toEqual({ enable_thinking: false });
	});

	it("fits the reasoning_effort of an OpenAI client body", async () => {
		const api = await glm({ front: "openai" });
		const body = { model: "GLM-5.3-Flash", messages: base.messages };
		expect((await api.request({ ...body, reasoning_effort: "medium" })).body.reasoning_effort).toBe("high");
		expect((await api.request({ ...body, reasoning_effort: "none" })).body.reasoning_effort).toBe("none");
	});

	it("matches by model name after aliases", async () => {
		const api = await glm({ aliases: { opus: "GLM-5.3-Flash" } });
		expect((await api.request({ ...base, model: "opus", output_config: { effort: "xhigh" } })).body.reasoning_effort).toBe("max");
	});

	it("keeps today's behaviour for a model without a list", async () => {
		const api = await glm();
		const other = await api.request({ ...base, model: "other", output_config: { effort: "max" } });
		expect(other.body.reasoning_effort).toBe("high");
		const raw = await make({ upstreams: [{ ...upstream, settings: { effortPassthrough: true } }], detect: false });
		expect((await raw.request({ ...base, output_config: { effort: "max" } })).body.reasoning_effort).toBe("max");
		const medium = await make({ upstreams: [{ ...upstream, settings: { thinking: "reasoning_effort" } }], detect: false });
		expect((await medium.request({ ...base, thinking: { type: "enabled", budget_tokens: 100 } })).body.reasoning_effort).toBe("medium");
	});

	it("does not touch a request to an Anthropic-protocol upstream", async () => {
		const api = await make({
			upstreams: [{ url: "https://api.anthropic.com", apiKey: "k", backend: "anthropic" }],
			detect: false,
			efforts: { "claude-sonnet-5-5": ["low", "high"] }
		});
		const prepared = await api.request({ ...base, model: "claude-sonnet-5-5", output_config: { effort: "max" } });
		expect(prepared.body.output_config.effort).toBe("max");
	});

	it("lets the vLLM driver clamp only when no list is given", async () => {
		const api = await glm();
		expect(api.driver.vllm.request({ model: "m", reasoning_effort: "max" }, { levels: { levels: GLM } }).reasoning_effort).toBe("max");
	});
});

describe("aliases that pin settings", () => {
	const aliases = {
		"glm-flash-max": { model: "GLM-5.3-Flash", effort: "max" },
		"glm-flash-low": { model: "GLM-5.3-Flash", effort: "low" },
		"glm-flash-medium": { model: "GLM-5.3-Flash", effort: "medium" },
		"glm-flash-off": { model: "GLM-5.3-Flash", thinking: false },
		plain: "GLM-5.3-Flash"
	};

	it("overrides the request's effort, even with effort mapping off", async () => {
		const api = await glm({ aliases, upstreams: [{ ...upstream, version: "0.10.0" }] });
		const prepared = await api.request({ ...base, model: "glm-flash-max", output_config: { effort: "low" } });
		expect(prepared.body.reasoning_effort).toBe("max");
		expect(prepared.body.model).toBe("GLM-5.3-Flash");
		expect(prepared.state.model).toBe("glm-flash-max");
		expect((await api.request({ ...base, model: "glm-flash-low" })).body.reasoning_effort).toBe("low");
	});

	it("sends a pinned effort through the model's list", async () => {
		const api = await glm({ aliases });
		expect((await api.request({ ...base, model: "glm-flash-medium" })).body.reasoning_effort).toBe("high");
	});

	it("pins on an OpenAI front", async () => {
		const api = await glm({ aliases, front: "openai" });
		const body = { model: "glm-flash-max", messages: base.messages, reasoning_effort: "low" };
		expect((await api.request(body)).body.reasoning_effort).toBe("max");
	});

	it("turns thinking off when an alias says so", async () => {
		const api = await glm({ aliases });
		const prepared = await api.request({ ...base, model: "glm-flash-off", thinking: { type: "enabled", budget_tokens: 50 } });
		expect(prepared.body.chat_template_kwargs).toEqual({ enable_thinking: false });
		expect(prepared.body.reasoning_effort).toBeUndefined();
	});

	it("leaves string aliases and the request alone", async () => {
		const api = await glm({ aliases });
		const prepared = await api.request({ ...base, model: "plain", output_config: { effort: "low" } });
		expect(prepared.body.reasoning_effort).toBe("low");
		expect(prepared.body.model).toBe("GLM-5.3-Flash");
	});
});

describe("model list with levels and aliases", () => {
	const aliases = {
		"glm-flash-max": { model: "GLM-5.3-Flash", effort: "max" },
		"glm-flash-medium": { model: "GLM-5.3-Flash", effort: "medium" },
		"glm-flash-off": { model: "GLM-5.3-Flash", thinking: false },
		plain: "GLM-5.3-Flash"
	};
	const served = { url: "http://vllm.test", backend: "vllm", models: ["GLM-5.3-Flash", "other"] };

	it("shows the levels of a configured model and the alias names (Anthropic shape)", async () => {
		const api = await glm({ aliases, upstreams: [served] });
		const list = await api.model.list();
		const byId = Object.fromEntries(list.data.map((entry) => [entry.id, entry]));
		expect(byId["GLM-5.3-Flash"]).toMatchObject({ efforts: GLM, default_effort: "high" });
		expect(byId.other.efforts).toBeUndefined();
		expect(byId["glm-flash-max"]).toMatchObject({ alias_of: "GLM-5.3-Flash", efforts: ["max"], effort: "max", default_effort: "max" });
		expect(byId["glm-flash-medium"]).toMatchObject({ efforts: ["high"], effort: "high" });
		expect(byId["glm-flash-off"]).toMatchObject({ alias_of: "GLM-5.3-Flash", thinking: false });
		expect(byId["glm-flash-off"].efforts).toBeUndefined();
		expect(byId.plain).toMatchObject({ alias_of: "GLM-5.3-Flash", efforts: GLM });
	});

	it("shows them in the OpenAI shape, a pin without a list, and through model.get", async () => {
		const api = await make({
			front: "openai",
			upstreams: [served],
			detect: false,
			efforts: { "GLM-5.3-Flash": { levels: GLM, default: null } },
			aliases: { pinned: { model: "other", effort: "low" } }
		});
		const list = await api.model.list();
		const byId = Object.fromEntries(list.data.map((entry) => [entry.id, entry]));
		expect(byId["GLM-5.3-Flash"]).toMatchObject({ object: "model", efforts: GLM, default_effort: null });
		expect(byId.pinned).toMatchObject({ alias_of: "other", effort: "low", efforts: ["low"] });
		expect(await api.model.get("pinned")).toMatchObject({ id: "pinned", effort: "low" });
	});
});
