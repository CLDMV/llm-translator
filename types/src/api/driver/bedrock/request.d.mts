/**
 * Shape the body for the runtime. The model id and the choice of streaming are in the URL, so neither is in the body. An InvokeModel body
 * also gets `anthropic_version: "bedrock-2023-05-31"` and loses the Anthropic API fields Bedrock does not have (`metadata`, `service_tier`,
 * `container`, `mcp_servers`); a Converse body needs nothing more.
 * @param {any} body - Anthropic Messages or Converse request body.
 * @param {any} [context] - `{ protocol }`, the protocol the request goes over.
 * @returns {any} Normalized body.
 */
export function request(body: any, context?: any): any;
