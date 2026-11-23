/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/openai/chat/to/openai/responses/stream.mjs
 *	@Date: 2026-11-17T12:00:00-08:00 (1794945600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-17T12:00:00-08:00 (1794945600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview OpenAI Chat Completions chunks to OpenAI Responses stream events.
 */

import { resolve } from "../../../../../../../lib/settings.mjs";
import { finishError } from "../../../../../../../lib/finish.mjs";
import { itemId, pack, usageOf, endOf, envelope, failureOf } from "../../../../../../../lib/responses.mjs";
import { messages } from "../../../../../../../lib/sse.mjs";
import { mergeDetail, reasoningOf } from "../../../../../../../lib/thinking.mjs";
import { readAll, toResponses } from "../../../../../../../lib/citations.mjs";

/**
 * Convert a Chat Completions chunk stream into Responses events.
 *
 * `source` is SSE text/bytes, an iterable of `{ data }` messages, or bare chunk objects. The result yields `{ event, data }` pairs
 * (`data.type` repeats the event name, `data.sequence_number` counts from 0): `response.created` and `response.in_progress` first, then for each output
 * item `response.output_item.added`, its part and delta events, and `response.output_item.done`, and last `response.completed` (or
 * `response.incomplete` after a length stop or a content filter). Output items come in the order the deltas start them: reasoning
 * (as a summary part), the message text (or refusal) and one function call per tool call index. An `error` chunk, a fatal finish reason or
 * a stream that ends without a finish reason ends with `response.failed`. Annotations (`delta.annotations`) are sent as `response.output_text.annotation.added` events and are in the closed part. There is no `[DONE]` sentinel.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - Chat Completions stream.
 * @param {any} state - State from the request converter (`model`, `echo`).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ event: string, data: any }, void, undefined>} Responses events.
 */
export async function* stream(source, state, settings) {
	const s = resolve(settings);
	const id = itemId("resp");
	const created = Math.floor(Date.now() / 1000);
	let model = state.model;
	let sequence = 0;
	let usage = null;
	let finish = null;
	/** Finished output items, by output index. */
	const output = [];
	/** The open reasoning or message item, and the open function call items by tool call index. */
	let reasoning = null;
	/** @type {{ index: number, item: any, kind: string, value: string, annotations: any[] } | null} */
	let text = null;
	// Annotations that arrived before the message item they belong to was open.
	const queued = [];
	const calls = new Map();

	const emit = (type, data) => ({ event: type, data: { type, ...data, sequence_number: sequence++ } });
	const snapshot = (status, extra = {}) =>
		envelope(state, { id, created, model, status, output: output.filter(Boolean), usage: usageOf(usage), ...extra });
	const open = (item) => {
		const index = output.length;
		output.push(null);
		return { index, item };
	};

	/**
	 * Close the open reasoning item.
	 * @returns {Generator<any>} Events.
	 */
	function* closeReasoning() {
		if (reasoning === null) return;
		const { index, item, summary, details } = reasoning;
		const carrier = s.reasoningRoundTrip ? pack(details) : undefined;
		const done = {
			...item,
			summary: summary === "" ? [] : [{ type: "summary_text", text: summary }],
			...(carrier === undefined ? {} : { encrypted_content: carrier }),
			status: "completed"
		};
		if (summary !== "") {
			yield emit("response.reasoning_summary_text.done", { item_id: item.id, output_index: index, summary_index: 0, text: summary });
			yield emit("response.reasoning_summary_part.done", {
				item_id: item.id,
				output_index: index,
				summary_index: 0,
				part: { type: "summary_text", text: summary }
			});
		}
		output[index] = done;
		yield emit("response.output_item.done", { output_index: index, item: done });
		reasoning = null;
	}

	/**
	 * Close the open message item.
	 * @returns {Generator<any>} Events.
	 */
	function* closeText() {
		if (text === null) return;
		const { index, item, kind, value } = text;
		const part =
			kind === "refusal"
				? { type: "refusal", refusal: value }
				: { type: "output_text", text: value, annotations: text.annotations, logprobs: [] };
		if (kind === "refusal")
			yield emit("response.refusal.done", { item_id: item.id, output_index: index, content_index: 0, refusal: value });
		else yield emit("response.output_text.done", { item_id: item.id, output_index: index, content_index: 0, text: value, logprobs: [] });
		yield emit("response.content_part.done", { item_id: item.id, output_index: index, content_index: 0, part });
		const done = { ...item, status: "completed", content: [part] };
		output[index] = done;
		yield emit("response.output_item.done", { output_index: index, item: done });
		text = null;
	}

	/**
	 * Open the message item for text or a refusal when none is open.
	 * @param {string} answer - `"text"` or `"refusal"`.
	 * @returns {Generator<any>} Events.
	 */
	function* openText(answer) {
		if (text !== null) return;
		const started = open({ type: "message", id: itemId("msg"), status: "in_progress", role: "assistant", content: [] });
		text = { ...started, kind: answer, value: "", annotations: [] };
		yield emit("response.output_item.added", { output_index: started.index, item: started.item });
		yield emit("response.content_part.added", {
			item_id: started.item.id,
			output_index: started.index,
			content_index: 0,
			part: answer === "refusal" ? { type: "refusal", refusal: "" } : { type: "output_text", text: "", annotations: [], logprobs: [] }
		});
	}

	/**
	 * Send the queued annotations on the open message text.
	 * @returns {Generator<any>} Events.
	 */
	function* annotate() {
		if (text?.kind !== "text") return;
		for (const annotation of queued.splice(0)) {
			yield emit("response.output_text.annotation.added", {
				item_id: text.item.id,
				output_index: text.index,
				content_index: 0,
				annotation_index: text.annotations.length,
				annotation
			});
			text.annotations.push(annotation);
		}
	}

	/**
	 * Close every open function call, in output order.
	 * @returns {Generator<any>} Events.
	 */
	function* closeCalls() {
		for (const call of [...calls.values()].sort((left, right) => left.index - right.index)) {
			yield emit("response.function_call_arguments.done", {
				item_id: call.item.id,
				output_index: call.index,
				name: call.item.name,
				arguments: call.arguments
			});
			const done = { ...call.item, arguments: call.arguments, status: "completed" };
			output[call.index] = done;
			yield emit("response.output_item.done", { output_index: call.index, item: done });
		}
		calls.clear();
	}

	/**
	 * End the response as failed.
	 * @param {{code: string, message: string}} error - The failure.
	 * @returns {Generator<any>} Events.
	 */
	function* fail(error) {
		yield emit("response.failed", { response: snapshot("failed", { error }) });
	}

	yield emit("response.created", { response: snapshot("in_progress", { usage: null }) });
	yield emit("response.in_progress", { response: snapshot("in_progress", { usage: null }) });

	try {
		for await (const { data } of messages(source)) {
			if (data === "[DONE]") break;
			if (data?.error) {
				yield* fail(failureOf(data.error));
				return;
			}
			model ??= data.model;
			if (data.usage) usage = data.usage;
			const choice = data.choices?.[0];
			if (!choice) continue;
			const delta = choice.delta ?? {};
			const thought = reasoningOf(delta);
			if (thought !== "" || Array.isArray(delta.reasoning_details)) {
				if (reasoning === null) {
					const started = open({ type: "reasoning", id: itemId("rs"), summary: [], status: "in_progress" });
					reasoning = { ...started, summary: "", details: [] };
					yield emit("response.output_item.added", { output_index: started.index, item: started.item });
				}
				for (const fragment of delta.reasoning_details ?? []) mergeDetail(reasoning.details, fragment);
				if (thought !== "") {
					if (reasoning.summary === "") {
						yield emit("response.reasoning_summary_part.added", {
							item_id: reasoning.item.id,
							output_index: reasoning.index,
							summary_index: 0,
							part: { type: "summary_text", text: "" }
						});
					}
					reasoning.summary += thought;
					yield emit("response.reasoning_summary_text.delta", {
						item_id: reasoning.item.id,
						output_index: reasoning.index,
						summary_index: 0,
						delta: thought
					});
				}
			}
			const answer = typeof delta.content === "string" && delta.content !== "" ? "text" : delta.refusal ? "refusal" : null;
			if (answer !== null) {
				yield* closeReasoning();
				if (text !== null && text.kind !== answer) yield* closeText();
				yield* openText(answer);
				const piece = answer === "refusal" ? delta.refusal : delta.content;
				text.value += piece;
				if (answer === "refusal") {
					yield emit("response.refusal.delta", { item_id: text.item.id, output_index: text.index, content_index: 0, delta: piece });
				} else {
					yield emit("response.output_text.delta", {
						item_id: text.item.id,
						output_index: text.index,
						content_index: 0,
						delta: piece,
						logprobs: []
					});
				}
			}
			if (s.citations !== "none") for (const citation of readAll(delta.annotations)) queued.push(toResponses(citation));
			yield* annotate();
			for (const call of delta.tool_calls ?? []) {
				const key = call.index ?? 0;
				if (!calls.has(key)) {
					yield* closeReasoning();
					yield* closeText();
					const started = open({
						type: "function_call",
						id: itemId("fc"),
						call_id: call.id ?? "",
						name: call.function?.name ?? "",
						arguments: "",
						status: "in_progress"
					});
					calls.set(key, { ...started, arguments: "" });
					yield emit("response.output_item.added", { output_index: started.index, item: started.item });
				}
				const known = calls.get(key);
				if (call.id && known.item.call_id === "") known.item.call_id = call.id;
				if (call.function?.name && known.item.name === "") known.item.name = call.function.name;
				const piece = call.function?.arguments;
				if (typeof piece === "string" && piece !== "") {
					known.arguments += piece;
					yield emit("response.function_call_arguments.delta", { item_id: known.item.id, output_index: known.index, delta: piece });
				}
			}
			if (choice.finish_reason) finish = choice.finish_reason;
		}
	} catch (error) {
		yield* fail(failureOf(error));
		return;
	}

	const fatal = finishError(finish);
	if (fatal) {
		yield* fail({ code: fatal.code, message: fatal.message });
		return;
	}
	if (finish === null) {
		yield* fail({ code: "server_error", message: "Upstream stream ended before completion" });
		return;
	}
	yield* closeReasoning();
	// Annotations on a reply with no text are carried by an empty message item.
	if (queued.length > 0) yield* openText("text");
	yield* annotate();
	yield* closeText();
	yield* closeCalls();
	const end = endOf(finish);
	yield emit(end.status === "completed" ? "response.completed" : "response.incomplete", { response: snapshot(end.status, end) });
}
