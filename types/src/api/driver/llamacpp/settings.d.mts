/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/llamacpp/settings.mjs
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
 * @fileoverview llama.cpp driver: translator settings for `llama-server`.
 * @module @cldmv/llm-translator/driver/llamacpp
 */
/**
 * Settings for `llama-server`: reasoning comes back as `reasoning_content`, `top_k` is a native sampler, `max_tokens` is the output cap,
 * thinking is toggled through `chat_template_kwargs` (needs `--jinja`) and `images` follows what `/props` says the model accepts.
 * @param {{vision?: boolean}} [facts] - Detection facts.
 * @returns {any} Partial settings.
 */
export function settings(facts?: {
    vision?: boolean;
}): any;
