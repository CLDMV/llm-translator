/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/strict.test.vitest.mjs
 *	@Date: 2026-11-06T09:30:00-08:00 (1793986200)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-06T09:30:00-08:00 (1793986200)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, make } from "../helpers/translator.mjs";
import { problems, strictTools } from "../../src/lib/strict.mjs";

afterEach(closeAll);

const GOOD = { type: "object", properties: { city: { type: "string" } }, required: ["city"], additionalProperties: false };
const LOOSE = { type: "object", properties: { city: { type: "string" }, unit: { type: "string" } }, required: ["city"] };

describe("strict.problems", () => {
	it("accepts a schema in the subset and anything that is not a schema object", () => {
		expect(problems(GOOD)).toEqual([]);
		expect(problems(undefined)).toEqual([]);
		expect(problems(null)).toEqual([]);
		expect(problems([GOOD])).toEqual([]);
		expect(problems({ type: "string" })).toEqual([]);
	});

	it("reports an object without additionalProperties: false and properties missing from required", () => {
		expect(problems(LOOSE)).toEqual(["$: object without additionalProperties: false", "$: properties not in required: unit"]);
		expect(problems({ type: "object" })).toEqual(["$: object without additionalProperties: false"]);
		expect(problems({ properties: { a: { type: "string" } }, additionalProperties: false, required: "a" })).toEqual([
			"$: properties not in required: a"
		]);
		expect(problems({ type: "object", properties: null, additionalProperties: false })).toEqual([]);
	});

	it("reports unsupported keywords and walks into nested schemas", () => {
		const schema = {
			type: "object",
			additionalProperties: false,
			required: ["list", "choice"],
			properties: {
				list: { type: "array", items: { type: "object", properties: { n: { type: "integer" } }, required: ["n"] }, uniqueItems: true },
				choice: { anyOf: [{ not: { type: "null" } }, { type: "string" }] }
			},
			$defs: { x: { allOf: [] }, bad: 3 },
			definitions: null
		};
		expect(problems(schema)).toEqual([
			"$.properties.list: unsupported keyword uniqueItems",
			"$.properties.list.items: object without additionalProperties: false",
			"$.properties.choice.anyOf[0]: unsupported keyword not",
			"$.$defs.x: unsupported keyword allOf"
		]);
	});
});

describe("strict.strictTools", () => {
	it("reads both wire shapes and skips tools that are not strict", () => {
		const found = strictTools({
			tools: [
				{ type: "function", function: { name: "a", strict: true, parameters: GOOD } },
				{ type: "function", function: { name: "b", strict: false, parameters: LOOSE } },
				{ name: "c", strict: true, input_schema: LOOSE },
				{ name: "d", strict: true },
				null
			]
		});
		expect(found.map((tool) => [tool.name, tool.problems.length])).toEqual([
			["a", 0],
			["c", 2],
			["d", 0]
		]);
		expect(strictTools({})).toEqual([]);
		expect(strictTools(undefined)).toEqual([]);
	});
});

describe("driver capability", () => {
	it("documents which drivers enforce strict tool use", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const strict = Object.fromEntries(
			["vllm", "anthropic", "openai", "compatible", "sglang", "ollama", "llamacpp", "deepseek"].map((name) => [
				name,
				api.driver[name].info().strict
			])
		);
		expect(strict).toEqual({
			vllm: true,
			anthropic: true,
			openai: true,
			compatible: false,
			sglang: false,
			ollama: false,
			llamacpp: false,
			deepseek: false
		});
	});
});

const tool = (schema, strict = true) => ({
	name: "weather",
	description: "d",
	input_schema: schema,
	...(strict === null ? {} : { strict })
});
const ask = (tools, extra = {}) => ({ model: "m", max_tokens: 16, messages: [{ role: "user", content: "hi" }], tools, ...extra });
const chatAsk = (parameters, strict = true) => ({
	model: "m",
	messages: [{ role: "user", content: "hi" }],
	tools: [{ type: "function", function: { name: "weather", parameters, ...(strict === null ? {} : { strict }) } }]
});

/** A translator with one endpoint on `backend`; returns it and the warnings it emits. */
async function open(backend, config = {}) {
	const api = await make({ upstreams: [{ name: "a", url: "http://a.test", backend }], detect: false, ...config });
	const warnings = [];
	api.events.on("warning", (event) => warnings.push(event));
	return { api, warnings };
}

describe("strict tools through request", () => {
	it("Anthropic front to Chat Completions keeps strict and stays quiet for an enforcing backend and a conforming schema", async () => {
		const { api, warnings } = await open("vllm");
		const result = await api.request(ask([tool(GOOD)]));
		expect(result.body.tools[0].function.strict).toBe(true);
		expect(warnings).toEqual([]);
	});

	it("reports a schema outside the subset but still sends the tool", async () => {
		const { api, warnings } = await open("vllm");
		const result = await api.request(ask([tool(LOOSE)]));
		expect(result.body.tools[0].function.strict).toBe(true);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatchObject({ kind: "strict", endpoint: "a" });
		expect(warnings[0].message).toContain("strict tool weather has a schema outside the strict subset");
		expect(warnings[0].message).toContain("additionalProperties: false");
	});

	it("records that a backend which cannot enforce strict did not", async () => {
		const { api, warnings } = await open("compatible");
		await api.request(ask([tool(GOOD)]));
		expect(warnings).toHaveLength(1);
		expect(warnings[0].message).toBe("Upstream a: the compatible backend does not enforce strict tool use (weather)");
	});

	it("does not repeat the reports for a retry", async () => {
		const { api, warnings } = await open("compatible");
		await api.request(ask([tool(LOOSE)]), { retry: true });
		expect(warnings).toEqual([]);
	});

	it("says nothing for tools that are not strict, and for a request without tools", async () => {
		const { api, warnings } = await open("compatible");
		await api.request(ask([tool(LOOSE, false)]));
		await api.request(ask([tool(LOOSE, null)]));
		await api.request(ask(undefined));
		expect(warnings).toEqual([]);
	});

	it("rejects a schema outside the subset under unknownFields: error", async () => {
		const { api } = await open("vllm", { settings: { unknownFields: "error" } });
		await expect(api.request(ask([tool(LOOSE)]))).rejects.toMatchObject({ code: "unsupported_content", param: "tools" });
		await expect(api.request(ask([tool(GOOD)]))).resolves.toBeTypeOf("object");
	});

	it("OpenAI front to Anthropic upstream maps function.strict to the tool's strict", async () => {
		const { api, warnings } = await open("anthropic");
		const result = await api.request(chatAsk(GOOD), { front: "openai" });
		expect(result.body.tools[0]).toMatchObject({ name: "weather", strict: true });
		expect(warnings).toEqual([]);
		const plain = await api.request(chatAsk(GOOD, null), { front: "openai" });
		expect(plain.body.tools[0].strict).toBeUndefined();
	});

	it("Anthropic front to a native Anthropic upstream passes strict through and checks the schema", async () => {
		const { api, warnings } = await open("anthropic");
		const result = await api.request(ask([tool(LOOSE)]));
		expect(result.body.tools[0].strict).toBe(true);
		expect(warnings).toHaveLength(1);
	});
});
