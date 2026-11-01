/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/tools.mjs
 *	@Date: 2026-10-26T06:00:20-07:00 (1793019620)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-26T15:38:55-07:00 (1793054335)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * @fileoverview Tool-calling diagnostics for OpenAI-protocol upstreams: recognising vLLM's "tool parsing is not enabled" refusal,
 * the hint added to it and removing tools from a Chat Completions body.
 * @module @cldmv/llm-translator/lib/tools
 */
/** Added to the error message the client receives when the upstream refuses tools for want of a tool parser. */
export declare const HINT = "The vLLM server was started without tool-call parsing. Restart it with --enable-auto-tool-choice and --tool-call-parser <parser> (the parser depends on the model family), or set the translator setting toolFallback to retry without tools.";
/**
 * Does an upstream error message say the server has no tool parser configured?
 * @param {string} message - Upstream error message.
 * @returns {boolean} True for a known "tool parsing not enabled" wording.
 */
export declare function refused(message: string): boolean;
/**
 * Does a Chat Completions body carry tools?
 * @param {any} body - Upstream request body.
 * @returns {boolean} True when `tools` is a non-empty array.
 */
export declare function carries(body: any): boolean;
/**
 * Copy a Chat Completions body without `tools`, `tool_choice` and `parallel_tool_calls`.
 * @param {any} body - Upstream request body.
 * @returns {any} New body.
 */
export declare function strip(body: any): any;
