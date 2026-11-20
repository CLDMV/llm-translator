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
     * Base URL of the upstream server (`http://host:8000`). Required, except for `backend: "bedrock"`, whose default is `https://bedrock-runtime.<region>.amazonaws.com`.
     */
    url?: string;
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
     * Google Vertex AI settings (see docs/drivers.md). `url` may be left out when `backend` is `"vertex"`: it defaults to the region's host.
     */
    vertex?: {
        project?: string;
        region?: string;
        credentials?: string | object;
        accessToken?: string;
        getToken?: (options: {
            signal?: AbortSignal;
        }) => string | Promise<string>;
        metadataServer?: boolean | string;
    };
    /**
     * Amazon Bedrock: the AWS region SigV4 signs for. Defaults to the region in the URL's host name, then `AWS_REGION`, then `AWS_DEFAULT_REGION`.
     */
    region?: string;
    /**
     * Amazon Bedrock: access key id for SigV4. Defaults to `AWS_ACCESS_KEY_ID`.
     */
    accessKeyId?: string;
    /**
     * Amazon Bedrock: secret access key for SigV4. Defaults to `AWS_SECRET_ACCESS_KEY`.
     */
    secretAccessKey?: string;
    /**
     * Amazon Bedrock: session token of temporary credentials. Defaults to `AWS_SESSION_TOKEN`.
     */
    sessionToken?: string;
    /**
     * Which protocol of the server to speak, `"auto"` by default. Canonical ids are `"anthropic.messages"`, `"openai.chat"`, `"openai.responses"`, `"ollama.chat"` and `"bedrock.converse"`; `"messages"`, `"anthropic"` and `"claude"` mean the first, `"chat"`, `"openai"` and `"chatgpt"` the second, `"responses"` and `"codex"` the third, `"native"` and `"ollama"` the fourth and `"converse"` the last. `"auto"` goes over the client's own protocol when the driver's server speaks it (Chat Completions otherwise) and falls back to the next one when the server answers 404, 405 or 501; an explicit value is always that protocol and never falls back. A protocol the driver does not list fails detection with `unsupported_api`.
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
