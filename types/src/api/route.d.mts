/**
 * Resolve a client request body to its upstream and model (after aliases and routing) without doing any I/O, for example to
 * check a model allow-list before `send`. Uses the same routing as `request`.
 * @param {any} body - Client request body (Anthropic Messages or OpenAI Chat Completions, per `front`).
 * @param {any} [options] - `{ front }` overrides the configured front for this call.
 * @returns {{upstream: string, model: string, requested: string | undefined, protocol: string, backend: string, native: boolean, unserved: boolean, pool: string[]}} `upstream` is the first endpoint `send` would try right now (the endpoint name), `model` the name sent upstream, `requested` the name the client used, `protocol` the upstream's protocol (`openai.chat` or `anthropic.messages`), `backend` the driver detection chose (`vllm`, `openai`, `anthropic` or `compatible`, the `driver` that `status()` reports), `native` whether the body is forwarded without conversion and `unserved`  whether no upstream lists the model and `pool` the names of all endpoints serving the model in the order they would be tried (failover candidates). When several endpoints serve the model this is a snapshot of the current health, in-flight counts and round robin position and it does not move the round robin; `send` decides again and may use another member, so the endpoint that answered is `usage.upstream`.
 * @throws {TranslatorError} `invalid_body` (400) when the body is not a JSON object.
 */
export function route(body: any, options?: any): {
    upstream: string;
    model: string;
    requested: string | undefined;
    protocol: string;
    backend: string;
    native: boolean;
    unserved: boolean;
    pool: string[];
};
