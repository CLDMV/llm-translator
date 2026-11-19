/**
 * Describe the translator's upstreams. Secrets (API keys, headers) are never included.
 * @returns {{front: string, upstreams: any[]}} Front protocol and per-upstream detection results and health (see `endpoint.status`). `api` is the upstream's `api` setting as the canonical id (or `"auto"`) and `protocols` the protocols its driver speaks. `protocol` is the one a request in the configured front's protocol goes over now (under `api: "auto"` that is the first of the client's own protocol and Chat Completions that the server has, so an upstream that answered 404, 405 or 501 to one has moved on until the next detection). `responses` is true while that holds for a Responses API request (a Responses client on an OpenAI front), and `messages` is true while an Anthropic request to a vLLM upstream goes to its native `/v1/messages` (a request it cannot take is still converted), false when it is converted, and null for any other driver.
 */
export function status(): {
    front: string;
    upstreams: any[];
};
