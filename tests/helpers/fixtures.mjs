/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/helpers/fixtures.mjs
 *	@Date: 2026-10-25T12:19:58-07:00 (1792955998)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:04-07:00 (1792958344)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/claude-code");

/**
 * Load a captured Claude Code 2.1.310 request body.
 * @param {string} name - Fixture name without extension (for example `b_tool-2`).
 * @returns {any} Parsed request body (a fresh copy per call).
 */
export function claudeCode(name) {
	return JSON.parse(readFileSync(path.join(dir, `${name}.json`), "utf8"));
}
