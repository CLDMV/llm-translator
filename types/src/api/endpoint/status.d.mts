/**
 * Health of every endpoint, for status output. An endpoint is unhealthy while it is backing off after a connection error or a 5xx, or while its last readiness probe (`GET /health` for vLLM, see `health.check`) said it is not ready; it is still
 * tried when nothing healthy serves the model. Secrets are never included.
 * @returns {{strategy: string, backoff: {base: number, max: number}, models: Record<string, string>, endpoints: {name: string, url: string, models: string[], healthy: boolean, ready: boolean | null, readyReason: string | null, checkedAt: string | null, failures: number, retryAt: string | null, inflight: number, requests: number, errors: number, lastError: string | null, lastFailure: string | null, lastSuccess: string | null}[]}} The pool config and one record per endpoint (`inflight` counts requests whose reply has not finished, `requests` and `errors` count attempts since start).
 */
export function status(): {
    strategy: string;
    backoff: {
        base: number;
        max: number;
    };
    models: Record<string, string>;
    endpoints: {
        name: string;
        url: string;
        models: string[];
        healthy: boolean;
        ready: boolean | null;
        readyReason: string | null;
        checkedAt: string | null;
        failures: number;
        retryAt: string | null;
        inflight: number;
        requests: number;
        errors: number;
        lastError: string | null;
        lastFailure: string | null;
        lastSuccess: string | null;
    }[];
};
