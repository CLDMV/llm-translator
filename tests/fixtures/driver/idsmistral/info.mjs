/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/fixtures/driver/idsmistral/info.mjs
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

/** @returns {object} Driver facts for a server with Mistral's id format: exactly 9 alphanumerics. */
export function info() {
	return {
		name: "idsmistral",
		protocol: "openai.chat",
		order: 5,
		auth: "bearer",
		toolCallIds: { alphabet: "a-zA-Z0-9", min: 9, max: 9 },
		paths: { chat: "/v1/chat/completions" }
	};
}
