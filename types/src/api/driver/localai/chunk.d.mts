/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/localai/chunk.mjs
 *	@Date: 2026-11-13T09:00:00-08:00 (1794589200)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T09:00:00-08:00 (1794589200)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * @fileoverview LocalAI driver: streaming chunk normalizer (Chat Completions chunk).
 * @module @cldmv/llm-translator/driver/localai
 */
/**
 * When the client asked for one tool call at a time, drop the fragments of every call but the first (index 0), see `response`.
 * @param {any} chunk - Parsed `chat.completion.chunk`.
 * @param {any} [ctx] - `{ state }`.
 * @returns {any} Normalized chunk.
 */
export function chunk(chunk: any, ctx?: any): any;
