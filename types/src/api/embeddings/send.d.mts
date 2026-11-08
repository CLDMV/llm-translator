/**
 * Forward `POST /v1/embeddings` to an OpenAI-protocol upstream that lists the model. The body and the reply pass through unchanged
 * apart from `model`, which is the upstream's name for it (after `aliases`). The model is routed like a chat model: aliases, then the
 * pool of endpoints serving it, which fails over on a connection error or a 5xx. Errors are replies in the OpenAI error shape (the
 * return value, not a throw): `400` for a body that is not an object or has no `model`, `404` when no upstream serves the model and `400`
 * (`embeddings_unsupported`) when the model is served only by Anthropic-protocol upstreams, which have no embeddings API, and `499` (`aborted`) when `signal` aborts.
 *
 * Like `api.send`, every reply, including error replies, carries a non-enumerable `usage` property (a `Promise` of the usage report that
 * never rejects, already settled) and `onUsage(report)` is called with the same report exactly once. The report has the shape of
 * `api.send`'s (see there) with `front: "openai"` and `stream: false`: `input_tokens` is the reply's `prompt_tokens`, the other token fields
 * are `null`, and `reported` is false when the reply carried no `usage` (or only zeros). `reason` is `"done"` for a 200 reply, `"aborted"`
 * for a 499, `"upstream_error"` for an error the upstream answered with, and `"error"` for the rest (an invalid body, an unknown or
 * unsupported model, an unreachable upstream, a body that is not JSON); `model` and `upstream` are null until an endpoint was tried.
 * @param {any} body - OpenAI embeddings request body (`{ model, input, ... }`).
 * @param {any} [options] - `{ signal, headers, onUsage, log }`: abort signal for the upstream call, extra upstream headers, the usage callback and the logger events of this request also go to (used by the server).
 * @returns {Promise<{status: number, headers: Record<string,string>, body: any, usage: Promise<any>}>} The upstream's JSON reply, or an OpenAI-shaped error reply.
 */
export function send(body: any, options?: any): Promise<{
    status: number;
    headers: Record<string, string>;
    body: any;
    usage: Promise<any>;
}>;
