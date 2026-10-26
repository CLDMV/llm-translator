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
 * @fileoverview Generic OpenAI-compatible driver: always matches, records whether the server answered `/v1/models`.
 * @module @cldmv/llm-translator/driver/compatible
 */
import { fetchModels } from "../../../lib/models.mjs";

/**
 * Probe `/v1/models` for reachability and the served model ids. Never returns null: this driver is the fallback.
 * @param {any} context - `{ endpoint, transport, signal, timeout }`.
 * @returns {Promise<{reachable: boolean, models: string[]}>} Facts.
 */
export async function detect(context) {
	const models = await fetchModels({ ...context, auth: "bearer" });
	return { reachable: models !== null, models: (models ?? []).map((entry) => entry.id) };
}
