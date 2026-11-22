/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/settings.mjs
 *	@Date: 2026-10-25T12:28:19-07:00 (1792956499)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T13:31:30-07:00 (1792960290)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Translator settings: the full key set, its defaults and the layer merge.
 */

import { TranslatorError } from "./errors.mjs";
import { normalize as normalizeUrls } from "./document-urls.mjs";
import { check } from "./constraint.mjs";
import { valid } from "./cache.mjs";
import { check as checkGemini } from "./gemini-settings.mjs";

/**
 * Settings understood by the converters. Every key is optional when passed in; `resolve()` fills the rest.
 * @typedef {object} Settings
 * @property {"auto"|"keep"|"hoist"|"user"|"drop"} inlineSystem - How mid-conversation `role:"system"` messages are handled. `user` folds them into the adjacent user turn as `<system-reminder>` text, `keep` forwards them as system messages, `hoist` appends them to the leading system message, `drop` discards them. `auto` behaves like `user` unless a driver probed the chat template and resolved it.
 * @property {boolean} stripBillingHeader - Remove the `x-anthropic-billing-header` system block.
 * @property {"reasoning"|"reasoning_content"} reasoningField - Field used when SENDING reasoning to an OpenAI-style server (reading accepts both).
 * @property {boolean} thinkTags - Parse a leading `<think>...</think>` in content as reasoning.
 * @property {boolean} thinkOpen - With `thinkTags`: the output starts inside a thought because the chat template opens `<think>` in the generation prompt, so reasoning runs up to the first `</think>`. Without a `</think>` the content is plain text.
 * @property {boolean} reasoningRoundTrip - Carry reasoning the upstream needs back across turns. OpenAI-protocol upstream: the provider's reasoning fields (`reasoning_content`, `reasoning`, `reasoning_details`) travel in the thinking block's `llmt:` signature and are restored on the next request. Anthropic-protocol upstream with an OpenAI client: thinking blocks and their signatures travel as `reasoning_details` items the client replays. Off by default; the DeepSeek driver turns it on.
 * @property {"auto"|"concise"|"detailed"|"none"} reasoningSummary - Responses-protocol upstream: the `reasoning.summary` asked for whenever the request sets a reasoning effort, so the model's reasoning summary comes back as thinking text. `none` does not ask for one.
 * @property {"chat_template_kwargs"|"reasoning_effort"|"none"} thinking - How Anthropic `thinking` is requested from the server.
 * @property {boolean} thinkingBudget - Send `thinking_token_budget` for `thinking.type = "enabled"`.
 * @property {boolean} effort - Map `output_config.effort` to `reasoning_effort`.
 * @property {boolean} images - The model accepts images. When false images are replaced by a text note.
 * @property {boolean} imageFallback - Retry a request once without images when an OpenAI-protocol upstream answers 400 that the model does not accept images, and remember that for the endpoint and model until the process ends.
 * @property {boolean} toolFallback - Retry a request once without tools when an OpenAI-protocol upstream answers 400 that tool parsing is not enabled (vLLM started without `--enable-auto-tool-choice` and `--tool-call-parser`). Off by default: the request then runs without tools, which silently changes what the model can do.
 * @property {"extract"|"note"|"error"} documents - How `document` blocks are handled.
 * @property {((block: object, ctx: object) => Promise<object[]>|object[])|null} documentConverter - Override for `document` conversion; returns Anthropic content blocks.
 * @property {null|{ allow: string[], maxBytes: number, timeout: number, maxRedirects: number, maxDocuments: number, allowPrivate: boolean }} documentUrls - Fetch the `url` sources of `document` blocks before conversion; `null` (the default) is off, and an object turns it on (`allow` is required).
 * @property {{ pages: boolean, maxPages: number, maxBytes: number, maxImages: number, scale: number }} pdf - PDF handling: render page images, Anthropic-like limits, image budget and render scale.
 * @property {"pass"|"sanitize"} toolSchema - Sanitize tool JSON Schemas (drop `$schema`, remove unbounded integer limits).
 * @property {"forward"|"drop"} deferredTools - Offer `defer_loading` tools as `toolSearch` says, or drop them (and the search tool).
 * @property {"expand"|"inline"|"native"} toolSearch - Claude Code's tool search. `expand` offers a deferred tool once a `tool_reference` (or a `ToolSearch` result) loads it; `inline` offers every deferred tool up front and hides `ToolSearch` (it stays when `DeferredToolPlaceholder` shows Claude Code holds tools whose definitions it did not send; `expand` does the same when the request has no `ToolSearch` at all); `native` passes `defer_loading` and `tool_reference` through to a server that understands them.
 * @property {"schema"|"instruction"|"drop"} jsonObject - OpenAI to Anthropic: how `response_format: json_object` is sent. `schema` sends `output_config.format` with the permissive schema `{ "type": "object" }`, `instruction` appends a short system instruction asking for one JSON object, `drop` omits it and records the drop.
 * @property {boolean} jsonObjectFallback - Retry a request once with `jsonObject: "instruction"` when an Anthropic-protocol upstream answers 400 or 422 to the schema `jsonObject: "schema"` sent. The endpoint and model are remembered until the process ends only when the retry succeeds.
 * @property {boolean} toolErrors - Prefix `is_error` tool results with `toolErrorMarker` when converting to Chat Completions (which has no error flag) and on vLLM native passthrough. On by default for every driver; set false to send the text unchanged. Upstreams with a native error flag (Anthropic-protocol) never go through this.
 * @property {string} toolErrorMarker - Text that marks a failed tool result when `toolErrors` is on, and the text `toolErrorInference` looks for. Must contain a non-whitespace character.
 * @property {boolean} toolErrorInference - OpenAI to Anthropic: a `tool` message whose text starts with `toolErrorMarker` becomes a `tool_result` with `is_error: true`, with the marker removed from the text. Off by default: a tool that merely prints the marker would be taken for a failure.
 * @property {"auto"|"none"} citations - Citations in replies (Anthropic `citations`, Chat Completions and Responses `annotations`). `auto` carries them between the protocols, `none` leaves them out of every reply. See [protocol-support.md](protocol-support.md#14-citations).
 * @property {boolean} documentCitations - OpenAI to Anthropic: ask for citations on the documents made from `file` content parts (`citations: { enabled: true }`). A `file` part can also say so itself with its own `citations: { enabled: true | false }`, which wins.
 * @property {"max_completion_tokens"|"max_tokens"} maxTokensField - Field used for the output cap.
 * @property {boolean} streamUsage - Request `stream_options.include_usage` on streamed requests.
 * @property {boolean} continuousUsage - Also request `stream_options.continuous_usage_stats` (vLLM extension; real OpenAI may reject it).
 * @property {"continue_final_message"|"none"} prefill - Map a trailing assistant message to `continue_final_message`.
 * @property {boolean} topK - Forward `top_k`.
 * @property {boolean} responseFormat - Map `output_config.format` to `response_format`.
 * @property {boolean} parallelToolCalls - Map `disable_parallel_tool_use` to `parallel_tool_calls: false`.
 * @property {"drop"|"error"} unknownFields - Unknown request fields are dropped (and listed in `state.dropped`) or rejected.
 * @property {Record<string, any>} sampling - Sampling extension fields (`min_p`, `repetition_penalty`, `seed`, ...) added to requests for an OpenAI-protocol upstream when the request does not carry them, merged key by key. A request may set them itself (OpenAI front, or `metadata.sampling` on the Anthropic front). A field the upstream's driver does not accept follows `unknownFields`.
 * @property {{ json?: object, regex?: string, choice?: string[], grammar?: string } | null} constraint - Neutral constrained-decoding description sent with every request to an OpenAI-protocol upstream that does not carry its own: exactly one of `json` (a JSON Schema), `regex`, `choice` (a list of strings) or `grammar` (GBNF for llama.cpp, EBNF for SGLang, a vLLM grammar). Each driver turns it into its backend's native field. Replaced whole, not merged. A request overrides it (`constraint` on the OpenAI front, `metadata.constraint` on the Anthropic front).
 * @property {string | null} cacheSalt - vLLM `cache_salt` sent with every request to this upstream: requests with different salts never share cached prefixes. A non-empty string, or null for none. Backends without the feature follow `unknownFields`. A trusted caller overrides it per call (`cacheSalt` option, or the `cacheSalt` an `authorize` hook returns); it is never read from the client.
 * @property {string | null} promptCacheKey - OpenAI `prompt_cache_key` sent with requests to this upstream that do not carry their own. A non-empty string, or null for none.
 * @property {number} pingInterval - Milliseconds of upstream silence before the SSE writer emits a `ping` (0 disables).
 * @property {"buffer"|"stream"} toolStreaming - OpenAI to Anthropic streams: `buffer` holds each tool call until its arguments are complete and emits one whole `tool_use` block (text and thinking keep streaming and appear before the block); `stream` forwards argument fragments incrementally and holds text that arrives meanwhile until the tool blocks are done.
 * @property {boolean} effortPassthrough - vLLM driver: send `xhigh` and `max` reasoning effort unchanged instead of clamping them to `high`.
 * @property {boolean} passthroughFilter - Restrict bodies forwarded from the OpenAI front to an OpenAI-protocol upstream to standard Chat Completions fields plus documented vLLM extensions. Off in the library; the server turns it on unless set to false.
 * @property {boolean | "auto"} nativeMessages - Deprecated: use the upstream's `api` instead. For a vLLM upstream that sets no `api`, `true` reads as `api: "anthropic.messages"`, `"auto"` as `api: "auto"` and `false` as `api: "openai.chat"`, with a deprecation warning; it is ignored (also with a warning) when `api` is set.
 * @property {{ safetySettings?: {category: string, threshold: string}[], tools?: object[], cachedContent?: string, cache?: boolean, thinking?: "auto"|"level"|"budget", responseModalities?: string[], imageConfig?: object, speechConfig?: object, mediaResolution?: string, confirmationTool?: string, computerUse?: { environment?: string, excludedPredefinedFunctions?: string[], enablePromptInjectionDetection?: boolean, disabledSafetyPolicies?: string[] } }} gemini - Google Gemini request fields for an upstream on the `google.gemini` protocol, merged key by key: `safetySettings` (sent as given), `tools` (built-in tools such as `{ googleSearch: {} }` or `{ computerUse: { environment: "ENVIRONMENT_BROWSER" } }`, added to the request's own), `cachedContent` (a cached content name sent with every request), `cache` (false stops `cache_control` from creating cached contents), `thinking` (`level` or `budget` forces the thinking control a model that is not recognized by name takes; `auto` decides from the model id), `responseModalities`, `imageConfig`, `speechConfig` and `mediaResolution` (sent in `generationConfig`), `confirmationTool` (the name of a tool of the request, taking the `AskUserQuestion` shape, that asks the user to confirm an action Gemini flags; by default `AskUserQuestion` when the request declares it, else the confirmation is asked in plain text), and `computerUse` (fields merged into the `computerUse` tool the translator builds for an Anthropic computer tool: `enablePromptInjectionDetection`, `disabledSafetyPolicies`, and `environment` and `excludedPredefinedFunctions`, either spelled in camelCase or snake_case). Only the operator sets these; a client never does.
 * @property {number} contextWindow - Prompt size in tokens the upstream truncates at, or 0 when unknown. Drivers whose server silently truncates (Ollama) warn once when a request is estimated to exceed it.
 * @property {number} defaultMaxTokens - `max_tokens` used when an OpenAI request has none (Anthropic requires one).
 */

