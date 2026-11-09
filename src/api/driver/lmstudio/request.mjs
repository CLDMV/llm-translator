/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/lmstudio/request.mjs
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
 * @fileoverview LM Studio driver: request normalizer (Chat Completions body).
 * @module @cldmv/llm-translator/driver/lmstudio
 */
import { noEmptyTools } from "../../../lib/normalize.mjs";

/**
 * Drop tool fields when there are no tools.
 * @param {any} body - Chat Completions request body.
 * @returns {any} Normalized body.
 */
export function request(body) {
	return noEmptyTools(body);
}
