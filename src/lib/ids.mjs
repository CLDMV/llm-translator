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
import { TranslatorError } from "./errors.mjs";

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
 * OpenAI style tool-call id, for upstream tool calls that carry none.
 * @returns {string} `call_...` id.
 */
export function callId() {
	return `call_${random()}`;
}

/**
 * Make a tool-call id valid for Anthropic (`[a-zA-Z0-9_-]+`). An id found in `map` (`fitted -> original`, from a driver's `toolCallIds`
 * policy) is the client's own and is restored first. Otherwise valid ids pass through unchanged, invalid characters
 * (for example kimi's `functions.name:0`) become `_`, and a missing or empty id is replaced by a fresh one. The
 * mapping is deterministic so a tool call and its later tool result agree.
 * @param {unknown} id - Upstream id.
 * @param {Record<string, string>} [map] - `fitted -> original` ids from the conversion state.
 * @returns {string} Anthropic-valid id.
 */
export function anthropicToolId(id, map = {}) {
	if (typeof id === "string" && Object.hasOwn(map, id)) return map[id];
	if (typeof id !== "string" || id === "") return toolUseId();
	return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Printable ASCII characters (code points 33 to 126, in order) that a character-class body such as `a-zA-Z0-9` allows.
 * @param {string} alphabet - Body of a regular expression character class.
 * @returns {string[]} The allowed characters; empty when the class is invalid or matches none of them.
 */
function alphabetOf(alphabet) {
	let single;
	try {
		single = new RegExp(`^[${alphabet}]$`);
	} catch {
		return [];
	}
	const chars = [];
	for (let code = 33; code <= 126; code++) if (single.test(String.fromCharCode(code))) chars.push(String.fromCharCode(code));
	return chars;
}

/**
 * Whether a driver's `info().toolCallIds` is usable: `{ alphabet, min?, max? }` where `alphabet` is the body of a regular
 * expression character class that allows at least one printable ASCII character (`"a-zA-Z0-9"`), and `min` and `max` are
 * positive integers (`min <= max`) bounding the id length. Mistral's ids are `{ alphabet: "a-zA-Z0-9", min: 9, max: 9 }`.
 * @param {unknown} policy - Value to check.
 * @returns {boolean} True when the policy can be applied.
 */
export function validToolIdPolicy(policy) {
	if (policy === null || typeof policy !== "object" || Array.isArray(policy)) return false;
	const { alphabet, min, max } = /** @type {any} */ (policy);
	if (typeof alphabet !== "string" || alphabetOf(alphabet).length === 0) return false;
	const bound = (value) => value === undefined || (Number.isInteger(value) && value >= 1);
	return bound(min) && bound(max) && (min ?? 1) <= (max ?? Infinity);
}

/**
 * Hash a seed into `size` characters of an alphabet (stable: the same seed always gives the same text).
 * @param {string} seed - Text to hash.
 * @param {string[]} chars - Allowed characters.
 * @param {number} size - Number of characters.
 * @returns {string} Id text.
 */
function hashed(seed, chars, size) {
	let out = "";
	for (let block = 0; out.length < size; block++) {
		for (const byte of createHash("sha256").update(`${seed}\u0000${block}`).digest()) {
			if (out.length === size) break;
			out += chars[byte % chars.length];
		}
	}
	return out;
}

/**
 * Create a tool-call id fitter for an upstream with a strict id format (`info().toolCallIds`, see `validToolIdPolicy`). The translator
 * keeps no state between requests, so the mapping is a pure function of the request: an id that already satisfies the policy passes
 * through unchanged (so history replayed from the upstream's own ids survives), and any other id becomes a hash of itself in the
 * allowed alphabet, the same text on every request. A tool call and its tool result carry the same original and so get the same
 * value. `ids` lists every original id of the request: the conforming ones are reserved first, then each other one takes its hash,
 * and when that text is already taken by a different original the hash is taken again with a counter until it is free. Every
 * rewritten id is recorded in `map` (`fitted -> original`) so the original can be restored when the upstream echoes it back.
 * @param {{ policy: { alphabet: string, min?: number, max?: number }, ids: unknown[], map?: Record<string, string> }} options - Policy, the request's ids and the (JSON-serializable) map to record into.
 * @returns {(id: unknown) => string} Fitter function.
 */
export function createIdFitter({ policy, ids, map = {} }) {
	const chars = alphabetOf(policy.alphabet);
	const only = new RegExp(`^[${policy.alphabet}]+$`);
	const min = policy.min ?? 1;
	const max = policy.max ?? Infinity;
	const size = Math.min(max, Math.max(min, 16));
	const fitted = new Map();
	const taken = new Set();
	const conforms = (original) => only.test(original) && original.length >= min && original.length <= max;
	const assign = (original) => {
		let id = original;
		if (!conforms(original)) {
			let attempt = 0;
			id = hashed(original, chars, size);
			while (taken.has(id)) {
				// The format has too few ids left for this conversation (only a tiny alphabet and length can run out); fail instead of looping.
				if (++attempt > 255) {
					throw new TranslatorError("Tool call ids cannot be mapped into the upstream's id format: no free id is left", {
						code: "invalid_request",
						status: 400
					});
				}
				id = hashed(`${original}\u0000${attempt}`, chars, size);
			}
			map[id] = original;
		}
		taken.add(id);
		fitted.set(original, id);
		return id;
	};
	const keyOf = (id) => (typeof id === "string" ? id : "");
	const fit = (id) => fitted.get(keyOf(id)) ?? assign(keyOf(id));
	// Conforming ids are reserved before any other id is hashed, so a hash can never take a conforming id's place.
	for (const id of ids) {
		const original = keyOf(id);
		if (conforms(original) && !fitted.has(original)) assign(original);
	}
	for (const id of ids) fit(id);
	return fit;
}

/**
 * Original tool-call id for one rewritten by `createIdFitter` (ids that were never rewritten, including ones the upstream made itself,
 * map to themselves).
 * @param {Record<string, string>} map - `fitted -> original` map from the conversion state.
 * @param {string} id - Id seen on the wire.
 * @returns {string} Original id.
 */
export function restoreId(map, id) {
	return Object.hasOwn(map, id) ? map[id] : id;
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
