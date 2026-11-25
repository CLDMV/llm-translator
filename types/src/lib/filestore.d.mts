/**
 * Check the `files` setting. `null` turns the Files API off.
 * @param {any} value - The setting after the layers were merged.
 * @returns {null | FilesSetting} The setting.
 * @throws {TranslatorError} `invalid_setting` for anything that is not `null` or an object of the documented fields.
 */
export function normalize(value: any): null | FilesSetting;
/**
 * Make a file id.
 * @param {"anthropic" | "openai"} front - The client protocol the file is uploaded through; it decides the prefix (`file_` or `file-`).
 * @returns {string} Id.
 */
export function newId(front: "anthropic" | "openai"): string;
/**
 * Create a store. Ids are checked against `ID` before they reach the backend, so a directory store never builds a path from client text.
 * @param {FilesSetting} options - The `files` setting.
 * @param {() => number} [now] - Clock in ms.
 * @returns {{ put: Function, get: Function, head: Function, list: Function, remove: Function }} Store.
 */
export function create(options: FilesSetting, now?: () => number): {
    put: Function;
    get: Function;
    head: Function;
    list: Function;
    remove: Function;
};
/**
 * The `files` setting.
 * @typedef {{ store: "memory" | "disk", dir: string | null, maxFileSize: number, maxTotalBytes: number, maxCount: number, ttl: number }} FilesSetting
 */
/** Defaults of the `files` setting. */
export const DEFAULTS: Readonly<FilesSetting>;
/** What a file id looks like: Anthropic's `file_...` and OpenAI's `file-...`, hex or base62 after the prefix. */
export const ID: RegExp;
/**
 * The `files` setting.
 */
export type FilesSetting = {
    store: "memory" | "disk";
    dir: string | null;
    maxFileSize: number;
    maxTotalBytes: number;
    maxCount: number;
    ttl: number;
};
