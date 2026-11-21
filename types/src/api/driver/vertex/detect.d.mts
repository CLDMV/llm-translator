/**
 * Match by host name, no network access.
 * @param {any} context - `{ endpoint }`.
 * @returns {{host: string} | null} Facts, or null when the host is not a Vertex AI host.
 */
export function detect({ endpoint }: any): {
    host: string;
} | null;
