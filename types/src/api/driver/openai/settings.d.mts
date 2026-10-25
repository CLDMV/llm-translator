/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/openai/settings.mjs
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
 * @fileoverview OpenAI driver: translator settings for the hosted OpenAI API.
 * @module @cldmv/llm-translator/driver/openai
 */
/**
 * Settings for api.openai.com: no `top_k`, `reasoning_effort` for thinking, no prefill continuation.
 * @returns {any} Partial settings.
 */
export declare function settings(): any;
