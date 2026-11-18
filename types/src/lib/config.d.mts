/**
 * Normalize one upstream entry into the runtime endpoint record.
 * @param {string | UpstreamConfig} entry - Upstream URL or config object.
 * @param {number} index - Position in the list.
 * @returns {any} Runtime endpoint.
 */
export function endpoint(entry: string | UpstreamConfig, index: number): any;
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
     * Which API of the server to use: `"openai"` (default) is the OpenAI-compatible Chat Completions one, `"responses"` the Responses API (`/v1/responses`, for a driver that declares `info().responses`), `"auto"` the Responses API first on a driver that declares it, falling back to Chat Completions when the server answers 404, 405 or 501 to it (and Chat Completions on a driver that does not), and `"native"` the server's own chat API, for a driver that has one (Ollama's `/api/chat`).
     */
    api?: "openai" | "responses" | "auto" | "native";
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
