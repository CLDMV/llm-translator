/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/token/count.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:01-07:00 (1792958341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * Count input tokens for a client request. Uses the upstream's own tokenizer when its driver has one (vLLM `/tokenize`,
 * Anthropic `count_tokens`); otherwise a documented estimate of one token per four characters.
 * @param {any} body - Client request body (per `front`).
 * @param {any} [options] - `{ signal, front }`.
 * @returns {Promise<{input_tokens: number}>} Anthropic `count_tokens` shaped result.
 */
export declare function count(body: any, options?: any): Promise<{
    input_tokens: number;
}>;
