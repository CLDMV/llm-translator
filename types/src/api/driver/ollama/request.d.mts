/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/ollama/request.mjs
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
 * Remove `tool_choice`, `n` and `logit_bias` (recorded in `state.dropped`), replace images given by URL with a note, and warn once per
 * upstream when the prompt is estimated to exceed `contextWindow` (Ollama truncates silently).
 * @param {any} body - Chat Completions request body.
 * @param {any} [ctx] - `{ endpoint, settings, state, warn }`.
 * @returns {any} Normalized body.
 */
export declare function request(body: any, ctx?: any): any;
