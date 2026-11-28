/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/index.cjs
 *	@Date: 2026-10-24T20:20:04-07:00 (1792898404)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-01T16:24:44-08:00 (1793579084)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview CommonJS entry point: the generic CLDMV drop-in shim
 * (CLDMV/.github docs/conventions/package-layout.md).
 *
 * It returns what `import` gives. The package exports several distinct values, so
 * `require("@cldmv/llm-translator")` is the module object (`{ default, createTranslator, ... }`).
 * tsup.config.mjs copies it verbatim into dist/, where `./index.mjs` resolves to the built entry
 * (in a checkout, to the sibling src/index.mjs).
 * @module @cldmv/llm-translator
 */
"use strict";

if (!process.features?.require_module) {
	const error = new Error(
		`@cldmv/llm-translator: require() needs Node.js >=22.15.0 (this is ${process.version}). On older Node.js, load the package with import() instead.`
	);
	error.code = "ERR_REQUIRE_ESM";
	throw error;
}

// Same exports as `import`. One distinct exported value (aliases of it count once) comes back as that value,
// so require(x)(...) works; anything else comes back as the module object ({ default, ...named }).
const esm = require("./index.mjs");
const values = new Set(
	Object.keys(esm)
		.filter((key) => key !== "__esModule")
		.map((key) => esm[key])
);
module.exports = values.size === 1 ? values.values().next().value : esm;
