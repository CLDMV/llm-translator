/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/fixtures/driver/prefers-responses/info.mjs
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

/** @returns {object} Driver facts: a server whose Chat Completions API lacks something the Responses API has. */
export function info() {
	return {
		name: "prefers-responses",
		protocol: "openai.chat",
		responses: "prefer",
		order: 5,
		hosts: ["prefers.test"],
		auth: "bearer",
		paths: { chat: "/v1/chat/completions" }
	};
}
