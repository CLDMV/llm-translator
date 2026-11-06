/**
 * @typedef {object} TranslatorConfig
 * @property {"anthropic" | "openai"} [front] Client protocol the translator speaks (default `"anthropic"`).
 * @property {Array<string | import("./lib/config.mjs").UpstreamConfig>} upstreams Upstream servers: `{ name, url, apiKey, headers, backend, models, default, settings, version }` (or a bare URL).
 * @property {Record<string, string | {model: string, effort?: "minimal"|"low"|"medium"|"high"|"xhigh"|"max", thinking?: boolean}>} [aliases] Client model name to upstream model name, or to `{ model, effort, thinking }` to pin those settings over the request's.
 * @property {Record<string, string[] | {levels: string[], default?: string | null}>} [efforts] Reasoning effort levels each model supports, keyed by model name after aliases (see docs/settings.md).
 * @property {import("./lib/pool.mjs").PoolConfig} [pool] Endpoint pools: `{ strategy, backoff: { base, max }, models }` (see docs/settings.md).
 * @property {Record<string, any>} [settings] Global converter settings (see `lib/settings.mjs`).
 * @property {boolean} [detect] Probe `auto` upstreams at startup (default true).
 * @property {number} [detectTimeout] Probe timeout in ms (default 5000).
 * @property {(url: string, init?: any) => Promise<Response>} [transport] fetch-compatible function used for all upstream calls.
 * @property {boolean | string} [logs] Logging (default `false`: no console output, no file). `true` prints warnings and errors on the console, once per message; a path appends every event as a JSON line to that file (relative paths resolve against `process.cwd()`, a missing directory is created, a file that cannot be opened is reported once on the console and logging stays off).
 * @property {boolean} [events] Emit events (default `true`); `false` turns emitting off. Logging does not depend on it.
 * @property {(event: import("./lib/events.mjs").TranslatorEvent) => any} [onEvent] Callback for every event, registered before startup so it also sees startup events (see docs/events.md).
 * @property {boolean} [silent] Deprecated alias for `logs: false` (the default); `logs` wins when both are given.
 * @property {{import?: (url: string) => Promise<any>}} [slothlet] Options forwarded to slothlet (for example `import` for coverage).
 */
/**
 * Create a translator: a slothlet api instance (see the README for the leaves) bound to the given upstreams.
 * Endpoints with `backend: "auto"` are probed once before this resolves (set `detect: false` to skip all network access).
 * @param {TranslatorConfig} config - Translator config.
 * @returns {Promise<any>} The translator api (`request`, `response`, `stream`, `send`, `detect`, `status`, `token`, `model`, `error`, `events`, `sse`, `server`, `driver`, `convert`, `slothlet`).
 */
export function createTranslator(config: TranslatorConfig): Promise<any>;
export { TranslatorError } from "./lib/errors.mjs";
export default createTranslator;
export type TranslatorConfig = {
    /**
     * Client protocol the translator speaks (default `"anthropic"`).
     */
    front?: "anthropic" | "openai";
    /**
     * Upstream servers: `{ name, url, apiKey, headers, backend, models, default, settings, version }` (or a bare URL).
     */
    upstreams: Array<string | import("./lib/config.mjs").UpstreamConfig>;
    /**
     * Client model name to upstream model name, or to `{ model, effort, thinking }` to pin those settings over the request's.
     */
    aliases?: Record<string, string | {
        model: string;
        effort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
        thinking?: boolean;
    }>;
    /**
     * Reasoning effort levels each model supports, keyed by model name after aliases (see docs/settings.md).
     */
    efforts?: Record<string, string[] | {
        levels: string[];
        default?: string | null;
    }>;
    /**
     * Endpoint pools: `{ strategy, backoff: { base, max }, models }` (see docs/settings.md).
     */
    pool?: import("./lib/pool.mjs").PoolConfig;
    /**
     * Global converter settings (see `lib/settings.mjs`).
     */
    settings?: Record<string, any>;
    /**
     * Probe `auto` upstreams at startup (default true).
     */
    detect?: boolean;
    /**
     * Probe timeout in ms (default 5000).
     */
    detectTimeout?: number;
    /**
     * fetch-compatible function used for all upstream calls.
     */
    transport?: (url: string, init?: any) => Promise<Response>;
    /**
     * Logging (default `false`: no console output, no file). `true` prints warnings and errors on the console, once per message; a path appends every event as a JSON line to that file (relative paths resolve against `process.cwd()`, a missing directory is created, a file that cannot be opened is reported once on the console and logging stays off).
     */
    logs?: boolean | string;
    /**
     * Emit events (default `true`); `false` turns emitting off. Logging does not depend on it.
     */
    events?: boolean;
    /**
     * Callback for every event, registered before startup so it also sees startup events (see docs/events.md).
     */
    onEvent?: (event: import("./lib/events.mjs").TranslatorEvent) => any;
    /**
     * Deprecated alias for `logs: false` (the default); `logs` wins when both are given.
     */
    silent?: boolean;
    /**
     * Options forwarded to slothlet (for example `import` for coverage).
     */
    slothlet?: {
        import?: (url: string) => Promise<any>;
    };
};
