/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/openai/chat/to/openai/responses/response.mjs
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
 * @fileoverview OpenAI Chat Completions response to OpenAI Responses response.
 */

import { resolve } from "../../../../../../../lib/settings.mjs";
import { TranslatorError } from "../../../../../../../lib/errors.mjs";
import { itemId, pack, usageOf, endOf, envelope } from "../../../../../../../lib/responses.mjs";
import { reasoningOf } from "../../../../../../../lib/thinking.mjs";
import { readAll, toResponses } from "../../../../../../../lib/citations.mjs";
import { clientItem, clientKind } from "../../../../../../../lib/responses-tools.mjs";

/**
 * The output items of one assistant message: the `reasoning` item, the `message` item, the hosted call items that followed the text, and one item per
 * tool call (`function_call`, `custom_tool_call`, or the `shell_call` / `apply_patch_call` item of an emulated client tool).
 * @param {any} message - Chat assistant message.
 * @param {any} state - State from the request converter.
 * @param {any} s - Resolved settings.
 * @param {any[]} [hosted] - Items of the hosted tools the runner ran after this message's text (they go before its tool calls).
 * @returns {any[]} Output items.
 */
function itemsOf(message, state, s, hosted = []) {
	const output = [];
	const reasoning = reasoningOf(message);
	const details = s.reasoningRoundTrip && Array.isArray(message.reasoning_details) ? pack(message.reasoning_details) : undefined;
	if (reasoning !== "" || details !== undefined) {
		output.push({
			type: "reasoning",
			id: itemId("rs"),
			summary: reasoning === "" ? [] : [{ type: "summary_text", text: reasoning }],
			...(details === undefined ? {} : { encrypted_content: details }),
			status: "completed"
		});
	}
	const text = typeof message.content === "string" ? message.content : "";
	const refusal = typeof message.refusal === "string" && message.refusal !== "" ? message.refusal : null;
	if (text !== "" || refusal !== null) {
		const annotations = s.citations === "none" ? [] : readAll(message.annotations).map((citation) => toResponses(citation));
		output.push({
			type: "message",
			id: itemId("msg"),
			status: "completed",
			role: "assistant",
			content: text !== "" ? [{ type: "output_text", text, annotations, logprobs: [] }] : [{ type: "refusal", refusal }]
		});
	}
	output.push(...hosted);
	for (const call of message.tool_calls ?? []) {
		if (call.type === "custom") {
			output.push({
				type: "custom_tool_call",
				id: itemId("ctc"),
				call_id: call.id,
				name: call.custom?.name ?? "",
				input: call.custom?.input ?? "",
				status: "completed"
			});
			continue;
		}
		const kind = clientKind(state, call.function.name);
		if (kind !== undefined) {
			output.push(
				clientItem(kind, {
					id: itemId(kind === "shell" ? "sc" : "apc"),
					call_id: call.id,
					arguments: call.function.arguments ?? "",
					status: "completed"
				})
			);
			continue;
		}
		output.push({
			type: "function_call",
			id: itemId("fc"),
			call_id: call.id,
			name: call.function.name,
			arguments: call.function.arguments ?? "",
			status: "completed"
		});
	}
	return output;
}

/**
 * Convert a (non-streaming) Chat Completions reply into a Responses object.
 *
 * The output holds, in this order, a `reasoning` item (the reply's reasoning text as one summary part, and with `reasoningRoundTrip` its
 * `reasoning_details` as `encrypted_content`), a `message` item with an `output_text` part (or a `refusal` part) and one item per tool call:
 * `function_call`, `custom_tool_call`, or for the emulated `shell` and `apply_patch` tools (`state.clientTools`) a `shell_call` / `apply_patch_call`.
 * The message's `annotations` are the `annotations` of the `output_text` part (`url_citation`, `file_citation`; see `lib/citations.mjs`). A `length`
 * stop makes the response `incomplete` with reason `max_output_tokens`, a content filter one with reason `content_filter`.
 *
 * A reply the hosted tool runner built (`lib/hostedtools.mjs`) carries `llmt_rounds`, `[{ message, hosted }]`: each upstream round's assistant message and
 * the Responses items of the hosted tools it called. Each round gives its items in the order above with its hosted items after the text, and the rounds
 * follow each other. `llmt_incomplete` is the reason of a response the runner cut off at its round limit (`incomplete` with that reason).
 * @param {any} completion - Chat Completions `chat.completion` object.
 * @param {any} state - State from the request converter (`model`, `echo`); `id` is the response id when the caller chose it, else one is made.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} Responses object.
 * @throws {TranslatorError} When the completion has no choices.
 */
export function response(completion, state, settings) {
	const s = resolve(settings);
	const choice = completion?.choices?.[0];
	if (!choice) throw new TranslatorError("Upstream response contained no choices", { code: "invalid_upstream_response", status: 502 });
	// `llmt_output` is the output of an upstream that was sent hosted tools as they were: it goes back as the upstream wrote it.
	const output = Array.isArray(completion.llmt_output)
		? completion.llmt_output
		: Array.isArray(completion.llmt_rounds)
			? completion.llmt_rounds.flatMap((round) => itemsOf(round.message, state, s, round.hosted))
			: itemsOf(choice.message ?? {}, state, s);
	const end =
		typeof completion.llmt_incomplete === "string"
			? { status: "incomplete", incomplete_details: { reason: completion.llmt_incomplete } }
			: endOf(choice.finish_reason);
	return envelope(state, {
		id: state.id ?? itemId("resp"),
		model: state.model ?? completion.model,
		created: completion.created ?? Math.floor(Date.now() / 1000),
		output,
		usage: usageOf(completion.usage),
		...end
	});
}
