/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/llamacpp/detect.mjs
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
 * @fileoverview llama.cpp driver: detection via `GET /props` (and `owned_by: "llamacpp"` in `GET /v1/models`).
 * @module @cldmv/llm-translator/driver/llamacpp
 */
import * as http from "../../../lib/http.mjs";
import { modelsOf } from "../../../lib/models.mjs";
import { isLlamacppProps, objectOf } from "../../../lib/backends.mjs";

/**
 * Probe an endpoint for `llama-server`.
 * @param {any} context - `{ endpoint, transport, signal, timeout, probes }`.
 * @returns {Promise<any | null>} Facts `{ models, build, vision }`, or null when the endpoint is not llama-server.
 */
export async function detect(context) {
	const [props, listing] = await Promise.all([http.probe(context, "/props"), http.probe(context, "/v1/models")]);
	const body = objectOf(props);
	const models = modelsOf(listing) ?? [];
	if (!isLlamacppProps(body) && !models.some((entry) => entry.owned_by === "llamacpp")) return null;
	return {
		models: models.map((entry) => entry.id),
		build: typeof body.build_info === "string" ? body.build_info : undefined,
		// Newer builds report `modalities: { vision }`; older ones say nothing.
		vision: typeof body.modalities?.vision === "boolean" ? body.modalities.vision : undefined
	};
}
