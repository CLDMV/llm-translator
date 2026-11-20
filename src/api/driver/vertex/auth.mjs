/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/vertex/auth.mjs
 *	@Date: 2026-11-19T09:00:00-08:00 (1795107600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-19T09:00:00-08:00 (1795107600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Vertex AI driver: Google authentication of a request.
 * @module @cldmv/llm-translator/driver/vertex
 */
import { token } from "../../../lib/google-auth.mjs";

/**
 * Add the Google access token as the bearer token and drop the headers Vertex AI does not take (`x-api-key`, `anthropic-version`; a client's
 * `anthropic-beta` is kept). The token comes from `lib/google-auth.mjs`.
 * @param {any} context - `{ endpoint, headers, transport, timeout }`.
 * @returns {Promise<Record<string,string>>} Headers to send.
 */
export async function auth({ endpoint, headers, transport, timeout }) {
	const { "x-api-key": ___key, "anthropic-version": ___version, ...rest } = headers;
	const access = await token({ settings: endpoint.vertex, apiKey: endpoint.apiKey, transport, timeout });
	return { ...rest, authorization: `Bearer ${access}` };
}
