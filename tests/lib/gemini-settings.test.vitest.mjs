/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/gemini-settings.test.vitest.mjs
 *	@Date: 2026-11-22T10:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T10:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The `gemini` setting: every key's check, and the merge of the layers through resolve.
 */
import { describe, expect, it } from "vitest";
import { check } from "../../src/lib/gemini-settings.mjs";
import { resolve } from "../../src/lib/settings.mjs";

describe("check", () => {
	it("accepts every key with a good value", () => {
		expect(check({})).toBeNull();
		expect(
			check({
				safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }],
				tools: [{ googleSearch: {} }],
				cachedContent: "cachedContents/abc",
				cache: false,
				thinking: "level",
				responseModalities: ["TEXT", "IMAGE"],
				imageConfig: { aspectRatio: "1:1" },
				speechConfig: {},
				mediaResolution: "MEDIA_RESOLUTION_LOW",
				computerUse: {
					environment: "ENVIRONMENT_BROWSER",
					excludedPredefinedFunctions: ["wait"],
					enablePromptInjectionDetection: true,
					disabledSafetyPolicies: ["FINANCIAL_TRANSACTIONS"]
				}
			})
		).toBeNull();
		expect(check({ computerUse: {} })).toBeNull();
		expect(
			check({
				computerUse: {
					enable_prompt_injection_detection: false,
					disabled_safety_policies: [],
					excluded_predefined_functions: [],
					environment: "ENVIRONMENT_MOBILE"
				}
			})
		).toBeNull();
	});

	it("names the key that is wrong, and what it expects", () => {
		expect(check(null)).toBe("expected an object");
		expect(check([])).toBe("expected an object");
		expect(check({ nope: 1 })).toBe("unknown key nope");
		expect(check({ safetySettings: [{ category: "x" }] })).toMatch(/^safetySettings must be a list/);
		expect(check({ safetySettings: "x" })).toMatch(/^safetySettings/);
		expect(check({ tools: [1] })).toMatch(/^tools must be/);
		expect(check({ tools: {} })).toMatch(/^tools must be/);
		expect(check({ cachedContent: "" })).toMatch(/^cachedContent must be/);
		expect(check({ cache: "no" })).toBe("cache must be true or false");
		expect(check({ thinking: "fast" })).toMatch(/^thinking must be "auto"/);
		expect(check({ responseModalities: [""] })).toMatch(/^responseModalities/);
		expect(check({ responseModalities: "TEXT" })).toMatch(/^responseModalities/);
		expect(check({ imageConfig: [] })).toBe("imageConfig must be an object");
		expect(check({ speechConfig: null })).toBe("speechConfig must be an object");
		expect(check({ mediaResolution: 1 })).toBe("mediaResolution must be a string");
		expect(check({ computerUse: [] })).toBe("computerUse: expected an object");
		expect(check({ computerUse: null })).toBe("computerUse: expected an object");
		expect(check({ computerUse: { enviroment: "x" } })).toBe("computerUse: unknown field enviroment");
		expect(check({ computerUse: { environment: "desktop" } })).toMatch(
			/^computerUse: environment must be ENVIRONMENT_UNSPECIFIED, ENVIRONMENT_BROWSER/
		);
		expect(check({ computerUse: { excludedPredefinedFunctions: [""] } })).toBe(
			"computerUse: excludedPredefinedFunctions must be a list of action names"
		);
		expect(check({ computerUse: { excluded_predefined_functions: "click" } })).toBe(
			"computerUse: excludedPredefinedFunctions must be a list of action names"
		);
		expect(check({ computerUse: { enablePromptInjectionDetection: "yes" } })).toBe(
			"computerUse: enablePromptInjectionDetection must be true or false"
		);
		expect(check({ computerUse: { disabled_safety_policies: ["EVERYTHING"] } })).toMatch(
			/^computerUse: disabledSafetyPolicies must be a list of SAFETY_POLICY_UNSPECIFIED, FINANCIAL_TRANSACTIONS/
		);
	});
});

describe("resolve", () => {
	it("merges the gemini layers key by key and refuses a bad one", () => {
		const out = resolve({ gemini: { cache: false, thinking: "level" } }, { gemini: { thinking: "budget" } });
		expect(out.gemini).toEqual({ cache: false, thinking: "budget" });
		expect(resolve().gemini).toEqual({});
		expect(() => resolve({ gemini: { thinking: "fast" } })).toThrow(/Invalid setting gemini/);
		expect(() => resolve({ gemini: "x" })).toThrow(/expected an object/);
	});
});
