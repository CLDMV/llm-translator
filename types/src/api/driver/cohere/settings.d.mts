/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/cohere/settings.mjs
 *	@Date: 2026-11-21T10:00:00-08:00 (1795284000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-21T10:00:00-08:00 (1795284000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * @fileoverview Cohere driver: translator settings for the Compatibility API.
 * @module @cldmv/llm-translator/driver/cohere
 */
/**
 * Settings for the Compatibility API (https://docs.cohere.com/docs/compatibility-api): `max_tokens` as the output cap, no `top_k`,
 * thinking through `reasoning_effort` (which takes `none` and `high` only; the request normalizer maps the other levels) and no
 * `parallel_tool_calls`. The API documents no `stream_options`, so no usage chunk is asked for. The native protocol ignores these.
 * @returns {any} Partial settings.
 */
export function settings(): any;
