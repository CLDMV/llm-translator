/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/fixtures/driver/nativesearch/detect.mjs
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
/**
 * @param {{endpoint: {url: string}}} context - Detection context.
 * @returns {{models: string[]} | null} Facts for the host this fixture claims.
 */
export function detect({ endpoint }) {
	return endpoint.url.includes("native.test") ? { models: ["qwen3-coder"] } : null;
}
