/**
 * Give tool calls without an id one, and remove the duplicate reasoning that `--reasoning-format deepseek-legacy` leaves in `content`.
 * `deepseek` puts reasoning in `reasoning_content` only; `none` leaves `<think>` tags in `content` only (read by `thinkTags`); `deepseek-legacy`
 * does both, so a leading `<think>...</think>` is cut from `content` when `reasoning_content` already carries the reasoning.
 * @param {any} body - Chat Completions response body.
 * @returns {any} Normalized body.
 */
export function response(body: any): any;
