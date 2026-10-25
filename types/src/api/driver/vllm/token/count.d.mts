/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/vllm/token/count.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:00-07:00 (1792958340)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * Count the prompt tokens of a converted Chat Completions request with the server's own tokenizer and chat template.
 * @param {any} context - `{ endpoint, request, transport, signal, timeout }`.
 * @returns {Promise<number | null>} Token count, or null when the server did not answer (caller falls back to an estimate).
 */
export declare function count({ endpoint, request, transport, signal, timeout }: any): Promise<number | null>;
