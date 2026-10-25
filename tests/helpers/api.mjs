/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/helpers/api.mjs
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

import path from "node:path";
import { fileURLToPath } from "node:url";
import slothlet from "@cldmv/slothlet";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Compose the real src/api tree through slothlet (eager, coverage-friendly import).
 * @returns {Promise<any>} Slothlet api.
 */
export async function composeApi() {
	return await slothlet({ base: path.join(root, "src/api"), mode: "eager", silent: true, import: (url) => import(url) });
}
