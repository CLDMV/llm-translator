/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/openai/chat/to/anthropic/messages/stream.mjs
 *	@Date: 2026-10-25T12:28:19-07:00 (1792956499)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T13:31:27-07:00 (1792960287)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview OpenAI Chat Completions stream to Anthropic Messages stream events.
 */

import { resolve } from "../../../../../../../lib/settings.mjs";
import { TranslatorError, openaiToAnthropicType, rewriteContextOverflow } from "../../../../../../../lib/errors.mjs";
import { isComplete } from "../../../../../../../lib/arguments.mjs";
import { messageId, anthropicToolId, restoreName } from "../../../../../../../lib/ids.mjs";
import { sign, reasoningOf, createThinkSplitter } from "../../../../../../../lib/thinking.mjs";
import { toAnthropicStop, toAnthropicUsage } from "../../../../../../../lib/finish.mjs";
import { messages } from "../../../../../../../lib/sse.mjs";

/**
 * Convert an OpenAI chat-completion stream into Anthropic Messages stream events.
 *
 * `source` is SSE text/bytes (string, `Uint8Array`, `ReadableStream`, async or sync iterable of either) or an
 * iterable of already-parsed chunk objects. Handles reasoning (`reasoning`, `reasoning_content`, leading
 * `<think>`), the three vLLM tool-call delta shapes (id+name first then argument fragments, name and arguments
 * together, whole call at once), usage-only final chunks, `[DONE]`, mid-stream `{"error":...}` objects (answered
 * with an Anthropic `error` event) and closing the iterator early (the upstream source is closed too). Pings are
 * the SSE writer's job, not this converter's.
 *
 * Tool calls follow `settings.toolStreaming`. `buffer` (default) holds every call until the stream finishes and then emits
 * each one, in index order, as a single complete `tool_use` block (start, one `input_json_delta`, stop); text and
 * thinking stream immediately, so they appear before the tool blocks and no argument fragment can arrive too late.
 * `stream` forwards argument fragments incrementally; calls that start while a tool block is streaming are buffered and
 * emitted whole when it closes, and text that arrives meanwhile is held until the tool blocks are done.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - OpenAI stream.
 * @param {any} [state] - State from the request converter (original model, tool-name map).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ event: string, data: any }, void, undefined>} Anthropic events.
 */
