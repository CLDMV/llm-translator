/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/bedrock/token/count.mjs
 *	@Date: 2026-11-22T09:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T09:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Amazon Bedrock driver: token counting through the `CountTokens` operation.
 * @module @cldmv/llm-translator/driver/bedrock
 */
import * as http from "../../../../lib/http.mjs";
import { authenticate } from "../../../../lib/bedrock.mjs";
import { CONVERSE } from "../../../../lib/protocol.mjs";

/** The fields of a Converse body that `CountTokens` reads; it refuses the others (`inferenceConfig`, ...). */
const CONVERSE_FIELDS = ["messages", "system", "toolConfig", "additionalModelRequestFields"];

/**
 * Count tokens with `POST /model/<model>/count-tokens`. A Converse request is counted as `input.converse` (its messages, system prompt, tools and
 * model fields), and an InvokeModel request as `input.invokeModel` with the exact body that would be sent, base64 encoded. The call is
 * authenticated like every Bedrock call. Any failure (a model `CountTokens` does not serve, a missing permission, no credentials, a network
 * error) gives null, so the caller uses the estimate.
 * @param {any} context - `{ endpoint, request, path, state, transport, signal, timeout }`; `path` is the path of the call the request would make.
 * @returns {Promise<number | null>} Token count, or null when Bedrock did not answer.
 */
export async function count({ endpoint, request, path, state, transport, signal, timeout }) {
	let input;
	if (state?.protocol === CONVERSE) {
		input = {
			converse: Object.fromEntries(CONVERSE_FIELDS.filter((field) => request[field] !== undefined).map((field) => [field, request[field]]))
		};
	} else input = { invokeModel: { body: Buffer.from(JSON.stringify(request)).toString("base64") } };
	const body = { input };
	const url = http.join(endpoint.url, path.replace(/\/[^/]+$/, "/count-tokens"));
	try {
		const headers = await authenticate(
			endpoint,
			{
				method: "POST",
				url,
				headers: { ...endpoint.headers, "content-type": "application/json", accept: "application/json" },
				body: JSON.stringify(body)
			},
			{ transport, timeout, signal }
		);
		const result = await http.json(transport, url, { method: "POST", headers, body, signal, timeout });
		return result.ok && Number.isFinite(result.body?.inputTokens) ? result.body.inputTokens : null;
	} catch {
		// A credential or configuration failure would also fail the request itself and be reported there; the count falls back to the estimate.
		return null;
	}
}
