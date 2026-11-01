/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/model/get.mjs
 *	@Date: 2026-10-26T06:00:20-07:00 (1793019620)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-26T15:38:55-07:00 (1793054335)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Root api: retrieve one model in the client protocol's shape.
 * @module @cldmv/llm-translator/model
 */
import { context, self } from "../../lib/runtime.mjs";
import { TranslatorError } from "../../lib/errors.mjs";

/**
 * Retrieve one entry of the model list (`model.list`) by id, in the client protocol's model shape (Anthropic `{type:"model",...}` or
 * OpenAI `{object:"model",...}`). Aliases are found like served models.
 * @param {string} id - Model id as the client sends it.
 * @param {any} [options] - `{ signal, front }`.
 * @returns {Promise<any>} Model object.
 * @throws {TranslatorError} `model_not_found` (HTTP 404) when no upstream serves the id and it is not an alias.
 */
export async function get(id, options = {}) {
	const front = options.front ?? context.config.front;
	const { data } = await self.model.list(options);
	const found = data.find((entry) => entry.id === id);
	if (found) return found;
	throw new TranslatorError(front === "openai" ? `The model '${id}' does not exist` : `model: ${id}`, {
		code: "model_not_found",
		status: 404,
		param: "model"
	});
}
