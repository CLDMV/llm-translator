/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/documents.mjs
 *	@Date: 2026-10-25T12:28:19-07:00 (1792956499)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:01-07:00 (1792958341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
export type DocumentContext = {
    /**
     * - Resolved settings.
     */
    settings: import("./settings.mjs").Settings;
    /**
     * - `tool_use` inputs by id, to recover file paths.
     */
    toolInputs: Map<string, any>;
    /**
     * - Id of the tool call whose result contains the document, if any.
     */
    toolUseId: string | null;
};
/**
 * Context for converting documents.
 * @typedef {object} DocumentContext
 * @property {import("./settings.mjs").Settings} settings - Resolved settings.
 * @property {Map<string, any>} toolInputs - `tool_use` inputs by id, to recover file paths.
 * @property {string|null} toolUseId - Id of the tool call whose result contains the document, if any.
 */
/**
 * Convert a document block into Anthropic text/image blocks.
 * @param {any} block - Anthropic `document` block.
 * @param {DocumentContext} ctx - Conversion context.
 * @returns {Promise<any[]>} Content blocks (`text` and `image`).
 * @throws {TranslatorError} When `documents` is `"error"` or a PDF violates the size/page limits.
 */
export declare function expand(block: any, ctx: DocumentContext): Promise<any[]>;
