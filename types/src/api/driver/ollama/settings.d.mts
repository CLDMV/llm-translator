/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/ollama/settings.mjs
 *	@Date: 2026-10-31T14:00:00-07:00 (1793480400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:00:00-07:00 (1793480400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * Settings for Ollama: no `top_k` (not accepted on `/v1`), `max_tokens` as the output cap, no `parallel_tool_calls`, and a
 * `contextWindow` of Ollama's default so a prompt that will be truncated is warned about. Raise `contextWindow` to the value the
 * server really runs with (`OLLAMA_CONTEXT_LENGTH` or a Modelfile `num_ctx`).
 * @returns {any} Partial settings.
 */
export declare function settings(): any;
