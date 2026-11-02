/**
 * Keep only known Chat Completions fields and the extension fields the upstream's driver allows, so an untrusted client cannot inject server-side
 * controls such as `kv_transfer_params`, `vllm_xargs`, `chat_template`, `cache_salt` or `priority`. `stream_options` is
 * reduced to the usage flags. A driver allows more through `info().fields` (vLLM's list for `vllm` and `compatible`, llama.cpp's
 * `repeat_penalty` and `grammar`, SGLang's `regex`, `ebnf` and `separate_reasoning`, and so on), so a field is forwarded only to a backend that
 * understands it.
 * @param {any} body - Client request body.
 * @param {string[]} [extra] - Extra field names the upstream's driver allows.
 * @returns {any} Filtered copy.
 */
export function filterChatBody(body: any, extra?: string[]): any;
/**
 * Documented vLLM sampling, template and reasoning extensions. The `vllm` and `compatible` drivers list them in `info().fields`; a backend
 * that does not accept them (api.openai.com, DeepSeek, Anthropic, Ollama) does not, so they are stripped for it.
 */
export const VLLM_FIELDS: string[];
