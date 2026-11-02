/**
 * Describe the translator's upstreams. Secrets (API keys, headers) are never included.
 * @returns {{front: string, upstreams: any[]}} Front protocol and per-upstream detection results and health (see `endpoint.status`).
 */
export function status(): {
    front: string;
    upstreams: any[];
};
