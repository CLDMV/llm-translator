/**
 * Drop tool fields when there are no tools, send `seed` as `random_seed` and `tool_choice: "required"` as `"any"` (Mistral's spelling).
 * @param {any} body - Chat Completions request body.
 * @returns {any} Normalized body.
 */
export function request(body: any): any;
