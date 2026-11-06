/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/events/on.mjs
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
 * @fileoverview Events api: subscribe to translator events.
 * @module @cldmv/llm-translator/events
 */
import { context } from "../../lib/runtime.mjs";
import * as events from "../../lib/events.mjs";

/**
 * Subscribe to an event (see docs/events.md for the catalogue). `"*"` receives every occurrence once. The listener only observes: an
 * exception or a rejection is contained and reported once through logging.
 * @param {string} name - Event name (`log`, `warning`, `error`, `fallback`, `failover`, `effort`, `dropped`, `detect`, `usage`) or `"*"`.
 * @param {(event: import("../../lib/events.mjs").TranslatorEvent) => any} fn - Listener.
 * @returns {() => void} Function that removes the listener.
 */
export function on(name, fn) {
	return events.on(context.state.events, name, fn);
}
