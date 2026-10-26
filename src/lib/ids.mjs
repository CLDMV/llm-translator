/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/ids.mjs
 *	@Date: 2026-10-25T12:28:19-07:00 (1792956499)
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
 * @fileoverview Identifier helpers: message ids, tool-call ids and tool-name fitting.
 */

import { randomBytes, createHash } from "node:crypto";

/**
 * Random identifier body (hex).
 * @param {number} [bytes] - Random bytes.
 * @returns {string} Hex string.
 */
function random(bytes = 12) {
	return randomBytes(bytes).toString("hex");
}

/**
 * Anthropic style message id.
 * @returns {string} `msg_...` id.
 */
export function messageId() {
	return `msg_${random()}`;
}

/**
 * Anthropic style tool-use id.
 * @returns {string} `toolu_...` id.
 */
export function toolUseId() {
	return `toolu_${random()}`;
}

/**
 * OpenAI style completion id.
 * @returns {string} `chatcmpl-...` id.
 */
export function completionId() {
	return `chatcmpl-${random()}`;
}

/**
 * Make a tool-call id valid for Anthropic (`[a-zA-Z0-9_-]+`). Valid ids pass through unchanged, invalid characters
 * (for example kimi's `functions.name:0`) become `_`, and a missing or empty id is replaced by a fresh one. The
 * mapping is deterministic so a tool call and its later tool result agree.
 * @param {unknown} id - Upstream id.
 * @returns {string} Anthropic-valid id.
 */
export function anthropicToolId(id) {
	if (typeof id !== "string" || id === "") return toolUseId();
	return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Create a tool-name fitter. Names that already satisfy `pattern` and `max` pass through; others are sanitized and,
 * when too long, shortened with a hash suffix. Every changed name is recorded in `map` (`fitted -> original`) so the
 * original can be restored on the way back. Fitted names are kept unique.
 * @param {{ max: number, map?: Record<string, string> }} options - Maximum length and the (JSON-serializable) map to record into.
 * @returns {(name: string) => string} Fitter function.
 */
export function createNameFitter({ max, map = {} }) {
	const byOriginal = new Map(Object.entries(map).map(([fitted, original]) => [original, fitted]));
	return (name) => {
		if (name.length <= max && /^[a-zA-Z0-9_-]+$/.test(name)) return name;
		if (byOriginal.has(name)) return byOriginal.get(name);
		const clean = name.replace(/[^a-zA-Z0-9_-]/g, "_");
		let fitted = clean;
		if (clean.length > max || clean === "") {
			const hash = createHash("sha256").update(name).digest("hex").slice(0, 8);
			fitted = `${clean.slice(0, max - 9)}_${hash}`;
		}
		const base = fitted;
		for (let n = 2; Object.hasOwn(map, fitted); n++) fitted = `${base.slice(0, max - 4)}_${n}`;
		map[fitted] = name;
		byOriginal.set(name, fitted);
		return fitted;
	};
}

/**
 * Original tool name for a fitted one (names that were never changed map to themselves).
 * @param {Record<string, string>} map - `fitted -> original` map from the conversion state.
 * @param {string} name - Name seen on the wire.
 * @returns {string} Original name.
 */
export function restoreName(map, name) {
	return Object.hasOwn(map, name) ? map[name] : name;
}
