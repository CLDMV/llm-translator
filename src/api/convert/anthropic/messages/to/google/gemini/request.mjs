/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/anthropic/messages/to/google/gemini/request.mjs
 *	@Date: 2026-11-22T10:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T10:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Anthropic Messages request to a Google Gemini `generateContent` request.
 * @module @cldmv/llm-translator/convert
 */
import { resolve } from "../../../../../../../lib/settings.mjs";
import { chatBody } from "../../../../../../../lib/gemini.mjs";
import { breakpoint, planOf, upTo } from "../../../../../../../lib/gemini-cache.mjs";
import { prepare } from "../../../../../../../lib/gemini-images.mjs";
import { expand } from "../../../../../../../lib/documents.mjs";
import { enabledOf, excluded, isTool, prepare as prepareComputer } from "../../../../../../../lib/gemini-computer.mjs";
import { request as toChat } from "../../openai/chat/request.mjs";

/**
 * Settings the Gemini API does not choose: the output cap is always `generationConfig.maxOutputTokens`, `top_k` is a generation field, thinking
 * is sent as a budget or a level (from `thinking.budget_tokens`, or from the effort, `none` meaning off, or dynamic for `adaptive`) and a trailing
 * assistant message is an ordinary turn. Thought signatures always travel with the conversation (`reasoningRoundTrip`), because Gemini 3 models refuse a tool
 * turn that lacks its signature. These override the upstream's own values.
 */
/** @type {Partial<import("../../../../../../../lib/settings.mjs").Settings>} */
const NATIVE = {
	maxTokensField: "max_tokens",
	thinking: "reasoning_effort",
	thinkingBudget: false,
	effort: true,
	topK: true,
	prefill: "none",
	streamUsage: false,
	continuousUsage: false,
	reasoningRoundTrip: true
};

/** The Gemini built-in tool for each Anthropic server tool type, by the start of the type (`web_search_20250305`). */
const SERVER = [
	{ pattern: /^web_search/, tool: { googleSearch: {} } },
	{ pattern: /^web_fetch/, tool: { urlContext: {} } },
	{ pattern: /^code_execution/, tool: { codeExecution: {} } }
];

/**
 * Document handling for Gemini, which reads PDFs itself: a base64 PDF, and a PDF at a URL, go through as `application/pdf` image-typed blocks (the
 * Chat Completions conversion turns them into data URL parts and URL parts, and `chatBody` into `inlineData` and `fileData`), and any other
 * document is expanded as it would be without this.
 * @param {any} block - Anthropic `document` block.
 * @param {any} ctx - Document conversion context.
 * @returns {Promise<any[]>} Content blocks.
 */
async function document(block, ctx) {
	if (block.source?.type === "base64" && block.source.media_type === "application/pdf") return [{ type: "image", source: block.source }];
	if (block.source?.type === "url" && typeof block.source.url === "string") {
		return [{ type: "image", source: { type: "url", url: block.source.url, media_type: "application/pdf" } }];
	}
	return expand(block, { ...ctx, settings: { ...ctx.settings, documentConverter: null } });
}

/**
 * The Gemini built-in tools the Anthropic server tools of a request stand for: `web_search` is Google Search, `web_fetch` is URL context and
 * `code_execution` is code execution.
 * @param {any[] | undefined} tools - The request's `tools`.
 * @returns {{ tools: any[], names: Set<string> }} The built-in tools (one of each) and the names of the server tools they replace.
 */
function builtin(tools) {
	const found = [];
	const names = new Set();
	const list = Array.isArray(tools) ? tools : [];
	for (const tool of list) {
		const match = typeof tool?.type === "string" ? SERVER.find((entry) => entry.pattern.test(tool.type)) : undefined;
		if (match === undefined) continue;
		names.add(`tool:${tool.name}`);
		if (!found.includes(match.tool)) found.push(match.tool);
	}
	// Anthropic's computer tool is a client tool, but Gemini's side of it is a built-in tool: the desktop environment, without the actions the client switched off.
	if (list.some(isTool))
		found.push({ computerUse: { environment: "ENVIRONMENT_DESKTOP", excludedPredefinedFunctions: excluded(enabledOf(list)) } });
	return { tools: found, names };
}

