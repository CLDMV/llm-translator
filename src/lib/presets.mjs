/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/presets.mjs
 *	@Date: 2026-11-13T10:00:00-08:00 (1794592800)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T10:00:00-08:00 (1794592800)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Presets for hosted OpenAI-compatible providers (Together, Groq, Fireworks, xAI, Gemini): the host names each one answers on, its
 * URL layout, its translator settings and the request fields it rejects. The `driver/<name>` folders are one-line wrappers over this table.
 * @module @cldmv/llm-translator/lib/presets
 */
import { noEmptyTools } from "./normalize.mjs";

/** Paths of the calls under the provider's API root, for roots that sit behind `/v1`. */
const V1 = { chat: "/v1/chat/completions", embeddings: "/v1/embeddings", models: "/v1/models" };

/** Paths of the calls for a root that already carries its own version segment (Gemini's `/v1beta/openai`). */
const BARE = { chat: "/chat/completions", embeddings: "/embeddings", models: "/models" };

/**
 * Grok models that reason: every Grok 3 mini, Grok 4 and Grok code model except the `non-reasoning` variants. They reject `stop`,
 * `presence_penalty` and `frequency_penalty`.
 * @param {any} model - Model name of the request.
 * @returns {boolean} True for a reasoning model.
 */
function grokReasons(model) {
	return /^grok-(3-mini|4|code)/.test(String(model)) && !/non-reasoning/.test(String(model));
}

/**
 * @typedef {object} Preset
 * @property {number} order - Detection order (host drivers sit ahead of the probing ones).
 * @property {string[]} hosts - Host names the provider answers on.
 * @property {string} [root] - Path in front of the call paths (`/openai`), added unless the upstream URL already ends in it.
 * @property {Record<string, string>} paths - Call paths under the root.
 * @property {any} settings - Translator settings of the provider.
 * @property {string[]} [fields] - Extra request fields the OpenAI front's `passthroughFilter` lets through (`info().fields`).
 * @property {string[]} [drop] - Request fields the provider rejects.
 * @property {(body: any) => string[]} [dropWhen] - Fields the provider rejects for this request (by model).
 * @property {boolean} [dropName] - Remove `name` from messages.
 */

/** @type {Readonly<Record<string, Preset>>} */
export const PRESETS = Object.freeze({
	// https://console.groq.com/docs/openai, /docs/reasoning and the API reference: `max_tokens` is deprecated for `max_completion_tokens`;
	// `logprobs`, `top_logprobs`, `logit_bias` and `messages[].name` answer 400; reasoning comes back in `message.reasoning`.
	groq: {
		order: 21,
		hosts: ["api.groq.com"],
		root: "/openai",
		paths: V1,
		settings: {
			reasoningField: "reasoning",
			maxTokensField: "max_completion_tokens",
			thinking: "none",
			thinkingBudget: false,
			effort: true,
			topK: false,
			prefill: "none",
			streamUsage: true,
			continuousUsage: false
		},
		drop: ["logprobs", "top_logprobs", "logit_bias"],
		dropName: true
	},
	// https://docs.together.ai/docs/openai-api-compatibility and the chat completions reference: `max_tokens`, `top_k`, `min_p` and
	// `repetition_penalty` are fields; no `stream_options` or `parallel_tool_calls`; reasoning in `reasoning` or `reasoning_content`
	// depending on the model, and it is passed back under the same key.
	together: {
		order: 22,
		hosts: ["api.together.ai", "api.together.xyz", "us-api.together.ai"],
		paths: V1,
		fields: ["top_k", "min_p", "repetition_penalty"],
		settings: {
			reasoningField: "reasoning",
			reasoningRoundTrip: true,
			maxTokensField: "max_tokens",
			thinking: "none",
			thinkingBudget: false,
			effort: true,
			topK: true,
			prefill: "none",
			parallelToolCalls: false,
			streamUsage: false,
			continuousUsage: false
		}
	},
	// https://docs.fireworks.ai/tools-sdks/openai-compatibility, /guides/reasoning and the chat completions reference: base
	// `/inference/v1`; `max_tokens` (`max_completion_tokens` is an alias); `top_k`; `reasoning_effort` (levels, `none`, boolean or a token cap);
	// reasoning in `reasoning_content`, to be sent back in tool loops; the usage chunk comes by default.
	fireworks: {
		order: 23,
		hosts: ["api.fireworks.ai"],
		root: "/inference",
		paths: V1,
		fields: ["top_k", "min_p", "repetition_penalty"],
		settings: {
			reasoningField: "reasoning_content",
			reasoningRoundTrip: true,
			maxTokensField: "max_tokens",
			thinking: "reasoning_effort",
			thinkingBudget: false,
			effort: true,
			topK: true,
			prefill: "none",
			streamUsage: true,
			continuousUsage: false
		}
	},
	// https://docs.x.ai/docs/guides/reasoning and the Chat Completions reference (a legacy endpoint on xAI's side): `max_tokens` is
	// deprecated for `max_completion_tokens`; reasoning cannot be switched off; reasoning models reject `stop`, `presence_penalty` and
	// `frequency_penalty`.
	xai: {
		order: 24,
		hosts: ["api.x.ai"],
		paths: V1,
		settings: {
			reasoningField: "reasoning_content",
			maxTokensField: "max_completion_tokens",
			thinking: "none",
			thinkingBudget: false,
			effort: true,
			topK: false,
			prefill: "none",
			streamUsage: true,
			continuousUsage: false
		},
		dropWhen: (body) => (grokReasons(body.model) ? ["stop", "presence_penalty", "frequency_penalty"] : [])
	},
	// https://ai.google.dev/gemini-api/docs/openai: base `/v1beta/openai`, `reasoning_effort` maps to the thinking level or budget (`none`
	// works only on some 2.5 models), `stream_options.include_usage` is supported.
	gemini: {
		order: 25,
		hosts: ["generativelanguage.googleapis.com"],
		root: "/v1beta/openai",
		paths: BARE,
		settings: {
			maxTokensField: "max_tokens",
			thinking: "none",
			thinkingBudget: false,
			effort: true,
			topK: false,
			prefill: "none",
			streamUsage: true,
			continuousUsage: false
		}
	}
});

