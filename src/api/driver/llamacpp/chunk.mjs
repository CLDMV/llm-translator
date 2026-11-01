/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/llamacpp/chunk.mjs
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
 * @fileoverview llama.cpp driver: streaming chunk normalizer (Chat Completions chunk).
 * @module @cldmv/llm-translator/driver/llamacpp
 */
import { callId } from "../../../lib/ids.mjs";

/**
 * Give a streamed tool call that starts without an id one. The id is made when the call's name first arrives (the first fragment of the call);
 * later fragments of the same call carry no id, as in OpenAI streams. Ids made so far are kept in `ctx.state.toolIds` (index to id).
 * @param {any} chunk - Parsed `chat.completion.chunk`.
 * @param {any} [ctx] - `{ state }`.
 * @returns {any} Normalized chunk.
 */
export function chunk(chunk, ctx) {
	const calls = chunk?.choices?.[0]?.delta?.tool_calls;
	if (!Array.isArray(calls) || !ctx?.state) return chunk;
	const ids = (ctx.state.toolIds ??= {});
	const next = calls.map((call) => {
		const key = call?.index ?? 0;
		if (call?.id || !call?.function?.name || ids[key] !== undefined) return call;
		ids[key] = callId();
		return { ...call, id: ids[key] };
	});
	const [first, ...rest] = chunk.choices;
	return { ...chunk, choices: [{ ...first, delta: { ...first.delta, tool_calls: next } }, ...rest] };
}
