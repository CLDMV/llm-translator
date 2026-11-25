/**
 * Check a `metadata` value: an object of at most 16 string values, keys up to 64 characters and values up to 512.
 * @param {any} value - Value from the client (undefined or null mean none).
 * @returns {Record<string, string>} The metadata.
 * @throws {TranslatorError} 400 `invalid_metadata`.
 */
export function metadataOf(value: any): Record<string, string>;
/**
 * The conversation object of a stored record.
 * @param {any} record - Stored conversation.
 * @returns {{ id: string, object: "conversation", created_at: number, metadata: Record<string, string> }} Conversation object.
 */
export function publicOf(record: any): {
    id: string;
    object: "conversation";
    created_at: number;
    metadata: Record<string, string>;
};
/**
 * The error for an unknown conversation.
 * @param {string} id - The id asked for.
 * @returns {import("./errors.mjs").TranslatorError} 404 `conversation_not_found`.
 */
export function missing(id: string): import("./errors.mjs").TranslatorError;
/**
 * The error for an unknown item of a conversation.
 * @param {string} id - The id asked for.
 * @returns {import("./errors.mjs").TranslatorError} 404 `item_not_found`.
 */
export function missingItem(id: string): import("./errors.mjs").TranslatorError;
