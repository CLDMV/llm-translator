/**
 * The bytes of a stored file. The OpenAI front serves them. The Anthropic front does not: Anthropic only lets a client download files that its tools or skills
 * created, and every file here was uploaded (its `downloadable` is false), so the same request is refused with the same 400.
 * @param {string} id - File id.
 * @param {any} [options] - `{ front }`.
 * @returns {Promise<{ data: Buffer, type: string, filename: string }>} The bytes, the media type and the file name.
 * @throws {TranslatorError} 404 `files_disabled` when `files` is null, 404 `file_not_found`, 400 `not_downloadable` on the Anthropic front.
 */
export function content(id: string, options?: any): Promise<{
    data: Buffer;
    type: string;
    filename: string;
}>;
