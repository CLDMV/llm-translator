/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/groq/info.mjs
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
 * @fileoverview Groq driver: static facts about the hosted API.
 * @module @cldmv/llm-translator/driver/groq
 */
import { describe } from "../../../lib/presets.mjs";

/**
 * Describe the Groq driver (see `PRESETS.groq` in `lib/presets.mjs`).
 * @returns {{name: string, protocol: string, order: number, auth: string, strict: boolean, fields?: string[], paths: Record<string,string>}} Driver facts.
 */
export function info() {
	return describe("groq");
}
