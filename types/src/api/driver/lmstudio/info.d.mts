/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/lmstudio/info.mjs
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
 * @fileoverview LM Studio driver: static facts about the LM Studio local server.
 * @module @cldmv/llm-translator/driver/lmstudio
 */
/**
 * Describe the LM Studio driver. It is found through `GET /api/v0/models`, LM Studio's own REST listing.
 * @returns {{name: string, protocol: string, order: number, auth: string, strict: boolean, probes: string[], paths: Record<string,string>}} Driver facts.
 */
export function info(): {
    name: string;
    protocol: string;
    order: number;
    auth: string;
    strict: boolean;
    probes: string[];
    paths: Record<string, string>;
};
