/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/vllm/probe.mjs
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
 * Tokenize `[system, user, system, user]` through `POST /tokenize`. Success means the template tolerates inline system messages.
 * @param {any} context - `{ endpoint, transport, signal, timeout, facts }`.
 * @returns {Promise<{inlineSystem: "keep" | "user"}>} Probed settings.
 */
export declare function probe({ endpoint, transport, signal, timeout, facts }: any): Promise<{
    inlineSystem: "keep" | "user";
}>;
