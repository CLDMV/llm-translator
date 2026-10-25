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
