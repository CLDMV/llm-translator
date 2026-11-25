/**
 * Check the `batches` setting. `null` turns both Batch APIs off.
 * @param {any} value - The setting after the layers were merged.
 * @returns {null | BatchesSetting} The setting.
 * @throws {TranslatorError} `invalid_setting` for anything that is not `null` or an object of the documented fields.
 */
export function normalize(value: any): null | BatchesSetting;
/**
 * Make a batch id.
 * @param {"anthropic" | "openai"} front - The client protocol the batch is created through; it decides the prefix (`msgbatch_` or `batch_`).
 * @returns {string} Id.
 */
export function newId(front: "anthropic" | "openai"): string;
/**
 * Create a store. Ids are checked against `ID` before they reach the backend, so a directory store never builds a path from client text. A batch that is
 * still being processed lives in this process, so the store hands out that very object (its counts and states are current); the backend holds the
 * last saved copy.
 * @param {BatchesSetting} options - The `batches` setting.
 * @param {() => number} [now] - Clock in ms.
 * @returns {{ add: Function, get: Function, list: Function, save: Function, remove: Function, orphans: Function }} Store.
 */
export function create(options: BatchesSetting, now?: () => number): {
    add: Function;
    get: Function;
    list: Function;
    save: Function;
    remove: Function;
    orphans: Function;
};
/**
 * The `batches` setting.
 * @typedef {{ store: "memory" | "disk", dir: string | null, concurrency: number, maxRequests: number, maxCount: number, window: number, ttl: number }} BatchesSetting
 */
/** Defaults of the `batches` setting: a day to finish (both APIs' completion window), 29 days of retention (Anthropic's). */
export const DEFAULTS: Readonly<BatchesSetting>;
/** What a batch id looks like: OpenAI's `batch_...` and Anthropic's `msgbatch_...`. */
export const ID: RegExp;
/** The states a batch does not leave (OpenAI's names; Anthropic's `ended` covers all four). */
export const TERMINAL: readonly string[];
/**
 * The `batches` setting.
 */
export type BatchesSetting = {
    store: "memory" | "disk";
    dir: string | null;
    concurrency: number;
    maxRequests: number;
    maxCount: number;
    window: number;
    ttl: number;
};
