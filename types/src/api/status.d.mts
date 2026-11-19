/**
 * Describe the translator's upstreams. Secrets (API keys, headers) are never included.
 * @returns {{front: string, upstreams: any[]}} Front protocol and per-upstream detection results and health (see `endpoint.status`). `messages` is true while an Anthropic-front request to a vLLM upstream goes to its native `/v1/messages` (the `nativeMessages` setting; a request it cannot take is still converted), false when it is converted, and null for any other driver. `protocol` is the one the upstream is using now, and `responses` is true while requests go to its Responses API (an `api: "auto"` upstream that answered 404, 405 or 501 to it has dropped to Chat Completions, until the next detection).
 */
export function status(): {
    front: string;
    upstreams: any[];
};
