/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/detect.mjs
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
 * Bind every endpoint to a driver. `backend: "auto"` endpoints are probed (drivers tried in `info().order`, the generic
 * driver matches last); endpoints with an explicit `backend` skip detection. Call it again to re-probe.
 * @param {any} [options] - `{ network, signal }`. `network: false` skips all probing (auto endpoints fall back to the generic driver).
 * @returns {Promise<any>} The `status()` result.
 */
export declare function detect(options?: any): Promise<any>;
