/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/context.mjs
 *	@Date: 2026-11-14T09:00:00-08:00 (1794243600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-14T09:00:00-08:00 (1794243600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Local emulation of Anthropic's `clear_tool_uses` context edit over converted OpenAI messages.
 * @module @cldmv/llm-translator/lib/context
 */
import { estimate, tokens } from "./estimate.mjs";
import { restoreName } from "./ids.mjs";

/** Input tokens above which an edit with no `trigger` applies. */
export const DEFAULT_TRIGGER = 100000;
/** Recent tool uses an edit with no `keep` leaves alone. */
export const DEFAULT_KEEP = 3;
/** What a cleared tool result says. */
export const PLACEHOLDER = "[Tool result cleared to save context]";

/**
 * Whether a value is `{ type, value }` with a non-negative integer `value` and one of the allowed types.
 * @param {any} spec - The value.
 * @param {string[]} types - Allowed `type`s.
 * @returns {boolean} True for a usable threshold.
 */
const threshold = (spec, types) =>
	spec !== null && typeof spec === "object" && types.includes(spec.type) && Number.isInteger(spec.value) && spec.value >= 0;

/**
 * Whether an edit's parameters are all usable. Anything else cannot be honoured and the edit is dropped.
 * @param {any} edit - A `clear_tool_uses` edit.
 * @returns {boolean} True when every present parameter has its documented shape.
 */
export function valid(edit) {
	if (edit.trigger !== undefined && !threshold(edit.trigger, ["input_tokens", "tool_uses"])) return false;
	if (edit.keep !== undefined && !threshold(edit.keep, ["tool_uses"])) return false;
	if (edit.clear_at_least !== undefined && !threshold(edit.clear_at_least, ["input_tokens"])) return false;
	if (
		edit.exclude_tools !== undefined &&
		!(Array.isArray(edit.exclude_tools) && edit.exclude_tools.every((name) => typeof name === "string"))
	)
		return false;
	return edit.clear_tool_inputs === undefined || typeof edit.clear_tool_inputs === "boolean";
}

/**
 * Clear the results (and optionally the inputs) of the oldest tool uses of a converted conversation, as Anthropic's
 * `clear_tool_uses_20250919` edit does. Messages are changed in place.
 *
 * Tool uses are counted in conversation order across every assistant turn. The edit applies when the trigger is exceeded (default: more
 * than 100000 estimated input tokens). The most recent `keep` tool uses (default 3, whatever tool they are) are never cleared, nor are
 * uses of a tool named in `exclude_tools`. The rest, oldest first, have their result replaced by a placeholder (and, with
 * `clear_tool_inputs`, their arguments by `{}`). When fewer than `clear_at_least` input tokens would be freed nothing changes. Input
 * tokens are estimated at one per four characters (`lib/estimate`), for the trigger and for the amount cleared.
 * @param {any} edit - A valid `clear_tool_uses` edit (see `valid`).
 * @param {{ messages: any[], tools?: any[] }} body - Converted OpenAI body; its messages are edited.
 * @param {Record<string, string>} toolNames - `fitted -> original` tool names, to match `exclude_tools`.
 * @returns {{ type: string, cleared_tool_uses: number, cleared_input_tokens: number } | null} The applied edit, or null when nothing was cleared.
 */
export function clearToolUses(edit, body, toolNames) {
	const uses = [];
	for (const message of body.messages) {
		if (message.role !== "assistant") continue;
		for (const call of message.tool_calls ?? [])
			uses.push({ call, result: body.messages.find((m) => m.role === "tool" && m.tool_call_id === call.id) });
	}
	const trigger = edit.trigger ?? { type: "input_tokens", value: DEFAULT_TRIGGER };
	const size = trigger.type === "tool_uses" ? uses.length : estimate(body);
	if (size <= trigger.value) return null;
	const keep = edit.keep?.value ?? DEFAULT_KEEP;
	const excluded = new Set(edit.exclude_tools ?? []);
	const clearable = uses
		.slice(0, Math.max(0, uses.length - keep))
		.filter(
			(use) =>
				use.result !== undefined && use.result.content !== PLACEHOLDER && !excluded.has(restoreName(toolNames, use.call.function.name))
		);
	const saved = [];
	for (const use of clearable) {
		const had = JSON.stringify([use.result.content, edit.clear_tool_inputs === true ? use.call.function.arguments : ""]).length;
		const now = JSON.stringify([PLACEHOLDER, edit.clear_tool_inputs === true ? "{}" : ""]).length;
		saved.push(Math.max(0, had - now));
	}
	const freed = tokens(saved.reduce((sum, n) => sum + n, 0));
	if (clearable.length === 0 || freed < (edit.clear_at_least?.value ?? 0)) return null;
	for (const use of clearable) {
		use.result.content = PLACEHOLDER;
		if (edit.clear_tool_inputs === true) use.call.function.arguments = "{}";
	}
	return { type: edit.type, cleared_tool_uses: clearable.length, cleared_input_tokens: freed };
}
