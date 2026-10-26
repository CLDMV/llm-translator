/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/vllm/settings.mjs
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
 * Settings for a vLLM server. An unknown version is treated as the latest release, except `thinkingBudget`, which needs a known version of 0.19.0 or later.
 * @param {{version?: string}} [facts] - Detection facts (or the configured version).
 * @returns {any} Partial settings.
 */
export declare function settings(facts?: {
    version?: string;
}): any;
