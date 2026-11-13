/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/localai/settings.mjs
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
 * @fileoverview LocalAI driver: translator settings for LocalAI servers.
 * @module @cldmv/llm-translator/driver/localai
 */
/**
 * Settings for LocalAI: reasoning is sent as `reasoning` (LocalAI's own field; it reads `reasoning_content` too, and so does the
 * translator), `max_tokens` as the output cap, `top_k` and `chat_template_kwargs` are accepted, no prefill continuation, and usage on
 * the last content chunk when `stream_options.include_usage` is set.
 * @returns {any} Partial settings.
 */
export function settings(): any;
