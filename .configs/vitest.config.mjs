/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /.configs/vitest.config.mjs
 *	@Date: 2026-10-24T20:20:19-07:00 (1792898419)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-01T09:41:26-08:00 (1793554886)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { defineConfig, mergeConfig } from "vitest/config";
import { devCondition } from "@cldmv/configs/vitest.config.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";

// Anchor the project root to the package directory so include/exclude work no
// matter what cwd vitest is invoked from.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// True inside the per-file child processes of @cldmv/vitest-runner's coverage mode.
const blobRun = process.argv.includes("--reporter=blob");

// devCondition() puts the package's llm-translator-dev condition (which routes the "."
// export to src/) ahead of Vite's default conditions for the client and SSR resolvers,
// and on the worker command line.
// LLM_TRANSLATOR_TEST_DIST=1 (set by `node tests/run-vitest.mjs --dist`) runs the whole suite against the built dist/ folder.
const distMode = process.env.LLM_TRANSLATOR_TEST_DIST === "1";
const srcDir = path.join(root, "src") + path.sep;
const distDir = path.join(root, "dist") + path.sep;

if (distMode && !existsSync(path.join(root, "dist", "index.mjs"))) {
	throw new Error("LLM_TRANSLATOR_TEST_DIST is set but dist/ is missing: run `npm run build` first (npm run test:dist does).");
}

// dist/** mirrors src/** file by file, so every module a test imports from src/ exists at the same relative path under
// dist/. The plugin resolves the id normally, then moves any result under src/ to dist/. Vitest resolves static imports,
// dynamic import() and vi.doMock/doUnmock ids through the same plugin pipeline, so a mocked ../../src/lib/pdf.mjs and the
// ./lib/pdf.mjs that dist/index.mjs imports land on the same dist file.
const srcToDist = {
	name: "llm-translator-src-to-dist",
	enforce: "pre",
	async resolveId(source, importer, options) {
		const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
		if (resolved && !resolved.external && resolved.id.startsWith(srcDir)) {
			return { ...resolved, id: distDir + resolved.id.slice(srcDir.length) };
		}
		return null;
	}
};

export default mergeConfig(
	// In dist mode devCondition is skipped, so the package's "." export resolves to dist/ like it does for a consumer.
	distMode ? { root } : devCondition({ root }),
	defineConfig({
		root,
		plugins: distMode ? [srcToDist] : [],
		test: {
			include: ["tests/**/*.test.vitest.mjs"],
			exclude: ["node_modules"],
			environment: "node",
			testTimeout: 30000,
			// "dot" keeps CI logs to one character per test file instead of a full
			// "RUN vX.Y.Z" + per-file pass/fail block for every file — vitest's
			// non-interactive fallback (no TTY to redraw) otherwise reprints that
			// whole block per file on top of the final aggregate summary, which
			// dominates the log on a suite this size. The final "Test Files X
			// passed" / "Tests Y passed" summary is unaffected — every built-in
			// reporter prints it regardless of per-test verbosity.
			reporters: ["dot"],
			setupFiles: distMode ? ["tests/helpers/dist-guard.mjs"] : [],
			// Coverage measures src/, so run-vitest.mjs refuses --dist together with --coverage.
			coverage: {
				provider: "v8",
				include: ["src/**/*.mjs"],
				exclude: ["**/*.json", "tests/**"],
				reporter: ["text", "html", "json-summary", "json"],
				// Coverage must stay at 100%: a drop makes the coverage run (and so CI) fail. The runner executes every
				// test file in its own vitest process (--reporter=blob) and merges the blobs afterwards; a single file never
				// covers all of src/, so the threshold applies to the merged report and to plain `vitest --coverage` runs only.
				thresholds: blobRun ? undefined : { lines: 100, statements: 100, functions: 100, branches: 100 }
			}
		}
	})
);
