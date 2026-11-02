/**
 * Does the endpoint serve the model?
 * @param {any} endpoint - Runtime endpoint.
 * @param {string} model - Upstream model name.
 * @returns {boolean} True when the endpoint lists the model, or is an Anthropic upstream and the model is a `claude-*` id.
 */
export function serves(endpoint: any, model: string): boolean;
/**
 * Pick the endpoint for a model: alias map, then the endpoints serving the model (a pool, ordered by the model's strategy and health;
 * the first is chosen), then the default endpoint, then the first.
 * @param {any} config - Normalized config (`aliases`, `pool`).
 * @param {any[]} endpoints - Runtime endpoints.
 * @param {string | undefined} model - Model named by the client.
 * @param {any} state - Translator state (`cursors`).
 * @param {boolean} [advance] - Move the round robin cursor (false to only look).
 * @returns {{endpoint: any, model: string | undefined, unserved: boolean, pool: any[]}} Chosen endpoint, the model name to send upstream, whether
 * no endpoint serves the model and the endpoints to try in order (the chosen one first). When nothing serves it and the fallback endpoint knows
 * exactly one model, that model is sent instead.
 */
export function pick(config: any, endpoints: any[], model: string | undefined, state: any, advance?: boolean): {
    endpoint: any;
    model: string | undefined;
    unserved: boolean;
    pool: any[];
};
/**
 * Validate a client request body and resolve where it goes. Shared by `request` and `route` so both always agree.
 * @param {any} c - Captured translator parts (`capture`).
 * @param {any} body - Client request body.
 * @param {{endpoint?: string, advance?: boolean}} [options] - `endpoint` forces one pool member by name (used for failover; it must still serve the model, else `endpoint_not_in_pool`); `advance` moves the round robin cursor (`request` does, `route` does not).
 * @returns {{endpoint: any, model: string, requested: string | undefined, unserved: boolean, convert: any, pool: any[]}} The chosen endpoint, the model name sent
 * upstream, the model the client asked for, whether no endpoint serves it, the converters (null for a native pass-through) and the pool in try order.
 * @throws {TranslatorError} `invalid_body` when the body is not a JSON object, `endpoint_not_in_pool` when a forced endpoint no longer serves the model.
 */
export function resolve(c: any, body: any, options?: {
    endpoint?: string;
    advance?: boolean;
}): {
    endpoint: any;
    model: string;
    requested: string | undefined;
    unserved: boolean;
    convert: any;
    pool: any[];
};
