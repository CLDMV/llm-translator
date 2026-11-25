/**
 * Create a conversation (`POST /v1/conversations`) with optional `metadata` and up to 20 initial `items` (messages, function calls and their outputs,
 * reasoning items). A response created with `conversation` reads its items as history and appends its own input and output.
 * @param {{ metadata?: any, items?: any[] | null } | null} [body] - The request body.
 * @returns {Promise<any>} Conversation object `{ id, object: "conversation", created_at, metadata }`.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 400 for bad `metadata`, `items` (not a list, more than 20, an unsupported type) or more items than `maxItems`.
 */
export function create(body?: {
    metadata?: any;
    items?: any[] | null;
} | null): Promise<any>;
