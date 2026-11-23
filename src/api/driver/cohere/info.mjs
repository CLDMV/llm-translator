/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/cohere/info.mjs
 *	@Date: 2026-11-21T10:00:00-08:00 (1795284000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-21T10:00:00-08:00 (1795284000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Cohere driver: static facts about the hosted API.
 * @module @cldmv/llm-translator/driver/cohere
 */
import { HOSTS } from "../../../lib/cohere.mjs";

/**
 * Describe the Cohere driver. `protocol` is the OpenAI Compatibility API (`/compatibility/v1/chat/completions`); `cohere.chat`, Cohere's own
 * `/v2/chat`, is used when an upstream selects it with `api: "cohere"` (nothing under `auto` speaks it). The real paths come from the `path` leaf,
 * because the native API sits outside the Compatibility API's path root.
 * @returns {{name: string, protocol: string, protocols: string[], order: number, auth: string, strict: boolean, n: boolean, hosts: string[], paths: Record<string,string>}} Driver facts.
 */
export function info() {
	return {
		name: "cohere",
		protocol: "openai.chat",
		protocols: ["openai.chat", "cohere.chat"],
		order: 26,
		auth: "bearer",
		strict: false,
		// The Compatibility API has no `n`; the translator answers a request for several choices with parallel requests.
		n: false,
		hosts: [...HOSTS],
		paths: {
			chat: "/compatibility/v1/chat/completions",
			embeddings: "/compatibility/v1/embeddings",
			models: "/v1/models"
		}
	};
}
