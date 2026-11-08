/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/fixtures/driver/idsanthropic/info.mjs
 *	@Date: 2026-10-25T12:18:46-07:00 (1792955926)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:03-07:00 (1792958343)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/** @returns {object} Driver facts for an Anthropic-protocol server that wants short lowercase ids. */
export function info() {
	return {
		name: "idsanthropic",
		protocol: "anthropic.messages",
		order: 5,
		auth: "x-api-key",
		toolCallIds: { alphabet: "a-z0-9", min: 6, max: 12 },
		paths: { messages: "/v1/messages" }
	};
}
