/**
 * Forget every cached credential (used by tests).
 * @returns {void}
 */
export function reset(): void;
/**
 * Parse an AWS shared config or credentials file: `[section]` headers and `key = value` lines. `#` and `;` start a comment line, and an indented
 * line (a nested setting such as `s3 =` blocks) belongs to the key above it and is left out. A `[profile name]` header names the profile `name`
 * (`[default]` is `default`), and in the credentials file the header is the name itself.
 * @param {string} text - File contents.
 * @param {boolean} config - True for the config file, where profile headers say `profile `.
 * @returns {{ profiles: Map<string, Record<string, string>>, sessions: Map<string, Record<string, string>> }} Profiles and `sso-session` sections by name.
 */
export function parseIni(text: string, config: boolean): {
    profiles: Map<string, Record<string, string>>;
    sessions: Map<string, Record<string, string>>;
};
/**
 * Read the shared config and credentials files (`AWS_CONFIG_FILE` and `AWS_SHARED_CREDENTIALS_FILE`, else `~/.aws/config` and
 * `~/.aws/credentials`). A file that does not exist is empty; for a profile in both, a key of the credentials file wins.
 * @param {Record<string, string | undefined>} env - Environment.
 * @returns {{ profiles: Map<string, Record<string, string>>, sessions: Map<string, Record<string, string>> }} Profiles and SSO sessions.
 */
export function load(env: Record<string, string | undefined>): {
    profiles: Map<string, Record<string, string>>;
    sessions: Map<string, Record<string, string>>;
};
/**
 * Split a command line into words the way a shell would for the common cases: whitespace separates, single and double quotes group, a backslash
 * escapes inside double quotes and outside quotes.
 * @param {string} command - Command line (`credential_process` value).
 * @returns {string[]} Words.
 */
export function words(command: string): string[];
/**
 * Find AWS credentials the way the AWS SDKs do after explicit keys and the key environment variables: the profile named by `profile` or
 * `AWS_PROFILE` (else `default`) in the shared files, which may hold access keys, a `credential_process`, an SSO login, a role to assume or a web
 * identity; then the web identity of the environment; then the ECS task role; then the EC2 instance profile. Credentials with an expiry are cached until five minutes before it (credentials without one for a
 * minute), and callers that arrive during a lookup share it. A failed lookup is not cached.
 * @param {{ profile?: string, env?: Record<string, string | undefined>, transport: Function, timeout?: number, signal?: AbortSignal, now?: () => number, run?: Function }} spec - `profile` is the upstream's `profile` setting; `transport` is the `fetch`-compatible function the requests go through; `run` is `execFile` (replaced in tests).
 * @returns {Promise<{keys: {accessKeyId: string, secretAccessKey: string, sessionToken?: string}, region?: string} | null>} The credentials and the region the profile names, or null when the chain has none.
 * @throws {TranslatorError} `upstream_auth` when a source that is configured fails (a named profile that is missing, a failing process, an expired SSO login, a refusing endpoint).
 */
export function chained({ profile, env, transport, timeout, signal, now, run }: {
    profile?: string;
    env?: Record<string, string | undefined>;
    transport: Function;
    timeout?: number;
    signal?: AbortSignal;
    now?: () => number;
    run?: Function;
}): Promise<{
    keys: {
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken?: string;
    };
    region?: string;
} | null>;
