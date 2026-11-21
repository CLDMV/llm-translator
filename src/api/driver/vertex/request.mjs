/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/vertex/request.mjs
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
 * @fileoverview Vertex AI driver: request normalizer (Messages body).
 * @module @cldmv/llm-translator/driver/vertex
 */
import { body } from "../../../lib/vertex.mjs";

/**
 * Add `anthropic_version` and take the model out of the body: Vertex AI names the model in the URL.
 * @param {any} request - Messages request body.
 * @returns {any} Vertex AI body.
 */
export function request(request) {
	return body(request);
}
