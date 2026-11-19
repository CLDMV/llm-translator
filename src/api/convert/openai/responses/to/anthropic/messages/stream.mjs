/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/openai/responses/to/anthropic/messages/stream.mjs
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
 * @fileoverview OpenAI Responses stream events to Anthropic Messages events.
 */

import { stream as toAnthropic } from "../../../../chat/to/anthropic/messages/stream.mjs";
import { stream as toChat } from "../../../../../../../lib/responses-upstream.mjs";

/**
 * Convert a Responses event stream into Anthropic events: read as Chat Completions chunks first, then converted from there.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - Responses stream.
 * @param {any} [state] - State from the request converter.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<any, void, undefined>} Anthropic events.
 */
export function stream(source, state, settings) {
	return toAnthropic(toChat(source, state, settings), state, settings);
}
