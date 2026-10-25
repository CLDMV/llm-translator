/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/sse/encode.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:01-07:00 (1792958341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview SSE helper: encode one event as a wire frame.
 * @module @cldmv/llm-translator/sse
 */
import * as sse from "../../lib/sse.mjs";

/**
 * Encode `{ event?, data, id? }` (object data is JSON-encoded, `"[DONE]"` is written as is) or a keep-alive comment
 * `{ comment }` as an SSE frame.
 * @param {{event?: string, data?: any, id?: string, comment?: string}} message - Event to encode.
 * @returns {string} SSE text ending with a blank line.
 */
export function encode(message) {
	return message.comment === undefined
		? sse.encode(/** @type {{event?: string, data: any, id?: string}} */ (message))
		: `: ${message.comment}\n\n`;
}
