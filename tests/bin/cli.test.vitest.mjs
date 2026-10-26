/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/bin/cli.test.vitest.mjs
 *	@Date: 2026-10-25T12:26:35-07:00 (1792956395)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:03-07:00 (1792958343)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { main, merge, parse, processIo } from "../../src/lib/cli.mjs";
import { fakeVllm } from "../helpers/fake-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scratch = path.join(root, "tmp", "agents", "agent-b", "cli-test");
const version = JSON.parse((await import("node:fs")).readFileSync(path.join(root, "package.json"), "utf8")).version;

beforeAll(() => mkdirSync(scratch, { recursive: true }));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

/**
 * Fake I/O collecting output; `signal()` fires the shutdown handler.
 * @returns {object} io bindings plus captured `lines`.
 */
function fakeIo() {
	const io = {
		lines: [],
		errors: [],
		handlers: [],
		out: (text) => io.lines.push(text),
		err: (text) => io.errors.push(text),
		onSignal: (handler) => io.handlers.push(handler),
		signal: () => io.handlers.forEach((handler) => handler())
	};
	return io;
}

describe("parse / merge", () => {
	it("parses flags", () => {
		expect(
			parse(["--front", "openai", "--upstream", "http://a", "--upstream", "http://b", "--silent", "--no-detect", "--port", "9"])
		).toMatchObject({
			front: "openai",
			upstream: ["http://a", "http://b"],
			silent: true,
			"no-detect": true,
			port: "9"
		});
		expect(() => parse(["--nope"])).toThrow();
		expect(() => parse(["positional"])).toThrow();
	});

	it("flags win over the environment, which wins over the file", () => {
		const file = {
			front: "anthropic",
			upstreams: [{ url: "http://file" }],
			aliases: { a: "b" },
			server: { host: "file-host", port: 1, apiKey: "file-key" }
		};
		const env = {
			LLM_TRANSLATOR_UPSTREAM: "http://env1,http://env2",
			LLM_TRANSLATOR_UPSTREAM_KEY: "env-up",
			LLM_TRANSLATOR_BACKEND: "vllm",
			LLM_TRANSLATOR_FRONT: "openai",
			LLM_TRANSLATOR_HOST: "env-host",
			LLM_TRANSLATOR_PORT: "2",
			LLM_TRANSLATOR_API_KEY: "env-key"
		};
		const fromEnv = merge({}, env, file);
		expect(fromEnv.translator).toMatchObject({
			front: "openai",
			upstreams: [
				{ url: "http://env1", apiKey: "env-up", backend: "vllm" },
				{ url: "http://env2", apiKey: "env-up", backend: "vllm" }
			],
			aliases: { a: "b" }
		});
		expect(fromEnv.server).toEqual({ host: "env-host", port: 2, apiKey: "env-key" });
		const fromFlags = merge(
			{
				front: "anthropic",
				upstream: ["http://flag"],
				"upstream-key": "flag-up",
				backend: "compatible",
				model: ["x=y", "c=d=e"],
				host: "flag-host",
				port: "3",
				"api-key": "flag-key",
				silent: true,
				"no-detect": true
			},
			env,
			file
		);
		expect(fromFlags.translator).toMatchObject({
			front: "anthropic",
			upstreams: [{ url: "http://flag", apiKey: "flag-up", backend: "compatible" }],
			aliases: { a: "b", x: "y", c: "d=e" },
			silent: true,
			detect: false
		});
		expect(fromFlags.server).toEqual({ host: "flag-host", port: 3, apiKey: "flag-key" });
	});

	it("keeps the file's settings when nothing overrides them", () => {
		const file = { upstreams: [{ url: "http://file" }], server: { port: 5 } };
		const merged = merge({}, {}, file);
		expect(merged.translator).toEqual({ upstreams: [{ url: "http://file" }] });
		expect(merged.server).toEqual({ port: 5 });
		expect(merge({ upstream: ["http://u"] }, {}, {}).translator.upstreams).toEqual([{ url: "http://u", apiKey: undefined }]);
		expect(merge({ model: ["a=b"] }, {}, {}).translator.aliases).toEqual({ a: "b" });
	});
});

