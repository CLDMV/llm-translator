/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/events.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:02-07:00 (1792958342)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Events and logging: one emit path that feeds listeners, the console, a JSON lines file and the server's logger.
 * @module @cldmv/llm-translator/lib/events
 */
import { closeSync, mkdirSync, openSync, appendFileSync } from "node:fs";
import path from "node:path";

/**
 * @typedef {object} TranslatorEvent
 * @property {string} type Specific event name (`fallback`, `failover`, `health`, `effort`, `dropped`, `detect`, `usage`, `warning`, `error` or `log`).
 * @property {string} [kind] Sub-kind within the type (for example `json_object` for a `fallback`).
 * @property {"debug" | "info" | "warn" | "error"} level Severity.
 * @property {string} message Human readable text.
 * @property {number} time Milliseconds since the epoch.
 */

/**
 * The state the emitter keeps in `state`: listeners by event name, the log sink, and the server's logger once one is registered.
 * @param {((event: TranslatorEvent) => any) | undefined} [onEvent] - Config callback, registered for every event.
 * @returns {{listeners: Map<string, Set<Function>>, sink: {console: boolean, file: string | null}, logger: any}} Emitter state.
 */
export function create(onEvent) {
	const listeners = new Map();
	if (typeof onEvent === "function") listeners.set("*", new Set([onEvent]));
	return { listeners, sink: { console: false, file: null }, logger: null };
}

/**
 * Configure where logging goes: nothing, the console, or a JSON lines file. A file that cannot be opened is reported once on
 * the console and logging stays off; this never throws.
 * @param {any} emitter - Emitter state from {@link create}.
 * @param {boolean | string} logs - Normalized `logs` option.
 * @returns {void}
 */
export function open(emitter, logs) {
	emitter.sink.console = logs === true;
	emitter.sink.file = null;
	if (typeof logs !== "string") return;
	const file = path.resolve(logs);
	try {
		mkdirSync(path.dirname(file), { recursive: true });
		closeSync(openSync(file, "a"));
		emitter.sink.file = file;
	} catch (cause) {
		console.warn(`[llm-translator] could not open the log file ${file} (${cause.message}); logging is off`);
	}
}

/**
 * Subscribe to an event.
 * @param {any} emitter - Emitter state.
 * @param {string} name - Event name, or `"*"` for every event.
 * @param {(event: TranslatorEvent) => any} fn - Listener.
 * @returns {() => void} Unsubscribe function.
 */
export function on(emitter, name, fn) {
	if (typeof name !== "string" || typeof fn !== "function") throw new TypeError("events.on needs an event name and a function");
	if (!emitter.listeners.has(name)) emitter.listeners.set(name, new Set());
	emitter.listeners.get(name).add(fn);
	return () => off(emitter, name, fn);
}

/**
 * Remove a listener (a listener that is not subscribed is ignored).
 * @param {any} emitter - Emitter state.
 * @param {string} name - Event name.
 * @param {Function} fn - Listener passed to {@link on}.
 * @returns {void}
 */
export function off(emitter, name, fn) {
	emitter.listeners.get(name)?.delete(fn);
}

/**
 * Write one event to the log sinks: the server's logger, the console (warnings and errors, once per message) and the file (every event).
 * @param {any} state - Translator state.
 * @param {any} event - Event payload.
 * @param {any} [log] - Logger of the request (Fastify), `false` to skip the server logger, else the app logger when one is registered.
 * @returns {void}
 */
function write(state, event, log) {
	const { sink } = state.events;
	const logger = log === false ? null : (log ?? state.events.logger);
	logger?.[event.level]?.({ event }, event.message);
	if (sink.console && (event.level === "warn" || event.level === "error") && !state.warned.has(event.message)) {
		state.warned.add(event.message);
		console[event.level === "error" ? "error" : "warn"](`[llm-translator] ${event.message}`);
	}
	if (sink.file === null) return;
	try {
		appendFileSync(sink.file, `${JSON.stringify(event)}\n`);
	} catch (cause) {
		const file = sink.file;
		sink.file = null;
		// A failing disk does not stop requests: one console notice, and file logging is off from here on.
		console.warn(`[llm-translator] could not write the log file ${file} (${cause.message}); file logging is off`);
	}
}

/**
 * Report a listener that threw or rejected, through logging only (never as an event, so it cannot loop), once per message.
 * @param {any} state - Translator state.
 * @param {string} name - Event the listener was subscribed to.
 * @param {any} cause - What it threw.
 * @returns {void}
 */
function failed(state, name, cause) {
	const message = `Event listener for "${name}" failed: ${cause?.message ?? cause}`;
	const key = `listener\n${message}`;
	if (state.warned.has(key)) return;
	state.warned.add(key);
	write(state, { type: "listener", level: "warn", message, time: Date.now(), event: name }, false);
}

/**
 * Call one listener; an exception or a rejection is contained.
 * @param {any} state - Translator state.
 * @param {string} name - Event name the listener was subscribed to.
 * @param {Function} fn - Listener.
 * @param {any} event - Payload.
 * @returns {void}
 */
function call(state, name, fn, event) {
	try {
		const result = fn(event);
		if (typeof result?.then === "function") result.then(undefined, (cause) => failed(state, name, cause));
	} catch (cause) {
		failed(state, name, cause);
	}
}

/**
 * Emit one occurrence. The specific event fires first, then the general ones that fit (`warning` for level `warn`, `error` for level
 * `error`, always `log`), then `"*"`; all with the same payload. Listeners only observe. Logging is fed from here too, and does not
 * depend on `events`.
 * @param {{config: any, state: any}} ctx - Translator `{ config, state }`.
 * @param {{type: string, kind?: string, level?: "debug" | "info" | "warn" | "error", message: string, log?: any, [detail: string]: any}} spec - What happened: `type`, optional `kind`, `level` (default `info`), `message`, further details, and `log` (see {@link write}; not part of the payload).
 * @returns {TranslatorEvent} The payload.
 */
export function emit({ config, state }, spec) {
	const { type, kind, level = "info", message, log, ...details } = spec;
	const event = { type, ...(kind === undefined ? {} : { kind }), level, message, time: Date.now(), ...details };
	if (config.events !== false) {
		const names = new Set([type]);
		if (level === "warn") names.add("warning");
		if (level === "error") names.add("error");
		names.add("log");
		names.add("*");
		for (const name of names) {
			for (const fn of [...(state.events.listeners.get(name) ?? [])]) call(state, name, fn, event);
		}
	}
	write(state, event, log);
	return event;
}
