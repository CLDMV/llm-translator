/**
 * Load the PDF libraries. Safe to call repeatedly; each call re-imports. A library that fails to load is reported
 * in the result instead of throwing, so the translator can degrade (text only, or a note).
 * @param {(name: string) => Promise<any>} [importer] - Module importer (overridable for tests).
 * @returns {Promise<{ unpdf: boolean, canvas: boolean, errors: { unpdf?: string, canvas?: string } }>} Load result.
 */
export function load(importer?: (name: string) => Promise<any>): Promise<{
    unpdf: boolean;
    canvas: boolean;
    errors: {
        unpdf?: string;
        canvas?: string;
    };
}>;
/**
 * Which libraries are currently loaded.
 * @returns {{ unpdf: boolean, canvas: boolean }} Availability.
 */
export function available(): {
    unpdf: boolean;
    canvas: boolean;
};
/**
 * Extract the text of every page.
 * @param {Uint8Array} bytes - PDF bytes.
 * @param {{ maxPages: number, maxBytes: number }} limits - Limits (Anthropic: 100 pages, 32 MB).
 * @returns {Promise<{ pageCount: number, title: string|null, pages: string[] }>} Page texts and the document title.
 * @throws {TranslatorError} `pdf_too_large`, `pdf_too_many_pages`, `pdf_unreadable` or `pdf_unavailable`.
 */
export function extract(bytes: Uint8Array, limits: {
    maxPages: number;
    maxBytes: number;
}): Promise<{
    pageCount: number;
    title: string | null;
    pages: string[];
}>;
/**
 * Render pages to PNG images.
 * @param {Uint8Array} bytes - PDF bytes.
 * @param {number[]} pageNumbers - 1-based page numbers.
 * @param {{ maxPages: number, maxBytes: number, scale: number }} options - Limits and render scale.
 * @returns {Promise<{ media_type: "image/png", data: string }[]>} Base64 PNGs in page order.
 * @throws {TranslatorError} `pdf_unavailable` when @napi-rs/canvas is not loaded.
 */
export function render(bytes: Uint8Array, pageNumbers: number[], options: {
    maxPages: number;
    maxBytes: number;
    scale: number;
}): Promise<{
    media_type: "image/png";
    data: string;
}[]>;
