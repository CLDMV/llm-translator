/**
 * Shape the body for the runtime. The model id and the choice of streaming are in the URL, so neither is in the body. An InvokeModel body
 * also gets `anthropic_version: "bedrock-2023-05-31"` and loses the Anthropic API fields Bedrock does not have (`metadata`, `service_tier`,
 * `container`, `mcp_servers`); a Converse body needs nothing more. A client's `anthropic-beta` header has no place on Bedrock's HTTP API, which
 * takes the same list as `anthropic_beta` in the InvokeModel body: the header's names are added to the body's own list (without repeats).
 * @param {any} body - Anthropic Messages or Converse request body.
 * @param {any} [context] - `{ protocol, clientHeaders }`, the protocol the request goes over and the headers the client sent (only for a body that was forwarded as it is).
 * @returns {any} Normalized body.
 */
export function request(body: any, context?: any): any;
