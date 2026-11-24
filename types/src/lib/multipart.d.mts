/**
 * Parse a `multipart/form-data` body.
 * @param {Buffer} body - The body.
 * @param {string | undefined} contentType - The request's `content-type` header, which names the boundary.
 * @returns {{ fields: Record<string, string>, files: { name: string, filename: string, type: string | undefined, data: Buffer }[] }} Text fields by name and file parts in order.
 * @throws {TranslatorError} 400 `invalid_multipart` when there is no boundary or the body is not well formed.
 */
export function parse(body: Buffer, contentType: string | undefined): {
    fields: Record<string, string>;
    files: {
        name: string;
        filename: string;
        type: string | undefined;
        data: Buffer;
    }[];
};
