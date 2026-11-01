/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/llamacpp/response.mjs
 *	@Date: 2026-10-31T14:00:00-07:00 (1793480400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:00:00-07:00 (1793480400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * Give tool calls without an id one, and remove the duplicate reasoning that `--reasoning-format deepseek-legacy` leaves in `content`.
 * `deepseek` puts reasoning in `reasoning_content` only; `none` leaves `<think>` tags in `content` only (read by `thinkTags`); `deepseek-legacy`
 * does both, so a leading `<think>...</think>` is cut from `content` when `reasoning_content` already carries the reasoning.
 * @param {any} body - Chat Completions response body.
 * @returns {any} Normalized body.
 */
export declare function response(body: any): any;
