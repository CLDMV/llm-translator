/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/tgi/request.mjs
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
 * @fileoverview Hugging Face TGI driver: request normalizer (Chat Completions body).
 * @module @cldmv/llm-translator/driver/tgi
 */
import { noEmptyTools } from "../../../lib/normalize.mjs";
import { grammar } from "../../../lib/tgi.mjs";

/**
 * Drop tool fields when there are no tools; fold a client's `grammar` into `response_format` (the chat endpoint reads a grammar only
 * there) and rewrite `response_format` into TGI's shape; and drop `response_format` when the request also has tools, which TGI refuses
 * (the tools win, and the drop is recorded in `state.dropped`).
 * @param {any} body - Chat Completions request body.
 * @param {any} [ctx] - `{ state }`.
 * @returns {any} Normalized body.
 */
export function request(body, ctx) {
	const out = { ...noEmptyTools(body) };
	if (out.grammar !== undefined) {
		if (out.response_format === undefined) out.response_format = out.grammar;
		delete out.grammar;
	}
	if (out.response_format !== undefined) {
		if (out.tools !== undefined) {
			delete out.response_format;
			const dropped = ctx?.state?.dropped;
			if (Array.isArray(dropped) && !dropped.includes("response_format")) dropped.push("response_format");
		} else out.response_format = grammar(out.response_format);
	}
	return out;
}
