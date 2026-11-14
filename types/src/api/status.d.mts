/**
 * Describe the translator's upstreams. Secrets (API keys, headers) are never included.
 * @returns {{front: string, upstreams: any[]}} Front protocol and per-upstream detection results and health (see `endpoint.status`). `messages` is true while an Anthropic-front request to a vLLM upstream goes to its native `/v1/messages` (the `nativeMessages` setting; a request it cannot take is still converted), false when it is converted, and null for any other driver.
 */
export function status(): {
    front: string;
    upstreams: any[];
};
