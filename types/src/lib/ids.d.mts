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
 * Anthropic style message id.
 * @returns {string} `msg_...` id.
 */
export declare function messageId(): string;
/**
 * Anthropic style tool-use id.
 * @returns {string} `toolu_...` id.
 */
export declare function toolUseId(): string;
/**
 * OpenAI style completion id.
 * @returns {string} `chatcmpl-...` id.
 */
export declare function completionId(): string;
/**
 * Make a tool-call id valid for Anthropic (`[a-zA-Z0-9_-]+`). Valid ids pass through unchanged, invalid characters
 * (for example kimi's `functions.name:0`) become `_`, and a missing or empty id is replaced by a fresh one. The
 * mapping is deterministic so a tool call and its later tool result agree.
 * @param {unknown} id - Upstream id.
 * @returns {string} Anthropic-valid id.
 */
export declare function anthropicToolId(id: unknown): string;
/**
 * Create a tool-name fitter. Names that already satisfy `pattern` and `max` pass through; others are sanitized and,
 * when too long, shortened with a hash suffix. Every changed name is recorded in `map` (`fitted -> original`) so the
 * original can be restored on the way back. Fitted names are kept unique.
 * @param {{ max: number, map?: Record<string, string> }} options - Maximum length and the (JSON-serializable) map to record into.
 * @returns {(name: string) => string} Fitter function.
 */
export declare function createNameFitter({ max, map }: {
    max: number;
    map?: Record<string, string>;
}): (name: string) => string;
/**
 * Original tool name for a fitted one (names that were never changed map to themselves).
 * @param {Record<string, string>} map - `fitted -> original` map from the conversion state.
 * @param {string} name - Name seen on the wire.
 * @returns {string} Original name.
 */
export declare function restoreName(map: Record<string, string>, name: string): string;
