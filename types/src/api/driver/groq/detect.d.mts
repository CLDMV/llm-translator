/**
 * Match by host name, no network access.
 * @param {any} context - `{ endpoint }`.
 * @returns {{host: string} | null} Facts, or null when the endpoint is not Groq's.
 */
export function detect({ endpoint }: any): {
    host: string;
} | null;
