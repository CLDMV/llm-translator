/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/health/check.mjs
 *	@Date: 2026-11-13T10:00:00-08:00 (1794247200)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T10:00:00-08:00 (1794247200)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Root api: probe the readiness of every upstream now.
 * @module @cldmv/llm-translator/health
 */
import { context, self } from "../../lib/runtime.mjs";
import { capture } from "../../lib/capture.mjs";
import { probe } from "../../lib/health.mjs";

/**
 * Probe every upstream whose driver names a health path (vLLM: `GET /health`) right away, whatever `pool.healthInterval` says, and return the
 * pool status. `send` already does this before it routes a request to a model that has more than one endpoint; call this to refresh the
 * `ready` field of `endpoint.status()` and `status()` for a lone upstream, or on a schedule of your own.
 * @param {any} [options] - `{ signal }`.
 * @returns {Promise<any>} The `endpoint.status()` result.
 */
export async function check(options = {}) {
	const c = capture(self, context);
	await probe(c, c.state.endpoints, { signal: options.signal, force: true });
	return self.endpoint.status();
}
