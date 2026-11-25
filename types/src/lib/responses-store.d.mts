/**
 * Check the `responses` setting. `null` turns the stateful Responses API off.
 * @param {any} value - The setting after the layers were merged.
 * @returns {null | ResponsesSetting} The setting.
 * @throws {TranslatorError} `invalid_setting` for anything that is not `null` or an object of the documented fields.
 */
export function normalize(value: any): null | ResponsesSetting;
/**
 * Create a store.
 * @param {ResponsesSetting} options - The `responses` setting.
 * @param {() => number} [now] - Clock in ms.
 * @returns {{ get: Function, all: Function, put: Function, update: Function, remove: Function }} Store.
 */
export function create(options: ResponsesSetting, now?: () => number): {
    get: Function;
    all: Function;
    put: Function;
    update: Function;
    remove: Function;
};
/**
 * The `responses` setting.
 * @typedef {{ store: "memory" | "disk" | { scan: Function, read: Function, write: Function, erase: Function }, dir: string | null, maxCount: number, maxTotalBytes: number, ttl: number, maxConversations: number, maxItems: number, prompts: Record<string, any> }} ResponsesSetting
 */
/** Defaults of the `responses` setting. */
export const DEFAULTS: Readonly<ResponsesSetting>;
/** The record kinds and the id shape of each (the id is checked before it reaches a backend, so a directory store never builds a path from client text). */
export const IDS: Readonly<{
    response: RegExp;
    conversation: RegExp;
}>;
/**
 * The `responses` setting.
 */
export type ResponsesSetting = {
    store: "memory" | "disk" | {
        scan: Function;
        read: Function;
        write: Function;
        erase: Function;
    };
    dir: string | null;
    maxCount: number;
    maxTotalBytes: number;
    ttl: number;
    maxConversations: number;
    maxItems: number;
    prompts: Record<string, any>;
};
