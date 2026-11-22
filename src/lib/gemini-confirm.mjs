/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/gemini-confirm.mjs
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
 * @fileoverview Gemini's computer use asks for a confirmation when it flags an action: the call's `args.safety_decision` is `{ decision: "require_confirmation", explanation }`, and the action may only be run once the user agreed. An Anthropic client has no field for that, so the translator asks through a tool of the client's (Claude Code's `AskUserQuestion`, or the one `settings.gemini.confirmationTool` names), or in plain text when the request declares none. Nothing is stored: the call being asked about travels in the conversation as a line of text before the question (`Gemini wants to run <name> <args>`), a short hash of it is in the question's tool_use id, and both are checked when the answer comes back.
 * @module @cldmv/llm-translator/lib/gemini-confirm
 */
import { createHash } from "node:crypto";
import { TranslatorError } from "./errors.mjs";

/** What the line that names the flagged call starts with. */
const LEAD = "Gemini wants to run ";

/** A call id that stands for a confirmed (or asked about) action: Gemini's own id, then `__cf` and the hash of the call. */
export const MARK = /__cf([0-9a-f]{8})$/;

/** What the result of an action the user declined says. */
export const DECLINED = "The user declined this action. It was not run.";

/** The words of the question's options. */
const ALLOW = "Allow";
const DENY = "Deny";

/**
 * JSON with the keys of every object in order, so the same call always gives the same text.
 * @param {any} value - A JSON value.
 * @returns {string} The text.
 */
