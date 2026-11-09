/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/lmstudio/settings.mjs
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
 * @fileoverview LM Studio driver: translator settings for the LM Studio local server.
 * @module @cldmv/llm-translator/driver/lmstudio
 */
/**
 * Settings for LM Studio: the conservative generic set (no `top_k`, no prefill, no thinking switch) with usage on the last content chunk.
 * @returns {any} Partial settings.
 */
export function settings(): any;
