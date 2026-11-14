/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/tgi/info.mjs
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
 * @fileoverview Hugging Face TGI driver: static facts about Text Generation Inference.
 * @module @cldmv/llm-translator/driver/tgi
 */

/**
 * Describe the TGI driver. It is found through `GET /info`, TGI's router description. `grammar` is allowed through the OpenAI front's
 * request filter because the request normalizer folds it into `response_format`, the only place the chat endpoint reads a grammar.
 * @returns {{name: string, protocol: string, order: number, auth: string, strict: boolean, probes: string[], fields: string[], paths: Record<string,string>}} Driver facts.
 */
export function info() {
	return {
		name: "tgi",
		protocol: "openai.chat",
		order: 45,
		auth: "bearer",
		strict: false,
		probes: ["/info"],
		fields: ["grammar"],
		paths: { chat: "/v1/chat/completions", models: "/v1/models", info: "/info" }
	};
}
