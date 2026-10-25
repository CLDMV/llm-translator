/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/index.mjs
 *	@Date: 2026-10-24T20:20:01-07:00 (1792898401)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-24T21:34:45-07:00 (1792902885)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Public entry point for @cldmv/llm-translator.
 *
 * Placeholder module: the package scaffold (build, tests, CI) is in place, but
 * the translation API has not been implemented yet.
 *
 * @module @cldmv/llm-translator
 */

// Development environment check. devcheck.mjs lives at the repo root and exists only in
// a source checkout; it is never published, so the import is allowed to fail. tsup keeps
// the specifier external, so dist/index.mjs imports the same root file. It runs inside an
// async function rather than as a top-level await: index.cjs loads this module through
// Node's synchronous require(esm), which rejects any module graph containing top-level
// await (ERR_REQUIRE_ASYNC_MODULE).
(async () => {
	try {
		await import("../devcheck.mjs");
	} catch {
		// ignore - devcheck.mjs is not published
	}
})();

/**
 * The package name.
 * @type {string}
 */
export const name = "@cldmv/llm-translator";
