/**
 * Encode `{ event?, data, id? }` (object data is JSON-encoded, `"[DONE]"` is written as is) or a keep-alive comment
 * `{ comment }` as an SSE frame.
 * @param {{event?: string, data?: any, id?: string, comment?: string}} message - Event to encode.
 * @returns {string} SSE text ending with a blank line.
 */
export function encode(message: {
    event?: string;
    data?: any;
    id?: string;
    comment?: string;
}): string;
