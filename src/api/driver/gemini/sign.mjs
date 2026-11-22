/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/gemini/sign.mjs
 *	@Date: 2026-11-21T10:00:00-08:00 (1795284000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-21T10:00:00-08:00 (1795284000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Gemini driver: authentication of a native call.
 * @module @cldmv/llm-translator/driver/gemini
 */
import { GEMINI } from "../../../lib/protocol.mjs";

/**
 * Authenticate a call. The native `generateContent` API takes the API key in the `x-goog-api-key` header, not as a bearer token (which is what
 * the OpenAI-compatible endpoint takes), so a native call has the bearer header the key made replaced by it. Any other call is unchanged.
 * @param {any} context - `{ endpoint, protocol, headers }`.
 * @returns {Record<string, string>} The headers to send.
 */
export function sign({ endpoint, protocol, headers }) {
	if (protocol !== GEMINI || !endpoint.apiKey) return headers;
	const out = { ...headers, "x-goog-api-key": endpoint.apiKey };
	if (out.authorization === `Bearer ${endpoint.apiKey}`) delete out.authorization;
	return out;
}
