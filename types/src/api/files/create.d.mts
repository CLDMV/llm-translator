/**
 * Store an uploaded file and return its file object in the client protocol's shape (Anthropic `{ type: "file", ... }` or OpenAI `{ object: "file", ... }`).
 * The id starts with `file_` for the Anthropic front and `file-` for the OpenAI front; either front can use any stored file. Limits come from the `files`
 * setting. Anthropic's form has `file` and an optional `expires_in_seconds`; OpenAI's has `file`, a `purpose` (required) and an optional
 * `expires_after[anchor]` / `expires_after[seconds]`. A file's lifetime is the shorter of its own and the `ttl` setting.
 * @param {{ filename: string, data: Buffer, type?: string, fields?: Record<string, string> }} upload - The file part and the form's text fields.
 * @param {any} [options] - `{ front, beta }`; `beta` selects Anthropic's `files-api-2025-04-14` shape (no `expires_at`).
 * @returns {Promise<any>} File object.
 * @throws {TranslatorError} 404 `files_disabled` when `files` is null; 400 for a bad name, purpose or expiry; 413 `file_too_large`; 400 `storage_limit_exceeded`.
 */
export function create(upload: {
    filename: string;
    data: Buffer;
    type?: string;
    fields?: Record<string, string>;
}, options?: any): Promise<any>;
