/**
 * Does a model id name a Claude model, which InvokeModel serves with the Anthropic Messages body? An application inference profile is an
 * opaque id and so counts as not Claude (Converse serves Claude too); set the upstream's `api` for it.
 * @param {string | undefined} model - Model id, inference profile id or ARN.
 * @returns {boolean} True for a Claude id.
 */
export function claude(model: string | undefined): boolean;
/**
 * The region a runtime host name belongs to.
 * @param {string} host - Host name.
 * @returns {string | null} The region, or null when the host is not a Bedrock runtime host.
 */
export function regionOfHost(host: string): string | null;
/**
 * The region of an upstream: its `region`, else the one in its URL's host name, else `AWS_REGION`, else `AWS_DEFAULT_REGION`.
 * @param {{region?: string, url?: string}} endpoint - Runtime endpoint (or raw upstream config).
 * @param {Record<string, string | undefined>} [env] - Environment (default `process.env`).
 * @returns {string | null} The region, or null when none is set.
 */
export function regionOf(endpoint: {
    region?: string;
    url?: string;
}, env?: Record<string, string | undefined>): string | null;
/**
 * The default base URL of a region: `https://bedrock-runtime.<region>.amazonaws.com` (`.amazonaws.com.cn` in the China regions).
 * @param {{region?: string}} raw - Raw upstream config without a `url`.
 * @param {Record<string, string | undefined>} [env] - Environment (default `process.env`).
 * @returns {string} Base URL.
 * @throws {TranslatorError} `INVALID_CONFIG` when no region is configured.
 */
export function defaultUrl(raw: {
    region?: string;
}, env?: Record<string, string | undefined>): string;
/**
 * The URL path segment of a model: the id percent-encoded as one segment, because ids and ARNs contain `:` and `/`.
 * @param {string} model - Model id, inference profile id or ARN.
 * @returns {string} Path starting with `/model/`.
 */
export function modelPath(model: string): string;
/**
 * How an upstream authenticates, most specific first: the upstream's `apiKey` (a Bedrock API key, sent as a bearer token), its access keys
 * (SigV4), then the environment's `AWS_BEARER_TOKEN_BEDROCK` and `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`.
 * @param {any} endpoint - Runtime endpoint (`apiKey`, `accessKeyId`, `secretAccessKey`, `sessionToken`).
 * @param {Record<string, string | undefined>} [env] - Environment (default `process.env`).
 * @returns {{bearer: string} | {keys: {accessKeyId: string, secretAccessKey: string, sessionToken?: string}} | null} The credential, or null when there is none.
 */
export function credential(endpoint: any, env?: Record<string, string | undefined>): {
    bearer: string;
} | {
    keys: {
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken?: string;
    };
} | null;
/**
 * The headers of an authenticated call: the given ones with `authorization` set. A Bedrock API key gives `Bearer <key>`. Otherwise the call is
 * signed with SigV4 for the service `bedrock` in the upstream's region, which adds `x-amz-date`, `x-amz-security-token` (temporary
 * credentials) and `authorization`; the body must be the exact text that is sent.
 * @param {any} endpoint - Runtime endpoint.
 * @param {{method: string, url: string, headers: Record<string, string>, body: string}} request - The call.
 * @param {{env?: Record<string, string | undefined>, date?: Date}} [options] - `env` is the environment (default `process.env`), `date` the signing time (default now).
 * @returns {Record<string, string>} Headers to send.
 * @throws {TranslatorError} `missing_credentials` (500) when the upstream has no credential, `missing_region` (500) when SigV4 needs a region and there is none.
 */
export function authenticate(endpoint: any, request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
}, { env, date }?: {
    env?: Record<string, string | undefined>;
    date?: Date;
}): Record<string, string>;
