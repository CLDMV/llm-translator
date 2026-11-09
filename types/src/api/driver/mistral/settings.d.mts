/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/src/api/driver/mistral/settings.mjs
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
 * @fileoverview Mistral driver: translator settings for the hosted Mistral API.
 * @module @cldmv/llm-translator/driver/mistral
 */
/**
 * Settings for api.mistral.ai: reasoning is read from typed content chunks (flattened by the response normalizers into `reasoning_content`),
 * no `top_k`, no prefill continuation, and usage on the last content chunk. Reasoning depth is chosen by the model, so no thinking switch is sent.
 * @returns {any} Partial settings.
 */
export function settings(): any;
