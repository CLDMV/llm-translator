/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/compatible/detect.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:58:59-07:00 (1792958339)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * Probe `/v1/models` for reachability and the served model ids. Never returns null: this driver is the fallback.
 * @param {any} context - `{ endpoint, transport, signal, timeout }`.
 * @returns {Promise<{reachable: boolean, models: string[]}>} Facts.
 */
export declare function detect(context: any): Promise<{
    reachable: boolean;
    models: string[];
}>;
