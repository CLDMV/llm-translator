/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/bedrock/path.mjs
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
 * @fileoverview Amazon Bedrock driver: URL path of each call.
 * @module @cldmv/llm-translator/driver/bedrock
 */
import { TranslatorError } from "../../../lib/errors.mjs";
import { modelPath } from "../../../lib/bedrock.mjs";

/**
 * Build the path of a call: the model id (percent-encoded as one segment) and the operation. InvokeModel is `/invoke`, or
 * `/invoke-with-response-stream` for a stream; Converse is `/converse`, or `/converse-stream`.
 * @param {"messages" | "converse"} kind - Which call: `messages` is InvokeModel with an Anthropic body.
 * @param {any} context - `{ endpoint, model, stream }`.
 * @returns {string} Path starting with `/model/`.
 * @throws {TranslatorError} `unsupported_endpoint` (501) for any other call (embeddings, chat).
 */
export function path(kind, { model, stream }) {
	if (kind === "messages") return `${modelPath(model)}/${stream ? "invoke-with-response-stream" : "invoke"}`;
	if (kind === "converse") return `${modelPath(model)}/${stream ? "converse-stream" : "converse"}`;
	throw new TranslatorError(`The bedrock driver has no ${kind} call; it serves Anthropic Messages (InvokeModel) and Converse`, {
		code: "unsupported_endpoint",
		status: 501
	});
}