/** @type {Readonly<Settings>} */
export const DEFAULTS = Object.freeze({
	inlineSystem: "auto",
	stripBillingHeader: true,
	reasoningField: "reasoning",
	thinkTags: true,
	thinkOpen: false,
	reasoningRoundTrip: false,
	reasoningSummary: "auto",
	thinking: "chat_template_kwargs",
	thinkingBudget: false,
	effort: false,
	images: true,
	imageFallback: true,
	toolFallback: false,
	documents: "extract",
	documentConverter: null,
	documentUrls: null,
	pdf: Object.freeze({ pages: true, maxPages: 100, maxBytes: 32 * 1024 * 1024, maxImages: 20, scale: 1.5 }),
	toolSchema: "pass",
	deferredTools: "forward",
	toolSearch: "expand",
	jsonObject: "schema",
	jsonObjectFallback: true,
	toolErrors: true,
	toolErrorMarker: "[error] ",
	toolErrorInference: false,
	citations: "auto",
	documentCitations: false,
	maxTokensField: "max_completion_tokens",
	streamUsage: true,
	continuousUsage: false,
	prefill: "continue_final_message",
	topK: true,
	responseFormat: true,
	parallelToolCalls: true,
	unknownFields: "drop",
	sampling: Object.freeze({}),
	gemini: Object.freeze({}),
	constraint: null,
	cacheSalt: null,
	promptCacheKey: null,
	pingInterval: 10000,
	toolStreaming: "buffer",
	effortPassthrough: false,
	passthroughFilter: false,
	nativeMessages: false,
	contextWindow: 0,
	defaultMaxTokens: 8192
});

