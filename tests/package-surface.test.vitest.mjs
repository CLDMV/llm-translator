/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/package-surface.test.vitest.mjs
 *	@Date: 2026-10-24T20:20:10-07:00 (1792898410)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:46:00-07:00 (1793483160)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import * as entry from "../src/index.mjs";
import { TranslatorError } from "../src/lib/errors.mjs";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

describe("package surface", () => {
	it("exposes only the documented exports", () => {
		expect(Object.keys(entry).sort()).toEqual(["TranslatorError", "createTranslator", "default"]);
		expect(entry.default).toBe(entry.createTranslator);
		expect(entry.TranslatorError).toBe(TranslatorError);
	});

	it("CJS entry re-exports the ESM entry", () => {
		const cjs = require("../src/index.cjs");
		expect(
			Object.keys(cjs)
				.filter((key) => key !== "__esModule")
				.sort()
		).toEqual(Object.keys(entry).sort());
		expect(cjs.createTranslator).toBeTypeOf("function");
	});

	it("declares the bin, the optional fastify peer and the node floor", () => {
		expect(pkg.bin["llm-translator"]).toBe("./dist/bin/llm-translator.mjs");
		expect(pkg.peerDependenciesMeta.fastify.optional).toBe(true);
		expect(pkg.engines.node).toBe(">=22.15.0");
	});

	it("the composed api exposes the documented leaves", async () => {
		const api = await entry.createTranslator({
			upstreams: ["http://a.test"],
			detect: false,
			silent: true,
			slothlet: { import: (url) => import(url) }
		});
		try {
			expect(
				Object.keys(api)
					.filter((key) => !["slothlet", "shutdown", "destroy", "initialize"].includes(key))
					.sort()
			).toEqual(
				[
					"convert",
					"detect",
					"driver",
					"error",
					"model",
					"request",
					"route",
					"response",
					"send",
					"server",
					"sse",
					"status",
					"stream",
					"token"
				].sort()
			);
			expect(typeof api.error).toBe("function");
			expect(typeof api.token.count).toBe("function");
			expect(typeof api.model.list).toBe("function");
			expect(Object.keys(api.server).sort()).toEqual(["plugin", "start", "stop"]);
		} finally {
			await api.slothlet.shutdown();
		}
	});
});
