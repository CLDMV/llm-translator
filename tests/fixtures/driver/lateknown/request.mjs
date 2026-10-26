/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/fixtures/driver/lateknown/request.mjs
 *	@Date: 2026-10-25T22:46:04-07:00 (1792993564)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-26T15:39:07-07:00 (1793054347)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { TranslatorError } from "../../../../src/lib/errors.mjs";

export async function request() {
	await new Promise((resolve) => setTimeout(resolve, 120));
	throw new TranslatorError("late translator error", { code: "late", status: 400 });
}
