/**
 * Describe the vLLM driver. `paths.health` (`GET /health`: 200 when the engine is up, 503 once it is dead; outside the API-key guard) is what `lib/health` probes before routing a request to a pool.
 * @returns {{name: string, protocol: string, order: number, auth: string, strict: boolean, fields: string[], paths: Record<string,string>}} Driver facts.
 */
export function info(): {
    name: string;
    protocol: string;
    order: number;
    auth: string;
    strict: boolean;
    fields: string[];
    paths: Record<string, string>;
};
