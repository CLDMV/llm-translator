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
  --backend <name>             Driver for the upstream (default auto-detect: vllm, llamacpp, compatible, openai, anthropic)
  --model <alias=target>       Model alias (repeatable)
  --host <host>                Listen address (default 127.0.0.1)
  --port <port>                Listen port (default 8787)
  --api-key <key>              Key clients must send (x-api-key or Authorization: Bearer)
  --allow-unauthenticated      Allow a non-loopback --host without --api-key
  --metrics                    Serve Prometheus metrics at GET /metrics (same authentication as the other routes)
  --tls-key <file>             TLS private key (PEM); with --tls-cert the server speaks HTTPS
  --tls-cert <file>            TLS certificate (PEM)
  --tls-ca <file>              Extra CA certificate (PEM)
  --tls-passphrase <text>      Passphrase of the TLS key
  --cors-origin <origin>       Origin browsers may call from (repeatable, * for any); CORS is off without it
  --rate-limit <n>             Allow n requests per window for each API key (remote address without one); off without it
  --rate-limit-window <ms>     Rate limit window (default 60000)
  --config <file>              JSON config file (translator config plus a "server" object)
  --logs [path]                Log warnings and errors to the console (default), or append every event as a JSON line to <path>
  --silent                     Same as logs: false (no console output, no file)
  --no-detect                  Skip upstream detection
  --version                    Print the version
  --help                       Print this help

Environment: LLM_TRANSLATOR_FRONT, LLM_TRANSLATOR_UPSTREAM, LLM_TRANSLATOR_UPSTREAM_KEY, LLM_TRANSLATOR_BACKEND,
LLM_TRANSLATOR_HOST, LLM_TRANSLATOR_PORT, LLM_TRANSLATOR_API_KEY, LLM_TRANSLATOR_ALLOW_UNAUTHENTICATED (1), LLM_TRANSLATOR_METRICS (1), LLM_TRANSLATOR_CONFIG,
LLM_TRANSLATOR_TLS_KEY, LLM_TRANSLATOR_TLS_CERT, LLM_TRANSLATOR_TLS_CA, LLM_TRANSLATOR_TLS_PASSPHRASE, LLM_TRANSLATOR_CORS_ORIGINS (comma separated),
LLM_TRANSLATOR_RATE_LIMIT, LLM_TRANSLATOR_RATE_LIMIT_WINDOW. Flags win over the environment, which wins over the config file.
`;

/**
 * Parse the command line.
 * @param {string[]} argv - Arguments without the node and script paths.
 * @returns {any} Parsed values (see `parseArgs`).
 */
export function parse(argv) {
	// `--logs` takes an optional path: bare (last, or followed by another flag) it means the console, which parseArgs sees as an empty value.
	const args = argv.map((arg, at) => (arg === "--logs" && (at === argv.length - 1 || argv[at + 1].startsWith("-")) ? "--logs=" : arg));
	return parseArgs({
		args,
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
			metrics: { type: "boolean" },
			"tls-key": { type: "string" },
			"tls-cert": { type: "string" },
			"tls-ca": { type: "string" },
			"tls-passphrase": { type: "string" },
			"cors-origin": { type: "string", multiple: true },
			"rate-limit": { type: "string" },
			"rate-limit-window": { type: "string" },
			config: { type: "string" },
			logs: { type: "string" },
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
	// The CLI logs to the console by default, so a server user still sees warnings; `--logs` / `--silent` and a config file's `logs` / `silent` change that.
	if (values.silent) translator.logs = false;
	if (values.logs !== undefined) translator.logs = values.logs === "" ? true : values.logs;
	translator.logs ??= translator.silent === true ? false : true;
	delete translator.silent;
	if (values["no-detect"]) translator.detect = false;
	const port = values.port ?? env.LLM_TRANSLATOR_PORT;
	const server = {
		...fileServer,
		...((values.host ?? env.LLM_TRANSLATOR_HOST) ? { host: values.host ?? env.LLM_TRANSLATOR_HOST } : {}),
		...(port ? { port: Number(port) } : {}),
		...((values["api-key"] ?? env.LLM_TRANSLATOR_API_KEY) ? { apiKey: values["api-key"] ?? env.LLM_TRANSLATOR_API_KEY } : {}),
		...(values["allow-unauthenticated"] || env.LLM_TRANSLATOR_ALLOW_UNAUTHENTICATED === "1" ? { allowUnauthenticated: true } : {}),
		...(values.metrics || env.LLM_TRANSLATOR_METRICS === "1" ? { metrics: true } : {})
	};
	// TLS, CORS and the rate limit: a flag or variable overrides the same key of the file's object, and the rest of the file's object stays.
	const tls = {
		...fileServer?.tls,
		...pick({ key: values["tls-key"] ?? env.LLM_TRANSLATOR_TLS_KEY, cert: values["tls-cert"] ?? env.LLM_TRANSLATOR_TLS_CERT }),
		...pick({
			ca: values["tls-ca"] ?? env.LLM_TRANSLATOR_TLS_CA,
			passphrase: values["tls-passphrase"] ?? env.LLM_TRANSLATOR_TLS_PASSPHRASE
		})
	};
	if (Object.keys(tls).length > 0) server.tls = tls;
	const origins = values["cors-origin"] ?? (env.LLM_TRANSLATOR_CORS_ORIGINS ? env.LLM_TRANSLATOR_CORS_ORIGINS.split(",") : undefined);
	if (origins) server.cors = origins.map((origin) => origin.trim()).filter(Boolean);
	const requests = values["rate-limit"] ?? env.LLM_TRANSLATOR_RATE_LIMIT;
	const windowMs = values["rate-limit-window"] ?? env.LLM_TRANSLATOR_RATE_LIMIT_WINDOW;
	if (requests || windowMs) {
		server.rateLimit = {
			...fileServer?.rateLimit,
			...(requests ? { requests: Number(requests) } : {}),
			...(windowMs ? { windowMs: Number(windowMs) } : {})
		};
	}
	return { translator, server };
}

/**
 * Drop the keys whose value is undefined or empty.
 * @param {Record<string, string | undefined>} entries - Candidate entries.
 * @returns {Record<string, string>} Entries that have a value.
 */
function pick(entries) {
	return Object.fromEntries(Object.entries(entries).filter(([, value]) => value));
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
			const images = upstream.probed?.images ?? "default";
			io.out(
				`  upstream ${upstream.name} ${upstream.url}: driver=${upstream.driver} version=${version} inlineSystem=${inline} images=${images}`
			);
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
