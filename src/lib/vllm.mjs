/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/vllm.mjs
 *	@Date: 2026-11-13T09:00:00-08:00 (1794243600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T09:00:00-08:00 (1794243600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview vLLM's native `/v1/messages` endpoint: when to use it, and the normalisation its request, reply and stream need.
 * @module @cldmv/llm-translator/lib/vllm
 */
import { atLeast, semver } from "./normalize.mjs";
import { sign } from "./thinking.mjs";

/** First vLLM release that serves `/v1/messages` (vllm-project/vllm#22627). */
export const MIN_VERSION = "0.11.1";

const BILLING = "x-anthropic-billing-header:";

/**
 * Is the native endpoint wanted for this upstream, going by the `nativeMessages` setting and the version?
 * @param {any} endpoint - Runtime endpoint.
 * @param {any} settings - Resolved settings for the endpoint.
 * @returns {boolean} True for a vLLM upstream with `nativeMessages: true`, or `"auto"` and a known version of 0.11.1 or later (an unknown version stays on conversion).
 */
export function wants(endpoint, settings) {
	if (endpoint.driver !== "vllm" || settings.nativeMessages === false) return false;
	if (settings.nativeMessages === true) return true;
	const version = endpoint.facts?.version ?? endpoint.version;
	return semver(version) !== null && atLeast(version, MIN_VERSION);
}

/**
 * Blocks of a message list, including the content of tool results.
 * @param {any[]} messages - Anthropic messages.
 * @returns {Generator<any>} Every content block.
 */
function* blocks(messages) {
	for (const message of messages) {
		if (!Array.isArray(message?.content)) continue;
		for (const block of message.content) {
			yield block;
			if (block?.type === "tool_result" && Array.isArray(block.content)) yield* block.content;
		}
	}
}

/**
 * Why a request cannot go to the native endpoint, so it is converted instead.
 *
 * - `prefill`: the last message is from the assistant. The endpoint turns it into a finished assistant turn and starts a new one, where conversion continues it.
 * - `document`: the endpoint accepts no `document` blocks; conversion extracts their text and page images.
 * - `toolsearch`: deferred tools (`defer_loading`, `tool_reference` and `tool_addition` blocks) are expanded by the translator unless `toolSearch` is `native`.
 * @param {any} body - Anthropic request body.
 * @param {any} settings - Resolved settings for the endpoint.
 * @returns {"prefill" | "document" | "toolsearch" | null} The reason, or null when the endpoint can take the request.
 */
export function unsuited(body, settings) {
	const messages = Array.isArray(body.messages) ? body.messages : [];
	if (messages.at(-1)?.role === "assistant") return "prefill";
	const seen = [...blocks(messages)];
	if (seen.some((block) => block?.type === "document")) return "document";
	if (settings.toolSearch !== "native") {
		const deferred = Array.isArray(body.tools) && body.tools.some((tool) => tool?.defer_loading !== undefined);
		if (deferred || seen.some((block) => ["tool_reference", "tool_addition", "tool_removal"].includes(block?.type))) return "toolsearch";
	}
	return null;
}

/**
 * Join the text of a system value the way the conversion does, minus the billing header. vLLM joins system blocks with nothing between them.
 * @param {string | any[]} system - System prompt.
 * @param {any} settings - Resolved settings.
 * @returns {string} Text.
 */
function systemText(system, settings) {
	const list = typeof system === "string" ? [{ type: "text", text: system }] : system;
	return list
		.filter((block) => block?.type === "text" && typeof block.text === "string")
		.filter((block) => !(settings.stripBillingHeader && block.text.trimStart().startsWith(BILLING)))
		.map((block) => block.text)
		.join("\n\n");
}

/**
 * Mark failed tool results the way the conversion does when `toolErrors` is on (vLLM ignores `is_error`).
 * @param {any} block - A `tool_result` block.
 * @param {any} settings - Resolved settings.
 * @returns {any} The block, with the marker in front of its text.
 */
function marked(block, settings) {
	const marker = settings.toolErrorMarker;
	if (typeof block.content === "string") return { ...block, content: `${marker}${block.content}` };
	if (Array.isArray(block.content)) return { ...block, content: [{ type: "text", text: marker.trimEnd() }, ...block.content] };
	return { ...block, content: marker.trimEnd() };
}

/**
 * Normalise an Anthropic request for vLLM's `/v1/messages`: the system prompt becomes one string without the billing header, and failed
 * tool results carry the `toolErrors` marker when that setting is on. Everything else goes through unchanged (the endpoint ignores fields it does not know).
 * @param {any} body - Anthropic request body.
 * @param {any} settings - Resolved settings for the endpoint.
 * @returns {any} Body to send.
 */
export function request(body, settings) {
	const out = { ...body };
	if (out.system !== undefined && out.system !== null) {
		const text = systemText(out.system, settings);
		if (text === "") delete out.system;
		else out.system = text;
	}
	if (settings.toolErrors && Array.isArray(out.messages)) {
		out.messages = out.messages.map((message) =>
			Array.isArray(message?.content)
				? {
						...message,
						content: message.content.map((block) =>
							block?.type === "tool_result" && block.is_error === true ? marked(block, settings) : block
						)
					}
				: message
		);
	}
	return out;
}

/**
 * Give thinking blocks that have no signature the translator's own marker (vLLM before 0.17 sends none; clients expect the field).
 * @param {any} body - Anthropic reply body.
 * @returns {any} The reply, with every thinking block signed.
 */
export function response(body) {
	if (!Array.isArray(body?.content)) return body;
	return {
		...body,
		content: body.content.map((block) =>
			block?.type === "thinking" && typeof block.signature !== "string" ? { ...block, signature: sign() } : block
		)
	};
}

/**
 * Normalise the event stream of the native endpoint: a `ping` follows `message_start` (Anthropic sends one, vLLM does not), and a thinking block that ends without
 * a `signature_delta` gets one before its `content_block_stop`.
 * @param {AsyncIterable<{event?: string, data: any}>} source - Events of the endpoint.
 * @returns {AsyncGenerator<{event?: string, data: any}>} Events for the client.
 */
export async function* stream(source) {
	const thinking = new Map();
	for await (const message of source) {
		const data = message.data;
		if (data?.type === "content_block_start" && data.content_block?.type === "thinking")
			thinking.set(data.index, typeof data.content_block.signature === "string");
		else if (data?.type === "content_block_delta" && data.delta?.type === "signature_delta") thinking.set(data.index, true);
		else if (data?.type === "content_block_stop" && thinking.get(data.index) === false) {
			yield {
				event: "content_block_delta",
				data: { type: "content_block_delta", index: data.index, delta: { type: "signature_delta", signature: sign() } }
			};
		}
		if (data?.type === "content_block_stop") thinking.delete(data.index);
		yield message;
		if (data?.type === "message_start") yield { event: "ping", data: { type: "ping" } };
	}
}