const ENUMS = {
	inlineSystem: ["auto", "keep", "hoist", "user", "drop"],
	reasoningField: ["reasoning", "reasoning_content"],
	reasoningSummary: ["auto", "concise", "detailed", "none"],
	thinking: ["chat_template_kwargs", "reasoning_effort", "none"],
	documents: ["extract", "note", "error"],
	toolSchema: ["pass", "sanitize"],
	deferredTools: ["forward", "drop"],
	toolSearch: ["expand", "inline", "native"],
	jsonObject: ["schema", "instruction", "drop"],
	citations: ["auto", "none"],
	maxTokensField: ["max_completion_tokens", "max_tokens"],
	prefill: ["continue_final_message", "none"],
	unknownFields: ["drop", "error"],
	toolStreaming: ["buffer", "stream"]
};

const BOOLEANS = [
	"effortPassthrough",
	"passthroughFilter",
	"imageFallback",
	"toolFallback",
	"jsonObjectFallback",
	"thinkOpen",
	"reasoningRoundTrip",
	"toolErrorInference",
	"documentCitations"
];

/**
 * Merge settings layers (later layers win, `undefined` values are skipped, `pdf` merges key by key) and validate
 * the enumerated keys. The result is a fresh object; inputs are never mutated.
 * @param {...(Partial<Settings>|null|undefined)} layers - Layers in increasing precedence.
 * @returns {Settings} Resolved settings.
 */
