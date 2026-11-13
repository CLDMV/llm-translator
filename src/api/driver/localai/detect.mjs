/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/localai/detect.mjs
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
 * @fileoverview LocalAI driver: detection via `GET /version` and `GET /.well-known/localai.json`.
 * @module @cldmv/llm-translator/driver/localai
 */
import * as http from "../../../lib/http.mjs";
import { modelsOf } from "../../../lib/models.mjs";
import { isLocalaiDiscovery, isLocalaiVersion, objectOf } from "../../../lib/backends.mjs";

/**
 * Probe an endpoint for LocalAI.
 * @param {any} context - `{ endpoint, transport, signal, timeout, probes }`.
 * @returns {Promise<any | null>} Facts `{ version, models }`, or null when the endpoint is not LocalAI.
 */
export async function detect(context) {
	const [version, discovery, listing] = await Promise.all([
		http.probe(context, "/version"),
		http.probe(context, "/.well-known/localai.json"),
		http.probe(context, "/v1/models")
	]);
	const versionBody = objectOf(version);
	const discoveryBody = objectOf(discovery);
	if (!isLocalaiVersion(versionBody) && !isLocalaiDiscovery(discoveryBody)) return null;
	return {
		version: isLocalaiVersion(versionBody) ? versionBody.version : discoveryBody.version,
		models: (modelsOf(listing) ?? []).map((entry) => entry.id)
	};
}
