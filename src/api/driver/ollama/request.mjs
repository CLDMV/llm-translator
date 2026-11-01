/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/ollama/request.mjs
 *	@Date: 2026-10-31T14:00:00-07:00 (1793480400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:00:00-07:00 (1793480400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Ollama driver: request normalizer (Chat Completions body).
 * @module @cldmv/llm-translator/driver/ollama
 */
import { noEmptyTools } from "../../../lib/normalize.mjs";
import { estimate } from "../../../lib/estimate.mjs";

/** Fields Ollama's `/v1` endpoint does not implement. */
const UNSUPPORTED = ["tool_choice", "n", "logit_bias"];

/** Replaces an image that is referenced by URL: `/v1` takes base64 data URLs only and the translator does not fetch URLs. */
const URL_NOTE = "[An image was omitted because Ollama accepts base64 images only and the translator does not fetch URLs.]";

/**
 * Remove `tool_choice`, `n` and `logit_bias` (recorded in `state.dropped`; with `tool_choice: "none"` the tools are removed too, so a forbidden tool call cannot happen), replace images given by URL with a note, and warn once per
 * upstream when the prompt is estimated to exceed `contextWindow` (Ollama truncates silently).
 * @param {any} body - Chat Completions request body.
 * @param {any} [ctx] - `{ endpoint, settings, state, warn }`.
 * @returns {any} Normalized body.
 */
export function request(body, ctx) {
	let out = noEmptyTools(body);
	const dropped = ctx?.state?.dropped;
	// `tool_choice: "none"` forbids tool calls. Dropping only the choice would let the model call a tool, so the tools go too.
	if (out.tool_choice === "none" && out.tools !== undefined) {
		out = { ...out };
		delete out.tools;
		delete out.parallel_tool_calls;
		if (Array.isArray(dropped) && !dropped.includes("tools")) dropped.push("tools");
	}
	for (const field of UNSUPPORTED) {
		if (out[field] === undefined) continue;
		out = { ...out };
		delete out[field];
		if (Array.isArray(dropped) && !dropped.includes(field)) dropped.push(field);
	}
	if (Array.isArray(out.messages)) {
		let replaced = false;
		const messages = out.messages.map((message) => {
			if (!Array.isArray(message?.content)) return message;
			const content = message.content.map((part) => {
				if (part?.type !== "image_url" || String(part.image_url?.url).startsWith("data:")) return part;
				replaced = true;
				return { type: "text", text: URL_NOTE };
			});
			return { ...message, content };
		});
		if (replaced) {
			out = { ...out, messages };
			if (Array.isArray(dropped) && !dropped.includes("image_url")) dropped.push("image_url");
		}
	}
	const window = ctx?.settings?.contextWindow ?? 0;
	if (window > 0 && estimate(out) > window) {
		ctx?.warn?.(
			`Upstream ${ctx.endpoint?.name}: the prompt is estimated at more than ${window} tokens, which Ollama truncates without an error. Raise num_ctx (OLLAMA_CONTEXT_LENGTH or a Modelfile) and set the upstream's contextWindow setting to match.`
		);
	}
	return out;
}
