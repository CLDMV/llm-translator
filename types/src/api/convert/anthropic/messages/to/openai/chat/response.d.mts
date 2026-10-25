/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/anthropic/messages/to/openai/chat/response.mjs
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
 * Convert an Anthropic message into an OpenAI `chat.completion`. Text blocks are concatenated, `thinking` blocks
 * become the reasoning field named by `reasoningField`, `tool_use` blocks become `tool_calls` (tool names restored
 * through `state.toolNames`), and other block types (server tool results, redacted thinking) are skipped.
 * @param {any} message - Anthropic message.
 * @param {any} [state] - State from the request converter (original model, tool-name map).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} OpenAI chat completion.
 */
export declare function response(message: any, state?: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): any;
