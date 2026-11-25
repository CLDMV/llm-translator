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
import { create } from "../../src/lib/filestore.mjs";
import { normalize } from "../../src/lib/servertools.mjs";

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

const run = (executor, tool, input, extra = {}) =>
	executor.run(input, { tool, name: tool === python ? "code_execution" : "bash_code_execution", ...extra });

/** A sandbox with file ops over an in-memory map of path to text. */
function editor(initial = {}) {
	const files = new Map(Object.entries(initial));
	const calls = [];
	return {
		contents: files,
		calls,
		run: async () => ({}),
		files: {
			read: async (path, context) => {
				calls.push(["read", path, context.container]);
				if (!files.has(path)) throw Object.assign(new Error(`no ${path}`), { code: "file_not_found" });
				return files.get(path);
			},
			write: async (path, text, context) => {
				calls.push(["write", path, context.container]);
				const updated = files.has(path);
				files.set(path, text);
				return { updated, container: { id: "ctr_edit" } };
			}
		}
	};
}

describe("codeExecution executor", () => {
	it("offers the Python function for 20250522 and bash plus the editor members for later versions", () => {
		const executor = codeExecution({ sandbox: editor() });
		expect(executor.type.test("code_execution_20250825")).toBe(true);
		expect(executor.schema(python)).toEqual({
			type: "object",
			properties: { code: { type: "string", description: "The Python code to run." } },
			required: ["code"]
		});
		expect(executor.description).toMatch(/Python/);
		expect(executor.members(python)).toEqual([]);
		const members = executor.members(bash);
		expect(members.map((member) => [member.name, member.result])).toEqual([
			["bash_code_execution", "bash_code_execution_tool_result"],
			["text_editor_code_execution", "text_editor_code_execution_tool_result"]
		]);
		expect(members[0].schema.required).toEqual(["command"]);
		expect(members[1].schema.required).toEqual(["command", "path"]);
	});

	it("offers no text editor without file operations", () => {
		const executor = codeExecution({ sandbox: sandbox() });
		expect(executor.members(bash).map((member) => member.name)).toEqual(["bash_code_execution"]);
	});

	it("rejects an unusable configuration", () => {
		expect(() => codeExecution()).toThrow(TranslatorError);
		expect(() => codeExecution({})).toThrow(/sandbox must have a run function/);
		expect(() => codeExecution({ sandbox: {} })).toThrow(/sandbox/);
		expect(() => codeExecution({ sandbox: { ...sandbox(), files: { read() {} } } })).toThrow(/files must have read and write/);
		expect(() => codeExecution({ sandbox: { ...sandbox(), files: null } })).toThrow(/files must have read and write/);
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
		await run(executor, bash, { command: "x" }, { signal: controller.signal });
		expect(fake.jobs[0].signal.aborted).toBe(false);
		controller.abort();
		expect(fake.jobs[0].signal.aborted).toBe(true);
	});

	it("passes the container to the sandbox and reports the one it ran in", async () => {
		const seen = [];
		const executor = codeExecution({
			sandbox: {
				run: async (job) => {
					seen.push(job.container);
					return { container: seen.length === 1 ? { id: "ctr_1", expires_at: "2026-01-01T00:00:00Z" } : "ctr_2" };
				}
			}
		});
		const first = await run(executor, bash, { command: "x" }, { container: "ctr_0" });
		expect(first.container).toEqual({ id: "ctr_1", expires_at: "2026-01-01T00:00:00Z" });
		expect((await run(executor, bash, { command: "x" })).container).toEqual({ id: "ctr_2" });
		expect(seen).toEqual(["ctr_0", undefined]);
		const none = codeExecution({ sandbox: sandbox(() => ({ container: { id: "" } })) });
		expect(await run(none, bash, { command: "x" })).not.toHaveProperty("container");
	});

	it("stores produced files and lists them in content", async () => {
		const files = create({ store: "memory", dir: null, maxFileSize: 10, maxTotalBytes: 1000, maxCount: 10, ttl: 0 });
		const produced = [{ name: "a.csv", data: "x,y", media_type: "text/csv" }, { bytes: new Uint8Array([1, 2]) }, { name: "", data: "z" }];
		const executor = codeExecution({ sandbox: sandbox(() => ({ files: produced })) });
		const out = await run(executor, bash, { command: "x" }, { files });
		expect(out.content.content.map((entry) => entry.type)).toEqual(Array(3).fill("bash_code_execution_output"));
		const stored = await Promise.all(out.content.content.map((entry) => files.get(entry.file_id)));
		expect(stored.map((file) => [file.meta.filename, file.meta.mime_type, file.data.length])).toEqual([
			["a.csv", "text/csv", 3],
			["output", "application/octet-stream", 2],
			["output", "application/octet-stream", 1]
		]);
		const python_ = await run(executor, python, { code: "x" }, { files });
		expect(python_.content.content[0].type).toBe("code_execution_output");
		expect(executor.read(out.content)).toMatch(/^files: file_[0-9a-f]+, file_[0-9a-f]+, file_[0-9a-f]+\nexit code: 0$/);
	});

	it("leaves content empty without a file store or produced files", async () => {
		const executor = codeExecution({ sandbox: sandbox(() => ({ files: [{ name: "a", data: "x" }] })) });
		expect((await run(executor, bash, { command: "x" }, { files: null })).content.content).toEqual([]);
		const files = create({ store: "memory", dir: null, maxFileSize: 10, maxTotalBytes: 1000, maxCount: 10, ttl: 0 });
		expect((await run(codeExecution({ sandbox: sandbox() }), bash, { command: "x" }, { files })).content.content).toEqual([]);
	});

	it("answers a produced file the store refuses", async () => {
		const small = create({ store: "memory", dir: null, maxFileSize: 2, maxTotalBytes: 1000, maxCount: 1, ttl: 0 });
		const make_ = (list) => codeExecution({ sandbox: sandbox(() => ({ files: list })) });
		await expect(run(make_([{ data: "toolong" }]), bash, { command: "x" }, { files: small })).rejects.toMatchObject({
			code: "output_file_too_large"
		});
		await run(make_([{ data: "a" }]), bash, { command: "x" }, { files: small });
		await expect(run(make_([{ data: "b" }]), bash, { command: "x" }, { files: small })).rejects.toMatchObject({ code: "unavailable" });
		await expect(run(make_([{ name: "n" }]), bash, { command: "x" }, { files: small })).rejects.toMatchObject({ code: "unavailable" });
		const broken = { put: async () => Promise.reject("plain") };
		await expect(run(make_([{ data: "a" }]), bash, { command: "x" }, { files: broken })).rejects.toMatchObject({ message: "plain" });
	});

	it("views, creates and edits files through the sandbox's file operations", async () => {
		const fake = editor({ "/a.txt": "one\ntwo\nthree\n" });
		const executor = codeExecution({ sandbox: fake, maxOutput: 100 });
		const edit = (input, extra = {}) => executor.run(input, { tool: bash, name: "text_editor_code_execution", ...extra });
		expect((await edit({ command: "view", path: "/a.txt" })).content).toEqual({
			type: "text_editor_code_execution_view_result",
			content: "one\ntwo\nthree\n",
			file_type: "text",
			num_lines: 3,
			start_line: 1,
			total_lines: 3
		});
		const created = await edit({ command: "create", path: "/b.txt", file_text: "hi" }, { container: "ctr_9" });
		expect(created.content).toEqual({ type: "text_editor_code_execution_create_result", is_file_update: false });
		expect(created.container).toEqual({ id: "ctr_edit" });
		expect((await edit({ command: "create", path: "/b.txt", file_text: "hello" })).content.is_file_update).toBe(true);
		expect(fake.contents.get("/b.txt")).toBe("hello");
		const replaced = await edit({ command: "str_replace", path: "/a.txt", old_str: "two", new_str: "2\n2b" });
		expect(replaced.content).toEqual({
			type: "text_editor_code_execution_str_replace_result",
			lines: ["-two", "+2", "+2b"],
			new_lines: 2,
			new_start: 2,
			old_lines: 1,
			old_start: 2
		});
		expect(fake.contents.get("/a.txt")).toBe("one\n2\n2b\nthree\n");
		expect(fake.calls).toContainEqual(["write", "/b.txt", "ctr_9"]);
		fake.contents.set("/empty", "");
		expect((await edit({ command: "view", path: "/empty" })).content).toMatchObject({ content: "", num_lines: 0, total_lines: 0 });
		fake.contents.set("/long", "x".repeat(150));
		expect((await edit({ command: "view", path: "/long" })).content.content).toMatch(/\[truncated 50 characters\]$/);
	});

	it("answers text editor errors with Anthropic's codes", async () => {
		const fake = editor({ "/a": "x x" });
		const executor = codeExecution({ sandbox: fake });
		const edit = (input) => executor.run(input, { tool: bash, name: "text_editor_code_execution" }).catch((error) => error.code);
		expect(await edit({ command: "view", path: "/missing" })).toBe("file_not_found");
		expect(await edit({ command: "view" })).toBe("invalid_tool_input");
		expect(await edit({ command: "view", path: "" })).toBe("invalid_tool_input");
		expect(await edit({ command: "delete", path: "/a" })).toBe("invalid_tool_input");
		expect(await edit(undefined)).toBe("invalid_tool_input");
		expect(await edit({ command: "create", path: "/a" })).toBe("invalid_tool_input");
		expect(await edit({ command: "str_replace", path: "/a", old_str: "", new_str: "y" })).toBe("invalid_tool_input");
		expect(await edit({ command: "str_replace", path: "/a", old_str: "x" })).toBe("invalid_tool_input");
		expect(await edit({ command: "str_replace", path: "/a", old_str: "q", new_str: "y" })).toBe("invalid_tool_input");
		expect(await edit({ command: "str_replace", path: "/a", old_str: "x", new_str: "y" })).toBe("invalid_tool_input");
		expect(await edit({ command: "str_replace", path: "/missing", old_str: "x", new_str: "y" })).toBe("file_not_found");
		const odd = codeExecution({ sandbox: { run: async () => ({}), files: { read: async () => 5, write: async () => undefined } } });
		await expect(odd.run({ command: "view", path: "/a" }, { tool: bash, name: "text_editor_code_execution" })).rejects.toMatchObject({
			code: "unavailable"
		});
		const quiet = codeExecution({ sandbox: { run: async () => ({}), files: { read: async () => "a", write: async () => undefined } } });
		const out = await quiet.run({ command: "create", path: "/a", file_text: "" }, { tool: bash, name: "text_editor_code_execution" });
		expect(out).toEqual({ content: { type: "text_editor_code_execution_create_result", is_file_update: false } });
	});

	it("bounds the file operations by the time limit too", async () => {
		const executor = codeExecution({
			sandbox: { run: async () => ({}), files: { read: () => new Promise(() => {}), write: async () => ({}) } },
			timeout: 5
		});
		await expect(executor.run({ command: "view", path: "/a" }, { tool: bash, name: "text_editor_code_execution" })).rejects.toMatchObject({
			code: "execution_time_exceeded"
		});
	});

	it("rejects an executor members option that is not a function", () => {
		expect(() => normalize([{ type: "x", schema() {}, run() {}, members: [] }])).toThrow(/members must be a function/);
	});

	it("reads text editor results for the model", () => {
		const { read } = codeExecution({ sandbox: sandbox() });
		expect(read({ type: "text_editor_code_execution_view_result", content: "abc" })).toBe("abc");
		expect(read({ type: "text_editor_code_execution_view_result" })).toBe("");
		expect(read({ type: "text_editor_code_execution_create_result", is_file_update: false })).toBe("File created.");
		expect(read({ type: "text_editor_code_execution_create_result", is_file_update: true })).toBe("File updated.");
		expect(read({ type: "text_editor_code_execution_str_replace_result", lines: ["-a", "+b"] })).toBe("Replaced.\n-a\n+b");
		expect(read({ type: "text_editor_code_execution_str_replace_result" })).toBe("Replaced.");
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
		const transport = script([json(calling([["c1", "bash_code_execution", { command: "ls" }]])), json(saying("done"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [codeExecution({ sandbox: fake })] });
		const reply = await api.send(ask(bash));
		expect(reply.body.content.map((block) => block.type)).toEqual(["server_tool_use", "bash_code_execution_tool_result", "text"]);
		expect(reply.body.content[1].content.type).toBe("bash_code_execution_result");
		expect(reply.body.content[0].name).toBe("bash_code_execution");
		expect(transport.bodies()[0].tools.map((tool) => tool.function.name)).toEqual(["bash_code_execution"]);
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
								{ index: 0, id: "c1", type: "function", function: { name: "bash_code_execution", arguments: '{"command":"echo hi"}' } }
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
			const transport = script([
				json(calling([["c1", tool === python ? "code_execution" : "bash_code_execution", { code: "x", command: "x" }]])),
				json(saying("sorry"))
			]);
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
						{ type: "server_tool_use", id: "srvtoolu_1", name: "bash_code_execution", input: { command: "ls" } },
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
	it("offers bash and the text editor as two functions and runs an editor call", async () => {
		const fake = editor({ "/a.txt": "hello\n" });
		const transport = script([
			json(calling([["c1", "text_editor_code_execution", { command: "view", path: "/a.txt" }]])),
			json(calling([["c2", "text_editor_code_execution", { command: "create", path: "/b", file_text: "x" }]])),
			json(saying("done"))
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [codeExecution({ sandbox: fake })] });
		const reply = await api.send({ ...ask(bash), container: { id: "ctr_in" } });
		expect(transport.bodies()[0].tools.map((tool) => tool.function.name)).toEqual(["bash_code_execution", "text_editor_code_execution"]);
		expect(reply.body.content.map((block) => block.type)).toEqual([
			"server_tool_use",
			"text_editor_code_execution_tool_result",
			"server_tool_use",
			"text_editor_code_execution_tool_result",
			"text"
		]);
		expect(reply.body.content[0].name).toBe("text_editor_code_execution");
		expect(reply.body.content[1].content.type).toBe("text_editor_code_execution_view_result");
		expect(transport.bodies()[1].messages.at(-1).content).toBe("hello\n");
		expect(fake.calls).toEqual([
			["read", "/a.txt", "ctr_in"],
			["write", "/b", "ctr_in"]
		]);
		expect(reply.body.container).toEqual({ id: "ctr_edit" });
	});

	it("answers an editor error with the editor's error content type", async () => {
		const transport = script([
			json(calling([["c1", "text_editor_code_execution", { command: "view", path: "/no" }]])),
			json(saying("sorry"))
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [codeExecution({ sandbox: editor() })] });
		const reply = await api.send(ask(bash));
		expect(reply.body.content[1].content).toEqual({ type: "text_editor_code_execution_tool_result_error", error_code: "file_not_found" });
	});

	it("passes the request's container on, returns the container the run used, and carries it between rounds", async () => {
		const seen = [];
		const fake = sandbox((job) => {
			seen.push(job.container);
			return { container: { id: "ctr_new", expires_at: "2026-01-01T00:00:00Z" } };
		});
		const transport = script([
			json(calling([["c1", "bash_code_execution", { command: "a" }]])),
			json(calling([["c2", "bash_code_execution", { command: "b" }]])),
			json(saying("done"))
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [codeExecution({ sandbox: fake })] });
		const reply = await api.send({ ...ask(bash), container: "ctr_old" });
		expect(seen).toEqual(["ctr_old", "ctr_new"]);
		expect(reply.body.container).toEqual({ id: "ctr_new", expires_at: "2026-01-01T00:00:00Z" });
		const bare = await make({
			upstreams: [chat],
			transport: script([json(saying("x"))]),
			detect: false,
			serverTools: [codeExecution({ sandbox: fake })]
		});
		expect((await bare.send(ask(bash))).body).not.toHaveProperty("container");
	});

	it("streams the container on message_delta", async () => {
		const fake = sandbox(() => ({ container: { id: "ctr_s" } }));
		const call = [
			{ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "bash_code_execution", arguments: '{"command":"a"}' } }] }
		];
		const transport = script([sse(streamed(call, "tool_calls", usage(1, 1))), sse(streamed([{ content: "done" }], "stop", usage(1, 1)))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [codeExecution({ sandbox: fake })] });
		const events = await collect((await api.send({ ...ask(bash), stream: true })).stream);
		expect(events.find((event) => event.event === "message_delta").data.delta.container).toEqual({ id: "ctr_s" });
	});

	it("does not offer the editor without file operations", async () => {
		const transport = script([json(saying("ok"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [codeExecution({ sandbox: sandbox() })] });
		await api.send(ask(bash));
		expect(transport.bodies()[0].tools.map((tool) => tool.function.name)).toEqual(["bash_code_execution"]);
	});

	it("stores produced files in the Files API store and lists them", async () => {
		const fake = sandbox(() => ({ files: [{ name: "plot.png", bytes: new Uint8Array([1, 2, 3]), media_type: "image/png" }] }));
		const transport = script([json(calling([["c1", "code_execution", { code: "x" }]])), json(saying("done"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [codeExecution({ sandbox: fake })] });
		const reply = await api.send(ask(python));
		const [entry] = reply.body.content[1].content.content;
		expect(entry).toEqual({ type: "code_execution_output", file_id: expect.stringMatching(/^file_[0-9a-f]{24}$/) });
		expect(transport.bodies()[1].messages.at(-1).content).toBe(`files: ${entry.file_id}\nexit code: 0`);
		expect(await api.files.get(entry.file_id)).toMatchObject({ filename: "plot.png", mime_type: "image/png", downloadable: true });
		expect((await api.files.content(entry.file_id)).data).toEqual(Buffer.from([1, 2, 3]));
	});

	it("leaves content empty when the Files API is off", async () => {
		const fake = sandbox(() => ({ files: [{ name: "a", data: "x" }] }));
		const transport = script([json(calling([["c1", "code_execution", { code: "x" }]])), json(saying("done"))]);
		const api = await make({
			upstreams: [chat],
			transport,
			detect: false,
			settings: { files: null },
			serverTools: [codeExecution({ sandbox: fake })]
		});
		expect((await api.send(ask(python))).body.content[1].content.content).toEqual([]);
	});

	it("maps a replayed text editor result back to its function call", async () => {
		const transport = script([json(saying("ok"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [codeExecution({ sandbox: editor() })] });
		await api.send({
			...ask(bash),
			messages: [
				{ role: "user", content: "edit" },
				{
					role: "assistant",
					content: [
						{ type: "server_tool_use", id: "srvtoolu_2", name: "text_editor_code_execution", input: { command: "view", path: "/a" } },
						{
							type: "text_editor_code_execution_tool_result",
							tool_use_id: "srvtoolu_2",
							content: { type: "text_editor_code_execution_view_result", content: "body" }
						}
					]
				},
				{ role: "user", content: "again" }
			]
		});
		const sent = transport.bodies()[0].messages.map((message) => message.content ?? message.tool_calls);
		expect(sent).toContain("body");
	});
});
