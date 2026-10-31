/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/route.mjs
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
 * @fileoverview Root api: resolve where a client request would go, without sending it.
 * @module @cldmv/llm-translator/route
 */
import { context, self } from "../lib/runtime.mjs";
import { capture } from "../lib/capture.mjs";
import { resolve } from "../lib/route.mjs";

/**
 * Resolve a client request body to its upstream and model (after aliases and routing) without doing any I/O, for example to
 * check a model allow-list before `send`. Uses the same routing as `request`.
 * @param {any} body - Client request body (Anthropic Messages or OpenAI Chat Completions, per `front`).
 * @param {any} [options] - `{ front }` overrides the configured front for this call.
 * @returns {{upstream: string, model: string, requested: string | undefined, protocol: string, backend: string, native: boolean, unserved: boolean}} `upstream` is the endpoint name, `model` the name sent upstream, `requested` the name the client used, `protocol` the upstream's protocol (`openai.chat` or `anthropic.messages`), `backend` its detected backend, `native` whether the body is forwarded without conversion and `unserved` whether no upstream lists the model.
 * @throws {TranslatorError} `invalid_body` (400) when the body is not a JSON object.
 */
export function route(body, options = {}) {
	const c = capture(self, context, options.front);
	const { endpoint, model, requested, unserved, convert } = resolve(c, body);
	return {
		upstream: endpoint.name,
		model,
		requested,
		protocol: endpoint.protocol,
		backend: endpoint.backend,
		native: convert === null,
		unserved
	};
}
