/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tsup.config.mjs
 *	@Date: 2026-10-24T20:20:08-07:00 (1792898408)
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
 * @fileoverview Bundler config — produces the published dist/ output from source.
 *
 *  - dist/index.mjs — the real esbuild bundle of src/index.mjs.
 *  - dist/index.cjs — a thin, hand-written shim (src/cjs-shim.cjs) copied in verbatim
 *    by onSuccess below, never bundled by esbuild. It `require()`s ./index.mjs, which
 *    Node loads synchronously because the module has no top-level await.
 *
 * Sourcemaps are generated for local debugging but excluded from the published
 * tarball via package.json's `files` negation entry.
 */
import { copyFileSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
	entry: { index: "src/index.mjs" },
	format: ["esm"],
	outDir: "dist",
	target: "node20",
	platform: "node",
	splitting: false,
	sourcemap: true,
	dts: false,
	minify: true,
	keepNames: true,
	removeNodeProtocol: false,
	clean: true,
	outExtension() {
		return { js: ".mjs" };
	},
	onSuccess() {
		copyFileSync("src/cjs-shim.cjs", "dist/index.cjs");
	}
});
