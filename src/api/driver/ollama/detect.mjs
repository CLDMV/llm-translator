/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/ollama/detect.mjs
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
 * @fileoverview Ollama driver: detection via `GET /api/version`.
 * @module @cldmv/llm-translator/driver/ollama
 */
import * as http from "../../../lib/http.mjs";
import { modelsOf } from "../../../lib/models.mjs";

/**
 * Probe an endpoint for Ollama.
 * @param {any} context - `{ endpoint, transport, signal, timeout, probes }`.
 * @returns {Promise<any | null>} Facts `{ version, models }`, or null when the endpoint is not Ollama.
 */
export async function detect(context) {
	const [version, listing] = await Promise.all([http.probe(context, "/api/version"), http.probe(context, "/v1/models")]);
	if (typeof version.body?.version !== "string") return null;
	return { version: version.body.version, models: (modelsOf(listing) ?? []).map((entry) => entry.id) };
}