export function canonical(value) {
	if (Array.isArray(value)) return `[${value.map((entry) => canonical(entry)).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/**
 * The short hash of a call.
 * @param {string} name - The Gemini function name.
 * @param {any} args - Its arguments.
 * @returns {string} Eight hex digits.
 */
export function hashOf(name, args) {
	return createHash("sha256")
		.update(`${name}\n${canonical(args)}`)
		.digest("hex")
		.slice(0, 8);
}

/**
 * The line that names a flagged call.
 * @param {string} name - Function name.
 * @param {any} args - Arguments (without `safety_decision`).
 * @returns {string} The line.
 */
export function lineOf(name, args) {
	return `${LEAD}${name} ${canonical(args)}`;
}

/**
 * The flagged call a text names: a line `Gemini wants to run <name> <args>`.
 * @param {string} text - The text of a block.
 * @returns {{ name: string, args: any, line: string } | null} The call and the line, or null when no line is one.
 */
export function parseLine(text) {
	for (const line of String(text).split("\n")) {
		if (!line.startsWith(LEAD)) continue;
		const rest = line.slice(LEAD.length);
		const space = rest.indexOf(" ");
		if (space <= 0) continue;
		try {
			const args = JSON.parse(rest.slice(space + 1));
			if (args !== null && typeof args === "object" && !Array.isArray(args)) return { name: rest.slice(0, space), args, line };
		} catch {
			// Not JSON: not our line.
		}
	}
	return null;
}

/**
 * The text of a request for confirmation sent as plain text, when the request declares no tool to ask with.
 * @param {string} name - Function name.
 * @param {any} args - Arguments.
 * @param {string | undefined} explanation - Gemini's explanation.
 * @returns {string} The text: the line, then what Gemini says and what to answer.
 */
export function plainText(name, args, explanation) {
	const why = typeof explanation === "string" && explanation !== "" ? `\n\nGemini says: ${explanation}` : "";
	return `${lineOf(name, args)}${why}\n\nReply to confirm that it may go ahead, or say what to do instead.`;
}

/**
 * The question put to the user through a tool.
 * @param {string} name - Function name.
 * @param {any} args - Arguments.
 * @param {string | undefined} explanation - Gemini's explanation.
 * @returns {string} The question text, which names the action with its arguments and quotes Gemini's explanation.
 */
export function questionOf(name, args, explanation) {
	const why = typeof explanation === "string" && explanation !== "" ? ` Gemini says: "${explanation}"` : "";
	return `Allow Gemini to run ${name} ${canonical(args)}?${why}`;
}

/**
 * The input of the confirmation tool (the shape of Claude Code's `AskUserQuestion`).
 * @param {string} name - Function name.
 * @param {any} args - Arguments.
 * @param {string | undefined} explanation - Gemini's explanation.
 * @returns {any} The tool input.
 */
export function inputOf(name, args, explanation) {
	return {
		questions: [
			{
				question: questionOf(name, args, explanation),
				header: "Confirm",
				options: [
					{ label: ALLOW, description: "Run this action" },
					{ label: DENY, description: "Do not run it" }
				],
				multiSelect: false
			}
		]
	};
}

/**
 * Whether a tool takes the `AskUserQuestion` shape: `questions`, a list of objects with `question`, `header`, `options` and `multiSelect`.
 * @param {any} tool - A tool of the request.
 * @returns {boolean} True when it does.
 */
function asks(tool) {
	const item = tool?.input_schema?.properties?.questions?.items?.properties;
	return ["question", "header", "options", "multiSelect"].every((key) => item?.[key] !== undefined);
}

/**
 * The tool that asks the user: the one `settings.gemini.confirmationTool` names, else `AskUserQuestion` when the request declares it with its shape.
 * Only tools of that shape are supported, because the question and its answer are in it.
 * @param {any[]} tools - The request's tools.
 * @param {string | undefined} configured - `settings.gemini.confirmationTool`.
 * @returns {{ name: string } | null} The tool, or null when there is none (the confirmation is then asked in plain text).
 * @throws {TranslatorError} `invalid_confirmation_tool` (400) when the named tool is not declared or does not take that shape.
 */
export function toolOf(tools, configured) {
	if (configured === undefined) {
		const found = tools.find((tool) => tool?.name === "AskUserQuestion" && asks(tool));
		return found === undefined ? null : { name: found.name };
	}
	const named = tools.find((tool) => tool?.name === configured);
	if (named === undefined) {
		throw new TranslatorError(`settings.gemini.confirmationTool names ${configured}, which the request does not declare`, {
			code: "invalid_confirmation_tool",
			status: 400
		});
	}
	if (!asks(named)) {
		throw new TranslatorError(
			`settings.gemini.confirmationTool ${configured} has to take the AskUserQuestion shape: questions, a list of { question, header, options, multiSelect }`,
			{ code: "invalid_confirmation_tool", status: 400 }
		);
	}
	return { name: configured };
}

/**
 * Whether the answer of the user to the question was Allow. The answer is the one `="<label>"` pair of the result text (Claude Code writes
 * `"<question>"="<answer>"`), or the only value of an `answers` object; anything else, a free-text answer included, is a no.
 * @param {string} text - The text of the tool result.
 * @returns {boolean} True only for Allow.
 */
export function allowed(text) {
	try {
		const parsed = JSON.parse(text);
		const answers = parsed?.answers;
		if (answers !== null && typeof answers === "object") {
			const values = Object.values(answers);
			return values.length === 1 && values[0] === ALLOW;
		}
	} catch {
		// Not JSON: the text form.
	}
	const found = [...String(text).matchAll(/="((?:[^"\\]|\\.)*)"/g)];
	return found.length === 1 && found[0][1] === ALLOW;
}

/**
 * The call id of a confirmed action.
 * @param {string} base - Gemini's call id.
 * @param {string} name - Function name.
 * @param {any} args - Arguments.
 * @returns {string} The id.
 */
export function idOf(base, name, args) {
	return `${base}__cf${hashOf(name, args)}`;
}

/**
 * The text of a tool result.
 * @param {any} block - A `tool_result` block.
 * @returns {string} The text.
 */
function textOf(block) {
	if (typeof block?.content === "string") return block.content;
	return (Array.isArray(block?.content) ? block.content : [])
		.filter((part) => part?.type === "text")
		.map((part) => part.text)
		.join("\n");
}

/**
 * The ask in a message of the history: the tool_use that asks (its id carries the hash) with the line before it that names the call.
 * @param {any} message - An assistant message.
 * @param {Set<string>} actions - Names of the tools that are computer calls (never a question).
 * @returns {{ use: any, at: number, text: number, call: { name: string, args: any, line: string } } | null} The ask, or null for a message with none.
 * @throws {TranslatorError} `unconfirmed_computer_action` (400) when the line is missing or is not the call the id's hash was made from.
 */
function askOf(message, actions) {
	const list = Array.isArray(message?.content) ? message.content : [];
	const at = list.findIndex((block) => block?.type === "tool_use" && MARK.test(block.id) && !actions.has(block.name));
	if (at === -1) return null;
	const use = list[at];
	const text = list.slice(0, at).findLastIndex((block) => block?.type === "text");
	const call = text === -1 ? null : parseLine(list[text].text);
	if (call === null || hashOf(call.name, call.args) !== MARK.exec(use.id)[1]) {
		throw new TranslatorError("The confirmation of a Gemini computer action does not match the action it was for; nothing was run", {
			code: "unconfirmed_computer_action",
			status: 400
		});
	}
	return { use, at, text, call };
}

/**
 * The message with the line that names the call taken out of its text (the block goes when nothing else is in it).
 * @param {any[]} content - The message's blocks.
 * @param {number} text - Index of the text block with the line.
 * @param {string} line - The line.
 * @returns {any[]} The blocks.
 */
function without(content, text, line) {
	const rest = content[text].text
		.split("\n")
		.filter((entry) => entry !== line)
		.join("\n")
		.trim();
	return content.flatMap((block, at) => (at !== text ? [block] : rest === "" ? [] : [{ ...block, text: rest }]));
}

/**
 * Resolve the questions of the history. An answered question that was allowed and whose action came back from the client is folded into the turn
 * it belonged to: the action's call and result are put where the question was, so Gemini sees one turn. One that was declined, or that is still to
 * be answered with the action (the last message), becomes a call Gemini made and a result that says the user declined. The plain-text confirmations
 * of the last assistant turn are returned as `pending`: when Gemini asks again for exactly that call, the user's reply is the agreement.
 * @param {any[]} messages - Anthropic messages.
 * @param {Set<string>} actions - Names of the computer calls.
 * @returns {{ messages: any[], local: { id: string, name: string, args: any } | null, pending: Set<string> }} The messages, the action to answer with when the last user message allows one that has not been run, and the hashes of the calls asked in plain text.
 * @throws {TranslatorError} `unconfirmed_computer_action` (400) for a question that has no matching line or no answer.
 */
export function resolve(messages, actions) {
	const out = [...messages];
	let local = null;
	for (let at = 0; at < out.length; at++) {
		const ask = askOf(out[at], actions);
		if (ask === null) continue;
		const reply = out[at + 1];
		const result = (Array.isArray(reply?.content) ? reply.content : []).find(
			(block) => block?.type === "tool_result" && block.tool_use_id === ask.use.id
		);
		if (result === undefined) {
			throw new TranslatorError("A Gemini computer action was asked about but has no answer in the conversation; nothing was run", {
				code: "unconfirmed_computer_action",
				status: 400
			});
		}
		const yes = allowed(textOf(result));
		const followed =
			out[at + 2]?.role === "assistant" &&
			out[at + 2].content?.some?.((block) => block?.type === "tool_use" && block.id.startsWith(ask.use.id));
		const before = without(out[at].content, ask.text, ask.call.line).filter((block) => block !== ask.use);
		const kept = reply.content.filter((block) => block !== result);
		if (yes && followed && out[at + 3]?.role === "user") {
			out[at] = { ...out[at], content: [...before, ...out[at + 2].content] };
			out[at + 1] = { ...reply, content: [...kept, ...out[at + 3].content] };
			out.splice(at + 2, 2);
			continue;
		}
		if (yes && !followed && at + 1 === out.length - 1) local = { id: ask.use.id, name: ask.call.name, args: ask.call.args };
		out[at] = { ...out[at], content: [...before, { type: "tool_use", id: ask.use.id, name: ask.call.name, input: ask.call.args }] };
		out[at + 1] = { ...reply, content: [...kept, { type: "tool_result", tool_use_id: ask.use.id, content: DECLINED, is_error: true }] };
	}
	const pending = new Set();
	const last = out.at(-2);
	if (out.length >= 2 && out.at(-1)?.role === "user" && last?.role === "assistant" && Array.isArray(last.content)) {
		for (const block of last.content) {
			const call = block?.type === "text" ? parseLine(block.text) : null;
			if (call !== null) pending.add(hashOf(call.name, call.args));
		}
	}
	return { messages: out, local, pending };
}
