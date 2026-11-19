/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/constraint.test.vitest.mjs
 *	@Date: 2026-11-14T09:00:00-08:00 (1794333600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-14T09:00:00-08:00 (1794333600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, make } from "../helpers/translator.mjs";
import { addConstraint, check, fields } from "../../src/lib/constraint.mjs";
import { resolve } from "../../src/lib/settings.mjs";

afterEach(closeAll);

const hello = { model: "m", max_tokens: 64, messages: [{ role: "user", content: "hi" }] };
const schema = { type: "object", properties: { a: { type: "string" } } };
const build = (backend, settings, extra = {}, upstream = {}) =>
	make({ upstreams: [{ url: `http://${backend}.test`, backend, settings, ...upstream }], detect: false, ...extra });

describe("constraint validation", () => {
	it("accepts one kind with a well-formed value", () => {
		expect(check(undefined)).toBeNull();
		expect(check(null)).toBeNull();
		expect(check({ json: schema, regex: null })).toBeNull();
		expect(check({ regex: "a+" })).toBeNull();
		expect(check({ grammar: "root ::= x" })).toBeNull();
		expect(check({ choice: ["a", "b"] })).toBeNull();
	});

	it("rejects the rest", () => {
		for (const bad of ["x", [], {}, { json: schema, regex: "a" }, { other: 1 }]) expect(check(bad)).toMatch(/expected/);
		expect(check({ json: "s" })).toMatch(/JSON Schema/);
		expect(check({ json: [] })).toMatch(/JSON Schema/);
		expect(check({ regex: "" })).toMatch(/non-empty string/);
		expect(check({ grammar: 1 })).toMatch(/non-empty string/);
		for (const bad of [[], [""], [1], "a"]) expect(check({ choice: bad })).toMatch(/choice/);
	});

	it("is a setting that is validated and replaced whole", () => {
		expect(resolve().constraint).toBeNull();
		expect(resolve({ constraint: { regex: "a" } }, { constraint: { choice: ["x"] } }).constraint).toEqual({ choice: ["x"] });
		expect(() => resolve({ constraint: { regex: "" } })).toThrow(/Invalid setting constraint/);
	});
});

describe("native fields per backend", () => {
	it("vLLM sends structured_outputs, or guided_* before 0.11.0", () => {
		for (const name of ["vllm", "compatible"]) {
			expect(fields(name, "0.11.0", "regex", "a+")).toEqual({ structured_outputs: { regex: "a+" } });
			expect(fields(name, undefined, "choice", ["a"])).toEqual({ structured_outputs: { choice: ["a"] } });
		}
		expect(fields("vllm", "0.10.1", "json", schema)).toEqual({ guided_json: schema });
		expect(fields("vllm", "0.10.1", "grammar", "g")).toEqual({ guided_grammar: "g" });
	});

	it("SGLang sends regex and ebnf, and a choice as an escaped regex", () => {
		expect(fields("sglang", undefined, "regex", "a+")).toEqual({ regex: "a+" });
		expect(fields("sglang", undefined, "grammar", "g")).toEqual({ ebnf: "g" });
		expect(fields("sglang", undefined, "choice", ["a.b", "c"])).toEqual({ regex: "(?:a\\.b|c)" });
		expect(fields("sglang", undefined, "json", schema)).toEqual({
			response_format: { type: "json_schema", json_schema: { name: "constraint", schema, strict: true } }
		});
	});

	it("llama.cpp sends grammar and json_schema, and a choice as GBNF; it has no regex", () => {
		expect(fields("llamacpp", undefined, "grammar", "root ::= x")).toEqual({ grammar: "root ::= x" });
		expect(fields("llamacpp", undefined, "json", schema)).toEqual({ json_schema: schema });
		expect(fields("llamacpp", undefined, "choice", ["a", 'b"c'])).toEqual({ grammar: 'root ::= "a" | "b\\"c"' });
		expect(fields("llamacpp", undefined, "regex", "a")).toBeNull();
	});

	it("TGI sends json and regex grammars, and a choice as a regex; it has no EBNF", () => {
		expect(fields("tgi", undefined, "json", schema)).toEqual({ response_format: { type: "json", value: schema } });
		expect(fields("tgi", undefined, "regex", "a+")).toEqual({ response_format: { type: "regex", value: "a+" } });
		expect(fields("tgi", undefined, "choice", ["a", "b"])).toEqual({ response_format: { type: "regex", value: "(?:a|b)" } });
		expect(fields("tgi", undefined, "grammar", "g")).toBeNull();
	});

	it("any other backend gets a JSON Schema as response_format and nothing else", () => {
		expect(fields("openai", undefined, "json", schema).response_format.type).toBe("json_schema");
		expect(fields("openai", undefined, "regex", "a")).toBeNull();
	});
});

describe("addConstraint", () => {
	const target = { name: "vllm", version: undefined };

	it("adds nothing without a constraint and rejects a malformed request value", () => {
		const body = {};
		expect(addConstraint(body, undefined, resolve(), target)).toBe(body);
		expect(() => addConstraint(body, { json: 1 }, resolve(), target)).toThrow(/constraint: json/);
		expect(() => addConstraint(body, { json: 1 }, resolve(), target)).toThrowError(expect.objectContaining({ code: "invalid_request" }));
	});

	it("lets the request override the setting and keeps a native field the body has", () => {
		const settings = resolve({ constraint: { regex: "a" } });
		expect(addConstraint({}, { choice: ["x"] }, settings, target)).toEqual({ structured_outputs: { choice: ["x"] } });
		expect(addConstraint({}, undefined, settings, target)).toEqual({ structured_outputs: { regex: "a" } });
		const own = { structured_outputs: { regex: "mine" } };
		expect(addConstraint(own, undefined, settings, target)).toBe(own);
	});

	it("drops an unsupported kind and records it once, or rejects it with unknownFields: error", () => {
		const dropped = [];
		const body = {};
		const tgi = { name: "tgi" };
		expect(addConstraint(body, { grammar: "g" }, resolve(), tgi, dropped)).toBe(body);
		addConstraint(body, { grammar: "g" }, resolve(), tgi, dropped);
		expect(dropped).toEqual(["constraint.grammar"]);
		expect(() => addConstraint(body, { grammar: "g" }, resolve({ unknownFields: "error" }), tgi)).toThrowError(
			expect.objectContaining({ code: "unsupported_field", param: "constraint.grammar" })
		);
	});

	it("drops a vLLM constraint when tools are on offer, unless tool_choice is none", () => {
		const dropped = [];
		const tools = [{ type: "function", function: { name: "t" } }];
		const withTools = { tools };
		expect(addConstraint(withTools, { regex: "a" }, resolve(), target, dropped)).toBe(withTools);
		expect(dropped).toEqual(["constraint.regex"]);
		expect(addConstraint({ tools, tool_choice: "none" }, { regex: "a" }, resolve(), target).structured_outputs).toEqual({ regex: "a" });
		expect(addConstraint({ tools: [] }, { regex: "a" }, resolve(), target).structured_outputs).toEqual({ regex: "a" });
	});
});

describe("constraint on a request", () => {
	it("takes metadata.constraint on the Anthropic front and the setting as a default", async () => {
		const vllm = await build("vllm", { constraint: { regex: "a+" } }, {}, { version: "0.12.0", api: "chat" });
		expect((await vllm.request(hello)).body.structured_outputs).toEqual({ regex: "a+" });
		const result = await vllm.request({ ...hello, metadata: { user_id: "u", constraint: { choice: ["yes", "no"] } } });
		expect(result.body.structured_outputs).toEqual({ choice: ["yes", "no"] });
		expect(result.body.metadata).toBeUndefined();
		const old = await build("vllm", {}, {}, { version: "0.10.1" });
		expect((await old.request({ ...hello, metadata: { constraint: { json: schema } } })).body.guided_json).toEqual(schema);
	});

	it("takes `constraint` on the OpenAI front and never forwards it as such", async () => {
		const sglang = await build("sglang", {}, { front: "openai" });
		const result = await sglang.request({ ...hello, constraint: { grammar: "root ::= x" } });
		expect(result.body.ebnf).toBe("root ::= x");
		expect(result.body.constraint).toBeUndefined();
		const llama = await build("llamacpp", { passthroughFilter: true }, { front: "openai" });
		expect((await llama.request({ ...hello, constraint: { json: schema } })).body.json_schema).toEqual(schema);
	});

	it("records an unsupported kind in state.dropped on a converted request", async () => {
		const llama = await build("llamacpp");
		const result = await llama.request({ ...hello, metadata: { constraint: { regex: "a+" } } });
		expect(result.state.convert.dropped).toContain("constraint.regex");
		expect(result.state.convert.dropped.filter((name) => name === "constraint.regex")).toHaveLength(1);
	});

	it("rejects a malformed constraint with a 400", async () => {
		const api = await build("vllm");
		await expect(api.request({ ...hello, metadata: { constraint: { regex: 5 } } })).rejects.toMatchObject({ code: "invalid_request" });
	});

	it("is recorded as dropped for a protocol without native constrained decoding, and stripped from a forwarded body", async () => {
		const ollama = await build("ollama", { constraint: { regex: "a" } }, {}, { api: "native" });
		expect((await ollama.request(hello)).state.convert.dropped).toContain("constraint");
		const again = await build("ollama", {}, {}, { api: "native" });
		const result = await again.request({ ...hello, metadata: { constraint: { regex: "a" } } });
		expect(result.state.convert.dropped.filter((name) => name === "constraint")).toHaveLength(1);

		const anthropic = await build("anthropic");
		const forwarded = await anthropic.request({ ...hello, metadata: { user_id: "u", constraint: { regex: "a" } } });
		expect(forwarded.body.metadata).toEqual({ user_id: "u" });
	});

	it("leaves a body without a constraint alone on a native Anthropic upstream", async () => {
		const anthropic = await build("anthropic");
		const result = await anthropic.request({ ...hello, metadata: { user_id: "u" } });
		expect(result.body.metadata).toEqual({ user_id: "u" });
		const noConstraint = await anthropic.request(hello);
		expect(noConstraint.body.metadata).toBeUndefined();
	});
});
