/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/settings.test.vitest.mjs
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
import { DEFAULTS, resolve } from "../../src/lib/settings.mjs";

describe("settings", () => {
	test("resolve() with no layers returns the defaults as a fresh object", () => {
		const a = resolve();
		expect(a).toEqual(DEFAULTS);
		expect(a).not.toBe(DEFAULTS);
		a.pdf.maxPages = 1;
		expect(DEFAULTS.pdf.maxPages).toBe(100);
	});

	test("later layers win, undefined and empty layers are skipped, pdf merges key by key", () => {
		const out = resolve({ inlineSystem: "keep", pdf: { pages: false } }, null, undefined, {
			inlineSystem: undefined,
			topK: false,
			pdf: { maxPages: 3 }
		});
		expect(out.inlineSystem).toBe("keep");
		expect(out.topK).toBe(false);
		expect(out.pdf).toEqual({ ...DEFAULTS.pdf, pages: false, maxPages: 3 });
	});

	test("defaults document the agreed values", () => {
		expect(DEFAULTS).toMatchObject({
			inlineSystem: "auto",
			stripBillingHeader: true,
			reasoningField: "reasoning",
			thinkTags: true,
			thinking: "chat_template_kwargs",
			toolSchema: "pass",
			deferredTools: "forward",
			toolErrors: false,
			maxTokensField: "max_completion_tokens",
			streamUsage: true,
			continuousUsage: false,
			prefill: "continue_final_message",
			unknownFields: "drop",
			pingInterval: 10000
		});
		expect(Object.isFrozen(DEFAULTS)).toBe(true);
	});

	test("effortPassthrough and passthroughFilter default to off and must be booleans", () => {
		expect(resolve()).toMatchObject({ effortPassthrough: false, passthroughFilter: false });
		expect(resolve({ effortPassthrough: true, passthroughFilter: true })).toMatchObject({
			effortPassthrough: true,
			passthroughFilter: true
		});
		expect(() => resolve({ passthroughFilter: "yes" })).toThrow(/Invalid setting passthroughFilter/);
		try {
			resolve({ effortPassthrough: 1 });
		} catch (error) {
			expect(error).toMatchObject({ code: "invalid_setting", status: 500, details: { key: "effortPassthrough" } });
		}
	});

	test("rejects invalid enumerated values", () => {
		expect(() => resolve({ inlineSystem: "sideways" })).toThrow(/Invalid setting inlineSystem/);
		try {
			resolve({ thinking: "maybe" });
		} catch (error) {
			expect(error.code).toBe("invalid_setting");
			expect(error.status).toBe(500);
			expect(error.details.key).toBe("thinking");
		}
	});
});
