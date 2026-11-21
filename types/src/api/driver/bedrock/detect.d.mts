/**
 * Match by host name, no network access: `bedrock-runtime.<region>.amazonaws.com`, its FIPS and VPC endpoint forms, and the China partition.
 * @param {any} context - `{ endpoint }`.
 * @returns {{host: string, region: string} | null} Facts, or null when the host is not a Bedrock runtime host.
 */
export function detect({ endpoint }: any): {
    host: string;
    region: string;
} | null;
