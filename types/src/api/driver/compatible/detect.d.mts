/**
 * Probe `/v1/models` for reachability and the served model ids. Never returns null: this driver is the fallback.
 * @param {any} context - `{ endpoint, transport, signal, timeout, probes }`.
 * @returns {Promise<{reachable: boolean, models: string[]}>} Facts.
 */
export function detect(context: any): Promise<{
    reachable: boolean;
    models: string[];
}>;
