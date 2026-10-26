/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/cli.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:01-07:00 (1792958341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Command line front end: flags, environment variables and an optional JSON config file.
 * @module @cldmv/llm-translator/lib/cli
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const HELP = `llm-translator - run Claude Code (or any Anthropic/OpenAI client) against local LLM servers

Usage: llm-translator --upstream <url> [options]

Options:
  --front <anthropic|openai>   Client protocol to serve (default anthropic)
  --upstream <url>             Upstream server base URL (repeatable)
  --upstream-key <key>         API key sent to the upstream
  --backend <name>             Driver for the upstream (default auto-detect: vllm, compatible, openai, anthropic)
  --model <alias=target>       Model alias (repeatable)
  --host <host>                Listen address (default 127.0.0.1)
  --port <port>                Listen port (default 8787)
  --api-key <key>              Key clients must send (x-api-key or Authorization: Bearer)
  --allow-unauthenticated      Allow a non-loopback --host without --api-key
  --config <file>              JSON config file (translator config plus a "server" object)
  --silent                     Suppress warnings
  --no-detect                  Skip upstream detection
  --version                    Print the version
  --help                       Print this help

Environment: LLM_TRANSLATOR_FRONT, LLM_TRANSLATOR_UPSTREAM, LLM_TRANSLATOR_UPSTREAM_KEY, LLM_TRANSLATOR_BACKEND,
LLM_TRANSLATOR_HOST, LLM_TRANSLATOR_PORT, LLM_TRANSLATOR_API_KEY, LLM_TRANSLATOR_ALLOW_UNAUTHENTICATED (1), LLM_TRANSLATOR_CONFIG. Flags win over the
environment, which wins over the config file.
`;

/**
 * Parse the command line.
 * @param {string[]} argv - Arguments without the node and script paths.
 * @returns {any} Parsed values (see `parseArgs`).
 */
export function parse(argv) {
	return parseArgs({
		args: argv,
		allowPositionals: false,
		options: {
			front: { type: "string" },
			upstream: { type: "string", multiple: true },
			"upstream-key": { type: "string" },
			backend: { type: "string" },
			model: { type: "string", multiple: true },
			host: { type: "string" },
			port: { type: "string" },
			"api-key": { type: "string" },
			"allow-unauthenticated": { type: "boolean" },
			config: { type: "string" },
			silent: { type: "boolean" },
			"no-detect": { type: "boolean" },
			version: { type: "boolean" },
			help: { type: "boolean" }
		}
	}).values;
}

/**
 * Merge flags, environment and the config file into `{ translator, server }`.
 * @param {any} values - Parsed flags.
 * @param {Record<string,string | undefined>} env - Environment.
 * @param {any} file - Parsed config file ({} when none).
 * @returns {{translator: any, server: any}} Translator config and server options.
 */
export function merge(values, env, file) {
	const { server: fileServer, ...fileTranslator } = file;
	const urls = values.upstream ?? (env.LLM_TRANSLATOR_UPSTREAM ? env.LLM_TRANSLATOR_UPSTREAM.split(",") : undefined);
	const translator = { ...fileTranslator };
	if (urls) {
		const apiKey = values["upstream-key"] ?? env.LLM_TRANSLATOR_UPSTREAM_KEY;
		const backend = values.backend ?? env.LLM_TRANSLATOR_BACKEND;
		translator.upstreams = urls.map((url) => ({ url, apiKey, ...(backend ? { backend } : {}) }));
	}
	const front = values.front ?? env.LLM_TRANSLATOR_FRONT;
	if (front) translator.front = front;
	if (values.model) {
		translator.aliases = { ...translator.aliases };
		for (const pair of values.model) {
			const at = pair.indexOf("=");
			if (at < 1) throw new Error(`--model expects alias=target (got "${pair}")`);
			translator.aliases[pair.slice(0, at)] = pair.slice(at + 1);
		}
	}
	if (values.silent) translator.silent = true;
	if (values["no-detect"]) translator.detect = false;
	const port = values.port ?? env.LLM_TRANSLATOR_PORT;
	const server = {
		...fileServer,
		...((values.host ?? env.LLM_TRANSLATOR_HOST) ? { host: values.host ?? env.LLM_TRANSLATOR_HOST } : {}),
		...(port ? { port: Number(port) } : {}),
		...((values["api-key"] ?? env.LLM_TRANSLATOR_API_KEY) ? { apiKey: values["api-key"] ?? env.LLM_TRANSLATOR_API_KEY } : {}),
		...(values["allow-unauthenticated"] || env.LLM_TRANSLATOR_ALLOW_UNAUTHENTICATED === "1" ? { allowUnauthenticated: true } : {})
	};
	return { translator, server };
}

/**
 * Default I/O bindings for `main`.
 * @type {{out: (text: string) => void, err: (text: string) => void, onSignal: (handler: () => void) => void}}
 */
export const processIo = {
	out: (text) => process.stdout.write(`${text}\n`),
	err: (text) => process.stderr.write(`${text}\n`),
	onSignal: (handler) => {
		process.once("SIGINT", handler);
		process.once("SIGTERM", handler);
	}
};

/**
 * Run the CLI. Resolves with the exit code once the server stopped (after a signal) or startup failed.
 * @param {string[]} argv - Arguments without the node and script paths.
 * @param {Record<string,string | undefined>} [env] - Environment.
 * @param {typeof processIo} [io] - Output and signal bindings.
 * @param {any} [lib] - Overridable collaborators `{ createTranslator, version }` (loaded lazily when omitted).
 * @returns {Promise<number>} Process exit code.
 */
export async function main(argv, env = process.env, io = processIo, lib = {}) {
	let values;
	try {
		values = parse(argv);
	} catch (error) {
		io.err(`${error.message}\n\n${HELP}`);
		return 2;
	}
	if (values.help) {
		io.out(HELP);
		return 0;
	}
	if (values.version) {
		io.out(lib.version ?? (await import("../../package.json", { with: { type: "json" } })).default.version);
		return 0;
	}
	try {
		const file = values.config ?? env.LLM_TRANSLATOR_CONFIG;
		const { translator, server } = merge(values, env, file ? JSON.parse(await readFile(file, "utf8")) : {});
		const create = lib.createTranslator ?? (await import("../index.mjs")).createTranslator;
		const api = await create(translator);
		const running = await api.server.start(server);
		const report = api.status();
		io.out(`llm-translator (${report.front} front) listening on ${running.url}`);
		for (const upstream of report.upstreams ?? []) {
			const version = upstream.version ?? "unknown";
			const inline = upstream.probed?.inlineSystem ?? "auto";
			io.out(`  upstream ${upstream.name} ${upstream.url}: driver=${upstream.driver} version=${version} inlineSystem=${inline}`);
		}
		await /** @type {Promise<void>} */ (new Promise((resolve) => io.onSignal(() => resolve())));
		await api.server.stop();
		await api.slothlet.shutdown();
		return 0;
	} catch (error) {
		io.err(`llm-translator: ${error.message}`);
		return 1;
	}
}
