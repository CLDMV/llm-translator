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
export function expand(block: any, ctx: DocumentContext): Promise<any[]>;
/**
 * Context for converting documents.
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
