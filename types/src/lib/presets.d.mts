/**
 * The driver facts of a preset.
 * @param {string} name - Preset name.
 * @returns {{name: string, protocol: string, order: number, auth: string, strict: boolean, fields?: string[], paths: Record<string,string>}} Driver facts.
 */
export function describe(name: string): {
    name: string;
    protocol: string;
    order: number;
    auth: string;
    strict: boolean;
    fields?: string[];
    paths: Record<string, string>;
};
/**
 * Match an endpoint by host name, no network access.
 * @param {string} name - Preset name.
 * @param {any} endpoint - Runtime endpoint.
 * @returns {{host: string} | null} Facts, or null when the host is not the provider's.
 */
export function match(name: string, endpoint: any): {
    host: string;
} | null;
/**
 * The settings of a preset (a copy).
 * @param {string} name - Preset name.
 * @returns {any} Partial settings.
 */
export function settingsOf(name: string): any;
/**
 * Put the provider's path root in front of a call path unless the upstream URL already ends in it, so `https://api.groq.com`,
 * `https://api.groq.com/openai` and `https://api.groq.com/openai/v1` (the config removes the `/v1`) all reach the same URL.
 * @param {string} name - Preset name.
 * @param {"chat" | "embeddings" | "models"} kind - Which call.
 * @param {any} endpoint - Runtime endpoint.
 * @returns {string} Path starting with `/`.
 */
export function route(name: string, kind: "chat" | "embeddings" | "models", endpoint: any): string;
/**
 * Normalize a Chat Completions body for a preset: drop empty tool fields and the fields the provider rejects (each recorded in `state.dropped`).
 * @param {string} name - Preset name.
 * @param {any} body - Chat Completions request body.
 * @param {any} [context] - `{ state }`.
 * @returns {any} Normalized body.
 */
export function trim(name: string, body: any, context?: any): any;
/**
 * @typedef {object} Preset
 * @property {number} order - Detection order (host drivers sit ahead of the probing ones).
 * @property {string[]} hosts - Host names the provider answers on.
 * @property {string} [root] - Path in front of the call paths (`/openai`), added unless the upstream URL already ends in it.
 * @property {Record<string, string>} paths - Call paths under the root.
 * @property {any} settings - Translator settings of the provider.
 * @property {string[]} [fields] - Extra request fields the OpenAI front's `passthroughFilter` lets through (`info().fields`).
 * @property {string[]} [drop] - Request fields the provider rejects.
 * @property {(body: any) => string[]} [dropWhen] - Fields the provider rejects for this request (by model).
 * @property {boolean} [dropName] - Remove `name` from messages.
 */
/** @type {Readonly<Record<string, Preset>>} */
export const PRESETS: Readonly<Record<string, Preset>>;
export type Preset = {
    /**
     * - Detection order (host drivers sit ahead of the probing ones).
     */
    order: number;
    /**
     * - Host names the provider answers on.
     */
    hosts: string[];
    /**
     * - Path in front of the call paths (`/openai`), added unless the upstream URL already ends in it.
     */
    root?: string;
    /**
     * - Call paths under the root.
     */
    paths: Record<string, string>;
    /**
     * - Translator settings of the provider.
     */
    settings: any;
    /**
     * - Extra request fields the OpenAI front's `passthroughFilter` lets through (`info().fields`).
     */
    fields?: string[];
    /**
     * - Request fields the provider rejects.
     */
    drop?: string[];
    /**
     * - Fields the provider rejects for this request (by model).
     */
    dropWhen?: (body: any) => string[];
    /**
     * - Remove `name` from messages.
     */
    dropName?: boolean;
};
