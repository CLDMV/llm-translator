/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/lmstudio/detect.mjs
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
 * @fileoverview LM Studio driver: detection via `GET /api/v0/models`.
 * @module @cldmv/llm-translator/driver/lmstudio
 */
import * as http from "../../../lib/http.mjs";
import { isLmstudioModels, objectOf } from "../../../lib/backends.mjs";

/**
 * Probe an endpoint for LM Studio.
 * @param {any} context - `{ endpoint, transport, signal, timeout, probes }`.
 * @returns {Promise<any | null>} Facts `{ models, loaded }` (ids of chat models, and of those currently loaded), or null when the endpoint is not LM Studio.
 */
export async function detect(context) {
	const body = objectOf(await http.probe(context, "/api/v0/models"));
	if (!isLmstudioModels(body)) return null;
	const chat = body.data.filter((entry) => entry.type !== "embeddings");
	return { models: chat.map((entry) => entry.id), loaded: chat.filter((entry) => entry.state === "loaded").map((entry) => entry.id) };
}
