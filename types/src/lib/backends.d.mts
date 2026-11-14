/**
 * An object body, or an empty one.
 * @param {{ok: boolean, body: any}} result - Outcome of a probe.
 * @returns {Record<string, any>} The parsed JSON object when the request succeeded.
 */
export function objectOf(result: {
    ok: boolean;
    body: any;
}): Record<string, any>;
/**
 * Does a `/props` reply come from `llama-server`?
 * @param {Record<string, any>} body - Reply object (see `objectOf`).
 * @returns {boolean} True when it carries llama-server fields.
 */
export function isLlamacppProps(body: Record<string, any>): boolean;
/**
 * Does a `/get_server_info` reply come from SGLang?
 * @param {Record<string, any>} body - Reply object (see `objectOf`).
 * @returns {boolean} True when it names a model or tokenizer path.
 */
export function isSglangInfo(body: Record<string, any>): boolean;
/**
 * Does a `GET /api/v0/models` reply come from LM Studio? The match is strict so no other server binds: `object: "list"`, a non-empty `data`
 * array, and every entry an `object: "model"` with string `id`, `arch`, `compatibility_type` and `state` and a known `type`.
 * @param {Record<string, any>} body - Reply object (see `objectOf`).
 * @returns {boolean} True for LM Studio's model listing.
 */
export function isLmstudioModels(body: Record<string, any>): boolean;
/**
 * Does a `GET /info` reply come from Hugging Face Text Generation Inference? The match is strict so no other server binds: the router
 * names itself `text-generation-router` (Text Embeddings Inference answers `/info` too, as `text-embeddings-router`), and the reply
 * carries a string `model_id` and `version` and a numeric `max_total_tokens` (older releases lack `max_input_tokens`, so it is not required).
 * @param {Record<string, any>} body - Reply object (see `objectOf`).
 * @returns {boolean} True for TGI's `/info`.
 */
export function isTgiInfo(body: Record<string, any>): boolean;
/**
 * Does a `GET /version` reply come from LocalAI? It answers `{ version: "<version> (<commit>)" }` (the version, a space, and the build
 * commit in parentheses, which is empty for a source build), where vLLM and SGLang answer a bare version, so the shape names LocalAI.
 * @param {Record<string, any>} body - Reply object (see `objectOf`).
 * @returns {boolean} True for LocalAI's version reply.
 */
export function isLocalaiVersion(body: Record<string, any>): boolean;
/**
 * Does a `GET /.well-known/localai.json` reply come from LocalAI? It is LocalAI's discovery document: a string `version` and an
 * `endpoints` map that names the OpenAI routes (`models`, `chat_completions`) by path.
 * @param {Record<string, any>} body - Reply object (see `objectOf`).
 * @returns {boolean} True for LocalAI's discovery document.
 */
export function isLocalaiDiscovery(body: Record<string, any>): boolean;
