/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/cjs-shim.cjs
 *	@Date: 2026-10-24T20:20:04-07:00 (1792898404)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-24T20:22:38-07:00 (1792898558)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * CommonJS entry point — a thin, synchronous re-export of the real ESM build.
 *
 * Node's `require()` can load an ES module synchronously and get back its
 * exports directly as long as the target module doesn't use top-level await,
 * so this shim re-exports dist/index.mjs instead of tsup bundling a second,
 * independent copy of the library for the CJS format.
 *
 * Node.js versions without require(esm) (before 20.19 / 22.12) would fail with
 * a bare ERR_REQUIRE_ESM, so the check below fails early with a message that
 * says what to do instead.
 *
 * This file is copied verbatim into dist/index.cjs by tsup's onSuccess hook
 * (see tsup.config.mjs) — it never passes through esbuild itself.
 *
 * @module @cldmv/llm-translator
 */
"use strict";

if (!process.features?.require_module) {
	const error = new Error(
		`@cldmv/llm-translator: require() needs Node.js ^20.19.0 or >=22.12.0 (this is ${process.version}). On older Node.js, load the package with import() instead.`
	);
	error.code = "ERR_REQUIRE_ESM";
	throw error;
}

module.exports = require("./index.mjs");
