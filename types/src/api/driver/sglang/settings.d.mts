/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/sglang/settings.mjs
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
 * @fileoverview SGLang driver: translator settings for SGLang servers.
 * @module @cldmv/llm-translator/driver/sglang
 */
/**
 * Settings for SGLang: reasoning comes back as `reasoning_content` (with `--reasoning-parser`), `top_k` is a native sampler, thinking is
 * toggled through `chat_template_kwargs`, and the usual OpenAI output cap and usage options apply.
 * @returns {any} Partial settings.
 */
export function settings(): any;
