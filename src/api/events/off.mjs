/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/events/off.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:02-07:00 (1792958342)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Events api: remove a listener.
 * @module @cldmv/llm-translator/events
 */
import { context } from "../../lib/runtime.mjs";
import * as events from "../../lib/events.mjs";

/**
 * Remove a listener added with `events.on`. A listener that is not subscribed is ignored.
 * @param {string} name - Event name or `"*"`.
 * @param {Function} fn - The listener passed to `events.on`.
 * @returns {void}
 */
export function off(name, fn) {
	events.off(context.state.events, name, fn);
}
