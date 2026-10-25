/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /.configs/vitest.config.mjs
 *	@Date: 2026-10-24T20:20:19-07:00 (1792898419)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-24T21:34:42-07:00 (1792902882)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Anchor the project root to the package directory so include/exclude work no
// matter what cwd vitest is invoked from.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
	root,
	resolve: {
		// Replaces the defaults, so keep the usual ones alongside the package's own
		// condition (which routes the "." export to src/).
		conditions: ["llm-translator-dev", "module", "browser", "development|production"]
	},
	ssr: {
		// Vitest often goes through the SSR resolve pipeline even in node tests.
		resolve: {
			conditions: ["llm-translator-dev", "node", "development|production"]
		}
	},
	test: {
		include: ["tests/**/*.test.vitest.mjs"],
		exclude: ["node_modules"],
		environment: "node",
		testTimeout: 30000,
		// Workers get the condition on their node CLI (execArgv), so Node's own resolver
		// and devcheck.mjs see it too.
		nodeOptions: ["--conditions=llm-translator-dev"],
		// "dot" keeps CI logs to one character per test file instead of a full
		// "RUN vX.Y.Z" + per-file pass/fail block for every file — vitest's
		// non-interactive fallback (no TTY to redraw) otherwise reprints that
		// whole block per file on top of the final aggregate summary, which
		// dominates the log on a suite this size. The final "Test Files X
		// passed" / "Tests Y passed" summary is unaffected — every built-in
		// reporter prints it regardless of per-test verbosity.
		reporters: ["dot"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.mjs"],
			exclude: ["**/*.json", "tests/**"],
			reporter: ["text", "html", "json-summary", "json"]
		}
	}
});
