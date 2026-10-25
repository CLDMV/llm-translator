/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/anthropic/messages/to/openai/chat/request.mjs
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
 * Convert an Anthropic Messages request body into an OpenAI Chat Completions request body.
 *
 * Returns the converted body plus a JSON-serializable `state` the response/stream converters need (original model,
 * tool-name map, thinking mode, fields that were dropped).
 * @param {any} body - Anthropic `POST /v1/messages` body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {Promise<{ body: any, state: any }>} OpenAI request body and conversion state.
 * @throws {TranslatorError} For malformed requests, unsupported content when configured to error, or PDF limit violations.
 */
export declare function request(body: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): Promise<{
    body: any;
    state: any;
}>;
