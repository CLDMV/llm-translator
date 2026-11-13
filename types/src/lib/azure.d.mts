/**
 * Build the path (and query) of an Azure OpenAI call.
 *
 * The v1 API (`<endpoint>/openai/v1/...`, the model named in the body, no `api-version`) is used unless the upstream sets `apiVersion`.
 * With `apiVersion` the classic form is used: `<endpoint>/openai/deployments/<deployment>/chat/completions?api-version=<version>`, where the
 * deployment is the upstream's `deployment` or else the request's model. The model list has no deployment in its path (`/openai/models`).
 * An upstream URL that already ends in `/openai` (a pasted `.../openai/v1` base has its `/v1` removed by the config) is not given a second `/openai`.
 * @param {"chat" | "embeddings" | "models"} kind - Which call.
 * @param {{url: string, apiVersion?: string, deployment?: string}} endpoint - Runtime endpoint.
 * @param {string} [model] - The request's model, the deployment name unless the endpoint sets one.
 * @returns {string} Path starting with `/`, with the `api-version` query for the classic form.
 */
export function route(kind: "chat" | "embeddings" | "models", endpoint: {
    url: string;
    apiVersion?: string;
    deployment?: string;
}, model?: string): string;
