/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/fixtures/driver/custom/info.mjs
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

/** @returns {object} Driver facts. */
export function info() {
	return { name: "custom", protocol: "openai.chat", order: 5, auth: "bearer", paths: { chat: "/v1/chat/completions" } };
}
