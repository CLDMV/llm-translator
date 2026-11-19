/**
 * Normalize one upstream entry into the runtime endpoint record.
 * @param {string | UpstreamConfig} entry - Upstream URL or config object.
 * @param {number} index - Position in the list.
 * @param {any} [globalSettings] - The config's global `settings`.
 * @returns {any} Runtime endpoint.
 */
export function endpoint(entry: string | UpstreamConfig, index: number, globalSettings?: any): any;
/**
 * Validate and normalize the translator config.
 * @param {any} [config] - Raw config passed to `createTranslator`.
 * @returns {any} Normalized config (a fresh any; the input is not mutated).
 */
export function normalize(config?: any): any;
export type UpstreamConfig = {
    /**
     * Display name, defaults to `upstream-<index>`.
     */
    name?: string;
    /**
     * Base URL of the upstream server (`http://host:8000`).
     */
    url: string;
    /**
     * Key sent to the upstream.
     */
    apiKey?: string;
    /**
     * Extra headers sent to the upstream.
     */
    headers?: Record<string, string>;
    /**
     * Azure OpenAI `api-version`. Set, it selects the classic per-deployment URLs; unset, the v1 API is used.
     */
    apiVersion?: string;
    /**
     * Azure OpenAI deployment name for the classic URLs. Defaults to the request's model.
     */
    deployment?: string;
    /**
     * Which protocol of the server to speak, `"auto"` by default. Canonical ids are `"anthropic.messages"`, `"openai.chat"`, `"openai.responses"` and `"ollama.chat"`; `"messages"`, `"anthropic"` and `"claude"` mean the first, `"chat"`, `"openai"` and `"chatgpt"` the second, `"responses"` and `"codex"` the third and `"native"` and `"ollama"` the last. `"auto"` goes over the client's own protocol when the driver's server speaks it (Chat Completions otherwise) and falls back to the next one when the server answers 404, 405 or 501; an explicit value is always that protocol and never falls back. A protocol the driver does not list fails detection with `unsupported_api`.
     */
    api?: string;
    /**
     * Driver name, or `"auto"` (default) to detect.
     */
    backend?: string;
    /**
     * Models this upstream serves (routing).
     */
    models?: string[];
    /**
     * Marks the fallback upstream.
     */
    default?: boolean;
    /**
     * Settings overrides for this upstream.
     */
    settings?: object;
    /**
     * Server version (skips nothing, but feeds version-mapped driver settings).
     */
    version?: string;
};
