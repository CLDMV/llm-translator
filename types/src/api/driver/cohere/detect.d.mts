/**
 * Match by host name, no network access.
 * @param {any} context - `{ endpoint }`.
 * @returns {{host: string} | null} Facts, or null when the endpoint is not Cohere's.
 */
export function detect({ endpoint }: any): {
    host: string;
} | null;
