/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/vertex/info.mjs
 *	@Date: 2026-11-19T09:00:00-08:00 (1795107600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-19T09:00:00-08:00 (1795107600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Vertex AI driver: static facts about Claude and Gemini on Google Vertex AI.
 * @module @cldmv/llm-translator/driver/vertex
 */

import { HOSTS } from "../../../lib/vertex.mjs";

/**
 * Describe the Vertex AI driver. The paths come from the `path` leaf, because they hold the project, the region and the model; the key (a Google
 * access token) is added as a bearer token by the `auth` leaf. Vertex AI takes no `anthropic-version` header (the version is in the body). Claude goes over
 * `anthropic.messages` (`rawPredict`); Google-published Gemini models go over `google.gemini` (`generateContent`), chosen by the model id under
 * `api: "auto"` (see `lib/capture`) or by an explicit `api`.
 * @returns {{name: string, protocol: string, protocols: string[], order: number, auth: string, strict: boolean, hosts: string[], hostSuffixes: string[], paths: Record<string,string>}} Driver facts.
 */
export function info() {
	return {
		name: "vertex",
		protocol: "anthropic.messages",
		protocols: ["anthropic.messages", "google.gemini"],
		order: 39,
		auth: "bearer",
		strict: false,
		hosts: HOSTS,
		hostSuffixes: ["-aiplatform.googleapis.com"],
		paths: {}
	};
}