describe("main", () => {
	it("prints help and the version", async () => {
		const io = fakeIo();
		expect(await main(["--help"], {}, io)).toBe(0);
		expect(io.lines[0]).toContain("Usage: llm-translator");
		const versioned = fakeIo();
		expect(await main(["--version"], {}, versioned)).toBe(0);
		expect(versioned.lines).toEqual([version]);
		const injected = fakeIo();
		expect(await main(["--version"], {}, injected, { version: "9.9.9" })).toBe(0);
		expect(injected.lines).toEqual(["9.9.9"]);
	});

	it("exits 2 with the help text for bad arguments", async () => {
		const io = fakeIo();
		expect(await main(["--bogus"], {}, io)).toBe(2);
		expect(io.errors[0]).toContain("Usage: llm-translator");
	});

	it("starts the server, waits for a signal and shuts down (collaborators injected)", async () => {
		const calls = [];
		const api = {
			server: {
				start: async (options) => (calls.push(["start", options]), { url: "http://127.0.0.1:1" }),
				stop: async () => calls.push(["stop"])
			},
			status: () => ({ front: "openai" }),
			slothlet: { shutdown: async () => calls.push(["shutdown"]) }
		};
		const io = fakeIo();
		const running = main(["--upstream", "http://u", "--front", "openai", "--port", "1234"], {}, io, {
			createTranslator: async (config) => (calls.push(["create", config]), api)
		});
		await vi.waitFor(() => expect(io.handlers).toHaveLength(1), { timeout: 30000 });
		expect(io.lines).toEqual(["llm-translator (openai front) listening on http://127.0.0.1:1"]);
		io.signal();
		expect(await running).toBe(0);
		expect(calls.map((call) => call[0])).toEqual(["create", "start", "stop", "shutdown"]);
		expect(calls[1][1]).toEqual({ port: 1234 });
	});

	it("prints one line per upstream with the detected driver, version and inline-system probe result", async () => {
		const api = {
			server: { start: async () => ({ url: "http://127.0.0.1:1" }), stop: async () => {} },
			status: () => ({
				front: "anthropic",
				upstreams: [
					{ name: "gpu", url: "http://gpu:8000", driver: "vllm", version: "0.32.0", probed: { inlineSystem: "user", images: false } },
					{ name: "other", url: "http://other:1", driver: "compatible" }
				]
			}),
			slothlet: { shutdown: async () => {} }
		};
		const io = fakeIo();
		const running = main(["--upstream", "http://u"], {}, io, { createTranslator: async () => api });
		await vi.waitFor(() => expect(io.handlers).toHaveLength(1), { timeout: 30000 });
		expect(io.lines).toEqual([
			"llm-translator (anthropic front) listening on http://127.0.0.1:1",
			"  upstream gpu http://gpu:8000: driver=vllm version=0.32.0 inlineSystem=user images=false",
			"  upstream other http://other:1: driver=compatible version=unknown inlineSystem=auto images=default"
		]);
		io.signal();
		expect(await running).toBe(0);
	});

	it("runs a real translator and server against a fake vLLM, reading the config file named by the environment", async () => {
		const upstream = await fakeVllm();
		const file = path.join(scratch, "config.json");
		writeFileSync(file, JSON.stringify({ upstreams: [{ url: upstream.url }], silent: true, server: { port: 0 } }));
		try {
			const io = fakeIo();
			const running = main([], { LLM_TRANSLATOR_CONFIG: file }, io);
			await vi.waitFor(() => expect(io.handlers).toHaveLength(1), { timeout: 30000 });
			const url = /listening on (\S+)/.exec(io.lines[0])[1];
			const reply = await fetch(`${url}/v1/messages`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ model: "qwen3-coder", max_tokens: 8, messages: [{ role: "user", content: "hi" }] })
			});
			expect((await reply.json()).content[0].text).toBe("Hello world");
			io.signal();
			expect(await running).toBe(0);
		} finally {
			await upstream.close();
		}
	});

	it("loads the config file named by --config", async () => {
		const file = path.join(scratch, "flag.json");
		writeFileSync(
			file,
			JSON.stringify({ upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false, silent: true, server: { port: 0 } })
		);
		const io = fakeIo();
		const running = main(["--config", file], {}, io);
		await vi.waitFor(() => expect(io.handlers).toHaveLength(1), { timeout: 30000 });
		io.signal();
		expect(await running).toBe(0);
	});

	it("exits 1 with a message for startup failures", async () => {
		const missing = fakeIo();
		expect(await main(["--port", "0"], {}, missing)).toBe(1);
		expect(missing.errors[0]).toMatch(/llm-translator: at least one upstream is required/);
		const unreadable = fakeIo();
		expect(await main(["--config", path.join(scratch, "absent.json")], {}, unreadable)).toBe(1);
		expect(unreadable.errors[0]).toMatch(/ENOENT/);
		const broken = path.join(scratch, "broken.json");
		writeFileSync(broken, "{nope");
		const invalid = fakeIo();
		expect(await main(["--config", broken], {}, invalid)).toBe(1);
	});
});

describe("process bindings", () => {
	it("writes lines to stdout/stderr and registers one-shot signal handlers", () => {
		const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		processIo.out("a");
		processIo.err("b");
		expect(out).toHaveBeenCalledWith("a\n");
		expect(err).toHaveBeenCalledWith("b\n");
		const once = vi.spyOn(process, "once").mockImplementation(() => process);
		const handler = () => {};
		processIo.onSignal(handler);
		expect(once.mock.calls).toEqual([
			["SIGINT", handler],
			["SIGTERM", handler]
		]);
	});

	it("the bin entry runs main with the process arguments", async () => {
		const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		const argv = process.argv;
		const code = process.exitCode;
		process.argv = [argv[0], "llm-translator", "--help"];
		try {
			await import("../../src/bin/llm-translator.mjs");
			expect(out.mock.calls[0][0]).toContain("Usage: llm-translator");
			expect(process.exitCode).toBe(0);
		} finally {
			process.argv = argv;
			process.exitCode = code;
		}
	});
});
