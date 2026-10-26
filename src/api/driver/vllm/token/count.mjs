/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/vllm/token/count.mjs
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
 * @fileoverview vLLM driver: exact token counting through `POST /tokenize`.
 * @module @cldmv/llm-translator/driver/vllm
 */
import * as http from "../../../../lib/http.mjs";

/**
 * Count the prompt tokens of a converted Chat Completions request with the server's own tokenizer and chat template.
 * @param {any} context - `{ endpoint, request, transport, signal, timeout }`.
 * @returns {Promise<number | null>} Token count, or null when the server did not answer (caller falls back to an estimate).
 */
export async function count({ endpoint, request, transport, signal, timeout }) {
	const result = await http.json(transport, http.join(endpoint.url, "/tokenize"), {
		method: "POST",
		headers: { "content-type": "application/json", ...http.headers(endpoint) },
		body: { model: request.model, messages: request.messages, tools: request.tools, add_generation_prompt: true },
		signal,
		timeout
	});
	return result.ok && typeof result.body?.count === "number" ? result.body.count : null;
}
