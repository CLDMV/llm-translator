/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/openrouter/detect.mjs
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
 * @fileoverview OpenRouter driver: matches the openrouter.ai host.
 * @module @cldmv/llm-translator/driver/openrouter
 */
/**
 * Match by host name, no network access.
 * @param {any} context - `{ endpoint }`.
 * @returns {{host: string} | null} Facts, or null when the endpoint is not openrouter.ai.
 */
export function detect({ endpoint }: any): {
    host: string;
} | null;
