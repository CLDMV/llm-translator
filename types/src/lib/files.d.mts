/**
 * The translator's file store, made on first use from the `files` setting (the global one; an upstream's own `settings` do not apply to a store the
 * fronts share).
 * @param {any} config - Translator config.
 * @param {any} state - Translator state (holds the store).
 * @returns {ReturnType<typeof create> | null} The store, or null when `files` is null (the Files API is off).
 */
export function storeOf(config: any, state: any): ReturnType<typeof create> | null;
/**
 * Whether a request's `anthropic-beta` header names the Files API beta.
 * @param {string | string[] | undefined} header - Header value.
 * @returns {boolean} True when `files-api-2025-04-14` is listed.
 */
export function beta(header: string | string[] | undefined): boolean;
/**
 * The media type of an uploaded file: the type the part declared, or one guessed from the file name.
 * @param {string | undefined} declared - The part's `content-type`.
 * @param {string} filename - File name.
 * @returns {string} Media type.
 */
export function mimeOf(declared: string | undefined, filename: string): string;
/**
 * The error for an unknown file, worded like the front's own.
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @param {string} id - The id asked for.
 * @returns {TranslatorError} 404 `file_not_found`.
 */
export function missing(front: "anthropic" | "openai", id: string): TranslatorError;
/**
 * Check an upload's file name (Anthropic's rule: 1 to 255 characters, none of `< > : " | ? * \ /` or a control character).
 * @param {any} filename - File name.
 * @returns {string} The name.
 * @throws {TranslatorError} 400 `invalid_filename`.
 */
export function filenameOf(filename: any): string;
/**
 * The lifetime an upload asks for, in seconds. Anthropic's field is `expires_in_seconds` (3600 to 7776000); OpenAI's is `expires_after` with
 * `anchor: "created_at"` and `seconds` (3600 to 2592000).
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @param {Record<string, string>} fields - The form's text fields.
 * @returns {number | undefined} Seconds, or undefined when the upload does not ask for one.
 * @throws {TranslatorError} 400 `invalid_expiry`.
 */
export function expiryOf(front: "anthropic" | "openai", fields: Record<string, string>): number | undefined;
/**
 * Anthropic's file object. The beta shape (`files-api-2025-04-14`) has no `expires_at`.
 * @param {any} meta - Stored metadata.
 * @param {boolean} [legacy] - The beta shape.
 * @returns {any} File object.
 */
export function anthropicFile(meta: any, legacy?: boolean): any;
/**
 * OpenAI's file object.
 * @param {any} meta - Stored metadata.
 * @returns {any} File object.
 */
export function openaiFile(meta: any): any;
/**
 * Anthropic's file list, newest first. The current shape pages with an opaque `page` cursor and answers `{ data, next_page }`; up to 100 `ids`
 * look files up directly (never together with `page` or `limit`) and leave out the ones that do not exist. The beta shape pages with `before_id`
 * and `after_id` and answers `{ data, has_more, first_id, last_id }`.
 * @param {any[]} metas - Stored metadata, newest first.
 * @param {{ limit?: any, page?: string, before_id?: string, after_id?: string, ids?: string[] }} query - Query parameters.
 * @param {boolean} legacy - The beta shape.
 * @returns {any} List.
 * @throws {TranslatorError} 400 for a bad `limit`, combined parameters or a cursor the shape does not take.
 */
export function anthropicList(metas: any[], query: {
    limit?: any;
    page?: string;
    before_id?: string;
    after_id?: string;
    ids?: string[];
}, legacy: boolean): any;
/**
 * OpenAI's file list (`purpose`, `limit` up to 10000, `after`, `order`).
 * @param {any[]} metas - Stored metadata, newest first.
 * @param {{ purpose?: string, limit?: any, after?: string, order?: string }} query - Query parameters.
 * @returns {any} List.
 * @throws {TranslatorError} 400 for a bad `limit`, `order` or `after`.
 */
export function openaiList(metas: any[], query: {
    purpose?: string;
    limit?: any;
    after?: string;
    order?: string;
}): any;
/**
 * Resolve file references in a request into base64 content, before conversion: Anthropic `image` and `document` blocks with a `{ type: "file", file_id }`
 * source (also inside tool results), and OpenAI `file` parts with a `file_id` and `image_url` parts whose url is a stored file id.
 * An id the store holds always becomes content: the upstream does not have the file. An id it does not hold is the front's `file_not_found` (404) when
 * `strict`, and is left as it is otherwise (a request forwarded as it is may name files of the upstream's own).
 * @param {any} body - Client request body.
 * @param {{ front: "anthropic" | "openai", store: { get: (id: string) => Promise<any> } | null, strict: boolean }} options - Front, store (null when the Files API is off: nothing to resolve), and whether unknown ids are an error.
 * @returns {Promise<any>} The body; the same object when nothing was resolved.
 * @throws {TranslatorError} `file_not_found` (404), or 400 `invalid_file_type` when a file is not what its block needs.
 */
export function resolve(body: any, { front, store, strict }: {
    front: "anthropic" | "openai";
    store: {
        get: (id: string) => Promise<any>;
    } | null;
    strict: boolean;
}): Promise<any>;
/** The `anthropic-beta` value that selects the beta shapes of the Files API (cursor pagination, no `expires_at`). */
export const BETA: "files-api-2025-04-14";
/** The purposes OpenAI accepts on upload. */
export const PURPOSES: readonly string[];
import { create } from "./filestore.mjs";
import { TranslatorError } from "./errors.mjs";
