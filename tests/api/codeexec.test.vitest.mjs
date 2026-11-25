/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/codeexec.test.vitest.mjs
 *	@Date: 2026-11-25T01:00:00-08:00 (1795597200)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-25T01:00:00-08:00 (1795597200)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The `code_execution_*` server tool: the executor with a fake sandbox, and the tool through the server tool runner.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import { TranslatorError } from "../../src/lib/errors.mjs";
import { codeExecution } from "../../src/lib/codeexec.mjs";
import { codeExecution as exported } from "../../src/index.mjs";

afterEach(async () => {
	await closeAll();
});

const chat = { url: "http://vllm.test", backend: "vllm", api: "chat", models: ["qwen3-coder"] };
const python = { type: "code_execution_20250522", name: "code_execution" };
const bash = { type: "code_execution_20250825", name: "code_execution" };
const ask = (tool) => ({ model: "qwen3-coder", max_tokens: 64, messages: [{ role: "user", content: "run it" }], tools: [tool] });

/** A sandbox that records its jobs and answers with `answer(job)` (default: an empty successful run). */
function sandbox(answer = () => ({})) {
	const jobs = [];
	return {
		jobs,
		name: "fake",
		run: async (job) => {
			jobs.push(job);
			return answer(job);
		}
	};
}

const run = (executor, tool, input, signal) => executor.run(input, { tool, signal });

describe("codeExecution executor", () => {
	it("offers a Python schema for 20250522 and a bash schema for later versions", () => {
		const executor = codeExecution({ sandbox: sandbox() });
		expect(executor.type.test("code_execution_20250825")).toBe(true);
		expect(executor.schema(python)).toEqual({
			type: "object",
			properties: { code: { type: "string", description: "The Python code to run." } },
			required: ["code"]
		});
		expect(executor.schema(bash)).toEqual({
			type: "object",
			properties: { command: { type: "string", description: "The bash command to run." } },
			required: ["command"]
		});
		expect(executor.description(python)).toMatch(/Python/);
		expect(executor.description(bash)).toMatch(/bash/);
		expect(executor.result(python)).toBe("code_execution_tool_result");
		expect(executor.result(bash)).toBe("bash_code_execution_tool_result");
	});

	it("rejects an unusable configuration", () => {
		expect(() => codeExecution()).toThrow(TranslatorError);
		expect(() => codeExecution({})).toThrow(/sandbox must have a run function/);
		expect(() => codeExecution({ sandbox: {} })).toThrow(/sandbox/);
		expect(() => codeExecution({ sandbox: sandbox(), timeout: 0 })).toThrow(/timeout/);
		expect(() => codeExecution({ sandbox: sandbox(), maxOutput: 1.5 })).toThrow(/maxOutput/);
		expect(codeExecution({ sandbox: sandbox(), type: "code_execution_20250522" }).type).toBe("code_execution_20250522");
	});

	it("runs Python code and returns a code_execution_result", async () => {
		const fake = sandbox(() => ({ stdout: "4\n", stderr: "warn\n", return_code: 0 }));
		const out = await run(codeExecution({ sandbox: fake }), python, { code: "print(2+2)" });
		expect(out.content).toEqual({ type: "code_execution_result", stdout: "4\n", stderr: "warn\n", return_code: 0, content: [] });
		expect(fake.jobs).toHaveLength(1);
		expect(fake.jobs[0]).toMatchObject({ kind: "python", code: "print(2+2)" });
		expect(fake.jobs[0]).not.toHaveProperty("command");
		expect(fake.jobs[0].signal).toBeInstanceOf(AbortSignal);
	});

	it("runs a bash command and returns a bash_code_execution_result", async () => {
		const fake = sandbox(() => ({ stdout: "x", return_code: 2 }));
		const out = await run(codeExecution({ sandbox: fake }), bash, { command: "ls" });
		expect(out.content).toEqual({ type: "bash_code_execution_result", stdout: "x", stderr: "", return_code: 2, content: [] });
		expect(fake.jobs[0]).toMatchObject({ kind: "bash", command: "ls" });
		expect(fake.jobs[0]).not.toHaveProperty("code");
	});

	it("treats missing output as empty and a missing return_code as 0", async () => {
		const out = await run(codeExecution({ sandbox: sandbox(() => ({ stdout: 5 })) }), bash, { command: "true" });
		expect(out.content).toMatchObject({ stdout: "", stderr: "", return_code: 0 });
	});

	it("rejects input without code or a command", async () => {
		const executor = codeExecution({ sandbox: sandbox() });
		await expect(run(executor, python, { code: "  " })).rejects.toMatchObject({ code: "invalid_tool_input" });
		await expect(run(executor, python, { command: "ls" })).rejects.toMatchObject({ code: "invalid_tool_input" });
		await expect(run(executor, bash, { command: 5 })).rejects.toMatchObject({ code: "invalid_tool_input" });
		await expect(run(executor, bash, undefined)).rejects.toMatchObject({ code: "invalid_tool_input" });
	});

	it("truncates stdout and stderr to maxOutput", async () => {
		const fake = sandbox(() => ({ stdout: "a".repeat(12), stderr: "b".repeat(5) }));
		const out = await run(codeExecution({ sandbox: fake, maxOutput: 10 }), bash, { command: "x" });
		expect(out.content.stdout).toBe("aaaaaaaaaa\n[truncated 2 characters]");
		expect(out.content.stderr).toBe("bbbbb");
	});

	it("keeps the error codes a sandbox reports and turns any other error into unavailable", async () => {
		const failing = (error) => codeExecution({ sandbox: { run: async () => Promise.reject(error) } });
		const code = async (error) => run(failing(error), bash, { command: "x" }).catch((e) => [e.code, e.message]);
		for (const known of [
			"too_many_requests",
			"container_expired",
			"output_file_too_large",
			"execution_time_exceeded",
			"invalid_tool_input"
		]) {
			expect((await code(Object.assign(new Error("m"), { code: known })))[0]).toBe(known);
		}
		expect(await code(Object.assign(new Error("boom"), { code: "EPIPE" }))).toEqual(["unavailable", "boom"]);
		expect(await code("plain")).toEqual(["unavailable", "plain"]);
	});

	it("answers unavailable for a sandbox that returns nothing usable", async () => {
		for (const bad of [undefined, "text", { return_code: "1" }, { return_code: 1.5 }]) {
			const executor = codeExecution({ sandbox: sandbox(() => bad) });
			await expect(run(executor, bash, { command: "x" })).rejects.toMatchObject({ code: "unavailable" });
		}
	});

	it("stops a run that exceeds the time limit, whether or not the sandbox honours the signal", async () => {
		let seen;
		const hung = codeExecution({
			sandbox: {
				run: (job) => {
					seen = job.signal;
					return new Promise(() => {});
				}
			},
			timeout: 5
		});
		await expect(run(hung, bash, { command: "sleep" })).rejects.toMatchObject({ code: "execution_time_exceeded" });
		expect(seen.aborted).toBe(true);
		const polite = codeExecution({
			sandbox: { run: (job) => new Promise((_, reject) => job.signal.addEventListener("abort", () => reject(new Error("aborted")))) },
			timeout: 5
		});
		await expect(run(polite, bash, { command: "sleep" })).rejects.toMatchObject({ code: "execution_time_exceeded" });
	});

	it("hands the caller's abort signal to the sandbox", async () => {
		const fake = sandbox();
		const controller = new AbortController();
		const executor = codeExecution({ sandbox: fake });
		await run(executor, bash, { command: "x" }, controller.signal);
		expect(fake.jobs[0].signal.aborted).toBe(false);
		controller.abort();
		expect(fake.jobs[0].signal.aborted).toBe(true);
	});

	it("reads a result as stdout, stderr and the exit code", () => {
		const { read } = codeExecution({ sandbox: sandbox() });
		expect(read({ stdout: "out", stderr: "err", return_code: 1 })).toBe("stdout:\nout\nstderr:\nerr\nexit code: 1");
		expect(read({ stdout: "", stderr: "", return_code: 0 })).toBe("exit code: 0");
		expect(read({})).toBe("exit code: 0");
		expect(read(undefined)).toBe("exit code: 0");
	});

	it("is exported from the package entry", () => {
		expect(exported).toBe(codeExecution);
	});
});

