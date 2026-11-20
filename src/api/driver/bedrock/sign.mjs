/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/bedrock/sign.mjs
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
 * @fileoverview Amazon Bedrock driver: authentication of each call.
 * @module @cldmv/llm-translator/driver/bedrock
 */
import { authenticate } from "../../../lib/bedrock.mjs";

/** `Accept` of a streamed reply. */
const EVENT_STREAM = "application/vnd.amazon.eventstream";

/**
 * Authenticate a call: a Bedrock API key (the upstream's `apiKey` or `AWS_BEARER_TOKEN_BEDROCK`) is sent as a bearer token, and otherwise the
 * call is signed with SigV4 from the upstream's access keys or the `AWS_*` environment variables (see `lib/bedrock`). The signature covers the
 * exact JSON text of the body, which is what the transport sends.
 * @param {any} context - `{ endpoint, method, url, headers, body, stream }`.
 * @returns {Record<string, string>} The headers to send.
 * @throws {import("../../../lib/errors.mjs").TranslatorError} `missing_credentials` or `missing_region` (500).
 */
export function sign({ endpoint, method, url, headers, body, stream }) {
	return authenticate(endpoint, {
		method,
		url,
		headers: { ...headers, accept: stream ? EVENT_STREAM : "application/json" },
		body: JSON.stringify(body)
	});
}