export async function* stream(source, state, settings) {
	const s = resolve(settings);
	const toolNames = state?.toolNames ?? {};
	const splitter = s.thinkTags ? createThinkSplitter() : null;
	const tools = new Map();
	let started = false;
	let nextIndex = 0;
	let open = null;
	let usage = null;
	let finish = null;
	let matchedStop = null;
	let done = false;
	let lastTool = 0;
	// Text and reasoning that arrives while a tool block is open waits until the tool blocks are done, because blocks stream one at a time.
	const held = [];

	const event = (type, fields) => ({ event: type, data: { type, ...fields } });
	const fail = (type, message) => event("error", { error: { type, message } });

	function* close() {
		if (open === null) return;
		if (open.kind === "thinking") {
			yield event("content_block_delta", { index: open.index, delta: { type: "signature_delta", signature: sign() } });
		} else if (open.kind === "tool") {
			open.entry.state = "closed";
			if (!open.entry.sent)
				yield event("content_block_delta", { index: open.index, delta: { type: "input_json_delta", partial_json: "{}" } });
		}
		yield event("content_block_stop", { index: open.index });
		open = null;
		// Tool calls that arrived while another tool block was streaming are emitted whole, in arrival order.
		for (const entry of tools.values()) {
			if (entry.state !== "pending") continue;
			entry.state = "closed";
			const index = nextIndex++;
			const partial = entry.args.join("");
			yield event("content_block_start", { index, content_block: entry.block });
			yield event("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: partial === "" ? "{}" : partial } });
			yield event("content_block_stop", { index });
		}
	}

	// `buffer` mode: every tool call is emitted whole, in index order, once the stream has finished.
	function* flushBuffered() {
		for (const entry of ordered()) {
			if (entry.state !== "buffered") continue;
			yield* begin("tool", entry.block, entry);
			const partial = entry.args.join("");
			if (partial !== "") {
				entry.sent = true;
				yield event("content_block_delta", { index: open.index, delta: { type: "input_json_delta", partial_json: partial } });
			}
			yield* close();
		}
	}

	function ordered() {
		return [...tools.entries()].sort((left, right) => left[0] - right[0]).map((pair) => pair[1]);
	}

	function* begin(kind, block, entry) {
		yield* close();
		open = { kind, index: nextIndex++, entry };
		yield event("content_block_start", { index: open.index, content_block: block });
	}

	function* piece(kind, text) {
		if (text === "") return;
		if (open?.kind === "tool") {
			held.push({ kind, text });
			return;
		}
		if (open?.kind !== kind) {
			yield* begin(kind, kind === "text" ? { type: "text", text: "" } : { type: "thinking", thinking: "", signature: "" });
		}
		const delta = kind === "text" ? { type: "text_delta", text } : { type: "thinking_delta", thinking: text };
		yield event("content_block_delta", { index: open.index, delta });
	}

	function* pieces(split) {
		yield* piece("thinking", split.reasoning);
		yield* piece("text", split.text);
	}

	function* toolCall(call) {
		let key = call.index;
		if (key === undefined) key = call.id === undefined ? lastTool : tools.size;
		lastTool = key;
		let entry = tools.get(key);
		if (entry === undefined) {
			const name = call.function?.name ?? "";
			const block = { type: "tool_use", id: anthropicToolId(call.id), name: restoreName(toolNames, name), input: {} };
			entry = { state: s.toolStreaming === "buffer" ? "buffered" : "pending", sent: false, args: [], block };
			tools.set(key, entry);
			// Buffered calls wait for the end of the stream. Otherwise only one block can stream at a time: a call that starts
			// while a tool block is open waits until it closes.
			if (s.toolStreaming !== "buffer" && open?.kind !== "tool") {
				entry.state = "open";
				yield* begin("tool", block, entry);
			}
		}
		let args = call.function?.arguments;
		if (args !== null && typeof args === "object") args = JSON.stringify(args);
		if (args === undefined || args === null || args === "") return;
		entry.args.push(args);
		if (entry.state === "open") {
			entry.sent = true;
			yield event("content_block_delta", { index: open.index, delta: { type: "input_json_delta", partial_json: args } });
		}
	}

	try {
		for await (const message of messages(source)) {
			if (message.data === "[DONE]") {
				done = true;
				break;
			}
			const chunk = message.data;
			if (chunk.error) {
				const text = chunk.error.message ?? "Upstream error";
				yield fail(openaiToAnthropicType(chunk.error), rewriteContextOverflow(text) ?? text);
				return;
			}
			if (!started) {
				started = true;
				yield event("message_start", {
					message: {
						id: messageId(),
						type: "message",
						role: "assistant",
						model: state?.model ?? chunk.model,
						content: [],
						stop_reason: null,
						stop_sequence: null,
						usage: toAnthropicUsage(chunk.usage)
					}
				});
			}
			if (chunk.usage) usage = chunk.usage;
			const choice = chunk.choices?.[0];
			if (!choice) continue;
			const delta = choice.delta ?? {};
			yield* piece("thinking", reasoningOf(delta));
			if (typeof delta.content === "string" && delta.content !== "") {
				if (splitter) yield* pieces(splitter.push(delta.content));
				else yield* piece("text", delta.content);
			}
			for (const call of delta.tool_calls ?? []) yield* toolCall(call);
			if (choice.finish_reason) finish = choice.finish_reason;
			if (typeof choice.stop_reason === "string") matchedStop = choice.stop_reason;
		}
	} catch (error) {
		yield error instanceof TranslatorError ? fail(error.type, error.message) : fail("api_error", error.message);
		return;
	}

	if (!started || (finish === null && !done)) {
		const reason = started ? "Upstream stream ended before completion" : "Upstream stream ended without data";
		yield fail("api_error", reason);
		return;
	}
	if (splitter) yield* pieces(splitter.end());
	yield* flushBuffered();
	const last = ordered().at(-1);
	const argumentsComplete = last === undefined || isComplete(last.args.join(""));
	yield* close();
	for (const item of held) yield* piece(item.kind, item.text);
	yield* close();
	if (nextIndex === 0) {
		yield* begin("text", { type: "text", text: "" });
		yield* close();
	}
	const stop = toAnthropicStop(finish, { hasToolCalls: tools.size > 0, matchedStop, argumentsComplete });
	yield event("message_delta", { delta: stop, usage: toAnthropicUsage(usage) });
	yield event("message_stop", {});
}
