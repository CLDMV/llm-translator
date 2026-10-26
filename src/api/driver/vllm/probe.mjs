/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/vllm/probe.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:00-07:00 (1792958340)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview vLLM driver: probes whether the chat template accepts non-leading system messages.
 * @module @cldmv/llm-translator/driver/vllm
 */
import * as http from "../../../lib/http.mjs";

/** 1x1 PNG used to ask whether the served model accepts images. */
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/**
 * Probe a vLLM server for facts that need a request.
 *
 * - `inlineSystem`: `POST /tokenize` with `[system, user, system, user]`. Success means the chat template tolerates system
 *   messages in the middle of a conversation (`keep`), failure means they must be folded into user turns (`user`).
 * - `images`: a one-token chat completion with a 1x1 image. `false` when the server answers 400 that the model is not
 *   multimodal (so images and PDF page images are replaced by notes instead of failing every request), `true` when it
 *   accepts the request, and absent when the answer is inconclusive (timeouts, other errors).
 * @param {{ endpoint: any, transport: Function, signal?: AbortSignal, timeout?: number, facts?: any, want?: { inlineSystem?: boolean, images?: boolean } }} context - Probe context. `want` selects the checks (`inlineSystem` defaults to on, `images` to off).
 * @returns {Promise<{ inlineSystem?: "keep"|"user", images?: boolean }>} Probed settings.
 */
export async function probe({ endpoint, transport, signal, timeout, facts, want = {} }) {
	/** @type {{ inlineSystem?: "keep"|"user", images?: boolean }} */
	const out = {};
	const headers = { "content-type": "application/json", ...http.headers(endpoint) };
	const model = facts?.models?.[0];
	if (want.inlineSystem !== false) {
		const result = await http.json(transport, http.join(endpoint.url, "/tokenize"), {
			method: "POST",
			headers,
			body: {
				model,
				messages: [
					{ role: "system", content: "a" },
					{ role: "user", content: "b" },
					{ role: "system", content: "c" },
					{ role: "user", content: "d" }
				]
			},
			signal,
			timeout
		});
		out.inlineSystem = result.ok ? "keep" : "user";
	}
	if (want.images === true) {
		const result = await http.json(transport, http.join(endpoint.url, "/v1/chat/completions"), {
			method: "POST",
			headers,
			body: {
				model,
				max_tokens: 1,
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: "." },
							{ type: "image_url", image_url: { url: `data:image/png;base64,${PIXEL}` } }
						]
					}
				]
			},
			signal,
			timeout
		});
		if (result.ok) out.images = true;
		else if (result.status === 400 && /multimodal|not support.*image|image.*not support/i.test(JSON.stringify(result.body)))
			out.images = false;
	}
	return out;
}
