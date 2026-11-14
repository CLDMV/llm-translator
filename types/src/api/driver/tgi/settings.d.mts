/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/tgi/settings.mjs
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
 * @fileoverview Hugging Face TGI driver: translator settings for TGI servers.
 * @module @cldmv/llm-translator/driver/tgi
 */
/**
 * Settings for TGI: `max_tokens` as the output cap, no `top_k` (the chat request has none), no prefill continuation, no thinking switch,
 * and `response_format` for structured output (the request normalizer rewrites it into TGI's grammar shape). Usage comes on the last
 * content chunk when `stream_options.include_usage` is set.
 * @returns {any} Partial settings.
 */
export function settings(): any;
