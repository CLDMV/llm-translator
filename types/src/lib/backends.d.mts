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
