/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/openai/chat/to/anthropic/messages/response.mjs
 *	@Date: 2026-10-25T12:28:19-07:00 (1792956499)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:58:59-07:00 (1792958339)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * Convert a (non-streaming) OpenAI chat completion into an Anthropic message.
 *
 * Reasoning (`reasoning`, `reasoning_content`, or a leading `<think>` block when `thinkTags` is on) becomes a
 * `thinking` block with a translator-marked signature. Tool calls become `tool_use` blocks; arguments that are not
 * a JSON object are passed through under `_raw_arguments` so the client reports a tool error the model can recover
 * from.
 * @param {any} completion - OpenAI `chat.completion` object.
 * @param {any} [state] - State from the request converter (original model, tool-name map).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} Anthropic message.
 * @throws {TranslatorError} When the completion has no choices.
 */
export declare function response(completion: any, state?: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): any;
