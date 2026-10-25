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
 * @fileoverview One-time warnings.
 * @module @cldmv/llm-translator/lib/warn
 */
/**
 * Print a warning once per translator unless `silent` is set.
 * @param {any} config - Normalized config (`silent`).
 * @param {any} state - Translator state (`warned` set).
 * @param {string} message - Warning text.
 * @returns {boolean} True when the warning was printed.
 */
export declare function warn(config: any, state: any, message: string): boolean;