export function resolve(...layers) {
	const out = { ...DEFAULTS, pdf: { ...DEFAULTS.pdf }, sampling: { ...DEFAULTS.sampling }, gemini: { ...DEFAULTS.gemini } };
	for (const layer of layers) {
		if (!layer) continue;
		for (const [key, value] of Object.entries(layer)) {
			if (value === undefined) continue;
			if (key === "pdf") Object.assign(out.pdf, value);
			else if (key === "sampling" && value !== null && typeof value === "object" && !Array.isArray(value))
				Object.assign(out.sampling, value);
			else if (key === "gemini" && value !== null && typeof value === "object" && !Array.isArray(value)) Object.assign(out.gemini, value);
			else out[key] = value;
		}
	}
	for (const [key, allowed] of Object.entries(ENUMS)) {
		if (!allowed.includes(out[key])) {
			throw new TranslatorError(`Invalid setting ${key}: ${JSON.stringify(out[key])} (expected one of ${allowed.join(", ")})`, {
				code: "invalid_setting",
				status: 500,
				details: { key, allowed }
			});
		}
	}
	for (const key of BOOLEANS) {
		if (typeof out[key] !== "boolean") {
			throw new TranslatorError(`Invalid setting ${key}: ${JSON.stringify(out[key])} (expected true or false)`, {
				code: "invalid_setting",
				status: 500,
				details: { key }
			});
		}
	}
	if (out.nativeMessages !== true && out.nativeMessages !== false && out.nativeMessages !== "auto") {
		throw new TranslatorError(`Invalid setting nativeMessages: ${JSON.stringify(out.nativeMessages)} (expected true, false or "auto")`, {
			code: "invalid_setting",
			status: 500,
			details: { key: "nativeMessages" }
		});
	}
	if (typeof out.toolErrorMarker !== "string" || out.toolErrorMarker.trim() === "") {
		throw new TranslatorError(`Invalid setting toolErrorMarker: ${JSON.stringify(out.toolErrorMarker)} (expected a non-empty string)`, {
			code: "invalid_setting",
			status: 500,
			details: { key: "toolErrorMarker" }
		});
	}
	if (out.sampling === null || typeof out.sampling !== "object" || Array.isArray(out.sampling)) {
		throw new TranslatorError(`Invalid setting sampling: ${JSON.stringify(out.sampling)} (expected an object of field names and values)`, {
			code: "invalid_setting",
			status: 500,
			details: { key: "sampling" }
		});
	}
	const geminiProblem = checkGemini(out.gemini);
	if (geminiProblem !== null) {
		throw new TranslatorError(`Invalid setting gemini: ${JSON.stringify(out.gemini)} (${geminiProblem})`, {
			code: "invalid_setting",
			status: 500,
			details: { key: "gemini" }
		});
	}
	const problem = check(out.constraint);
	if (problem !== null) {
		throw new TranslatorError(`Invalid setting constraint: ${JSON.stringify(out.constraint)} (${problem})`, {
			code: "invalid_setting",
			status: 500,
			details: { key: "constraint" }
		});
	}
	for (const key of ["cacheSalt", "promptCacheKey"]) {
		if (!valid(out[key])) {
			throw new TranslatorError(`Invalid setting ${key}: ${JSON.stringify(out[key])} (expected a non-empty string or null)`, {
				code: "invalid_setting",
				status: 500,
				details: { key }
			});
		}
	}
	out.documentUrls = normalizeUrls(out.documentUrls);
	// unpdf 2 throws on a render scale of 0, so catch a bad value here with the setting's name.
	if (!(Number.isFinite(out.pdf.scale) && out.pdf.scale > 0)) {
		throw new TranslatorError(`Invalid setting pdf.scale: ${JSON.stringify(out.pdf.scale)} (expected a positive number)`, {
			code: "invalid_setting",
			status: 500,
			details: { key: "pdf.scale" }
		});
	}
	return out;
}
