/**
 * Describe the Vertex AI driver. The paths come from the `path` leaf, because they hold the project, the region and the model; the key (a Google
 * access token) is added as a bearer token by the `auth` leaf. Vertex AI takes no `anthropic-version` header (the version is in the body). Claude goes over
 * `anthropic.messages` (`rawPredict`); Google-published Gemini models go over `google.gemini` (`generateContent`), chosen by the model id under
 * `api: "auto"` (see `lib/capture`) or by an explicit `api`.
 * @returns {{name: string, protocol: string, protocols: string[], order: number, auth: string, strict: boolean, hosts: string[], hostSuffixes: string[], paths: Record<string,string>}} Driver facts.
 */
export function info(): {
    name: string;
    protocol: string;
    protocols: string[];
    order: number;
    auth: string;
    strict: boolean;
    hosts: string[];
    hostSuffixes: string[];
    paths: Record<string, string>;
};
