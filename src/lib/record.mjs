/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/record.mjs
 *	@Date: 2026-11-06T12:00:00-08:00 (1793995200)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-06T12:00:00-08:00 (1793995200)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Request and response capture (the `capture` option): one redacted record per exchange, written as a JSON file in a
 * directory or handed to a callback. Never affects the reply: a failing sink is reported once as a warning.
 * @module @cldmv/llm-translator/lib/record
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { items } from "./source.mjs";
import { warn } from "./warn.mjs";

/** Most characters of a stream kept per exchange, for the raw upstream text and for the client events each. */
export const STREAM_LIMIT = 1_000_000;

const SECRET = /key|token|secret|auth|cookie|password/i;

/**
 * Copy a header map with the value of every credential header replaced. A header is a credential when its name contains `key`,
 * `token`, `secret`, `auth`, `cookie` or `password` (this covers `authorization`, `proxy-authorization`, `x-api-key`, `api-key`).
 * @param {Record<string, any> | undefined} headers - Header map.
 * @returns {Record<string, any>} Copy with lowercase names.
 */
export function redact(headers) {
	/** @type {Record<string, any>} */
	const out = {};
	for (const [name, value] of Object.entries(headers ?? {})) out[name.toLowerCase()] = SECRET.test(name) ? "[redacted]" : value;
	return out;
}

/**
 * Validate the `capture` option.
 * @param {any} value - Raw option.
 * @returns {boolean} True when the value is `false`/`undefined`, a non-empty directory path or a function.
 */
export function valid(value) {
	return value === undefined || value === false || typeof value === "function" || (typeof value === "string" && value !== "");
}

const OFF = {
	/**
	 * Capture is off: the stream is returned as it is.
	 * @param {any} source - Stream.
	 * @returns {any} The same stream.
	 */
	raw: (source) => source,
	/**
	 * Capture is off: the stream is returned as it is.
	 * @param {any} source - Stream.
	 * @returns {any} The same stream.
	 */
	events: (source) => source,
	/**
	 * Capture is off: nothing is recorded.
	 * @returns {void}
	 */
	reply() {}
};

/**
 * Begin the record of one exchange. With `capture` unset this returns a stand-in that does nothing.
 * @param {{config: any, state: any}} ctx - Translator `{ config, state }`.
 * @param {{body: any, sent: any, front: string, requested: string | null, headers?: Record<string, string>, log?: any}} exchange - Client body, the upstream request (result of `request`), front and the logger of the request.
 * @returns {{raw: (source: any) => any, events: (source: any) => any, reply: (status: number, headers: Record<string, string>, body: any) => void}} Recorder: `raw` taps the upstream stream bytes, `events` taps the client events and writes the record when the stream ends, `reply` writes the record of a non-stream reply.
 */
export function start({ config, state }, exchange) {
	const sink = config.capture;
	if (!sink) return OFF;
	const { sent } = exchange;
	const id = randomBytes(6).toString("hex");
	const time = Date.now();
	const record = {
		time,
		id,
		front: exchange.front,
		requested: exchange.requested,
		model: sent.body?.model ?? null,
		endpoint: sent.upstream,
		stream: sent.state.stream,
		client: { body: exchange.body },
		upstream: { url: sent.url, headers: redact(sent.headers), body: sent.body },
		response: {}
	};
	let raw = "";
	let rawFull = false;
	let seen = 0;
	let truncated = false;
	const events = [];
	/**
	 * Hand the record to the sink; a failure is a warning (once per message), never an error for the request.
	 * @returns {void}
	 */
	const emit = () => {
		try {
			if (typeof sink === "function") {
				const result = sink(record);
				if (typeof result?.then === "function") result.then(undefined, (cause) => problem(cause));
			} else {
				mkdirSync(path.resolve(sink), { recursive: true });
				writeFileSync(path.join(path.resolve(sink), `${time}-${id}.json`), `${JSON.stringify(record, null, 2)}\n`);
			}
		} catch (cause) {
			problem(cause);
		}
	};
	/**
	 * Report a failed capture write or callback.
	 * @param {any} cause - What failed.
	 * @returns {void}
	 */
	const problem = (cause) => {
		warn(
			config,
			state,
			`Could not capture the exchange (${cause instanceof Error ? cause.message : String(cause)}); the reply is not affected`,
			{
				type: "warning",
				kind: "capture",
				log: exchange.log
			}
		);
	};
	return {
		raw(source) {
			return (async function* () {
				const decoder = new TextDecoder();
				for await (const chunk of items(source)) {
					if (!rawFull) {
						raw += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
						if (raw.length > STREAM_LIMIT) {
							raw = raw.slice(0, STREAM_LIMIT);
							rawFull = true;
							truncated = true;
						}
					}
					yield chunk;
				}
			})();
		},
		events(source) {
			return (async function* () {
				try {
					for await (const event of items(source)) {
						if (seen <= STREAM_LIMIT) {
							const length = JSON.stringify(event).length;
							seen += length;
							if (seen > STREAM_LIMIT) truncated = true;
							else events.push(event);
						}
						yield event;
					}
				} finally {
					record.response = { status: 200, headers: redact(exchange.headers), raw, events, truncated };
					emit();
				}
			})();
		},
		reply(status, headers, body) {
			record.response = { status, headers: redact(headers), body };
			emit();
		}
	};
}
