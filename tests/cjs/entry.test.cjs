/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/cjs/entry.test.cjs
 *	@Date: 2026-10-24T20:25:14-07:00 (1792898714)
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
 * @fileoverview Checks the built dist/ entry points: the ESM bundle and the CJS
 * shim must expose the same exports. Run after `npm run build` (see `test:dist`).
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const dist = path.resolve(__dirname, "../../dist");

test("CJS shim re-exports the ESM bundle", async () => {
	const esm = await import(pathToFileURL(path.join(dist, "index.mjs")).href);
	const cjs = require(path.join(dist, "index.cjs"));
	assert.equal(cjs.name, "@cldmv/llm-translator");
	assert.deepEqual(Object.keys(cjs).sort(), Object.keys(esm).sort());
	assert.equal(cjs.name, esm.name);
});

test("dist/index.mjs imports the root devcheck.mjs instead of bundling it", () => {
	const bundle = require("node:fs").readFileSync(path.join(dist, "index.mjs"), "utf8");
	assert.match(bundle, /import\(\s*["']\.\.\/devcheck\.mjs["']\s*\)/);
	assert.doesNotMatch(bundle, /Development environment not properly configured/);
});
