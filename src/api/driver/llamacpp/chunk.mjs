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

const OPEN = "<think>";
const CLOSE = "</think>";

/**
 * Remove the `<think>...</think>` block that `--reasoning-format deepseek-legacy` repeats in `content` after sending the same reasoning in
 * `reasoning_content`. Only content that starts with the open tag, after reasoning has appeared in this stream, is touched; other content
 * (the `deepseek` format, plain answers) passes unchanged. A tag split across chunks is handled by holding the undecided text in
 * `state.thinkLegacy`.
 * @param {any} delta - Chunk delta.
 * @param {any} state - Request state.
 * @returns {any} The delta, with `content` trimmed when it carried the duplicate.
 */
function legacy(delta, state) {
	const seen = (state.thinkLegacy ??= { reasoning: false, mode: "start", held: "" });
	if (typeof delta.reasoning_content === "string" && delta.reasoning_content !== "") seen.reasoning = true;
	if (!seen.reasoning || seen.mode === "plain" || typeof delta.content !== "string" || delta.content === "") return delta;
	let buffer = seen.held + delta.content;
	seen.held = "";
	if (seen.mode === "start") {
		const trimmed = buffer.trimStart();
		if (trimmed.startsWith(OPEN)) {
			seen.mode = "drop";
			buffer = trimmed.slice(OPEN.length);
		} else if (trimmed === "" || OPEN.startsWith(trimmed)) {
			seen.held = buffer;
			return { ...delta, content: "" };
		} else {
			seen.mode = "plain";
			return { ...delta, content: buffer };
		}
	}
	const end = buffer.indexOf(CLOSE);
	if (end === -1) {
		// Everything so far is the duplicate; keep the tail in case the close tag is split across chunks.
		seen.held = buffer.slice(-(CLOSE.length - 1));
		return { ...delta, content: "" };
	}
	seen.mode = "plain";
	return { ...delta, content: buffer.slice(end + CLOSE.length).trimStart() };
}

/**
 * Give a streamed tool call that starts without an id one. The id is made when the call's name first arrives (the first fragment of the call);
 * later fragments of the same call carry no id, as in OpenAI streams. Ids made so far are kept in `state.toolIds` (index to id).
 * @param {any} delta - Chunk delta.
 * @param {any} state - Request state.
 * @returns {any} The delta, with ids added.
 */
function ids(delta, state) {
	if (!Array.isArray(delta.tool_calls)) return delta;
	const made = (state.toolIds ??= {});
	return {
		...delta,
		tool_calls: delta.tool_calls.map((call) => {
			const key = call?.index ?? 0;
			if (call?.id || !call?.function?.name || made[key] !== undefined) return call;
			made[key] = callId();
			return { ...call, id: made[key] };
		})
	};
}

/**
 * Normalize a streamed chunk: drop the duplicate reasoning block of `deepseek-legacy` and give tool calls without an id one.
 * @param {any} chunk - Parsed `chat.completion.chunk`.
 * @param {any} [ctx] - `{ state }`.
 * @returns {any} Normalized chunk.
 */
export function chunk(chunk, ctx) {
	const delta = chunk?.choices?.[0]?.delta;
	if (!ctx?.state || delta === null || typeof delta !== "object") return chunk;
	const next = ids(legacy(delta, ctx.state), ctx.state);
	if (next === delta) return chunk;
	const [first, ...rest] = chunk.choices;
	return { ...chunk, choices: [{ ...first, delta: next }, ...rest] };
}
