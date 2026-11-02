/**
 * Count input tokens for a client request. Uses the upstream's own tokenizer when its driver has one (vLLM `/tokenize`,
 * Anthropic `count_tokens`); otherwise a documented estimate of one token per four characters.
 * @param {any} body - Client request body (per `front`).
 * @param {any} [options] - `{ signal, front }`.
 * @returns {Promise<{input_tokens: number}>} Anthropic `count_tokens` shaped result.
 */
export function count(body: any, options?: any): Promise<{
    input_tokens: number;
}>;