/**
 * Convert an Anthropic Messages request to a `generateContent` body. The Anthropic conversion to Chat Completions does the work (system, tool
 * blocks, images, tool names, dropped fields, the thought signatures a client sent back); `chatBody` then puts the result in Gemini's shape (see
 * there). `thinking: { type: "enabled", budget_tokens }` is sent as `thinkingConfig.thinkingBudget`; an effort or `thinking: { type:
 * "disabled" }` becomes a budget too (a level on a Gemini 3 model, chosen by the model sent), and `adaptive` is dynamic thinking. PDFs are sent as they are, for
 * Gemini to read, and server tools become Gemini's built-in tools. The upstream's `sampling` setting and `metadata.sampling` become further
 * `generationConfig` fields, and its `gemini` setting the safety settings and the rest it names.
 * @param {any} body - Anthropic request body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @param {any} [context] - `{ producer, budget, listed, toolCallIds, model, signal, report }`, as for the Chat Completions conversion; `model` is the model the request goes to, which decides between a thinking budget and a level.
 * @returns {Promise<{body: any, state: any}>} The Gemini body and the conversion state the response converters read.
 */
export async function request(body, settings, context) {
	const s = resolve(settings);
	// The computer tool: its history is rewritten into Gemini's actions and its results carry the screenshots (`lib/gemini-computer`).
	const computer = prepareComputer(body);
	const tools = body.tools;
	if (computer !== null) body = computer.body;
	// With `documents: "extract"` and images on, and no converter of the upstream's own, PDFs go through whole.
	const raw = s.documents === "extract" && s.images && !s.documentConverter;
	const { body: chat, state } = await toChat(body, { ...s, ...NATIVE, ...(raw ? { documentConverter: document } : {}) }, context);
	const asked = body.metadata?.sampling;
	const sampling = { ...s.sampling, ...(asked !== null && typeof asked === "object" && !Array.isArray(asked) ? asked : {}) };
	const server = builtin(tools);
	// A computer-use tool the operator named in the setting is the one that is sent.
	if (s.gemini.tools?.some((entry) => Object.hasOwn(entry, "computerUse")))
		server.tools = server.tools.filter((entry) => !Object.hasOwn(entry, "computerUse"));
	state.dropped = state.dropped.filter((name) => !server.names.has(name));
	state.parallel = chat.parallel_tool_calls !== false;
	state.candidates = 1;
	if (computer !== null)
		state.computer = { size: computer.size, custom: computer.custom, shape: computer.shape, enabled: computer.enabled };
	const make = async (input, dropped) =>
		chatBody(await prepare(input, { options: s.documentUrls, report: context?.report, signal: context?.signal }), {
			dropped,
			sampling,
			thinkingBudget: state.thinkingBudget,
			thinkingDynamic: state.thinking === "adaptive",
			marker: s.toolErrors ? s.toolErrorMarker : undefined,
			model: context?.model,
			gemini: { ...s.gemini, builtin: server.tools },
			...(computer === null ? {} : { computer: { images: computer.images } })
		});
	const out = await make(chat, state.dropped);
	// A `cache_control` breakpoint: the request up to it is converted on its own to see what a cached content would hold.
	const point = s.gemini.cache === false || s.gemini.cachedContent !== undefined ? null : breakpoint(body);
	if (point !== null) {
		const { body: short } = await toChat(upTo(body, point), { ...s, ...NATIVE, ...(raw ? { documentConverter: document } : {}) }, context);
		const plan = planOf(await make(short, []), out, point.ttl);
		if (plan !== null) state.cache = plan;
	}
	return { body: out, state };
}
