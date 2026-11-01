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
import { sign, reasoningOf, reasoningKey, detailsText, mergeDetail, createThinkSplitter } from "../../../../../../../lib/thinking.mjs";
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
	const splitter = s.thinkTags ? createThinkSplitter(s.thinkOpen) : null;
	const tools = new Map();
	let started = false;
	let nextIndex = 0;
	let open = null;
	let usage = null;
	let finish = null;
	let matchedStop = null;
	let done = false;
	let lastTool = 0;
	// The server sends reasoning in its own field, so content is never split (as in the non-streaming conversion).
	let ownReasoning = false;
	// Set once a tool call had to wait for the think splitter to decide; later calls then wait too, so tool blocks keep their order.
	let waitForSplit = false;
	// True after reasoning and until the answer has its first visible character: leading whitespace is dropped.
	let trimNext = false;
	// Text and reasoning that arrives while a tool block is open waits until the tool blocks are done, because blocks stream one at a time.
	const held = [];

	const event = (type, fields) => ({ event: type, data: { type, ...fields } });
	const fail = (type, message) => event("error", { error: { type, message } });

	// The provider reasoning fields of the thinking block being written, carried in its signature when `reasoningRoundTrip` is on.
	const carried = (carry) => {
		const data = {};
		if (s.reasoningRoundTrip) {
			if (carry.key !== null) data[carry.key] = carry.text;
			if (carry.details.length > 0) data.reasoning_details = carry.details;
		}
		return Object.keys(data).length > 0 ? data : undefined;
	};

	function* close() {
		if (open === null) return;
		if (open.kind === "thinking") {
			yield event("content_block_delta", {
				index: open.index,
				delta: { type: "signature_delta", signature: sign(carried(open.carry), state?.producer) }
			});
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
		open = { kind, index: nextIndex++, entry, carry: { key: null, text: "", details: [] } };
		yield event("content_block_start", { index: open.index, content_block: block });
	}

	function* piece(kind, text, key = null) {
		// Models put blank lines between their reasoning and the answer; Anthropic's answers do not start with them.
		if (kind === "text" && trimNext) text = text.trimStart();
		if (text === "") return;
		trimNext = kind === "thinking";
		if (open?.kind === "tool") {
			held.push({ kind, text, key });
			return;
		}
		if (open?.kind !== kind) {
			yield* begin(kind, kind === "text" ? { type: "text", text: "" } : { type: "thinking", thinking: "", signature: "" });
		}
		if (key !== null) {
			open.carry.key ??= key;
			open.carry.text += text;
		}
		const delta = kind === "text" ? { type: "text_delta", text } : { type: "thinking_delta", thinking: text };
		yield event("content_block_delta", { index: open.index, delta });
	}

	// Structured reasoning (`reasoning_details`) belongs to the open thinking block, which it opens when nothing else has. Fragments of one item
	// (same index and type) are merged, so the signature carries the same items a JSON reply would.
	function* details(items) {
		if (open?.kind === "tool") {
			held.push({ kind: "details", items });
			return;
		}
		if (open?.kind !== "thinking") yield* begin("thinking", { type: "thinking", thinking: "", signature: "" });
		for (const fragment of items) mergeDetail(open.carry.details, fragment);
		// A thought that arrives only as structured details still needs readable text, as in the JSON conversion.
		if (open.carry.key === null) yield* piece("thinking", detailsText(items));
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
			if (splitter?.pending()) waitForSplit = true;
			const buffer = s.toolStreaming === "buffer" || waitForSplit;
			entry = { state: buffer ? "buffered" : "pending", sent: false, args: [], block };
			tools.set(key, entry);
			// Buffered calls wait for the end of the stream. Otherwise only one block can stream at a time: a call that starts
			// while a tool block is open waits until it closes.
			if (!buffer && open?.kind !== "tool") {
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
			if (chunk.usage) {
				usage = chunk.usage;
				// Kept for `send`, whose usage report wants the upstream's own counts rather than the numbers written for the client.
				if (state) state.upstreamUsage = chunk.usage;
			}
			const choice = chunk.choices?.[0];
			if (!choice) continue;
			const delta = choice.delta ?? {};
			const reasoning = reasoningOf(delta);
			// Content the splitter was still holding is answer text, but the thinking block comes first (as in the non-streaming conversion).
			let released = "";
			if (reasoning !== "" && !ownReasoning) {
				ownReasoning = true;
				if (splitter) released = splitter.release().text;
			}
			yield* piece("thinking", reasoning, reasoningKey(delta));
			yield* piece("text", released);
			if (s.reasoningRoundTrip && Array.isArray(delta.reasoning_details) && delta.reasoning_details.length > 0) {
				yield* details(delta.reasoning_details);
			}
			if (typeof delta.content === "string" && delta.content !== "") {
				if (splitter && !ownReasoning) yield* pieces(splitter.push(delta.content));
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
	for (const item of held) yield* item.kind === "details" ? details(item.items) : piece(item.kind, item.text, item.key);
	yield* close();
	if (nextIndex === 0) {
		yield* begin("text", { type: "text", text: "" });
		yield* close();
	}
	const stop = toAnthropicStop(finish, { hasToolCalls: tools.size > 0, matchedStop, argumentsComplete });
	yield event("message_delta", { delta: stop, usage: toAnthropicUsage(usage) });
	yield event("message_stop", {});
}
