/**
 * Forward `POST /v1/embeddings` to an OpenAI-protocol upstream that lists the model. The body and the reply pass through unchanged
 * apart from `model`, which is the upstream's name for it (after `aliases`). The model is routed like a chat model: aliases, then the
 * pool of endpoints serving it, which fails over on a connection error or a 5xx. Errors are replies in the OpenAI error shape (the
 * return value, not a throw): `400` for a body that is not an object or has no `model`, `404` when no upstream serves the model and `400`
 * (`embeddings_unsupported`) when the model is served only by Anthropic-protocol upstreams, which have no embeddings API, and `499` (`aborted`) when `signal` aborts.
 * @param {any} body - OpenAI embeddings request body (`{ model, input, ... }`).
 * @param {any} [options] - `{ signal, headers, log }`: abort signal for the upstream call, extra upstream headers and the logger events of this request also go to (used by the server).
 * @returns {Promise<{status: number, headers: Record<string,string>, body: any}>} The upstream's JSON reply, or an OpenAI-shaped error reply.
 */
export function send(body: any, options?: any): Promise<{
    status: number;
    headers: Record<string, string>;
    body: any;
}>;
