/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/gemini/info.mjs
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
 * @fileoverview Gemini driver: static facts about the hosted API (the OpenAI-compatible endpoint and the native `generateContent` API).
 * @module @cldmv/llm-translator/driver/gemini
 */
import { describe } from "../../../lib/presets.mjs";

/**
 * Describe the Gemini driver (see `PRESETS.gemini` in `lib/presets.mjs`). `protocol` is the OpenAI-compatible endpoint, the default; the native
 * `generateContent` API (`google.gemini`) is used only by an upstream with an explicit `api`, because no client speaks it.
 * @returns {{name: string, protocol: string, protocols: string[], order: number, auth: string, strict: boolean, fields?: string[], paths: Record<string,string>}} Driver facts.
 */
export function info() {
	return { ...describe("gemini"), protocols: ["openai.chat", "google.gemini"] };
}
