/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/compaction.mjs
 *	@Date: 2026-11-28T12:00:00-08:00 (1795896000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-28T12:00:00-08:00 (1795896000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Automatic compaction (`context_management: [{ type: "compaction", compact_threshold }]` on a Responses request).
 *
 * The request converter leaves the threshold on the Chat body as `llmt_compact: { threshold }`. Before the turn runs, {@link run} counts the tokens of the
 * rendered input (the translator's own token count, `api.token.count`). From the threshold up, everything before the current turn (the last user message
 * and what follows it) is summarised by the upstream, through the same step as `POST /v1/responses/compact`, and the turn runs on the leading system
 * messages, a user message with the summary and the current turn. The response then starts with a `compaction` item (`encrypted_content` carries the
 * summary, see `lib/responses.mjs`), and a response that has one is stored without the history it replaced.
 *
 * Both calls are ordinary `send`s, so routing, failover and events apply, and the usage is reported once, summed.
 * @module @cldmv/llm-translator/lib/compaction
 */
import { AsyncResource } from "node:async_hooks";
import { TranslatorError } from "./errors.mjs";
import { combine, deliver } from "./usage.mjs";
import { COMPACTED, COMPACT_PROMPT, itemId, summarize } from "./responses.mjs";
import { marked, nativeRoute, strip } from "./hostedtools.mjs";

/**
 * Whether a Chat body asks for automatic compaction.
 * @param {any} c - Captured translator parts.
 * @param {any} body - Chat body of a Responses request.
 * @param {any} options - The `send` options.
 * @returns {boolean} True when the request converter left a threshold on it.
 * @throws {TranslatorError} `unsupported_field` for a request that also sends hosted tools natively (`hostedTools: "native"`): the upstream's own events cannot carry the compaction item.
 */
export function wants(c, body, options) {
	if (body === null || typeof body !== "object" || body.llmt_compact === undefined) return false;
	if (marked(body) && nativeRoute(c, body, options)) {
		throw new TranslatorError(
			"context_management: automatic compaction cannot be combined with hosted tools sent natively (hostedTools: native)",
			{
				code: "unsupported_field",
				param: "context_management"
			}
		);
	}
	return true;
}

/**
 * Put an item before the answer of a reply.
 * @param {any} reply - A `send` reply.
 * @param {any} item - The item.
 * @returns {any} The reply with the item first (a stream starts with a chunk that carries it); an error reply as it was.
 */
function prefixed(reply, item) {
	if (reply.status >= 400) return reply;
	if (reply.stream === undefined) return { ...reply, body: { ...reply.body, llmt_prefix: [item] } };
	const source = reply.stream;
	return {
		...reply,
		stream: (async function* () {
			yield { data: { choices: [], llmt_items: [item] } };
			// The sentinel is held back and sent at the end, after the upstream's stream has been read to its end, so its usage report settles.
			for await (const message of source) if (message.data !== "[DONE]") yield message;
			yield { data: "[DONE]" };
		})()
	};
}

/**
 * Answer a request that asked for automatic compaction. See the module comment.
 * @param {object} spec - `{ body, options, send, warn, count, fail }`.
 * @param {any} spec.body - Chat body with `llmt_compact`.
 * @param {any} spec.options - The `send` options of the request.
 * @param {(body: any, options: any) => Promise<any>} spec.send - The single-request send.
 * @param {(message: string, details: {kind: "threw" | "rejected"}) => void} spec.warn - Receives a message when `onUsage` throws or rejects.
 * @param {(body: any) => Promise<{input_tokens: number}>} spec.count - Counts the prompt tokens of a Chat body.
 * @param {(status: number, message: string, details: any) => any} spec.fail - Builds an error reply.
 * @returns {Promise<any>} The reply, with a non-enumerable `usage` promise of the combined report.
 */
export async function run({ body, options, send: direct, warn, count, fail }) {
	const send = AsyncResource.bind(direct);
	const waits = [];
	/** @type {(value?: any) => void} */
	let finish;
	const usage = new Promise((done) => {
		finish = done;
	}).then(() =>
		Promise.all(waits).then((reports) => {
			const report = combine(reports);
			deliver(report, options.onUsage, warn);
			return report;
		})
	);
	const attach = (reply) => Object.defineProperty(reply, "usage", { value: usage, enumerable: false, configurable: true });
	const ask = (next) => {
		let report;
		waits.push(
			new Promise((done) => {
				report = done;
			})
		);
		return send(next, { ...options, onUsage: report });
	};
	const { llmt_compact: mark, ...rest } = body;
	try {
		const { messages } = rest;
		const lead = messages.findIndex((message) => message?.role !== "system" && message?.role !== "developer");
		const turn = messages.findLastIndex((message) => message?.role === "user");
		const counted = turn > lead && lead !== -1 ? await count(strip(rest)) : null;
		if (counted === null || counted.input_tokens < mark.threshold) return attach(await ask(rest));
		const summed = await ask({
			model: rest.model,
			messages: [...strip(rest).messages.slice(0, turn), { role: "user", content: COMPACT_PROMPT }]
		});
		if (summed.status >= 400) return attach(summed);
		const content = summed.body?.choices?.[0]?.message?.content;
		const text = typeof content === "string" ? content.trim() : "";
		if (text === "") {
			return attach(fail(502, "The upstream returned no summary", { code: "invalid_upstream_response" }));
		}
		const item = { type: "compaction", id: itemId("cmp"), encrypted_content: summarize(text) };
		const next = {
			...rest,
			messages: [...messages.slice(0, lead), { role: "user", content: `${COMPACTED}\n\n${text}` }, ...messages.slice(turn)]
		};
		return attach(prefixed(await ask(next), item));
	} finally {
		finish();
	}
}
