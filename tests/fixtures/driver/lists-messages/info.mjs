/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/fixtures/driver/lists-messages/info.mjs
 *	@Date: 2026-11-22T10:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T10:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/** @returns {object} Driver facts: a driver whose own protocol is Chat Completions and whose server also speaks the Anthropic Messages protocol, which is how a third-party driver can list `anthropic.messages` without being vLLM. */
export function info() {
	return {
		name: "lists-messages",
		protocol: "openai.chat",
		protocols: ["openai.chat", "anthropic.messages"],
		order: 5,
		hosts: ["lists.test"],
		auth: "bearer",
		paths: {}
	};
}
