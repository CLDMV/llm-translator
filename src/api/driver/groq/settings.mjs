/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/groq/settings.mjs
 *	@Date: 2026-11-13T10:00:00-08:00 (1794592800)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T10:00:00-08:00 (1794592800)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Groq driver: translator settings for the hosted API.
 * @module @cldmv/llm-translator/driver/groq
 */
import { settingsOf } from "../../../lib/presets.mjs";

/**
 * Settings for Groq: token field, reasoning field and controls, sampling fields and streaming usage as the provider documents them (see `PRESETS.groq` in `lib/presets.mjs`).
 * @returns {any} Partial settings.
 */
export function settings() {
	return settingsOf("groq");
}
