/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/package-surface.test.vitest.mjs
 *	@Date: 2026-10-24T20:20:10-07:00 (1792898410)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-24T20:22:38-07:00 (1792898558)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import * as entry from "../src/index.mjs";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

describe("package surface", () => {
	it("exports the package name", () => {
		expect(entry.name).toBe(pkg.name);
	});

	it("exposes only the documented exports", () => {
		expect(Object.keys(entry).sort()).toEqual(["name"]);
	});
});
