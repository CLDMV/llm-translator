/**
 * Convert an upstream response body to the client protocol (a no-op apart from driver normalization and restoring the
 * client's model name when front and upstream speak the same protocol).
 * @param {any} upstreamBody - Parsed upstream JSON body.
 * @param {any} state - The `state` returned by `request`.
 * @returns {Promise<any>} Response body in the client protocol.
 */
export function response(upstreamBody: any, state: any): Promise<any>;
