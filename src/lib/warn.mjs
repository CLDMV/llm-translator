/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/warn.mjs
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
 * @fileoverview Warnings: a thin helper over the event emitter.
 * @module @cldmv/llm-translator/lib/warn
 */
import { emit } from "./events.mjs";

/**
 * Emit a warning event (type `warning` unless `details.type` names a specific one). The console prints it once per message when
 * `logs` is on; listeners and the log file see every occurrence.
 * @param {any} config - Normalized config.
 * @param {any} state - Translator state.
 * @param {string} message - Warning text.
 * @param {{type?: string, kind?: string, log?: any, [detail: string]: any}} [details] - Event type, kind and further payload fields.
 * @returns {void}
 */
export function warn(config, state, message, details = {}) {
	emit({ config, state }, { type: "warning", ...details, level: "warn", message });
}
