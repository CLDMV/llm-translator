/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/ids.test.vitest.mjs
 *	@Date: 2026-10-25T12:18:47-07:00 (1792955927)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:04-07:00 (1792958344)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { describe, expect, test } from "vitest";
import { anthropicToolId, completionId, createNameFitter, messageId, toolUseId } from "../../src/lib/ids.mjs";

describe("ids", () => {
	test("generated ids have the protocol prefixes and are unique", () => {
		expect(messageId()).toMatch(/^msg_[0-9a-f]{24}$/);
		expect(toolUseId()).toMatch(/^toolu_[0-9a-f]{24}$/);
		expect(completionId()).toMatch(/^chatcmpl-[0-9a-f]{24}$/);
		expect(messageId()).not.toBe(messageId());
	});

	test("anthropicToolId keeps valid ids, sanitizes invalid ones and replaces missing ones", () => {
		expect(anthropicToolId("chatcmpl-tool-abc123")).toBe("chatcmpl-tool-abc123");
		expect(anthropicToolId("functions.get_weather:0")).toBe("functions_get_weather_0");
		expect(anthropicToolId(undefined)).toMatch(/^toolu_/);
		expect(anthropicToolId("")).toMatch(/^toolu_/);
		expect(anthropicToolId(12)).toMatch(/^toolu_/);
	});
});

describe("createNameFitter", () => {
	test("valid short names pass through and are not recorded", () => {
		const map = {};
		const fit = createNameFitter({ max: 64, map });
		expect(fit("Bash")).toBe("Bash");
		expect(map).toEqual({});
	});

	test("defaults to a private map", () => {
		const fit = createNameFitter({ max: 10 });
		expect(fit("a.b")).toBe("a_b");
	});

	test("invalid characters are replaced and recorded", () => {
		const map = {};
		const fit = createNameFitter({ max: 64, map });
		expect(fit("mcp.server/tool")).toBe("mcp_server_tool");
		expect(map).toEqual({ mcp_server_tool: "mcp.server/tool" });
		expect(fit("mcp.server/tool")).toBe("mcp_server_tool");
	});

	test("long names are shortened with a stable hash suffix", () => {
		const map = {};
		const fit = createNameFitter({ max: 64, map });
		const long = `mcp__${"x".repeat(100)}`;
		const fitted = fit(long);
		expect(fitted).toHaveLength(64);
		expect(fitted).toMatch(/^mcp__x+_[0-9a-f]{8}$/);
		expect(map[fitted]).toBe(long);
		expect(createNameFitter({ max: 64 })(long)).toBe(fitted);
		expect(fit(long)).toBe(fitted);
	});

	test("an existing map seeds the fitter", () => {
		const fit = createNameFitter({ max: 64, map: { short: "very.long.original" } });
		expect(fit("very.long.original")).toBe("short");
	});

	test("collisions get a numeric suffix", () => {
		const map = {};
		const fit = createNameFitter({ max: 64, map });
		expect(fit("a.b")).toBe("a_b");
		expect(fit("a/b")).toBe("a_b_2");
		expect(fit("a:b")).toBe("a_b_3");
		expect(map).toEqual({ a_b: "a.b", a_b_2: "a/b", a_b_3: "a:b" });
	});

	test("an all-invalid name still yields a usable name", () => {
		const fit = createNameFitter({ max: 64 });
		const fitted = fit("");
		expect(fitted).toMatch(/^_[0-9a-f]{8}$/);
	});
});
