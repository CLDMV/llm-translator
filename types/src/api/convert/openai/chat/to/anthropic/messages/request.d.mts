/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/openai/chat/to/anthropic/messages/request.mjs
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
 * Convert an OpenAI Chat Completions request body into an Anthropic Messages request body (for an OpenAI-protocol
 * client talking to an Anthropic-protocol upstream).
 *
 * `system` and `developer` messages are hoisted into the top-level `system`; assistant reasoning is not forwarded
 * (real Anthropic rejects thinking blocks without its own signatures); consecutive same-role turns are merged and
 * tool results are grouped into one user turn with the results first, as Anthropic requires.
 * @param {any} chatBody - OpenAI `POST /v1/chat/completions` body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {Promise<{ body: any, state: any }>} Anthropic request body and conversion state.
 * @throws {TranslatorError} For malformed requests, `n` above 1, unknown roles, or unknown fields when configured to error.
 */
export declare function request(chatBody: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): Promise<{
    body: any;
    state: any;
}>;
