/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/fixtures/driver/crash/info.mjs
 *	@Date: 2026-10-25T12:20:21-07:00 (1792956021)
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
	return { name: "crash", protocol: "openai.chat", order: 1, auth: "bearer", paths: { chat: "/v1/chat/completions" } };
}