describe("the executor in the server tool runner", () => {
	const usage = (prompt, completion) => ({ prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion });
	const calling = (calls) => ({
		id: "chatcmpl-1",
		object: "chat.completion",
		created: 1,
		model: "qwen3-coder",
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: null,
					tool_calls: calls.map(([id, name, args]) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } }))
				},
				finish_reason: "tool_calls"
			}
		],
		usage: usage(10, 5)
	});
	const saying = (content) => ({
		id: "chatcmpl-2",
		object: "chat.completion",
		created: 1,
		model: "qwen3-coder",
		choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
		usage: usage(20, 7)
	});
	const base = { id: "chatcmpl-s", object: "chat.completion.chunk", created: 1, model: "qwen3-coder" };
	const streamed = (delta, finish, tokens) => [
		{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
		...delta.map((part) => ({ ...base, choices: [{ index: 0, delta: part, finish_reason: null }] })),
		{ ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }] },
		{ ...base, choices: [], usage: tokens },
		"[DONE]"
	];
	const sse = (list) => ({ status: 200, body: openaiSse(list), headers: { "content-type": "text/event-stream" } });
	const script = (replies) => {
		let turn = 0;
		const transport = fakeTransport(() => replies[turn++]);
		transport.bodies = () => transport.calls.map((call) => JSON.parse(call.init.body));
		return transport;
	};
	const json = (body) => ({ status: 200, body });

	it("runs a Python call and shows the model the readable output", async () => {
		const fake = sandbox(() => ({ stdout: "4\n" }));
		const transport = script([json(calling([["c1", "code_execution", { code: "print(2+2)" }]])), json(saying("four"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [codeExecution({ sandbox: fake })] });
		const reply = await api.send(ask(python));
		expect(reply.body.content.map((block) => block.type)).toEqual(["server_tool_use", "code_execution_tool_result", "text"]);
		expect(reply.body.content[0].input).toEqual({ code: "print(2+2)" });
		expect(reply.body.content[1].content).toEqual({
			type: "code_execution_result",
			stdout: "4\n",
			stderr: "",
			return_code: 0,
			content: []
		});
		expect(reply.body.usage.server_tool_use).toBeUndefined();
		const first = transport.bodies()[0].tools[0].function;
		expect(first.name).toBe("code_execution");
		expect(first.parameters.required).toEqual(["code"]);
		expect(transport.bodies()[1].messages.at(-1).content).toBe("stdout:\n4\n\nexit code: 0");
	});

	it("runs a bash call and answers with a bash_code_execution_tool_result", async () => {
		const fake = sandbox(() => ({ stdout: "file\n", stderr: "oops", return_code: 1 }));
		const transport = script([json(calling([["c1", "code_execution", { command: "ls" }]])), json(saying("done"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [codeExecution({ sandbox: fake })] });
		const reply = await api.send(ask(bash));
		expect(reply.body.content.map((block) => block.type)).toEqual(["server_tool_use", "bash_code_execution_tool_result", "text"]);
		expect(reply.body.content[1].content.type).toBe("bash_code_execution_result");
		expect(transport.bodies()[0].tools[0].function.parameters.required).toEqual(["command"]);
		expect(transport.bodies()[1].messages.at(-1).content).toBe("stdout:\nfile\n\nstderr:\noops\nexit code: 1");
	});

	it("streams the call and the result blocks", async () => {
		const fake = sandbox(() => ({ stdout: "hi" }));
		const transport = script([
			sse(
				streamed(
					[
						{
							tool_calls: [
								{ index: 0, id: "c1", type: "function", function: { name: "code_execution", arguments: '{"command":"echo hi"}' } }
							]
						}
					],
					"tool_calls",
					usage(10, 5)
				)
			),
			sse(streamed([{ content: "done" }], "stop", usage(20, 7)))
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [codeExecution({ sandbox: fake })] });
		const reply = await api.send({ ...ask(bash), stream: true });
		const events = await collect(reply.stream);
		const starts = events.filter((event) => event.event === "content_block_start").map((event) => event.data.content_block);
		expect(starts.map((block) => block.type)).toEqual(["server_tool_use", "bash_code_execution_tool_result", "text"]);
		expect(starts[1].content.stdout).toBe("hi");
		expect(fake.jobs[0]).toMatchObject({ kind: "bash", command: "echo hi" });
	});

	it("answers sandbox failures with the tool's error content type", async () => {
		const failing = { run: async () => Promise.reject(Object.assign(new Error("full"), { code: "container_expired" })) };
		for (const [tool, type] of [
			[python, "code_execution_tool_result_error"],
			[bash, "bash_code_execution_tool_result_error"]
		]) {
			const transport = script([json(calling([["c1", "code_execution", { code: "x", command: "x" }]])), json(saying("sorry"))]);
			const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [codeExecution({ sandbox: failing })] });
			const reply = await api.send(ask(tool));
			expect(reply.body.content[1].content).toEqual({ type, error_code: "container_expired" });
			expect(transport.bodies()[1].messages.at(-1).content).toBe(`[error] {"type":"${type}","error_code":"container_expired"}`);
		}
	});

	it("drops the tool when no executor is configured, so nothing runs", async () => {
		const transport = script([json(saying("no tools"))]);
		const api = await make({ upstreams: [chat], transport, detect: false });
		const reply = await api.send(ask(python));
		expect(reply.body.content.map((block) => block.type)).toEqual(["text"]);
		expect(transport.bodies()[0].tools).toBeUndefined();
	});

	it("shows the upstream a replayed result as text", async () => {
		const fake = sandbox();
		const transport = script([json(saying("ok"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [codeExecution({ sandbox: fake })] });
		await api.send({
			...ask(bash),
			messages: [
				{ role: "user", content: "run it" },
				{
					role: "assistant",
					content: [
						{ type: "server_tool_use", id: "srvtoolu_1", name: "code_execution", input: { command: "ls" } },
						{
							type: "bash_code_execution_tool_result",
							tool_use_id: "srvtoolu_1",
							content: { type: "bash_code_execution_result", stdout: "a\n", stderr: "", return_code: 0, content: [] }
						},
						{ type: "text", text: "listed" }
					]
				},
				{ role: "user", content: "again" }
			]
		});
		const sent = transport.bodies()[0].messages.map((message) => message.content ?? message.tool_calls);
		expect(sent).toContain("stdout:\na\n\nexit code: 0");
		expect(fake.jobs).toHaveLength(0);
	});
});
