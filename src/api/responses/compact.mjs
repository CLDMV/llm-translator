/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/responses/compact.mjs
 *	@Date: 2026-11-27T12:00:00-08:00 (1795809600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-27T12:00:00-08:00 (1795809600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Responses api: compact a conversation (`POST /v1/responses/compact`).
 * @module @cldmv/llm-translator/responses
 */
import { context, self } from "../../lib/runtime.mjs";
import { capture } from "../../lib/capture.mjs";
import { resolve as routeTo } from "../../lib/route.mjs";
import { TranslatorError } from "../../lib/errors.mjs";
import { itemId, summarize, usageOf } from "../../lib/responses.mjs";

/** What the model is asked to write. */
const PROMPT =
	"Write a summary of the conversation above that will replace its earlier turns. Keep the user's goals and instructions, the decisions made, the facts, names and identifiers later turns depend on, the work still to do, and the state of any tool use. Reply with the summary only.";

/**
 * Whether an input item is a user message, which a compaction keeps as it is.
 * @param {any} item - Input item.
 * @returns {boolean} True for a user message.
 */
function isUser(item) {
	return item !== null && typeof item === "object" && item.role === "user" && (item.type === undefined || item.type === "message");
}

/**
 * Compact a conversation (`POST /v1/responses/compact`). The conversation is sent to the model through one ordinary `send` with a request to summarise it, and the
 * result is the window to continue from: the conversation's user messages as they were, and a `compaction` item whose `encrypted_content` carries the summary
 * (written by this translator; see `lib/responses.mjs`). A later request that sends the item has it turned into a user message with the summary. UNSURE: the
 * shape follows OpenAI's documented `response.compaction` object (`id`, `object`, `output`, `usage`, `created_at`); whether OpenAI keeps every user message or
 * only the recent ones is not known here, and the translator keeps all of them.
 * @param {any} body - `{ model, input, instructions? }`: the conversation to compact (the route has already resolved `previous_response_id` and `conversation` into `input`).
 * @param {any} [options] - `{ signal, onUsage, log, clientHeaders }`, as for `send`.
 * @returns {Promise<any>} The reply: `{ status: 200, body: { id, object: "response.compaction", created_at, output, usage } }`, or the upstream's error reply.
 * @throws {TranslatorError} `invalid_request` for a body without a model or an input, `unsupported_field` for `previous_response_id` or `conversation` (no response store), and the request converter's errors for an input it cannot convert (`unsupported_content` for a `compaction` item this translator did not write).
 */
export async function compact(body, options = {}) {
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		throw new TranslatorError("The request body must be a JSON object", { code: "invalid_request", param: null });
	}
	if (typeof body.model !== "string" || body.model === "") {
		throw new TranslatorError("model is a required property", { code: "invalid_request", param: "model" });
	}
	for (const name of ["previous_response_id", "conversation"]) {
		if (body[name] !== undefined && body[name] !== null) {
			throw new TranslatorError(`${name}: needs a response store (the responses setting is off)`, {
				code: "unsupported_field",
				param: name
			});
		}
	}
	const input = body.input ?? [];
	const c = capture(self, context, "openai");
	const routed = routeTo(c, body, { wire: "responses" });
	const settings = c.settings(routed.endpoint, routed.protocol);
	const converted = self.convert.openai.responses.to.openai.chat.request(
		{ model: body.model, input, ...(typeof body.instructions === "string" ? { instructions: body.instructions } : {}) },
		settings
	);
	const chat = { ...converted.body, messages: [...converted.body.messages, { role: "user", content: PROMPT }] };
	const reply = await self.send(chat, {
		signal: options.signal,
		wire: "responses",
		clientHeaders: options.clientHeaders,
		onUsage: options.onUsage,
		log: options.log
	});
	if (reply.status >= 400) return reply;
	const content = reply.body?.choices?.[0]?.message?.content;
	const summary = typeof content === "string" ? content.trim() : "";
	if (summary === "") {
		throw new TranslatorError("The upstream returned no summary", { code: "invalid_upstream_response", status: 502 });
	}
	const kept =
		typeof input === "string" ? [{ type: "message", role: "user", content: [{ type: "input_text", text: input }] }] : input.filter(isUser);
	const out = {
		status: 200,
		headers: reply.headers,
		body: {
			id: itemId("resp"),
			object: "response.compaction",
			created_at: Math.floor(Date.now() / 1000),
			output: [...kept, { type: "compaction", id: itemId("cmp"), encrypted_content: summarize(summary) }],
			usage: usageOf(reply.body.usage)
		}
	};
	return Object.defineProperty(out, "usage", { value: reply.usage, enumerable: false, configurable: true });
}
