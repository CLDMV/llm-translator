/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tsup.config.mjs
 *	@Date: 2026-10-24T20:20:08-07:00 (1792898408)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-24T20:37:55-07:00 (1792899475)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Bundler config — produces the published dist/ output from source.
 *
 *  - dist/index.mjs — the real esbuild bundle of src/index.mjs.
 *  - dist/index.cjs — the thin, hand-written CJS entry src/index.cjs, copied verbatim by
 *    onSuccess below and never bundled by esbuild. It `require()`s ./index.mjs, which Node
 *    loads synchronously because the module has no top-level await.
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
		copyFileSync("src/index.cjs", "dist/index.cjs");
	}
});
