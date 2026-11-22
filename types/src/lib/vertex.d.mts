/**
 * The API host of a region: `<region>-aiplatform.googleapis.com`, `aiplatform.googleapis.com` for `global`, and `aiplatform.<us|eu>.rep.googleapis.com`
 * for the multi-region endpoints.
 * @param {string} region - Region such as `us-east5`, `europe-west1`, `global`, `us` or `eu`.
 * @returns {string} Host name.
 */
export function host(region: string): string;
/**
 * The region a Vertex AI host serves.
 * @param {string} url - Upstream base URL.
 * @returns {string | undefined} The region, `"global"` for the global host, `"us"` or `"eu"` for a multi-region host, undefined for any other host.
 */
export function regionOf(url: string): string | undefined;
/**
 * The region of an upstream: the `region` setting, else the region in a Vertex AI base URL, else `CLOUD_ML_REGION`.
 * @param {any} endpoint - Runtime endpoint (`url`, `vertex`).
 * @param {Record<string, string | undefined>} [env] - Environment.
 * @returns {string | undefined} Region, or undefined when none is set.
 */
export function regionFor(endpoint: any, env?: Record<string, string | undefined>): string | undefined;
/**
 * The Google Cloud project and region of an upstream. The project is the `project` setting, else `ANTHROPIC_VERTEX_PROJECT_ID`,
 * `GOOGLE_CLOUD_PROJECT` or `GCLOUD_PROJECT`, else the `project_id` (or `quota_project_id`) of the credentials file.
 * @param {any} endpoint - Runtime endpoint.
 * @param {Record<string, string | undefined>} [env] - Environment.
 * @returns {{project: string, region: string}} Where requests go.
 * @throws {TranslatorError} With code `INVALID_CONFIG` when either is unknown.
 */
export function locate(endpoint: any, env?: Record<string, string | undefined>): {
    project: string;
    region: string;
};
/**
 * The path of a Vertex AI call for Claude.
 * @param {"messages" | "count"} kind - `"messages"` for a request (`rawPredict`, or `streamRawPredict` when streaming), `"count"` for token counting.
 * @param {any} endpoint - Runtime endpoint.
 * @param {string} [model] - Model for a `"messages"` call, for example `claude-sonnet-4-5@20250929`.
 * @param {{stream?: boolean, env?: Record<string, string | undefined>}} [options] - Whether the call streams, and the environment.
 * @returns {string} Path starting with `/v1/projects/`.
 */
export function route(kind: "messages" | "count", endpoint: any, model?: string, { stream, env }?: {
    stream?: boolean;
    env?: Record<string, string | undefined>;
}): string;
/**
 * Whether a model id names a Google-published Gemini model, which Vertex AI serves through `generateContent` and not `rawPredict`: `gemini-...`,
 * with or without a `models/` or `publishers/google/models/` prefix.
 * @param {unknown} model - Model id.
 * @returns {boolean} True for a Gemini model.
 */
export function gemini(model: unknown): boolean;
/**
 * The path of a Vertex AI call for a Google-published model: `.../publishers/google/models/<model>:generateContent`, or
 * `:streamGenerateContent?alt=sse` for a stream, or `:countTokens`.
 * @param {any} endpoint - Runtime endpoint.
 * @param {string} model - Model id, for example `gemini-2.5-flash`.
 * @param {{stream?: boolean, count?: boolean, env?: Record<string, string | undefined>}} [options] - Whether the call streams or counts tokens, and the environment.
 * @returns {string} Path starting with `/v1/projects/`.
 */
export function geminiRoute(endpoint: any, model: string, { stream, count, env }?: {
    stream?: boolean;
    count?: boolean;
    env?: Record<string, string | undefined>;
}): string;
/**
 * The body Vertex AI takes: the Messages body with `anthropic_version` added and the model taken out (it is in the path). The model stays on the
 * result as a property that is not enumerable, so it is not sent but the rest of the translator can still read `body.model`.
 * @param {any} body - Anthropic Messages request body.
 * @returns {any} Vertex AI body.
 */
export function body(body: any): any;
/** The `anthropic_version` Vertex AI requires in the body. */
export const VERSION: "vertex-2023-10-16";
/** The hosts that are not of the form `<region>-aiplatform.googleapis.com`: the global one and the multi-region ones. */
export const HOSTS: string[];
