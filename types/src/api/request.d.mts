/**
 * Route a client request body (in the configured `front` protocol) to an upstream and convert it to that upstream's
 * protocol. Does no I/O.
 * @param {any} body - Client request body (Anthropic Messages or OpenAI Chat Completions, per `front`).
 * @param {any} [options] - `{ front, headers, clientHeaders, filter, images, usage }`. `front` overrides the configured front for this call, `headers` are extra upstream headers, `clientHeaders` are client headers forwarded only to a native Anthropic upstream, `filter` restricts a forwarded OpenAI body to known fields (default: the `passthroughFilter` setting, off), `images: false` sends the request without images (used by the image fallback), `endpoint` sends to that member of the model's pool (used for failover; default: the first in the pool's order), `hold: true` (used by `send`) advances a round robin and takes the chosen endpoint's in-flight slot, which the caller then releases, `jsonObject: "instruction"` sends a `json_object` response format as a system instruction (used by the JSON fallback, and applied by itself once a refusal is remembered for the endpoint and model), `tools: false` sends the request without tools (used by the tool fallback), `usage: true` (used by `send`) makes a streaming OpenAI-front request always ask the upstream for its final usage chunk, `retry: true` (used by `send` for the same request sent again) keeps the `dropped` event from repeating, `log` is the logger events of this request also go to (used by the server), `budget` (from `createBudget`, one per `send` for all its attempts) limits the cost of decoding reasoning signatures.
 * @returns {Promise<{upstream: string, method: string, url: string, path: string, headers: Record<string,string>, body: any, state: any, pool: string[], images: {sent: boolean, retry: boolean, key: string}, tools: {sent: boolean, retry: boolean}, json: {sent: boolean, retry: boolean, key: string}}>} The upstream request and the state `response`/`stream`/`error` need. `pool` lists the names of the endpoints serving the model in the order they are tried (`upstream` is the first); `images` tells `send` whether the body carries images, whether a refusal may be retried without them and the key under which a refusal is remembered; `tools` tells it whether the body carries tools and whether a tool-parser refusal may be retried without them; `json` tells it whether the body carries the schema emulation of `json_object`, whether a refusal may be retried with the instruction and the key under which a refusal is remembered.
 */
export function request(body: any, options?: any): Promise<{
    upstream: string;
    method: string;
    url: string;
    path: string;
    headers: Record<string, string>;
    body: any;
    state: any;
    pool: string[];
    images: {
        sent: boolean;
        retry: boolean;
        key: string;
    };
    tools: {
        sent: boolean;
        retry: boolean;
    };
    json: {
        sent: boolean;
        retry: boolean;
        key: string;
    };
}>;