/**
 * The driver facts of a preset.
 * @param {string} name - Preset name.
 * @returns {{name: string, protocol: string, order: number, auth: string, strict: boolean, fields?: string[], paths: Record<string,string>}} Driver facts.
 */
export function describe(name) {
	const preset = PRESETS[name];
	const facts = { name, protocol: "openai.chat", order: preset.order, auth: "bearer", strict: false, paths: { ...preset.paths } };
	return preset.fields ? { ...facts, fields: [...preset.fields] } : facts;
}

/**
 * Match an endpoint by host name, no network access.
 * @param {string} name - Preset name.
 * @param {any} endpoint - Runtime endpoint.
 * @returns {{host: string} | null} Facts, or null when the host is not the provider's.
 */
export function match(name, endpoint) {
	const host = URL.canParse(endpoint.url) ? new URL(endpoint.url).hostname : "";
	return PRESETS[name].hosts.includes(host) ? { host } : null;
}

/**
 * The settings of a preset (a copy).
 * @param {string} name - Preset name.
 * @returns {any} Partial settings.
 */
export function settingsOf(name) {
	return { ...PRESETS[name].settings };
}

/**
 * Put the provider's path root in front of a call path unless the upstream URL already ends in it, so `https://api.groq.com`,
 * `https://api.groq.com/openai` and `https://api.groq.com/openai/v1` (the config removes the `/v1`) all reach the same URL.
 * @param {string} name - Preset name.
 * @param {"chat" | "embeddings" | "models"} kind - Which call.
 * @param {any} endpoint - Runtime endpoint.
 * @returns {string} Path starting with `/`.
 */
export function route(name, kind, endpoint) {
	const preset = PRESETS[name];
	const root = preset.root ?? "";
	return (endpoint.url.endsWith(root) ? "" : root) + preset.paths[kind];
}

/**
 * Normalize a Chat Completions body for a preset: drop empty tool fields and the fields the provider rejects (each recorded in `state.dropped`).
 * @param {string} name - Preset name.
 * @param {any} body - Chat Completions request body.
 * @param {any} [context] - `{ state }`.
 * @returns {any} Normalized body.
 */
export function trim(name, body, context) {
	const preset = PRESETS[name];
	const dropped = context?.state?.dropped;
	const note = (field) => {
		if (Array.isArray(dropped) && !dropped.includes(field)) dropped.push(field);
	};
	const out = { ...noEmptyTools(body) };
	for (const field of [...(preset.drop ?? []), ...(preset.dropWhen?.(body) ?? [])]) {
		if (out[field] === undefined) continue;
		delete out[field];
		note(field);
	}
	if (preset.dropName && Array.isArray(out.messages) && out.messages.some((message) => message && "name" in message)) {
		out.messages = out.messages.map((message) => {
			const rest = { ...message };
			delete rest.name;
			return rest;
		});
		note("messages[].name");
	}
	return out;
}
