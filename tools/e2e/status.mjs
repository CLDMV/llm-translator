/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tools/e2e/status.mjs
 *	@Date: 2026-10-26T06:00:29-07:00 (1793019629)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-26T15:39:13-07:00 (1793054353)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Print the models an OpenAI-compatible server lists. Usage: `node tools/e2e/status.mjs <port>`.
 */
const port = process.argv[2] ?? "8100";
const reply = await fetch(`http://127.0.0.1:${port}/v1/models`);
console.log(reply.status, JSON.stringify(await reply.json()));
