/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/server/missing-fastify.test.vitest.mjs
 *	@Date: 2026-10-25T12:26:35-07:00 (1792956395)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:04-07:00 (1792958344)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.doUnmock("fastify");
	vi.resetModules();
});

describe("server.start without fastify", () => {
	it("explains that the optional peer dependency is needed", async () => {
		vi.resetModules();
		vi.doMock("fastify", () => {
			throw new Error("Cannot find package 'fastify'");
		});
		const { createTranslator } = await import("../../src/index.mjs");
		const api = await createTranslator({
			upstreams: [{ url: "http://a.test", backend: "vllm" }],
			detect: false,
			silent: true,
			slothlet: { import: (url) => import(url) }
		});
		await expect(api.server.start({ port: 0 })).rejects.toMatchObject({ code: "fastify_missing", status: 500 });
		await api.slothlet.shutdown();
	});
});
