/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/embeddings/send.mjs
 *	@Date: 2026-11-06T12:00:00-08:00 (1794081600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-06T12:00:00-08:00 (1794081600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Embeddings api: forward an OpenAI embeddings request to an upstream that serves the model, without conversion.
 * @module @cldmv/llm-translator/embeddings/send
 */
import { context, self } from "../../lib/runtime.mjs";
import { capture } from "../../lib/capture.mjs";
import { resolve, serves } from "../../lib/route.mjs";
import * as http from "../../lib/http.mjs";
import * as pool from "../../lib/pool.mjs";
import { emit } from "../../lib/events.mjs";
import { meter as createMeter } from "../../lib/usage.mjs";
import { warn } from "../../lib/warn.mjs";
import { start as record } from "../../lib/record.mjs";

const PATH = "/v1/embeddings";

/**
 * Forward `POST /v1/embeddings` to an OpenAI-protocol upstream that lists the model. The body and the reply pass through unchanged
 * apart from `model`, which is the upstream's name for it (after `aliases`). The model is routed like a chat model: aliases, then the
 * pool of endpoints serving it, which fails over on a connection error or a 5xx. Errors are replies in the OpenAI error shape (the
 * return value, not a throw): `400` for a body that is not an object or has no `model`, `404` when no upstream serves the model and `400`
 * (`embeddings_unsupported`) when the model is served only by Anthropic-protocol upstreams, which have no embeddings API, and `499` (`aborted`) when `signal` aborts.
 *
 * Like `api.send`, every reply, including error replies, carries a non-enumerable `usage` property (a `Promise` of the usage report that
 * never rejects, already settled) and `onUsage(report)` is called with the same report exactly once. The report has the shape of
 * `api.send`'s (see there) with `front: "openai"` and `stream: false`: `input_tokens` is the reply's `prompt_tokens`, the other token fields
 * are `null`, and `reported` is false when the reply carried no `usage` (or only zeros). `reason` is `"done"` for a 200 reply, `"aborted"`
 * for a 499, `"upstream_error"` for an error the upstream answered with, and `"error"` for the rest (an invalid body, an unknown or
 * unsupported model, an unreachable upstream, a body that is not JSON); `model` and `upstream` are null until an endpoint was tried.
 * @param {any} body - OpenAI embeddings request body (`{ model, input, ... }`).
 * @param {any} [options] - `{ signal, headers, onUsage, log }`: abort signal for the upstream call, extra upstream headers, the usage callback and the logger events of this request also go to (used by the server).
 * @returns {Promise<{status: number, headers: Record<string,string>, body: any, usage: Promise<any>}>} The upstream's JSON reply, or an OpenAI-shaped error reply.
 */
export async function send(body, options = {}) {
	const { transport } = context.state;
	const { error } = self;
	const c = capture(self, context, "openai");
	const object = body && typeof body === "object" && !Array.isArray(body);
	const meter = createMeter(
		{
			model: null,
			requested: object && typeof body.model === "string" ? body.model : null,
			upstream: null,
			front: "openai",
			stream: false
		},
		options.onUsage,
		(message, details) => warn(c.config, c.state, message, { type: "usage", ...details, log: options.log })
	);
	/**
	 * Settle the usage report and attach it to the reply.
	 * @param {any} reply - Reply.
	 * @param {"done" | "aborted" | "error" | "upstream_error"} reason - Report reason.
	 * @returns {any} The reply.
	 */
	const end = (reply, reason) => {
		meter.finish(reason);
		return Object.defineProperty(reply, "usage", { value: meter.usage, enumerable: false, configurable: true });
	};
	const fail = (status, message, extra = {}) =>
		end(error.build(status, message, { ...extra, front: "openai" }), status === 499 ? "aborted" : "error");
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return fail(400, "The request body must be a JSON object", { code: "invalid_body" });
	}
	if (typeof body.model !== "string" || body.model === "") return fail(400, "model is required", { code: "invalid_body", param: "model" });
	// Unlike chat, no fallback: a lone upstream that knows one model must not answer for another, because vectors of different models do not mix.
	const target = Object.hasOwn(c.config.aliases, body.model) ? c.config.aliases[body.model] : body.model;
	if (!c.state.endpoints.some((endpoint) => serves(endpoint, target))) {
		return fail(404, `The model "${body.model}" is not served by any configured upstream.`, { code: "model_not_found", param: "model" });
	}
	const picked = resolve(c, body, { advance: true });
	const members = picked.pool.filter((endpoint) => endpoint.protocol === "openai.chat");
	if (members.length === 0) {
		return fail(400, `The model "${body.model}" is served by an Anthropic-protocol upstream, which has no embeddings API.`, {
			code: "embeddings_unsupported",
			param: "model"
		});
	}
	const upstream = { ...body, model: picked.model };
	meter.meta.model = picked.model;
	let last;
	// The id of the first attempt's capture record, shared by every attempt of this request.
	let group = null;
	for (let turn = 0; turn < members.length; turn++) {
		const endpoint = members[turn];
		meter.meta.upstream = endpoint.name;
		const driver = c.driver(endpoint);
		endpoint.health.inflight++;
		endpoint.health.requests++;
		const url = http.join(endpoint.url, PATH);
		const headers = {
			"content-type": "application/json",
			accept: "application/json",
			...driver.info.headers,
			...http.headers(endpoint, driver.info.auth, options.headers)
		};
		const recorder = record(c, {
			body,
			sent: { upstream: endpoint.name, url, headers, body: upstream, state: { stream: false } },
			front: "openai",
			requested: meter.meta.requested,
			log: options.log,
			exchange: group,
			attempt: turn + 1
		});
		group ??= recorder.id;
		let result;
		try {
			result = await http.json(transport, url, { method: "POST", headers, body: upstream, signal: options.signal });
		} finally {
			endpoint.health.inflight--;
		}
		if (options.signal?.aborted) return fail(499, "The request was aborted", { code: "aborted" });
		const unreachable = result.status === 0;
		if (!unreachable && result.status < 500) {
			pool.succeeded(endpoint);
			recorder.reply(result.status, result.headers, result.body);
			if (!result.ok) {
				return end(
					error(result.status, result.body, {}, { front: "openai", upstream: endpoint.name, native: true, model: body.model }),
					"upstream_error"
				);
			}
			if (result.body === null || typeof result.body !== "object") {
				return fail(502, "The upstream returned a body that is not JSON", { code: "bad_gateway" });
			}
			meter.json(result.body);
			return end({ status: 200, headers: { "content-type": "application/json" }, body: result.body }, "done");
		}
		const reason = unreachable ? `Could not reach the upstream (${endpoint.name}): ${result.error?.message}` : `HTTP ${result.status}`;
		pool.failed(c.config, endpoint, reason);
		const response = unreachable ? { error: reason } : { status: result.status, headers: result.headers, body: result.body };
		recorder.attempt(response, turn + 1 < members.length ? reason : undefined);
		emit(c, {
			type: "error",
			kind: unreachable ? "transport" : "upstream",
			level: "error",
			message: unreachable ? reason : `Upstream ${endpoint.name} answered HTTP ${result.status}`,
			endpoint: endpoint.name,
			model: picked.model,
			log: options.log
		});
		last = { endpoint, result, reason };
	}
	if (last.result.status === 0) return fail(502, last.reason, { code: "upstream_unreachable" });
	return end(
		error(last.result.status, last.result.body, {}, { front: "openai", upstream: last.endpoint.name, native: true, model: body.model }),
		"upstream_error"
	);
}
