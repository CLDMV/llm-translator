/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/finish.test.vitest.mjs
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
import { toAnthropicStop, toAnthropicUsage, toOpenAIFinish, toOpenAIUsage } from "../../src/lib/finish.mjs";

describe("finish mapping", () => {
	test("openai finish reason to anthropic stop", () => {
		expect(toAnthropicStop("stop", { hasToolCalls: false })).toEqual({ stop_reason: "end_turn", stop_sequence: null });
		expect(toAnthropicStop("stop", { hasToolCalls: true })).toEqual({ stop_reason: "tool_use", stop_sequence: null });
		expect(toAnthropicStop("tool_calls", { hasToolCalls: true })).toEqual({ stop_reason: "tool_use", stop_sequence: null });
		expect(toAnthropicStop("tool_calls", { hasToolCalls: false })).toEqual({ stop_reason: "end_turn", stop_sequence: null });
		expect(toAnthropicStop("length", { hasToolCalls: false })).toEqual({ stop_reason: "max_tokens", stop_sequence: null });
		expect(toAnthropicStop("content_filter", { hasToolCalls: false })).toEqual({ stop_reason: "refusal", stop_sequence: null });
		expect(toAnthropicStop("stop", { hasToolCalls: false, matchedStop: "END" })).toEqual({
			stop_reason: "stop_sequence",
			stop_sequence: "END"
		});
		expect(toAnthropicStop("stop", { hasToolCalls: false, matchedStop: 151645 })).toEqual({ stop_reason: "end_turn", stop_sequence: null });
		expect(toAnthropicStop("stop", { hasToolCalls: false, matchedStop: "" })).toEqual({ stop_reason: "end_turn", stop_sequence: null });
	});

	test("a length stop with incomplete tool arguments is max_tokens", () => {
		expect(toAnthropicStop("length", { hasToolCalls: true, argumentsComplete: false }).stop_reason).toBe("max_tokens");
		expect(toAnthropicStop("length", { hasToolCalls: true, argumentsComplete: true }).stop_reason).toBe("tool_use");
		expect(toAnthropicStop("stop", { hasToolCalls: true, argumentsComplete: false }).stop_reason).toBe("tool_use");
	});

	test("anthropic stop reason to openai finish", () => {
		expect(toOpenAIFinish("end_turn")).toBe("stop");
		expect(toOpenAIFinish("stop_sequence")).toBe("stop");
		expect(toOpenAIFinish("pause_turn")).toBe("stop");
		expect(toOpenAIFinish("max_tokens")).toBe("length");
		expect(toOpenAIFinish("tool_use")).toBe("tool_calls");
		expect(toOpenAIFinish("refusal")).toBe("content_filter");
		expect(toOpenAIFinish(null)).toBe("stop");
	});

	test("usage to anthropic", () => {
		expect(toAnthropicUsage(undefined)).toEqual({
			input_tokens: 0,
			output_tokens: 0,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0
		});
		expect(toAnthropicUsage({ prompt_tokens: 10, completion_tokens: 4 })).toEqual({
			input_tokens: 10,
			output_tokens: 4,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0
		});
		expect(toAnthropicUsage({ prompt_tokens: 10, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 6 } })).toEqual({
			input_tokens: 4,
			output_tokens: 4,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 6
		});
		expect(toAnthropicUsage({ prompt_tokens: 2, prompt_tokens_details: { cached_tokens: 6 } }).input_tokens).toBe(0);
		expect(toAnthropicUsage({ prompt_tokens: 2, prompt_tokens_details: null }).cache_read_input_tokens).toBe(0);
	});

	test("usage to openai", () => {
		expect(toOpenAIUsage(undefined)).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
		expect(toOpenAIUsage({ input_tokens: 3, output_tokens: 2, cache_read_input_tokens: 4, cache_creation_input_tokens: 1 })).toEqual({
			prompt_tokens: 8,
			completion_tokens: 2,
			total_tokens: 10,
			prompt_tokens_details: { cached_tokens: 4 }
		});
		expect(toOpenAIUsage({ input_tokens: 3, output_tokens: 2, cache_read_input_tokens: null, cache_creation_input_tokens: null })).toEqual({
			prompt_tokens: 3,
			completion_tokens: 2,
			total_tokens: 5
		});
	});
});
