/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/tgi/chunk.mjs
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
 * @fileoverview Hugging Face TGI driver: streaming chunk normalizer (Chat Completions chunk).
 * @module @cldmv/llm-translator/driver/tgi
 */
import { finish, toolCalls } from "../../../lib/tgi.mjs";

/**
 * Put a streamed TGI chunk into the OpenAI shape: `delta.tool_calls` as one object becomes a list, numeric ids become strings, object
 * `arguments` become a JSON string, an empty id (TGI repeats the field on every fragment) is removed so the fragment continues the open
 * call, and `eos_token` / `stop_sequence` finish reasons become `stop` (or `tool_calls` once the stream carried calls).
 * @param {any} chunk - Parsed `chat.completion.chunk`.
 * @param {any} [ctx] - `{ state }`; remembers whether the stream carried tool calls.
 * @returns {any} Normalized chunk.
 */
export function chunk(chunk, ctx) {
	if (!Array.isArray(chunk?.choices)) return chunk;
	const seen = ctx?.state ?? {};
	return {
		...chunk,
		choices: chunk.choices.map((choice) => {
			if (choice === null || typeof choice !== "object") return choice;
			const next = { ...choice };
			const calls = toolCalls(choice.delta?.tool_calls);
			if (calls !== undefined) {
				seen.tgiToolCalls = true;
				next.delta = { ...choice.delta, tool_calls: calls.map((call) => (call?.id === "" ? withoutId(call) : call)) };
			}
			if (choice.finish_reason !== undefined) next.finish_reason = finish(choice.finish_reason, seen.tgiToolCalls === true);
			return next;
		})
	};
}

/**
 * A copy of a tool call without its `id`.
 * @param {any} call - Tool call.
 * @returns {any} Call without the id.
 */
function withoutId(call) {
	const rest = { ...call };
	delete rest.id;
	return rest;
}
