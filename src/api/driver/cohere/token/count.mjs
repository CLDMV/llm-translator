/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/cohere/token/count.mjs
 *	@Date: 2026-11-22T10:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T10:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Cohere driver: token counting with Cohere's tokenizer (`POST /v1/tokenize`).
 * @module @cldmv/llm-translator/driver/cohere
 */
import * as http from "../../../../lib/http.mjs";
import { chunksOf, promptText, rootOf } from "../../../../lib/cohere.mjs";

/** The most text one `/v1/tokenize` call takes, in characters. */
const LIMIT = 65536;

/** The most calls one count may make; a longer prompt is estimated instead. */
const CALLS = 16;

/**
 * Count the prompt tokens of a request with the model's own tokenizer. `/v1/tokenize` takes one raw string, not a chat, so the text the model reads
 * (messages, reasoning, tool plans, tool calls, tool definitions and documents) is sent in pieces of at most 65,536 characters and the counts are
 * added. The result is the tokenizer's count of that text: the few tokens of chat template around each message are not in it, so it is a little
 * below what the chat endpoint bills, and much closer than the estimate of one token per four characters.
 * @param {any} context - `{ endpoint, request, transport, signal, timeout }`.
 * @returns {Promise<number | null>} Token count, or null when Cohere did not answer, or the prompt needs more than 16 calls (the caller falls back to an estimate).
 */
export async function count({ endpoint, request, transport, signal, timeout }) {
	const pieces = chunksOf(promptText(request).join("\n"), LIMIT);
	if (pieces.length > CALLS) return null;
	const url = http.join(rootOf(endpoint.url), "/v1/tokenize");
	let total = 0;
	for (const text of pieces) {
		const result = await http.json(transport, url, {
			method: "POST",
			headers: { "content-type": "application/json", ...http.headers(endpoint) },
			body: { text, model: request.model },
			signal,
			timeout
		});
		if (!result.ok || !Array.isArray(result.body?.tokens)) return null;
		total += result.body.tokens.length;
	}
	return total;
}
