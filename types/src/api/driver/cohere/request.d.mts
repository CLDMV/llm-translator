/**
 * For the Compatibility API: remove the fields it does not implement (each recorded in `state.dropped`, except `stream_options` which only
 * carries a usage preference) and map `reasoning_effort` to the two values it takes (`none` stays, every other level is `high`). The native
 * protocol's body is built by the converter and goes through as it is.
 * @param {any} body - Chat Completions or Cohere request body.
 * @param {any} [context] - `{ state, protocol }` (`protocol` is the one the request goes over).
 * @returns {any} Normalized body.
 */
export function request(body: any, context?: any): any;
