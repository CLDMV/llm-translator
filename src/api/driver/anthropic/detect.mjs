/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/anthropic/detect.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:58:59-07:00 (1792958339)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Anthropic driver: matches the api.anthropic.com host, or any server whose model list has the Anthropic shape.
 * @module @cldmv/llm-translator/driver/anthropic
 */
import * as http from "../../../lib/http.mjs";
import { info } from "./info.mjs";

/**
 * Whether a `/v1/models` body is an Anthropic model list. Anthropic's list is `{ data: [{ type: "model", id, display_name, created_at }],
 * has_more, first_id, last_id }`; OpenAI's is `{ object: "list", data: [{ id, object: "model" }] }`. Every marker is required, so an
 * OpenAI-shaped list (which has `object`, and entries with `object` instead of `type`) can never pass.
 * @param {any} body - Parsed response body.
 * @returns {boolean} True for an Anthropic-shaped list.
 */
function isAnthropicList(body) {
	if (body === null || typeof body !== "object" || Array.isArray(body) || "object" in body) return false;
	if (!Array.isArray(body.data) || typeof body.has_more !== "boolean") return false;
	const ends = [body.first_id, body.last_id];
	if (!ends.every((end) => end === null || typeof end === "string")) return false;
	if (!body.data.every((entry) => entry?.type === "model" && typeof entry.id === "string" && typeof entry.display_name === "string"))
		return false;
	// The cursors point into the page: both null exactly when the page is empty, and they name its first and last entries otherwise.
	const first = body.data[0]?.id ?? null;
	const last = body.data.at(-1)?.id ?? null;
	return body.first_id === first && body.last_id === last;
}

/**
 * Match `api.anthropic.com` by host name with no request. Any other host is asked for `GET /v1/models` with the Anthropic headers
 * (`anthropic-version`, `x-api-key` from the upstream's key) and matches only when the answer is an Anthropic-shaped model list.
 * The request is part of the batch started at the first probing driver, so it adds no round trip. A server that needs a key and was
 * given none answers 401 and is not matched; give it the key or set `backend: "anthropic"`.
 * @param {any} context - `{ endpoint, transport, signal, timeout, probes }`.
 * @returns {Promise<{host: string} | {models: string[]} | null>} Facts, or null when the endpoint is not an Anthropic-protocol server.
 */
export async function detect(context) {
	const { endpoint } = context;
	const host = URL.canParse(endpoint.url) ? new URL(endpoint.url).hostname : "";
	if (info().hosts.includes(host)) return { host };
	const result = await http.probe(context, "/v1/models", info());
	if (!result.ok || !isAnthropicList(result.body)) return null;
	return { models: result.body.data.map((entry) => entry.id) };
}
