/**
 * Forget every cached token and credential file (used by tests).
 * @returns {void}
 */
export function reset(): void;
/**
 * Base64url without padding.
 * @param {string | Buffer} input - Data.
 * @returns {string} Encoded text.
 */
export function base64url(input: string | Buffer): string;
/**
 * Build the signed JWT a service account exchanges for an access token (RS256, `node:crypto`).
 * @param {{client_email: string, private_key: string, private_key_id?: string, token_uri?: string}} credentials - A service-account key.
 * @param {{now?: number, scope?: string}} [options] - `now` in ms (default the clock) and the OAuth scope.
 * @returns {string} `header.claims.signature`.
 */
export function assertion(credentials: {
    client_email: string;
    private_key: string;
    private_key_id?: string;
    token_uri?: string;
}, { now, scope }?: {
    now?: number;
    scope?: string;
}): string;
/**
 * The path of gcloud's application default credentials file (`gcloud auth application-default login`).
 * @param {Record<string, string | undefined>} env - Environment.
 * @param {string} [platform] - `process.platform`.
 * @returns {string} Path.
 */
export function wellKnown(env: Record<string, string | undefined>, platform?: string): string;
/**
 * The credentials the settings and environment name, without any network access: the `credentials` setting, then `GOOGLE_APPLICATION_CREDENTIALS`,
 * then gcloud's application default credentials file when it exists.
 * @param {any} settings - The upstream's `vertex` settings.
 * @param {Record<string, string | undefined>} [env] - Environment.
 * @returns {any | null} Credentials, or null when none are configured.
 */
export function credentials(settings: any, env?: Record<string, string | undefined>): any | null;
/**
 * Find an access token for Vertex AI. Sources, in order: the `getToken` callback (called on every request, it caches for itself), the `accessToken`
 * setting, the upstream's `apiKey` (as a bearer token), the `credentials` setting, `GOOGLE_ACCESS_TOKEN`, `GOOGLE_APPLICATION_CREDENTIALS`, gcloud's
 * application default credentials file, and last the metadata server when `metadataServer` is set. Tokens fetched from Google are cached until a
 * minute before they expire, and concurrent callers share one refresh.
 * @param {any} spec - `{ settings, apiKey, transport, timeout, signal, env, now }`. `settings` is the upstream's `vertex` object; `transport` is the
 * `fetch`-compatible function the token requests go through.
 * @returns {Promise<string>} Access token.
 * @throws {TranslatorError} With code `upstream_auth` when there is no source or Google refuses.
 */
export function token({ settings, apiKey, transport, timeout, signal, env, now }: any): Promise<string>;
/** The OAuth scope Vertex AI needs. */
export const SCOPE: "https://www.googleapis.com/auth/cloud-platform";
/** Where Google's token endpoint is, for credentials that do not name one. */
export const TOKEN_URI: "https://oauth2.googleapis.com/token";
/** Base URL of the GCE metadata server, used when `metadataServer` is `true`. */
export const METADATA_URL: "http://metadata.google.internal";
