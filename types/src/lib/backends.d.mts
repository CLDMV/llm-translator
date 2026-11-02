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
